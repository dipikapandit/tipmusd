// Tip-token Transfer indexer (docs/ARCHITECTURE.md "Indexer" + v2).
//
// For each tip token (MUSD, MEZO — one cursor each: `musd_transfers`, `mezo_transfers`) scans that token's
// `Transfer` logs in ≤ MAX_LOG_RANGE block chunks from its cursor, up to the
// confirmed head (head − CONFIRMATIONS + 1), keeping only transfers to creator wallets (current + history).
// For each such transfer:
//   1. a tip already bound to that tx hash → run the verifier on it (it may confirm it, or release the hash);
//   2. else, if the tx calldata carries our ref suffix and that intent is still open → bind the hash, verify;
//   3. else record it as a `confirmed` tip with source 'indexer' (no name/message), attributed to the creator
//      whose wallet window (creator_wallets) covers the block time.
// Everything is idempotent (blockchain_events unique on tx+log, tips unique on tx hash), so re-running a range
// is harmless. The cursor stores the block hash; if it no longer matches the chain, REORG_WINDOW blocks are
// rewound (indexer tips in the window are dropped, app tips go back to `submitted` to be re-verified).
//
// Concurrency: one pass at a time — an in-process flag plus, on Postgres, a transaction-scoped advisory lock
// around each chunk (web instances, the worker and cron can all call this safely).

import type { Address, Hex } from "viem";
import type { SyncResult } from "@/lib/api-types";
import { MEZO_TESTNET_ID, TIP_TOKENS, type TipTokenSymbol } from "@/lib/chain/config";
import { decodeTokenTransfer, MAX_LOG_RANGE, type ChainAdapter, type MusdTransfer } from "./chain";
import { clock } from "./clock";
import type { Sql } from "./db";
import { big } from "./db/rows";
import { env } from "./env";
import { minRawFor } from "./money";
import { recordConfirmedTransfer, verifyAnyTip } from "./tips";
import { sweepFunding } from "./funding";
import { embeddedRefs, isTerminal, refFromCalldata, upsertEvent, verifyTip } from "./verify";

export const CURSOR = "musd_transfers";
export const MEZO_CURSOR = "mezo_transfers";
/** Indexed tokens and their cursors (order = scan order). A token's logs only ever count for tips of that token. */
export const INDEXED_TOKENS: readonly { symbol: TipTokenSymbol; cursor: string }[] = [
  { symbol: "MUSD", cursor: CURSOR },
  { symbol: "MEZO", cursor: MEZO_CURSOR },
];
const CATCHUP_ROW = "catchup_throttle";
const LOCK_KEY = 31611002;
/** Session-triggered catch-up: at most once per this many seconds (globally), over at most this many blocks. */
export const CATCHUP_INTERVAL_SEC = 15;
export const CATCHUP_MAX_BLOCKS = 4000n;
/** Max wallets passed to eth_getLogs as a topic OR-filter (beyond that, filter locally only). */
const MAX_TOPIC_WALLETS = 500;
/** An old payout wallet still attributes transfers to its creator for this long after a change. */
const WALLET_GRACE_MS = 30 * 60 * 1000;
const CLOCK_SKEW_MS = 120 * 1000;

const lc = (s: string | null | undefined) => (s ?? "").toLowerCase();
const LOCKED = Symbol("locked");

let running = false;

// ---------------------------------------------------------------- cursor

export async function getCursor(sql: Sql, name: string = CURSOR): Promise<{ block: bigint; hash: string | null } | null> {
  const [row] = await sql<{ block_number: unknown; block_hash: string | null }>`
    SELECT block_number, block_hash FROM indexer_cursors WHERE name = ${name}`;
  return row ? { block: big(row.block_number), hash: row.block_hash } : null;
}

async function ensureCursor(sql: Sql, name: string, head: bigint): Promise<{ block: bigint; hash: string | null }> {
  const existing = await getCursor(sql, name);
  if (existing) return existing;
  const boot = env.indexerBootstrapBlocks();
  const start = env.indexerStartBlock() ?? (head > boot ? head - boot : 0n);
  const block = start > 0n ? start - 1n : 0n;
  await sql`INSERT INTO indexer_cursors (name, block_number, block_hash, updated_at) VALUES (${name}, ${block}, NULL, ${clock.now()})
            ON CONFLICT (name) DO NOTHING`;
  return (await getCursor(sql, name))!;
}

async function setCursor(sql: Sql, name: string, block: bigint, hash: string | null) {
  await sql`UPDATE indexer_cursors SET block_number = ${block}, block_hash = ${hash ? lc(hash) : null}, updated_at = ${clock.now()}
            WHERE name = ${name}`;
}

