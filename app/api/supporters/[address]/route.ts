import type { SupporterProfile } from "@/lib/api-types";
import { notFound } from "@/lib/server/errors";
import { json, route } from "@/lib/server/http";
import { getSupporterProfile } from "@/lib/server/social";

export const dynamic = "force-dynamic";

/** Public supporter profile (creators backed publicly, per-token totals). 404 when there are no public tips. */
export const GET = route<{ address: string }>(
  async (_req, { sql, params }) => {
    const data: SupporterProfile | null = await getSupporterProfile(params.address ?? "", sql);
    if (!data) throw notFound("No public tips from this address");
    return json(data, { headers: { "cache-control": "public, s-maxage=30, stale-while-revalidate=30" } });
  },
  { rateLimit: { bucket: "social", limit: 120, windowSec: 60 } },
);
