import "./setup-env";
import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { encodeFunctionData, parseAbi, zeroAddress, type Address, type Hex } from "viem";
import { erc20Abi } from "@/lib/chain/abis";
import { MEZO_BORROW, MEZO_POOLS, MEZO_TOKEN, MUSD } from "@/lib/chain/config";
import { setChainForTests } from "@/lib/server/chain";
import { addSeconds, clock } from "@/lib/server/clock";
import { getPublicCreator, getPublicTips } from "@/lib/server/creators";
import { getAnalytics, getOverview } from "@/lib/server/dashboard";
import { resetDbForTests, type Sql } from "@/lib/server/db";
import { FUNDING_SELECTORS, verifyFunding } from "@/lib/server/funding";
import { MEZO_CURSOR, getCursor, runIndexerPass } from "@/lib/server/indexer";
import { updateProfile } from "@/lib/server/profiles";
import { getExplore, getSupporterProfile } from "@/lib/server/social";
import { createTip, readTip, submitTip, sweepTips } from "@/lib/server/tips";
import { expectedTipCalldata } from "@/lib/server/verify";
import { GET as exploreGET } from "@/app/api/explore/route";
import { GET as supporterGET } from "@/app/api/supporters/[address]/route";
import { POST as submitPOST } from "@/app/api/tips/[id]/submit/route";
import { CREATOR, CREATOR2, E18, FakeChain, STRANGER, SUPPORTER, T0, code, lc, makeCreator, params, req, transferLog } from "./fakes";

const SMART_ACCOUNT = "0x00000000000000000000000000000000005afe01";
const RELAYER = "0x0000000000000000000000000000000000000b0b";
const accountAbi = parseAbi(["function execute(address to, uint256 value, bytes data)"]);
const routerAbi = parseAbi([
  "struct Route { address from; address to; bool stable; address factory; }",
  "function swapExactTokensForTokens(uint256 amountIn, uint256 amountOutMin, Route[] routes, address to, uint256 deadline) returns (uint256[] amounts)",
]);
const borrowAbi = parseAbi([
  "function openTrove(uint256 _debtAmount, address _upperHint, address _lowerHint) payable",
  "function withdrawMUSD(uint256 _amount, address _upperHint, address _lowerHint)",
]);
const BTC = "0x7b7C000000000000000000000000000000000000";

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

const swapInput = (to: string) =>
  encodeFunctionData({
    abi: routerAbi,
    functionName: "swapExactTokensForTokens",
    args: [10n ** 14n, 7n * E18, [{ from: BTC, to: MUSD, stable: false, factory: MEZO_POOLS.factory }], to as Address, 2_000_000_000n],
  });
const drawInput = (amount = 6n * E18) => encodeFunctionData({ abi: borrowAbi, functionName: "withdrawMUSD", args: [amount, zeroAddress, zeroAddress] });
const openInput = () => encodeFunctionData({ abi: borrowAbi, functionName: "openTrove", args: [1800n * E18, zeroAddress, zeroAddress] });

/** A swap BTC → MUSD on the Mezo pools router paying `to`. */
function mineSwap(opts: { to?: string; block: bigint; recipient?: string; target?: string; from?: string; input?: Hex }) {
  const recipient = opts.recipient ?? SUPPORTER.address;
  return chain.mine({
    from: opts.from ?? recipient,
    to: opts.target ?? MEZO_POOLS.router,
    input: opts.input ?? swapInput(recipient),
    blockNumber: opts.block,
    logs: (m) => [transferLog(MEZO_POOLS.musdBtcPool, recipient, 7n * E18, { ...m, address: MUSD })],
  });
}
/** A Mezo Borrow call minting MUSD to `borrower`. */
function mineLoan(opts: { input: Hex; block: bigint; borrower?: string; target?: string }) {
  const borrower = opts.borrower ?? SUPPORTER.address;
  return chain.mine({
    from: borrower,
    to: opts.target ?? MEZO_BORROW.borrowerOperations,
    input: opts.input,
    blockNumber: opts.block,
    logs: (m) => [transferLog(zeroAddress, borrower, 6n * E18, { ...m, address: MUSD })],
  });
}

