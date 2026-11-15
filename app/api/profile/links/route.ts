import { z } from "zod";
import type { TipLink } from "@/lib/api-types";
import { requireSession } from "@/lib/server/auth";
import { json, parseBody, route } from "@/lib/server/http";
import { createTipLink, listTipLinks } from "@/lib/server/profiles";

export const dynamic = "force-dynamic";

export const GET = route(async (req, { sql }): Promise<TipLink[]> => {
  const s = await requireSession(sql, req);
  return listTipLinks(sql, s);
});

export const POST = route(
  async (req, { sql }) => {
    const s = await requireSession(sql, req);
    const body = await parseBody(req, z.object({ slug: z.string().max(64), campaignName: z.string().max(200) }));
    return json(await createTipLink(sql, s, body), { status: 201 });
  },
  { rateLimit: { bucket: "links", limit: 30, windowSec: 60 } },
);
