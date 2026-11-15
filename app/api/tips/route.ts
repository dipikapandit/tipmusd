import { z } from "zod";
import { json, parseBody, route } from "@/lib/server/http";
import { createTip } from "@/lib/server/tips";

export const dynamic = "force-dynamic";

const zCreateTip = z.object({
  username: z.string().min(1).max(64),
  token: z.enum(["MUSD", "MEZO"]).optional(),
  amount: z.string().min(1).max(32),
  supporterName: z.string().max(200).optional(),
  message: z.string().max(2000).optional(),
  isAnonymous: z.boolean().optional(),
  campaign: z.string().max(64).optional(),
  source: z.string().max(64).optional(),
  senderAddress: z.string().regex(/^0x[0-9a-fA-F]{40}$/).optional(),
});

export const POST = route(
  async (req, { sql }) => {
    const body = await parseBody(req, zCreateTip);
    return json(await createTip(sql, body), { status: 201 });
  },
  { rateLimit: { bucket: "tip-create", limit: 20, windowSec: 60 } },
);
