import "./setup-env";
import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { issueNonce, verifySiwe } from "@/lib/server/auth";
import { setChainForTests } from "@/lib/server/chain";
import { addSeconds, clock } from "@/lib/server/clock";
import { getPublicCreator } from "@/lib/server/creators";
import { resetDbForTests, type Sql } from "@/lib/server/db";
import {
  changePayoutWallet,
  checkUsername,
  createProfile,
  createTipLink,
  setAvatar,
  updateProfile,
  updateTipLink,
  walletChangeNonce,
} from "@/lib/server/profiles";
import { cleanSocialLinks, cleanText } from "@/lib/server/sanitize";
import { listNotifications } from "@/lib/server/notifications";
import { GET as checkGET } from "@/app/api/usernames/check/route";
import { GET as avatarGET } from "@/app/api/avatars/[username]/route";
import { POST as profilePOST, PATCH as profilePATCH } from "@/app/api/profile/route";
import { CREATOR, CREATOR2, FakeChain, NEW_WALLET, STRANGER, T0, code, makeCreator, params, req, sessionFor } from "./fakes";

const origin = { domain: "localhost:3000", uri: "http://localhost:3000" };
const allowed = { allowedDomains: ["localhost:3000"] };
let sql: Sql;
let chain: FakeChain;

beforeEach(async () => {
  clock.set(() => T0);
  sql = await resetDbForTests();
  chain = new FakeChain();
  setChainForTests(chain);
});

describe("usernames", () => {
  it("rejects invalid and reserved names", async () => {
    expect((await checkUsername(sql, "ab")).reason).toBe("invalid");
    expect((await checkUsername(sql, "Has Space")).reason).toBe("invalid");
    expect((await checkUsername(sql, "admin")).reason).toBe("reserved");
    expect((await checkUsername(sql, "dash_board")).reason).toBe("reserved");
    expect((await checkUsername(sql, "mezo_official_x")).reason).toBe("reserved");
    expect(await checkUsername(sql, "@Prajal")).toEqual({ username: "prajal", available: true });
  });

  it("treats names case-insensitively and blocks duplicates", async () => {
    await makeCreator(sql, CREATOR, "prajal");
    expect((await checkUsername(sql, "PRAJAL")).reason).toBe("taken");
    const s2 = await sessionFor(sql, CREATOR2.address);
    expect(await code(createProfile(sql, s2.session, { username: "Prajal", displayName: "Copy" }))).toBe("username_taken");
  });

  it("allows only one profile per user", async () => {
    const c = await makeCreator(sql, CREATOR, "prajal");
    expect(await code(createProfile(sql, c.session, { username: "other", displayName: "x" }))).toBe("profile_exists");
  });

  it("retires old names on rename: alias redirects and can't be claimed by others", async () => {
    const c = await makeCreator(sql, CREATOR, "oldname");
    await updateProfile(sql, c.session, { username: "newname" });
    expect(await getPublicCreator("oldname", null, sql)).toEqual({ redirectTo: "newname" });
    expect((await checkUsername(sql, "oldname")).reason).toBe("retired");
    const s2 = await sessionFor(sql, CREATOR2.address);
    expect(await code(createProfile(sql, s2.session, { username: "oldname", displayName: "Imposter" }))).toBe("username_retired");
    const notes = await listNotifications(sql, c.session.userId);
    expect(notes.map((n) => n.type)).toContain("username_changed");
  });

  it("limits username changes to once per 30 days", async () => {
    const c = await makeCreator(sql, CREATOR, "first");
    await updateProfile(sql, c.session, { username: "second" });
    clock.set(() => addSeconds(T0, 29 * 86400));
    expect(await code(updateProfile(sql, c.session, { username: "third" }))).toBe("username_change_too_soon");
    clock.set(() => addSeconds(T0, 31 * 86400));
    const p = await updateProfile(sql, c.session, { username: "third" });
    expect(p.username).toBe("third");
  });

  it("username check route reports availability", async () => {
    await makeCreator(sql, CREATOR, "taken_one");
    const r = await checkGET(req("/api/usernames/check?u=Taken_One"));
    expect(await r.json()).toMatchObject({ username: "taken_one", available: false, reason: "taken" });
  });
});

