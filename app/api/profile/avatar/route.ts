import { z } from "zod";
import type { CreatorProfile } from "@/lib/api-types";
import { requireSession } from "@/lib/server/auth";
import { parseBody, route } from "@/lib/server/http";
import { deleteAvatar, setAvatar } from "@/lib/server/profiles";

export const dynamic = "force-dynamic";

// 200 KB decoded ≈ 274 KB base64 + data-URL prefix + JSON wrapper.
const MAX_BODY = 300_000;

export const PUT = route(
  async (req, { sql }): Promise<CreatorProfile> => {
    const s = await requireSession(sql, req);
    const { dataUrl } = await parseBody(req, z.object({ dataUrl: z.string().max(MAX_BODY) }), { maxChars: MAX_BODY });
    return setAvatar(sql, s, dataUrl);
  },
  { rateLimit: { bucket: "avatar", limit: 10, windowSec: 60 } },
);

export const DELETE = route(async (req, { sql }): Promise<CreatorProfile> => {
  const s = await requireSession(sql, req);
  return deleteAvatar(sql, s);
});
