import { getChain } from "@/lib/server/chain";
import { getDb } from "@/lib/server/db";
import { json } from "@/lib/server/http";
import { health } from "@/lib/server/jobs";

export const dynamic = "force-dynamic";

/** { ok, db, rpc, chainId, block, indexerLag } — 503 when the DB or RPC is down. Never throws. */
export async function GET(): Promise<Response> {
  const sql = await getDb().catch(() => null);
  const h = await health(sql, getChain());
  return json(h, { status: h.ok ? 200 : 503 });
}
