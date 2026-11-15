// User text + link hygiene. Text is always rendered as text (never HTML); this strips characters that can spoof
// or break layouts (control chars, bidi overrides, zero-width joiners used for homoglyph tricks) and caps length.
import type { SocialKind, SocialLink } from "@/lib/api-types";
import { HttpError } from "./errors";

// C0/C1 controls (except \n, handled per field), bidi embeddings/overrides/isolates, zero-width + BOM, line/para separators.
 
const STRIP_RE = new RegExp("[" + "\\u0000-\\u0009\\u000B-\\u001F\\u007F-\\u009F\\u200B-\\u200F\\u202A-\\u202E\\u2028\\u2029\\u2060-\\u2069\\uFEFF" + "]", "g");

export interface CleanOpts {
  max: number;
  /** Keep single newlines (bio / messages). Otherwise all whitespace collapses to single spaces. */
  multiline?: boolean;
}

/** Strip dangerous characters, trim, collapse whitespace, and enforce a max length (in characters). */
export function cleanText(input: unknown, opts: CleanOpts): string {
  let s = String(input ?? "").normalize("NFC").replace(/\r\n?/g, "\n").replace(STRIP_RE, "");
  if (opts.multiline) {
    s = s
      .split("\n")
      .map((l) => l.replace(/[ \t ]+/g, " ").trim())
      .join("\n")
      .replace(/\n{3,}/g, "\n\n");
  } else {
    s = s.replace(/\s+/g, " ");
  }
  s = s.trim();
  return Array.from(s).slice(0, opts.max).join("");
}

/** cleanText that returns null for empty results. */
export function cleanOptional(input: unknown, opts: CleanOpts): string | null {
  if (input === undefined || input === null) return null;
  const s = cleanText(input, opts);
  return s ? s : null;
}

/** Allowed hosts per social kind (subdomains allowed). `website` accepts any https host. */
export const SOCIAL_HOSTS: Record<Exclude<SocialKind, "website">, string[]> = {
  x: ["x.com", "twitter.com"],
  linkedin: ["linkedin.com"],
  github: ["github.com"],
  instagram: ["instagram.com"],
  youtube: ["youtube.com", "youtu.be"],
  telegram: ["t.me"],
  discord: ["discord.gg", "discord.com"],
  farcaster: ["warpcast.com", "farcaster.xyz"],
};
export const SOCIAL_KINDS = ["x", "linkedin", "github", "instagram", "youtube", "telegram", "discord", "farcaster", "website"] as const;
export const MAX_SOCIAL_LINKS = 6;

function hostMatches(host: string, domain: string): boolean {
  return host === domain || host.endsWith(`.${domain}`);
}

/** Validates + normalises one link. Throws 400 invalid_social_link. */
export function cleanSocialLink(link: { kind: string; url: string }): SocialLink {
  const bad = (msg: string) => new HttpError(400, "invalid_social_link", msg, { kind: link.kind });
  if (!(SOCIAL_KINDS as readonly string[]).includes(link.kind)) throw bad("Unknown link type");
  const raw = String(link.url ?? "").trim();
  if (raw.length > 200) throw bad("Link is too long");
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    throw bad("Link must be a full https:// address");
  }
  if (u.protocol !== "https:") throw bad("Links must start with https://");
  if (u.username || u.password) throw bad("Links can't contain credentials");
  const host = u.hostname.toLowerCase().replace(/\.$/, "");
  if (!host.includes(".") || /^[\d.]+$/.test(host) || host.startsWith("[")) throw bad("Link must use a domain name");
  if (link.kind !== "website") {
    const allowed = SOCIAL_HOSTS[link.kind as Exclude<SocialKind, "website">];
    if (!allowed.some((d) => hostMatches(host, d))) throw bad(`That doesn't look like a ${link.kind} link`);
  }
  return { kind: link.kind as SocialKind, url: u.toString() };
}

export function cleanSocialLinks(links: { kind: string; url: string }[] | undefined): SocialLink[] {
  if (!links) return [];
  if (links.length > MAX_SOCIAL_LINKS) throw new HttpError(400, "invalid_social_link", `At most ${MAX_SOCIAL_LINKS} links`);
  const out = links.map(cleanSocialLink);
  const seen = new Set<string>();
  return out.filter((l) => (seen.has(l.url) ? false : (seen.add(l.url), true)));
}

/** ?src= referral tag; anything else is dropped (null), never an error. */
export function cleanSource(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const s = v.trim().toLowerCase();
  return /^[a-z0-9_-]{1,24}$/.test(s) ? s : null;
}
