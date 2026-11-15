// FROZEN. Username rules shared by UI and API.
export const USERNAME_RE = /^[a-z0-9](?:[a-z0-9_]{1,28}[a-z0-9])$/;

/** Top-level routes + impersonation-prone names. Compared after lowercasing and stripping "_". */
export const RESERVED_USERNAMES = new Set([
  // routes
  "api", "app", "start", "dashboard", "tip", "tips", "developers", "developer", "docs", "embed", "login", "logout",
  "signin", "signup", "register", "settings", "account", "profile", "explore", "discover", "about", "faq", "pricing",
  "terms", "privacy", "legal", "security", "status", "health", "robots", "sitemap", "manifest", "favicon", "icon",
  "static", "assets", "public", "next", "x402", "qr", "share", "receipt", "receipts", "new", "create", "edit", "null",
  "undefined", "home", "index", "blog", "careers", "jobs", "press", "contact", "report", "abuse",
  // impersonation-prone
  "admin", "administrator", "root", "support", "help", "helpdesk", "official", "staff", "team", "mod", "moderator",
  "system", "tipmusd", "mezo", "mezoorg", "mezolabs", "musd", "bitcoin", "btc", "wallet", "metamask", "verify",
  "verified", "security", "billing", "payments", "payment", "refund", "refunds", "claim", "airdrop", "giveaway",
  "owner", "founder", "ceo", "anthropic", "claude",
]);

export function normalizeUsername(input: string): string {
  return String(input ?? "").trim().replace(/^@/, "").toLowerCase();
}

export type UsernameProblem = "invalid" | "reserved";

export function usernameProblem(u: string): UsernameProblem | null {
  if (!USERNAME_RE.test(u)) return "invalid";
  if (RESERVED_USERNAMES.has(u) || RESERVED_USERNAMES.has(u.replace(/_/g, ""))) return "reserved";
  if (/^(mezo|tipmusd|musd)_?(official|team|support|admin|help)/.test(u)) return "reserved";
  return null;
}

export const USERNAME_HINT = "3–30 characters: lowercase letters, numbers and underscores.";
