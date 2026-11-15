import { getChain } from "@/lib/server/chain";
import { env } from "@/lib/server/env";
import { unauthorized } from "@/lib/server/errors";
import { hasBearer, json, route } from "@/lib/server/http";
import { runJobs } from "@/lib/server/jobs";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Vercel Cron: `Authorization: Bearer $CRON_SECRET`. Runs the expiry sweep + an indexer pass. */
export const GET = route(async (req, { sql }) => {
  if (!hasBearer(req, env.cronSecret())) throw unauthorized("Missing or invalid cron secret");
  const r = await runJobs(sql, getChain());
  return json(r, { status: r.ok ? 200 : 500 });
});
