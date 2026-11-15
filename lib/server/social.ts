// v2 social layer: /explore, /supporter/{address}, top supporters on tip pages. Framework-free: server components
// can call getExplore / getSupporterProfile / getPublicCreator directly; the API routes wrap the same functions.
//
// Privacy rule (applies to every query here): only `confirmed` tips to `active` creators with public activity
// enabled, and never anonymous tips. Supporter labels are the name the supporter gave, else a short address.
// Totals are always per token, never added together. Funding is only shown when verified on chain.

import { getAddress } from "viem";
import type { Accent, AvatarPreset, ExploreCreator, ExploreResponse, FeedItem, SupporterProfile, TopSupporter } from "@/lib/api-types";
import { MEZO_TOKEN, MUSD } from "@/lib/chain/config";
import { getDb, type Fragment, type Sql } from "./db";
import { dec, int, iso, isoOrNull, str } from "./db/rows";
import { avatarUrlFor } from "./profiles";
import { fundedFromBitcoin, tokenOf } from "./tokens";

const lc = (s: string) => s.toLowerCase();
const MUSD_LC = lc(MUSD);
const MEZO_LC = lc(MEZO_TOKEN);

export const shortAddress = (a: string) => {
  const c = getAddress(a);
  return `${c.slice(0, 6)}…${c.slice(-4)}`;
};

/** WHERE clause for publicly visible tips (alias t = tips, p = creator_profiles). */
const publicTips = (sql: Sql): Fragment =>
  sql.frag`t.status = 'confirmed' AND NOT t.is_anonymous AND t.sender_address IS NOT NULL
           AND p.status = 'active' AND p.public_activity_enabled`;

const TS = "COALESCE(t.tx_timestamp, t.verified_at, t.created_at)";

const label = (name: unknown, address: string | null): string => {
  const n = typeof name === "string" ? name.trim() : "";
  if (n) return n;
  return address ? shortAddress(address) : "Supporter";
};

const creatorCard = (r: Record<string, unknown>) => ({
  username: str(r.username),
  displayName: str(r.display_name),
  avatarUrl: avatarUrlFor(str(r.username), (r.avatar_etag as string | null) ?? null),
  avatarPreset: (r.avatar_preset as AvatarPreset | null) ?? null,
  accent: (str(r.accent) || "orange") as Accent,
});

function toFeedItem(r: Record<string, unknown>): FeedItem {
  const sender = r.sender_address ? str(r.sender_address) : null;
  return {
    tipId: str(r.id),
    creator: creatorCard(r),
    supporterLabel: label(r.supporter_name, sender),
    supporterAddress: sender ? getAddress(sender) : null,
    token: tokenOf(r.token_address),
    amountRaw: dec(r.amount_raw),
    message: r.messages_enabled === true ? ((r.supporter_message as string | null) ?? null) : null,
    fundedFromBitcoin: fundedFromBitcoin(r),
    txHash: str(r.tx_hash),
    confirmedAt: iso(r.ts),
  };
}

const feedSelect = (sql: Sql) => sql.frag`
  SELECT t.id, t.sender_address, t.supporter_name, t.supporter_message, t.token_address, t.amount_raw, t.tx_hash,
         t.funding_kind, t.funding_verified, ${sql.raw(TS)} AS ts,
         p.username, p.display_name, p.avatar_etag, p.avatar_preset, p.accent, p.messages_enabled
  FROM tips t JOIN creator_profiles p ON p.id = t.creator_id`;

/** Latest supporter name per address among public tips (most recent non-empty name wins). */
async function latestNames(sql: Sql, where: Fragment, addresses: string[]): Promise<Map<string, string>> {
  if (!addresses.length) return new Map();
  const rows = await sql<{ sender_address: string; supporter_name: string }>`
    SELECT DISTINCT ON (t.sender_address) t.sender_address, t.supporter_name
    FROM tips t JOIN creator_profiles p ON p.id = t.creator_id
    WHERE ${publicTips(sql)} AND ${where} AND t.sender_address IN (${sql.join(addresses.map((x) => sql.frag`${x}`), ", ")})
      AND t.supporter_name IS NOT NULL AND t.supporter_name <> ''
    ORDER BY t.sender_address, ${sql.raw(TS)} DESC, t.id DESC`;
  return new Map(rows.map((r) => [r.sender_address, r.supporter_name]));
}

// ---------------------------------------------------------------- top supporters (tip page)

/** Top 5 public supporters of one creator, ranked by tip count, then MUSD amount. Caller checks public activity. */
export async function getTopSupporters(sql: Sql, creatorId: string, limit = 5): Promise<TopSupporter[]> {
  const rows = await sql<Record<string, unknown>>`
    SELECT t.sender_address, count(*)::int AS tips,
           COALESCE(sum(t.amount_raw) FILTER (WHERE t.token_address = ${MUSD_LC}), 0) AS musd,
           COALESCE(sum(t.amount_raw) FILTER (WHERE t.token_address = ${MEZO_LC}), 0) AS mezo
    FROM tips t JOIN creator_profiles p ON p.id = t.creator_id
    WHERE ${publicTips(sql)} AND t.creator_id = ${creatorId}
    GROUP BY t.sender_address
    ORDER BY count(*) DESC, COALESCE(sum(t.amount_raw) FILTER (WHERE t.token_address = ${MUSD_LC}), 0) DESC, t.sender_address
    LIMIT ${Math.min(Math.max(1, limit), 5)}`;
  const names = await latestNames(sql, sql.frag`t.creator_id = ${creatorId}`, rows.map((r) => str(r.sender_address)));
  return rows.map((r) => {
    const a = str(r.sender_address);
    return { label: label(names.get(a), a), address: getAddress(a), tips: int(r.tips), musdRaw: dec(r.musd), mezoRaw: dec(r.mezo) };
  });
}

