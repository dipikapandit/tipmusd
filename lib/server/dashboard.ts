// Creator dashboard data. Money figures only ever count `confirmed` tips.
import { getAddress } from "viem";
import type { Analytics, DashboardOverview, DashboardTip, TipSource, TipStatus, TipsPage } from "@/lib/api-types";
import { MEZO_TOKEN, MUSD, explorerTx } from "@/lib/chain/config";
import type { Session } from "./auth";
import type { ChainAdapter } from "./chain";
import { clock } from "./clock";
import type { Fragment, Sql } from "./db";
import { big, bool, dec, int, iso, str, strOrNull } from "./db/rows";
import { HttpError } from "./errors";
import { indexerStatus } from "./indexer";
import { requireProfileRow, toCreatorProfile } from "./profiles";
import { fundingOf, tokenOf } from "./tokens";

const MUSD_LC = MUSD.toLowerCase();
const MEZO_LC = MEZO_TOKEN.toLowerCase();

const TS = "COALESCE(t.tx_timestamp, t.created_at)";

function toDashboardTip(r: Record<string, unknown>): DashboardTip {
  const anon = bool(r.is_anonymous);
  const hash = strOrNull(r.tx_hash);
  return {
    id: str(r.id),
    token: tokenOf(r.token_address),
    funding: fundingOf(r),
    status: str(r.status) as TipStatus,
    failureReason: strOrNull(r.failure_reason),
    source: str(r.source) as TipSource,
    amountRaw: r.amount_raw === null || r.amount_raw === undefined ? null : dec(r.amount_raw),
    expectedAmountRaw: r.expected_amount_raw === null || r.expected_amount_raw === undefined ? null : dec(r.expected_amount_raw),
    // Anonymous: no name and no address, even for the creator (the address is still on the public explorer).
    senderAddress: anon || !r.sender_address ? null : getAddress(str(r.sender_address)),
    recipientAddress: getAddress(str(r.recipient_address)),
    supporterName: anon ? null : strOrNull(r.supporter_name),
    message: strOrNull(r.supporter_message),
    isAnonymous: anon,
    campaign: strOrNull(r.campaign),
    referralSource: strOrNull(r.referral_source),
    txHash: hash,
    explorerUrl: hash ? explorerTx(hash) : null,
    blockNumber: r.block_number === null || r.block_number === undefined ? null : String(r.block_number),
    timestamp: iso(r.ts),
  };
}

const tipSelect = (sql: Sql) => sql.frag`
  SELECT t.*, l.slug AS campaign, ${sql.raw(TS)} AS ts FROM tips t LEFT JOIN tip_links l ON l.id = t.tip_link_id`;

export async function getOverview(sql: Sql, chain: ChainAdapter | null, session: Session): Promise<DashboardOverview> {
  const p = await requireProfileRow(sql, session.userId);
  const [tot] = await sql<Record<string, unknown>>`
    SELECT COALESCE(sum(amount_raw) FILTER (WHERE status = 'confirmed' AND token_address = ${MUSD_LC}), 0) AS confirmed_raw,
           COALESCE(sum(amount_raw) FILTER (WHERE status = 'confirmed' AND token_address = ${MEZO_LC}), 0) AS confirmed_mezo_raw,
           count(*) FILTER (WHERE status = 'confirmed' AND funding_verified)::int AS funded,
           count(*) FILTER (WHERE status = 'confirmed')::int AS tips,
           count(DISTINCT sender_address) FILTER (WHERE status = 'confirmed')::int AS supporters,
           count(*) FILTER (WHERE status IN ('submitted','pending_confirmation'))::int AS pending
    FROM tips WHERE creator_id = ${p.id}`;
  const recent = await sql<Record<string, unknown>>`
    ${tipSelect(sql)} WHERE t.creator_id = ${p.id} AND t.status IN ('confirmed','submitted','pending_confirmation')
    ORDER BY ${sql.raw(TS)} DESC, t.id DESC LIMIT 10`;
  const st = await indexerStatus(sql);
  let lag: number | null = null;
  if (chain && st.lastBlock !== null) {
    try {
      const head = await chain.getBlockNumber();
      lag = Number(head > st.lastBlock ? head - st.lastBlock : 0n);
    } catch {
      lag = null;
    }
  }
  return {
    profile: toCreatorProfile(p),
    totals: {
      confirmedRaw: dec(tot?.confirmed_raw),
      confirmedMezoRaw: dec(tot?.confirmed_mezo_raw),
      tips: int(tot?.tips), // all tokens
      supporters: int(tot?.supporters),
      pending: int(tot?.pending),
      fundedFromBitcoin: int(tot?.funded),
    },
    recent: recent.map(toDashboardTip),
    indexer: { lastBlock: st.lastBlock?.toString() ?? null, updatedAt: st.updatedAt?.toISOString() ?? null, lagBlocks: lag },
  };
}

