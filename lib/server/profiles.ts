// Creator profiles: username rules, create/update, avatar, campaign links, payout-wallet change, `me`.
// Framework-free (routes in app/api/** do the HTTP glue).

import { getAddress } from "viem";
import type {
  Accent,
  AvatarPreset,
  CreateProfileRequest,
  CreatorProfile,
  MeResponse,
  SocialLink,
  TipLink,
  UpdateProfileRequest,
  UsernameCheck,
} from "@/lib/api-types";
import { ACCENTS, AVATAR_PRESETS } from "@/lib/api-types";
import { TIP_LIMITS } from "@/lib/chain/config";
import { normalizeUsername, usernameProblem, USERNAME_HINT } from "@/lib/usernames";
import { issueWalletChangeNonce, normalizeAddress, verifySiwe, type Session, type SiweOrigin, type VerifyInput } from "./auth";
import type { ChainAdapter } from "./chain";
import { clock } from "./clock";
import type { Fragment, Sql } from "./db";
import { bool, iso, isoOrNull, json, str } from "./db/rows";
import { env } from "./env";
import { HttpError, conflict, notFound } from "./errors";
import { parseAvatarDataUrl } from "./images";
import { formatMusd, parseTipAmount } from "./money";
import { notify } from "./notifications";
import { cleanSocialLinks, cleanText } from "./sanitize";

export const USERNAME_CHANGE_COOLDOWN_DAYS = 30;
export const MAX_TIP_LINKS = 50;

export function isUniqueViolation(e: unknown): boolean {
  const err = e as { code?: string; message?: string };
  return err?.code === "23505" || /duplicate key value/i.test(err?.message ?? "");
}

// ---------------------------------------------------------------- mapping

export type ProfileRow = Record<string, unknown>;

export const tipUrlFor = (username: string) => `${env.appUrl()}/${username}`;
export const avatarUrlFor = (username: string, etag: string | null) =>
  etag ? `/api/avatars/${username}?v=${encodeURIComponent(etag)}` : null;

export function toCreatorProfile(r: ProfileRow): CreatorProfile {
  const username = str(r.username);
  return {
    id: str(r.id),
    username,
    displayName: str(r.display_name),
    bio: str(r.bio),
    avatarUrl: avatarUrlFor(username, (r.avatar_etag as string | null) ?? null),
    avatarPreset: (r.avatar_preset as AvatarPreset | null) ?? null,
    socialLinks: json<SocialLink[]>(r.social_links, []),
    recipientWallet: getAddress(str(r.recipient_wallet)),
    suggestedAmounts: json<string[]>(r.suggested_amounts, [...TIP_LIMITS.DEFAULT_SUGGESTED]),
    defaultAmount: str(r.default_amount),
    thankYouMessage: str(r.thank_you_message),
    accent: (str(r.accent) || "orange") as Accent,
    publicActivityEnabled: bool(r.public_activity_enabled),
    anonymousTipsEnabled: bool(r.anonymous_tips_enabled),
    messagesEnabled: bool(r.messages_enabled),
    acceptMezo: r.accept_mezo === undefined ? true : bool(r.accept_mezo),
    status: str(r.status) === "suspended" ? "suspended" : "active",
    tipUrl: tipUrlFor(username),
    usernameChangedAt: isoOrNull(r.username_changed_at),
    createdAt: iso(r.created_at),
    updatedAt: iso(r.updated_at),
  };
}

export async function profileRowByUser(sql: Sql, userId: string): Promise<ProfileRow | null> {
  const [r] = await sql<ProfileRow>`SELECT * FROM creator_profiles WHERE user_id = ${userId}`;
  return r ?? null;
}

export async function getProfileByUser(sql: Sql, userId: string): Promise<CreatorProfile | null> {
  const r = await profileRowByUser(sql, userId);
  return r ? toCreatorProfile(r) : null;
}

export async function requireProfileRow(sql: Sql, userId: string): Promise<ProfileRow> {
  const r = await profileRowByUser(sql, userId);
  if (!r) throw new HttpError(404, "no_profile", "Create your creator profile first");
  return r;
}

export async function me(sql: Sql, userId: string): Promise<MeResponse> {
  const [u] = await sql<{ id: string; wallet_address: string }>`SELECT id, wallet_address FROM users WHERE id = ${userId}`;
  if (!u) throw new HttpError(401, "unauthorized", "Sign in with your wallet first");
  return { user: { id: u.id, address: getAddress(u.wallet_address) }, profile: await getProfileByUser(sql, userId) };
}

