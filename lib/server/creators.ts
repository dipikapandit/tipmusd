// Public creator data for the /{username} page, its OG image, and GET /api/creators/*.
// Framework-free: server components can call these directly. Never exposes user ids or private settings.

import { getAddress } from "viem";
import type { Accent, AvatarPreset, PublicCreator, PublicTip, SocialLink } from "@/lib/api-types";
import { TIP_LIMITS } from "@/lib/chain/config";
import { normalizeUsername, USERNAME_RE } from "@/lib/usernames";
import { getDb, type Sql } from "./db";
import { bool, dec, iso, json, str } from "./db/rows";
import { avatarUrlFor, tipUrlFor } from "./profiles";
import { getTopSupporters, shortAddress } from "./social";
import { fundedFromBitcoin, tokenOf } from "./tokens";

export { shortAddress };

export type PublicCreatorResult = PublicCreator | { redirectTo: string } | null;

/** Internal (server-only) view of an active creator used by tips/x402. Not for the wire. */
export interface CreatorForPayment {
  id: string;
  userId: string;
  username: string;
  displayName: string;
  recipientWallet: string; // lowercase
  anonymousTipsEnabled: boolean;
  messagesEnabled: boolean;
  acceptMezo: boolean;
  thankYouMessage: string;
}

/**
 * Active creator by username, following a retired alias to the current profile. Suspended → null.
 * Use this (never a URL/client-provided wallet) to decide where a payment goes.
 */
export async function getCreatorForPayment(sql: Sql, username: string): Promise<CreatorForPayment | null> {
  const u = normalizeUsername(username);
  if (!USERNAME_RE.test(u)) return null;
  const [r] = await sql<Record<string, unknown>>`
    SELECT p.* FROM creator_profiles p WHERE p.username = ${u}
    UNION ALL
    SELECT p.* FROM username_aliases a JOIN creator_profiles p ON p.id = a.creator_id WHERE a.username = ${u}
    LIMIT 1`;
  if (!r || str(r.status) !== "active") return null;
  return {
    id: str(r.id),
    userId: str(r.user_id),
    username: str(r.username),
    displayName: str(r.display_name),
    recipientWallet: str(r.recipient_wallet).toLowerCase(),
    anonymousTipsEnabled: bool(r.anonymous_tips_enabled),
    messagesEnabled: bool(r.messages_enabled),
    acceptMezo: r.accept_mezo === undefined ? true : bool(r.accept_mezo),
    thankYouMessage: str(r.thank_you_message),
  };
}

/**
 * Public profile for `/{username}`. Returns:
 *  - PublicCreator for an active creator (campaign resolved when `campaign` is an active slug of theirs),
 *  - `{ redirectTo: "<current username>" }` when `username` is a retired alias,
 *  - null when unknown, invalid, or suspended.
 */
export async function getPublicCreator(username: string, campaign?: string | null, db?: Sql): Promise<PublicCreatorResult> {
  const sql = db ?? (await getDb());
  const u = normalizeUsername(username);
  if (!USERNAME_RE.test(u)) return null;
  const [r] = await sql<Record<string, unknown>>`SELECT * FROM creator_profiles WHERE username = ${u}`;
  if (!r) {
    const [a] = await sql<{ username: string; status: string }>`
      SELECT p.username, p.status FROM username_aliases a JOIN creator_profiles p ON p.id = a.creator_id WHERE a.username = ${u}`;
    return a && a.status === "active" ? { redirectTo: a.username } : null;
  }
  if (str(r.status) !== "active") return null;
  const name = str(r.username);
  const publicActivity = bool(r.public_activity_enabled);

  let camp: PublicCreator["campaign"] = null;
  const slug = typeof campaign === "string" ? campaign.trim().toLowerCase() : "";
  if (slug && /^[a-z0-9][a-z0-9-]{0,39}$/.test(slug)) {
    const [l] = await sql<{ slug: string; campaign_name: string }>`
      SELECT slug, campaign_name FROM tip_links WHERE creator_id = ${r.id} AND slug = ${slug} AND is_active`;
    if (l) camp = { slug: l.slug, name: l.campaign_name };
  }

  let stats: PublicCreator["stats"] = null;
  if (publicActivity) {
    const [s] = await sql<{ tips: unknown; supporters: unknown }>`
      SELECT count(*)::int AS tips, count(DISTINCT sender_address)::int AS supporters
      FROM tips WHERE creator_id = ${r.id} AND status = 'confirmed'`;
    stats = { tips: Number(s?.tips ?? 0), supporters: Number(s?.supporters ?? 0) };
  }

  return {
    username: name,
    displayName: str(r.display_name),
    bio: str(r.bio),
    avatarUrl: avatarUrlFor(name, (r.avatar_etag as string | null) ?? null),
    avatarPreset: (r.avatar_preset as AvatarPreset | null) ?? null,
    socialLinks: json<SocialLink[]>(r.social_links, []),
    recipientWallet: getAddress(str(r.recipient_wallet)),
    suggestedAmounts: json<string[]>(r.suggested_amounts, [...TIP_LIMITS.DEFAULT_SUGGESTED]),
    defaultAmount: str(r.default_amount),
    accent: (str(r.accent) || "orange") as Accent,
    publicActivityEnabled: publicActivity,
    anonymousTipsEnabled: bool(r.anonymous_tips_enabled),
    messagesEnabled: bool(r.messages_enabled),
    acceptMezo: bool(r.accept_mezo),
    tipUrl: tipUrlFor(name),
    campaign: camp,
    stats,
    topSupporters: publicActivity ? await getTopSupporters(sql, str(r.id)) : [],
  };
}

/**
 * Recent confirmed tips for the public page (newest first). Empty when the creator is unknown/suspended or
 * activity is private. Anonymous tips never carry a name or address; messages only when messages are enabled.
 */
export async function getPublicTips(username: string, opts: { limit?: number } = {}, db?: Sql): Promise<PublicTip[]> {
  const sql = db ?? (await getDb());
  const u = normalizeUsername(username);
  if (!USERNAME_RE.test(u)) return [];
  const [p] = await sql<Record<string, unknown>>`SELECT id, status, public_activity_enabled, messages_enabled FROM creator_profiles WHERE username = ${u}`;
  if (!p || str(p.status) !== "active" || !bool(p.public_activity_enabled)) return [];
  const showMessages = bool(p.messages_enabled);
  const limit = Math.min(Math.max(1, Math.floor(opts.limit ?? 20)), 50);
  const rows = await sql<Record<string, unknown>>`
    SELECT id, token_address, funding_kind, funding_verified, amount_raw, supporter_name, supporter_message, is_anonymous, sender_address, tx_hash,
           COALESCE(tx_timestamp, verified_at, created_at) AS ts
    FROM tips WHERE creator_id = ${p.id} AND status = 'confirmed'
    ORDER BY COALESCE(tx_timestamp, verified_at, created_at) DESC, id DESC LIMIT ${limit}`;
  return rows.map((r) => {
    const anon = bool(r.is_anonymous);
    const sender = r.sender_address ? str(r.sender_address) : null;
    return {
      id: str(r.id),
      token: tokenOf(r.token_address),
      amountRaw: dec(r.amount_raw),
      supporterName: anon ? null : ((r.supporter_name as string | null) ?? null),
      senderShort: anon || !sender ? null : shortAddress(sender),
      message: showMessages ? ((r.supporter_message as string | null) ?? null) : null,
      txHash: str(r.tx_hash),
      confirmedAt: iso(r.ts),
      fundedFromBitcoin: fundedFromBitcoin(r),
    };
  });
}
