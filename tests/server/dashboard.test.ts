import "./setup-env";
import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { setChainForTests } from "@/lib/server/chain";
import { addSeconds, clock } from "@/lib/server/clock";
import { getPublicCreator, getPublicTips } from "@/lib/server/creators";
import { getAnalytics, getOverview, listDashboardTips } from "@/lib/server/dashboard";
import { resetDbForTests, type Sql } from "@/lib/server/db";
import { createTip, patchTip, submitTip } from "@/lib/server/tips";
import { createTipLink, updateProfile } from "@/lib/server/profiles";
import { GET as creatorGET } from "@/app/api/creators/[username]/route";
import { GET as creatorTipsGET } from "@/app/api/creators/[username]/tips/route";
import { POST as eventPOST } from "@/app/api/analytics/event/route";
import { POST as reportPOST } from "@/app/api/reports/route";
import { GET as overviewGET } from "@/app/api/dashboard/overview/route";
import { GET as notificationsGET } from "@/app/api/notifications/route";
import { POST as readPOST } from "@/app/api/notifications/read/route";
import { CREATOR, E18, FakeChain, SUPPORTER, T0, makeCreator, params, req, txHash } from "./fakes";

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

async function confirmedTip(amount: string, over: Record<string, unknown> = {}) {
  const i = await createTip(sql, { username: "alice", amount, ...over });
  const hash = chain.payIntent(i);
  return submitTip(sql, chain, i.tip.id, hash);
}

describe("dashboard totals", () => {
  it("count only confirmed tips", async () => {
    await confirmedTip("5", { supporterName: "Bob" });
    await confirmedTip("2.5", { isAnonymous: true });
    const pending = await createTip(sql, { username: "alice", amount: "100" });
    await submitTip(sql, chain, pending.tip.id, txHash()); // submitted, no receipt
    const failed = await createTip(sql, { username: "alice", amount: "50" });
    await patchTip(sql, failed.tip.id, { status: "failed", reason: "user_rejected" });
    const bad = await createTip(sql, { username: "alice", amount: "7" });
    await submitTip(sql, chain, bad.tip.id, chain.payIntent(bad, { status: "reverted" }));

    const o = await getOverview(sql, chain, creator.session);
    expect(o.totals).toEqual({ confirmedRaw: (75n * E18 / 10n).toString(), confirmedMezoRaw: "0", tips: 2, supporters: 1, pending: 1, fundedFromBitcoin: 0 });
    expect(o.recent.map((t) => t.status).sort()).toEqual(["confirmed", "confirmed", "submitted"]);
    expect(o.indexer.lastBlock).toBeNull();

    const a = await getAnalytics(sql, creator.session, "7d");
    expect(a.totals.tips).toBe(2);
    expect(a.totals.largestRaw).toBe((5n * E18).toString());
    expect(a.totals.averageRaw).toBe((375n * E18 / 100n).toString());
    expect(a.series).toHaveLength(7);
    expect(a.series.reduce((s, d) => s + d.tips, 0)).toBe(2);
  });

  it("anonymous tips hide name and address even on the dashboard", async () => {
    await confirmedTip("1", { isAnonymous: true, supporterName: "Secret" });
    const page = await listDashboardTips(sql, creator.session, { status: "confirmed" });
    expect(page.items[0]).toMatchObject({ isAnonymous: true, supporterName: null, senderAddress: null });
  });

  it("filters by status, date range and paginates with a cursor", async () => {
    for (let k = 0; k < 5; k++) {
      clock.set(() => addSeconds(T0, k * 60));
      await createTip(sql, { username: "alice", amount: "1" });
    }
    const p1 = await listDashboardTips(sql, creator.session, { status: "all", limit: 2 });
    expect(p1.items).toHaveLength(2);
    const p2 = await listDashboardTips(sql, creator.session, { status: "all", limit: 2, cursor: p1.nextCursor! });
    const p3 = await listDashboardTips(sql, creator.session, { status: "all", limit: 2, cursor: p2.nextCursor! });
    expect(p3.nextCursor).toBeNull();
    const ids = [...p1.items, ...p2.items, ...p3.items].map((t) => t.id);
    expect(new Set(ids).size).toBe(5);
    expect((await listDashboardTips(sql, creator.session, { status: "confirmed" })).items).toHaveLength(0);
    expect((await listDashboardTips(sql, creator.session, { from: addSeconds(T0, 120).toISOString() })).items).toHaveLength(3);
  });

  it("overview route requires a session", async () => {
    expect((await overviewGET(req("/api/dashboard/overview"))).status).toBe(401);
    expect((await overviewGET(req("/api/dashboard/overview", { cookie: creator.cookie }))).status).toBe(200);
  });
});

