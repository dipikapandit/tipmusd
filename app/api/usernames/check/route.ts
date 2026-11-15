import { z } from "zod";
import type { UsernameCheck } from "@/lib/api-types";
import { sessionFromRequest } from "@/lib/server/auth";
import { parseQuery, route } from "@/lib/server/http";
import { checkUsername, profileRowByUser } from "@/lib/server/profiles";

export const dynamic = "force-dynamic";

export const GET = route(
  async (req, { sql }): Promise<UsernameCheck> => {
    const { u } = parseQuery(req, z.object({ u: z.string().max(64) }));
    // A signed-in creator checking their own (current or retired) name sees it as available.
    const s = await sessionFromRequest(sql, req);
    const self = s ? await profileRowByUser(sql, s.userId) : null;
    return checkUsername(sql, u, self ? String(self.id) : undefined);
  },
  { rateLimit: { bucket: "username-check", limit: 60, windowSec: 60 } },
);
