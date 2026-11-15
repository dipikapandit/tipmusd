import { parseAbi, parseUnits, zeroAddress, type Address, type PublicClient } from "viem";
import { MEZO_BORROW, MEZO_TESTNET_ID } from "@/lib/chain/config";

/**
 * Mezo Borrow (MUSD troves, Liquity-style) for funding a tip from Bitcoin. The supporter's own wallet calls
 * BorrowerOperations; MUSD is minted straight to them. Ported from ~/mezonk/apps/web/src/lib/mezo/borrow.ts (works
 * on testnet). Selectors re-checked on 2026-11-14 against the EIP-1967 implementations behind the proxies in
 * MEZO_BORROW: openTrove 0x2f3a6d98, withdrawMUSD 0xaf8b4fd0, getTroveStatus 0x21e37801, getApproxHint,
 * findInsertPosition, minNetDebt, borrowingRate, MUSD_GAS_COMPENSATION.
 *
 * The checks mirror the contract so the UI never offers a loan that would revert. Pure parts are unit tested.
 */

export const borrowerOperationsAbi = parseAbi([
  "function openTrove(uint256 _debtAmount, address _upperHint, address _lowerHint) payable",
  "function withdrawMUSD(uint256 _amount, address _upperHint, address _lowerHint)",
  "function minNetDebt() view returns (uint256)",
  "function borrowingRate() view returns (uint256)",
  "function MUSD_GAS_COMPENSATION() view returns (uint256)",
  "function MCR() view returns (uint256)",
  "function CCR() view returns (uint256)",
]);

export const troveManagerAbi = parseAbi([
  "function getTroveStatus(address) view returns (uint8)",
  "function getEntireDebtAndColl(address) view returns (uint256 coll, uint256 principal, uint256 interest, uint256 pendingCollateral, uint256 pendingPrincipal, uint256 pendingInterest)",
  "function getTroveMaxBorrowingCapacity(address) view returns (uint256)",
  "function checkRecoveryMode(uint256 _price) view returns (bool)",
]);

const sortedTrovesAbi = parseAbi([
  "function getSize() view returns (uint256)",
  "function findInsertPosition(uint256 _NICR, address _prevId, address _nextId) view returns (address, address)",
]);
const hintHelpersAbi = parseAbi([
  "function getApproxHint(uint256 _CR, uint256 _numTrials, uint256 _inputRandomSeed) view returns (address hintAddress, uint256 diff, uint256 latestRandomSeed)",
]);
const priceFeedAbi = parseAbi(["function fetchPrice() view returns (uint256)"]);

export const WAD = 10n ** 18n;
export const TROVE_ACTIVE = 1;
/** A draw may not take the loan below this (UI guard, well above Mezo's 110% minimum). */
export const DRAW_MIN_RATIO = (WAD * 150n) / 100n;
/** New loans open at this ratio. */
export const OPEN_RATIO = (WAD * BigInt(MEZO_BORROW.SAFE_RATIO_PERCENT)) / 100n;
/** BTC kept back for network fees on top of the collateral. */
export const LOAN_GAS_RESERVE = 10n ** 13n;

export interface BorrowParams {
  price: bigint; // USD per BTC, 18 dec
  recoveryMode: boolean;
  minNetDebt: bigint;
  borrowingRate: bigint; // 18-dec fraction
  gasCompensation: bigint;
  mcr: bigint;
  ccr: bigint;
}

export interface Trove {
  active: boolean;
  coll: bigint;
  debt: bigint; // principal + interest incl. pending
  principal: bigint;
  maxBorrowingCapacity: bigint;
}

export const NO_TROVE: Trove = { active: false, coll: 0n, debt: 0n, principal: 0n, maxBorrowingCapacity: 0n };

// ---------- pure math ----------

export const borrowingFee = (debt: bigint, p: Pick<BorrowParams, "borrowingRate" | "recoveryMode">) => (p.recoveryMode ? 0n : (debt * p.borrowingRate) / WAD);

export const ratioOf = (coll: bigint, debt: bigint, price: bigint) => (debt === 0n ? 0n : (coll * price) / debt);

/** Nominal ratio Mezo uses to place a loan in its sorted list. */
export const nicrOf = (coll: bigint, principal: bigint) => (principal === 0n ? 0n : (coll * 10n ** 20n) / principal);

/** Smallest amount a new loan can pay out: debt + fee must reach the minimum net debt (1,800 MUSD). */
export const minReceivable = (p: Pick<BorrowParams, "minNetDebt" | "borrowingRate" | "recoveryMode">) => {
  const rate = p.recoveryMode ? 0n : p.borrowingRate;
  return (p.minNetDebt * WAD + WAD + rate - 1n) / (WAD + rate);
};

/** BTC needed to receive `debt` at `ratio`, rounded up. */
export const collForDebt = (debt: bigint, ratio: bigint, p: BorrowParams) => {
  const total = debt + borrowingFee(debt, p) + p.gasCompensation;
  return (total * ratio + p.price - 1n) / p.price;
};

