"use client";

import { useId, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { usePublicClient, useWriteContract } from "wagmi";
import type { Address, Hex } from "viem";
import { Check, ExternalLink, Loader2 } from "lucide-react";
import type { FundingKind } from "@/lib/api-types";
import { BTC_TOKEN, MEZO_POOLS, MEZO_TESTNET_ID, TESTNET_DAPP_URL, explorerTx } from "@/lib/chain/config";
import { APPROVE_ABI, buildApprove, buildSwap, canAffordSwap, needsApproval, planSwap, routerQuoter, swapDeadline } from "@/lib/client/mezo/swap";
import {
  buildOpenTrove,
  buildWithdrawMUSD,
  estimateLoanGas,
  findHints,
  nicrOf,
  planDraw,
  planOpen,
  readBorrowParams,
  readTrove,
} from "@/lib/client/mezo/borrow";
import { describeTxError } from "@/lib/client/errors";
import { btc, musdNumber, shortHash } from "@/lib/client/format";
import { track } from "@/lib/client/analytics";
import { cn } from "@/lib/client/utils";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";

export interface Funding {
  kind: FundingKind;
  txHash: Hex;
}

/** The steps shown for each way of funding; the last one ("Send tip") is the normal send button below. */
export const FUNDING_STEPS: Record<FundingKind, string[]> = {
  swap_btc: ["Approve BTC", "Swap to MUSD", "Send tip"],
  loan_draw: ["Borrow MUSD", "Send tip"],
  loan_open: ["Open loan", "Send tip"],
};

const pct = (ratio: bigint) => `${(Number(ratio / 10n ** 14n) / 100).toFixed(0)}%`;

/**
 * "Fund this tip from your Bitcoin": shown on review when a MUSD tip is short and the wallet holds BTC.
 * Every option is checked before it's shown (quote > 0, balances, loan state), so nothing offered should fail.
 * All transactions are signed by the supporter's own wallet (EOA or Mezo Passport smart account).
 */
export function FundFromBitcoin({
  address,
  needed,
  btcBalance,
  isSmartAccount,
  username,
  source,
  onBusy,
  onFunded,
}: {
  address: Address;
  needed: bigint;
  btcBalance: bigint;
  isSmartAccount: boolean;
  username: string;
  source: string | null;
  onBusy: (busy: boolean) => void;
  onFunded: (f: Funding) => void;
}) {
  const pc = usePublicClient({ chainId: MEZO_TESTNET_ID });
  const { writeContractAsync } = useWriteContract();
  const [choice, setChoice] = useState<FundingKind | null>(null);
  const [step, setStep] = useState(-1); // index into FUNDING_STEPS[choice] while running
  const [stepHash, setStepHash] = useState<Hex | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [agreed, setAgreed] = useState(false);
  const agreeId = useId();
  const running = step >= 0;

  const swapQ = useQuery({
    queryKey: ["fund-swap", needed.toString()],
    enabled: Boolean(pc) && needed > 0n,
    staleTime: 15_000,
    refetchInterval: running ? false : 20_000,
    retry: 1,
    queryFn: () => planSwap(needed, routerQuoter(pc!)),
  });
  const loanQ = useQuery({
    queryKey: ["fund-loan", address],
    enabled: Boolean(pc),
    staleTime: 30_000,
    refetchInterval: running ? false : 30_000,
    retry: 1,
    queryFn: async () => {
      const [params, trove] = await Promise.all([readBorrowParams(pc!), readTrove(pc!, address)]);
      return { params, trove };
    },
  });

  const swap = swapQ.data && canAffordSwap(swapQ.data, btcBalance) ? swapQ.data : null;
  const draw = loanQ.data?.trove.active ? planDraw(loanQ.data.trove, needed, loanQ.data.params) : null;
  const open = loanQ.data && !loanQ.data.trove.active ? planOpen(needed, loanQ.data.params, btcBalance, loanQ.data.trove) : null;
  const options: FundingKind[] = [...(swap ? (["swap_btc"] as const) : []), ...(draw?.ok ? (["loan_draw"] as const) : []), ...(open?.ok ? (["loan_open"] as const) : [])];
  const selected = choice && options.includes(choice) ? choice : running ? choice : null;

  if (swapQ.isLoading || loanQ.isLoading) {
    return (
      <p className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" aria-hidden /> Checking ways to pay with your Bitcoin…
      </p>
    );
  }
  // Loan options that don't fit this wallet stay visible, greyed out, with the reason, so the path is discoverable.
  const drawBlocked = draw && !draw.ok ? draw.reason : null;
  const openBlocked = open && !open.ok ? open : null;
  if (!options.length && !running && !drawBlocked && !openBlocked) return null;

  async function wait(hash: Hex) {
    setStepHash(hash);
    const r = await pc!.waitForTransactionReceipt({ hash, timeout: 120_000 });
    if (r.status !== "success") throw new Error("That transaction didn't go through on Mezo. Nothing else was sent.");
  }

  async function run(kind: FundingKind) {
    if (!pc || running) return;
    setError(null);
    onBusy(true);
    track(username, "funding_started", source);
    try {
      let fundingHash: Hex;
      if (kind === "swap_btc") {
        setStep(0);
        // Fresh quote right before signing.
        const plan = await planSwap(needed, routerQuoter(pc));
        if (!plan || !canAffordSwap(plan, btcBalance)) throw new Error("The price moved and this swap no longer fits your balance. Try another option.");
        const allowance = await pc.readContract({ address: BTC_TOKEN, abi: APPROVE_ABI, functionName: "allowance", args: [address, MEZO_POOLS.router] });
        if (needsApproval(allowance, plan.amountIn)) await wait(await writeContractAsync(buildApprove(plan.amountIn)));
        setStep(1);
        fundingHash = await writeContractAsync(buildSwap(plan, address, swapDeadline(Date.now())));
        await wait(fundingHash);
      } else if (kind === "loan_draw") {
        setStep(0);
        const [params, trove] = await Promise.all([readBorrowParams(pc), readTrove(pc, address)]);
        const plan = planDraw(trove, needed, params);
        if (!plan.ok) throw new Error(plan.reason);
        const hints = await findHints(pc, nicrOf(trove.coll, trove.principal + plan.amount + plan.fee));
        const call = buildWithdrawMUSD(plan.amount, hints);
        const gas = isSmartAccount ? undefined : await estimateLoanGas(pc, call, address);
        fundingHash = await writeContractAsync({ ...call, ...(gas ? { gas } : {}) });
        await wait(fundingHash);
      } else {
        setStep(0);
        const [params, trove] = await Promise.all([readBorrowParams(pc), readTrove(pc, address)]);
        const plan = planOpen(needed, params, btcBalance, trove);
        if (!plan.ok) throw new Error(plan.reason);
        const hints = await findHints(pc, nicrOf(plan.coll, plan.total));
        const call = buildOpenTrove(plan.debt, plan.coll, hints);
        const gas = isSmartAccount ? undefined : await estimateLoanGas(pc, call, address);
        fundingHash = await writeContractAsync({ ...call, ...(gas ? { gas } : {}) });
        await wait(fundingHash);
      }
      onFunded({ kind, txHash: fundingHash });
    } catch (e) {
      const d = describeTxError(e);
      setError(d.kind === "rejected" ? "Cancelled in your wallet. Nothing was sent." : d.kind === "unknown" && e instanceof Error ? e.message : d.message);
      void swapQ.refetch();
      void loanQ.refetch();
    } finally {
      setStep(-1);
      setStepHash(null);
      onBusy(false);
    }
  }

  return (
    <section aria-labelledby="fund-btc" className="rounded-2xl border p-4">
      <h3 id="fund-btc" className="font-display text-[1.0625rem] font-bold tracking-[-0.01em]">
        Pay with your Bitcoin
      </h3>
      <p className="mt-1 text-sm text-muted-foreground">You need {musdNumber(needed)} more MUSD. Get it on Mezo without leaving this page.</p>

      <div role="radiogroup" aria-label="How to get MUSD" className="mt-3 divide-y border-y">
        {swap ? (
          <Option kind="swap_btc" selected={selected} disabled={running} onPick={setChoice} title="Swap a little BTC for MUSD" note="On Mezo pools. Takes two quick approvals.">
            <span className="num">
              ≈ {btc(swap.amountIn)} → {musdNumber(swap.amountOut)} MUSD
            </span>
          </Option>
        ) : null}
        {draw?.ok ? (
          <Option kind="loan_draw" selected={selected} disabled={running} onPick={setChoice} title="Borrow from your Mezo loan" note={`Your loan stays at ${pct(draw.ratioAfter)} or more.`}>
            <span className="num">+{musdNumber(draw.amount)} MUSD</span>
          </Option>
        ) : null}
        {drawBlocked ? (
          <Option kind="loan_draw" selected={null} disabled onPick={setChoice} title="Borrow from your Mezo loan" note={drawBlocked}>
            <span className="text-muted-foreground">Unavailable</span>
          </Option>
        ) : null}
        {open?.ok ? (
          <Option kind="loan_open" selected={selected} disabled={running} onPick={setChoice} title="Open a Mezo loan" note="Lock BTC, borrow MUSD. Keep your Bitcoin.">
            <span className="num">{musdNumber(open.debt, 0)} MUSD</span>
          </Option>
        ) : openBlocked ? (
          <Option
            kind="loan_open"
            selected={null}
            disabled
            onPick={setChoice}
            title="Open a Mezo loan"
            note={openBlocked.needBtc ? `Needs about ${btc(openBlocked.needBtc)}. You have ${btc(btcBalance)}.` : openBlocked.reason}
          >
            <span className="text-muted-foreground">Unavailable</span>
          </Option>
        ) : null}
      </div>

      {selected === "loan_open" && open?.ok ? (
        <div className="mt-3 space-y-2 text-sm">
          <p>
            You lock <span className="num font-medium">{btc(open.coll)}</span> and borrow <span className="num font-medium">{musdNumber(open.debt)} MUSD</span>. The smallest
            Mezo loan is 1,800 MUSD, so <span className="num">{musdNumber(open.leftover)}</span> MUSD stays in your wallet after the tip.
          </p>
          <p className="text-muted-foreground">
            You can manage or repay it any time at{" "}
            <a href={TESTNET_DAPP_URL} target="_blank" rel="noopener noreferrer" className="font-medium text-foreground underline underline-offset-4">
              testnet.mezo.org
            </a>
            .
          </p>
          <div className="flex min-h-11 items-start gap-3 pt-1">
            <Checkbox id={agreeId} checked={agreed} onCheckedChange={(v) => setAgreed(v === true)} disabled={running} className="mt-0.5 size-5" />
            <Label htmlFor={agreeId} className="leading-snug font-normal">
              I understand this opens a loan of {musdNumber(open.debt, 0)} MUSD backed by my BTC.
            </Label>
          </div>
        </div>
      ) : null}

      {selected ? <Stepper steps={FUNDING_STEPS[selected]} current={running ? step : -1} /> : null}
      {stepHash ? (
        <a href={explorerTx(stepHash)} target="_blank" rel="noopener noreferrer" className="mt-2 inline-flex min-h-11 items-center gap-1 font-mono text-xs text-muted-foreground underline-offset-4 hover:underline">
          {shortHash(stepHash)} <ExternalLink className="size-3" aria-hidden />
        </a>
      ) : null}
      {error ? (
        <p role="alert" className="mt-3 rounded-xl bg-bad-soft p-3 text-sm">
          {error}
        </p>
      ) : null}

      {selected ? (
        <Button
          variant="outline"
          size="lg"
          className="mt-3 w-full"
          disabled={running || (selected === "loan_open" && !agreed)}
          onClick={() => void run(selected)}
        >
          {running ? <Loader2 className="animate-spin" aria-hidden /> : null}
          {running ? "Confirm in your wallet…" : selected === "swap_btc" ? "Swap BTC for MUSD" : selected === "loan_draw" ? "Borrow MUSD" : "Open loan"}
        </Button>
      ) : null}
    </section>
  );
}

function Option({
  kind,
  selected,
  disabled,
  onPick,
  title,
  note,
  children,
}: {
  kind: FundingKind;
  selected: FundingKind | null;
  disabled: boolean;
  onPick: (k: FundingKind) => void;
  title: string;
  note: string;
  children: React.ReactNode;
}) {
  const on = selected === kind;
  return (
    <button
      type="button"
      role="radio"
      aria-checked={on}
      disabled={disabled}
      onClick={() => onPick(kind)}
      className="flex w-full items-start gap-3 py-3 text-left transition-colors duration-150 disabled:opacity-60"
    >
      <span className={cn("mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full border-2", on ? "border-tint" : "border-border")} aria-hidden>
        {on ? <span className="size-2.5 rounded-full bg-tint" /> : null}
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-baseline justify-between gap-3">
          <span className="text-sm font-medium">{title}</span>
        </span>
        <span className="block text-[0.8125rem] text-muted-foreground">{note}</span>
        <span className="mt-1 block text-sm">{children}</span>
      </span>
    </button>
  );
}

/** approve → swap → tip, or borrow → tip. `current` is the running step (-1 when idle); `doneUpTo` marks finished ones. */
export function Stepper({ steps, current, doneUpTo = -1 }: { steps: string[]; current: number; doneUpTo?: number }) {
  return (
    <ol className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 text-[0.8125rem]" aria-label="Steps">
      {steps.map((s, i) => {
        const done = i <= doneUpTo || (current >= 0 && i < current);
        const active = i === current || (current < 0 && i === doneUpTo + 1 && doneUpTo >= 0);
        return (
          <li key={s} className="flex items-center gap-2">
            {i > 0 ? <span aria-hidden className="h-px w-3 bg-border" /> : null}
            <span className={cn("inline-flex items-center gap-1.5", done || active ? "text-foreground" : "text-muted-foreground")}>
              <span
                aria-hidden
                className={cn(
                  "flex size-4 items-center justify-center rounded-full border",
                  done ? "border-tint bg-tint text-tint-foreground" : active ? "border-tint" : "border-border",
                )}
              >
                {done ? <Check className="size-2.5" strokeWidth={3} /> : active ? <span className="size-1.5 rounded-full bg-tint" /> : null}
              </span>
              {s}
              <span className="sr-only">{done ? " (done)" : active ? " (now)" : ""}</span>
            </span>
          </li>
        );
      })}
    </ol>
  );
}
