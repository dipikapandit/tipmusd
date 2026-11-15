// GET /api/x402/tip/{username}?amount=&name=&message=&anonymous=1
// Framework-free so it can be tested with a fake facilitator + fake chain + in-memory DB.
import { getAddress, isHash, type Hex } from "viem";
import { FacilitatorResponseError, FacilitatorTimeoutError, type HTTPRequestContext } from "@x402/core/server";
import type { ApiError, X402TipReceipt } from "@/lib/api-types";
import { MUSD, explorerTx } from "@/lib/chain/config";
import type { Sql } from "../db";
import { env } from "../env";
import { HttpError } from "../errors";
import { ipHash, rateLimit } from "../ratelimit";
import type { X402Chain } from "./chain";
import { X402_NETWORK, x402Env } from "./config";
import { findX402Creator, loadX402TipView, recordX402Tip } from "./record";
import { TipRequestAdapter, type X402HttpServer } from "./server";
import { parseTipQuery, X402ValidationError } from "./validate";
import { checkSettlementWithRetry } from "./verify";

export interface X402Deps {
  sql: Sql;
  chain: X402Chain;
  getServer: () => Promise<X402HttpServer>;
  /** Post-settlement on-chain polling (tests pass { attempts: 1, delayMs: 0 }). */
  settleCheck?: { attempts?: number; delayMs?: number };
}

const NO_STORE = { "cache-control": "no-store" };

function jsonResponse(body: unknown, status: number, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body, (_k, v) => (typeof v === "bigint" ? v.toString() : v)), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", ...NO_STORE, ...headers },
  });
}

function apiError(status: number, code: string, message: string, details?: unknown, headers?: Record<string, string>): Response {
  const body: ApiError = { error: { code, message, ...(details !== undefined ? { details } : {}) } };
  return jsonResponse(body, status, headers);
}

function clientIp(req: Request): string {
  const real = req.headers.get("x-real-ip");
  if (real) return real.trim();
  const xf = req.headers.get("x-forwarded-for");
  if (xf) return xf.split(",")[0].trim() || "unknown";
  return "unknown";
}

function queryRecord(url: URL): Record<string, string | string[]> {
  const out: Record<string, string | string[]> = {};
  url.searchParams.forEach((v, k) => {
    const cur = out[k];
    out[k] = cur === undefined ? v : Array.isArray(cur) ? [...cur, v] : [cur, v];
  });
  return out;
}

function facilitatorMessage(e: unknown): string {
  return e instanceof Error ? e.message.slice(0, 300) : "unknown error";
}