/** Round up to whole cents so the amounts read cleanly. */
export const ceilCents = (v: bigint) => {
  const cent = 10n ** 16n;
  return ((v + cent - 1n) / cent) * cent;
};

export type DrawPlan = { ok: true; amount: bigint; fee: bigint; ratioAfter: bigint } | { ok: false; reason: string };

/** Borrow `needed` more MUSD on an existing loan (withdrawMUSD), blocked if the loan would drop below 150%. */
export function planDraw(trove: Trove, needed: bigint, p: BorrowParams): DrawPlan {
  if (!trove.active) return { ok: false, reason: "No open Mezo loan." };
  if (needed <= 0n) return { ok: false, reason: "Nothing to borrow." };
  if (p.recoveryMode) return { ok: false, reason: "Mezo is in recovery mode, so loans can't borrow more right now." };
  const amount = ceilCents(needed);
  const fee = borrowingFee(amount, p);
  const total = trove.debt + amount + fee;
  if (total > trove.maxBorrowingCapacity) return { ok: false, reason: "That's over your loan's borrowing limit." };
  const ratioAfter = ratioOf(trove.coll, total, p.price);
  if (ratioAfter < DRAW_MIN_RATIO) return { ok: false, reason: "Your loan would drop below 150%." };
  return { ok: true, amount, fee, ratioAfter };
}

export type OpenPlan =
  | { ok: true; debt: bigint; coll: bigint; fee: bigint; total: bigint; ratio: bigint; leftover: bigint }
  | { ok: false; reason: string; needBtc?: bigint };

/**
 * Open a loan big enough for the tip: at least Mezo's minimum (1,800 MUSD net debt), at SAFE_RATIO_PERCENT.
 * `leftover` = MUSD that stays in the wallet after the shortfall is covered.
 */
export function planOpen(needed: bigint, p: BorrowParams, btcBalance: bigint | undefined, trove: Trove = NO_TROVE): OpenPlan {
  if (trove.active) return { ok: false, reason: "This wallet already has a Mezo loan." };
  if (needed <= 0n) return { ok: false, reason: "Nothing to borrow." };
  const debt = ceilCents(needed > minReceivable(p) ? needed : minReceivable(p));
  const fee = borrowingFee(debt, p);
  if (debt + fee < p.minNetDebt) return { ok: false, reason: "Under Mezo's minimum loan." };
  const ratio = p.recoveryMode && OPEN_RATIO < p.ccr ? p.ccr : OPEN_RATIO;
  const coll = collForDebt(debt, ratio, p);
  const total = debt + fee + p.gasCompensation;
  if (ratioOf(coll, total, p.price) < (p.recoveryMode ? p.ccr : p.mcr)) return { ok: false, reason: "Under Mezo's minimum ratio." };
  if (btcBalance === undefined || coll + LOAN_GAS_RESERVE > btcBalance)
    return { ok: false, reason: "Not enough BTC for Mezo's minimum loan (1,800 MUSD).", needBtc: coll + LOAN_GAS_RESERVE };
  return { ok: true, debt, coll, fee, total, ratio: ratioOf(coll, total, p.price), leftover: debt - needed };
}

export const MIN_NET_DEBT_RAW = parseUnits(MEZO_BORROW.MIN_NET_DEBT, 18);

// ---------- chain reads ----------

const C = MEZO_BORROW;

/** Mezo testnet's RPC can hit a lagging node ("Oracle is stale"); retry a few times. */
export async function withRetry<T>(fn: () => Promise<T>, tries = 5): Promise<T> {
  let last: unknown;
  for (let i = 0; i < tries; i++) {
    try {
      return await fn();
    } catch (e) {
      last = e;
      await new Promise((r) => setTimeout(r, 150 * (i + 1)));
    }
  }
  throw last;
}

export async function readBorrowParams(client: PublicClient): Promise<BorrowParams> {
  return withRetry(async () => {
    const blockNumber = await client.getBlockNumber({ cacheTime: 0 });
    const at = { blockNumber } as const;
    const bo = { address: C.borrowerOperations, abi: borrowerOperationsAbi } as const;
    const [price, minNetDebt, borrowingRate, gasCompensation, mcr, ccr] = await Promise.all([
      client.readContract({ address: C.priceFeed, abi: priceFeedAbi, functionName: "fetchPrice", ...at }),
      client.readContract({ ...bo, functionName: "minNetDebt", ...at }),
      client.readContract({ ...bo, functionName: "borrowingRate", ...at }),
      client.readContract({ ...bo, functionName: "MUSD_GAS_COMPENSATION", ...at }),
      client.readContract({ ...bo, functionName: "MCR", ...at }),
      client.readContract({ ...bo, functionName: "CCR", ...at }),
    ]);
    const recoveryMode = await client.readContract({ address: C.troveManager, abi: troveManagerAbi, functionName: "checkRecoveryMode", args: [price], ...at });
    return { price, recoveryMode, minNetDebt, borrowingRate, gasCompensation, mcr, ccr };
  });
}

