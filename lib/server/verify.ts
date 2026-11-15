// Tip verification (server-only, trusts nothing from the client). Implements step 5 of the payment lifecycle in
// docs/ARCHITECTURE.md. A tip only becomes `confirmed` here (or via recordConfirmedTransfer for indexer/x402 tips),
// always from on-chain data: receipt status, the transaction's calldata (binds tx ↔ intent through the ref
// suffix), and the Transfer log of the tip's own token (`tips.token_address`: MUSD or MEZO; recipient + value).
// A Transfer of any other token never confirms a tip.
//
// All state changes are conditional on the tip still being non-terminal, so concurrent verifiers (GET polling,
// submit, worker, indexer) are idempotent: exactly one wins, the notification is unique per tip.
//
// When the tx turns out NOT to be this intent's payment (wrong contract, calldata/ref mismatch) or never mined
// (timeout), the tip fails and its tx_hash is released (set NULL) so the real owner of that hash — the intent
// whose ref is in the calldata, or an `indexer` tip — can still record the transfer. A malicious client
// submitting someone else's hash therefore can't block that transfer from being counted.

import { decodeFunctionData, encodeFunctionData, getAddress, type Address, type Hex } from "viem";
import { TERMINAL_TIP_STATUSES, type TipStatus } from "@/lib/api-types";
import { erc20Abi } from "@/lib/chain/abis";
import { TIP_REF_MAGIC, tipDataSuffix, tipTokenByAddress } from "@/lib/chain/config";
import { findTokenTransfers, type ChainAdapter, type MusdTransfer } from "./chain";
import { clock } from "./clock";
import type { Sql } from "./db";
import { big, int, str } from "./db/rows";
import { env } from "./env";
import { HttpError } from "./errors";
import { formatToken } from "./money";
import { notify } from "./notifications";

const lc = (s: string | null | undefined) => (s ?? "").toLowerCase();
const TERMINAL_SQL = "('confirmed','failed','expired')";

export interface VerifyOutcome {
  status: TipStatus;
  failureReason: string | null;
  /** Confirmations observed in this attempt (null when unknown). */
  confirmations: number | null;
}

export const isTerminal = (s: string) => (TERMINAL_TIP_STATUSES as readonly string[]).includes(s);

/** The exact calldata an app intent must carry: transfer(recipient, amount) ++ TIP_REF_MAGIC ++ ref. */
export function expectedTipCalldata(recipient: string, amountRaw: bigint, refHex: string): Hex {
  const base = encodeFunctionData({ abi: erc20Abi, functionName: "transfer", args: [getAddress(recipient) as Address, amountRaw] });
  return `${base}${tipDataSuffix(refHex).slice(2)}` as Hex;
}

/** The 16-byte ref in a transfer's calldata suffix, if the tx carries one. */
export function refFromCalldata(input: string): string | null {
  const s = lc(input);
  // selector (4) + 2 words (64) = 68 bytes = 136 hex + "0x"; suffix 20 bytes = 40 hex.
  if (s.length !== 2 + 136 + 40) return null;
  const magic = s.slice(-40, -32);
  if (`0x${magic}` !== TIP_REF_MAGIC) return null;
  const ref = s.slice(-32);
  return /^[0-9a-f]{32}$/.test(ref) ? ref : null;
}

/**
 * Tip refs carried by a transfer call nested inside a smart-account transaction (Mezo Passport Bitcoin wallets act
 * through a Mezo smart account, so the outer tx targets the account, not MUSD). Looks for every
 * `transfer(address,uint256)` call body immediately followed by our 20-byte suffix.
 */
export function embeddedRefs(input: string): string[] {
  const s = lc(input).replace(/^0x/, "");
  const magic = TIP_REF_MAGIC.slice(2);
  const out: string[] = [];
  for (let i = s.indexOf("a9059cbb"); i >= 0; i = s.indexOf("a9059cbb", i + 2)) {
    if (i % 2 !== 0) continue; // byte-aligned only
    const at = i + 8 + 128;
    if (s.slice(at, at + 8) !== magic) continue;
    const ref = s.slice(at + 8, at + 40);
    if (/^[0-9a-f]{32}$/.test(ref)) out.push(ref);
  }
  return out;
}

/** True when the exact intent calldata appears byte-aligned inside a (smart-account) transaction's input. */
export function containsTipCalldata(input: string, recipient: string, amountRaw: bigint, refHex: string): boolean {
  const hay = lc(input).replace(/^0x/, "");
  const needle = lc(expectedTipCalldata(recipient, amountRaw, refHex)).slice(2);
  for (let i = hay.indexOf(needle); i >= 0; i = hay.indexOf(needle, i + 1)) if (i % 2 === 0) return true;
  return false;
}

