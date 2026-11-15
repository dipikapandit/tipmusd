import { describe, expect, it } from "vitest";
import { parseUnits } from "viem";
import { checkTipAmount, cleanSuggested, normalizeAmountInput, toDecimalString } from "@/lib/client/amount";
import { musdShort, musdNumber } from "@/lib/client/format";

const raw = (s: string) => parseUnits(s, 18);

describe("normalizeAmountInput", () => {
  it("strips separators and leading zeros", () => {
    expect(normalizeAmountInput(" 1,000.50 ")).toBe("1000.50");
    expect(normalizeAmountInput("007")).toBe("7");
    expect(normalizeAmountInput("5.")).toBe("5");
    expect(normalizeAmountInput("")).toBe("");
  });
  it("rejects non-numbers", () => {
    expect(normalizeAmountInput("abc")).toBeNull();
    expect(normalizeAmountInput("1.2.3")).toBeNull();
    expect(normalizeAmountInput("-5")).toBeNull();
    expect(normalizeAmountInput("1e3")).toBeNull();
  });
});

describe("checkTipAmount", () => {
  it("accepts amounts inside TIP_LIMITS", () => {
    const c = checkTipAmount("2.5");
    expect(c.ok && c.value).toBe(raw("2.5"));
    expect(c.ok && c.normalized).toBe("2.5");
    expect(checkTipAmount("0.01").ok).toBe(true);
    expect(checkTipAmount("10,000").ok).toBe(true);
  });
  it("rejects below min, above max, too many decimals", () => {
    expect(checkTipAmount("0.009")).toMatchObject({ ok: false, reason: "too_small" });
    expect(checkTipAmount("10000.01")).toMatchObject({ ok: false, reason: "too_large" });
    expect(checkTipAmount("1.1234567")).toMatchObject({ ok: false, reason: "precision" });
    expect(checkTipAmount("")).toMatchObject({ ok: false, reason: "empty" });
    expect(checkTipAmount("five")).toMatchObject({ ok: false, reason: "format" });
  });
  it("checks against the balance", () => {
    expect(checkTipAmount("5", raw("2.1"))).toMatchObject({ ok: false, reason: "balance" });
    expect(checkTipAmount("2", raw("2.1")).ok).toBe(true);
  });
});

describe("cleanSuggested", () => {
  it("drops invalid, dedupes, sorts, caps at 6", () => {
    expect(cleanSuggested(["10", "5", "5.0", "abc", "1", "25", "50", "100", "3"])).toEqual(["1", "3", "5", "10", "25", "50"]);
  });
});

describe("display formatting", () => {
  it("groups thousands and uses at most 2 decimals", () => {
    expect(musdNumber(raw("1234.567"))).toBe("1,234.57");
    expect(musdShort(raw("5"))).toBe("5");
    expect(musdShort(raw("2.1"))).toBe("2.10");
    expect(toDecimalString(raw("0.000001"))).toBe("0.000001");
  });
});
