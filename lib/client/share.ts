import { musdShort } from "./format";

/** Append/replace query params on an absolute or relative URL. */
export function withParams(url: string, params: Record<string, string | null | undefined>): string {
  const u = new URL(url, "https://placeholder.invalid");
  for (const [k, v] of Object.entries(params)) {
    if (v === null || v === undefined || v === "") u.searchParams.delete(k);
    else u.searchParams.set(k, v);
  }
  if (u.origin === "https://placeholder.invalid") return `${u.pathname}${u.search}${u.hash}`;
  return u.toString();
}

/** What a printed/shown QR encodes: the tip link tagged as a QR visit. */
export const qrTarget = (tipUrl: string) => withParams(tipUrl, { src: "qr" });

export type ShareChannel = "x" | "linkedin" | "telegram" | "whatsapp";

export function shareIntents(url: string, text: string): Record<ShareChannel, string> {
  const u = encodeURIComponent(url);
  const t = encodeURIComponent(text);
  return {
    x: `https://x.com/intent/post?text=${t}&url=${u}`,
    linkedin: `https://www.linkedin.com/sharing/share-offsite/?url=${u}`,
    telegram: `https://t.me/share/url?url=${u}&text=${t}`,
    whatsapp: `https://wa.me/?text=${encodeURIComponent(`${text} ${url}`)}`,
  };
}

export const creatorShareText = (displayName?: string | null) =>
  displayName ? `Support ${displayName} with a tip in MUSD` : "Tip me in MUSD";

export const tippedShareText = (displayName: string, amountRaw?: string | null) =>
  amountRaw ? `I just tipped ${displayName} ${musdShort(amountRaw)} MUSD.` : `I just tipped ${displayName} in MUSD.`;

const escAttr = (s: string) => s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** A plain HTML button for any website. No script, no tracking: just a link with inline styles. */
export function embedSnippet(tipUrl: string, label = "Tip me in MUSD", color = "#cf3d0b"): string {
  const href = withParams(tipUrl, { src: "embed" });
  return `<a href="${escAttr(href)}" target="_blank" rel="noopener" style="display:inline-block;padding:12px 20px;border-radius:999px;background:${escAttr(color)};color:#fff;font:600 15px/1 system-ui,sans-serif;text-decoration:none">${escAttr(label)}</a>`;
}
