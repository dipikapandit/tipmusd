// Server-side runtime configuration (read lazily so tests and the worker can set process.env first).

function num(name: string, fallback: number, min: number): number {
  const raw = process.env[name];
  const n = raw === undefined || raw === "" ? fallback : Number(raw);
  return Number.isFinite(n) ? Math.max(min, n) : fallback;
}

export const env = {
  isProd: () => process.env.NODE_ENV === "production",
  isTest: () => Boolean(process.env.VITEST),
  /** Blocks (including the tx's own block) a Transfer must have before a tip counts. 1 = mined. */
  confirmations: () => Math.max(1, Math.floor(num("CONFIRMATIONS", 1, 1))),
  workerIntervalMs: () => num("WORKER_INTERVAL_MS", 10_000, 1000),
  appUrl: () => (process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000").replace(/\/+$/, ""),
  sessionSecret(): string {
    const s = process.env.SESSION_SECRET;
    if (s && s.length >= 32) return s;
    if (env.isProd()) throw new Error("SESSION_SECRET must be set (>= 32 chars) in production");
    return "dev-only-insecure-session-secret-change-me-0000";
  },
  /** Bearer token for POST /api/indexer/sync (external cron / worker host). Empty = disabled. */
  indexerSecret: () => process.env.INDEXER_SECRET || "",
  /** Bearer token for GET /api/cron (Vercel Cron sends `Authorization: Bearer $CRON_SECRET`). Empty = disabled. */
  cronSecret: () => process.env.CRON_SECRET || "",
  /** First block the indexer scans on a fresh database (default: head − INDEXER_BOOTSTRAP_BLOCKS). */
  indexerStartBlock(): bigint | null {
    const v = process.env.INDEXER_START_BLOCK;
    return v && /^\d+$/.test(v) ? BigInt(v) : null;
  },
  indexerBootstrapBlocks: () => BigInt(Math.floor(num("INDEXER_BOOTSTRAP_BLOCKS", 5_000, 0))),
  /** Max blocks per indexer pass (worker / cron / bearer sync). */
  indexerMaxBlocks: () => BigInt(Math.floor(num("INDEXER_MAX_BLOCKS", 20_000, 1))),
  /** Blocks to rewind when the cursor block hash no longer matches the chain. */
  reorgWindow: () => Math.floor(num("REORG_WINDOW", 20, 1)),
  /** A submitted tx with no receipt after this many seconds → failed/timeout. */
  submittedTimeoutSec: () => num("SUBMITTED_TIMEOUT_SECONDS", 30 * 60, 60),
};
