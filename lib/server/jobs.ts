// Background work shared by the worker loop, GET /api/cron and POST /api/indexer/sync (bearer):
// expiry/timeout sweep + re-verification of pending tips, then an indexer pass.
import type { SyncResult } from "@/lib/api-types";
import { getAddress } from "viem";
import { MEZO_TESTNET_ID, MUSD } from "@/lib/chain/config";
import type { ChainAdapter } from "./chain";
import type { Sql } from "./db";
import { indexerStatus, runIndexerPass } from "./indexer";
import { pruneRateLimits } from "./ratelimit";
import { sweepTips, type SweepResult } from "./tips";

export interface JobsResult {
  ok: boolean;
  sweep: SweepResult | null;
  indexer: SyncResult | null;
  errors: string[];
}

export async function runJobs(sql: Sql, chain: ChainAdapter): Promise<JobsResult> {
  const res: JobsResult = { ok: true, sweep: null, indexer: null, errors: [] };
  try {
    res.sweep = await sweepTips(sql, chain);
  } catch (e) {
    res.ok = false;
    res.errors.push(`sweep: ${(e as Error).message}`);
  }
  try {
    res.indexer = await runIndexerPass(sql, chain);
  } catch (e) {
    res.ok = false;
    res.errors.push(`indexer: ${(e as Error).message}`);
  }
  await pruneRateLimits(sql).catch(() => undefined);
  return res;
}

export interface Health {
  ok: boolean;
  db: boolean;
  rpc: boolean;
  chainId: number | null;
  block: string | null;
  indexerLag: number | null;
  token?: string;
}

export async function health(sql: Sql | null, chain: ChainAdapter): Promise<Health> {
  let db = false;
  let lastBlock: bigint | null = null;
  if (sql) {
    try {
      await sql`SELECT 1`;
      db = true;
      lastBlock = (await indexerStatus(sql)).lastBlock;
    } catch {
      db = false;
    }
  }
  let rpc = false;
  let chainId: number | null = null;
  let block: bigint | null = null;
  try {
    const [id, head] = await Promise.all([chain.chainId(), chain.getBlockNumber()]);
    chainId = id;
    block = head;
    rpc = id === MEZO_TESTNET_ID;
  } catch {
    rpc = false;
  }
  const lag = block !== null && lastBlock !== null ? Number(block > lastBlock ? block - lastBlock : 0n) : null;
  return { ok: db && rpc, db, rpc, chainId, block: block?.toString() ?? null, indexerLag: lag, token: getAddress(MUSD) };
}
