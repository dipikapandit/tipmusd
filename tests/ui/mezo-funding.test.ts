import { describe, expect, it } from "vitest";
import { decodeFunctionData, parseUnits, zeroAddress } from "viem";
import { BTC_TOKEN, MEZO_POOLS, MUSD } from "@/lib/chain/config";
import {
  BTC_TO_MUSD,
  ROUTER_ABI,
  buildApprove,
  buildSwap,
  canAffordSwap,
  minOutFor,
  planSwap,
  shortfall,
  swapTarget,
  topUpInput,
  type Quoter,
} from "@/lib/client/mezo/swap";
import {
  DRAW_MIN_RATIO,
  MIN_NET_DEBT_RAW,
  NO_TROVE,
  buildOpenTrove,
  buildWithdrawMUSD,
  ceilCents,
  minReceivable,
  planDraw,
  planOpen,
  ratioOf,
  type BorrowParams,
  type Trove,
} from "@/lib/client/mezo/borrow";

const m = (s: string) => parseUnits(s, 18);
const WAD = 10n ** 18n;

describe("swap sizing", () => {
  it("computes the shortfall", () => {
    expect(shortfall(m("5"), m("2"))).toBe(m("3"));
    expect(shortfall(m("5"), m("5"))).toBe(0n);
    expect(shortfall(m("5"), undefined)).toBe(0n);
  });
  it("adds a 2% buffer, rounding up", () => {
    expect(swapTarget(m("5"))).toBe(m("5.1"));
    expect(swapTarget(1n)).toBe(2n);
  });
  it("applies slippage to minOut, rounding down", () => {
    expect(minOutFor(m("5.1"), 100)).toBe(m("5.049"));
    expect(minOutFor(999n, 100)).toBe(989n);
    expect(() => minOutFor(1n, -1)).toThrow();
  });
  it("tops up proportionally and always grows", () => {
    expect(topUpInput(100n, 50n, 100n)).toBe(201n);
    expect(topUpInput(100n, 100n, 100n)).toBe(100n);
    expect(topUpInput(100n, 0n, 100n)).toBe(200n);
  });

  // Constant-product pool with a 0.3% fee, like the live MUSD/BTC volatile pool.
  const rBtc = m("10");
  const rMusd = m("700000");
  const cp = (ain: bigint, rin: bigint, rout: bigint) => {
    const a = ain - (ain * 30n) / 10_000n;
    return (a * rout) / (rin + a);
  };
  const quoter: Quoter = async (amountIn, routes) => (routes[0].from === BTC_TOKEN ? cp(amountIn, rBtc, rMusd) : cp(amountIn, rMusd, rBtc));

  it("sizes the BTC input so expected MUSD covers tip + buffer and minOut covers the shortfall", async () => {
    const plan = await planSwap(m("5"), quoter);
    expect(plan).not.toBeNull();
    expect(plan!.amountOut).toBeGreaterThanOrEqual(swapTarget(m("5")));
    expect(plan!.minOut).toBeGreaterThanOrEqual(m("5"));
    expect(plan!.minOut).toBe(minOutFor(plan!.amountOut, MEZO_POOLS.DEFAULT_SLIPPAGE_BPS));
    // not wildly over-sized: under 3% above the shortfall
    expect(plan!.amountOut).toBeLessThan(m("5.15"));
  });
  it("returns null with no liquidity or nothing to fund", async () => {
    expect(await planSwap(m("5"), async () => 0n)).toBeNull();
    expect(await planSwap(0n, quoter)).toBeNull();
  });
  it("checks the BTC balance with a fee reserve", () => {
    expect(canAffordSwap({ amountIn: m("0.0001") }, m("0.0001"))).toBe(false);
    expect(canAffordSwap({ amountIn: m("0.0001") }, m("0.001"))).toBe(true);
    expect(canAffordSwap({ amountIn: 1n }, undefined)).toBe(false);
  });
  it("builds an exact approve and a BTC→MUSD swap to self", () => {
    const a = buildApprove(123n);
    expect(a.address).toBe(BTC_TOKEN);
    expect(a.args).toEqual([MEZO_POOLS.router, 123n]);
    const me = "0x00000000000000000000000000000000000000aa";
    const s = buildSwap({ amountIn: 10n, minOut: 9n }, me, 99n);
    expect(s.address).toBe(MEZO_POOLS.router);
    expect(s.args[2]).toEqual([{ from: BTC_TOKEN, to: MUSD, stable: false, factory: MEZO_POOLS.factory }]);
    expect(s.args[3].toLowerCase()).toBe(me);
    expect(BTC_TO_MUSD).toHaveLength(1);
    expect(() => buildSwap({ amountIn: 10n, minOut: 0n }, me, 1n)).toThrow();
  });
  it("uses the verified selectors", async () => {
    const { encodeFunctionData } = await import("viem");
    const data = encodeFunctionData({ abi: ROUTER_ABI, functionName: "swapExactTokensForTokens", args: [1n, 1n, [...BTC_TO_MUSD], zeroAddress, 1n] });
    expect(data.slice(0, 10)).toBe("0xcac88ea9");
    expect(decodeFunctionData({ abi: ROUTER_ABI, data }).functionName).toBe("swapExactTokensForTokens");
    const q = encodeFunctionData({ abi: ROUTER_ABI, functionName: "getAmountsOut", args: [1n, [...BTC_TO_MUSD]] });
    expect(q.slice(0, 10)).toBe("0x5509a1ac");
  });
});

