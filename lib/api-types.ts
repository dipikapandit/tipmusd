// FROZEN. Wire types shared by API routes (lib/server, app/api) and the UI (lib/client, components).
// Amounts on the wire: `*Raw` = base-unit decimal string (18 dec); `*Display` / amount inputs = MUSD decimal string.

export interface ApiError {
  error: { code: string; message: string; details?: unknown };
}

export type TipStatus = "created" | "awaiting_wallet" | "submitted" | "pending_confirmation" | "confirmed" | "failed" | "expired";
export type TipSource = "app" | "indexer" | "x402";
export type TipToken = "MUSD" | "MEZO";
export type FundingKind = "swap_btc" | "loan_draw" | "loan_open";
/** How the supporter funded the tip from Bitcoin via Mezo. `verified` = funding tx checked on chain. */
export interface TipFunding {
  kind: FundingKind;
  txHash: string | null;
  verified: boolean;
}
export const TERMINAL_TIP_STATUSES: readonly TipStatus[] = ["confirmed", "failed", "expired"];

export type SocialKind = "x" | "linkedin" | "github" | "instagram" | "youtube" | "telegram" | "discord" | "farcaster" | "website";
export interface SocialLink {
  kind: SocialKind;
  url: string; // https only, validated per kind host where applicable
}

export type Accent = "orange" | "red" | "blue" | "green" | "violet" | "ink";
export const ACCENTS: readonly Accent[] = ["orange", "red", "blue", "green", "violet", "ink"];
export const AVATAR_PRESETS = ["sunset", "ocean", "forest", "dusk", "sand", "slate"] as const;
export type AvatarPreset = (typeof AVATAR_PRESETS)[number];

// ---------------------------------------------------------------- auth
// GET  /api/auth/nonce?address=0x..          → NonceResponse
// POST /api/auth/verify  VerifyRequest       → MeResponse (sets httpOnly cookie)
// POST /api/auth/logout                      → { ok: true }
// GET  /api/auth/me                          → MeResponse | 401
export interface NonceResponse {
  nonce: string;
  message: string; // EIP-4361 text to personal_sign verbatim
}
export interface VerifyRequest {
  address: string;
  message: string;
  signature: string;
}
export interface MeResponse {
  user: { id: string; address: string };
  profile: CreatorProfile | null; // null → onboarding not finished
}

// ---------------------------------------------------------------- profiles
// GET   /api/usernames/check?u=name          → UsernameCheck
// POST  /api/profile  CreateProfileRequest   → CreatorProfile (201)
// GET   /api/profile                         → CreatorProfile
// PATCH /api/profile  UpdateProfileRequest   → CreatorProfile
// PUT   /api/profile/avatar  { dataUrl }     → CreatorProfile   (png/jpeg/webp ≤ 200 KB decoded, ≤ 1024px)
// DELETE /api/profile/avatar                 → CreatorProfile
// POST  /api/profile/wallet/nonce  { address }                       → NonceResponse (purpose wallet_change)
// POST  /api/profile/wallet        { address, message, signature }   → CreatorProfile
// GET   /api/profile/links                   → TipLink[]
// POST  /api/profile/links  { slug, campaignName } → TipLink
// PATCH /api/profile/links/{id}  { campaignName?, isActive? } → TipLink
export interface UsernameCheck {
  username: string; // normalised lowercase
  available: boolean;
  reason?: "invalid" | "reserved" | "taken" | "retired";
  message?: string;
}

