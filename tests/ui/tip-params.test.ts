import { describe, expect, it } from "vitest";
import { cleanText, parseTipParams } from "@/lib/client/tip-params";

describe("parseTipParams", () => {
  it("prefills valid values", () => {
    const p = parseTipParams(new URLSearchParams("amount=5&c=friday-stream&src=QR&msg=great%20work"));
    expect(p).toEqual({ amount: "5", campaign: "friday-stream", source: "qr", message: "great work", token: null });
  });
  it("drops invalid amounts instead of guessing", () => {
    expect(parseTipParams(new URLSearchParams("amount=0")).amount).toBeNull();
    expect(parseTipParams(new URLSearchParams("amount=999999")).amount).toBeNull();
    expect(parseTipParams(new URLSearchParams("amount=1e3")).amount).toBeNull();
    expect(parseTipParams(new URLSearchParams("amount=1.1234567")).amount).toBeNull();
  });
  it("normalises amounts", () => {
    expect(parseTipParams({ amount: "0010.50" }).amount).toBe("10.5");
    expect(parseTipParams({ amount: ["3", "9"] }).amount).toBe("3");
  });
  it("rejects bad campaign and source slugs", () => {
    const p = parseTipParams(new URLSearchParams("c=../x&src=<script>"));
    expect(p.campaign).toBeNull();
    expect(p.source).toBeNull();
  });
  it("has no way to set a recipient", () => {
    const p = parseTipParams(new URLSearchParams("to=0x000000000000000000000000000000000000dEaD&wallet=0xabc&recipient=0xabc"));
    expect(Object.keys(p).sort()).toEqual(["amount", "campaign", "message", "source", "token"]);
    expect(JSON.stringify(p)).not.toContain("0x");
  });
  it("cleans and caps the message", () => {
    expect(cleanText("hi\u0000‮there", 280)).toBe("hithere");
    expect(parseTipParams({ msg: "x".repeat(400) }).message).toHaveLength(280);
  });
});

describe("parseTipParams ?token", () => {
  it("accepts MUSD/MEZO case-insensitively and ignores anything else", () => {
    expect(parseTipParams(new URLSearchParams("token=mezo")).token).toBe("MEZO");
    expect(parseTipParams(new URLSearchParams("token=MUSD")).token).toBe("MUSD");
    expect(parseTipParams(new URLSearchParams("token=0xdead")).token).toBeNull();
  });
  it("validates the amount against the chosen token's limits", () => {
    expect(parseTipParams(new URLSearchParams("token=MEZO&amount=50000")).amount).toBe("50000");
    expect(parseTipParams(new URLSearchParams("amount=50000")).amount).toBeNull(); // over the MUSD max
  });
});
