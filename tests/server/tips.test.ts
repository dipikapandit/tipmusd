import "./setup-env";
import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { encodeFunctionData, getAddress } from "viem";
import type { TipIntent } from "@/lib/api-types";
import { erc20Abi } from "@/lib/chain/abis";
import { MUSD } from "@/lib/chain/config";
import { setChainForTests } from "@/lib/server/chain";
import { addSeconds, clock } from "@/lib/server/clock";
import { resetDbForTests, type Sql } from "@/lib/server/db";
import { createTip, patchTip, readTip, submitTip, sweepTips } from "@/lib/server/tips";
import { verifyTip, expectedTipCalldata } from "@/lib/server/verify";
import { listNotifications } from "@/lib/server/notifications";
import { POST as tipsPOST } from "@/app/api/tips/route";
import { POST as submitPOST } from "@/app/api/tips/[id]/submit/route";
import { GET as tipGET, PATCH as tipPATCH } from "@/app/api/tips/[id]/route";
import { CREATOR, E18, FakeChain, STRANGER, SUPPORTER, T0, code, makeCreator, params, req, transferLog, txHash } from "./fakes";

let sql: Sql;
let chain: FakeChain;
let creator: Awaited<ReturnType<typeof makeCreator>>;

beforeEach(async () => {
  clock.set(() => T0);
  sql = await resetDbForTests();
  chain = new FakeChain();
  setChainForTests(chain);
  creator = await makeCreator(sql, CREATOR, "alice");
});

const intent = (over: Record<string, unknown> = {}): Promise<TipIntent> =>
  createTip(sql, { username: "alice", amount: "5", supporterName: "Bob", message: "gm", ...over });

describe("intent creation", () => {
  it("returns exact payment params from the DB (recipient, raw amount, ref suffix)", async () => {
    const i = await intent({ amount: "1.25" });
    expect(i.payment.recipient).toBe(CREATOR.address);
    expect(i.payment.token).toBe(getAddress(MUSD));
    expect(i.payment.chainId).toBe(31611);
    expect(i.payment.amountRaw).toBe((125n * E18) / 100n + "");
    expect(i.payment.dataSuffix).toMatch(/^0x7469706d[0-9a-f]{32}$/);
    expect(i.tip.status).toBe("created");
    expect(i.tip.expiresAt).toBe(addSeconds(T0, 1800).toISOString());
  });

  it("validates amounts exactly", async () => {
    for (const bad of ["0", "0.009", "10000.01", "1.1234567", "1e3", "-1", " ", "abc", "01"])
      expect(await code(intent({ amount: bad })), bad).toBe("invalid_amount");
    expect((await intent({ amount: "0.01" })).payment.amountRaw).toBe((E18 / 100n).toString());
    expect((await intent({ amount: "10000" })).payment.amountRaw).toBe((10000n * E18).toString());
  });

  it("respects creator settings and suspension", async () => {
    await sql`UPDATE creator_profiles SET anonymous_tips_enabled = FALSE, messages_enabled = FALSE`;
    expect(await code(intent({ isAnonymous: true, message: undefined }))).toBe("anonymous_disabled");
    expect(await code(intent({ message: "hi" }))).toBe("messages_disabled");
    await sql`UPDATE creator_profiles SET status = 'suspended'`;
    expect(await code(intent({ message: undefined }))).toBe("not_found");
  });

  it("anonymous tips never store a name", async () => {
    const i = await intent({ isAnonymous: true });
    expect(i.tip.supporterName).toBeNull();
    expect(i.tip.isAnonymous).toBe(true);
  });

  it("route returns 201 and rejects invalid bodies", async () => {
    const r = await tipsPOST(req("/api/tips", { json: { username: "alice", amount: "2" } }));
    expect(r.status).toBe(201);
    const bad = await tipsPOST(req("/api/tips", { json: { username: "alice", amount: 2 } }));
    expect(bad.status).toBe(400);
  });
});

