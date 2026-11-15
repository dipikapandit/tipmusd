// Tip intents + lifecycle (docs/ARCHITECTURE.md "Payment lifecycle"). The recipient always comes from the DB,
// never from the URL or client. Status only moves forward; `confirmed` is only ever set by ./verify.ts or
// recordConfirmedTransfer (indexer / x402), from on-chain data.

import { randomBytes } from "node:crypto";
import { getAddress } from "viem";
import type { CreateTipRequest, FundingKind, TipIntent, TipSource, TipStatus, TipView } from "@/lib/api-types";
import { MEZO_TESTNET_ID, MUSD, TIP_LIMITS, TIP_TOKENS, explorerTx, tipDataSuffix, tipTokenByAddress, type TipTokenSymbol } from "@/lib/chain/config";
import type { ChainAdapter, MusdTransfer } from "./chain";
import { isTransientError } from "./chain";
import { addSeconds, clock } from "./clock";
import { getCreatorForPayment } from "./creators";
import type { Sql } from "./db";
import { bool, dec, int, iso, isoOrNull, str, strOrNull } from "./db/rows";
import { env } from "./env";
import { HttpError, conflict, notFound } from "./errors";
import { requireTokenAmount } from "./money";
import { fundingOf, tokenOf } from "./tokens";
import { FUNDING_RETRY_WINDOW_MS, recordFundingClaim, sweepFunding, verifyFundingQuietly } from "./funding";
import { isUniqueViolation } from "./profiles";
import { cleanOptional, cleanSource } from "./sanitize";
import { expireIfStale, isTerminal, notifyTipReceived, upsertEvent, verifyTip, type VerifyOutcome } from "./verify";
import type { X402Chain } from "./x402/chain";
import { sweepPendingX402Tips, verifyX402Tip } from "./x402/verify";

const lc = (s: string | null | undefined) => (s ?? "").toLowerCase();
/** GET /api/tips/{id} re-verifies a non-terminal tip at most this often. */
export const REVERIFY_THROTTLE_MS = 3000;

// ---------------------------------------------------------------- view

const TIP_SELECT = (sql: Sql) => sql.frag`
  SELECT t.*, p.username AS creator_username, p.display_name AS creator_display_name, p.thank_you_message AS creator_thank_you
  FROM tips t JOIN creator_profiles p ON p.id = t.creator_id`;

export function toTipView(r: Record<string, unknown>, confirmations: number | null = null): TipView {
  const status = str(r.status) as TipStatus;
  const hash = strOrNull(r.tx_hash);
  const required = env.confirmations();
  const thanks = str(r.creator_thank_you);
  return {
    id: str(r.id),
    token: tokenOf(r.token_address),
    funding: fundingOf(r),
    creatorUsername: str(r.creator_username),
    creatorDisplayName: str(r.creator_display_name),
    status,
    failureReason: strOrNull(r.failure_reason),
    source: str(r.source) as TipSource,
    amountRaw: r.amount_raw === null || r.amount_raw === undefined ? null : dec(r.amount_raw),
    expectedAmountRaw: r.expected_amount_raw === null || r.expected_amount_raw === undefined ? null : dec(r.expected_amount_raw),
    recipientAddress: getAddress(str(r.recipient_address)),
    senderAddress: r.sender_address ? getAddress(str(r.sender_address)) : null,
    txHash: hash,
    blockNumber: r.block_number === null || r.block_number === undefined ? null : String(r.block_number),
    confirmations: confirmations ?? (status === "confirmed" ? required : null),
    requiredConfirmations: required,
    explorerUrl: hash ? explorerTx(hash) : null,
    supporterName: strOrNull(r.supporter_name),
    message: strOrNull(r.supporter_message),
    isAnonymous: bool(r.is_anonymous),
    thankYouMessage: status === "confirmed" && thanks ? thanks : null,
    createdAt: iso(r.created_at),
    verifiedAt: isoOrNull(r.verified_at),
    expiresAt: isoOrNull(r.expires_at),
  };
}

export async function getTipView(sql: Sql, id: string, confirmations: number | null = null): Promise<TipView> {
  const [r] = await sql<Record<string, unknown>>`${TIP_SELECT(sql)} WHERE t.id = ${id}`;
  if (!r) throw notFound("Tip not found");
  return toTipView(r, confirmations);
}

// ---------------------------------------------------------------- create

