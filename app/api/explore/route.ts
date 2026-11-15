import { z } from "zod";
import type { ExploreResponse } from "@/lib/api-types";
import { json, parseQuery, route } from "@/lib/server/http";
import { getExplore } from "@/lib/server/social";

export const dynamic = "force-dynamic";

/** Public network view: totals per token, creators (by supporters or most recent tip) and the latest public tips. */
export const GET = route(
  async (req, { sql }) => {
    const q = parseQuery(req, z.object({ sort: z.enum(["supporters", "recent"]).optional(), limit: z.coerce.number().int().min(1).max(50).optional() }));
    const data: ExploreResponse = await getExplore({ sort: q.sort, limit: q.limit }, sql);
    return json(data, { headers: { "cache-control": "public, s-maxage=30, stale-while-revalidate=30" } });
  },
  { rateLimit: { bucket: "social", limit: 120, windowSec: 60 } },
);