// ---------------------------------------------------------------- usernames

/** Availability for `u` (normalised). `selfCreatorId` lets a creator re-take their own retired name. */
export async function checkUsername(sql: Sql, input: string, selfCreatorId?: string): Promise<UsernameCheck> {
  const username = normalizeUsername(input);
  const problem = usernameProblem(username);
  if (problem === "invalid") return { username, available: false, reason: "invalid", message: USERNAME_HINT };
  if (problem === "reserved") return { username, available: false, reason: "reserved", message: "That name is reserved." };
  const [p] = await sql<{ id: string }>`SELECT id FROM creator_profiles WHERE username = ${username}`;
  if (p && p.id !== selfCreatorId) return { username, available: false, reason: "taken", message: "That name is taken." };
  const [a] = await sql<{ creator_id: string }>`SELECT creator_id FROM username_aliases WHERE username = ${username}`;
  if (a && a.creator_id !== selfCreatorId) return { username, available: false, reason: "retired", message: "That name was used before and can't be claimed." };
  return { username, available: true };
}

async function requireAvailable(sql: Sql, input: string, selfCreatorId?: string): Promise<string> {
  const c = await checkUsername(sql, input, selfCreatorId);
  if (!c.available) {
    const status = c.reason === "invalid" || c.reason === "reserved" ? 400 : 409;
    throw new HttpError(status, `username_${c.reason}`, c.message ?? "Username unavailable");
  }
  return c.username;
}

// ---------------------------------------------------------------- field normalisers

/** 1..6 valid amounts → deduplicated, ascending, canonical decimal strings. */
export function normalizeSuggestedAmounts(list: string[]): string[] {
  if (!Array.isArray(list) || list.length < 1 || list.length > TIP_LIMITS.MAX_SUGGESTED)
    throw new HttpError(400, "invalid_amount", `Choose between 1 and ${TIP_LIMITS.MAX_SUGGESTED} suggested amounts`);
  const raws = list.map((a) => {
    const r = parseTipAmount(a);
    if (r === null) throw new HttpError(400, "invalid_amount", `Suggested amounts must be between ${TIP_LIMITS.MIN} and ${TIP_LIMITS.MAX} MUSD`);
    return r;
  });
  return Array.from(new Set(raws)).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)).map(formatMusd);
}

export function normalizeDefaultAmount(a: string): string {
  const r = parseTipAmount(a);
  if (r === null) throw new HttpError(400, "invalid_amount", `Default amount must be between ${TIP_LIMITS.MIN} and ${TIP_LIMITS.MAX} MUSD`);
  return formatMusd(r);
}

function displayName(v: unknown): string {
  const s = cleanText(v, { max: 50 });
  if (!s) throw new HttpError(400, "invalid_display_name", "Add a display name");
  return s;
}
const bio = (v: unknown) => cleanText(v, { max: 280, multiline: true });
const thankYou = (v: unknown) => cleanText(v, { max: 280, multiline: true });

function avatarPreset(v: unknown): AvatarPreset | null {
  if (v === null || v === undefined) return null;
  if (!(AVATAR_PRESETS as readonly string[]).includes(String(v))) throw new HttpError(400, "invalid_avatar_preset", "Unknown avatar style");
  return v as AvatarPreset;
}

// ---------------------------------------------------------------- create / update

export async function createProfile(sql: Sql, session: Session, input: CreateProfileRequest): Promise<CreatorProfile> {
  return sql.begin(async (tx) => {
    if (await profileRowByUser(tx, session.userId)) throw conflict("profile_exists", "You already have a creator profile");
    const username = await requireAvailable(tx, input.username);
    const wallet = session.address.toLowerCase();
    const [inUse] = await tx<{ id: string }>`SELECT id FROM creator_profiles WHERE recipient_wallet = ${wallet}`;
    if (inUse) throw conflict("wallet_in_use", "This wallet already receives tips for another profile");
    const suggested = input.suggestedAmounts ? normalizeSuggestedAmounts(input.suggestedAmounts) : [...TIP_LIMITS.DEFAULT_SUGGESTED];
    const def = input.defaultAmount ? normalizeDefaultAmount(input.defaultAmount) : TIP_LIMITS.DEFAULT_AMOUNT;
    const now = clock.now();
    try {
      const [row] = await tx<ProfileRow>`
        INSERT INTO creator_profiles (user_id, username, display_name, bio, avatar_preset, social_links, recipient_wallet,
                                      suggested_amounts, default_amount, created_at, updated_at)
        VALUES (${session.userId}, ${username}, ${displayName(input.displayName)}, ${bio(input.bio ?? "")},
                ${avatarPreset(input.avatarPreset)}, ${cleanSocialLinks(input.socialLinks)}::jsonb, ${wallet},
                ${suggested}::jsonb, ${def}, ${now}, ${now})
        RETURNING *`;
      await tx`INSERT INTO creator_wallets (creator_id, wallet, from_time) VALUES (${row.id}, ${wallet}, ${now})`;
      return toCreatorProfile(row);
    } catch (e) {
      if (isUniqueViolation(e)) throw conflict("username_taken", "That name is taken.");
      throw e;
    }
  });
}