/** The least advanced token cursor (what "indexed up to" honestly means across tokens). */
export async function indexerStatus(sql: Sql): Promise<{ lastBlock: bigint | null; updatedAt: Date | null }> {
  const rows = await sql<{ block_number: unknown; updated_at: Date }>`
    SELECT block_number, updated_at FROM indexer_cursors WHERE name IN (${CURSOR}, ${MEZO_CURSOR}) ORDER BY block_number ASC`;
  const row = rows[0];
  return row ? { lastBlock: big(row.block_number), updatedAt: new Date(row.updated_at) } : { lastBlock: null, updatedAt: null };
}

// ---------------------------------------------------------------- reorg

/**
 * Rewinds the index to `toBlock` (the new cursor): drops indexer tips and raw events above it and sends app
 * tips confirmed above it back to `submitted` so the verifier re-checks them against the canonical chain.
 */
export async function rewindTo(sql: Sql, chain: ChainAdapter, toBlock: bigint): Promise<void> {
  const target = toBlock < 0n ? 0n : toBlock;
  const now = clock.now();
  await sql.begin(async (q) => {
    await q`DELETE FROM tips WHERE source = 'indexer' AND block_number > ${target}`;
    await q`UPDATE tips SET status = 'submitted', amount_raw = NULL, log_index = NULL, block_number = NULL, block_hash = NULL,
              tx_timestamp = NULL, verified_at = NULL, last_checked_at = NULL, updated_at = ${now}
            WHERE source = 'app' AND status IN ('confirmed','pending_confirmation') AND block_number > ${target}`;
    await q`DELETE FROM blockchain_events WHERE block_number > ${target}`;
  });
  // Every token cursor ahead of the rewind point goes back with it (the deletes above are token-agnostic).
  const b = await chain.getBlock(target);
  for (const { cursor } of INDEXED_TOKENS) {
    const c = await getCursor(sql, cursor);
    if (c && c.block > target) await setCursor(sql, cursor, target, b.hash);
  }
}

// ---------------------------------------------------------------- attribution

/** Creator whose wallet window covers `at` (exact window first, then the post-change grace period). */
export async function attributeWallet(sql: Sql, wallet: string, at: Date): Promise<string | null> {
  const rows = await sql<{ creator_id: string; from_time: Date; to_time: Date | null }>`
    SELECT creator_id, from_time, to_time FROM creator_wallets WHERE wallet = ${lc(wallet)} ORDER BY from_time DESC`;
  const t = at.getTime();
  const from = (r: { from_time: Date }) => new Date(r.from_time).getTime() - CLOCK_SKEW_MS;
  const to = (r: { to_time: Date | null }) => (r.to_time ? new Date(r.to_time).getTime() : Infinity);
  const exact = rows.find((r) => from(r) <= t && t < to(r));
  if (exact) return exact.creator_id;
  const grace = rows.find((r) => from(r) <= t && t < to(r) + WALLET_GRACE_MS);
  return grace?.creator_id ?? null;
}

// ---------------------------------------------------------------- per-transfer handling

type Outcome = "confirmed" | "known" | "pending" | "ignored";

