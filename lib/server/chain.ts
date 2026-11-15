// Chain service. Every chain access in the backend (and x402) goes through the small `ChainAdapter` interface so
// tests can inject a fake (`setChainForTests`). The live adapter is a viem public client on Mezo Testnet
// (NEXT_PUBLIC_MEZO_RPC_URL). Framework-free: safe to import from server components, routes, the worker and scripts.

import {
  createPublicClient,
  decodeEventLog,
  http,
  pad,
  toHex,
  verifyMessage,
  type Address,
  type Hex,
  type PublicClient,
} from "viem";
import { erc20Abi } from "@/lib/chain/abis";
import { MUSD, TRANSFER_TOPIC, mezoTestnet } from "@/lib/chain/config";
import { unavailable } from "./errors";

// ---------------------------------------------------------------- types

export interface RawLog {
  address: Address;
  topics: Hex[];
  data: Hex;
  blockNumber: bigint;
  blockHash: Hex;
  transactionHash: Hex;
  logIndex: number;
}

export interface RawReceipt {
  status: "success" | "reverted";
  to: Address | null;
  from: Address;
  blockNumber: bigint;
  blockHash: Hex;
  transactionHash: Hex;
  logs: RawLog[];
}

export interface RawTransaction {
  hash: Hex;
  from: Address;
  to: Address | null;
  input: Hex;
  blockNumber: bigint | null;
}

export interface ChainBlock {
  number: bigint;
  hash: Hex;
  timestamp: bigint; // unix seconds
}

export interface ChainAdapter {
  chainId(): Promise<number>;
  getBlockNumber(): Promise<bigint>;
  getBlock(n: bigint): Promise<ChainBlock>;
  /**
   * `Transfer` logs of `token` (default MUSD) in [fromBlock, toBlock] (callers keep ranges ≤ MAX_LOG_RANGE). `to` optionally narrows the
   * query to transfers whose recipient is in the list (topic2 OR-filter); the caller must still filter locally.
   */
  getLogs(range: { fromBlock: bigint; toBlock: bigint; to?: Address[]; token?: Address }): Promise<RawLog[]>;
  getReceipt(hash: Hex): Promise<RawReceipt | null>;
  getTransaction(hash: Hex): Promise<RawTransaction | null>;
  /** MUSD balance (base units, 18 dec). */
  musdBalanceOf(address: Address): Promise<bigint>;
  /** Native BTC balance (wei, 18 dec). */
  nativeBalanceOf(address: Address): Promise<bigint>;
  /** ERC-1271 / ERC-6492 smart-account signature check (EOA signatures are checked locally first). */
  verifySmartSignature(address: Address, message: string, signature: Hex): Promise<boolean>;
}

export const MAX_LOG_RANGE = 2000n;

// ---------------------------------------------------------------- decoding

const lc = (a: string | null | undefined) => (a ?? "").toLowerCase();

export interface MusdTransfer {
  from: Address; // lowercase
  to: Address; // lowercase
  value: bigint;
  logIndex: number;
  blockNumber: bigint;
  blockHash: Hex;
  txHash: Hex;
}

/** A decoded ERC-20 Transfer of one of our tip tokens (MUSD or MEZO). */
export type TokenTransfer = MusdTransfer;

/**
 * Decode a raw log as a `Transfer` of `token` (default MUSD). Anything not emitted by that exact contract, or not
 * a well-formed Transfer, returns null — a lookalike token emitting the same event is never trusted.
 */
export function decodeTokenTransfer(log: RawLog, token: string = MUSD): TokenTransfer | null {
  if (lc(log.address) !== lc(token)) return null;
  if (lc(log.topics[0]) !== TRANSFER_TOPIC) return null;
  try {
    const d = decodeEventLog({ abi: erc20Abi, eventName: "Transfer", topics: log.topics as [Hex, ...Hex[]], data: log.data, strict: true });
    const args = d.args as { from: Address; to: Address; value: bigint };
    return {
      from: lc(args.from) as Address,
      to: lc(args.to) as Address,
      value: args.value,
      logIndex: log.logIndex,
      blockNumber: log.blockNumber,
      blockHash: lc(log.blockHash) as Hex,
      txHash: lc(log.transactionHash) as Hex,
    };
  } catch {
    return null;
  }
}

/** Decode a raw log as a MUSD `Transfer` (null for anything else). */
export const decodeMusdTransfer = (log: RawLog): MusdTransfer | null => decodeTokenTransfer(log, MUSD);

/** All transfers of `token` in a receipt to `to` (and optionally from `from`). */
export function findTokenTransfers(receipt: RawReceipt, token: string, filter: { to: string; from?: string }): TokenTransfer[] {
  return receipt.logs
    .map((l) => decodeTokenTransfer(l, token))
    .filter((t): t is TokenTransfer => t !== null && t.to === lc(filter.to) && (!filter.from || t.from === lc(filter.from)));
}

/** All MUSD transfers in a receipt to `to` (and optionally from `from`). */
export function findMusdTransfers(receipt: RawReceipt, filter: { to: string; from?: string }): MusdTransfer[] {
  return findTokenTransfers(receipt, MUSD, filter);
}

// ---------------------------------------------------------------- live adapter

function rpcUrl(): string {
  return process.env.NEXT_PUBLIC_MEZO_RPC_URL || mezoTestnet.rpcUrls.default.http[0];
}