export async function updateProfile(sql: Sql, session: Session, input: UpdateProfileRequest): Promise<CreatorProfile> {
  return sql.begin(async (tx) => {
    const [cur] = await tx<ProfileRow>`SELECT * FROM creator_profiles WHERE user_id = ${session.userId} FOR UPDATE`;
    if (!cur) throw new HttpError(404, "no_profile", "Create your creator profile first");
    const creatorId = str(cur.id);
    const now = clock.now();
    const sets: Fragment[] = [];
    if (input.displayName !== undefined) sets.push(tx.frag`display_name = ${displayName(input.displayName)}`);
    if (input.bio !== undefined) sets.push(tx.frag`bio = ${bio(input.bio)}`);
    if (input.avatarPreset !== undefined) sets.push(tx.frag`avatar_preset = ${avatarPreset(input.avatarPreset)}`);
    if (input.socialLinks !== undefined) sets.push(tx.frag`social_links = ${cleanSocialLinks(input.socialLinks)}::jsonb`);
    if (input.suggestedAmounts !== undefined) sets.push(tx.frag`suggested_amounts = ${normalizeSuggestedAmounts(input.suggestedAmounts)}::jsonb`);
    if (input.defaultAmount !== undefined) sets.push(tx.frag`default_amount = ${normalizeDefaultAmount(input.defaultAmount)}`);
    if (input.thankYouMessage !== undefined) sets.push(tx.frag`thank_you_message = ${thankYou(input.thankYouMessage)}`);
    if (input.accent !== undefined) {
      if (!(ACCENTS as readonly string[]).includes(input.accent)) throw new HttpError(400, "invalid_accent", "Unknown accent color");
      sets.push(tx.frag`accent = ${input.accent}`);
    }
    if (input.publicActivityEnabled !== undefined) sets.push(tx.frag`public_activity_enabled = ${Boolean(input.publicActivityEnabled)}`);
    if (input.anonymousTipsEnabled !== undefined) sets.push(tx.frag`anonymous_tips_enabled = ${Boolean(input.anonymousTipsEnabled)}`);
    if (input.messagesEnabled !== undefined) sets.push(tx.frag`messages_enabled = ${Boolean(input.messagesEnabled)}`);
    if (input.acceptMezo !== undefined) sets.push(tx.frag`accept_mezo = ${Boolean(input.acceptMezo)}`);

    let renamedFrom: string | null = null;
    if (input.username !== undefined) {
      const next = normalizeUsername(input.username);
      const old = str(cur.username);
      if (next !== old) {
        const last = cur.username_changed_at ? new Date(cur.username_changed_at as string).getTime() : null;
        const cooldownMs = USERNAME_CHANGE_COOLDOWN_DAYS * 86400_000;
        if (last !== null && now.getTime() - last < cooldownMs) {
          throw conflict("username_change_too_soon", `You can change your username once every ${USERNAME_CHANGE_COOLDOWN_DAYS} days`, {
            nextChangeAt: new Date(last + cooldownMs).toISOString(),
          });
        }
        await requireAvailable(tx, next, creatorId);
        // Re-taking your own retired name frees that alias; the old name becomes a retired alias.
        await tx`DELETE FROM username_aliases WHERE username = ${next} AND creator_id = ${creatorId}`;
        await tx`INSERT INTO username_aliases (username, creator_id, retired_at) VALUES (${old}, ${creatorId}, ${now})
                 ON CONFLICT (username) DO NOTHING`;
        sets.push(tx.frag`username = ${next}`, tx.frag`username_changed_at = ${now}`);
        renamedFrom = old;
      }
    }
    if (sets.length === 0) return toCreatorProfile(cur);
    sets.push(tx.frag`updated_at = ${now}`);
    let row: ProfileRow;
    try {
      [row] = await tx<ProfileRow>`UPDATE creator_profiles SET ${tx.join(sets, ", ")} WHERE id = ${creatorId} RETURNING *`;
    } catch (e) {
      if (isUniqueViolation(e)) throw conflict("username_taken", "That name is taken.");
      throw e;
    }
    if (renamedFrom) {
      await notify(tx, {
        userId: session.userId,
        type: "username_changed",
        title: `Your username is now @${str(row.username)}`,
        message: `Links to @${renamedFrom} keep working and redirect to your new page.`,
      });
    }
    return toCreatorProfile(row);
  });
}