describe("profile create + update", () => {
  it("creates via the route with the signer's wallet as payout wallet", async () => {
    const s = await sessionFor(sql, CREATOR.address);
    const r = await profilePOST(req("/api/profile", { cookie: s.cookie, json: { username: "Maker", displayName: "  The ‮Maker  " } }));
    expect(r.status).toBe(201);
    const p = await r.json();
    expect(p.username).toBe("maker");
    expect(p.displayName).toBe("The Maker");
    expect(p.recipientWallet).toBe(CREATOR.address);
    expect(p.suggestedAmounts).toEqual(["1", "5", "10", "25"]);
    expect(p.tipUrl).toBe("http://localhost:3000/maker");
    const [w] = await sql`SELECT wallet, to_time FROM creator_wallets`;
    expect(w.wallet).toBe(CREATOR.address.toLowerCase());
    expect(w.to_time).toBeNull();
  });

  it("requires a session", async () => {
    const r = await profilePOST(req("/api/profile", { json: { username: "maker", displayName: "x" } }));
    expect(r.status).toBe(401);
  });

  it("normalises suggested amounts (dedup, ascending) and validates the default", async () => {
    const c = await makeCreator(sql);
    const p = await updateProfile(sql, c.session, { suggestedAmounts: ["10", "2.50", "2.5", "1"], defaultAmount: "5.000" });
    expect(p.suggestedAmounts).toEqual(["1", "2.5", "10"]);
    expect(p.defaultAmount).toBe("5");
    expect(await code(updateProfile(sql, c.session, { suggestedAmounts: [] }))).toBe("invalid_amount");
    expect(await code(updateProfile(sql, c.session, { suggestedAmounts: ["1", "2", "3", "4", "5", "6", "7"] }))).toBe("invalid_amount");
    expect(await code(updateProfile(sql, c.session, { suggestedAmounts: ["0.001"] }))).toBe("invalid_amount");
    expect(await code(updateProfile(sql, c.session, { suggestedAmounts: ["1.1234567"] }))).toBe("invalid_amount");
    expect(await code(updateProfile(sql, c.session, { defaultAmount: "20000" }))).toBe("invalid_amount");
  });

  it("validates social links per host, https only, max 6", async () => {
    expect(cleanSocialLinks([{ kind: "x", url: "https://twitter.com/me" }])[0].url).toBe("https://twitter.com/me");
    expect(cleanSocialLinks([{ kind: "youtube", url: "https://www.youtube.com/@me" }])).toHaveLength(1);
    expect(cleanSocialLinks([{ kind: "website", url: "https://my.site/x" }])).toHaveLength(1);
    expect(() => cleanSocialLinks([{ kind: "x", url: "http://x.com/me" }])).toThrow();
    expect(() => cleanSocialLinks([{ kind: "github", url: "https://evil.com/github.com" }])).toThrow();
    expect(() => cleanSocialLinks([{ kind: "x", url: "https://x.com.evil.io/me" }])).toThrow();
    expect(() => cleanSocialLinks([{ kind: "website", url: "javascript:alert(1)" }])).toThrow();
    expect(() => cleanSocialLinks([{ kind: "website", url: "https://user:pw@site.com" }])).toThrow();
    expect(() => cleanSocialLinks(Array.from({ length: 7 }, (_, i) => ({ kind: "website", url: `https://s${i}.com` })))).toThrow();
  });

  it("strips control / bidi characters from text", () => {
    expect(cleanText("a\u0000b‮c​d   e", { max: 50 })).toBe("abcd e");
    expect(cleanText("line1\n\n\n\nline2", { max: 50, multiline: true })).toBe("line1\n\nline2");
    expect(cleanText("x".repeat(100), { max: 10 })).toHaveLength(10);
  });

  it("PATCH route rejects unknown accent via zod", async () => {
    const c = await makeCreator(sql);
    const r = await profilePATCH(req("/api/profile", { method: "PATCH", cookie: c.cookie, json: { accent: "pink" } }));
    expect(r.status).toBe(400);
    const ok = await profilePATCH(req("/api/profile", { method: "PATCH", cookie: c.cookie, json: { accent: "blue", messagesEnabled: false } }));
    expect((await ok.json()).accent).toBe("blue");
  });
});

