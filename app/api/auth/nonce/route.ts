import { z } from "zod";
import type { NonceResponse } from "@/lib/api-types";
import { issueNonce } from "@/lib/server/auth";
import { parseBody, parseQuery, route, siweOrigin, zAddress } from "@/lib/server/http";

export const dynamic = "force-dynamic";

const zNonce = z.object({ address: zAddress });
const limit = { rateLimit: { bucket: "auth-nonce", limit: 20, windowSec: 60 } };

// GET /api/auth/nonce?address=0x.. (contract). POST { address } is accepted too.
export const GET = route(async (req, { sql }): Promise<NonceResponse> => {
  const { address } = parseQuery(req, zNonce);
  const o = siweOrigin(req);
  return issueNonce(sql, address, { domain: o.domain, uri: o.uri });
}, limit);

export const POST = route(async (req, { sql }): Promise<NonceResponse> => {
  const { address } = await parseBody(req, zNonce);
  const o = siweOrigin(req);
  return issueNonce(sql, address, { domain: o.domain, uri: o.uri });
}, limit);