describe("public creator data", () => {
  it("public tips hide anonymous identity and respect message/activity settings", async () => {
    await confirmedTip("5", { supporterName: "Bob", message: "great work" });
    await confirmedTip("1", { isAnonymous: true, message: "secret fan" });
    await createTip(sql, { username: "alice", amount: "9" }); // not confirmed: never public
    const tips = await getPublicTips("alice", {}, sql);
    expect(tips).toHaveLength(2);
    const anon = tips.find((t) => t.message === "secret fan")!;
    expect([anon.supporterName, anon.senderShort]).toEqual([null, null]);
    const bob = tips.find((t) => t.supporterName === "Bob")!;
    expect(bob.senderShort).toMatch(/^0x[0-9a-fA-F]{4}…[0-9a-fA-F]{4}$/);
    expect(JSON.stringify(tips)).not.toContain(SUPPORTER.address.toLowerCase());

    await updateProfile(sql, creator.session, { messagesEnabled: false });
    expect((await getPublicTips("alice", {}, sql)).every((t) => t.message === null)).toBe(true);
    await updateProfile(sql, creator.session, { publicActivityEnabled: false });
    expect(await getPublicTips("alice", {}, sql)).toEqual([]);
    const c = await getPublicCreator("alice", null, sql);
    expect(c && "stats" in c ? c.stats : "x").toBeNull();
  });

  it("public creator route exposes no ids or private settings, resolves campaigns", async () => {
    await createTipLink(sql, creator.session, { slug: "launch", campaignName: "Launch" });
    const r = await creatorGET(req("/api/creators/Alice?c=launch"), params({ username: "Alice" }));
    const body = await r.json();
    expect(body.campaign).toEqual({ slug: "launch", name: "Launch" });
    expect(body.recipientWallet).toBe(CREATOR.address);
    for (const k of ["id", "userId", "thankYouMessage", "status", "createdAt"]) expect(body).not.toHaveProperty(k);
    expect((await creatorGET(req("/api/creators/nobody"), params({ username: "nobody" }))).status).toBe(404);
    const t = await creatorTipsGET(req("/api/creators/alice/tips"), params({ username: "alice" }));
    expect(await t.json()).toEqual([]);
  });
});

describe("analytics events, reports, notifications", () => {
  it("dedupes events per visitor per day and counts uniques", async () => {
    const ev = (ip: string, type = "page_view", source?: string) =>
      eventPOST(req("/api/analytics/event", { json: { username: "alice", type, source }, ip, headers: { "user-agent": "ua" } }));
    expect((await ev("1.1.1.1", "page_view", "x")).status).toBe(200);
    await ev("1.1.1.1", "page_view", "x");
    await ev("2.2.2.2", "page_view", "qr");
    await ev("2.2.2.2", "qr_view");
    expect((await ev("2.2.2.2", "bogus")).status).toBe(400);
    const a = await getAnalytics(sql, creator.session, "30d");
    expect(a.visits).toMatchObject({ pageViews: 2, uniqueVisitors: 2, qrViews: 1 });
    expect(a.sources.map((s) => s.source).sort()).toEqual(["qr", "x"]);
    const rows = await sql`SELECT visitor_hash FROM analytics_events`;
    expect(JSON.stringify(rows)).not.toContain("1.1.1.1");
  });

  it("rate limits public analytics", async () => {
    let last = 200;
    for (let k = 0; k < 62; k++)
      last = (await eventPOST(req("/api/analytics/event", { json: { username: "alice", type: "share_click" }, ip: "9.9.9.9" }))).status;
    expect(last).toBe(429);
  });

  it("accepts reports and rate limits them", async () => {
    const send = () => reportPOST(req("/api/reports", { json: { username: "alice", reason: "scam", details: "fake" }, ip: "3.3.3.3" }));
    for (let k = 0; k < 5; k++) expect((await send()).status).toBe(200);
    expect((await send()).status).toBe(429);
    expect(Number((await sql`SELECT count(*)::int AS n FROM reports`)[0].n)).toBe(5);
  });

  it("lists and marks notifications read", async () => {
    await confirmedTip("5");
    const list = await (await notificationsGET(req("/api/notifications", { cookie: creator.cookie }))).json();
    expect(list[0]).toMatchObject({ type: "tip_received", readAt: null });
    await readPOST(req("/api/notifications/read", { cookie: creator.cookie, json: {} }));
    const after = await (await notificationsGET(req("/api/notifications", { cookie: creator.cookie }))).json();
    expect(after[0].readAt).not.toBeNull();
  });
});
