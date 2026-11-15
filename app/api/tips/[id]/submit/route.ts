import { z } from "zod";
import type { TipView } from "@/lib/api-types";
import { getChain } from "@/lib/server/chain";
import { parseBody, route, uuidParam, zTxHash } from "@/lib/server/http";
import { FUNDING_KINDS } from "@/lib/server/funding";
import { submitTip } from "@/lib/server/tips";

const zSubmit = z.object({
  txHash: zTxHash,
  // v2: optional "funded from Bitcoin" claim. Stored, never trusted: verified on chain after the tip confirms.
  funding: z.object({ kind: z.enum(FUNDING_KINDS as readonly ["swap_btc", "loan_draw", "loan_open"]), txHash: zTxHash }).optional(),
});

export const dynamic = "force-dynamic";

/** Binds the tx hash to the tip (unique) and runs one verification attempt inline. */
export const POST = route<{ id: string }>(
  async (req, { sql, params }): Promise<TipView> => {
    const id = uuidParam(params.id);
    const { txHash, funding } = await parseBody(req, zSubmit);
    return submitTip(sql, getChain(), id, txHash, funding ?? null);
  },
  { rateLimit: { bucket: "tip-submit", limit: 30, windowSec: 60 } },
);
