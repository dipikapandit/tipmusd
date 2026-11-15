// DB side of the x402 rail: creator lookup, recording a settled tip, confirming pending ones, TipView mapping.
// Schema is frozen (lib/server/db/schema.sql); x402 rows use source = 'x402' and carry no `ref`.
import { formatUnits, getAddress } from "viem";
import type { TipView, TipStatus } from "@/lib/api-types";
import { MEZO_TESTNET_ID, MUSD, MUSD_DECIMALS, explorerTx } from "@/lib/chain/config";
import type { Sql } from "../db";
import { clock } from "../clock";
import { env } from "../env";
import type { X402TipQuery } from "./validate";
import type { SettlementCheck } from "./verify";

export interface X402Creator {
  id: string;
  userId: string;
  username: string;
  displayName: string;
  /** lowercase, from the DB, never from the request */
  recipientWallet: string;
  thankYouMessage: string;
  messagesEnabled: boolean;
  anonymousTipsEnabled: boolean;
}

interface CreatorRow {
  id: string;
  user_id: string;
  username: string;
  display_name: string;
  recipient_wallet: string;
  thank_you_message: string;
  messages_enabled: boolean;
  anonymous_tips_enabled: boolean;
}

const toCreator = (r: CreatorRow): X402Creator => ({
  id: r.id,
  userId: r.user_id,
  username: r.username,
  displayName: r.display_name,
  recipientWallet: String(r.recipient_wallet).toLowerCase(),
  thankYouMessage: r.thank_you_message ?? "",
  messagesEnabled: r.messages_enabled === true,
  anonymousTipsEnabled: r.anonymous_tips_enabled === true,
});

/** Active creator by current username, or by a retired alias (same person). Suspended → null. */
export async function findX402Creator(sql: Sql, username: string): Promise<X402Creator | null> {
  const [direct] = await sql<CreatorRow>`
    SELECT id, user_id, username, display_name, recipient_wallet, thank_you_message, messages_enabled, anonymous_tips_enabled
    FROM creator_profiles WHERE username = ${username} AND status = 'active'`;
  if (direct) return toCreator(direct);
  const [alias] = await sql<CreatorRow>`
    SELECT cp.id, cp.user_id, cp.username, cp.display_name, cp.recipient_wallet, cp.thank_you_message,
           cp.messages_enabled, cp.anonymous_tips_enabled
    FROM username_aliases a JOIN creator_profiles cp ON cp.id = a.creator_id
    WHERE a.username = ${username} AND cp.status = 'active'`;
  return alias ? toCreator(alias) : null;
}

/** What actually gets stored for name/message/anonymity, honouring the creator's settings. */
export function effectiveSupporterFields(creator: X402Creator, q: Pick<X402TipQuery, "name" | "message" | "anonymous">) {
  const isAnonymous = q.anonymous && creator.anonymousTipsEnabled;
  return {
    supporterName: isAnonymous ? null : q.name,
    message: creator.messagesEnabled ? q.message : null,
    isAnonymous,
  };
}

export interface RecordInput {
  creator: X402Creator;
  query: X402TipQuery;
  txHash: string;
  payer: string;
  check: Extract<SettlementCheck, { kind: "confirmed" } | { kind: "pending" }>;
}

export interface RecordResult {
  tipId: string;
  /** true when the tx was already recorded (indexer won the race, or a retried request) and we linked to it. */
  linked: boolean;
}

/**
 * Inserts the x402 tip for a settled payment. Unique (chain_id, tx_hash): if the indexer (or an earlier identical
 * request) already recorded this tx we link to that row instead, and upgrade an indexer row with the supporter's
 * name/message (we just proved this tx is the payment for this request).
 */
