import { TIP_LIMITS, type TipTokenSymbol } from "@/lib/chain/config";
import { checkTipAmount } from "./amount";

/**
 * Query params a tip link may carry. They only prefill the form; they can NEVER change the recipient
 * (the recipient always comes from the server, by username). Unknown params such as `to` or `wallet` are ignored.
 *   ?amount=5   prefill amount (must pass TIP_LIMITS, otherwise dropped)
 *   ?c=slug     campaign link slug
 *   ?src=qr     referral source
 *   ?msg=...    prefill message
 *   ?token=MEZO preselect MEZO (only if the creator accepts it; the amount is validated against that token)
 */
export interface TipParams {
  amount: string | null;
  campaign: string | null;
  source: string | null;
  message: string | null;
  token: TipTokenSymbol | null;
}

type ParamSource = URLSearchParams | Record<string, string | string[] | undefined>;

function first(p: ParamSource, key: string): string | null {
  if (p instanceof URLSearchParams) return p.get(key);
  const v = p[key];
  if (Array.isArray(v)) return v[0] ?? null;
  return v ?? null;
}

export const SOURCE_RE = /^[a-z0-9_-]{1,24}$/;
export const CAMPAIGN_RE = /^[a-z0-9][a-z0-9-]{0,39}$/;

/** Strip control characters, collapse whitespace runs, trim, cap length. */
export function cleanText(v: string | null | undefined, max: number): string {
  if (!v) return "";
  const noCtl = v.replace(/[\u0000-\u0008\u000B-\u001F\u007F-\u009F​-‏‪-‮⁦-⁩]/g, "");
  return noCtl.replace(/[ \t]+/g, " ").trim().slice(0, max);
}

export function parseTipParams(p: ParamSource): TipParams {
  const t = first(p, "token")?.trim().toUpperCase() ?? "";
  const token: TipTokenSymbol | null = t === "MEZO" || t === "MUSD" ? t : null;
  const rawAmount = first(p, "amount");
  let amount: string | null = null;
  if (rawAmount) {
    const c = checkTipAmount(rawAmount.slice(0, 32), undefined, token ?? "MUSD");
    if (c.ok) amount = c.normalized;
  }
  const c = first(p, "c")?.trim().toLowerCase() ?? "";
  const s = first(p, "src")?.trim().toLowerCase() ?? "";
  const m = cleanText(first(p, "msg"), TIP_LIMITS.MESSAGE_MAX);
  return {
    amount,
    campaign: CAMPAIGN_RE.test(c) ? c : null,
    source: SOURCE_RE.test(s) ? s : null,
    message: m || null,
    token,
  };
}
