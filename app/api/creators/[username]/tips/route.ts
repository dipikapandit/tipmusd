import { z } from "zod";
import type { PublicTip } from "@/lib/api-types";
import { getPublicTips } from "@/lib/server/creators";
import { parseQuery, route } from "@/lib/server/http";

export const dynamic = "force-dynamic";

export const GET = route<{ username: string }>(async (req, { sql, params }): Promise<PublicTip[]> => {
  const { limit } = parseQuery(req, z.object({ limit: z.coerce.number().int().min(1).max(50).optional() }));
  return getPublicTips(params.username ?? "", { limit }, sql);
});
