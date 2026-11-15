import { describe, expect, it } from "vitest";
import { embedSnippet, qrTarget, shareIntents, tippedShareText, withParams } from "@/lib/client/share";
import { stripScheme, walletDeepLinks } from "@/lib/client/deeplinks";

describe("share helpers", () => {
  it("tags QR links with src=qr", () => {
    expect(qrTarget("https://tipmusd.app/ada")).toBe("https://tipmusd.app/ada?src=qr");
    expect(qrTarget("https://tipmusd.app/ada?c=talk")).toBe("https://tipmusd.app/ada?c=talk&src=qr");
    expect(withParams("/start", { a: "1", b: null })).toBe("/start?a=1");
  });
  it("builds encoded share intents", () => {
    const i = shareIntents("https://tipmusd.app/ada", "I just tipped Ada 5 MUSD.");
    expect(i.x).toBe("https://x.com/intent/post?text=I%20just%20tipped%20Ada%205%20MUSD.&url=https%3A%2F%2Ftipmusd.app%2Fada");
    expect(i.linkedin).toContain("url=https%3A%2F%2Ftipmusd.app%2Fada");
    expect(i.telegram.startsWith("https://t.me/share/url?url=")).toBe(true);
    expect(decodeURIComponent(i.whatsapp)).toContain("I just tipped Ada 5 MUSD. https://tipmusd.app/ada");
  });
  it("formats the tipped text", () => {
    expect(tippedShareText("Ada", "5000000000000000000")).toBe("I just tipped Ada 5 MUSD.");
  });
  it("escapes the embed snippet", () => {
    const s = embedSnippet('https://tipmusd.app/ada"><script>', "Tip <me>");
    expect(s).not.toContain("<script>");
    expect(s).toContain("&lt;me&gt;");
    expect(s).toContain("src=embed");
  });
  it("builds wallet deep links", () => {
    expect(stripScheme("https://tipmusd.app/ada?amount=5")).toBe("tipmusd.app/ada?amount=5");
    const mm = walletDeepLinks("https://tipmusd.app/ada?amount=5").find((l) => l.id === "metamask");
    expect(mm?.href).toBe("https://metamask.app.link/dapp/tipmusd.app/ada?amount=5");
  });
});
