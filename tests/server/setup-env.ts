// Imported FIRST by every server test (env is read lazily, but config modules read NEXT_PUBLIC_* at load).
process.env.NEXT_PUBLIC_APP_URL = "http://localhost:3000";
process.env.SESSION_SECRET = "test-session-secret-0123456789abcdef0123456789";
process.env.CONFIRMATIONS = "1";
process.env.REORG_WINDOW = "5";
process.env.INDEXER_START_BLOCK = "1";
process.env.INDEXER_SECRET = "test-indexer-secret";
process.env.CRON_SECRET = "test-cron-secret";
delete process.env.DATABASE_URL;
delete process.env.NEXT_PUBLIC_MUSD_ADDRESS;
// Boot the in-memory PGlite + schema during import (no hook timeout applies here).
const { getDb } = await import("@/lib/server/db");
await getDb();
export {};
