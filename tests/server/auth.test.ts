import "./setup-env";
import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { issueNonce, sessionFromRequest, SESSION_COOKIE, verifySignIn } from "@/lib/server/auth";
import { setChainForTests } from "@/lib/server/chain";
import { addSeconds, clock } from "@/lib/server/clock";
import { resetDbForTests, type Sql } from "@/lib/server/db";
import { GET as nonceGET } from "@/app/api/auth/nonce/route";
import { POST as verifyPOST } from "@/app/api/auth/verify/route";
import { GET as meGET } from "@/app/api/auth/me/route";
import { POST as logoutPOST } from "@/app/api/auth/logout/route";
import { CREATOR, FakeChain, STRANGER, T0, code, req } from "./fakes";

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

describe("SIWE sign-in", () => {
  it("signs in once and rejects replay of the same nonce", async () => {
    const { message } = await issueNonce(sql, CREATOR.address, origin);
    expect(message).toContain("Sign in to TipMUSD");
    expect(message).toContain("Chain ID: 31611");
    const signature = await CREATOR.signMessage({ message });
    const s = await verifySignIn(sql, chain, { address: CREATOR.address, message, signature }, allowed);
    expect(s.address).toBe(CREATOR.address.toLowerCase());
    expect(await code(verifySignIn(sql, chain, { address: CREATOR.address, message, signature }, allowed))).toBe("nonce_used");
  });

  it("rejects a bad signature (another wallet signed)", async () => {
    const { message } = await issueNonce(sql, CREATOR.address, origin);
    const signature = await STRANGER.signMessage({ message });
    expect(await code(verifySignIn(sql, chain, { address: CREATOR.address, message, signature }, allowed))).toBe("invalid_signature");
  });

  it("rejects an expired nonce/message", async () => {
    const { message } = await issueNonce(sql, CREATOR.address, origin);
    const signature = await CREATOR.signMessage({ message });
    clock.set(() => addSeconds(T0, 601));
    expect(await code(verifySignIn(sql, chain, { address: CREATOR.address, message, signature }, allowed))).toBe("message_expired");
  });

  it("rejects a message created for another domain", async () => {
    const { message } = await issueNonce(sql, CREATOR.address, { domain: "evil.example", uri: "https://evil.example" });
    const signature = await CREATOR.signMessage({ message });
    expect(await code(verifySignIn(sql, chain, { address: CREATOR.address, message, signature }, allowed))).toBe("domain_mismatch");
  });

  it("rejects a message for another chain", async () => {
    const { message } = await issueNonce(sql, CREATOR.address, origin);
    const tampered = message.replace("Chain ID: 31611", "Chain ID: 1");
    const signature = await CREATOR.signMessage({ message: tampered });
    expect(await code(verifySignIn(sql, chain, { address: CREATOR.address, message: tampered, signature }, allowed))).toBe("wrong_chain");
  });

  it("rejects a forged nonce that was never issued", async () => {
    const { message } = await issueNonce(sql, CREATOR.address, origin);
    const forged = message.replace(/Nonce: [0-9a-f]+/, "Nonce: deadbeefdeadbeefdeadbeefdeadbeef");
    const signature = await CREATOR.signMessage({ message: forged });
    expect(await code(verifySignIn(sql, chain, { address: CREATOR.address, message: forged, signature }, allowed))).toBe("invalid_nonce");
  });

  it("falls back to ERC-1271/6492 for smart accounts", async () => {
    const { message } = await issueNonce(sql, CREATOR.address, origin);
    const spy = vi.spyOn(chain, "verifySmartSignature").mockResolvedValue(true);
    const s = await verifySignIn(sql, chain, { address: CREATOR.address, message, signature: "0x1234" }, allowed);
    expect(spy).toHaveBeenCalledOnce();
    expect(s.userId).toBeTruthy();
  });

  it("works end to end through the routes (cookie, me, logout)", async () => {
    const n = await nonceGET(req(`/api/auth/nonce?address=${CREATOR.address}`));
    expect(n.status).toBe(200);
    const { message } = await n.json();
    const signature = await CREATOR.signMessage({ message });
    const v = await verifyPOST(req("/api/auth/verify", { json: { address: CREATOR.address, message, signature } }));
    expect(v.status).toBe(200);
    const body = await v.json();
    expect(body.profile).toBeNull();
    expect(body.user.address).toBe(CREATOR.address);
    const setCookie = v.headers.get("set-cookie")!;
    expect(setCookie.startsWith(`${SESSION_COOKIE}=`)).toBe(true);
    expect(setCookie).toContain("HttpOnly");
    expect(setCookie).toContain("SameSite=Lax");
    const cookie = setCookie.split(";")[0];
    const meRes = await meGET(req("/api/auth/me", { cookie }));
    expect(meRes.status).toBe(200);
    expect((await meGET(req("/api/auth/me"))).status).toBe(401);
    await logoutPOST(req("/api/auth/logout", { method: "POST", cookie }));
    expect(await sessionFromRequest(sql, req("/", { cookie }))).toBeNull();
  });

  it("blocks cross-site POSTs by Origin", async () => {
    const r = await verifyPOST(req("/api/auth/verify", { json: {}, headers: { origin: "https://evil.example" } }));
    expect(r.status).toBe(403);
  });
});
