// Public x402 status: whether the rail is on, network, facilitator, asset, endpoint template.
import { x402Info } from "@/lib/server/x402/config";

export const dynamic = "force-dynamic";

export function GET(): Response {
  return Response.json(x402Info(), { headers: { "cache-control": "public, max-age=60" } });
}
