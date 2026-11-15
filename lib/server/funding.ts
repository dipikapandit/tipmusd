// "Fund your tip from Bitcoin" verification (docs/ARCHITECTURE.md v2). The supporter's client may say it funded a
// MUSD tip by swapping BTC → MUSD on Mezo pools or by borrowing MUSD from Mezo Borrow first. That claim is stored
// with the tip but never trusted: `funding_verified` only becomes TRUE once the funding tx itself checks out on chain:
//   - receipt success;
//   - swap_btc: the tx targets the Mezo pools router (or a smart-account tx nests a swap call to it), and there is a
//     MUSD Transfer log to the tip's sender;
//   - loan_draw / loan_open: the tx calls BorrowerOperations.withdrawMUSD / openTrove (directly, or nested in a
//     smart-account tx), and MUSD is minted (Transfer from 0x0) to the tip's sender;
//   - the funding tx is mined in a block ≤ the tip tx's block.
// Anything else leaves it FALSE silently (the tip itself is unaffected). Verification runs after the tip confirms
// and is retried by the sweep for an hour.

import { toFunctionSelector, zeroAddress, type Hex } from "viem";
import type { FundingKind } from "@/lib/api-types";
import { MEZO_BORROW, MEZO_POOLS, MUSD } from "@/lib/chain/config";
import { findTokenTransfers, isTransientError, type ChainAdapter } from "./chain";
import { clock } from "./clock";
import type { Sql } from "./db";
import { big, str } from "./db/rows";
import { HttpError } from "./errors";

const lc = (s: string | null | undefined) => (s ?? "").toLowerCase();

export const FUNDING_KINDS: readonly FundingKind[] = ["swap_btc", "loan_draw", "loan_open"];

/** Selectors confirmed against the live testnet bytecode (BorrowerOperations implementation behind its EIP-1967
 *  proxy, and the pools router) on 2026-11-14. */
export const FUNDING_SELECTORS = {
  /** Router.swapExactTokensForTokens(uint256,uint256,(address,address,bool,address)[],address,uint256) */
  swap: toFunctionSelector("swapExactTokensForTokens(uint256,uint256,(address,address,bool,address)[],address,uint256)"), // 0xcac88ea9
  /** BorrowerOperations.withdrawMUSD(uint256,address,address) */
  withdrawMUSD: toFunctionSelector("withdrawMUSD(uint256,address,address)"), // 0xaf8b4fd0
  /** BorrowerOperations.openTrove(uint256,address,address) payable */
  openTrove: toFunctionSelector("openTrove(uint256,address,address)"), // 0x2f3a6d98
} as const;

/** Verification is retried for this long after the tip confirmed. */
export const FUNDING_RETRY_WINDOW_MS = 60 * 60 * 1000;
/** Sweep re-checks one tip's funding at most this often. */
export const FUNDING_RETRY_THROTTLE_MS = 15_000;

/** True when `selector` appears byte-aligned in `input` (as the start of a nested call). */
function hasSelector(input: string, selector: string): boolean {
  const hay = lc(input).replace(/^0x/, "");
  const needle = lc(selector).replace(/^0x/, "");
  for (let i = hay.indexOf(needle); i >= 0; i = hay.indexOf(needle, i + 1)) if (i % 2 === 0) return true;
  return false;
}

/** A call to `target` with `selector`: direct (tx.to = target, input starts with selector) or nested in a
 *  smart-account tx whose input carries both the target address and the selector. */
function callsTarget(tx: { to: string | null; input: string }, target: string, selector: string | null): boolean {
  const input = lc(tx.input);
  if (lc(tx.to) === lc(target)) return selector === null || input.startsWith(lc(selector));
  if (!selector) return false;
  return input.includes(lc(target).slice(2)) && hasSelector(input, selector);
}

/**
 * One funding verification attempt for a confirmed tip. Returns true when funding is (now) verified. Transient
 * RPC errors propagate; everything else that doesn't check out returns false and changes nothing.
 */
