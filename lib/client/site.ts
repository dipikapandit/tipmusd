/** Public site facts. `url` comes from NEXT_PUBLIC_APP_URL (falls back to localhost in dev). */
const rawUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";

export const SITE = {
  name: "TipMUSD",
  url: rawUrl.replace(/\/+$/, ""),
  /** "tipmusd.app" — host shown in link previews. */
  host: (() => {
    try {
      return new URL(rawUrl).host;
    } catch {
      return "localhost:3000";
    }
  })(),
  tagline: "The social tipping layer for Mezo",
  description: "One tip link for MUSD or MEZO, straight to your wallet. Supporters with only Bitcoin can pay through Mezo. Runs on Mezo Testnet.",
  themeLight: "#fdfbfa",
  themeDark: "#120d0c",
  brandHex: "#cf3d0b",
} as const;

/** Absolute public tip URL for a username. */
export const tipUrlFor = (username: string) => `${SITE.url}/${encodeURIComponent(username)}`;
