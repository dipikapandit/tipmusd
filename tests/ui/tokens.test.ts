import { describe, expect, it } from "vitest";
import { parseUnits } from "viem";
import { MEZO_TESTNET_ID, MEZO_TOKEN, MUSD } from "@/lib/chain/config";
import { checkTipAmount } from "@/lib/client/amount";
import { defaultAmountFor, limitsHint, paymentMismatch, presetsFor, resolveToken, tokenInfo, tokenOptions } from "@/lib/client/tokens";

const creator = { acceptMezo: true, suggestedAmounts: ["1", "5", "10"], defaultAmount: "5" };
const r = "0x00000000000000000000000000000000000000Aa";

describe("token switch", () => {
  it("offers MEZO only when the creator accepts it", () => {
    expect(tokenOptions(creator)).toEqual(["MUSD", "MEZO"]);
    expect(tokenOptions({ acceptMezo: false })).toEqual(["MUSD"]);
    expect(resolveToken("mezo", creator)).toBe("MEZO");
    expect(resolveToken("MEZO", { acceptMezo: false })).toBe("MUSD");
    expect(resolveToken(null, creator)).toBe("MUSD");
  });
  it("uses creator amounts for MUSD and fixed presets for MEZO", () => {
    expect(presetsFor("MUSD", creator)).toEqual(["1", "5", "10"]);
    expect(presetsFor("MEZO", creator)).toEqual(["10", "50", "100", "500"]);
    expect(defaultAmountFor("MUSD", creator)).toBe("5");
    expect(defaultAmountFor("MEZO", creator)).toBe("50");
  });
  it("checks amounts against the token's limits", () => {
    expect(checkTipAmount("0.05", undefined, "MEZO")).toMatchObject({ ok: false, reason: "too_small" });
    expect(checkTipAmount("0.05", undefined, "MUSD").ok).toBe(true);
    expect(checkTipAmount("50000", undefined, "MEZO").ok).toBe(true);
    expect(checkTipAmount("50000", undefined, "MUSD")).toMatchObject({ ok: false, reason: "too_large" });
    expect(checkTipAmount("5", parseUnits("1", 18), "MEZO")).toMatchObject({ reason: "balance", message: expect.stringContaining("MEZO") });
    expect(limitsHint("MEZO")).toBe("Between 0.1 and 1,000,000 MEZO.");
    expect(tokenInfo("MEZO").address).toBe(MEZO_TOKEN);
    expect(tokenInfo(null).address).toBe(MUSD);
  });
  it("rejects a payment whose token doesn't match the switch", () => {
    const payment = { chainId: MEZO_TESTNET_ID, token: MEZO_TOKEN, tokenSymbol: "MEZO" as const, recipient: r, amountRaw: "50", dataSuffix: "0x7469706d00" as const };
    const exp = { chainId: MEZO_TESTNET_ID, token: "MEZO" as const, recipient: r.toLowerCase(), amountRaw: 50n };
    expect(paymentMismatch(payment, exp)).toBeNull();
    expect(paymentMismatch({ ...payment, token: MUSD }, exp)).toBe("token");
    expect(paymentMismatch(payment, { ...exp, token: "MUSD" })).toBe("token");
    expect(paymentMismatch({ ...payment, amountRaw: "51" }, exp)).toBe("amount");
    expect(paymentMismatch({ ...payment, recipient: MUSD }, exp)).toBe("recipient");
  });
});

describe("perTokenTotals", () => {
  it("keeps tokens separate and hides zeros", async () => {
    const { perTokenTotals } = await import("@/lib/client/tokens");
    const m = (s: string) => parseUnits(s, 18).toString();
    expect(perTokenTotals(m("12.5"), m("100"))).toBe("12.50 MUSD and 100 MEZO");
    expect(perTokenTotals(m("5"), "0")).toBe("5 MUSD");
    expect(perTokenTotals("0", m("1"))).toBe("1 MEZO");
    expect(perTokenTotals("0", null)).toBe("--");
  });
});