export async function verifyFunding(sql: Sql, chain: ChainAdapter, tipId: string): Promise<boolean> {
  const [t] = await sql<Record<string, unknown>>`SELECT * FROM tips WHERE id = ${tipId}`;
  if (!t) throw new HttpError(404, "not_found", "Tip not found");
  if (t.funding_verified === true) return true;
  const kind = (t.funding_kind as FundingKind | null) ?? null;
  const fhash = t.funding_tx_hash ? (lc(str(t.funding_tx_hash)) as Hex) : null;
  if (!kind || !fhash || !FUNDING_KINDS.includes(kind)) return false;
  if (str(t.status) !== "confirmed" || !t.sender_address || t.block_number === null || t.block_number === undefined) return false;
  if (lc(str(t.token_address)) !== lc(MUSD)) return false; // funding produces MUSD: only MUSD tips can be funded
  const sender = lc(str(t.sender_address));
  const tipBlock = big(t.block_number);

  await sql`UPDATE tips SET last_checked_at = ${clock.now()} WHERE id = ${tipId}`;
  const receipt = await chain.getReceipt(fhash);
  if (!receipt || receipt.status !== "success") return false;
  if (receipt.blockNumber > tipBlock) return false; // funding must come before (or with) the tip
  const tx = await chain.getTransaction(fhash);
  if (!tx) return false;

  let ok = false;
  if (kind === "swap_btc") {
    ok = callsTarget(tx, MEZO_POOLS.router, lc(tx.to) === lc(MEZO_POOLS.router) ? null : FUNDING_SELECTORS.swap) &&
      findTokenTransfers(receipt, MUSD, { to: sender }).some((x) => x.from !== sender);
  } else {
    const selector = kind === "loan_draw" ? FUNDING_SELECTORS.withdrawMUSD : FUNDING_SELECTORS.openTrove;
    ok = callsTarget(tx, MEZO_BORROW.borrowerOperations, selector) &&
      findTokenTransfers(receipt, MUSD, { to: sender, from: zeroAddress }).length > 0;
  }
  if (!ok) return false;
  const r = await sql`UPDATE tips SET funding_verified = TRUE, updated_at = ${clock.now()}
                      WHERE id = ${tipId} AND status = 'confirmed' AND funding_tx_hash = ${fhash} RETURNING id`;
  return r.length > 0;
}

/** verifyFunding that swallows transient RPC errors (the sweep retries). */
export async function verifyFundingQuietly(sql: Sql, chain: ChainAdapter, tipId: string): Promise<boolean> {
  try {
    return await verifyFunding(sql, chain, tipId);
  } catch (e) {
    if (isTransientError(e) || (e instanceof HttpError && e.status === 503)) return false;
    throw e;
  }
}

/** Stores a client's funding claim on a MUSD tip (never trusted; verified later). Ignored for MEZO tips. */
export async function recordFundingClaim(sql: Sql, tipId: string, funding: { kind: FundingKind; txHash: string }): Promise<void> {
  if (!FUNDING_KINDS.includes(funding.kind)) throw new HttpError(400, "invalid_funding", "Unknown funding kind");
  const hash = lc(funding.txHash);
  if (!/^0x[0-9a-f]{64}$/.test(hash)) throw new HttpError(400, "invalid_tx_hash", "Invalid funding transaction hash");
  await sql`UPDATE tips SET funding_kind = ${funding.kind}, funding_tx_hash = ${hash}, updated_at = ${clock.now()}
            WHERE id = ${tipId} AND funding_verified = FALSE AND token_address = ${lc(MUSD)}`;
}

/** Retries unverified funding on recently confirmed tips (bounded, throttled per tip). */
export async function sweepFunding(sql: Sql, chain: ChainAdapter, opts: { limit?: number } = {}): Promise<{ checked: number; verified: number }> {
  const now = clock.now().getTime();
  const due = await sql<{ id: string }>`
    SELECT id FROM tips
    WHERE status = 'confirmed' AND funding_tx_hash IS NOT NULL AND funding_verified = FALSE
      AND verified_at > ${new Date(now - FUNDING_RETRY_WINDOW_MS)}
      AND (last_checked_at IS NULL OR last_checked_at < ${new Date(now - FUNDING_RETRY_THROTTLE_MS)})
    ORDER BY last_checked_at ASC NULLS FIRST LIMIT ${opts.limit ?? 20}`;
  let verified = 0;
  for (const { id } of due) if (await verifyFundingQuietly(sql, chain, id)) verified++;
  return { checked: due.length, verified };
}