async function handleTransfer(
  sql: Sql,
  chain: ChainAdapter,
  symbol: TipTokenSymbol,
  t: MusdTransfer,
  blockTime: (n: bigint) => Promise<Date>,
): Promise<Outcome> {
  const chainId = MEZO_TESTNET_ID;
  const token = lc(TIP_TOKENS[symbol].address);
  await upsertEvent(sql, chainId, t, null, token);
  const [ev] = await sql<{ tip_id: string | null }>`
    SELECT tip_id FROM blockchain_events WHERE chain_id = ${chainId} AND transaction_hash = ${t.txHash} AND log_index = ${t.logIndex}`;
  if (ev?.tip_id) return "known";

  // 1. A tip already claims this tx hash.
  const [byHash] = await sql<{ id: string; status: string; token_address: string }>`
    SELECT id, status, token_address FROM tips WHERE chain_id = ${chainId} AND tx_hash = ${t.txHash}`;
  if (byHash) {
    if (!isTerminal(byHash.status)) await verifyAnyTip(sql, chain, byHash.id);
    const [now] = await sql<{ status: string; tx_hash: string | null; log_index: number | null }>`SELECT status, tx_hash, log_index FROM tips WHERE id = ${byHash.id}`;
    if (now?.tx_hash) {
      if (now.status === "confirmed") {
        // Only a log of the tip's own token is that tip's event.
        if (lc(byHash.token_address) === token && (now.log_index === null || Number(now.log_index) === t.logIndex))
          await upsertEvent(sql, chainId, t, byHash.id, token);
        return lc(byHash.token_address) === token ? "confirmed" : "known";
      }
      return now.status === "failed" ? "ignored" : "pending"; // still bound: one tip per tx
    }
    // released by the verifier (not that intent's payment): fall through
  }

  // 2. The calldata names one of our intents via its ref suffix.
  const tx = await chain.getTransaction(t.txHash as Hex);
  // Plain wallets call the token directly; Mezo Passport smart accounts nest the transfer (suffix included) in their tx.
  const refs = !tx ? [] : lc(tx.to) === token ? [refFromCalldata(tx.input)].filter((r): r is string => Boolean(r)) : embeddedRefs(tx.input);
  for (const ref of refs) {
    const [intent] = await sql<{ id: string }>`SELECT id FROM tips WHERE ref = ${ref}`;
    if (intent) {
      const bound = await sql`UPDATE tips SET status = 'submitted', tx_hash = ${t.txHash}, submitted_at = ${clock.now()}, failure_reason = NULL,
                                updated_at = ${clock.now()}
                              WHERE id = ${intent.id} AND tx_hash IS NULL
                                AND (status IN ('created','awaiting_wallet') OR (status = 'failed' AND failure_reason IN ('user_rejected','wallet_error')))
                                AND NOT EXISTS (SELECT 1 FROM tips o WHERE o.chain_id = ${chainId} AND o.tx_hash = ${t.txHash})
                              RETURNING id`;
      if (bound.length) {
        const o = await verifyTip(sql, chain, intent.id);
        if (o.status === "confirmed") return "confirmed";
        const [after] = await sql<{ tx_hash: string | null; status: string }>`SELECT tx_hash, status FROM tips WHERE id = ${intent.id}`;
        if (after?.tx_hash) return after.status === "failed" ? "ignored" : "pending";
      }
    }
  }

  // 3. Unknown transfer to a creator wallet → indexer tip (dust below the tip minimum is ignored).
  if (t.value < minRawFor(symbol)) return "ignored";
  const at = await blockTime(t.blockNumber);
  const creatorId = await attributeWallet(sql, t.to, at);
  if (!creatorId) return "ignored";
  const r = await recordConfirmedTransfer(sql, { creatorId, source: "indexer", transfer: t, token, timestamp: at, chainId });
  return r.created ? "confirmed" : "known";
}

// ---------------------------------------------------------------- pass

interface ChunkResult {
  from: bigint;
  to: bigint;
  events: number;
  confirmed: number;
  /** Blocks scanned by this chunk (0 for a rewind or when caught up). */
  scanned: bigint;
  done: boolean;
}

async function processChunk(
  sql: Sql,
  chain: ChainAdapter,
  tok: (typeof INDEXED_TOKENS)[number],
  head: bigint,
  safeHead: bigint,
  budget: bigint,
): Promise<ChunkResult> {
  const cursor = await ensureCursor(sql, tok.cursor, head);
  if (cursor.hash) {
    const live = await chain.getBlock(cursor.block);
    if (lc(live.hash) !== lc(cursor.hash)) {
      await rewindTo(sql, chain, cursor.block - BigInt(env.reorgWindow()));
      return { from: cursor.block, to: cursor.block, events: 0, confirmed: 0, scanned: 0n, done: false };
    }
  }
  const from = cursor.block + 1n;
  if (from > safeHead || budget <= 0n) return { from: cursor.block, to: cursor.block, events: 0, confirmed: 0, scanned: 0n, done: true };
  let to = from + MAX_LOG_RANGE - 1n;
  if (to > safeHead) to = safeHead;
  if (to > from + budget - 1n) to = from + budget - 1n;

  const wallets = (await sql<{ wallet: string }>`SELECT DISTINCT wallet FROM creator_wallets`).map((w) => lc(w.wallet));
  const walletSet = new Set(wallets);
  let events = 0;
  let confirmed = 0;
  if (wallets.length) {
    const tokenAddress = TIP_TOKENS[tok.symbol].address;
    const raw = await chain.getLogs({
      fromBlock: from,
      toBlock: to,
      token: tokenAddress,
      to: wallets.length <= MAX_TOPIC_WALLETS ? (wallets as Address[]) : undefined,
    });
    const transfers = raw
      .map((l) => decodeTokenTransfer(l, tokenAddress)) // a log of any other contract is dropped here
      .filter((x): x is MusdTransfer => x !== null && walletSet.has(x.to))
      .sort((a, b) => (a.blockNumber === b.blockNumber ? a.logIndex - b.logIndex : a.blockNumber < b.blockNumber ? -1 : 1));
    const times = new Map<bigint, Date>();
    const blockTime = async (n: bigint) => {
      let d = times.get(n);
      if (!d) {
        d = new Date(Number((await chain.getBlock(n)).timestamp) * 1000);
        times.set(n, d);
      }
      return d;
    };
    for (const t of transfers) {
      events++;
      if ((await handleTransfer(sql, chain, tok.symbol, t, blockTime)) === "confirmed") confirmed++;
    }
  }
  const end = await chain.getBlock(to);
  await setCursor(sql, tok.cursor, to, end.hash);
  return { from, to, events, confirmed, scanned: to - from + 1n, done: to >= safeHead || to - from + 1n >= budget };
}