/** App tip paid exactly as the wallet would (token taken from the intent), submitted, confirmed. */
async function paidTip(over: Record<string, unknown> = {}, pay: { block?: bigint; funding?: { kind: "swap_btc" | "loan_draw" | "loan_open"; txHash: string } } = {}) {
  const i = await createTip(sql, { username: "alice", amount: "5", supporterName: "Bob", ...over });
  const hash = chain.payIntent(i, { to: i.payment.token, blockNumber: pay.block });
  const v = await submitTip(sql, chain, i.tip.id, hash, pay.funding ?? null);
  return { i, hash, v };
}

describe("MEZO tips", () => {
  it("creates a MEZO intent with the MEZO contract and confirms on a MEZO Transfer", async () => {
    const i = await createTip(sql, { username: "alice", token: "MEZO", amount: "50" });
    expect(i.payment.token.toLowerCase()).toBe(MEZO_TOKEN.toLowerCase());
    expect(i.payment.tokenSymbol).toBe("MEZO");
    expect(i.tip.token).toBe("MEZO");
    const hash = chain.payIntent(i, { to: MEZO_TOKEN });
    const v = await submitTip(sql, chain, i.tip.id, hash);
    expect([v.status, v.token, v.amountRaw]).toEqual(["confirmed", "MEZO", (50n * E18).toString()]);
    const [n] = await sql<{ title: string }>`SELECT title FROM notifications WHERE type = 'tip_received'`;
    expect(n.title).toBe("You received 50 MEZO");
    const [ev] = await sql<{ contract_address: string }>`SELECT contract_address FROM blockchain_events`;
    expect(ev.contract_address).toBe(MEZO_TOKEN.toLowerCase());
  });

  it("defaults to MUSD", async () => {
    const i = await createTip(sql, { username: "alice", amount: "5" });
    expect([i.payment.tokenSymbol, i.tip.token, i.payment.token]).toEqual(["MUSD", "MUSD", MUSD]);
  });

  it("validates MEZO amounts against the MEZO limits", async () => {
    expect(await code(createTip(sql, { username: "alice", token: "MEZO", amount: "0.05" }))).toBe("invalid_amount");
    expect(await code(createTip(sql, { username: "alice", token: "MEZO", amount: "1000000.1" }))).toBe("invalid_amount");
    expect(await code(createTip(sql, { username: "alice", token: "MEZO", amount: "1.1234567" }))).toBe("invalid_amount");
    expect((await createTip(sql, { username: "alice", token: "MEZO", amount: "0.1" })).payment.amountRaw).toBe((E18 / 10n).toString());
    expect(await code(createTip(sql, { username: "alice", token: "BTC" as never, amount: "1" }))).toBe("invalid_token");
    expect(await code(createTip(sql, { username: "alice", token: "constructor" as never, amount: "1" }))).toBe("invalid_token");
  });

  it("rejects MEZO when the creator turned it off (profile patch)", async () => {
    const p = await updateProfile(sql, creator.session, { acceptMezo: false });
    expect(p.acceptMezo).toBe(false);
    expect(await code(createTip(sql, { username: "alice", token: "MEZO", amount: "10" }))).toBe("mezo_disabled");
    expect(await code(createTip(sql, { username: "alice", amount: "10" }))).toBe("ok");
    const pub = await getPublicCreator("alice", null, sql);
    expect(pub && "acceptMezo" in pub && pub.acceptMezo).toBe(false);
  });

  it("a MUSD transfer can't confirm a MEZO intent", async () => {
    const i = await createTip(sql, { username: "alice", token: "MEZO", amount: "5" });
    // Same calldata (recipient, amount, suffix) but sent to the MUSD contract: MUSD log, not MEZO.
    const hash = chain.payIntent(i, { to: MUSD });
    const v = await submitTip(sql, chain, i.tip.id, hash);
    expect([v.status, v.failureReason]).toEqual(["failed", "wrong_token"]);
  });

  it("a MEZO transfer can't confirm a MUSD intent", async () => {
    const i = await createTip(sql, { username: "alice", amount: "5" });
    const hash = chain.payIntent(i, { to: MEZO_TOKEN });
    const v = await submitTip(sql, chain, i.tip.id, hash);
    expect([v.status, v.failureReason]).toEqual(["failed", "wrong_token"]);
  });

  it("a MEZO tx with a MUSD log (or a lookalike token log) is rejected", async () => {
    const i = await createTip(sql, { username: "alice", token: "MEZO", amount: "5" });
    const amount = BigInt(i.payment.amountRaw);
    const input = expectedTipCalldata(i.payment.recipient, amount, i.payment.dataSuffix.slice(-32));
    const hash = chain.mine({ to: MEZO_TOKEN, input, logs: (m) => [transferLog(SUPPORTER.address, i.payment.recipient, amount, { ...m, address: MUSD })] });
    const v = await submitTip(sql, chain, i.tip.id, hash);
    expect([v.status, v.failureReason]).toEqual(["failed", "no_matching_transfer"]);
  });

  it("the indexer records MEZO transfers (own cursor) and attaches nested refs", async () => {
    const plain = (token: string, value: bigint, block: bigint) =>
      chain.mine({
        to: token,
        input: encodeFunctionData({ abi: erc20Abi, functionName: "transfer", args: [CREATOR.address, value] }),
        blockNumber: block,
        logs: (m) => [transferLog(SUPPORTER.address, CREATOR.address, value, { ...m, address: token as Address })],
      });
    plain(MEZO_TOKEN, 20n * E18, 10n);
    plain(MUSD, 3n * E18, 11n);
    plain(MEZO_TOKEN, E18 / 100n, 12n); // below the MEZO minimum (0.1): event only
    plain(STRANGER.address, 9n * E18, 13n); // lookalike token: never seen
    const i = await createTip(sql, { username: "alice", token: "MEZO", amount: "7", supporterName: "Ann" });
    chain.payIntent(i, { to: MEZO_TOKEN, blockNumber: 14n }); // never submitted by the client
    const r = await runIndexerPass(sql, chain);
    expect(r.confirmed).toBe(3);
    const rows = await sql<{ token_address: string; amount_raw: string; source: string }>`
      SELECT token_address, amount_raw::text, source FROM tips WHERE status = 'confirmed' ORDER BY block_number`;
    expect(rows.map((x) => [x.token_address, x.source])).toEqual([
      [MEZO_TOKEN.toLowerCase(), "indexer"],
      [MUSD.toLowerCase(), "indexer"],
      [MEZO_TOKEN.toLowerCase(), "app"],
    ]);
    expect((await readTip(sql, chain, i.tip.id)).supporterName).toBe("Ann");
    expect((await getCursor(sql, MEZO_CURSOR))?.block).toBe(100n);
    expect((await getCursor(sql))?.block).toBe(100n);
    const [n] = await sql<{ n: number }>`SELECT count(*)::int AS n FROM tips WHERE token_address = ${STRANGER.address.toLowerCase()}`;
    expect(n.n).toBe(0);
  });

  it("TipView carries token, and funding null without a claim", async () => {
    const { v } = await paidTip();
    expect([v.token, v.funding]).toEqual(["MUSD", null]);
  });
});

