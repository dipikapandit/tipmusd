import { z } from "zod";
import type { TipsPage } from "@/lib/api-types";
import { requireSession } from "@/lib/server/auth";
import { listDashboardTips } from "@/lib/server/dashboard";
import { parseQuery, route } from "@/lib/server/http";

export const dynamic = "force-dynamic";

const zQuery = z.object({
  status: z.string().max(32).optional(),
  from: z.string().max(40).optional(),
  to: z.string().max(40).optional(),
  cursor: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
});

export const GET = route(async (req, { sql }): Promise<TipsPage> => {
  const s = await requireSession(sql, req);
  return listDashboardTips(sql, s, parseQuery(req, zQuery));
});
