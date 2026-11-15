import type { SyncResult } from "@/lib/api-types";
import { requireSession } from "@/lib/server/auth";
import { getChain } from "@/lib/server/chain";
import { env } from "@/lib/server/env";
import { hasBearer, route } from "@/lib/server/http";
import { runCatchup, runIndexerPass } from "@/lib/server/indexer";
import { sweepTips } from "@/lib/server/tips";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * `Authorization: Bearer $INDEXER_SECRET` → full pass (sweep + indexer). A signed-in creator → throttled,
 * bounded catch-up (≤ once per 15 s globally).
 */
export const POST = route(async (req, { sql }): Promise<SyncResult> => {
  const chain = getChain();
  if (hasBearer(req, env.indexerSecret())) {
    await sweepTips(sql, chain);
    return runIndexerPass(sql, chain);
  }
  await requireSession(sql, req);
  return runCatchup(sql, chain);
});
