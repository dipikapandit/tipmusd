// x402 machine-payment tip endpoint. Optional rail: off unless X402_ENABLED=1. See docs/X402.md.
import { getDb } from "@/lib/server/db";
import { viemX402Chain } from "@/lib/server/x402/chain";
import { handleX402Tip } from "@/lib/server/x402/handler";
import { getX402HttpServer } from "@/lib/server/x402/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request, ctx: { params: Promise<{ username: string }> }): Promise<Response> {
  const { username } = await ctx.params;
  try {
    const sql = await getDb();
    return await handleX402Tip(req, username, { sql, chain: viemX402Chain(), getServer: getX402HttpServer });
  } catch (e) {
    console.error("[x402] unhandled", e);
    return Response.json(
      { error: { code: "internal", message: "Something went wrong on our side. Please try again." } },
      { status: 500, headers: { "cache-control": "no-store" } },
    );
  }
}
