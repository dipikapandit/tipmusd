// Query validation for GET /api/x402/tip/{username}. Runs BEFORE any payment is requested or settled, so a bad
// request never costs the payer anything.
import { parseUnits } from "viem";
import { TIP_LIMITS, MUSD_DECIMALS } from "@/lib/chain/config";
import { normalizeUsername, USERNAME_RE } from "@/lib/usernames";

export class X402ValidationError extends Error {
  constructor(
    public code: "invalid_amount" | "amount_out_of_range" | "invalid_username" | "invalid_text",
    message: string,
  ) {
    super(message);
    this.name = "X402ValidationError";
  }
}

export interface X402TipQuery {
  username: string;
  /** MUSD decimal string as given (normalised, no trailing dot). */
  amount: string;
  /** Base units (18 decimals). */
  amountRaw: bigint;
  name: string | null;
  message: string | null;
  anonymous: boolean;
}

const AMOUNT_RE = new RegExp(`^(0|[1-9]\\d{0,9})(\\.\\d{1,${TIP_LIMITS.MAX_DECIMALS}})?$`);

/** Parses a MUSD decimal into base units, enforcing TIP_LIMITS. */
export function parseTipAmount(input: unknown): { amount: string; amountRaw: bigint } {
  if (typeof input !== "string" || !input.trim()) {
    throw new X402ValidationError("invalid_amount", "amount is required, e.g. ?amount=1.5 (MUSD)");
  }
  const amount = input.trim();
  if (!AMOUNT_RE.test(amount)) {
    throw new X402ValidationError(
      "invalid_amount",
      `amount must be a plain MUSD decimal with at most ${TIP_LIMITS.MAX_DECIMALS} decimals, e.g. 1.5`,
    );
  }
  const amountRaw = parseUnits(amount, MUSD_DECIMALS);
  const min = parseUnits(TIP_LIMITS.MIN, MUSD_DECIMALS);
  const max = parseUnits(TIP_LIMITS.MAX, MUSD_DECIMALS);
  if (amountRaw < min || amountRaw > max) {
    throw new X402ValidationError("amount_out_of_range", `amount must be between ${TIP_LIMITS.MIN} and ${TIP_LIMITS.MAX} MUSD`);
  }
  return { amount, amountRaw };
}

/** Strip control/bidi characters, collapse whitespace runs, trim, cap length. Empty → null. Rendered as text only. */
export function sanitizeText(input: unknown, max: number): string | null {
  if (input === undefined || input === null) return null;
  if (typeof input !== "string") throw new X402ValidationError("invalid_text", "name and message must be text");
  const cleaned = input
    // C0/C1 controls except \n, plus bidi overrides/isolates and zero-width chars that can spoof text
    .replace(/[\u0000-\u0009\u000B-\u001F\u007F-\u009F​-‏‪-‮⁦-⁩﻿]/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
  if (!cleaned) return null;
  return Array.from(cleaned).slice(0, max).join("").trim() || null;
}

function single(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}

/**
 * Validates the route input. `params` is the decoded query (first value wins for repeated keys).
 * Username format is checked here; existence/status is checked against the DB by the caller.
 */
export function parseTipQuery(usernameParam: string, params: Record<string, string | string[] | undefined>): X402TipQuery {
  let username: string;
  try {
    username = normalizeUsername(decodeURIComponent(usernameParam));
  } catch {
    throw new X402ValidationError("invalid_username", "Unknown creator");
  }
  if (!USERNAME_RE.test(username)) {
    throw new X402ValidationError("invalid_username", "Unknown creator");
  }
  const { amount, amountRaw } = parseTipAmount(single(params.amount));
  const anon = single(params.anonymous);
  return {
    username,
    amount,
    amountRaw,
    name: sanitizeText(single(params.name), TIP_LIMITS.NAME_MAX),
    message: sanitizeText(single(params.message), TIP_LIMITS.MESSAGE_MAX),
    anonymous: anon === "1" || anon === "true",
  };
}
