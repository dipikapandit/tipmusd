// Small row → wire helpers for the v2 tip token and Bitcoin-funding columns (no imports from other server modules,
// so tips/creators/social/dashboard can all use them without import cycles).
import type { FundingKind, TipFunding, TipToken } from "@/lib/api-types";
import { tipTokenByAddress } from "@/lib/chain/config";

/** Tip token symbol for a stored token address (MUSD for anything unexpected; such rows can't be created). */
export const tokenOf = (address: unknown): TipToken => tipTokenByAddress(typeof address === "string" ? address : null)?.symbol ?? "MUSD";

/** Funding as stored, with the server's verification flag (creator/supporter views), or null. */
export function fundingOf(r: Record<string, unknown>): TipFunding | null {
  const kind = (r.funding_kind as FundingKind | null) ?? null;
  if (!kind) return null;
  return { kind, txHash: typeof r.funding_tx_hash === "string" ? r.funding_tx_hash : null, verified: r.funding_verified === true };
}

/** Public surfaces only ever show VERIFIED funding. */
export const fundedFromBitcoin = (r: Record<string, unknown>): FundingKind | null =>
  r.funding_verified === true && r.funding_kind ? (r.funding_kind as FundingKind) : null;