// ---------------------------------------------------------------- explore

export interface ExploreOptions {
  sort?: "supporters" | "recent";
  limit?: number;
}

export async function getExplore(opts: ExploreOptions = {}, db?: Sql): Promise<ExploreResponse> {
  const sql = db ?? (await getDb());
  const sort = opts.sort === "recent" ? "recent" : "supporters";
  const limit = Math.min(Math.max(1, Math.floor(opts.limit ?? 24)), 50);

  const [tot] = await sql<Record<string, unknown>>`
    SELECT (SELECT count(*)::int FROM creator_profiles WHERE status = 'active' AND public_activity_enabled) AS creators,
           count(t.id)::int AS tips, count(DISTINCT t.sender_address)::int AS supporters,
           COALESCE(sum(t.amount_raw) FILTER (WHERE t.token_address = ${MUSD_LC}), 0) AS musd,
           COALESCE(sum(t.amount_raw) FILTER (WHERE t.token_address = ${MEZO_LC}), 0) AS mezo,
           count(t.id) FILTER (WHERE t.funding_verified)::int AS funded
    FROM tips t JOIN creator_profiles p ON p.id = t.creator_id
    WHERE ${publicTips(sql)}`;

  const order =
    sort === "recent"
      ? sql.frag`s.last_tip_at DESC NULLS LAST, p.created_at DESC, p.username`
      : sql.frag`COALESCE(s.supporters, 0) DESC, COALESCE(s.tips, 0) DESC, s.last_tip_at DESC NULLS LAST, p.username`;
  const creators = await sql<Record<string, unknown>>`
    SELECT p.username, p.display_name, p.bio, p.avatar_etag, p.avatar_preset, p.accent,
           COALESCE(s.supporters, 0)::int AS supporters, COALESCE(s.tips, 0)::int AS tips, s.last_tip_at
    FROM creator_profiles p
    LEFT JOIN (
      SELECT t.creator_id, count(DISTINCT t.sender_address)::int AS supporters, count(*)::int AS tips, max(${sql.raw(TS)}) AS last_tip_at
      FROM tips t JOIN creator_profiles p ON p.id = t.creator_id
      WHERE ${publicTips(sql)} GROUP BY t.creator_id
    ) s ON s.creator_id = p.id
    WHERE p.status = 'active' AND p.public_activity_enabled
    ORDER BY ${order}
    LIMIT ${limit}`;

  const feed = await sql<Record<string, unknown>>`
    ${feedSelect(sql)} WHERE ${publicTips(sql)} ORDER BY ${sql.raw(TS)} DESC, t.id DESC LIMIT 20`;

  return {
    totals: {
      creators: int(tot?.creators),
      tips: int(tot?.tips),
      supporters: int(tot?.supporters),
      musdRaw: dec(tot?.musd),
      mezoRaw: dec(tot?.mezo),
      fundedFromBitcoin: int(tot?.funded),
    },
    creators: creators.map(
      (r): ExploreCreator => ({
        ...creatorCard(r),
        bio: str(r.bio),
        supporters: int(r.supporters),
        tips: int(r.tips),
        lastTipAt: isoOrNull(r.last_tip_at),
      }),
    ),
    feed: feed.map(toFeedItem),
  };
}

// ---------------------------------------------------------------- supporter profile

/** Public profile of a supporter address, or null when it has no public tips (→ 404). */
export async function getSupporterProfile(address: string, db?: Sql): Promise<SupporterProfile | null> {
  if (typeof address !== "string" || !/^0x[0-9a-fA-F]{40}$/.test(address)) return null;
  const sql = db ?? (await getDb());
  const a = lc(address);
  const mine = sql.frag`t.sender_address = ${a}`;

  const perCreator = await sql<Record<string, unknown>>`
    SELECT p.username, p.display_name, p.avatar_etag, p.avatar_preset, p.accent, count(*)::int AS tips,
           COALESCE(sum(t.amount_raw) FILTER (WHERE t.token_address = ${MUSD_LC}), 0) AS musd,
           COALESCE(sum(t.amount_raw) FILTER (WHERE t.token_address = ${MEZO_LC}), 0) AS mezo,
           max(${sql.raw(TS)}) AS last_at
    FROM tips t JOIN creator_profiles p ON p.id = t.creator_id
    WHERE ${publicTips(sql)} AND ${mine}
    GROUP BY p.id, p.username, p.display_name, p.avatar_etag, p.avatar_preset, p.accent
    ORDER BY count(*) DESC, max(${sql.raw(TS)}) DESC, p.username`;
  if (!perCreator.length) return null;

  const recent = await sql<Record<string, unknown>>`
    ${feedSelect(sql)} WHERE ${publicTips(sql)} AND ${mine} ORDER BY ${sql.raw(TS)} DESC, t.id DESC LIMIT 20`;
  const names = await latestNames(sql, sql.frag`TRUE`, [a]);

  let musd = 0n;
  let mezo = 0n;
  let tips = 0;
  const creators = perCreator.map((r) => {
    musd += BigInt(dec(r.musd));
    mezo += BigInt(dec(r.mezo));
    tips += int(r.tips);
    return { ...creatorCard(r), tips: int(r.tips), musdRaw: dec(r.musd), mezoRaw: dec(r.mezo) };
  });
  return {
    address: getAddress(a),
    label: label(names.get(a), a),
    totals: { tips, creators: creators.length, musdRaw: musd.toString(), mezoRaw: mezo.toString() },
    creators,
    recent: recent.map(toFeedItem),
  };
}