export async function handleX402Tip(req: Request, usernameParam: string, deps: X402Deps): Promise<Response> {
  if (!x402Env.enabled()) {
    return apiError(404, "x402_disabled", "x402 tipping is not enabled on this server.");
  }
  const { sql, chain } = deps;

  try {
    await rateLimit(sql, `x402:ip:${ipHash(clientIp(req))}`, x402Env.rateLimitPerMinute(), 60);
  } catch (e) {
    if (e instanceof HttpError) return apiError(e.status, e.code, e.message);
    throw e;
  }

  // 1) Validate everything BEFORE asking for (or settling) a payment.
  const url = new URL(req.url);
  let query;
  try {
    query = parseTipQuery(usernameParam, queryRecord(url));
  } catch (e) {
    if (e instanceof X402ValidationError) {
      return e.code === "invalid_username" ? apiError(404, "not_found", "Unknown creator") : apiError(400, e.code, e.message);
    }
    throw e;
  }
  const creator = await findX402Creator(sql, query.username);
  if (!creator) return apiError(404, "not_found", "Unknown creator");

  // payTo always comes from the DB, never from the request.
  const payTo = getAddress(creator.recipientWallet);
  const adapter = new TipRequestAdapter(req, {
    payTo,
    amountRaw: query.amountRaw,
    description: `Tip ${query.amount} MUSD to @${creator.username} on TipMUSD`,
  });
  const context: HTTPRequestContext = {
    adapter,
    path: url.pathname,
    method: "GET",
    paymentHeader: adapter.getHeader("payment-signature") || adapter.getHeader("x-payment"),
  };

  let server: X402HttpServer;
  try {
    server = await deps.getServer();
  } catch (e) {
    console.error("[x402] facilitator init failed", e);
    return apiError(503, "x402_facilitator_unavailable", `The x402 facilitator is unreachable: ${facilitatorMessage(e)}`);
  }

  // 2) No payment → 402 with PAYMENT-REQUIRED. Payment → facilitator /verify.
  let result;
  try {
    result = await server.processHTTPRequest(context);
  } catch (e) {
    console.error("[x402] verify failed", e);
    return apiError(502, "x402_facilitator_error", `Facilitator error during verification: ${facilitatorMessage(e)}`);
  }
  if (result.type === "payment-error") {
    const r = result.response;
    return jsonResponse(r.body ?? {}, r.status, { ...r.headers, "content-type": "application/json; charset=utf-8" });
  }
  if (result.type !== "payment-verified") {
    return apiError(500, "internal", "x402 route misconfigured");
  }

  // Defence in depth: the requirement the payer signed must be exactly ours.
  const reqs = result.paymentRequirements;
  if (
    reqs.network !== X402_NETWORK ||
    reqs.asset.toLowerCase() !== MUSD.toLowerCase() ||
    reqs.payTo.toLowerCase() !== creator.recipientWallet ||
    reqs.amount !== query.amountRaw.toString()
  ) {
    await result.cancellationDispatcher.cancel({ reason: "handler_failed", responseStatus: 400 }).catch(() => undefined);
    return apiError(400, "x402_requirements_mismatch", "Signed payment does not match this tip.");
  }

  // 3) Settle (facilitator submits the Permit2 transfer and pays the gas).
  let settle;
  try {
    settle = await server.processSettlement(
      result.paymentPayload,
      reqs,
      result.declaredExtensions,
      { request: context },
      undefined,
      result.beforeHandlerSettlement,
    );
  } catch (e) {
    if (e instanceof FacilitatorTimeoutError) {
      return apiError(
        504,
        "x402_settlement_unknown",
        "The facilitator timed out while settling. The payment may still go through; check your wallet on the explorer before retrying. If it lands, it is recorded automatically (without your message).",
      );
    }
    console.error("[x402] settle failed", e);
    const status = e instanceof FacilitatorResponseError ? 502 : 500;
    return apiError(status, "x402_facilitator_error", `Facilitator error during settlement: ${facilitatorMessage(e)}`);
  }
  if (!settle.success) {
    return apiError(
      402,
      "x402_settlement_failed",
      `Settlement failed: ${settle.errorMessage || settle.errorReason}. No tip was recorded.` +
        (/gas|fund|balance|insufficient/i.test(`${settle.errorReason} ${settle.errorMessage}`)
          ? " (The community facilitator may be out of testnet BTC for gas; try again later.)"
          : ""),
      { reason: settle.errorReason },
      settle.headers,
    );
  }

  const txHash = settle.transaction;
  const payer = settle.payer;
  if (!txHash || !isHash(txHash) || !payer) {
    return apiError(502, "x402_settlement_unverified", "Facilitator reported success without a transaction hash or payer.", undefined, settle.headers);
  }

  // 4) Never take the facilitator's word: read the tx and match the MUSD Transfer log ourselves.
  const check = await checkSettlementWithRetry(
    chain,
    { txHash: txHash as Hex, payer, payTo, amountRaw: query.amountRaw, requiredConfirmations: env.confirmations() },
    deps.settleCheck,
  );
  if (check.kind === "failed") {
    return apiError(
      502,
      "x402_settlement_unverified",
      `The settlement transaction did not pay this creator as requested (${check.reason}).`,
      { reason: check.reason, transaction: txHash, explorerUrl: explorerTx(txHash) },
      settle.headers,
    );
  }

  // 5) Record (idempotent on tx hash; links to the indexer's row if it got there first).
  let tipId: string;
  try {
    ({ tipId } = await recordX402Tip(sql, { creator, query, txHash, payer, check }));
  } catch (e) {
    console.error("[x402] record failed after settlement", txHash, e);
    return apiError(
      500,
      "x402_record_failed",
      "Your payment settled, but we could not save the tip. The indexer will still record the transfer.",
      { transaction: txHash, explorerUrl: explorerTx(txHash) },
      settle.headers,
    );
  }

  const head = check.blockNumber !== undefined && check.confirmations !== undefined ? check.blockNumber + BigInt(Math.max(0, check.confirmations - 1)) : null;
  const tip = await loadX402TipView(sql, tipId, head);
  const receipt: X402TipReceipt = {
    tip: tip!,
    settlement: { transaction: txHash, network: settle.network, payer: getAddress(payer) },
  };
  return jsonResponse(receipt, 200, settle.headers);
}
