// x402 settlement verification. Kept separate from the app-tip verifier (lib/server/verify.ts): app tips are bound
// to their intent by a calldata suffix ref, but an x402 settlement tx is sent by the facilitator through the x402
// Permit2 proxy, so there is no ref. Instead we bind by (tx hash returned by settlement, payer, creator wallet,
// exact amount) and trust only what the receipt's MUSD Transfer log says.
import type { Hex } from "viem";
import { MUSD, TRANSFER_TOPIC, TIP_LIMITS } from "@/lib/chain/config";
import type { Sql } from "../db";
import { clock } from "../clock";
import { env } from "../env";
import type { X402Chain } from "./chain";
import { confirmPendingX402Tip, failPendingX402Tip, touchPendingX402Tip } from "./record";

export interface SettlementExpectation {
  txHash: Hex;
  payer: string;
  payTo: string;
  amountRaw: bigint;
  requiredConfirmations: number;
}

export interface MatchedTransfer {
  from: string; // lowercase
  to: string; // lowercase
  value: bigint;
  logIndex: number;
}

export type SettlementCheck =
  | {
      kind: "confirmed";
      transfer: MatchedTransfer;
      blockNumber: bigint;
      blockHash: string;
      confirmations: number;
      timestamp: Date | null;
    }
  | {
      kind: "pending";
      reason: "no_receipt" | "confirmations";
      transfer?: MatchedTransfer;
      blockNumber?: bigint;
      blockHash?: string;
      confirmations?: number;
    }
  | { kind: "failed"; reason: "reverted" | "no_matching_transfer" | "amount_mismatch" | "recipient_mismatch" | "sender_mismatch" };

const lc = (s: string) => s.toLowerCase();
const topicAddr = (t: string) => `0x${t.slice(-40)}`.toLowerCase();

/** Decodes the MUSD Transfer logs of a receipt (ignores every other token / event). */
export function musdTransfers(logs: readonly { address: string; topics: readonly string[]; data: string; logIndex: number }[]): MatchedTransfer[] {
  const out: MatchedTransfer[] = [];
  for (const l of logs) {
    if (lc(l.address) !== lc(MUSD)) continue;
    if (l.topics.length !== 3 || lc(l.topics[0]) !== TRANSFER_TOPIC) continue;
    let value: bigint;
    try {
      value = BigInt(l.data === "0x" ? "0x0" : l.data);
    } catch {
      continue;
    }
    out.push({ from: topicAddr(l.topics[1]), to: topicAddr(l.topics[2]), value, logIndex: l.logIndex });
  }
  return out;
}

/**
 * Reads the settlement tx from chain and checks it moved exactly `amountRaw` MUSD from `payer` to `payTo`.
 * Never trusts the facilitator's word beyond the tx hash.
 */
export async function checkSettlementTx(chain: X402Chain, exp: SettlementExpectation): Promise<SettlementCheck> {
  const receipt = await chain.getReceipt(exp.txHash);
  if (!receipt) return { kind: "pending", reason: "no_receipt" };
  if (receipt.status !== "success") return { kind: "failed", reason: "reverted" };

  const payer = lc(exp.payer);
  const payTo = lc(exp.payTo);
  const transfers = musdTransfers(receipt.logs);
  const exact = transfers.find((t) => t.from === payer && t.to === payTo && t.value === exp.amountRaw);
  if (!exact) {
    if (transfers.some((t) => t.from === payer && t.to === payTo)) return { kind: "failed", reason: "amount_mismatch" };
    if (transfers.some((t) => t.to === payTo)) return { kind: "failed", reason: "sender_mismatch" };
    if (transfers.some((t) => t.from === payer)) return { kind: "failed", reason: "recipient_mismatch" };
    return { kind: "failed", reason: "no_matching_transfer" };
  }

  const head = await chain.getBlockNumber();
  const confirmations = head >= receipt.blockNumber ? Number(head - receipt.blockNumber + 1n) : 0;
  if (confirmations < exp.requiredConfirmations) {
    return {
      kind: "pending",
      reason: "confirmations",
      transfer: exact,
      blockNumber: receipt.blockNumber,
      blockHash: receipt.blockHash,
      confirmations,
    };
  }
  let timestamp: Date | null = null;
  try {
    timestamp = new Date(Number(await chain.getBlockTimestamp(receipt.blockNumber)) * 1000);
  } catch {
    timestamp = null;
  }
  return { kind: "confirmed", transfer: exact, blockNumber: receipt.blockNumber, blockHash: receipt.blockHash, confirmations, timestamp };
}