/** Why calldata doesn't match an intent, as precisely as we can tell. */
function calldataMismatchReason(input: string, recipient: string, expected: bigint): string {
  try {
    const head = lc(input).slice(0, 2 + 136) as Hex;
    const d = decodeFunctionData({ abi: erc20Abi, data: head });
    if (d.functionName !== "transfer") return "calldata_mismatch";
    const [to, amount] = d.args as readonly [Address, bigint];
    if (lc(to) !== lc(recipient)) return "recipient_mismatch";
    if (amount !== expected) return "amount_mismatch";
  } catch {
    /* not a transfer call */
  }
  return "calldata_mismatch";
}

type TipRow = Record<string, unknown>;

async function loadTip(sql: Sql, id: string): Promise<TipRow | null> {
  const [r] = await sql<TipRow>`SELECT * FROM tips WHERE id = ${id}`;
  return r ?? null;
}

async function fail(sql: Sql, id: string, reason: string, releaseHash: boolean): Promise<void> {
  await sql`UPDATE tips SET status = 'failed', failure_reason = ${reason},
              tx_hash = CASE WHEN ${releaseHash}::boolean THEN NULL ELSE tx_hash END,
              log_index = CASE WHEN ${releaseHash}::boolean THEN NULL ELSE log_index END,
              updated_at = ${clock.now()}
            WHERE id = ${id} AND status NOT IN ${sql.raw(TERMINAL_SQL)}`;
}

/** Expires an unsubmitted intent past its expires_at. Returns true when it did. */
export async function expireIfStale(sql: Sql, id: string): Promise<boolean> {
  const r = await sql`UPDATE tips SET status = 'expired', updated_at = ${clock.now()}
                      WHERE id = ${id} AND status IN ('created','awaiting_wallet') AND tx_hash IS NULL
                        AND expires_at IS NOT NULL AND expires_at < ${clock.now()} RETURNING id`;
  return r.length > 0;
}

/** Inserts/links the raw event row for a confirmed tip (idempotent). */
export async function upsertEvent(sql: Sql, chainId: number, t: MusdTransfer, tipId: string | null, contract: string): Promise<void> {
  await sql`INSERT INTO blockchain_events (chain_id, transaction_hash, log_index, block_number, block_hash, contract_address,
                                          event_name, from_address, to_address, value_raw, tip_id, processed_at)
            VALUES (${chainId}, ${t.txHash}, ${t.logIndex}, ${t.blockNumber}, ${t.blockHash}, ${lc(contract)}, 'Transfer',
                    ${t.from}, ${t.to}, ${t.value}, ${tipId}, ${clock.now()})
            ON CONFLICT (chain_id, transaction_hash, log_index)
            DO UPDATE SET tip_id = COALESCE(EXCLUDED.tip_id, blockchain_events.tip_id)`;
}

/** `tip_received` notification for the tip's creator (unique per tip). */
export async function notifyTipReceived(sql: Sql, tipId: string): Promise<void> {
  const [r] = await sql<Record<string, unknown>>`
    SELECT t.amount_raw, t.token_address, t.supporter_name, t.is_anonymous, t.source, p.user_id
    FROM tips t JOIN creator_profiles p ON p.id = t.creator_id WHERE t.id = ${tipId}`;
  if (!r) return;
  const sym = tipTokenByAddress(r.token_address as string)?.symbol ?? "MUSD";
  const who = r.is_anonymous ? "an anonymous supporter" : (r.supporter_name as string | null) || "a supporter";
  await notify(sql, {
    userId: str(r.user_id),
    type: "tip_received",
    title: `You received ${formatToken(big(r.amount_raw), sym)} ${sym}`,
    message: `Tip from ${who}.`,
    tipId,
  });
}

/**
 * One verification attempt for an app tip. Safe to call concurrently and repeatedly. Transient RPC errors
 * propagate (callers decide whether to swallow them); the tip is left as-is in that case.
 */