describe("verification matrix", () => {
  it("confirms a correct payment, records the event and notifies once", async () => {
    const i = await intent();
    await patchTip(sql, i.tip.id, { status: "awaiting_wallet" });
    const hash = chain.payIntent(i);
    const v = await submitTip(sql, chain, i.tip.id, hash);
    expect(v.status).toBe("confirmed");
    expect(v.amountRaw).toBe((5n * E18).toString());
    expect(v.senderAddress).toBe(SUPPORTER.address);
    expect(v.thankYouMessage).toBeNull(); // none set
    const ev = await sql`SELECT tip_id FROM blockchain_events`;
    expect(ev).toHaveLength(1);
    expect(ev[0].tip_id).toBe(i.tip.id);
    const notes = await listNotifications(sql, creator.session.userId);
    expect(notes.filter((n) => n.type === "tip_received")).toHaveLength(1);
  });

  it("reverted → failed/reverted", async () => {
    const i = await intent();
    const hash = chain.payIntent(i, { status: "reverted" });
    const v = await submitTip(sql, chain, i.tip.id, hash);
    expect([v.status, v.failureReason]).toEqual(["failed", "reverted"]);
  });

  it("wrong token contract → failed/wrong_token and the hash is released", async () => {
    const i = await intent();
    const fake = "0x9999999999999999999999999999999999999999";
    const hash = chain.payIntent(i, { to: fake });
    const v = await submitTip(sql, chain, i.tip.id, hash);
    expect([v.status, v.failureReason, v.txHash]).toEqual(["failed", "wrong_token", null]);
  });

  it("wrong recipient → failed/recipient_mismatch", async () => {
    const i = await intent();
    const hash = chain.payIntent(i, { recipient: STRANGER.address });
    const v = await submitTip(sql, chain, i.tip.id, hash);
    expect([v.status, v.failureReason]).toEqual(["failed", "recipient_mismatch"]);
  });

  it("amount differs from the intent → failed/amount_mismatch", async () => {
    const i = await intent();
    const hash = chain.payIntent(i, { amount: 4n * E18 });
    const v = await submitTip(sql, chain, i.tip.id, hash);
    expect([v.status, v.failureReason]).toEqual(["failed", "amount_mismatch"]);
  });

  it("log value differs even though calldata matched → failed/amount_mismatch", async () => {
    const i = await intent();
    const hash = chain.payIntent(i, { logValue: 1n });
    const v = await submitTip(sql, chain, i.tip.id, hash);
    expect([v.status, v.failureReason]).toEqual(["failed", "amount_mismatch"]);
  });

  it("missing / foreign ref suffix → failed/calldata_mismatch (someone else's tx can't be claimed)", async () => {
    const i = await intent();
    const plain = encodeFunctionData({ abi: erc20Abi, functionName: "transfer", args: [CREATOR.address, 5n * E18] });
    const h1 = chain.payIntent(i, { input: plain });
    const v1 = await submitTip(sql, chain, i.tip.id, h1);
    expect([v1.status, v1.failureReason]).toEqual(["failed", "calldata_mismatch"]);

    const other = await intent();
    const theirs = chain.payIntent(other); // a real tip tx for another intent
    const mine = await intent();
    const v2 = await submitTip(sql, chain, mine.tip.id, theirs);
    expect([v2.status, v2.failureReason, v2.txHash]).toEqual(["failed", "calldata_mismatch", null]);
    // The rightful intent can still claim it.
    expect((await submitTip(sql, chain, other.tip.id, theirs)).status).toBe("confirmed");
  });

  it("duplicate tx hash on a second intent → 409 duplicate_tx (route)", async () => {
    const i = await intent();
    const hash = chain.payIntent(i);
    const r1 = await submitPOST(req(`/api/tips/${i.tip.id}/submit`, { json: { txHash: hash } }), params({ id: i.tip.id }));
    expect((await r1.json()).status).toBe("confirmed");
    const j = await intent();
    const r2 = await submitPOST(req(`/api/tips/${j.tip.id}/submit`, { json: { txHash: hash } }), params({ id: j.tip.id }));
    expect(r2.status).toBe(409);
    expect((await r2.json()).error.code).toBe("duplicate_tx");
  });

  it("re-submitting the same hash is idempotent; a different hash is rejected", async () => {
    const i = await intent();
    const hash = chain.payIntent(i);
    const a = await submitTip(sql, chain, i.tip.id, hash);
    const b = await submitTip(sql, chain, i.tip.id, hash.toUpperCase().replace("0X", "0x"));
    expect(a.status).toBe("confirmed");
    expect(b.status).toBe("confirmed");
    expect(await code(submitTip(sql, chain, i.tip.id, txHash()))).toBe("tx_already_submitted");
    expect((await listNotifications(sql, creator.session.userId)).filter((n) => n.type === "tip_received")).toHaveLength(1);
  });

  it("concurrent verifiers confirm exactly once", async () => {
    const i = await intent();
    const hash = chain.pending(txHash(), "0x");
    await submitTip(sql, chain, i.tip.id, hash); // no receipt yet → submitted
    chain.txs.delete(hash);
    // now mine it with the real calldata under the same hash
    chain.mine({ hash, input: expectedTipCalldata(CREATOR.address, 5n * E18, i.payment.dataSuffix.slice(-32)), logs: (m) => [transferLog(SUPPORTER.address, CREATOR.address, 5n * E18, m)] });
    const results = await Promise.all([1, 2, 3, 4].map(() => verifyTip(sql, chain, i.tip.id)));
    expect(results.every((r) => r.status === "confirmed")).toBe(true);
    const [{ n }] = await sql<{ n: number }>`SELECT count(*)::int AS n FROM notifications WHERE type = 'tip_received'`;
    expect(Number(n)).toBe(1);
    const [{ e }] = await sql<{ e: number }>`SELECT count(*)::int AS e FROM blockchain_events`;
    expect(Number(e)).toBe(1);
  });

  it("waits for confirmations when CONFIRMATIONS > 1", async () => {
    process.env.CONFIRMATIONS = "3";
    try {
      const i = await intent();
      const hash = chain.payIntent(i); // mined at head (1 confirmation)
      const v = await submitTip(sql, chain, i.tip.id, hash);
      expect(v.status).toBe("pending_confirmation");
      expect(v.confirmations).toBe(1);
      expect(v.requiredConfirmations).toBe(3);
      chain.head += 2n;
      clock.set(() => addSeconds(T0, 5));
      const g = await readTip(sql, chain, i.tip.id);
      expect(g.status).toBe("confirmed");
    } finally {
      process.env.CONFIRMATIONS = "1";
    }
  });

  it("GET re-verifies at most every 3 s per tip", async () => {
    const i = await intent();
    const hash = chain.pending(txHash(), "0x");
    await submitTip(sql, chain, i.tip.id, hash);
    const before = chain.calls.filter((c) => c === "getReceipt").length;
    await tipGET(req(`/api/tips/${i.tip.id}`), params({ id: i.tip.id }));
    expect(chain.calls.filter((c) => c === "getReceipt").length).toBe(before);
    clock.set(() => addSeconds(T0, 4));
    const r = await tipGET(req(`/api/tips/${i.tip.id}`), params({ id: i.tip.id }));
    expect((await r.json()).status).toBe("submitted");
    expect(chain.calls.filter((c) => c === "getReceipt").length).toBe(before + 1);
  });

  it("never confirms from client input alone: a hash with no receipt stays submitted", async () => {
    const i = await intent();
    const v = await submitTip(sql, chain, i.tip.id, txHash());
    expect(v.status).toBe("submitted");
  });

  it("transient RPC errors leave the tip submitted", async () => {
    const i = await intent();
    const hash = chain.payIntent(i);
    chain.failing.add("getReceipt");
    expect((await submitTip(sql, chain, i.tip.id, hash)).status).toBe("submitted");
    chain.failing.clear();
    clock.set(() => addSeconds(T0, 5));
    expect((await readTip(sql, chain, i.tip.id)).status).toBe("confirmed");
  });

  it("refuses an RPC on the wrong chain without failing the tip", async () => {
    const i = await intent();
    const hash = chain.payIntent(i);
    chain.id = 1;
    expect((await submitTip(sql, chain, i.tip.id, hash)).status).toBe("submitted");
  });
});