export async function createTip(sql: Sql, input: CreateTipRequest): Promise<TipIntent> {
  const creator = await getCreatorForPayment(sql, input.username);
  if (!creator) throw notFound("Creator not found");
  const symbol = (input.token === undefined ? "MUSD" : input.token) as TipTokenSymbol;
  if (symbol !== "MUSD" && symbol !== "MEZO") throw new HttpError(400, "invalid_token", "token must be MUSD or MEZO");
  const token = TIP_TOKENS[symbol];
  if (symbol === "MEZO" && !creator.acceptMezo) throw new HttpError(422, "mezo_disabled", "This creator doesn't accept MEZO tips");
  const amount = requireTokenAmount(input.amount, symbol);
  const isAnonymous = Boolean(input.isAnonymous);
  if (isAnonymous && !creator.anonymousTipsEnabled) throw new HttpError(422, "anonymous_disabled", "This creator doesn't accept anonymous tips");
  const message = cleanOptional(input.message, { max: TIP_LIMITS.MESSAGE_MAX, multiline: true });
  if (message && !creator.messagesEnabled) throw new HttpError(422, "messages_disabled", "This creator has turned off messages");
  // Anonymous tips never store a name.
  const supporterName = isAnonymous ? null : cleanOptional(input.supporterName, { max: TIP_LIMITS.NAME_MAX });
  const referral = cleanSource(input.source);
  const sender = input.senderAddress && /^0x[0-9a-fA-F]{40}$/.test(input.senderAddress) ? lc(input.senderAddress) : null;

  let tipLinkId: string | null = null;
  const slug = typeof input.campaign === "string" ? input.campaign.trim().toLowerCase() : "";
  if (slug && /^[a-z0-9][a-z0-9-]{0,39}$/.test(slug)) {
    const [l] = await sql<{ id: string }>`SELECT id FROM tip_links WHERE creator_id = ${creator.id} AND slug = ${slug} AND is_active`;
    tipLinkId = l?.id ?? null;
  }

  const ref = randomBytes(16).toString("hex");
  const now = clock.now();
  const [row] = await sql<{ id: string }>`
    INSERT INTO tips (creator_id, tip_link_id, source, ref, status, chain_id, token_address, recipient_address,
                      expected_amount_raw, sender_address, supporter_name, supporter_message, is_anonymous,
                      referral_source, expires_at, created_at, updated_at)
    VALUES (${creator.id}, ${tipLinkId}, 'app', ${ref}, 'created', ${MEZO_TESTNET_ID}, ${lc(token.address)}, ${creator.recipientWallet},
            ${amount}, ${sender}, ${supporterName}, ${message}, ${isAnonymous}, ${referral},
            ${addSeconds(now, TIP_LIMITS.INTENT_TTL_SECONDS)}, ${now}, ${now})
    RETURNING id`;
  return {
    tip: await getTipView(sql, row.id),
    payment: {
      chainId: MEZO_TESTNET_ID,
      token: getAddress(token.address),
      tokenSymbol: symbol,
      recipient: getAddress(creator.recipientWallet),
      amountRaw: amount.toString(),
      dataSuffix: tipDataSuffix(ref),
    },
  };
}

// ---------------------------------------------------------------- client-reported transitions

export type PatchTipInput = { status: "awaiting_wallet" } | { status: "failed"; reason: "user_rejected" | "wallet_error" };

/** Only pre-submit, client-observable transitions. Anything else is 409 invalid_transition. */
export async function patchTip(sql: Sql, id: string, input: PatchTipInput): Promise<TipView> {
  const [t] = await sql<Record<string, unknown>>`SELECT status, tx_hash, failure_reason FROM tips WHERE id = ${id}`;
  if (!t) throw notFound("Tip not found");
  if (await expireIfStale(sql, id)) throw conflict("tip_expired", "This tip expired. Start a new one.");
  const status = str(t.status);
  if (input.status === "awaiting_wallet") {
    if (status === "awaiting_wallet") return getTipView(sql, id);
    const r = await sql`UPDATE tips SET status = 'awaiting_wallet', updated_at = ${clock.now()}
                        WHERE id = ${id} AND status = 'created' AND tx_hash IS NULL RETURNING id`;
    if (!r.length) throw conflict("invalid_transition", `Can't move a ${status} tip back to the wallet step`);
  } else {
    if (status === "failed" && str(t.failure_reason) === input.reason) return getTipView(sql, id);
    const r = await sql`UPDATE tips SET status = 'failed', failure_reason = ${input.reason}, updated_at = ${clock.now()}
                        WHERE id = ${id} AND status IN ('created','awaiting_wallet') AND tx_hash IS NULL RETURNING id`;
    if (!r.length) throw conflict("invalid_transition", `Can't mark a ${status} tip as failed`);
  }
  return getTipView(sql, id);
}

