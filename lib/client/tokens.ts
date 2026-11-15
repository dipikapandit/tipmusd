import { TIP_LIMITS, TIP_TOKENS, type TipTokenInfo, type TipTokenSymbol } from "@/lib/chain/config";
import type { TipIntent, TipToken } from "@/lib/api-types";
import { checkTipAmount } from "./amount";
import { DASH, musdShort, toBaseUnits } from "./format";

/**
 * Token choice on the tip page. Pure, so it is unit tested.
 * MUSD uses the creator's own amounts; MEZO has no USD peg, so it uses fixed presets and its own limits.
 */

type CreatorAmounts = { acceptMezo: boolean; suggestedAmounts: string[]; defaultAmount: string };

/** Tokens the supporter can pick for this creator, MUSD first. */
export function tokenOptions(creator: Pick<CreatorAmounts, "acceptMezo">): TipToken[] {
  return creator.acceptMezo ? ["MUSD", "MEZO"] : ["MUSD"];
}

/** A token from the URL or state, falling back to MUSD when the creator doesn't take it. */
export function resolveToken(wanted: string | null | undefined, creator: Pick<CreatorAmounts, "acceptMezo">): TipToken {
  const up = String(wanted ?? "").toUpperCase();
  return up === "MEZO" && creator.acceptMezo ? "MEZO" : "MUSD";
}

/** Amount chips for the token, valid for its limits only. */
export function presetsFor(token: TipToken, creator: Pick<CreatorAmounts, "suggestedAmounts">): string[] {
  const list = TIP_TOKENS[token].presets ?? creator.suggestedAmounts;
  return list.filter((a) => checkTipAmount(a, undefined, token).ok);
}

/** The amount pre-filled when switching to `token`. */
export function defaultAmountFor(token: TipToken, creator: Pick<CreatorAmounts, "suggestedAmounts" | "defaultAmount">): string {
  if (token === "MUSD") return creator.defaultAmount || TIP_LIMITS.DEFAULT_AMOUNT;
  const presets = presetsFor(token, creator);
  return presets[1] ?? presets[0] ?? TIP_TOKENS[token].min;
}

/** "Between 0.1 and 1,000,000 MEZO." */
export function limitsHint(token: TipToken): string {
  const t = TIP_TOKENS[token];
  return `Between ${t.min} and ${Number(t.max).toLocaleString("en-US")} ${t.symbol}.`;
}

export const tokenInfo = (token: TipToken | null | undefined): TipTokenInfo => TIP_TOKENS[(token ?? "MUSD") as TipTokenSymbol] ?? TIP_TOKENS.MUSD;

/**
 * Defence in depth before the wallet opens: the server's payment must be exactly what this page shows,
 * including the token contract. Returns a reason when it doesn't match, null when it does.
 */
export function paymentMismatch(
  payment: TipIntent["payment"],
  expected: { chainId: number; token: TipToken; recipient: string; amountRaw: bigint },
): string | null {
  if (payment.chainId !== expected.chainId) return "chain";
  if (payment.tokenSymbol !== expected.token) return "token";
  if (payment.token.toLowerCase() !== TIP_TOKENS[expected.token].address.toLowerCase()) return "token";
  if (payment.recipient.toLowerCase() !== expected.recipient.toLowerCase()) return "recipient";
  if (BigInt(payment.amountRaw) !== expected.amountRaw) return "amount";
  if (!/^0x[0-9a-fA-F]+$/.test(payment.dataSuffix)) return "suffix";
  return null;
}

/** Per-token totals, never added together: "12.50 MUSD and 100 MEZO", "5 MUSD", "--" when both are zero. */
export function perTokenTotals(musdRaw: string | bigint | null | undefined, mezoRaw: string | bigint | null | undefined): string {
  const parts: string[] = [];
  const m = toBaseUnits(musdRaw ?? null) ?? 0n;
  const z = toBaseUnits(mezoRaw ?? null) ?? 0n;
  if (m > 0n) parts.push(`${musdShort(m)} MUSD`);
  if (z > 0n) parts.push(`${musdShort(z)} MEZO`);
  return parts.length ? parts.join(" and ") : DASH;
}
