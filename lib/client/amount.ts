import { formatUnits, parseUnits } from "viem";
import { MUSD_DECIMALS, TIP_LIMITS, TIP_TOKENS, type TipTokenSymbol } from "@/lib/chain/config";

/**
 * Tip amount entry. People type "5", "2.5", "1,000". Anything else gets a plain message.
 * Pure, so it is unit tested. All math in base units (bigint) via viem.
 */
export type AmountCheck =
  | { ok: true; value: bigint; normalized: string }
  | { ok: false; reason: "empty" | "format" | "precision" | "too_small" | "too_large" | "balance"; message: string };

export const MIN_RAW = parseUnits(TIP_LIMITS.MIN, MUSD_DECIMALS);
export const MAX_RAW = parseUnits(TIP_LIMITS.MAX, MUSD_DECIMALS);

/** Trim, drop thousands separators/spaces, strip leading zeros. "" for empty, null when it isn't number-shaped. */
export function normalizeAmountInput(raw: string): string | null {
  const t = String(raw ?? "").trim().replace(/[\s,_]/g, "");
  if (t === "") return "";
  if (!/^\d*\.?\d*$/.test(t) || t === ".") return null;
  const [w, f] = t.split(".");
  const whole = (w || "0").replace(/^0+(?=\d)/, "");
  if (f === undefined) return whole;
  return f === "" ? whole : `${whole}.${f}`;
}

/** Parse to base units, or null. Allows up to MUSD_DECIMALS fraction digits. */
export function parseAmount(raw: string): bigint | null {
  const n = normalizeAmountInput(raw);
  if (!n) return null;
  if ((n.split(".")[1] ?? "").length > MUSD_DECIMALS) return null;
  try {
    return parseUnits(n, MUSD_DECIMALS);
  } catch {
    return null;
  }
}

/** Decimal string from base units with trailing zeros trimmed ("5", "2.5"). This is what the API receives. */
export function toDecimalString(raw: bigint): string {
  const s = formatUnits(raw, MUSD_DECIMALS);
  return s.includes(".") ? s.replace(/\.?0+$/, "") : s;
}

const fmtLimit = (s: string) => Number(s).toLocaleString("en-US");

/** Validate a tip amount against the token's limits (TIP_TOKENS; MUSD by default) and optionally the wallet balance. */
export function checkTipAmount(raw: string, balance?: bigint | null, token: TipTokenSymbol = "MUSD"): AmountCheck {
  const info = TIP_TOKENS[token];
  const n = normalizeAmountInput(raw);
  if (n === "") return { ok: false, reason: "empty", message: "Enter an amount." };
  if (n === null) return { ok: false, reason: "format", message: "Use numbers only, like 5 or 2.50." };
  if ((n.split(".")[1] ?? "").length > TIP_LIMITS.MAX_DECIMALS) {
    return { ok: false, reason: "precision", message: `Use at most ${TIP_LIMITS.MAX_DECIMALS} decimal places.` };
  }
  const v = parseAmount(n);
  if (v === null) return { ok: false, reason: "format", message: "Use numbers only, like 5 or 2.50." };
  if (v < parseUnits(info.min, info.decimals)) return { ok: false, reason: "too_small", message: `The smallest tip is ${info.min} ${info.symbol}.` };
  if (v > parseUnits(info.max, info.decimals)) return { ok: false, reason: "too_large", message: `The largest tip is ${fmtLimit(info.max)} ${info.symbol}.` };
  if (balance !== undefined && balance !== null && v > balance) {
    return { ok: false, reason: "balance", message: `That's more ${info.symbol} than this wallet holds.` };
  }
  return { ok: true, value: v, normalized: toDecimalString(v) };
}

/** Clean a list of suggested amounts: valid, unique, ascending, at most MAX_SUGGESTED. */
export function cleanSuggested(list: readonly string[]): string[] {
  const seen = new Map<string, bigint>();
  for (const item of list) {
    const c = checkTipAmount(item);
    if (c.ok && !seen.has(c.normalized)) seen.set(c.normalized, c.value);
  }
  return [...seen.entries()]
    .sort((a, b) => (a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0))
    .slice(0, TIP_LIMITS.MAX_SUGGESTED)
    .map(([k]) => k);
}