describe("funding from Bitcoin", () => {
  it("verifies a BTC → MUSD swap before the tip", async () => {
    const f = mineSwap({ block: 50n });
    const { v } = await paidTip({}, { block: 60n, funding: { kind: "swap_btc", txHash: f } });
    expect(v.status).toBe("confirmed");
    expect(v.funding).toEqual({ kind: "swap_btc", txHash: f, verified: true });
    const [pub] = await getPublicTips("alice", {}, sql);
    expect(pub.fundedFromBitcoin).toBe("swap_btc");
  });

  it("verifies a loan draw and a loan open (MUSD minted to the sender)", async () => {
    const d = mineLoan({ input: drawInput(), block: 40n });
    const a = await paidTip({}, { block: 41n, funding: { kind: "loan_draw", txHash: d } });
    expect(a.v.funding?.verified).toBe(true);
    const o = mineLoan({ input: openInput(), block: 42n });
    const b = await paidTip({}, { block: 43n, funding: { kind: "loan_open", txHash: o } });
    expect(b.v.funding?.verified).toBe(true);
  });

  it("the selector must match the kind (openTrove claimed as a draw → unverified)", async () => {
    const o = mineLoan({ input: openInput(), block: 40n });
    const { v } = await paidTip({}, { block: 41n, funding: { kind: "loan_draw", txHash: o } });
    expect(v.funding).toEqual({ kind: "loan_draw", txHash: o, verified: false });
    expect(v.status).toBe("confirmed"); // the tip itself is unaffected
  });

  it("wrong contract → unverified", async () => {
    const f = mineSwap({ block: 50n, target: STRANGER.address });
    const { v } = await paidTip({}, { block: 60n, funding: { kind: "swap_btc", txHash: f } });
    expect(v.funding?.verified).toBe(false);
    const l = mineLoan({ input: drawInput(), block: 50n, target: MEZO_POOLS.router });
    const b = await paidTip({}, { block: 61n, funding: { kind: "loan_draw", txHash: l } });
    expect(b.v.funding?.verified).toBe(false);
    expect((await getPublicTips("alice", {}, sql)).every((t) => t.fundedFromBitcoin === null)).toBe(true);
  });

  it("MUSD going to someone else, a reverted tx, or a non-mint loan log → unverified", async () => {
    const other = mineSwap({ block: 50n, recipient: STRANGER.address, from: SUPPORTER.address });
    expect((await paidTip({}, { block: 60n, funding: { kind: "swap_btc", txHash: other } })).v.funding?.verified).toBe(false);
    const rev = chain.mine({ to: MEZO_POOLS.router, input: swapInput(SUPPORTER.address), blockNumber: 50n, status: "reverted" });
    expect((await paidTip({}, { block: 60n, funding: { kind: "swap_btc", txHash: rev } })).v.funding?.verified).toBe(false);
    const notMint = chain.mine({
      to: MEZO_BORROW.borrowerOperations,
      input: drawInput(),
      blockNumber: 50n,
      logs: (m) => [transferLog(STRANGER.address, SUPPORTER.address, 6n * E18, { ...m, address: MUSD })],
    });
    expect((await paidTip({}, { block: 60n, funding: { kind: "loan_draw", txHash: notMint } })).v.funding?.verified).toBe(false);
  });

  it("funding tx mined after the tip → unverified", async () => {
    const f = mineSwap({ block: 70n });
    const { v } = await paidTip({}, { block: 60n, funding: { kind: "swap_btc", txHash: f } });
    expect(v.funding?.verified).toBe(false);
  });

  it("verifies smart-account (Mezo Passport) funding nested in the account's tx", async () => {
    const wrap = (to: string, data: Hex) => encodeFunctionData({ abi: accountAbi, functionName: "execute", args: [to as Address, 0n, data] });
    const f = mineSwap({ block: 50n, recipient: SMART_ACCOUNT, from: RELAYER, target: SMART_ACCOUNT, input: wrap(MEZO_POOLS.router, swapInput(SMART_ACCOUNT)) });
    const i = await createTip(sql, { username: "alice", amount: "5" });
    const amount = BigInt(i.payment.amountRaw);
    const tipTx = chain.mine({
      from: RELAYER,
      to: SMART_ACCOUNT,
      input: wrap(MUSD, expectedTipCalldata(i.payment.recipient, amount, i.payment.dataSuffix.slice(-32))),
      blockNumber: 60n,
      logs: (m) => [transferLog(SMART_ACCOUNT, i.payment.recipient, amount, m)],
    });
    const v = await submitTip(sql, chain, i.tip.id, tipTx, { kind: "swap_btc", txHash: f });
    expect([v.status, v.funding?.verified]).toEqual(["confirmed", true]);

    // Nested borrow call too.
    const loan = chain.mine({
      from: RELAYER,
      to: SMART_ACCOUNT,
      input: wrap(MEZO_BORROW.borrowerOperations, drawInput()),
      blockNumber: 61n,
      logs: (m) => [transferLog(zeroAddress, SMART_ACCOUNT, 6n * E18, { ...m, address: MUSD })],
    });
    const j = await createTip(sql, { username: "alice", amount: "5" });
    const amt = BigInt(j.payment.amountRaw);
    const tip2 = chain.mine({
      from: RELAYER,
      to: SMART_ACCOUNT,
      input: wrap(MUSD, expectedTipCalldata(j.payment.recipient, amt, j.payment.dataSuffix.slice(-32))),
      blockNumber: 62n,
      logs: (m) => [transferLog(SMART_ACCOUNT, j.payment.recipient, amt, m)],
    });
    expect((await submitTip(sql, chain, j.tip.id, tip2, { kind: "loan_draw", txHash: loan })).funding?.verified).toBe(true);
    expect([FUNDING_SELECTORS.withdrawMUSD, FUNDING_SELECTORS.openTrove, FUNDING_SELECTORS.swap]).toEqual(["0xaf8b4fd0", "0x2f3a6d98", "0xcac88ea9"]);
  });

  it("is retried by the sweep when the funding receipt wasn't available yet", async () => {
    const pendingHash = "0x" + "ab".repeat(32);
    const { i, v } = await paidTip({}, { block: 60n, funding: { kind: "swap_btc", txHash: pendingHash } });
    expect(v.funding?.verified).toBe(false);
    // The funding tx shows up (mined at block 55) — the sweep verifies it.
    mineSwap({ block: 55n });
    const mined = [...chain.receipts.keys()].pop()!;
    await sql`UPDATE tips SET funding_tx_hash = ${mined} WHERE id = ${i.tip.id}`;
    clock.set(() => addSeconds(T0, 60));
    const r = await sweepTips(sql, chain);
    expect(r.fundingVerified).toBe(1);
    // Older than an hour: no longer retried.
    await sql`UPDATE tips SET funding_verified = FALSE WHERE id = ${i.tip.id}`;
    clock.set(() => addSeconds(T0, 7200));
    expect((await sweepTips(sql, chain)).fundingChecked).toBe(0);
  });

  it("a read of the confirmed tip retries a funding check that missed (no worker needed)", async () => {
    const pendingHash = "0x" + "cd".repeat(32);
    const { i, v } = await paidTip({}, { block: 60n, funding: { kind: "swap_btc", txHash: pendingHash } });
    expect(v.funding?.verified).toBe(false);
    mineSwap({ block: 55n });
    const mined = [...chain.receipts.keys()].pop()!;
    await sql`UPDATE tips SET funding_tx_hash = ${mined} WHERE id = ${i.tip.id}`;
    clock.set(() => addSeconds(T0, 10));
    expect((await readTip(sql, chain, i.tip.id)).funding?.verified).toBe(true);
  });

  it("funding claims are ignored on MEZO tips, validated on the route, and never trusted directly", async () => {
    const f = mineSwap({ block: 50n });
    const { i, v } = await paidTip({ token: "MEZO", amount: "10" }, { block: 60n, funding: { kind: "swap_btc", txHash: f } });
    expect([v.status, v.funding]).toEqual(["confirmed", null]);
    expect(await verifyFunding(sql, chain, i.tip.id)).toBe(false);

    const j = await createTip(sql, { username: "alice", amount: "5" });
    const hash = chain.payIntent(j);
    const bad = await submitPOST(req(`/api/tips/${j.tip.id}/submit`, { json: { txHash: hash, funding: { kind: "airdrop", txHash: f } } }), params({ id: j.tip.id }));
    expect(bad.status).toBe(400);
    const ok = await submitPOST(req(`/api/tips/${j.tip.id}/submit`, { json: { txHash: hash, funding: { kind: "swap_btc", txHash: f } } }), params({ id: j.tip.id }));
    expect(ok.status).toBe(200);
    expect((await ok.json()).funding).toEqual({ kind: "swap_btc", txHash: f, verified: true }); // swap at 50, tip at head (100)
  });
});

