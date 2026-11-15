import { z } from "zod";
import type { NonceResponse } from "@/lib/api-types";
import { requireSession } from "@/lib/server/auth";
import { parseBody, route, siweOrigin, zAddress } from "@/lib/server/http";
import { walletChangeNonce } from "@/lib/server/profiles";

export const dynamic = "force-dynamic";

/** Nonce + message for the NEW payout wallet to sign (purpose wallet_change, bound to this session's user). */
export const POST = route(
  async (req, { sql }): Promise<NonceResponse> => {
    const s = await requireSession(sql, req);
    const { address } = await parseBody(req, z.object({ address: zAddress }));
    const o = siweOrigin(req);
    return walletChangeNonce(sql, s, address, { domain: o.domain, uri: o.uri });
  },
  { rateLimit: { bucket: "wallet-nonce", limit: 10, windowSec: 60 } },
);