// ---------------------------------------------------------------- avatar

export async function setAvatar(sql: Sql, session: Session, dataUrl: string): Promise<CreatorProfile> {
  const img = parseAvatarDataUrl(dataUrl);
  return sql.begin(async (tx) => {
    const cur = await requireProfileRow(tx, session.userId);
    const now = clock.now();
    await tx`INSERT INTO creator_avatars (creator_id, content_type, bytes, etag, updated_at)
             VALUES (${cur.id}, ${img.contentType}, decode(${img.bytes.toString("hex")}, 'hex'), ${img.etag}, ${now})
             ON CONFLICT (creator_id) DO UPDATE SET content_type = EXCLUDED.content_type, bytes = EXCLUDED.bytes,
               etag = EXCLUDED.etag, updated_at = EXCLUDED.updated_at`;
    const [row] = await tx<ProfileRow>`UPDATE creator_profiles SET avatar_etag = ${img.etag}, updated_at = ${now} WHERE id = ${cur.id} RETURNING *`;
    return toCreatorProfile(row);
  });
}

export async function deleteAvatar(sql: Sql, session: Session): Promise<CreatorProfile> {
  return sql.begin(async (tx) => {
    const cur = await requireProfileRow(tx, session.userId);
    await tx`DELETE FROM creator_avatars WHERE creator_id = ${cur.id}`;
    const [row] = await tx<ProfileRow>`UPDATE creator_profiles SET avatar_etag = NULL, updated_at = ${clock.now()} WHERE id = ${cur.id} RETURNING *`;
    return toCreatorProfile(row);
  });
}

/** Public avatar bytes for an active creator (by current username). */
export async function getAvatar(sql: Sql, username: string): Promise<{ contentType: string; bytes: Buffer; etag: string } | null> {
  const u = normalizeUsername(username);
  const [r] = await sql<{ content_type: string; hex: string; etag: string }>`
    SELECT a.content_type, encode(a.bytes, 'hex') AS hex, a.etag
    FROM creator_avatars a JOIN creator_profiles p ON p.id = a.creator_id
    WHERE p.username = ${u} AND p.status = 'active'`;
  return r ? { contentType: r.content_type, bytes: Buffer.from(r.hex, "hex"), etag: r.etag } : null;
}

// ---------------------------------------------------------------- campaign links

const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,39}$/;

function toTipLink(r: Record<string, unknown>, username: string): TipLink {
  const slug = str(r.slug);
  return {
    id: str(r.id),
    slug,
    campaignName: str(r.campaign_name),
    isActive: bool(r.is_active),
    url: `${tipUrlFor(username)}?c=${encodeURIComponent(slug)}`,
    createdAt: iso(r.created_at),
  };
}

function campaignName(v: unknown): string {
  const s = cleanText(v, { max: 60 });
  if (!s) throw new HttpError(400, "invalid_campaign_name", "Give the link a name");
  return s;
}

export async function listTipLinks(sql: Sql, session: Session): Promise<TipLink[]> {
  const p = await requireProfileRow(sql, session.userId);
  const rows = await sql`SELECT * FROM tip_links WHERE creator_id = ${p.id} ORDER BY created_at DESC, id`;
  return rows.map((r) => toTipLink(r, str(p.username)));
}

export async function createTipLink(sql: Sql, session: Session, input: { slug: string; campaignName: string }): Promise<TipLink> {
  const p = await requireProfileRow(sql, session.userId);
  const slug = String(input.slug ?? "").trim().toLowerCase();
  if (!SLUG_RE.test(slug)) throw new HttpError(400, "invalid_slug", "Use 1–40 lowercase letters, numbers or dashes");
  const [{ n }] = await sql<{ n: number }>`SELECT count(*)::int AS n FROM tip_links WHERE creator_id = ${p.id}`;
  if (Number(n) >= MAX_TIP_LINKS) throw new HttpError(400, "too_many_links", `You can have up to ${MAX_TIP_LINKS} campaign links`);
  try {
    const [row] = await sql`INSERT INTO tip_links (creator_id, slug, campaign_name, created_at)
                            VALUES (${p.id}, ${slug}, ${campaignName(input.campaignName)}, ${clock.now()}) RETURNING *`;
    return toTipLink(row, str(p.username));
  } catch (e) {
    if (isUniqueViolation(e)) throw conflict("slug_taken", "You already have a link with that name");
    throw e;
  }
}

