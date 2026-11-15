// Exact MUSD amount handling. Wire amounts are decimal strings; never use floating point.
import { formatUnits, parseUnits } from "viem";
import { MUSD_DECIMALS, TIP_LIMITS, TIP_TOKENS, type TipTokenSymbol } from "@/lib/chain/config";
import { HttpError } from "./errors";

const AMOUNT_RE = new RegExp(`^(0|[1-9]\\d{0,12})(\\.\\d{1,${TIP_LIMITS.MAX_DECIMALS}})?$`);

export const MIN_RAW = parseUnits(TIP_LIMITS.MIN, MUSD_DECIMALS);
export const MAX_RAW = parseUnits(TIP_LIMITS.MAX, MUSD_DECIMALS);

/** "5" | "1.25" → base units. Returns null when malformed (format, decimals) or outside TIP_LIMITS. */
export function parseTipAmount(input: unknown): bigint | null {
  if (typeof input !== "string") return null;
  const s = input.trim();
  if (!AMOUNT_RE.test(s)) return null;
  const raw = parseUnits(s, MUSD_DECIMALS);
  if (raw < MIN_RAW || raw > MAX_RAW) return null;
  return raw;
}

export function requireTipAmount(input: unknown, field = "amount"): bigint {
  const raw = parseTipAmount(input);
  if (raw === null)
    throw new HttpError(400, "invalid_amount", `${field} must be between ${TIP_LIMITS.MIN} and ${TIP_LIMITS.MAX} MUSD with at most ${TIP_LIMITS.MAX_DECIMALS} decimals`);
  return raw;
}

/** Base units → canonical decimal string ("5", "1.25"). */
export function formatMusd(raw: bigint): string {
  return formatUnits(raw, MUSD_DECIMALS);
}

/** Smallest tip of `token` in base units (indexer dust threshold). */
export const minRawFor = (token: TipTokenSymbol): bigint => parseUnits(TIP_TOKENS[token].min, TIP_TOKENS[token].decimals);

/** Decimal amount of `token` → base units, within TIP_TOKENS[token].min..max and ≤ 6 decimals; else null. */
export function parseTokenAmount(input: unknown, token: TipTokenSymbol): bigint | null {
  if (typeof input !== "string") return null;
  const s = input.trim();
  if (!AMOUNT_RE.test(s)) return null;
  const t = TIP_TOKENS[token];
  const raw = parseUnits(s, t.decimals);
  if (raw < parseUnits(t.min, t.decimals) || raw > parseUnits(t.max, t.decimals)) return null;
  return raw;
}

export function requireTokenAmount(input: unknown, token: TipTokenSymbol, field = "amount"): bigint {
  const raw = parseTokenAmount(input, token);
  if (raw === null)
    throw new HttpError(400, "invalid_amount", `${field} must be between ${TIP_TOKENS[token].min} and ${TIP_TOKENS[token].max} ${token} with at most ${TIP_LIMITS.MAX_DECIMALS} decimals`);
  return raw;
}

/** Base units of any 18-decimal tip token → canonical decimal string. */
export const formatToken = (raw: bigint, token: TipTokenSymbol = "MUSD"): string => formatUnits(raw, TIP_TOKENS[token].decimals);
