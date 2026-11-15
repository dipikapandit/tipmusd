import { describe, expect, it } from "vitest";
import { parseTipAmount, parseTipQuery, sanitizeText, X402ValidationError } from "@/lib/server/x402/validate";

describe("x402 request validation", () => {
  it("parses MUSD decimals into 18-decimal base units", () => {
    expect(parseTipAmount("1.5").amountRaw).toBe(1_500_000_000_000_000_000n);
    expect(parseTipAmount("0.01").amountRaw).toBe(10_000_000_000_000_000n);
    expect(parseTipAmount("10000").amountRaw).toBe(10_000n * 10n ** 18n);
    expect(parseTipAmount(" 2 ").amount).toBe("2");
  });

  it.each([undefined, "", "abc", "1e3", "-1", "01", "1.", ".5", "1.1234567", "0x10", "$1", "1,5"])(
    "rejects malformed amount %s",
    (v) => {
      expect(() => parseTipAmount(v)).toThrowError(X402ValidationError);
    },
  );

  it.each(["0", "0.009", "10000.000001", "999999"])("rejects out-of-range amount %s", (v) => {
    try {
      parseTipAmount(v);
      throw new Error("expected failure");
    } catch (e) {
      expect(e).toBeInstanceOf(X402ValidationError);
      expect((e as X402ValidationError).code).toBe("amount_out_of_range");
    }
  });

  it("sanitises name/message: control + bidi chars stripped, trimmed, capped", () => {
    expect(sanitizeText("  hi‮there\u0007 ", 40)).toBe("hithere");
    expect(sanitizeText("   ", 40)).toBeNull();
    expect(sanitizeText(undefined, 40)).toBeNull();
    expect(sanitizeText("x".repeat(500), 280)).toHaveLength(280);
    expect(sanitizeText("<b>bold</b>", 40)).toBe("<b>bold</b>"); // stored as text, rendered as text
  });

  it("normalises username and reads first value of repeated params", () => {
    const q = parseTipQuery("@Alice_1", { amount: ["3", "9999"], name: "Bot", message: "gm", anonymous: "1" });
    expect(q).toMatchObject({ username: "alice_1", amount: "3", name: "Bot", message: "gm", anonymous: true });
  });

  it("rejects malformed usernames", () => {
    expect(() => parseTipQuery("a", { amount: "1" })).toThrowError(X402ValidationError);
    expect(() => parseTipQuery("bad name!", { amount: "1" })).toThrowError(X402ValidationError);
  });

  it("ignores any payTo-like query param (not part of the parsed query)", () => {
    const q = parseTipQuery("alice", { amount: "1", payTo: "0x000000000000000000000000000000000000dEaD" });
    expect(Object.keys(q)).not.toContain("payTo");
  });
});