export async function updateTipLink(
  sql: Sql,
  session: Session,
  id: string,
  input: { campaignName?: string; isActive?: boolean },
): Promise<TipLink> {
  const p = await requireProfileRow(sql, session.userId);
  const sets: Fragment[] = [];
  if (input.campaignName !== undefined) sets.push(sql.frag`campaign_name = ${campaignName(input.campaignName)}`);
  if (input.isActive !== undefined) sets.push(sql.frag`is_active = ${Boolean(input.isActive)}`);
  const [row] = sets.length
    ? await sql`UPDATE tip_links SET ${sql.join(sets, ", ")} WHERE id = ${id} AND creator_id = ${p.id} RETURNING *`
    : await sql`SELECT * FROM tip_links WHERE id = ${id} AND creator_id = ${p.id}`;
  if (!row) throw notFound();
  return toTipLink(row, str(p.username));
}

// ---------------------------------------------------------------- payout wallet change

async function assertWalletFree(sql: Sql, wallet: string, creatorId: string) {
  const [other] = await sql<{ id: string }>`SELECT id FROM creator_profiles WHERE recipient_wallet = ${wallet} AND id <> ${creatorId}`;
  if (other) throw conflict("wallet_in_use", "That wallet already receives tips for another profile");
}

/** Step 1: a wallet_change nonce bound to the session user, to be signed by the NEW wallet. */
export async function walletChangeNonce(sql: Sql, session: Session, address: string, origin: SiweOrigin) {
  const p = await requireProfileRow(sql, session.userId);
  const wallet = normalizeAddress(address);
  if (wallet === str(p.recipient_wallet)) throw new HttpError(400, "same_wallet", "That is already your payout wallet");
  await assertWalletFree(sql, wallet, str(p.id));
  return issueWalletChangeNonce(sql, session.userId, wallet, origin);
}

/**
 * Step 2: verify the signature FROM THE NEW wallet, then switch. Historical tips keep their own
 * recipient_address; creator_wallets keeps the old wallet's time window for indexer attribution.
 */
export async function changePayoutWallet(
  sql: Sql,
  chain: ChainAdapter,
  session: Session,
  input: VerifyInput,
  opts: { allowedDomains: string[] },
): Promise<CreatorProfile> {
  const wallet = await verifySiwe(sql, chain, input, { allowedDomains: opts.allowedDomains, purpose: "wallet_change", userId: session.userId });
  return sql.begin(async (tx) => {
    const [cur] = await tx<ProfileRow>`SELECT * FROM creator_profiles WHERE user_id = ${session.userId} FOR UPDATE`;
    if (!cur) throw new HttpError(404, "no_profile", "Create your creator profile first");
    if (wallet === str(cur.recipient_wallet)) return toCreatorProfile(cur);
    await assertWalletFree(tx, wallet, str(cur.id));
    const now = clock.now();
    let row: ProfileRow;
    try {
      [row] = await tx<ProfileRow>`UPDATE creator_profiles SET recipient_wallet = ${wallet}, updated_at = ${now} WHERE id = ${cur.id} RETURNING *`;
    } catch (e) {
      if (isUniqueViolation(e)) throw conflict("wallet_in_use", "That wallet already receives tips for another profile");
      throw e;
    }
    await tx`UPDATE creator_wallets SET to_time = ${now} WHERE creator_id = ${cur.id} AND to_time IS NULL`;
    await tx`INSERT INTO creator_wallets (creator_id, wallet, from_time) VALUES (${cur.id}, ${wallet}, ${now})`;
    const short = (a: string) => `${getAddress(a).slice(0, 6)}…${a.slice(-4)}`;
    await notify(tx, {
      userId: session.userId,
      type: "wallet_changed",
      title: "Payout wallet changed",
      message: `New tips now go to ${short(wallet)} (was ${short(str(cur.recipient_wallet))}). If this wasn't you, sign in and change it back.`,
    });
    return toCreatorProfile(row);
  });
}