export async function verifyTip(sql: Sql, chain: ChainAdapter, tipId: string): Promise<VerifyOutcome> {
  const tip = await loadTip(sql, tipId);
  if (!tip) throw new HttpError(404, "not_found", "Tip not found");
  const out = (status: string, confirmations: number | null = null): VerifyOutcome => ({
    status: status as TipStatus,
    failureReason: null,
    confirmations,
  });
  const reread = async (confirmations: number | null = null): Promise<VerifyOutcome> => {
    const t = (await loadTip(sql, tipId))!;
    return { status: str(t.status) as TipStatus, failureReason: (t.failure_reason as string | null) ?? null, confirmations };
  };

  if (isTerminal(str(tip.status))) return reread();
  // Only app intents are verified here: x402 tips go through lib/server/x402/verify (see tips.verifyAnyTip);
  // indexer tips are recorded already confirmed.
  if (str(tip.source) !== "app") return reread();
  const hash = tip.tx_hash ? (lc(str(tip.tx_hash)) as Hex) : null;
  if (!hash) {
    await expireIfStale(sql, tipId);
    return reread();
  }
  const now = clock.now();
  await sql`UPDATE tips SET last_checked_at = ${now}, verify_attempts = verify_attempts + 1 WHERE id = ${tipId}`;

  const chainId = await chain.chainId();
  if (chainId !== int(tip.chain_id)) throw new HttpError(503, "wrong_chain_rpc", `RPC is on chain ${chainId}, expected ${int(tip.chain_id)}`);

  const receipt = await chain.getReceipt(hash);
  if (!receipt) {
    const submittedAt = tip.submitted_at ? new Date(tip.submitted_at as string).getTime() : now.getTime();
    if (now.getTime() - submittedAt > env.submittedTimeoutSec() * 1000) {
      // Release the hash: if the tx mines later, the indexer records it as an `indexer` tip (no message).
      await fail(sql, tipId, "timeout", true);
      return reread();
    }
    return out(str(tip.status));
  }
  if (receipt.status !== "success") {
    await fail(sql, tipId, "reverted", false);
    return reread();
  }

  const token = lc(str(tip.token_address));
  const recipient = lc(str(tip.recipient_address));
  const expected = big(tip.expected_amount_raw);
  const ref = str(tip.ref);
  if (!ref || expected <= 0n) return out(str(tip.status));

  const tx = await chain.getTransaction(hash);
  if (!tx) return out(str(tip.status)); // node lag between receipt and tx lookup: retry later
  if (lc(tx.to) === token) {
    // Plain wallet: the tx IS the transfer, so its calldata must be exactly transfer(recipient, amount) ++ suffix.
    if (lc(tx.input) !== lc(expectedTipCalldata(recipient, expected, ref))) {
      await fail(sql, tipId, calldataMismatchReason(tx.input, recipient, expected), true);
      return reread();
    }
  } else if (!containsTipCalldata(tx.input, recipient, expected, ref) || findTokenTransfers(receipt, token, { to: recipient }).length === 0) {
    // Smart account (Mezo Passport): the transfer call, suffix included, is nested in the account's tx, and the
    // Transfer log of the tip's token below is what proves the payment. Anything else (another contract, or the
    // right calldata sent to the other tip token) is not this tip's payment.
    await fail(sql, tipId, "wrong_token", true);
    return reread();
  }

  const transfers = findTokenTransfers(receipt, token, { to: recipient });
  if (transfers.length === 0) {
    await fail(sql, tipId, "no_matching_transfer", false);
    return reread();
  }
  const log = transfers.find((t) => t.value === expected);
  if (!log) {
    await fail(sql, tipId, "amount_mismatch", false);
    return reread();
  }

  const head = await chain.getBlockNumber();
  const confirmations = head >= receipt.blockNumber ? Number(head - receipt.blockNumber + 1n) : 0;
  if (confirmations < env.confirmations()) {
    await sql`UPDATE tips SET status = 'pending_confirmation', sender_address = ${log.from}, log_index = ${log.logIndex},
                block_number = ${receipt.blockNumber}, block_hash = ${lc(receipt.blockHash)}, updated_at = ${clock.now()}
              WHERE id = ${tipId} AND status IN ('submitted','pending_confirmation')`;
    return reread(confirmations);
  }

  const block = await chain.getBlock(receipt.blockNumber);
  const txTime = new Date(Number(block.timestamp) * 1000);
  await sql.begin(async (q) => {
    const done = await q`
      UPDATE tips SET status = 'confirmed', failure_reason = NULL, amount_raw = ${log.value}, sender_address = ${log.from},
                      log_index = ${log.logIndex}, block_number = ${receipt.blockNumber}, block_hash = ${lc(receipt.blockHash)},
                      tx_timestamp = ${txTime}, verified_at = ${clock.now()}, updated_at = ${clock.now()}
      WHERE id = ${tipId} AND status NOT IN ${q.raw(TERMINAL_SQL)} AND tx_hash = ${hash}
      RETURNING id`;
    if (done.length === 0) return; // another verifier won (or the tip changed): nothing to do
    await upsertEvent(q, chainId, log, tipId, token);
    await notifyTipReceived(q, tipId);
  });
  return reread(confirmations);
}
