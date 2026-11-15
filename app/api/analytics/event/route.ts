import { z } from "zod";
import { ANALYTICS_EVENT_TYPES, recordAnalyticsEvent } from "@/lib/server/events";
import { clientIp, parseBody, route } from "@/lib/server/http";

export const dynamic = "force-dynamic";

const zEvent = z.object({
  username: z.string().min(1).max(64),
  type: z.enum(ANALYTICS_EVENT_TYPES as readonly [string, ...string[]]),
  source: z.string().max(64).optional(),
});

/** Public, rate limited, deduped per visitor/creator/type/day. */
export const POST = route(
  async (req, { sql }) => {
    const body = await parseBody(req, zEvent);
    await recordAnalyticsEvent(sql, body as Parameters<typeof recordAnalyticsEvent>[1], {
      ip: clientIp(req),
      userAgent: (req.headers.get("user-agent") || "").slice(0, 400),
    });
    return { ok: true };
  },
  { rateLimit: { bucket: "analytics", limit: 60, windowSec: 60 } },
);