const params: BorrowParams = {
  price: m("70000"),
  recoveryMode: false,
  minNetDebt: m("1800"),
  borrowingRate: m("0.001"),
  gasCompensation: m("200"),
  mcr: m("1.1"),
  ccr: m("1.5"),
};

describe("loan draw ICR guard", () => {
  const trove = (coll: string, debt: string): Trove => ({ active: true, coll: m(coll), debt: m(debt), principal: m(debt), maxBorrowingCapacity: m("100000") });

  it("allows a draw that keeps the loan at or above 150%", () => {
    const r = planDraw(trove("0.1", "2000"), m("5"), params); // 7000 / 2005 ≈ 349%
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.amount).toBe(m("5"));
      expect(r.ratioAfter).toBeGreaterThanOrEqual(DRAW_MIN_RATIO);
    }
  });
  it("blocks a draw that would drop below 150%", () => {
    // 0.05 BTC * 70k = 3500; 3500/1.5 ≈ 2333 max debt
    expect(planDraw(trove("0.05", "2330"), m("5"), params)).toMatchObject({ ok: false });
    expect(planDraw(trove("0.05", "2300"), m("5"), params).ok).toBe(true);
  });
  it("blocks without a loan, in recovery mode, or over capacity", () => {
    expect(planDraw(NO_TROVE, m("5"), params).ok).toBe(false);
    expect(planDraw(trove("1", "2000"), m("5"), { ...params, recoveryMode: true }).ok).toBe(false);
    expect(planDraw({ ...trove("1", "2000"), maxBorrowingCapacity: m("2004") }, m("5"), params).ok).toBe(false);
  });
  it("rounds the draw up to whole cents", () => {
    expect(ceilCents(m("1.001"))).toBe(m("1.01"));
    expect(ceilCents(m("1"))).toBe(m("1"));
  });
});

describe("opening a loan: Mezo's minimum", () => {
  it("borrows at least the minimum net debt (1,800 MUSD incl. fee)", () => {
    const min = minReceivable(params);
    expect(min + (min * params.borrowingRate) / WAD).toBeGreaterThanOrEqual(params.minNetDebt);
    const r = planOpen(m("5"), params, m("1"));
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.debt + r.fee).toBeGreaterThanOrEqual(m("1800"));
      expect(r.debt).toBeLessThan(m("1800"));
      expect(r.leftover).toBe(r.debt - m("5"));
      expect(r.ratio).toBeGreaterThanOrEqual(m("2") - 10n ** 12n);
      expect(ratioOf(r.coll, r.total, params.price)).toBeGreaterThanOrEqual(params.mcr);
    }
  });
  it("borrows the shortfall when it is above the minimum", () => {
    const r = planOpen(m("2500"), params, m("1"));
    expect(r.ok && r.debt).toBe(m("2500"));
  });
  it("refuses without enough BTC, or with a loan already open", () => {
    expect(planOpen(m("5"), params, m("0.01")).ok).toBe(false);
    expect(planOpen(m("5"), params, undefined).ok).toBe(false);
    expect(planOpen(m("5"), params, m("1"), { active: true, coll: 1n, debt: 1n, principal: 1n, maxBorrowingCapacity: 1n }).ok).toBe(false);
  });
  it("builds openTrove with BTC as value and withdrawMUSD", () => {
    const o = buildOpenTrove(minReceivable(params), m("0.06"), [zeroAddress, zeroAddress]);
    expect(o.functionName).toBe("openTrove");
    expect(o.value).toBe(m("0.06"));
    expect(() => buildOpenTrove(m("100"), m("1"), [zeroAddress, zeroAddress])).toThrow();
    expect(MIN_NET_DEBT_RAW).toBe(m("1800"));
    expect(buildWithdrawMUSD(m("5"), [zeroAddress, zeroAddress]).args[0]).toBe(m("5"));
  });
});