export async function readTrove(client: PublicClient, owner: Address): Promise<Trove> {
  return withRetry(async () => {
    const tm = { address: C.troveManager, abi: troveManagerAbi } as const;
    const status = await client.readContract({ ...tm, functionName: "getTroveStatus", args: [owner] });
    if (status !== TROVE_ACTIVE) return NO_TROVE;
    const [[coll, principal, interest, pColl, pPrincipal, pInterest], maxBorrowingCapacity] = await Promise.all([
      client.readContract({ ...tm, functionName: "getEntireDebtAndColl", args: [owner] }),
      client.readContract({ ...tm, functionName: "getTroveMaxBorrowingCapacity", args: [owner] }),
    ]);
    return { active: true, coll: coll + pColl, principal: principal + pPrincipal, debt: principal + pPrincipal + interest + pInterest, maxBorrowingCapacity };
  });
}

/** Where the loan slots into Mezo's sorted list. Hints only save gas; zero hints are still correct. */
export async function findHints(client: PublicClient, nicr: bigint): Promise<[Address, Address]> {
  return withRetry(async () => {
    const size = await client.readContract({ address: C.sortedTroves, abi: sortedTrovesAbi, functionName: "getSize" });
    const trials = BigInt(Math.max(15, Math.ceil(15 * Math.sqrt(Number(size)))));
    const seed = BigInt(Math.floor(Math.random() * 1e9));
    const [hint] = await client.readContract({ address: C.hintHelpers, abi: hintHelpersAbi, functionName: "getApproxHint", args: [nicr, trials, seed] });
    const [upper, lower] = await client.readContract({ address: C.sortedTroves, abi: sortedTrovesAbi, functionName: "findInsertPosition", args: [nicr, hint, hint] });
    return [upper, lower] as [Address, Address];
  }, 3).catch((): [Address, Address] => [zeroAddress, zeroAddress]);
}

// ---------- tx builders ----------

export function buildWithdrawMUSD(amount: bigint, hints: readonly [Address, Address]) {
  if (amount <= 0n) throw new Error("Nothing to borrow");
  return {
    address: C.borrowerOperations,
    abi: borrowerOperationsAbi,
    functionName: "withdrawMUSD" as const,
    args: [amount, hints[0], hints[1]] as const,
    chainId: MEZO_TESTNET_ID,
  };
}

export function buildOpenTrove(debt: bigint, coll: bigint, hints: readonly [Address, Address]) {
  if (debt < MIN_NET_DEBT_RAW - 10n ** 19n || coll <= 0n) throw new Error("Loan below Mezo's minimum");
  return {
    address: C.borrowerOperations,
    abi: borrowerOperationsAbi,
    functionName: "openTrove" as const,
    args: [debt, hints[0], hints[1]] as const,
    value: coll,
    chainId: MEZO_TESTNET_ID,
  };
}

/** Plain messages for BorrowerOperations' revert strings. */
export function explainBorrowRevert(msg: string): string | null {
  if (/oracle is stale/i.test(msg)) return "Mezo's BTC price feed didn't answer in time. Try again in a moment.";
  if (/ICR < MCR|ICR >= CCR|TCR < CCR/i.test(msg)) return "The BTC price moved and this loan would be under Mezo's minimum. Try again.";
  if (/net debt must be greater than minimum/i.test(msg)) return "That's under Mezo's minimum loan size.";
  if (/Recovery Mode/i.test(msg)) return "Mezo is in recovery mode right now, which blocks this.";
  if (/Trove is active/i.test(msg)) return "This wallet already has a Mezo loan.";
  if (/maxBorrowingCapacity/i.test(msg)) return "That's over your loan's borrowing limit.";
  return null;
}

/**
 * Gas for a loan call, estimated with retries against Mezo testnet's sometimes-lagging RPC (+25%). A revert with a
 * known reason is final and thrown as a plain sentence. Passed to the wallet so it doesn't estimate on a stale node.
 */
export async function estimateLoanGas(
  client: PublicClient,
  call: ReturnType<typeof buildWithdrawMUSD> | ReturnType<typeof buildOpenTrove>,
  account: Address,
): Promise<bigint> {
  let last: unknown;
  for (let i = 0; i < 5; i++) {
    try {
      const g = await client.estimateContractGas({ ...call, account } as Parameters<PublicClient["estimateContractGas"]>[0]);
      return (g * 125n) / 100n;
    } catch (e) {
      last = e;
      const msg = e instanceof Error ? e.message : String(e);
      const known = explainBorrowRevert(msg);
      if (known && !/oracle is stale/i.test(msg)) throw new Error(known);
      await new Promise((r) => setTimeout(r, 150 * (i + 1)));
    }
  }
  const msg = last instanceof Error ? last.message : String(last);
  throw new Error(explainBorrowRevert(msg) ?? (/insufficient funds/i.test(msg) ? "Not enough BTC for the loan plus network fees." : "Mezo's network didn't respond. Try again in a moment."));
}
