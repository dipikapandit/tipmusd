import { z } from "zod";
import type { Analytics } from "@/lib/api-types";
import { requireSession } from "@/lib/server/auth";
import { getAnalytics } from "@/lib/server/dashboard";
import { parseQuery, route } from "@/lib/server/http";

export const dynamic = "force-dynamic";

export const GET = route(async (req, { sql }): Promise<Analytics> => {
  const s = await requireSession(sql, req);
  const { range } = parseQuery(req, z.object({ range: z.enum(["7d", "30d", "90d"]).default("30d") }));
  return getAnalytics(sql, s, range);
});
