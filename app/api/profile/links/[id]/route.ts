import { z } from "zod";
import type { TipLink } from "@/lib/api-types";
import { requireSession } from "@/lib/server/auth";
import { parseBody, route, uuidParam } from "@/lib/server/http";
import { updateTipLink } from "@/lib/server/profiles";

export const dynamic = "force-dynamic";

export const PATCH = route<{ id: string }>(
  async (req, { sql, params }): Promise<TipLink> => {
    const s = await requireSession(sql, req);
    const id = uuidParam(params.id);
    const body = await parseBody(req, z.object({ campaignName: z.string().max(200).optional(), isActive: z.boolean().optional() }));
    return updateTipLink(sql, s, id, body);
  },
  { rateLimit: { bucket: "links", limit: 30, windowSec: 60 } },
);