// ---------------------------------------------------------------- tips page

const STATUSES = ["created", "awaiting_wallet", "submitted", "pending_confirmation", "confirmed", "failed", "expired"] as const;

export interface TipsQuery {
  status?: string; // "all" | "pending" (all non-final) | TipStatus (default all)
  from?: string; // ISO date/time (inclusive)
  to?: string; // ISO date/time (exclusive when a time; whole day when a date)
  cursor?: string;
  limit?: number;
}

function encodeCursor(ts: string, id: string): string {
  return Buffer.from(`${ts}|${id}`).toString("base64url");
}
function decodeCursor(c: string): { ts: string; id: string } {
  const [ts, id] = Buffer.from(c, "base64url").toString("utf8").split("|");
  if (!ts || !id || Number.isNaN(Date.parse(ts)) || !/^[0-9a-f-]{36}$/i.test(id)) throw new HttpError(400, "invalid_cursor", "Invalid cursor");
  return { ts, id };
}
function parseDate(v: string, endOfDay: boolean): Date {
  const d = new Date(/^\d{4}-\d{2}-\d{2}$/.test(v) ? `${v}T00:00:00.000Z` : v);
  if (Number.isNaN(d.getTime())) throw new HttpError(400, "invalid_date", "Invalid date");
  if (endOfDay && /^\d{4}-\d{2}-\d{2}$/.test(v)) d.setUTCDate(d.getUTCDate() + 1);
  return d;
}

export async function listDashboardTips(sql: Sql, session: Session, q: TipsQuery): Promise<TipsPage> {
  const p = await requireProfileRow(sql, session.userId);
  const limit = Math.min(Math.max(1, Math.floor(q.limit ?? 25)), 100);
  const where: Fragment[] = [sql.frag`t.creator_id = ${p.id}`];
  const status = q.status ?? "all";
  if (status === "pending") {
    // "pending" groups every not-yet-final state.
    where.push(sql.frag`t.status IN ('created','awaiting_wallet','submitted','pending_confirmation')`);
  } else if (status !== "all") {
    if (!(STATUSES as readonly string[]).includes(status)) throw new HttpError(400, "invalid_status", "Unknown status filter");
    where.push(sql.frag`t.status = ${status}`);
  }
  if (q.from) where.push(sql.frag`${sql.raw(TS)} >= ${parseDate(q.from, false)}`);
  if (q.to) where.push(sql.frag`${sql.raw(TS)} < ${parseDate(q.to, true)}`);
  if (q.cursor) {
    const c = decodeCursor(q.cursor);
    where.push(sql.frag`(${sql.raw(TS)}, t.id) < (${c.ts}::timestamptz, ${c.id}::uuid)`);
  }
  const rows = await sql<Record<string, unknown>>`
    ${tipSelect(sql)} WHERE ${sql.join(where, " AND ")} ORDER BY ${sql.raw(TS)} DESC, t.id DESC LIMIT ${limit + 1}`;
  const items = rows.slice(0, limit).map(toDashboardTip);
  const last = items[items.length - 1];
  return { items, nextCursor: rows.length > limit && last ? encodeCursor(last.timestamp, last.id) : null };
}

// ---------------------------------------------------------------- analytics

const RANGES = { "7d": 7, "30d": 30, "90d": 90 } as const;
export type AnalyticsRange = keyof typeof RANGES;

function dayKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export async function getAnalytics(sql: Sql, session: Session, range: AnalyticsRange): Promise<Analytics> {
  const p = await requireProfileRow(sql, session.userId);
  const days = RANGES[range];
  if (!days) throw new HttpError(400, "invalid_range", "Range must be 7d, 30d or 90d");
  const now = clock.now();
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - (days - 1)));
  const TSX = sql.raw("COALESCE(tx_timestamp, verified_at, created_at)");

  const [tot] = await sql<Record<string, unknown>>`
    SELECT COALESCE(sum(amount_raw) FILTER (WHERE token_address = ${MUSD_LC}), 0) AS total,
           count(*) FILTER (WHERE token_address = ${MUSD_LC})::int AS n,
           COALESCE(max(amount_raw) FILTER (WHERE token_address = ${MUSD_LC}), 0) AS largest,
           COALESCE(sum(amount_raw) FILTER (WHERE token_address = ${MEZO_LC}), 0) AS mezo_total,
           count(*) FILTER (WHERE token_address = ${MEZO_LC})::int AS mezo_n,
           count(DISTINCT sender_address)::int AS supporters
    FROM tips WHERE creator_id = ${p.id} AND status = 'confirmed' AND ${TSX} >= ${start}`;
  const daily = await sql<Record<string, unknown>>`
    SELECT to_char((${TSX}) AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS day,
           COALESCE(sum(amount_raw) FILTER (WHERE token_address = ${MUSD_LC}), 0) AS amount,
           COALESCE(sum(amount_raw) FILTER (WHERE token_address = ${MEZO_LC}), 0) AS mezo_amount,
           count(*) FILTER (WHERE token_address = ${MUSD_LC})::int AS n
    FROM tips WHERE creator_id = ${p.id} AND status = 'confirmed' AND ${TSX} >= ${start}
    GROUP BY 1`;
  // series.tips counts confirmed MUSD tips, matching totals.tips; MEZO amounts are reported separately.
  const byDay = new Map(daily.map((r) => [str(r.day), { amountRaw: dec(r.amount), tips: int(r.n), mezoAmountRaw: dec(r.mezo_amount) }]));
  const series: Analytics["series"] = [];
  for (let i = 0; i < days; i++) {
    const d = new Date(start.getTime() + i * 86400_000);
    const k = dayKey(d);
    series.push({ day: k, ...(byDay.get(k) ?? { amountRaw: "0", tips: 0, mezoAmountRaw: "0" }) });
  }

  const [v] = await sql<Record<string, unknown>>`
    SELECT count(*) FILTER (WHERE event_type = 'page_view')::int AS page_views,
           count(DISTINCT visitor_hash) FILTER (WHERE event_type = 'page_view')::int AS unique_visitors,
           count(*) FILTER (WHERE event_type = 'qr_view')::int AS qr_views,
           count(*) FILTER (WHERE event_type = 'share_click')::int AS share_clicks,
           count(*) FILTER (WHERE event_type = 'tip_started')::int AS tip_starts
    FROM analytics_events WHERE creator_id = ${p.id} AND created_at >= ${start}`;

  const visitSources = await sql<{ source: string; n: number }>`
    SELECT COALESCE(source, 'direct') AS source, count(*)::int AS n FROM analytics_events
    WHERE creator_id = ${p.id} AND event_type = 'page_view' AND created_at >= ${start} GROUP BY 1`;
  const tipSources = await sql<{ source: string; n: number }>`
    SELECT COALESCE(referral_source, 'direct') AS source, count(*)::int AS n FROM tips
    WHERE creator_id = ${p.id} AND status = 'confirmed' AND ${TSX} >= ${start} GROUP BY 1`;
  const sources = new Map<string, { source: string; visits: number; tips: number }>();
  for (const r of visitSources) sources.set(r.source, { source: r.source, visits: int(r.n), tips: 0 });
  for (const r of tipSources) {
    const e = sources.get(r.source) ?? { source: r.source, visits: 0, tips: 0 };
    e.tips = int(r.n);
    sources.set(r.source, e);
  }

  const total = big(tot?.total);
  const n = int(tot?.n);
  return {
    range,
    totals: {
      confirmedRaw: total.toString(),
      tips: n,
      averageRaw: n ? (total / BigInt(n)).toString() : "0",
      largestRaw: dec(tot?.largest),
      supporters: int(tot?.supporters),
      confirmedMezoRaw: dec(tot?.mezo_total),
      mezoTips: int(tot?.mezo_n),
    },
    series,
    visits: {
      pageViews: int(v?.page_views),
      uniqueVisitors: int(v?.unique_visitors),
      qrViews: int(v?.qr_views),
      shareClicks: int(v?.share_clicks),
      tipStarts: int(v?.tip_starts),
    },
    sources: Array.from(sources.values())
      .sort((a, b) => b.visits - a.visits || b.tips - a.tips || a.source.localeCompare(b.source))
      .slice(0, 20),
  };
}
