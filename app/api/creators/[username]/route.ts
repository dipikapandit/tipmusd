import { z } from "zod";
import { getPublicCreator } from "@/lib/server/creators";
import { notFound } from "@/lib/server/errors";
import { parseQuery, route } from "@/lib/server/http";

export const dynamic = "force-dynamic";

/** PublicCreator, `{ redirectTo: "<current username>" }` for a retired alias, or 404 (unknown / suspended). */
export const GET = route<{ username: string }>(async (req, { sql, params }) => {
  const { c } = parseQuery(req, z.object({ c: z.string().max(64).optional() }));
  const r = await getPublicCreator(params.username ?? "", c ?? null, sql);
  if (!r) throw notFound("Creator not found");
  return r;
});