describe("avatar + campaign links", () => {
  const png = (w: number, h: number) => {
    const b = Buffer.alloc(33);
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(b, 0);
    b.writeUInt32BE(13, 8);
    b.write("IHDR", 12, "latin1");
    b.writeUInt32BE(w, 16);
    b.writeUInt32BE(h, 20);
    return b;
  };
  const dataUrl = (type: string, b: Buffer) => `data:${type};base64,${b.toString("base64")}`;

  it("stores a valid PNG and serves it with immutable caching for the right etag", async () => {
    const c = await makeCreator(sql, CREATOR, "pic");
    const p = await setAvatar(sql, c.session, dataUrl("image/png", png(64, 64)));
    expect(p.avatarUrl).toMatch(/^\/api\/avatars\/pic\?v=[0-9a-f]+$/);
    const v = p.avatarUrl!.split("v=")[1];
    const r = await avatarGET(req(`/api/avatars/pic?v=${v}`), params({ username: "pic" }));
    expect(r.status).toBe(200);
    expect(r.headers.get("content-type")).toBe("image/png");
    expect(r.headers.get("cache-control")).toContain("immutable");
    expect(Buffer.from(await r.arrayBuffer()).equals(png(64, 64))).toBe(true);
  });

  it("rejects mismatched magic bytes, oversize files and oversize dimensions", async () => {
    const c = await makeCreator(sql);
    expect(await code(setAvatar(sql, c.session, dataUrl("image/jpeg", png(10, 10))))).toBe("invalid_image");
    expect(await code(setAvatar(sql, c.session, dataUrl("image/png", Buffer.from("<svg></svg>"))))).toBe("invalid_image");
    expect(await code(setAvatar(sql, c.session, dataUrl("image/png", png(2000, 10))))).toBe("image_too_large");
    const big = Buffer.concat([png(10, 10), Buffer.alloc(210 * 1024)]);
    expect(await code(setAvatar(sql, c.session, dataUrl("image/png", big)))).toBe("image_too_large");
    expect(await code(setAvatar(sql, c.session, "data:image/svg+xml;base64,PHN2Zz4="))).toBe("invalid_image");
  });

  it("creates, dedupes and toggles campaign links", async () => {
    const c = await makeCreator(sql, CREATOR, "camp");
    const l = await createTipLink(sql, c.session, { slug: "Launch-Week", campaignName: "Launch week" });
    expect(l.url).toBe("http://localhost:3000/camp?c=launch-week");
    expect(await code(createTipLink(sql, c.session, { slug: "launch-week", campaignName: "Again" }))).toBe("slug_taken");
    expect(await code(createTipLink(sql, c.session, { slug: "bad slug", campaignName: "x" }))).toBe("invalid_slug");
    const off = await updateTipLink(sql, c.session, l.id, { isActive: false });
    expect(off.isActive).toBe(false);
    const other = await makeCreator(sql, CREATOR2, "other");
    expect(await code(updateTipLink(sql, other.session, l.id, { isActive: true }))).toBe("not_found");
  });
});

describe("payout wallet change", () => {
  it("requires a signature from the NEW wallet, then switches and keeps history", async () => {
    const c = await makeCreator(sql, CREATOR, "walletguy");
    const { message } = await walletChangeNonce(sql, c.session, NEW_WALLET.address, origin);
    expect(message).toContain(`Set ${NEW_WALLET.address} as the payout wallet`);
    expect(message).toContain("Future tips will be sent to this wallet");

    // Signed by the current (old) wallet → rejected.
    const wrong = await CREATOR.signMessage({ message });
    expect(await code(changePayoutWallet(sql, chain, c.session, { address: NEW_WALLET.address, message, signature: wrong }, allowed))).toBe(
      "invalid_signature",
    );

    const signature = await NEW_WALLET.signMessage({ message });
    const p = await changePayoutWallet(sql, chain, c.session, { address: NEW_WALLET.address, message, signature }, allowed);
    expect(p.recipientWallet).toBe(NEW_WALLET.address);
    const rows = await sql<{ wallet: string; to_time: Date | null }>`SELECT wallet, to_time FROM creator_wallets ORDER BY from_time, to_time NULLS LAST`;
    expect(rows).toHaveLength(2);
    expect(rows.find((r) => r.wallet === CREATOR.address.toLowerCase())!.to_time).not.toBeNull();
    expect(rows.find((r) => r.wallet === NEW_WALLET.address.toLowerCase())!.to_time).toBeNull();
    expect((await listNotifications(sql, c.session.userId)).map((n) => n.type)).toContain("wallet_changed");

    // Replay is rejected.
    expect(await code(changePayoutWallet(sql, chain, c.session, { address: NEW_WALLET.address, message, signature }, allowed))).toBe("nonce_used");
  });

  it("a sign-in message can't be used as a wallet-change proof, and nonces are bound to the user", async () => {
    const c = await makeCreator(sql, CREATOR, "boundguy");
    const signIn = await issueNonce(sql, NEW_WALLET.address, origin);
    const sig = await NEW_WALLET.signMessage({ message: signIn.message });
    expect(await code(changePayoutWallet(sql, chain, c.session, { address: NEW_WALLET.address, message: signIn.message, signature: sig }, allowed))).toBe(
      "invalid_message",
    );
    const { message } = await walletChangeNonce(sql, c.session, NEW_WALLET.address, origin);
    const signature = await NEW_WALLET.signMessage({ message });
    const other = await makeCreator(sql, CREATOR2, "otherguy");
    expect(await code(verifySiwe(sql, chain, { address: NEW_WALLET.address, message, signature }, { ...allowed, purpose: "wallet_change", userId: other.session.userId }))).toBe(
      "invalid_nonce",
    );
  });

  it("enforces wallet uniqueness across creators", async () => {
    const a = await makeCreator(sql, CREATOR, "aaa");
    await makeCreator(sql, CREATOR2, "bbb");
    expect(await code(walletChangeNonce(sql, a.session, CREATOR2.address, origin))).toBe("wallet_in_use");
    expect(await code(walletChangeNonce(sql, a.session, CREATOR.address, origin))).toBe("same_wallet");
  });

  it("suspended creators are hidden from the public page", async () => {
    await makeCreator(sql, STRANGER, "badguy");
    await sql`UPDATE creator_profiles SET status = 'suspended' WHERE username = 'badguy'`;
    expect(await getPublicCreator("badguy", null, sql)).toBeNull();
  });
});
