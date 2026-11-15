import { getAddress, parseAbi, type Address, type PublicClient } from "viem";
import { BTC_TOKEN, MEZO_POOLS, MEZO_TESTNET_ID, MUSD } from "@/lib/chain/config";

/**
 * "Swap a little BTC for MUSD" on Mezo pools (Velodrome-style router, token → token; BTC is the ERC-20 precompile,
 * so it is approve + swapExactTokensForTokens). ABI subset taken from ~/mezo-wallet/packages/core/src/swap.ts
 * (sourced from the verified Router on Blockscout). Selectors re-checked against the deployed router bytecode on
 * 2026-11-14: getAmountsOut 0x5509a1ac, swapExactTokensForTokens 0xcac88ea9.
 *
 * The math here is pure and unit tested; the chain reads take a PublicClient.
 */

export const ROUTER_ABI = parseAbi([
  "struct Route { address from; address to; bool stable; address factory; }",
  "function getAmountsOut(uint256 amountIn, Route[] routes) view returns (uint256[] amounts)",
  "function swapExactTokensForTokens(uint256 amountIn, uint256 amountOutMin, Route[] routes, address to, uint256 deadline) returns (uint256[] amounts)",
]);

export const APPROVE_ABI = parseAbi([
  "function approve(address spender, uint256 amount) returns (bool)",
  "function allowance(address owner, address spender) view returns (uint256)",
]);

export const BPS = 10_000n;
/** Extra MUSD bought on top of what's missing, so a small price move doesn't leave the tip short. */
export const SWAP_BUFFER_BPS = 200n;
export const SWAP_DEADLINE_SECONDS = 600;
/** BTC kept back for network fees (Mezo testnet gas costs a tiny fraction of this). */
export const BTC_GAS_RESERVE = 10n ** 13n; // 0.00001 BTC

export interface Route {
  from: Address;
  to: Address;
  stable: boolean;
  factory: Address;
}

/** The single hop we use: BTC → MUSD on the volatile pool. */
export const BTC_TO_MUSD: readonly Route[] = [{ from: BTC_TOKEN, to: MUSD, stable: false, factory: MEZO_POOLS.factory }];
export const MUSD_TO_BTC: readonly Route[] = [{ from: MUSD, to: BTC_TOKEN, stable: false, factory: MEZO_POOLS.factory }];

/** MUSD still missing for the tip (0 when the wallet already has enough). */
export const shortfall = (tipRaw: bigint, balanceRaw: bigint | undefined) => (balanceRaw === undefined || balanceRaw >= tipRaw ? 0n : tipRaw - balanceRaw);

/** What we aim to receive: the shortfall plus the buffer, rounded up. */
export const swapTarget = (needed: bigint, bufferBps: bigint = SWAP_BUFFER_BPS) => (needed * (BPS + bufferBps) + BPS - 1n) / BPS;

/** amountOut · (10000 − slippage) / 10000, rounded down (the router's amountOutMin). */
export function minOutFor(amountOut: bigint, slippageBps: number = MEZO_POOLS.DEFAULT_SLIPPAGE_BPS): bigint {
  if (!Number.isInteger(slippageBps) || slippageBps < 0 || slippageBps >= 10_000) throw new Error("Bad slippage");
  return (amountOut * (BPS - BigInt(slippageBps))) / BPS;
}

/** Next input to try when `out` fell short of `target`: scale up proportionally, plus 1 wei so it always grows. */
export function topUpInput(amountIn: bigint, out: bigint, target: bigint): bigint {
  if (out >= target) return amountIn;
  if (out <= 0n) return amountIn * 2n;
  return (amountIn * target + out - 1n) / out + 1n;
}

export type Quoter = (amountIn: bigint, routes: readonly Route[]) => Promise<bigint>;

export interface SwapPlan {
  /** MUSD missing for the tip. */
  needed: bigint;
  amountIn: bigint;
  amountOut: bigint;
  minOut: bigint;
  slippageBps: number;
}

/**
 * Size the BTC input: a reverse quote (MUSD → BTC) gives a first guess, then forward quotes top it up until the
 * expected MUSD covers the target. Fails (null) unless even the slippage-protected minimum covers the shortfall.
 */
export async function planSwap(needed: bigint, quote: Quoter, slippageBps: number = MEZO_POOLS.DEFAULT_SLIPPAGE_BPS): Promise<SwapPlan | null> {
  if (needed <= 0n) return null;
  const target = swapTarget(needed);
  let amountIn = await quote(target, MUSD_TO_BTC);
  if (amountIn <= 0n) return null;
  let out = 0n;
  for (let i = 0; i < 5; i++) {
    out = await quote(amountIn, BTC_TO_MUSD);
    if (out >= target) break;
    amountIn = topUpInput(amountIn, out, target);
  }
  if (out < target) return null;
  const minOut = minOutFor(out, slippageBps);
  if (minOut < needed) return null;
  return { needed, amountIn, amountOut: out, minOut, slippageBps };
}

/** Live quoter on the Mezo pools router. A missing pool returns 0 (the router doesn't revert). */
export const routerQuoter =
  (client: PublicClient): Quoter =>
  async (amountIn, routes) => {
    const amounts = await client.readContract({
      address: MEZO_POOLS.router,
      abi: ROUTER_ABI,
      functionName: "getAmountsOut",
      args: [amountIn, routes.map((r) => ({ ...r }))],
    });
    return amounts[amounts.length - 1] ?? 0n;
  };

/** Is the swap affordable from this BTC balance (keeping a little for fees)? */
export const canAffordSwap = (plan: Pick<SwapPlan, "amountIn">, btcBalance: bigint | undefined) =>
  btcBalance !== undefined && plan.amountIn + BTC_GAS_RESERVE <= btcBalance;

export const swapDeadline = (nowMs: number) => BigInt(Math.floor(nowMs / 1000) + SWAP_DEADLINE_SECONDS);

/** Exact-amount approve of the BTC precompile to the router. Never unlimited. */
export function buildApprove(amountIn: bigint) {
  if (amountIn <= 0n) throw new Error("Nothing to approve");
  return {
    address: BTC_TOKEN,
    abi: APPROVE_ABI,
    functionName: "approve" as const,
    args: [MEZO_POOLS.router, amountIn] as const,
    chainId: MEZO_TESTNET_ID,
  };
}

export const needsApproval = (allowance: bigint, amountIn: bigint) => allowance < amountIn;

/** router.swapExactTokensForTokens(amountIn, minOut, [BTC→MUSD], to = self, deadline). */
export function buildSwap(plan: Pick<SwapPlan, "amountIn" | "minOut">, to: Address, deadline: bigint) {
  if (plan.amountIn <= 0n || plan.minOut <= 0n) throw new Error("Empty swap");
  return {
    address: MEZO_POOLS.router,
    abi: ROUTER_ABI,
    functionName: "swapExactTokensForTokens" as const,
    args: [plan.amountIn, plan.minOut, BTC_TO_MUSD.map((r) => ({ ...r })), getAddress(to), deadline] as const,
    chainId: MEZO_TESTNET_ID,
  };
}