describe("dashboard per token", () => {
  it("keeps MUSD and MEZO totals apart and counts verified Bitcoin funding", async () => {
    const f = mineSwap({ block: 50n });
    await paidTip({ amount: "5" }, { block: 60n, funding: { kind: "swap_btc", txHash: f } });
    await paidTip({ amount: "2.5" });
    await paidTip({ token: "MEZO", amount: "100" });
    const o = await getOverview(sql, chain, creator.session);
    expect(o.totals).toMatchObject({
      confirmedRaw: ((75n * E18) / 10n).toString(),
      confirmedMezoRaw: (100n * E18).toString(),
      tips: 3,
      fundedFromBitcoin: 1,
    });
    expect(o.recent.map((t) => t.token).sort()).toEqual(["MEZO", "MUSD", "MUSD"]);
    expect(o.recent.find((t) => t.funding)?.funding).toEqual({ kind: "swap_btc", txHash: f, verified: true });

    const a = await getAnalytics(sql, creator.session, "7d");
    expect(a.totals).toMatchObject({
      confirmedRaw: ((75n * E18) / 10n).toString(),
      tips: 2,
      largestRaw: (5n * E18).toString(),
      averageRaw: ((375n * E18) / 100n).toString(),
      confirmedMezoRaw: (100n * E18).toString(),
      mezoTips: 1,
    });
    const day = a.series.find((d) => d.tips > 0)!;
    expect([day.amountRaw, day.mezoAmountRaw, day.tips]).toEqual([((75n * E18) / 10n).toString(), (100n * E18).toString(), 2]); // series.tips = MUSD tips, like totals.tips
  });
});

