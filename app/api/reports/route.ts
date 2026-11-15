import { z } from "zod";
import { REPORT_REASONS, createReport } from "@/lib/server/events";
import { clientIp, parseBody, route } from "@/lib/server/http";

export const dynamic = "force-dynamic";

const zReport = z.object({
  username: z.string().min(1).max(64),
  reason: z.enum(REPORT_REASONS as readonly [string, ...string[]]),
  details: z.string().max(2000).optional(),
});

export const POST = route(
  async (req, { sql }) => {
    const body = await parseBody(req, zReport);
    await createReport(sql, body as Parameters<typeof createReport>[1], { ip: clientIp(req) });
    return { ok: true };
  },
  { rateLimit: { bucket: "reports", limit: 5, windowSec: 600 } },
);
