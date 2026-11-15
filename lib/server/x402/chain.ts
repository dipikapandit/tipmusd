// Minimal chain reads the x402 rail needs. An interface so tests can use a fake chain.
// (Self-contained on purpose: the x402 rail doesn't depend on the app tip verifier's internals.)
import { createPublicClient, http, type Hex } from "viem";
import { mezoTestnet } from "@/lib/chain/config";
import { x402Env } from "./config";

export interface X402ReceiptLog {
  address: string;
  topics: readonly string[];
  data: string;
  logIndex: number;
}

export interface X402Receipt {
  status: "success" | "reverted";
  blockNumber: bigint;
  blockHash: string;
  logs: readonly X402ReceiptLog[];
}

export interface X402Chain {
  /** null when the node doesn't know the tx (yet). */
  getReceipt(txHash: Hex): Promise<X402Receipt | null>;
  getBlockNumber(): Promise<bigint>;
  /** Block timestamp (unix seconds). */
  getBlockTimestamp(blockNumber: bigint): Promise<bigint>;
}

let cached: X402Chain | null = null;

export function viemX402Chain(): X402Chain {
  if (cached) return cached;
  const client = createPublicClient({ chain: mezoTestnet, transport: http(x402Env.rpcUrl(), { timeout: 15_000, retryCount: 2 }) });
  cached = {
    async getReceipt(txHash) {
      try {
        const r = await client.getTransactionReceipt({ hash: txHash });
        return {
          status: r.status,
          blockNumber: r.blockNumber,
          blockHash: r.blockHash,
          logs: r.logs.map((l) => ({ address: l.address, topics: l.topics, data: l.data, logIndex: l.logIndex })),
        };
      } catch (e) {
        if (e instanceof Error && (e.name === "TransactionReceiptNotFoundError" || /could not be found/i.test(e.message))) return null;
        throw e;
      }
    },
    getBlockNumber: () => client.getBlockNumber(),
    async getBlockTimestamp(blockNumber) {
      const b = await client.getBlock({ blockNumber });
      return b.timestamp;
    },
  };
  return cached;
}