let _client: PublicClient | null = null;
export function publicClient(): PublicClient {
  if (!_client) {
    _client = createPublicClient({ chain: mezoTestnet, transport: http(rpcUrl(), { retryCount: 2, timeout: 20_000 }) }) as PublicClient;
  }
  return _client;
}

interface RpcLog {
  address: Address;
  topics: Hex[];
  data: Hex;
  blockNumber: Hex | bigint | null;
  blockHash: Hex | null;
  transactionHash: Hex | null;
  logIndex: Hex | number | null;
}

function toRawLog(l: RpcLog): RawLog {
  return {
    address: l.address,
    topics: [...l.topics],
    data: l.data,
    blockNumber: l.blockNumber === null ? 0n : BigInt(l.blockNumber),
    blockHash: (l.blockHash ?? "0x") as Hex,
    transactionHash: (l.transactionHash ?? "0x") as Hex,
    logIndex: l.logIndex === null ? 0 : Number(l.logIndex),
  };
}

const isNotFound = (e: unknown) => e instanceof Error && /could not be found|not found/i.test(e.message);

export function createLiveChain(client: PublicClient = publicClient()): ChainAdapter {
  return {
    chainId: () => client.getChainId(),
    getBlockNumber: () => client.getBlockNumber({ cacheTime: 0 }),
    async getBlock(n) {
      const b = await client.getBlock({ blockNumber: n });
      return { number: b.number ?? n, hash: b.hash as Hex, timestamp: b.timestamp };
    },
    async getLogs({ fromBlock, toBlock, to, token }) {
      if (toBlock < fromBlock) return [];
      if (toBlock - fromBlock + 1n > MAX_LOG_RANGE) throw new Error(`getLogs range too large (${fromBlock}-${toBlock})`);
      const topics: (Hex | Hex[] | null)[] = [TRANSFER_TOPIC, null];
      if (to && to.length) topics.push(to.map((a) => pad(lc(a) as Hex, { size: 32 })));
      const logs = (await client.request({
        method: "eth_getLogs",
        params: [{ address: token ?? MUSD, topics, fromBlock: toHex(fromBlock), toBlock: toHex(toBlock) }],
      } as never)) as RpcLog[];
      return logs.map(toRawLog);
    },
    async getReceipt(hash) {
      try {
        const r = await client.getTransactionReceipt({ hash });
        return {
          status: r.status,
          to: r.to,
          from: r.from,
          blockNumber: r.blockNumber,
          blockHash: r.blockHash,
          transactionHash: r.transactionHash,
          logs: r.logs.map((l) => toRawLog(l as unknown as RpcLog)),
        };
      } catch (e) {
        if (isNotFound(e)) return null;
        throw e;
      }
    },
    async getTransaction(hash) {
      try {
        const t = await client.getTransaction({ hash });
        return { hash: t.hash, from: t.from, to: t.to ?? null, input: t.input, blockNumber: t.blockNumber ?? null };
      } catch (e) {
        if (isNotFound(e)) return null;
        throw e;
      }
    },
    async musdBalanceOf(address) {
      return (await client.readContract({ address: MUSD, abi: erc20Abi, functionName: "balanceOf", args: [address] })) as bigint;
    },
    nativeBalanceOf: (address) => client.getBalance({ address }),
    async verifySmartSignature(address, message, signature) {
      try {
        return await client.verifyMessage({ address, message, signature });
      } catch (e) {
        if (isTransientError(e)) throw e; // RPC outage is not a verdict on the signature
        return false;
      }
    },
  };
}

// ---------------------------------------------------------------- singleton + helpers

let _chain: ChainAdapter | null = null;
/** The process-wide chain adapter (live viem client unless a test injected a fake). */
export function getChain(): ChainAdapter {
  if (!_chain) _chain = createLiveChain();
  return _chain;
}
export function setChainForTests(c: ChainAdapter | null) {
  _chain = c;
}

/** EOA ecrecover first (no network), then ERC-1271/6492 via the RPC for smart accounts. */
export async function verifyWalletSignature(chain: ChainAdapter, address: Address, message: string, signature: Hex): Promise<boolean> {
  try {
    if (await verifyMessage({ address, message, signature })) return true;
  } catch {
    // malformed / non-65-byte signature: fall through to the smart-account check
  }
  // Mezo Passport Bitcoin wallets sign as a Mezo smart account: ERC-1271, or ERC-6492 before first deployment.
  try {
    return await chain.verifySmartSignature(address, message, signature);
  } catch (e) {
    if (isTransientError(e)) throw unavailable("chain_unavailable", "Mezo RPC is unreachable right now. Try again shortly.");
    throw e;
  }
}

/** Network / RPC / DB-connection trouble: retry later instead of treating it as a verdict. */
export function isTransientError(e: unknown): boolean {
  for (let c: unknown = e, i = 0; c && i < 6; c = (c as { cause?: unknown }).cause, i++) {
    const err = c as { name?: string; code?: unknown; message?: string };
    if (err.name && /^(HttpRequestError|TimeoutError|RpcRequestError|WebSocketRequestError|SocketClosedError|AbortError)$/.test(err.name)) return true;
    const code = typeof err.code === "string" ? err.code : "";
    if (/^(08|53|57P)/.test(code) || /^CONNECTION_|^ECONN|^ETIMEDOUT|^EPIPE/.test(code)) return true;
    if (/fetch failed|ECONNREFUSED|ECONNRESET|ETIMEDOUT|socket hang up|timed out/i.test(err.message ?? "")) return true;
  }
  return false;
}