// ---------------------------------------------------------------- submit

/** X402Chain view of a ChainAdapter (same live client in production; the test fake in tests). */
export function x402ChainFrom(chain: ChainAdapter): X402Chain {
  return {
    async getReceipt(hash) {
      const r = await chain.getReceipt(hash);
      return r ? { status: r.status, blockNumber: r.blockNumber, blockHash: r.blockHash, logs: r.logs } : null;
    },
    getBlockNumber: () => chain.getBlockNumber(),
    getBlockTimestamp: async (n) => (await chain.getBlock(n)).timestamp,
  };
}

/** Routes a tip to the right verifier: app intents → ./verify, x402 → lib/server/x402/verify. */
export async function verifyAnyTip(sql: Sql, chain: ChainAdapter, id: string): Promise<VerifyOutcome> {
  const [t] = await sql<{ source: string }>`SELECT source FROM tips WHERE id = ${id}`;
  if (t?.source === "x402") {
    await verifyX402Tip(sql, x402ChainFrom(chain), id);
    const [after] = await sql<{ status: string; failure_reason: string | null }>`SELECT status, failure_reason FROM tips WHERE id = ${id}`;
    return { status: after.status as TipStatus, failureReason: after.failure_reason, confirmations: null };
  }
  return verifyTip(sql, chain, id);
}

async function verifyQuietly(sql: Sql, chain: ChainAdapter, id: string): Promise<VerifyOutcome | null> {
  try {
    return await verifyAnyTip(sql, chain, id);
  } catch (e) {
    if (isTransientError(e) || (e instanceof HttpError && e.status === 503)) return null;
    throw e;
  }
}

/**
 * Binds a tx hash to the intent (unique across tips) and runs one inline verification attempt. Re-submitting the
 * same hash is idempotent. A hash bound to another tip → 409 duplicate_tx (after re-verifying that other tip,
 * which releases the hash if it wasn't really its payment).
 *
 * Besides `created`/`awaiting_wallet`, a tip the client itself marked failed (user_rejected | wallet_error) may
 * still be submitted: wallets sometimes report an error after broadcasting. The verifier decides the outcome.
 */
export async function submitTip(
  sql: Sql,
  chain: ChainAdapter,
  id: string,
  txHash: string,
  funding?: { kind: FundingKind; txHash: string } | null,
): Promise<TipView> {
  const hash = lc(txHash);
  if (!/^0x[0-9a-f]{64}$/.test(hash)) throw new HttpError(400, "invalid_tx_hash", "Invalid transaction hash");
  const [t] = await sql<Record<string, unknown>>`SELECT id, status, tx_hash, failure_reason, chain_id FROM tips WHERE id = ${id}`;
  if (!t) throw notFound("Tip not found");

  if (t.tx_hash) {
    if (lc(str(t.tx_hash)) !== hash) throw conflict("tx_already_submitted", "A different transaction was already submitted for this tip");
    if (funding) await recordFundingClaim(sql, id, funding);
    const o = isTerminal(str(t.status)) ? null : await verifyQuietly(sql, chain, id);
    await afterVerify(sql, chain, id, o?.status ?? str(t.status));
    return getTipView(sql, id, o?.confirmations ?? null);
  }
  const status = str(t.status);
  const reopenable = status === "failed" && ["user_rejected", "wallet_error"].includes(str(t.failure_reason));
  if (status === "expired") throw conflict("tip_expired", "This tip expired. Start a new one.");
  if (!["created", "awaiting_wallet"].includes(status) && !reopenable) throw conflict("tip_closed", "This tip can't take a transaction anymore");

  const chainId = int(t.chain_id);
  const [other] = await sql<{ id: string; status: string }>`SELECT id, status FROM tips WHERE chain_id = ${chainId} AND tx_hash = ${hash}`;
  if (other && !isTerminal(other.status)) await verifyQuietly(sql, chain, other.id);
  const [still] = await sql<{ id: string }>`SELECT id FROM tips WHERE chain_id = ${chainId} AND tx_hash = ${hash}`;
  if (still) throw conflict("duplicate_tx", "This transaction is already linked to another tip");

  const now = clock.now();
  let bound: unknown[];
  try {
    bound = await sql`UPDATE tips SET status = 'submitted', tx_hash = ${hash}, submitted_at = ${now}, failure_reason = NULL, updated_at = ${now}
                      WHERE id = ${id} AND tx_hash IS NULL
                        AND (status IN ('created','awaiting_wallet') OR (status = 'failed' AND failure_reason IN ('user_rejected','wallet_error')))
                      RETURNING id`;
  } catch (e) {
    if (isUniqueViolation(e)) throw conflict("duplicate_tx", "This transaction is already linked to another tip");
    throw e;
  }
  if (!bound.length) {
    // Lost a race with a concurrent submit: idempotent if it was the same hash.
    const [again] = await sql<{ tx_hash: string | null }>`SELECT tx_hash FROM tips WHERE id = ${id}`;
    if (lc(again?.tx_hash) !== hash) throw conflict("tip_closed", "This tip can't take a transaction anymore");
  }
  if (funding) await recordFundingClaim(sql, id, funding);
  const o = await verifyQuietly(sql, chain, id);
  await afterVerify(sql, chain, id, o?.status ?? null);
  return getTipView(sql, id, o?.confirmations ?? null);
}

