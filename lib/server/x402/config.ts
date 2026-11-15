// x402 rail configuration. Optional and off by default: nothing else in the app depends on it.
// Read lazily so tests can set process.env first.
import type { X402Info } from "@/lib/api-types";
import { MUSD, MUSD_DECIMALS, MEZO_TESTNET_ID } from "@/lib/chain/config";

/** CAIP-2 id of Mezo Testnet. The only network this rail accepts. */
export const X402_NETWORK = `eip155:${MEZO_TESTNET_ID}` as const satisfies X402Info["network"];

/** Community facilitator listed in the Mezo docs (no API key; verified /supported 2026-11-10). */
export const DEFAULT_FACILITATOR_URL = "https://facilitator.vativ.io";

/**
 * EIP-712 domain of MUSD + how x402 moves it. MUSD has no EIP-3009, so the `exact` scheme uses Permit2
 * (payer signs a PermitWitnessTransferFrom for the x402 proxy; the facilitator submits it and pays gas).
 * These must match what `@x402/evm` derives for its default eip155:31611 asset, or the client's
 * payload won't match our requirements.
 */
export const MUSD_X402_EXTRA = {
  name: "Mezo USD",
  version: "1",
  assetTransferMethod: "permit2",
} as const;

export const MUSD_X402_DECIMALS = MUSD_DECIMALS;

/** How long the payer's signature stays valid (seconds). */
export const X402_MAX_TIMEOUT_SECONDS = 300;

function truthy(v: string | undefined): boolean {
  return v === "1" || v === "true" || v === "yes";
}

export const x402Env = {
  enabled: () => truthy(process.env.X402_ENABLED),
  facilitatorUrl: () => (process.env.X402_FACILITATOR_URL || DEFAULT_FACILITATOR_URL).replace(/\/+$/, ""),
  /** Facilitator HTTP timeout (ms). A timed-out settle is indeterminate, so keep it generous. */
  facilitatorTimeoutMs: () => {
    const n = Number(process.env.X402_FACILITATOR_TIMEOUT_MS || 60_000);
    return Number.isFinite(n) && n >= 5_000 ? Math.floor(n) : 60_000;
  },
  appUrl: () => (process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000").replace(/\/+$/, ""),
  rpcUrl: () => process.env.MEZO_RPC_URL || process.env.NEXT_PUBLIC_MEZO_RPC_URL || "https://rpc.test.mezo.org",
  /** Requests per minute per client IP on the paid tip route (unpaid 402 probes count too). */
  rateLimitPerMinute: () => {
    const n = Number(process.env.X402_RATE_LIMIT_PER_MINUTE || 20);
    return Number.isFinite(n) && n >= 1 ? Math.floor(n) : 20;
  },
};

export function endpointTemplate(appUrl = x402Env.appUrl()): string {
  return `${appUrl}/api/x402/tip/{username}?amount={amount}`;
}

export function endpointFor(username: string, amount = "1", appUrl = x402Env.appUrl()): string {
  return `${appUrl}/api/x402/tip/${encodeURIComponent(username)}?amount=${encodeURIComponent(amount)}`;
}

export function x402Info(): X402Info {
  return {
    enabled: x402Env.enabled(),
    network: X402_NETWORK,
    facilitator: x402Env.facilitatorUrl(),
    asset: MUSD,
    endpointTemplate: endpointTemplate(),
  };
}