describe("transitions, expiry and timeout", () => {
  it("PATCH only allows pre-submit transitions", async () => {
    const i = await intent();
    const r = await tipPATCH(req(`/api/tips/${i.tip.id}`, { method: "PATCH", json: { status: "confirmed" } }), params({ id: i.tip.id }));
    expect(r.status).toBe(400);
    const v = await patchTip(sql, i.tip.id, { status: "failed", reason: "user_rejected" });
    expect([v.status, v.failureReason]).toEqual(["failed", "user_rejected"]);
    expect(await code(patchTip(sql, i.tip.id, { status: "awaiting_wallet" }))).toBe("invalid_transition");
    // A wallet that reported an error may still have broadcast: submitting is allowed and verified on chain.
    const hash = chain.payIntent(i);
    expect((await submitTip(sql, chain, i.tip.id, hash)).status).toBe("confirmed");
    expect(await code(patchTip(sql, i.tip.id, { status: "failed", reason: "wallet_error" }))).toBe("invalid_transition");
  });

  it("expires unsubmitted intents after 30 minutes", async () => {
    const i = await intent();
    await patchTip(sql, i.tip.id, { status: "awaiting_wallet" });
    clock.set(() => addSeconds(T0, 1801));
    const r = await sweepTips(sql, chain);
    expect(r.expired).toBe(1);
    expect((await readTip(sql, chain, i.tip.id)).status).toBe("expired");
    expect(await code(submitTip(sql, chain, i.tip.id, txHash()))).toBe("tip_expired");
  });

  it("fails submitted txs with no receipt after the timeout and releases the hash", async () => {
    const i = await intent();
    const hash = txHash();
    await submitTip(sql, chain, i.tip.id, hash);
    clock.set(() => addSeconds(T0, 1801));
    const r = await sweepTips(sql, chain);
    expect(r.failed).toBe(1);
    const v = await readTip(sql, chain, i.tip.id);
    expect([v.status, v.failureReason, v.txHash]).toEqual(["failed", "timeout", null]);
  });

  it("status never moves backwards after confirmation", async () => {
    const i = await intent();
    const hash = chain.payIntent(i);
    await submitTip(sql, chain, i.tip.id, hash);
    expect(await code(patchTip(sql, i.tip.id, { status: "failed", reason: "user_rejected" }))).toBe("invalid_transition");
    chain.receipts.delete(hash.toLowerCase());
    expect((await verifyTip(sql, chain, i.tip.id)).status).toBe("confirmed");
  });

  it("unknown tip ids are 404 without leaking anything", async () => {
    const r = await tipGET(req("/api/tips/not-a-uuid"), params({ id: "not-a-uuid" }));
    expect(r.status).toBe(404);
  });
});