export async function recordX402Tip(sql: Sql, input: RecordInput): Promise<RecordResult> {
  const { creator, query, check } = input;
  const txHash = input.txHash.toLowerCase();
  const payer = input.payer.toLowerCase();
  const now = clock.now();
  const confirmed = check.kind === "confirmed";
  const status: TipStatus = confirmed ? "confirmed" : "pending_confirmation";
  const fields = effectiveSupporterFields(creator, query);
  const transfer = check.transfer;

  return sql.begin(async (tx) => {
    const inserted = await tx<{ id: string }>`
      INSERT INTO tips (
        creator_id, source, status, chain_id, token_address, recipient_address, expected_amount_raw, amount_raw,
        sender_address, tx_hash, log_index, block_number, block_hash, tx_timestamp,
        supporter_name, supporter_message, is_anonymous, referral_source,
        verify_attempts, last_checked_at, submitted_at, verified_at, created_at, updated_at
      ) VALUES (
        ${creator.id}, 'x402', ${status}, ${MEZO_TESTNET_ID}, ${MUSD.toLowerCase()}, ${creator.recipientWallet},
        ${query.amountRaw}, ${confirmed ? transfer!.value : null},
        ${payer}, ${txHash}, ${transfer ? transfer.logIndex : null}, ${check.blockNumber ?? null},
        ${check.blockHash ?? null}, ${confirmed ? check.timestamp : null},
        ${fields.supporterName}, ${fields.message}, ${fields.isAnonymous}, 'x402',
        1, ${now}, ${now}, ${confirmed ? now : null}, ${now}, ${now}
      )
      ON CONFLICT (chain_id, tx_hash) WHERE tx_hash IS NOT NULL DO NOTHING
      RETURNING id`;

    let tipId: string;
    let linked = false;
    if (inserted[0]) {
      tipId = inserted[0].id;
    } else {
      const [existing] = await tx<{ id: string; creator_id: string; source: string }>`
        SELECT id, creator_id, source FROM tips WHERE chain_id = ${MEZO_TESTNET_ID} AND tx_hash = ${txHash}`;
      if (!existing) throw new Error("x402: tx hash conflict but no existing tip row");
      tipId = existing.id;
      linked = true;
      if (existing.source === "indexer" && existing.creator_id === creator.id) {
        // Indexer recorded the bare transfer first; attach the paid request's metadata.
        await tx`
          UPDATE tips SET source = 'x402',
            supporter_name = COALESCE(supporter_name, ${fields.supporterName}),
            supporter_message = COALESCE(supporter_message, ${fields.message}),
            is_anonymous = ${fields.isAnonymous},
            referral_source = COALESCE(referral_source, 'x402'),
            expected_amount_raw = COALESCE(expected_amount_raw, ${query.amountRaw}),
            updated_at = ${now}
          WHERE id = ${tipId}`;
      }
    }

    if (confirmed) await linkEventAndNotify(tx, tipId, creator.userId, check, txHash);
    return { tipId, linked };
  });
}

async function linkEventAndNotify(
  tx: Sql,
  tipId: string,
  creatorUserId: string,
  check: Extract<SettlementCheck, { kind: "confirmed" }>,
  txHash: string,
): Promise<void> {
  const t = check.transfer;
  await tx`
    INSERT INTO blockchain_events (chain_id, transaction_hash, log_index, block_number, block_hash, contract_address,
                                   event_name, from_address, to_address, value_raw, tip_id)
    VALUES (${MEZO_TESTNET_ID}, ${txHash}, ${t.logIndex}, ${check.blockNumber}, ${check.blockHash}, ${MUSD.toLowerCase()},
            'Transfer', ${t.from}, ${t.to}, ${t.value}, ${tipId})
    ON CONFLICT (chain_id, transaction_hash, log_index) DO NOTHING`;
  await tx`
    UPDATE blockchain_events SET tip_id = ${tipId}
    WHERE chain_id = ${MEZO_TESTNET_ID} AND transaction_hash = ${txHash} AND log_index = ${t.logIndex} AND tip_id IS NULL`;
  const amount = formatUnits(t.value, MUSD_DECIMALS);
  await tx`
    INSERT INTO notifications (user_id, type, title, message, tip_id)
    VALUES (${creatorUserId}, 'tip_received', ${`You received ${amount} MUSD`}, ${"Paid by an agent or script via x402."}, ${tipId})
    ON CONFLICT (user_id, type, tip_id) WHERE tip_id IS NOT NULL DO NOTHING`;
}

/** pending_confirmation → confirmed (conditional, idempotent). */
export async function confirmPendingX402Tip(sql: Sql, tipId: string, check: Extract<SettlementCheck, { kind: "confirmed" }>): Promise<boolean> {
  const now = clock.now();
  return sql.begin(async (tx) => {
    const rows = await tx<{ id: string; tx_hash: string; user_id: string }>`
      UPDATE tips t SET status = 'confirmed', failure_reason = NULL,
        amount_raw = ${check.transfer.value}, sender_address = ${check.transfer.from}, log_index = ${check.transfer.logIndex},
        block_number = ${check.blockNumber}, block_hash = ${check.blockHash}, tx_timestamp = ${check.timestamp},
        verified_at = ${now}, last_checked_at = ${now}, verify_attempts = t.verify_attempts + 1, updated_at = ${now}
      FROM creator_profiles cp
      WHERE t.id = ${tipId} AND cp.id = t.creator_id AND t.status NOT IN ('confirmed', 'failed', 'expired')
      RETURNING t.id, t.tx_hash, cp.user_id`;
    if (!rows[0]) return false;
    await linkEventAndNotify(tx, tipId, rows[0].user_id, check, rows[0].tx_hash);
    return true;
  });
}

