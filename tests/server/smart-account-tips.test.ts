import "./setup-env";
import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { encodeFunctionData, parseAbi, type Hex } from "viem";
import type { TipIntent } from "@/lib/api-types";
import { MUSD } from "@/lib/chain/config";
import { setChainForTests } from "@/lib/server/chain";
import { clock } from "@/lib/server/clock";
import { resetDbForTests, type Sql } from "@/lib/server/db";
import { runIndexerPass } from "@/lib/server/indexer";
import { createTip, patchTip, readTip, submitTip } from "@/lib/server/tips";
import { containsTipCalldata, embeddedRefs, expectedTipCalldata } from "@/lib/server/verify";
import { CREATOR, FakeChain, T0, makeCreator, transferLog } from "./fakes";

// Mezo Passport Bitcoin wallets pay through a Mezo smart account: the outer tx targets the account (sent by its
// relayer/bundler) and nests MUSD.transfer(recipient, amount) ++ tip suffix as inner call data.
const SMART_ACCOUNT = "0x00000000000000000000000000000000005afe01";
const RELAYER = "0x0000000000000000000000000000000000000b0b";
const accountAbi = parseAbi(["function execute(address to, uint256 value, bytes data)"]);

let sql: Sql;
let chain: FakeChain;

beforeEach(async () => {
  clock.set(() => T0);
  sql = await resetDbForTests();
  chain = new FakeChain();
  setChainForTests(chain);
  await makeCreator(sql, CREATOR, "alice");
});

const ref = (i: TipIntent) => i.payment.dataSuffix.slice(-32);
const inner = (i: TipIntent, over: { amount?: bigint; recipient?: string } = {}) =>
  expectedTipCalldata(over.recipient ?? i.payment.recipient, over.amount ?? BigInt(i.payment.amountRaw), ref(i));
const wrap = (data: Hex) => encodeFunctionData({ abi: accountAbi, functionName: "execute", args: [MUSD, 0n, data] });

function payViaSmartAccount(i: TipIntent, opts: { input?: Hex; blockNumber?: bigint } = {}) {
  const amount = BigInt(i.payment.amountRaw);
  return chain.mine({
    from: RELAYER,
    to: SMART_ACCOUNT,
    input: opts.input ?? wrap(inner(i)),
    blockNumber: opts.blockNumber,
    logs: (m) => [transferLog(SMART_ACCOUNT, i.payment.recipient, amount, m)],
  });
}

describe("smart-account (Mezo Passport) tips", () => {
  it("finds the nested transfer call and its ref", async () => {
    const i = await createTip(sql, { username: "alice", amount: "5" });
    const input = wrap(inner(i));
    expect(embeddedRefs(input)).toEqual([ref(i)]);
    expect(containsTipCalldata(input, i.payment.recipient, BigInt(i.payment.amountRaw), ref(i))).toBe(true);
    expect(containsTipCalldata(input, i.payment.recipient, BigInt(i.payment.amountRaw) + 1n, ref(i))).toBe(false);
  });

  it("confirms a tip paid through a smart account; sender = the smart account", async () => {
    const i = await createTip(sql, { username: "alice", amount: "5", supporterName: "Satoshi", message: "gm" });
    await patchTip(sql, i.tip.id, { status: "awaiting_wallet" });
    const hash = payViaSmartAccount(i);
    const v = await submitTip(sql, chain, i.tip.id, hash);
    expect([v.status, v.senderAddress?.toLowerCase(), v.supporterName]).toEqual(["confirmed", SMART_ACCOUNT, "Satoshi"]);
  });

  it("rejects a smart-account tx that doesn't carry this intent's call (and releases the hash)", async () => {
    const a = await createTip(sql, { username: "alice", amount: "5" });
    const b = await createTip(sql, { username: "alice", amount: "5" });
    const hash = payViaSmartAccount(a); // carries a's ref
    const v = await submitTip(sql, chain, b.tip.id, hash);
    expect([v.status, v.failureReason, v.txHash]).toEqual(["failed", "wrong_token", null]);
    // a can still claim its own payment
    expect((await submitTip(sql, chain, a.tip.id, hash)).status).toBe("confirmed");
  });

  it("rejects a nested call whose amount differs from the intent", async () => {
    const i = await createTip(sql, { username: "alice", amount: "5" });
    const hash = payViaSmartAccount(i, { input: wrap(inner(i, { amount: 1n })) });
    const v = await submitTip(sql, chain, i.tip.id, hash);
    expect(v.status).toBe("failed");
  });

  it("indexer binds a never-submitted smart-account tip by its nested ref", async () => {
    const i = await createTip(sql, { username: "alice", amount: "2", supporterName: "Ann" });
    await patchTip(sql, i.tip.id, { status: "awaiting_wallet" });
    const hash = payViaSmartAccount(i, { blockNumber: 20n });
    await runIndexerPass(sql, chain);
    const v = await readTip(sql, chain, i.tip.id);
    expect([v.status, v.txHash, v.supporterName]).toEqual(["confirmed", hash, "Ann"]);
  });
});
