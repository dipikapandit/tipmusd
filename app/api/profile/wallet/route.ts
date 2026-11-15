import { z } from "zod";
import type { Hex } from "viem";
import type { CreatorProfile } from "@/lib/api-types";
import { requireSession } from "@/lib/server/auth";
import { getChain } from "@/lib/server/chain";
import { parseBody, route, siweOrigin, zAddress } from "@/lib/server/http";
import { changePayoutWallet } from "@/lib/server/profiles";

export const dynamic = "force-dynamic";

const zChange = z.object({
  address: zAddress,
  message: z.string().min(1).max(4000),
  signature: z.string().regex(/^0x[0-9a-fA-F]+$/).max(20_000),
});

export const POST = route(
  async (req, { sql }): Promise<CreatorProfile> => {
    const s = await requireSession(sql, req);
    const body = await parseBody(req, zChange);
    return changePayoutWallet(sql, getChain(), s, { ...body, signature: body.signature as Hex }, { allowedDomains: siweOrigin(req).allowedDomains });
  },
  { rateLimit: { bucket: "wallet-change", limit: 10, windowSec: 60 } },
);
