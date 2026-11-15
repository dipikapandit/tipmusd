// x402 resource server wiring (@x402/core v2). We drive x402HTTPResourceServer directly instead of `withX402`
// because `withX402` settles AFTER the handler returns, so the handler can never see the settlement tx hash. Here
// the order is: validate request → verify payment (facilitator /verify) → settle (facilitator /settle) → verify the
// settlement tx on chain ourselves → record the tip → respond with PAYMENT-RESPONSE + the receipt.
//
// payTo and price are per request: they're resolved from the request adapter, which carries the creator wallet
// (from the DB) and the validated amount. Price uses the explicit AssetAmount form (MUSD address + base units),
// so there's no "$" → USD conversion anywhere.
import { HTTPFacilitatorClient, x402HTTPResourceServer, x402ResourceServer } from "@x402/core/server";
import type { FacilitatorClient, HTTPAdapter, HTTPRequestContext, RouteConfig } from "@x402/core/server";
import { ExactEvmScheme } from "@x402/evm/exact/server";
import { declareEip2612GasSponsoringExtension } from "@x402/extensions";
import { MUSD } from "@/lib/chain/config";
import { MUSD_X402_EXTRA, X402_MAX_TIMEOUT_SECONDS, X402_NETWORK, x402Env } from "./config";

/** What the dynamic payTo/price callbacks read. Set by the route after validation + DB lookup. */
export interface ResolvedTip {
  payTo: string; // checksummed creator wallet
  amountRaw: bigint;
  description: string;
}

/** HTTPAdapter over a standard Request. Always presents as an API client (no HTML paywall). */
export class TipRequestAdapter implements HTTPAdapter {
  private readonly url: URL;
  constructor(
    private readonly req: Request,
    readonly resolved: ResolvedTip,
  ) {
    this.url = new URL(req.url);
  }
  getHeader(name: string) {
    return this.req.headers.get(name) ?? undefined;
  }
  getMethod() {
    return this.req.method;
  }
  getPath() {
    return this.url.pathname;
  }
  getUrl() {
    return this.req.url;
  }
  getAcceptHeader() {
    return "application/json";
  }
  getUserAgent() {
    return this.req.headers.get("user-agent") ?? "";
  }
  getQueryParams() {
    const out: Record<string, string | string[]> = {};
    this.url.searchParams.forEach((v, k) => {
      const cur = out[k];
      out[k] = cur === undefined ? v : Array.isArray(cur) ? [...cur, v] : [cur, v];
    });
    return out;
  }
  getQueryParam(name: string) {
    const all = this.url.searchParams.getAll(name);
    return all.length === 0 ? undefined : all.length === 1 ? all[0] : all;
  }
}

function resolvedFrom(ctx: HTTPRequestContext): ResolvedTip {
  const a = ctx.adapter as Partial<TipRequestAdapter>;
  if (!a.resolved) throw new Error("x402: request was not resolved before payment processing");
  return a.resolved;
}

export function buildRouteConfig(): RouteConfig {
  return {
    accepts: {
      scheme: "exact",
      network: X402_NETWORK,
      payTo: (ctx) => resolvedFrom(ctx).payTo,
      price: (ctx) => ({ asset: MUSD, amount: resolvedFrom(ctx).amountRaw.toString(), extra: { ...MUSD_X402_EXTRA } }),
      maxTimeoutSeconds: X402_MAX_TIMEOUT_SECONDS,
      extra: { ...MUSD_X402_EXTRA },
    },
    description: "Tip a TipMUSD creator in MUSD (Mezo Testnet)",
    mimeType: "application/json",
    serviceName: "TipMUSD",
    // Lets a fresh wallet (no Permit2 allowance yet) attach a signed EIP-2612 permit; the facilitator submits it.
    extensions: { ...declareEip2612GasSponsoringExtension() },
    unpaidResponseBody: (ctx) => {
      const r = resolvedFrom(ctx);
      return {
        contentType: "application/json",
        body: {
          error: { code: "payment_required", message: r.description },
          x402: {
            network: X402_NETWORK,
            asset: MUSD,
            amountRaw: r.amountRaw.toString(),
            payTo: r.payTo,
            facilitator: x402Env.facilitatorUrl(),
            hint: "Pay with an x402 v2 client (e.g. @x402/fetch). Requirements are in the PAYMENT-REQUIRED header.",
          },
        },
      };
    },
  };
}

/** The subset of x402HTTPResourceServer the route uses (lets tests inject a fake). */
export type X402HttpServer = Pick<x402HTTPResourceServer, "processHTTPRequest" | "processSettlement" | "initialize">;

/** Resource server for MUSD on Mezo Testnet with the given facilitator (tests pass a fake one). */
export function createX402HttpServer(facilitator: FacilitatorClient): x402HTTPResourceServer {
  const resourceServer = new x402ResourceServer(facilitator).register(X402_NETWORK, new ExactEvmScheme());
  return new x402HTTPResourceServer(resourceServer, buildRouteConfig());
}

const g = globalThis as unknown as { __tipmusdX402?: { server: x402HTTPResourceServer; init: Promise<void> | null; url: string } };

/** Lazily-built singleton; `initialize()` (facilitator /supported) is retried on the next request after a failure. */
export async function getX402HttpServer(): Promise<X402HttpServer> {
  const url = x402Env.facilitatorUrl();
  if (!g.__tipmusdX402 || g.__tipmusdX402.url !== url) {
    const facilitator = new HTTPFacilitatorClient({ url, timeoutMs: x402Env.facilitatorTimeoutMs() });
    g.__tipmusdX402 = { server: createX402HttpServer(facilitator), init: null, url };
  }
  const state = g.__tipmusdX402;
  if (!state.init) state.init = state.server.initialize();
  try {
    await state.init;
  } catch (e) {
    state.init = null;
    throw e;
  }
  return state.server;
}
