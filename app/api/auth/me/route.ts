import type { MeResponse } from "@/lib/api-types";
import { requireSession } from "@/lib/server/auth";
import { route } from "@/lib/server/http";
import { me } from "@/lib/server/profiles";

export const dynamic = "force-dynamic";

/** MeResponse (profile null until onboarding is finished) or 401 when signed out. */
export const GET = route(async (req, { sql }): Promise<MeResponse> => {
  const s = await requireSession(sql, req);
  return me(sql, s.userId);
});
