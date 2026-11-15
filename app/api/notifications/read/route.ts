import { z } from "zod";
import { requireSession } from "@/lib/server/auth";
import { parseBody, route, zUuid } from "@/lib/server/http";
import { markNotificationsRead } from "@/lib/server/notifications";

export const dynamic = "force-dynamic";

export const POST = route(async (req, { sql }) => {
  const s = await requireSession(sql, req);
  const { ids } = await parseBody(req, z.object({ ids: z.array(zUuid).max(200).optional() }));
  await markNotificationsRead(sql, s.userId, ids);
  return { ok: true };
});