/** Runs `fn` under the indexer lock. Postgres: transaction-scoped advisory lock (returns LOCKED if busy). */
async function withLock<T>(sql: Sql, fn: (q: Sql) => Promise<T>): Promise<T | typeof LOCKED> {
  if (sql.kind !== "postgres") return fn(sql); // PGlite: single process, guarded by `running`
  return sql.begin(async (q) => {
    const [r] = await q<{ ok: boolean }>`SELECT pg_try_advisory_xact_lock(${LOCK_KEY}) AS ok`;
    if (!r?.ok) return LOCKED;
    return fn(q);
  });
}

/**
 * One indexer pass over at most `maxBlocks` blocks (default INDEXER_MAX_BLOCKS). Returns `skipped: "locked"` if
 * another pass is running.
 */
export async function runIndexerPass(sql: Sql, chain: ChainAdapter, opts: { maxBlocks?: bigint } = {}): Promise<SyncResult> {
  if (running) return { fromBlock: "0", toBlock: "0", events: 0, confirmed: 0, skipped: "locked" };
  running = true;
  try {
    const chainId = await chain.chainId();
    if (chainId !== MEZO_TESTNET_ID) throw new Error(`indexer: RPC is on chain ${chainId}, expected ${MEZO_TESTNET_ID}`);
    const head = await chain.getBlockNumber();
    const safeHead = head - BigInt(env.confirmations() - 1);
    // Each token is scanned from its own cursor with the full block budget; the result reports the range
    // every token has reached (lowest from / lowest to).
    let fromAll: bigint | null = null;
    let toAll: bigint | null = null;
    let events = 0;
    let confirmed = 0;
    for (const tok of INDEXED_TOKENS) {
      let budget = opts.maxBlocks ?? env.indexerMaxBlocks();
      let first: bigint | null = null;
      let last: bigint | null = null;
      for (let guard = 0; guard < 1000; guard++) {
        const r = await withLock(sql, (q) => processChunk(q, chain, tok, head, safeHead, budget));
        if (r === LOCKED) {
          const c = await getCursor(sql, tok.cursor);
          const b = (c?.block ?? 0n).toString();
          return { fromBlock: (fromAll ?? first)?.toString() ?? b, toBlock: (toAll ?? last)?.toString() ?? b, events, confirmed, skipped: "locked" };
        }
        if (r.scanned > 0n) {
          if (first === null) first = r.from;
          budget -= r.scanned;
        }
        last = r.to;
        events += r.events;
        confirmed += r.confirmed;
        if (r.done) break;
      }
      if (first !== null && (fromAll === null || first < fromAll)) fromAll = first;
      if (last !== null && (toAll === null || last < toAll)) toAll = last;
    }
    const b = (toAll ?? 0n).toString();
    return { fromBlock: fromAll?.toString() ?? b, toBlock: b, events, confirmed };
  } finally {
    running = false;
  }
}

/**
 * Claims the global catch-up slot (≤ once per CATCHUP_INTERVAL_SEC across all instances). Atomic upsert on a
 * reserved indexer_cursors row; returns false when throttled.
 */
export async function claimCatchupSlot(sql: Sql): Promise<boolean> {
  const now = clock.now();
  const cutoff = new Date(now.getTime() - CATCHUP_INTERVAL_SEC * 1000);
  const rows = await sql`
    INSERT INTO indexer_cursors (name, block_number, block_hash, updated_at) VALUES (${CATCHUP_ROW}, 0, NULL, ${now})
    ON CONFLICT (name) DO UPDATE SET updated_at = EXCLUDED.updated_at WHERE indexer_cursors.updated_at < ${cutoff}
    RETURNING name`;
  return rows.length > 0;
}

/** Signed-in creator's dashboard catch-up: throttled globally, bounded blocks. */
export async function runCatchup(sql: Sql, chain: ChainAdapter): Promise<SyncResult> {
  if (!(await claimCatchupSlot(sql))) {
    const c = await getCursor(sql);
    const b = (c?.block ?? 0n).toString();
    return { fromBlock: b, toBlock: b, events: 0, confirmed: 0, skipped: "throttled" };
  }
  const r = await runIndexerPass(sql, chain, { maxBlocks: CATCHUP_MAX_BLOCKS });
  // Without a hosted worker, the dashboard's catch-up is also when missed funding checks get retried.
  await sweepFunding(sql, chain, { limit: 10 }).catch(() => undefined);
  return r;
}

