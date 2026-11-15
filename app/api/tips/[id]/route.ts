import { z } from "zod";
import type { TipView } from "@/lib/api-types";
import { getChain } from "@/lib/server/chain";
import { parseBody, route, uuidParam } from "@/lib/server/http";
import { patchTip, readTip } from "@/lib/server/tips";

export const dynamic = "force-dynamic";

/** TipView; non-terminal tips are re-verified on chain (throttled per tip). */
export const GET = route<{ id: string }>(async (_req, { sql, params }): Promise<TipView> => readTip(sql, getChain(), uuidParam(params.id)));

const zPatch = z.discriminatedUnion("status", [
  z.object({ status: z.literal("awaiting_wallet") }),
  z.object({ status: z.literal("failed"), reason: z.enum(["user_rejected", "wallet_error"]) }),
]);

export const PATCH = route<{ id: string }>(
  async (req, { sql, params }): Promise<TipView> => patchTip(sql, uuidParam(params.id), await parseBody(req, zPatch)),
  { rateLimit: { bucket: "tip-patch", limit: 60, windowSec: 60 } },
);
