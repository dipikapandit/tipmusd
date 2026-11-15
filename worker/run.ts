// TipMUSD background worker (Render or any Node host): expiry/timeout sweep + re-verification of pending tips,
// then an indexer pass, every WORKER_INTERVAL_MS. Backs off exponentially (capped at 2 min) while passes fail,
// e.g. during an RPC outage.
//   npm run worker         # loop
//   npm run worker:once    # single pass, then exit (non-zero if a step failed)

import "./load-env";
import { MEZO_TOKEN, MUSD } from "@/lib/chain/config";
import { getChain } from "@/lib/server/chain";
import { closeDb, dbKind, getDb } from "@/lib/server/db";
import { env } from "@/lib/server/env";
import { runJobs } from "@/lib/server/jobs";

const once = process.argv.includes("--once");
let stopping = false;
let wake: (() => void) | null = null;

function log(msg: string, extra?: Record<string, unknown>) {
  const x = extra ? " " + JSON.stringify(extra, (_k, v) => (typeof v === "bigint" ? v.toString() : v)) : "";
  console.log(`${new Date().toISOString()} [worker] ${msg}${x}`);
}

function onSignal(sig: string) {
  if (stopping) return;
  stopping = true;
  log(`${sig} received: finishing the current pass, then exiting`);
  wake?.();
}
process.on("SIGTERM", () => onSignal("SIGTERM"));
process.on("SIGINT", () => onSignal("SIGINT"));

async function main() {
  const sql = await getDb();
  const chain = getChain();
  log("starting", {
    db: dbKind(),
    tokens: { MUSD, MEZO: MEZO_TOKEN },
    confirmations: env.confirmations(),
    intervalMs: env.workerIntervalMs(),
    startBlock: env.indexerStartBlock()?.toString() ?? `head-${env.indexerBootstrapBlocks()}`,
  });

  let failures = 0;
  while (!stopping) {
    const r = await runJobs(sql, chain).catch((e) => {
      log("pass crashed", { error: (e as Error).message });
      return null;
    });
    if (r) log(r.ok ? "pass" : "pass with errors", { ...r });
    failures = r?.ok ? 0 : failures + 1;
    if (once) {
      await closeDb();
      process.exit(r?.ok ? 0 : 1);
    }
    const delay = Math.min(env.workerIntervalMs() * 2 ** Math.min(failures, 4), 120_000);
    await new Promise<void>((resolve) => {
      const t = setTimeout(resolve, delay);
      wake = () => {
        clearTimeout(t);
        resolve();
      };
    });
  }
  await closeDb();
  log("stopped");
}

main().catch((e) => {
  log("fatal", { error: (e as Error).message });
  process.exit(1);
});