export async function failPendingX402Tip(sql: Sql, tipId: string, reason: string): Promise<void> {
  const now = clock.now();
  await sql`
    UPDATE tips SET status = 'failed', failure_reason = ${reason}, last_checked_at = ${now},
      verify_attempts = verify_attempts + 1, updated_at = ${now}
    WHERE id = ${tipId} AND status NOT IN ('confirmed', 'failed', 'expired')`;
}

export async function touchPendingX402Tip(sql: Sql, tipId: string): Promise<void> {
  const now = clock.now();
  await sql`
    UPDATE tips SET last_checked_at = ${now}, verify_attempts = verify_attempts + 1, updated_at = ${now}
    WHERE id = ${tipId} AND status NOT IN ('confirmed', 'failed', 'expired')`;
}

// ------------------------------------------------------------------ TipView

interface TipViewRow {
  id: string;
  status: TipStatus;
  failure_reason: string | null;
  source: TipView["source"];
  amount_raw: unknown;
  expected_amount_raw: unknown;
  recipient_address: string;
  sender_address: string | null;
  tx_hash: string | null;
  block_number: unknown;
  supporter_name: string | null;
  supporter_message: string | null;
  is_anonymous: boolean;
  created_at: unknown;
  verified_at: unknown;
  expires_at: unknown;
  username: string;
  display_name: string;
  thank_you_message: string;
}

const decStr = (v: unknown): string | null => (v === null || v === undefined ? null : String(v).split(".")[0]);
const isoStr = (v: unknown): string | null => (v === null || v === undefined ? null : new Date(v as string).toISOString());
const checksumOrNull = (a: string | null) => {
  if (!a) return null;
  try {
    return getAddress(a);
  } catch {
    return a;
  }
};

export async function loadX402TipView(sql: Sql, tipId: string, head?: bigint | null): Promise<TipView | null> {
  const [r] = await sql<TipViewRow>`
    SELECT t.id, t.status, t.failure_reason, t.source, t.amount_raw, t.expected_amount_raw, t.recipient_address,
           t.sender_address, t.tx_hash, t.block_number, t.supporter_name, t.supporter_message, t.is_anonymous,
           t.created_at, t.verified_at, t.expires_at, cp.username, cp.display_name, cp.thank_you_message
    FROM tips t JOIN creator_profiles cp ON cp.id = t.creator_id
    WHERE t.id = ${tipId}`;
  if (!r) return null;
  const block = r.block_number === null || r.block_number === undefined ? null : BigInt(String(r.block_number));
  const confirmations = block !== null && head ? (head >= block ? Number(head - block + 1n) : 0) : null;
  const confirmed = r.status === "confirmed";
  return {
    id: r.id,
    token: "MUSD", // x402 is MUSD-only
    funding: null,
    creatorUsername: r.username,
    creatorDisplayName: r.display_name,
    status: r.status,
    failureReason: r.failure_reason,
    source: r.source,
    amountRaw: confirmed ? decStr(r.amount_raw) : null,
    expectedAmountRaw: decStr(r.expected_amount_raw),
    recipientAddress: checksumOrNull(r.recipient_address) ?? r.recipient_address,
    senderAddress: checksumOrNull(r.sender_address),
    txHash: r.tx_hash,
    blockNumber: block === null ? null : block.toString(),
    confirmations,
    requiredConfirmations: env.confirmations(),
    explorerUrl: r.tx_hash ? explorerTx(r.tx_hash) : null,
    supporterName: r.is_anonymous ? null : r.supporter_name,
    message: r.supporter_message,
    isAnonymous: r.is_anonymous === true,
    thankYouMessage: confirmed ? r.thank_you_message || null : null,
    createdAt: isoStr(r.created_at)!,
    verifiedAt: isoStr(r.verified_at),
    expiresAt: isoStr(r.expires_at),
  };
}