describe("social layer", () => {
  async function seed() {
    const bob = await makeCreator(sql, CREATOR2, "bob");
    await updateProfile(sql, bob.session, { publicActivityEnabled: false });
    const f = mineSwap({ block: 50n });
    await paidTip({ supporterName: "Bob", amount: "5" }, { block: 60n, funding: { kind: "swap_btc", txHash: f } }); // SUPPORTER, public
    await paidTip({ supporterName: "Bobby", token: "MEZO", amount: "10", message: "gm" }); // SUPPORTER again, newer name
    // Anonymous tip from STRANGER: excluded everywhere.
    const anon = await createTip(sql, { username: "alice", amount: "9", isAnonymous: true });
    await submitTip(sql, chain, anon.tip.id, chain.payIntent(anon, { from: STRANGER.address }));
    // Tip to a private-activity creator: excluded.
    const priv = await createTip(sql, { username: "bob", amount: "3", supporterName: "Bob" });
    await submitTip(sql, chain, priv.tip.id, chain.payIntent(priv));
    // An unconfirmed (reverted) tip: excluded.
    const rev = await createTip(sql, { username: "alice", amount: "4", supporterName: "Ghost" });
    await submitTip(sql, chain, rev.tip.id, chain.payIntent(rev, { from: STRANGER.address, status: "reverted" }));
  }

  it("explore shows only public, non-anonymous confirmed tips", async () => {
    await seed();
    const e = await getExplore({}, sql);
    expect(e.totals).toEqual({ creators: 1, tips: 2, supporters: 1, musdRaw: (5n * E18).toString(), mezoRaw: (10n * E18).toString(), fundedFromBitcoin: 1 });
    expect(e.creators.map((c) => [c.username, c.supporters, c.tips])).toEqual([["alice", 1, 2]]);
    expect(e.feed.map((x) => [x.supporterLabel, x.token, x.fundedFromBitcoin])).toEqual([
      ["Bobby", "MEZO", null],
      ["Bob", "MUSD", "swap_btc"],
    ]);
    expect(e.feed.some((x) => x.supporterAddress?.toLowerCase() === lc(STRANGER.address))).toBe(false);
    expect(e.feed[0].message).toBe("gm");
    await sql`UPDATE creator_profiles SET messages_enabled = FALSE WHERE username = 'alice'`;
    expect((await getExplore({}, sql)).feed[0].message).toBeNull();
    await sql`UPDATE creator_profiles SET status = 'suspended' WHERE username = 'alice'`;
    expect((await getExplore({ sort: "recent" }, sql)).totals.tips).toBe(0);
  });

  it("supporter profile excludes anonymous and private-activity tips; 404 when nothing public", async () => {
    await seed();
    const s = (await getSupporterProfile(SUPPORTER.address.toLowerCase(), sql))!;
    expect(s.address).toBe(SUPPORTER.address);
    expect(s.label).toBe("Bobby");
    expect(s.totals).toEqual({ tips: 2, creators: 1, musdRaw: (5n * E18).toString(), mezoRaw: (10n * E18).toString() });
    expect(s.creators.map((c) => c.username)).toEqual(["alice"]);
    expect(s.recent).toHaveLength(2);
    expect(await getSupporterProfile(STRANGER.address, sql)).toBeNull(); // only anonymous + reverted tips
    expect(await getSupporterProfile("nope", sql)).toBeNull();

    const r = await supporterGET(req(`/api/supporters/${SUPPORTER.address}`), params({ address: SUPPORTER.address }));
    expect(r.status).toBe(200);
    expect(r.headers.get("cache-control")).toContain("s-maxage=30");
    const missing = await supporterGET(req(`/api/supporters/${STRANGER.address}`), params({ address: STRANGER.address }));
    expect(missing.status).toBe(404);
    const ex = await exploreGET(req("/api/explore?sort=recent&limit=5"));
    expect(ex.status).toBe(200);
    expect(ex.headers.get("cache-control")).toContain("s-maxage=30");
    expect((await exploreGET(req("/api/explore?sort=bogus"))).status).toBe(400);
  });

  it("top supporters rank by tip count then MUSD, label = name else short address", async () => {
    await seed();
    // STRANGER: one named MUSD tip of 9 (fewer tips than SUPPORTER's 2).
    const t = await createTip(sql, { username: "alice", amount: "9" });
    await submitTip(sql, chain, t.tip.id, chain.payIntent(t, { from: STRANGER.address }));
    const pub = await getPublicCreator("alice", null, sql);
    if (!pub || !("topSupporters" in pub)) throw new Error("no creator");
    expect(pub.topSupporters.map((x) => [x.label, x.tips, x.musdRaw, x.mezoRaw])).toEqual([
      ["Bobby", 2, (5n * E18).toString(), (10n * E18).toString()],
      [`${STRANGER.address.slice(0, 6)}…${STRANGER.address.slice(-4)}`, 1, (9n * E18).toString(), "0"],
    ]);
    const bob = await getPublicCreator("bob", null, sql);
    expect(bob && "topSupporters" in bob && bob.topSupporters).toEqual([]);
  });
});
