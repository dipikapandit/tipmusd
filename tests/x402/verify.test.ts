import { describe, expect, it } from "vitest";
import { checkSettlementTx, musdTransfers } from "@/lib/server/x402/verify";
import { CREATOR_WALLET, FakeChain, OTHER, PAYER, TX, transferLog } from "./fakes";

const AMOUNT = 2n * 10n ** 18n;
const exp = { txHash: TX, payer: PAYER, payTo: CREATOR_WALLET, amountRaw: AMOUNT, requiredConfirmations: 2 };

describe("x402 settlement verification (fake chain)", () => {
  it("confirms an exact MUSD transfer payer → creator", async () => {
    const chain = new FakeChain();
    chain.put(TX, [transferLog(PAYER, CREATOR_WALLET, AMOUNT, 3)]);
    const r = await checkSettlementTx(chain, exp);
    expect(r.kind).toBe("confirmed");
    if (r.kind === "confirmed") {
      expect(r.transfer).toEqual({ from: PAYER, to: CREATOR_WALLET, value: AMOUNT, logIndex: 3 });
      expect(r.confirmations).toBe(11);
    }
  });

  it("matches case-insensitively on addresses", async () => {
    const chain = new FakeChain();
    chain.put(TX, [transferLog(PAYER, CREATOR_WALLET, AMOUNT)]);
    const r = await checkSettlementTx(chain, { ...exp, payTo: CREATOR_WALLET.toUpperCase().replace("0X", "0x") });
    expect(r.kind).toBe("confirmed");
  });

  it("is pending while there is no receipt", async () => {
    expect(await checkSettlementTx(new FakeChain(), exp)).toEqual({ kind: "pending", reason: "no_receipt" });
  });

  it("is pending until enough confirmations", async () => {
    const chain = new FakeChain();
    chain.put(TX, [transferLog(PAYER, CREATOR_WALLET, AMOUNT)], { block: 100n });
    const r = await checkSettlementTx(chain, exp);
    expect(r).toMatchObject({ kind: "pending", reason: "confirmations", confirmations: 1, blockNumber: 100n });
  });

  it("fails on reverted tx", async () => {
    const chain = new FakeChain();
    chain.put(TX, [], { status: "reverted" });
    expect(await checkSettlementTx(chain, exp)).toEqual({ kind: "failed", reason: "reverted" });
  });

  it("fails on wrong amount / recipient / sender / no transfer", async () => {
    const chain = new FakeChain();
    chain.put(TX, [transferLog(PAYER, CREATOR_WALLET, AMOUNT - 1n)]);
    expect(await checkSettlementTx(chain, exp)).toMatchObject({ reason: "amount_mismatch" });
    chain.put(TX, [transferLog(PAYER, OTHER, AMOUNT)]);
    expect(await checkSettlementTx(chain, exp)).toMatchObject({ reason: "recipient_mismatch" });
    chain.put(TX, [transferLog(OTHER, CREATOR_WALLET, AMOUNT)]);
    expect(await checkSettlementTx(chain, exp)).toMatchObject({ reason: "sender_mismatch" });
    chain.put(TX, []);
    expect(await checkSettlementTx(chain, exp)).toMatchObject({ reason: "no_matching_transfer" });
  });

  it("ignores Transfer logs from other tokens", async () => {
    const chain = new FakeChain();
    chain.put(TX, [transferLog(PAYER, CREATOR_WALLET, AMOUNT, 0, OTHER)]);
    expect(await checkSettlementTx(chain, exp)).toMatchObject({ kind: "failed", reason: "no_matching_transfer" });
    expect(musdTransfers(chain.receipts.get(TX)!.logs)).toEqual([]);
  });

  it("picks the exact-amount log when the tx has several MUSD transfers", async () => {
    const chain = new FakeChain();
    chain.put(TX, [transferLog(PAYER, CREATOR_WALLET, 1n, 0), transferLog(PAYER, CREATOR_WALLET, AMOUNT, 1)]);
    const r = await checkSettlementTx(chain, exp);
    expect(r.kind === "confirmed" && r.transfer.logIndex).toBe(1);
  });
});