/** Once a tip is confirmed, check its (claimed) Bitcoin funding on chain. Never fails the request. */
async function afterVerify(sql: Sql, chain: ChainAdapter, id: string, status: string | null): Promise<void> {
  if (status !== "confirmed") return;
  const [t] = await sql<{ funding_tx_hash: string | null; funding_verified: boolean }>`
    SELECT funding_tx_hash, funding_verified FROM tips WHERE id = ${id}`;
  if (t?.funding_tx_hash && !t.funding_verified) await verifyFundingQuietly(sql, chain, id);
}

// ---------------------------------------------------------------- read (with throttled re-verify)

export async function readTip(sql: Sql, chain: ChainAdapter, id: string): Promise<TipView> {
  const [t] = await sql<Record<string, unknown>>`SELECT status, last_checked_at FROM tips WHERE id = ${id}`;
  if (!t) throw notFound("Tip not found");
  let confirmations: number | null = null;
  if (str(t.status) === "confirmed") {
    // A funding check can miss once (e.g. the RPC hasn't served the funding tx yet) and nothing else retries it
    // without the background sweep, so a read of a recently confirmed tip retries it (throttled per tip).
    await retryFundingOnRead(sql, chain, id);
  } else if (!isTerminal(str(t.status))) {
    const last = t.last_checked_at ? new Date(t.last_checked_at as string).getTime() : 0;
    if (clock.now().getTime() - last >= REVERIFY_THROTTLE_MS) {
      const o = await verifyQuietly(sql, chain, id);
      confirmations = o?.confirmations ?? null;
      await afterVerify(sql, chain, id, o?.status ?? null);
    }
  }
  return getTipView(sql, id, confirmations);
}

async function retryFundingOnRead(sql: Sql, chain: ChainAdapter, id: string): Promise<void> {
  const now = clock.now().getTime();
  const [f] = await sql<{ id: string }>`
    SELECT id FROM tips
    WHERE id = ${id} AND status = 'confirmed' AND funding_tx_hash IS NOT NULL AND funding_verified = FALSE
      AND verified_at > ${new Date(now - FUNDING_RETRY_WINDOW_MS)}
      AND (last_checked_at IS NULL OR last_checked_at < ${new Date(now - REVERIFY_THROTTLE_MS)})`;
  if (f) await verifyFundingQuietly(sql, chain, id);
}

// ---------------------------------------------------------------- confirmed transfers (indexer / x402)

export interface ConfirmedTransferInput {
  creatorId: string;
  source: Exclude<TipSource, "app">;
  transfer: MusdTransfer;
  /** Token contract that emitted the Transfer (default MUSD). */
  token?: string;
  /** Block timestamp of the transfer. */
  timestamp: Date;
  chainId?: number;
  supporterName?: string | null;
  message?: string | null;
  isAnonymous?: boolean;
  referralSource?: string | null;
}