/** Polls `checkSettlementTx` briefly while the result is pending (facilitators usually return after inclusion). */
export async function checkSettlementWithRetry(
  chain: X402Chain,
  exp: SettlementExpectation,
  opts: { attempts?: number; delayMs?: number } = {},
): Promise<SettlementCheck> {
  const attempts = Math.max(1, opts.attempts ?? 6);
  const delayMs = opts.delayMs ?? 1500;
  let last: SettlementCheck = { kind: "pending", reason: "no_receipt" };
  for (let i = 0; i < attempts; i++) {
    try {
      last = await checkSettlementTx(chain, exp);
    } catch (e) {
      // RPC hiccup: keep the tip pending rather than failing a real payment.
      console.warn("[x402] settlement check failed", e instanceof Error ? e.message : e);
      last = { kind: "pending", reason: "no_receipt" };
    }
    if (last.kind !== "pending") return last;
    if (i < attempts - 1 && delayMs > 0) await new Promise((r) => setTimeout(r, delayMs));
  }
  return last;
}

// ------------------------------------------------------------------ pending x402 tips (for the background sweep)

interface PendingRow {
  id: string;
  tx_hash: string;
  sender_address: string | null;
  recipient_address: string;
  expected_amount_raw: string | number;
  submitted_at: Date | string | null;
  created_at: Date | string;
}

/**
 * Re-verifies ONE x402 tip that is still `pending_confirmation` (or `submitted`). Idempotent and safe to run
 * concurrently with the indexer: every update is conditional on the tip still being non-terminal.
 *
 * Agent B's verifier must call this (instead of the suffix-ref verifier) for `tips.source = 'x402'`.
 */
export async function verifyX402Tip(sql: Sql, chain: X402Chain, tipId: string): Promise<SettlementCheck["kind"] | "skipped"> {
  const [row] = await sql<PendingRow>`
    SELECT id, tx_hash, sender_address, recipient_address, expected_amount_raw, submitted_at, created_at
    FROM tips
    WHERE id = ${tipId} AND source = 'x402' AND status IN ('submitted', 'pending_confirmation') AND tx_hash IS NOT NULL`;
  if (!row || !row.sender_address) return "skipped";

  let check: SettlementCheck;
  try {
    check = await checkSettlementTx(chain, {
      txHash: row.tx_hash as Hex,
      payer: row.sender_address,
      payTo: row.recipient_address,
      amountRaw: BigInt(String(row.expected_amount_raw).split(".")[0]),
      requiredConfirmations: env.confirmations(),
    });
  } catch (e) {
    console.warn("[x402] verify failed", tipId, e instanceof Error ? e.message : e);
    await touchPendingX402Tip(sql, tipId);
    return "pending";
  }

  if (check.kind === "confirmed") {
    await confirmPendingX402Tip(sql, tipId, check);
    return "confirmed";
  }
  if (check.kind === "failed") {
    await failPendingX402Tip(sql, tipId, check.reason);
    return "failed";
  }
  const since = new Date(row.submitted_at ?? row.created_at).getTime();
  if (check.reason === "no_receipt" && clock.now().getTime() - since > TIP_LIMITS.SUBMITTED_TIMEOUT_SECONDS * 1000) {
    await failPendingX402Tip(sql, tipId, "timeout");
    return "failed";
  }
  await touchPendingX402Tip(sql, tipId);
  return "pending";
}

/** Sweep helper for the worker / indexer pass: verifies up to `limit` stale pending x402 tips. */
export async function sweepPendingX402Tips(sql: Sql, chain: X402Chain, limit = 25): Promise<{ checked: number; confirmed: number; failed: number }> {
  const rows = await sql<{ id: string }>`
    SELECT id FROM tips
    WHERE source = 'x402' AND status IN ('submitted', 'pending_confirmation')
    ORDER BY last_checked_at NULLS FIRST, created_at
    LIMIT ${limit}`;
  let confirmed = 0;
  let failed = 0;
  for (const r of rows) {
    const k = await verifyX402Tip(sql, chain, r.id);
    if (k === "confirmed") confirmed++;
    if (k === "failed") failed++;
  }
  return { checked: rows.length, confirmed, failed };
}
