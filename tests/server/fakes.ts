import { encodeAbiParameters, keccak256, pad, toHex, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { MUSD, TRANSFER_TOPIC } from "@/lib/chain/config";
import type { ChainAdapter, ChainBlock, RawLog, RawReceipt, RawTransaction } from "@/lib/server/chain";
import { clock } from "@/lib/server/clock";
import type { Sql } from "@/lib/server/db";
import { expectedTipCalldata } from "@/lib/server/verify";
import type { TipIntent } from "@/lib/api-types";

export const E18 = 10n ** 18n;
/** Wall clock for every test; fake block n has timestamp T0 + n seconds. */
export const T0 = new Date(1_900_000_000_000);
export const T0_SEC = BigInt(T0.getTime() / 1000);

export const acct = (byte: string) => privateKeyToAccount(`0x${byte.repeat(32)}` as Hex);
export const CREATOR = acct("a1");
export const CREATOR2 = acct("b2");
export const SUPPORTER = acct("c3");
export const NEW_WALLET = acct("d4");
export const STRANGER = acct("e5");
export const lc = (a: string) => a.toLowerCase() as Address;

let txCounter = 0;
export const txHash = (label = ""): Hex => keccak256(toHex(`tx-${label}-${++txCounter}`));
export const blockHashOf = (n: bigint, fork: number): Hex => keccak256(toHex(`block-${n}-${fork}`));

export function transferLog(from: string, to: string, value: bigint, meta: { blockNumber: bigint; txHash: Hex; logIndex?: number; address?: Address; fork?: number }): RawLog {
  return {
    address: meta.address ?? MUSD,
    topics: [TRANSFER_TOPIC, pad(lc(from), { size: 32 }), pad(lc(to), { size: 32 })],
    data: encodeAbiParameters([{ type: "uint256" }], [value]),
    blockNumber: meta.blockNumber,
    blockHash: blockHashOf(meta.blockNumber, meta.fork ?? 0),
    transactionHash: meta.txHash,
    logIndex: meta.logIndex ?? 0,
  };
}

/** In-memory chain. Tests mutate its state directly. */
export class FakeChain implements ChainAdapter {
  id = 31611;
  head = 100n;
  fork = new Map<bigint, number>();
  logs: RawLog[] = [];
  receipts = new Map<string, RawReceipt>();
  txs = new Map<string, RawTransaction>();
  calls: string[] = [];
  failing = new Set<string>();

  private hit(m: string) {
    this.calls.push(m);
    if (this.failing.has(m)) {
      const e = new Error(`HTTP request failed (${m})`);
      e.name = "HttpRequestError";
      throw e;
    }
  }
  async chainId() {
    this.hit("chainId");
    return this.id;
  }
  async getBlockNumber() {
    this.hit("getBlockNumber");
    return this.head;
  }
  async getBlock(n: bigint): Promise<ChainBlock> {
    this.hit("getBlock");
    return { number: n, hash: blockHashOf(n, this.fork.get(n) ?? 0), timestamp: T0_SEC + n };
  }
  async getLogs({ fromBlock, toBlock, to, token }: { fromBlock: bigint; toBlock: bigint; to?: Address[]; token?: Address }) {
    this.hit("getLogs");
    const addr = (token ?? MUSD).toLowerCase();
    if (toBlock - fromBlock + 1n > 2000n) throw new Error("range too large");
    const set = to ? new Set(to.map((a) => pad(lc(a), { size: 32 }).toLowerCase())) : null;
    return this.logs.filter(
      (l) => l.address.toLowerCase() === addr && l.blockNumber >= fromBlock && l.blockNumber <= toBlock && (!set || set.has(l.topics[2].toLowerCase())) && l.blockNumber <= this.head,
    );
  }
  async getReceipt(hash: Hex) {
    this.hit("getReceipt");
    return this.receipts.get(hash.toLowerCase()) ?? null;
  }
  async getTransaction(hash: Hex) {
    this.hit("getTransaction");
    return this.txs.get(hash.toLowerCase()) ?? null;
  }
  async musdBalanceOf() {
    return 0n;
  }
  async nativeBalanceOf() {
    return 0n;
  }
  async verifySmartSignature() {
    return false;
  }

  /** Mine a tx with the given calldata + logs at `blockNumber` (default head). */
  mine(opts: { hash?: Hex; from?: string; to?: string | null; input: Hex; logs?: (meta: { blockNumber: bigint; txHash: Hex }) => RawLog[]; status?: "success" | "reverted"; blockNumber?: bigint }) {
    const hash = (opts.hash ?? txHash()).toLowerCase() as Hex;
    const bn = opts.blockNumber ?? this.head;
    const from = lc(opts.from ?? SUPPORTER.address);
    const to = opts.to === undefined ? lc(MUSD) : opts.to === null ? null : lc(opts.to);
    const logs = opts.status === "reverted" ? [] : (opts.logs?.({ blockNumber: bn, txHash: hash }) ?? []);
    this.txs.set(hash, { hash, from, to, input: opts.input, blockNumber: bn });
    this.receipts.set(hash, { status: opts.status ?? "success", to, from, blockNumber: bn, blockHash: blockHashOf(bn, this.fork.get(bn) ?? 0), transactionHash: hash, logs });
    this.logs.push(...logs);
    return hash;
  }

  /** Broadcast only (no receipt yet). */
  pending(hash: Hex, input: Hex, from: string = SUPPORTER.address) {
    this.txs.set(hash.toLowerCase(), { hash, from: lc(from), to: lc(MUSD), input, blockNumber: null });
    return hash;
  }

  /** Pay a tip intent exactly as the app's wallet call would (optionally tampered). */
  payIntent(intent: TipIntent, over: { amount?: bigint; recipient?: string; input?: Hex; logValue?: bigint; logTo?: string; from?: string; blockNumber?: bigint; status?: "success" | "reverted"; to?: string | null } = {}) {
    const p = intent.payment;
    const amount = over.amount ?? BigInt(p.amountRaw);
    const recipient = over.recipient ?? p.recipient;
    const ref = p.dataSuffix.slice(-32);
    const input = over.input ?? expectedTipCalldata(recipient, amount, ref);
    const from = over.from ?? SUPPORTER.address;
    return this.mine({
      input,
      from,
      to: over.to,
      status: over.status,
      blockNumber: over.blockNumber,
      logs: (m) => [transferLog(from, over.logTo ?? recipient, over.logValue ?? amount, { ...m, address: (over.to ?? undefined) as Address | undefined })],
    });
  }
}

/** Session cookie for an address (inserts the user + session rows). */
export async function sessionFor(sql: Sql, address: string) {
  const { ensureUser } = await import("@/lib/server/users");
  const { signSessionId, SESSION_COOKIE } = await import("@/lib/server/auth");
  const { randomBytes } = await import("node:crypto");
  const { id: userId } = await ensureUser(sql, address);
  const id = randomBytes(32).toString("hex");
  const expiresAt = new Date(clock.now().getTime() + 3600_000);
  await sql`INSERT INTO sessions (id, user_id, address, expires_at) VALUES (${id}, ${userId}, ${address.toLowerCase()}, ${expiresAt})`;
  return { cookie: `${SESSION_COOKIE}=${signSessionId(id)}`, session: { id, userId, address: address.toLowerCase(), expiresAt } };
}

/** Signed-in creator with a profile. */
export async function makeCreator(sql: Sql, account = CREATOR, username = "alice", extra: Record<string, unknown> = {}) {
  const { createProfile } = await import("@/lib/server/profiles");
  const s = await sessionFor(sql, account.address);
  const profile = await createProfile(sql, s.session, { username, displayName: username.toUpperCase(), ...extra });
  return { ...s, profile };
}

export function req(url: string, init: RequestInit & { cookie?: string; json?: unknown; ip?: string } = {}): Request {
  const headers = new Headers(init.headers);
  if (init.cookie) headers.set("cookie", init.cookie);
  if (init.json !== undefined) headers.set("content-type", "application/json");
  headers.set("host", "localhost:3000");
  if (init.ip) headers.set("x-real-ip", init.ip);
  return new Request(`http://localhost:3000${url}`, {
    method: init.method ?? (init.json !== undefined ? "POST" : "GET"),
    headers,
    body: init.json !== undefined ? JSON.stringify(init.json) : init.body,
  });
}

export const params = <T extends Record<string, string>>(p: T) => ({ params: Promise.resolve(p) });

export async function code(p: Promise<unknown>): Promise<string> {
  const { HttpError } = await import("@/lib/server/errors");
  try {
    await p;
    return "ok";
  } catch (e) {
    return e instanceof HttpError ? e.code : String(e);
  }
}
