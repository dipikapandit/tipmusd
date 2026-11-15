import { formatUnits } from "viem";
import { MUSD_DECIMALS } from "@/lib/chain/config";

/** Display-only helpers. Amounts stay bigint / base-unit strings everywhere else. */

export const DASH = "--";

export function toBaseUnits(v: bigint | string | null | undefined): bigint | null {
  if (v === null || v === undefined) return null;
  if (typeof v === "bigint") return v;
  const t = v.trim();
  if (!/^-?\d+$/.test(t)) return null;
  return BigInt(t);
}

/** Round base units to `decimals` places (half up, away from zero) and group the whole part. */
function fixed(wei: bigint, decimals: number): string {
  const neg = wei < 0n;
  let abs = neg ? -wei : wei;
  const unit = 10n ** BigInt(MUSD_DECIMALS - decimals);
  if (decimals < MUSD_DECIMALS) abs = ((abs + unit / 2n) / unit) * unit;
  const s = formatUnits(abs, MUSD_DECIMALS);
  const [whole, frac = ""] = s.split(".");
  const grouped = BigInt(whole).toLocaleString("en-US");
  const f = decimals > 0 ? "." + frac.padEnd(decimals, "0").slice(0, decimals) : "";
  const out = `${grouped}${f}`;
  return neg && /[1-9]/.test(out) ? `-${out}` : out;
}

/** "25.00" (no symbol). Null/invalid → "--". */
export function musdNumber(v: bigint | string | null | undefined, decimals = 2): string {
  const wei = toBaseUnits(v);
  return wei === null ? DASH : fixed(wei, decimals);
}

/** "25.00 MUSD". */
export function musd(v: bigint | string | null | undefined, decimals = 2): string {
  const n = musdNumber(v, decimals);
  return n === DASH ? DASH : `${n} MUSD`;
}

/** Full precision with trailing zeros trimmed: "25.5". */
export function musdExact(v: bigint | string | null | undefined): string {
  const wei = toBaseUnits(v);
  if (wei === null) return DASH;
  const s = formatUnits(wei, MUSD_DECIMALS);
  return s.includes(".") ? s.replace(/\.?0+$/, "") : s;
}




export function btc(v: bigint | null | undefined): string {
  if (v === null || v === undefined) return DASH;
  const s = formatUnits(v, 18);
  const n = Number(s);
  if (n === 0) return "0 BTC";
  if (n < 0.000001) return "<0.000001 BTC";
  return `${n.toLocaleString(undefined, { maximumFractionDigits: 6 })} BTC`;
}

export function shortAddress(a: string | null | undefined): string {
  if (!a) return DASH;
  return a.length > 12 ? `${a.slice(0, 6)}…${a.slice(-4)}` : a;
}
export const shortHash = (h: string | null | undefined) => (h ? `${h.slice(0, 8)}…${h.slice(-6)}` : DASH);

function toDate(v: string | number | Date | null | undefined): Date | null {
  if (v === null || v === undefined || v === "") return null;
  const d = v instanceof Date ? v : new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function formatDate(v: string | number | Date | null | undefined): string {
  const d = toDate(v);
  return d ? d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" }) : DASH;
}

export function formatDateTime(v: string | number | Date | null | undefined): string {
  const d = toDate(v);
  return d ? d.toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : DASH;
}

/** "in 3 days" / "5 minutes ago" / "just now". */
export function relativeTime(v: string | number | Date | null | undefined, now: number = Date.now()): string {
  const d = toDate(v);
  if (!d) return DASH;
  const diff = d.getTime() - now;
  const abs = Math.abs(diff);
  if (abs < 45_000) return "just now";
  const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });
  const units: [Intl.RelativeTimeFormatUnit, number][] = [
    ["day", 86_400_000],
    ["hour", 3_600_000],
    ["minute", 60_000],
  ];
  for (const [unit, ms] of units) {
    if (abs >= ms || unit === "minute") return rtf.format(Math.round(diff / ms), unit);
  }
  return DASH;
}


export function pluralize(n: number, one: string, many = `${one}s`): string {
  return `${n.toLocaleString()} ${n === 1 ? one : many}`;
}


/** "Today" / "Yesterday" / "Mar 4" for grouping. */
export function dayLabel(v: string | number | Date | null | undefined, now: number = Date.now()): string {
  const d = toDate(v);
  if (!d) return DASH;
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  const diffDays = Math.floor((start.getTime() - new Date(d).setHours(0, 0, 0, 0)) / 86_400_000);
  if (diffDays === 0) return "Today";
  if (diffDays === 1) return "Yesterday";
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

/** Two decimals, but whole amounts drop ".00": "5", "2.50", "1,250". Display only. */
export function musdShort(v: bigint | string | null | undefined): string {
  const n = musdNumber(v, 2);
  return n === DASH ? DASH : n.replace(/\.00$/, "");
}

/** Milliseconds from now until `iso` (negative when past). Kept out of render code on purpose. */
export function msUntil(iso: string | null | undefined): number {
  const d = toDate(iso);
  return d ? d.getTime() - Date.now() : Number.POSITIVE_INFINITY;
}

export const nowMs = () => Date.now();
