// Test doubles for the x402 rail: a fake chain and a fake facilitator.
import { pad, toHex, type Hex } from "viem";
import type { FacilitatorClient } from "@x402/core/server";
import { MUSD, TRANSFER_TOPIC } from "@/lib/chain/config";
import type { X402Chain, X402Receipt, X402ReceiptLog } from "@/lib/server/x402/chain";

export const PAYER = "0x1111111111111111111111111111111111111111";
export const CREATOR_WALLET = "0x2222222222222222222222222222222222222222";
export const OTHER = "0x3333333333333333333333333333333333333333";
export const TX = ("0x" + "ab".repeat(32)) as Hex;
export const TX2 = ("0x" + "cd".repeat(32)) as Hex;

export function transferLog(from: string, to: string, value: bigint, logIndex = 0, token: string = MUSD): X402ReceiptLog {
  return {
    address: token,
    topics: [TRANSFER_TOPIC, pad(from as Hex, { size: 32 }), pad(to as Hex, { size: 32 })],
    data: toHex(value, { size: 32 }),
    logIndex,
  };
}

export class FakeChain implements X402Chain {
  receipts = new Map<string, X402Receipt>();
  head = 100n;
  getReceipt = async (h: Hex) => this.receipts.get(h.toLowerCase()) ?? null;
  getBlockNumber = async () => this.head;
  getBlockTimestamp = async () => 1_760_000_000n;
  put(tx: string, logs: X402ReceiptLog[], opts: { status?: "success" | "reverted"; block?: bigint } = {}) {
    this.receipts.set(tx.toLowerCase(), {
      status: opts.status ?? "success",
      blockNumber: opts.block ?? 90n,
      blockHash: "0x" + "ee".repeat(32),
      logs,
    });
  }
}

export class FakeFacilitator implements FacilitatorClient {
  verifyCalls = 0;
  settleCalls = 0;
  verifyResult: { isValid: boolean; invalidReason?: string } = { isValid: true };
  settleResult: { success: boolean; transaction: string; errorReason?: string; payer?: string } = {
    success: true,
    transaction: TX,
    payer: PAYER,
  };
  async getSupported() {
    return {
      kinds: [{ x402Version: 2, scheme: "exact", network: "eip155:31611" as const }],
      extensions: ["eip2612GasSponsoring"],
      signers: { "eip155:*": ["0x9984b3eE06Dd131df132AbCAE70875a0fA4c7f6a"] },
    };
  }
  async verify() {
    this.verifyCalls++;
    return { ...this.verifyResult, payer: PAYER };
  }
  async settle() {
    this.settleCalls++;
    return { network: "eip155:31611" as const, ...this.settleResult };
  }
}