/**
 * Records an already-verified on-chain MUSD/MEZO transfer as a `confirmed` tip (+ blockchain_events row + creator
 * notification). Callers MUST have verified the transfer on chain (log from the tip token's contract, `to` == creator
 * wallet, enough confirmations). Idempotent: returns the existing tip id if this tx is already recorded.
 */
export async function recordConfirmedTransfer(sql: Sql, input: ConfirmedTransferInput): Promise<{ tipId: string; created: boolean }> {
  const chainId = input.chainId ?? MEZO_TESTNET_ID;
  const t = input.transfer;
  const token = lc(input.token ?? MUSD);
  if (!tipTokenByAddress(token)) throw new Error("recordConfirmedTransfer: not a tip token");
  return sql.begin(async (q) => {
    const now = clock.now();
    const inserted = await q<{ id: string }>`
      INSERT INTO tips (creator_id, source, status, chain_id, token_address, recipient_address, amount_raw, sender_address,
                        tx_hash, log_index, block_number, block_hash, tx_timestamp, supporter_name, supporter_message,
                        is_anonymous, referral_source, verified_at, created_at, updated_at)
      VALUES (${input.creatorId}, ${input.source}, 'confirmed', ${chainId}, ${token}, ${t.to}, ${t.value}, ${t.from},
              ${t.txHash}, ${t.logIndex}, ${t.blockNumber}, ${t.blockHash}, ${input.timestamp},
              ${input.isAnonymous ? null : cleanOptional(input.supporterName, { max: TIP_LIMITS.NAME_MAX })},
              ${cleanOptional(input.message, { max: TIP_LIMITS.MESSAGE_MAX, multiline: true })},
              ${Boolean(input.isAnonymous)}, ${input.referralSource ?? null}, ${now}, ${now}, ${now})
      ON CONFLICT DO NOTHING
      RETURNING id`;
    if (!inserted.length) {
      const [existing] = await q<{ id: string }>`SELECT id FROM tips WHERE chain_id = ${chainId} AND tx_hash = ${t.txHash}`;
      if (!existing) throw new Error("recordConfirmedTransfer: conflict without an existing tip");
      return { tipId: existing.id, created: false };
    }
    const tipId = inserted[0].id;
    await upsertEvent(q, chainId, t, tipId, token);
    await notifyTipReceived(q, tipId);
    return { tipId, created: true };
  });
}

// ---------------------------------------------------------------- sweep

export interface SweepResult {
  expired: number;
  checked: number;
  confirmed: number;
  failed: number;
  /** Bitcoin-funding claims checked / verified in this sweep. */
  fundingChecked?: number;
  fundingVerified?: number;
}

/**
 * Expires unsubmitted intents past expires_at and re-verifies submitted / pending tips (which also applies the
 * SUBMITTED_TIMEOUT → failed/timeout rule). Bounded per call.
 */
export async function sweepTips(sql: Sql, chain: ChainAdapter, opts: { limit?: number } = {}): Promise<SweepResult> {
  const now = clock.now();
  const expired = await sql`UPDATE tips SET status = 'expired', updated_at = ${now}
                            WHERE status IN ('created','awaiting_wallet') AND tx_hash IS NULL AND expires_at < ${now} RETURNING id`;
  const res: SweepResult = { expired: expired.length, checked: 0, confirmed: 0, failed: 0 };
  const due = await sql<{ id: string }>`
    SELECT id FROM tips WHERE source = 'app' AND status IN ('submitted','pending_confirmation')
      AND (last_checked_at IS NULL OR last_checked_at < ${new Date(now.getTime() - REVERIFY_THROTTLE_MS)})
    ORDER BY last_checked_at ASC NULLS FIRST LIMIT ${opts.limit ?? 50}`;
  for (const { id } of due) {
    const o = await verifyQuietly(sql, chain, id);
    res.checked++;
    if (o?.status === "confirmed") res.confirmed++;
    if (o?.status === "failed") res.failed++;
  }
  // x402 tips stuck in submitted / pending_confirmation (Agent X's verifier).
  const x = await sweepPendingX402Tips(sql, x402ChainFrom(chain));
  res.checked += x.checked;
  res.confirmed += x.confirmed;
  res.failed += x.failed;
  // Funding claims on recently confirmed tips that aren't verified yet (e.g. the funding tx was slow to index).
  const f = await sweepFunding(sql, chain);
  res.fundingChecked = f.checked;
  res.fundingVerified = f.verified;
  return res;
}

