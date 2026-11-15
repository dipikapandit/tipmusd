import "./setup-env";
import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { encodeFunctionData } from "viem";
import { erc20Abi } from "@/lib/chain/abis";
import { setChainForTests } from "@/lib/server/chain";
import { addSeconds, clock } from "@/lib/server/clock";
import { resetDbForTests, type Sql } from "@/lib/server/db";
import { getCursor, runCatchup, runIndexerPass } from "@/lib/server/indexer";
import { changePayoutWallet, walletChangeNonce } from "@/lib/server/profiles";
import { createTip, patchTip, readTip, submitTip, sweepTips } from "@/lib/server/tips";
import { POST as syncPOST } from "@/app/api/indexer/sync/route";
import { GET as cronGET } from "@/app/api/cron/route";
import { CREATOR, CREATOR2, E18, FakeChain, NEW_WALLET, STRANGER, SUPPORTER, T0, makeCreator, req, transferLog, txHash } from "./fakes";

let sql: Sql;
let chain: FakeChain;
let creator: Awaited<ReturnType<typeof makeCreator>>;
const origin = { domain: "localhost:3000", uri: "http://localhost:3000" };

beforeEach(async () => {
  clock.set(() => T0);
  sql = await resetDbForTests();
  chain = new FakeChain();
  setChainForTests(chain);
  creator = await makeCreator(sql, CREATOR, "alice");
});

/** A plain wallet transfer (no ref suffix) mined at `block`. */
function plainTransfer(to: string, value: bigint, block: bigint, from = SUPPORTER.address) {
  const input = encodeFunctionData({ abi: erc20Abi, functionName: "transfer", args: [to as `0x${string}`, value] });
  return chain.mine({ input, from, blockNumber: block, logs: (m) => [transferLog(from, to, value, m)] });
}
const tipsCount = async (where = sql.frag`TRUE`) => Number((await sql<{ n: number }>`SELECT count(*)::int AS n FROM tips WHERE ${where}`)[0].n);