export interface CreatorProfile {
  id: string;
  username: string;
  displayName: string;
  bio: string;
  avatarUrl: string | null; // /api/avatars/{username}?v={etag} when uploaded
  avatarPreset: AvatarPreset | null;
  socialLinks: SocialLink[];
  recipientWallet: string; // checksummed
  suggestedAmounts: string[]; // MUSD decimal strings, ascending, 1..6 items
  defaultAmount: string;
  thankYouMessage: string;
  accent: Accent;
  publicActivityEnabled: boolean;
  anonymousTipsEnabled: boolean;
  messagesEnabled: boolean;
  acceptMezo: boolean; // v2: creator also accepts MEZO tips
  status: "active" | "suspended";
  tipUrl: string; // absolute, e.g. https://tipmusd.app/prajal
  usernameChangedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateProfileRequest {
  username: string;
  displayName: string;
  bio?: string;
  avatarPreset?: AvatarPreset;
  socialLinks?: SocialLink[];
  suggestedAmounts?: string[];
  defaultAmount?: string;
}
export type UpdateProfileRequest = Partial<
  Pick<
    CreatorProfile,
    | "username"
    | "displayName"
    | "bio"
    | "avatarPreset"
    | "socialLinks"
    | "suggestedAmounts"
    | "defaultAmount"
    | "thankYouMessage"
    | "accent"
    | "publicActivityEnabled"
    | "anonymousTipsEnabled"
    | "messagesEnabled"
    | "acceptMezo"
  >
>;

export interface TipLink {
  id: string;
  slug: string;
  campaignName: string;
  isActive: boolean;
  url: string; // {tipUrl}?c={slug}
  createdAt: string;
}

// ---------------------------------------------------------------- public creator page
// GET /api/creators/{username}            → PublicCreator | 404   (alias → 301-ish { redirectTo })
// GET /api/creators/{username}/tips       → PublicTip[]  (empty if activity private)
export interface PublicCreator {
  username: string;
  displayName: string;
  bio: string;
  avatarUrl: string | null;
  avatarPreset: AvatarPreset | null;
  socialLinks: SocialLink[];
  recipientWallet: string; // checksummed — shown to the supporter before signing
  suggestedAmounts: string[];
  defaultAmount: string;
  accent: Accent;
  publicActivityEnabled: boolean;
  anonymousTipsEnabled: boolean;
  messagesEnabled: boolean;
  acceptMezo: boolean;
  tipUrl: string;
  campaign?: { slug: string; name: string } | null;
  stats: { supporters: number; tips: number } | null; // null when activity is private
  /** v2: top public supporters (non-anonymous confirmed tips only; [] when activity is private). Max 5. */
  topSupporters: TopSupporter[];
}
export interface TopSupporter {
  label: string; // supporter name, else short address
  address: string | null; // checksummed; links to /supporter/{address}
  tips: number;
  musdRaw: string;
  mezoRaw: string;
}
export interface PublicTip {
  id: string;
  token: TipToken;
  amountRaw: string;
  supporterName: string | null; // null → "Anonymous" / short address per settings
  senderShort: string | null; // 0x12…abcd, null when anonymous
  message: string | null;
  txHash: string;
  confirmedAt: string;
  fundedFromBitcoin: FundingKind | null; // only when verified
}

// ---------------------------------------------------------------- tipping
// POST  /api/tips          CreateTipRequest  → TipIntent (201)
// PATCH /api/tips/{id}     { status: "awaiting_wallet" } | { status: "failed", reason: "user_rejected" | "wallet_error" }  → TipView
// POST  /api/tips/{id}/submit  SubmitTipRequest → TipView   (runs one verification attempt inline)
// GET   /api/tips/{id}                       → TipView   (re-verifies non-terminal tips, throttled)
export interface CreateTipRequest {
  username: string;
  token?: TipToken; // default "MUSD"; "MEZO" only if the creator accepts it
  amount: string; // decimal in `token` units, TIP_TOKENS[token].min..max, ≤ 6 decimals
  supporterName?: string;
  message?: string;
  isAnonymous?: boolean;
  campaign?: string; // tip_links.slug
  source?: string; // ?src= referral, [a-z0-9_-]{1,24}
  senderAddress?: string; // connected wallet (informational; verification uses the on-chain log)
}
export interface TipIntent {
  tip: TipView;
  /** Exactly what the wallet must sign: token.transfer(recipient, amountRaw) with dataSuffix appended. */
  payment: {
    chainId: number;
    token: string; // token contract address (MUSD or MEZO)
    tokenSymbol: TipToken;
    recipient: string; // checksummed creator wallet, from the DB (never from the URL)
    amountRaw: string;
    dataSuffix: `0x${string}`; // TIP_REF_MAGIC ++ ref
  };
}
export interface SubmitTipRequest {
  txHash: string;
  /** v2: the supporter funded this tip from Bitcoin via Mezo first (swap / loan draw / loan open). */
  funding?: { kind: FundingKind; txHash: string };
}
export interface TipView {
  id: string;
  token: TipToken;
  funding: TipFunding | null;
  creatorUsername: string;
  creatorDisplayName: string;
  status: TipStatus;
  failureReason: string | null;
  source: TipSource;
  amountRaw: string | null; // verified amount (null until confirmed)
  expectedAmountRaw: string | null;
  recipientAddress: string;
  senderAddress: string | null;
  txHash: string | null;
  blockNumber: string | null;
  confirmations: number | null;
  requiredConfirmations: number;
  explorerUrl: string | null;
  supporterName: string | null;
  message: string | null;
  isAnonymous: boolean;
  thankYouMessage: string | null; // only once confirmed
  createdAt: string;
  verifiedAt: string | null;
  expiresAt: string | null;
}

// ---------------------------------------------------------------- dashboard (session required)
// GET /api/dashboard/overview                       → DashboardOverview
// GET /api/dashboard/tips?status=&from=&to=&cursor=&limit= → TipsPage
// GET /api/dashboard/analytics?range=7d|30d|90d     → Analytics
// POST /api/indexer/sync                            → SyncResult  (session: throttled catch-up; or Bearer INDEXER_SECRET)
export interface DashboardOverview {
  profile: CreatorProfile;
  totals: {
    confirmedRaw: string; // MUSD
    confirmedMezoRaw: string; // v2
    tips: number;
    supporters: number;
    pending: number;
    fundedFromBitcoin: number; // v2: confirmed tips with verified Mezo funding (swap/borrow)
  };
  recent: DashboardTip[];
  indexer: { lastBlock: string | null; updatedAt: string | null; lagBlocks: number | null };
}
export interface DashboardTip {
  id: string;
  token: TipToken;
  funding: TipFunding | null;
  status: TipStatus;
  failureReason: string | null;
  source: TipSource;
  amountRaw: string | null;
  expectedAmountRaw: string | null;
  senderAddress: string | null;
  recipientAddress: string;
  supporterName: string | null;
  message: string | null;
  isAnonymous: boolean;
  campaign: string | null;
  referralSource: string | null;
  txHash: string | null;
  explorerUrl: string | null;
  blockNumber: string | null;
  timestamp: string; // tx timestamp when known, else created_at
}
export interface TipsPage {
  items: DashboardTip[];
  nextCursor: string | null;
}
export interface Analytics {
  range: "7d" | "30d" | "90d";
  totals: { confirmedRaw: string; tips: number; averageRaw: string; largestRaw: string; supporters: number; confirmedMezoRaw: string; mezoTips: number }; // MUSD figures unless named Mezo
  series: { day: string; amountRaw: string; tips: number; mezoAmountRaw: string }[]; // confirmed only, every day in range
  visits: { pageViews: number; uniqueVisitors: number; qrViews: number; shareClicks: number; tipStarts: number };
  sources: { source: string; visits: number; tips: number }[];
}
export interface SyncResult {
  fromBlock: string;
  toBlock: string;
  events: number;
  confirmed: number;
  skipped?: "locked" | "throttled";
}

// ---------------------------------------------------------------- misc
// GET  /api/notifications                → NotificationItem[] ; POST /api/notifications/read { ids? } → { ok }
// POST /api/analytics/event  { username, type, source? }  → { ok }   (public, rate limited, deduped)
// POST /api/reports  { username, reason, details? }      → { ok }   (public, rate limited)
// GET  /api/health                       → { ok, db, rpc, chainId, block, indexerLag }
// GET  /api/avatars/{username}           → image bytes (immutable cache with ?v=etag)
export interface NotificationItem {
  id: string;
  type: string;
  title: string;
  message: string;
  tipId: string | null;
  readAt: string | null;
  createdAt: string;
}
export type AnalyticsEventType = "page_view" | "qr_view" | "share_click" | "wallet_connect" | "tip_started" | "funding_started";

// ---------------------------------------------------------------- v2 social layer (public, read-only, cached ≤30 s)
// GET /api/explore?sort=supporters|recent&limit=   → ExploreResponse
// GET /api/supporters/{address}                    → SupporterProfile | 404 (no public tips)
// Only confirmed tips to active creators with public activity, never anonymous ones.
export interface FeedItem {
  tipId: string;
  creator: { username: string; displayName: string; avatarUrl: string | null; avatarPreset: AvatarPreset | null; accent: Accent };
  supporterLabel: string; // name, else short address
  supporterAddress: string | null;
  token: TipToken;
  amountRaw: string;
  message: string | null;
  fundedFromBitcoin: FundingKind | null;
  txHash: string;
  confirmedAt: string;
}
export interface ExploreCreator {
  username: string;
  displayName: string;
  bio: string;
  avatarUrl: string | null;
  avatarPreset: AvatarPreset | null;
  accent: Accent;
  supporters: number;
  tips: number;
  lastTipAt: string | null;
}
export interface ExploreResponse {
  totals: { creators: number; tips: number; supporters: number; musdRaw: string; mezoRaw: string; fundedFromBitcoin: number };
  creators: ExploreCreator[];
  feed: FeedItem[]; // latest 20
}
export interface SupporterProfile {
  address: string; // checksummed
  label: string; // most recent name used, else short address
  totals: { tips: number; creators: number; musdRaw: string; mezoRaw: string };
  creators: { username: string; displayName: string; avatarUrl: string | null; avatarPreset: AvatarPreset | null; accent: Accent; tips: number; musdRaw: string; mezoRaw: string }[];
  recent: FeedItem[];
}
export type ReportReason = "impersonation" | "scam" | "spam" | "offensive" | "other";

// ---------------------------------------------------------------- x402 (machine payments)
// GET /api/x402/tip/{username}?amount=1.5[&name=&message=]   → 402 PAYMENT-REQUIRED, then 200 X402TipReceipt
// GET /api/x402/info                                          → X402Info
export interface X402TipReceipt {
  tip: TipView;
  settlement: { transaction: string; network: string; payer: string };
}
export interface X402Info {
  enabled: boolean;
  network: "eip155:31611";
  facilitator: string;
  asset: string;
  endpointTemplate: string; // {appUrl}/api/x402/tip/{username}?amount={amount}
}