describe("indexer", () => {
  it("records unknown transfers to creator wallets as indexer tips, idempotently", async () => {
    plainTransfer(CREATOR.address, 3n * E18, 10n);
    plainTransfer(STRANGER.address, 3n * E18, 11n); // not a creator: ignored
    plainTransfer(CREATOR.address, 1n, 12n); // dust: event only
    const r1 = await runIndexerPass(sql, chain);
    expect(r1).toMatchObject({ fromBlock: "1", toBlock: "100", confirmed: 1 });
    expect(await tipsCount(sql.frag`source = 'indexer' AND status = 'confirmed'`)).toBe(1);
    const [t] = await sql`SELECT supporter_message, supporter_name, amount_raw FROM tips`;
    expect(t.supporter_message).toBeNull();
    expect(t.supporter_name).toBeNull();

    // Re-run the same range from scratch: nothing duplicates.
    await sql`DELETE FROM indexer_cursors`;
    const r2 = await runIndexerPass(sql, chain);
    expect(r2.confirmed).toBe(0);
    expect(await tipsCount()).toBe(1);
    expect(Number((await sql`SELECT count(*)::int AS n FROM blockchain_events`)[0].n)).toBe(2);
    expect(Number((await sql`SELECT count(*)::int AS n FROM notifications WHERE type = 'tip_received'`)[0].n)).toBe(1);
  });

  it("links a transfer to an existing intent by tx hash", async () => {
    const i = await createTip(sql, { username: "alice", amount: "5", message: "hello" });
    const hash = txHash();
    await submitTip(sql, chain, i.tip.id, hash); // no receipt yet
    chain.mine({ hash, input: (await import("@/lib/server/verify")).expectedTipCalldata(CREATOR.address, 5n * E18, i.payment.dataSuffix.slice(-32)), blockNumber: 50n, logs: (m) => [transferLog(SUPPORTER.address, CREATOR.address, 5n * E18, m)] });
    const r = await runIndexerPass(sql, chain);
    expect(r.confirmed).toBe(1);
    const v = await readTip(sql, chain, i.tip.id);
    expect(v.status).toBe("confirmed");
    expect(v.message).toBe("hello");
    expect(await tipsCount()).toBe(1);
  });

  it("links a transfer to an intent by the calldata ref even if the hash was never submitted", async () => {
    const i = await createTip(sql, { username: "alice", amount: "2", supporterName: "Ann" });
    await patchTip(sql, i.tip.id, { status: "awaiting_wallet" });
    const hash = chain.payIntent(i, { blockNumber: 20n });
    await runIndexerPass(sql, chain);
    const v = await readTip(sql, chain, i.tip.id);
    expect([v.status, v.txHash, v.supporterName]).toEqual(["confirmed", hash, "Ann"]);
    expect(await tipsCount()).toBe(1);
  });

  it("a griefer's intent holding someone else's hash can't block it", async () => {
    const real = await createTip(sql, { username: "alice", amount: "2", message: "real" });
    const grief = await createTip(sql, { username: "alice", amount: "2" });
    const hash = txHash();
    await submitTip(sql, chain, grief.tip.id, hash); // claimed before it mined
    chain.mine({ hash, input: (await import("@/lib/server/verify")).expectedTipCalldata(CREATOR.address, 2n * E18, real.payment.dataSuffix.slice(-32)), blockNumber: 30n, logs: (m) => [transferLog(SUPPORTER.address, CREATOR.address, 2n * E18, m)] });
    await runIndexerPass(sql, chain);
    expect((await readTip(sql, chain, grief.tip.id)).failureReason).toBe("calldata_mismatch");
    const v = await readTip(sql, chain, real.tip.id);
    expect([v.status, v.message]).toEqual(["confirmed", "real"]);
  });

  it("attributes transfers to a creator's previous wallet during its window, not after", async () => {
    clock.set(() => addSeconds(T0, 1000));
    const { message } = await walletChangeNonce(sql, creator.session, NEW_WALLET.address, origin);
    await changePayoutWallet(sql, chain, creator.session, { address: NEW_WALLET.address, message, signature: await NEW_WALLET.signMessage({ message }) }, { allowedDomains: ["localhost:3000"] });
    chain.head = 6000n;
    plainTransfer(CREATOR.address, 1n * E18, 500n); // old wallet, before the change (t = T0+500)
    plainTransfer(NEW_WALLET.address, 2n * E18, 1500n); // new wallet
    plainTransfer(CREATOR.address, 4n * E18, 5000n); // old wallet long after the change → not attributed
    await runIndexerPass(sql, chain);
    const rows = await sql<{ recipient_address: string; amount_raw: string }>`SELECT recipient_address, amount_raw FROM tips ORDER BY block_number`;
    expect(rows.map((r) => [r.recipient_address, String(r.amount_raw)])).toEqual([
      [CREATOR.address.toLowerCase(), (1n * E18).toString()],
      [NEW_WALLET.address.toLowerCase(), (2n * E18).toString()],
    ]);
  });

  it("scans in ≤2,000-block ranges and respects confirmations", async () => {
    chain.head = 4500n;
    process.env.CONFIRMATIONS = "3";
    try {
      plainTransfer(CREATOR.address, E18, 4499n); // only 2 confirmations: not yet
      const r = await runIndexerPass(sql, chain);
      expect(r.toBlock).toBe("4498");
      expect(await tipsCount()).toBe(0);
      chain.head = 4501n;
      await runIndexerPass(sql, chain);
      expect(await tipsCount()).toBe(1);
    } finally {
      process.env.CONFIRMATIONS = "1";
    }
  });

  it("rewinds on a reorg and drops orphaned indexer tips", async () => {
    plainTransfer(CREATOR.address, E18, 98n);
    await runIndexerPass(sql, chain);
    expect(await tipsCount()).toBe(1);
    // Blocks 96..100 are replaced; the transfer is gone from the canonical chain.
    for (let b = 96n; b <= 100n; b++) chain.fork.set(b, 1);
    chain.logs = chain.logs.filter((l) => l.blockNumber !== 98n);
    await runIndexerPass(sql, chain);
    expect(await tipsCount()).toBe(0);
    const c = await getCursor(sql);
    expect(c?.block).toBe(100n);
  });

  it("reorg sends app tips back to submitted for re-verification", async () => {
    const i = await createTip(sql, { username: "alice", amount: "5" });
    const hash = chain.payIntent(i, { blockNumber: 99n });
    await submitTip(sql, chain, i.tip.id, hash);
    await runIndexerPass(sql, chain);
    for (let b = 95n; b <= 100n; b++) chain.fork.set(b, 1);
    // still mined (same block number) in the new fork
    chain.receipts.get(hash)!.blockHash = (await chain.getBlock(99n)).hash;
    await runIndexerPass(sql, chain);
    const v = await readTip(sql, chain, i.tip.id);
    expect(v.status).toBe("confirmed");
    expect(Number((await sql`SELECT count(*)::int AS n FROM notifications WHERE type = 'tip_received'`)[0].n)).toBe(1);
  });

  it("indexes a timed-out tip's transfer later as an indexer tip", async () => {
    const i = await createTip(sql, { username: "alice", amount: "5", message: "late" });
    const hash = txHash();
    await submitTip(sql, chain, i.tip.id, hash);
    clock.set(() => addSeconds(T0, 1801));
    await sweepTips(sql, chain);
    chain.mine({ hash, input: (await import("@/lib/server/verify")).expectedTipCalldata(CREATOR.address, 5n * E18, i.payment.dataSuffix.slice(-32)), blockNumber: 90n, logs: (m) => [transferLog(SUPPORTER.address, CREATOR.address, 5n * E18, m)] });
    await runIndexerPass(sql, chain);
    const [t] = await sql`SELECT source, status, supporter_message FROM tips WHERE tx_hash = ${hash}`;
    expect([t.source, t.status, t.supporter_message]).toEqual(["indexer", "confirmed", null]);
  });

  it("sync route: bearer runs a pass, sessions get a throttled catch-up, anonymous is 401", async () => {
    expect((await syncPOST(req("/api/indexer/sync", { method: "POST" }))).status).toBe(401);
    const b = await syncPOST(req("/api/indexer/sync", { method: "POST", headers: { authorization: "Bearer test-indexer-secret" } }));
    expect(b.status).toBe(200);
    const s1 = await (await syncPOST(req("/api/indexer/sync", { method: "POST", cookie: creator.cookie }))).json();
    expect(s1.skipped).toBeUndefined();
    const s2 = await (await syncPOST(req("/api/indexer/sync", { method: "POST", cookie: creator.cookie }))).json();
    expect(s2.skipped).toBe("throttled");
    clock.set(() => addSeconds(T0, 16));
    expect((await runCatchup(sql, chain)).skipped).toBeUndefined();
  });

  it("cron route needs CRON_SECRET", async () => {
    expect((await cronGET(req("/api/cron"))).status).toBe(401);
    const r = await cronGET(req("/api/cron", { headers: { authorization: "Bearer test-cron-secret" } }));
    expect(r.status).toBe(200);
    expect((await r.json()).ok).toBe(true);
  });

  it("routes pending x402 tips to the x402 verifier in sweeps and GET", async () => {
    await makeCreator(sql, CREATOR2, "bob");
    const hash = plainTransfer(CREATOR2.address, 3n * E18, 60n, STRANGER.address);
    const [{ id: pid }] = await sql<{ id: string }>`SELECT id FROM creator_profiles WHERE username = 'bob'`;
    const [row] = await sql<{ id: string }>`
      INSERT INTO tips (creator_id, source, status, chain_id, token_address, recipient_address, expected_amount_raw, sender_address, tx_hash, submitted_at)
      VALUES (${pid}, 'x402', 'pending_confirmation', 31611, ${"0x118917a40faf1cd7a13db0ef56c86de7973ac503"}, ${CREATOR2.address.toLowerCase()}, ${3n * E18},
              ${STRANGER.address.toLowerCase()}, ${hash}, ${T0}) RETURNING id`;
    const v = await readTip(sql, chain, row.id);
    expect(v.status).toBe("confirmed");
    expect(v.source).toBe("x402");
  });
});
