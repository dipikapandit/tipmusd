"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import dynamic from "next/dynamic";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useQuery } from "@tanstack/react-query";
import { usePublicClient, useWriteContract } from "wagmi";
import { concat, encodeFunctionData, getAddress, type Address, type Hex } from "viem";
import { ArrowLeft, ExternalLink, Loader2 } from "lucide-react";
import type { CreateTipRequest, PublicCreator, SubmitTipRequest, TipIntent, TipToken, TipView, X402Info } from "@/lib/api-types";
import { erc20Abi } from "@/lib/chain/abis";
import { FAUCET_URL, MEZO_TESTNET_ID, TIP_LIMITS, TRANSFER_GAS_ESTIMATE, explorerAddress, explorerTx } from "@/lib/chain/config";
import { ApiClientError, api } from "@/lib/client/api";
import { checkTipAmount } from "@/lib/client/amount";
import { track } from "@/lib/client/analytics";
import { describeTxError, type TxError } from "@/lib/client/errors";
import { btc, msUntil, musdExact, musdNumber, musdShort, shortHash } from "@/lib/client/format";
import type { TipParams } from "@/lib/client/tip-params";
import { failureCopy } from "@/lib/client/tip-status";
import { cn } from "@/lib/client/utils";
import { useTip, isTerminal } from "@/hooks/use-api";
import { useWallet } from "@/hooks/use-wallet";
import { useBtcBalance, useTokenBalance } from "@/hooks/use-musd";
import { useMounted } from "@/hooks/use-mounted";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { ConnectDialog } from "@/components/wallet/connect-dialog";
import { CopyButton } from "@/components/share/copy-button";
import { ShareRow } from "@/components/share/share-row";
import { SuccessMark } from "./success-mark";
import { defaultAmountFor, limitsHint, paymentMismatch, presetsFor, tokenInfo, tokenOptions } from "@/lib/client/tokens";
import { BTC_GAS_RESERVE, shortfall } from "@/lib/client/mezo/swap";
import { FUNDING_STEPS, FundFromBitcoin, Stepper, type Funding } from "./fund-from-bitcoin";

type Phase =
  | { k: "form" }
  | { k: "review"; intent: TipIntent }
  | { k: "wallet"; intent: TipIntent }
  | { k: "tracking"; intent: TipIntent; hash: Hex; submitError: string | null }
  | { k: "rejected"; intent: TipIntent }
  | { k: "error"; error: TxError; intent?: TipIntent; hash?: Hex };

// Experimental x402 rail (Agent X). Loaded only when the server says it's enabled, so the main bundle stays small.
const TipWithoutGas = dynamic(() => import("@/components/x402/tip-without-gas").then((m) => m.TipWithoutGas), { ssr: false });

function useX402Enabled() {
  const q = useQuery({
    queryKey: ["x402-info"],
    queryFn: () => api<X402Info>("/api/x402/info"),
    staleTime: 10 * 60_000,
    retry: 0,
  });
  return q.data?.enabled === true;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Client island of the public tip page: amount → review → wallet → on-chain verification. */
export function TipFlow({ creator, params }: { creator: PublicCreator; params: TipParams }) {
  const router = useRouter();
  const mounted = useMounted();
  const w = useWallet();
  const address = w.address as Address | undefined;
  const firstName = creator.displayName.split(/\s+/)[0] || creator.displayName;

  // ---------- form state
  // ?token=MEZO preselects MEZO only when the creator accepts it; its amount was validated against that token.
  const initialToken: TipToken = params.token === "MEZO" && creator.acceptMezo ? "MEZO" : "MUSD";
  // A prefilled amount applies only to the token it was validated for.
  const initialAmount = params.amount && (params.token ?? "MUSD") === initialToken ? params.amount : defaultAmountFor(initialToken, creator);
  const [token, setToken] = useState<TipToken>(initialToken);
  const [amount, setAmount] = useState(initialAmount);
  const [funding, setFunding] = useState<Funding | null>(null);
  const [touched, setTouched] = useState(false);
  const [name, setName] = useState("");
  const [message, setMessage] = useState(creator.messagesEnabled ? (params.message ?? "") : "");
  const [anonymous, setAnonymous] = useState(false);
  const [phase, setPhase] = useState<Phase>({ k: "form" });
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [connectOpen, setConnectOpen] = useState(false);
  const pendingContinue = useRef(false);
  const ids = { amount: useId(), name: useId(), message: useId(), anon: useId() };

  const check = checkTipAmount(amount, undefined, token);
  const symbol = tokenInfo(token).symbol;
  const options = tokenOptions(creator);
  const switchToken = (t: TipToken) => {
    if (t === token) return;
    setToken(t);
    setAmount(defaultAmountFor(t, creator));
    setTouched(false);
  };
  const x402 = useX402Enabled();
  const ownWallet = Boolean(address && address.toLowerCase() === creator.recipientWallet.toLowerCase());

  // ---------- analytics: one page view per mount
  const viewed = useRef(false);
  useEffect(() => {
    if (viewed.current) return;
    viewed.current = true;
    track(creator.username, "page_view", params.source);
    if (params.source === "qr") track(creator.username, "qr_view", "qr");
  }, [creator.username, params.source]);

  // ---------- create the intent (server decides the recipient)
  const createIntent = useCallback(async (): Promise<TipIntent | null> => {
    const c = checkTipAmount(amount, undefined, token);
    if (!c.ok) {
      setTouched(true);
      return null;
    }
    const body: CreateTipRequest = {
      username: creator.username,
      token,
      amount: c.normalized,
      ...(creator.messagesEnabled && !anonymous && name.trim() ? { supporterName: name.trim().slice(0, TIP_LIMITS.NAME_MAX) } : {}),
      ...(creator.messagesEnabled && message.trim() ? { message: message.trim().slice(0, TIP_LIMITS.MESSAGE_MAX) } : {}),
      ...(creator.anonymousTipsEnabled && anonymous ? { isAnonymous: true } : {}),
      ...(creator.campaign?.slug ? { campaign: creator.campaign.slug } : {}),
      ...(params.source ? { source: params.source } : {}),
      ...(address ? { senderAddress: address } : {}),
    };
    const intent = await api<TipIntent>("/api/tips", { method: "POST", json: body });
    // Defence in depth: the payment must be exactly what this page shows.
    if (paymentMismatch(intent.payment, { chainId: MEZO_TESTNET_ID, token, recipient: creator.recipientWallet, amountRaw: c.value })) {
      throw new Error("This tip's details didn't match the page. Nothing was sent. Reload and try again.");
    }
    track(creator.username, "tip_started", params.source);
    return intent;
  }, [amount, token, anonymous, address, creator, message, name, params.source]);

  const goReview = useCallback(async () => {
    setFormError(null);
    setBusy(true);
    try {
      const intent = await createIntent();
      if (intent) setPhase({ k: "review", intent });
    } catch (e) {
      setFormError(describeTxError(e).message);
    } finally {
      setBusy(false);
    }
  }, [createIntent]);

  const onContinue = () => {
    setTouched(true);
    if (!check.ok || ownWallet) return;
    if (!w.isConnected) {
      pendingContinue.current = true;
      setConnectOpen(true);
      return;
    }
    void goReview();
  };

  // After connecting from "Continue", carry on to review.
  useEffect(() => {
    if (w.isConnected && pendingContinue.current && phase.k === "form") {
      pendingContinue.current = false;
      const id = setTimeout(() => void goReview(), 0);
      return () => clearTimeout(id);
    }
  }, [w.isConnected, phase.k, goReview]);

  // ---------- send
  const { writeContractAsync } = useWriteContract();

  const send = async (start: TipIntent) => {
    if (busy) return;
    if (!w.isReady) return; // never send on another chain
    setBusy(true);
    let intent = start;
    try {
      // Re-create an intent that is about to expire.
      if (msUntil(intent.tip.expiresAt) < 60_000) {
        const fresh = await createIntent();
        if (!fresh) return;
        intent = fresh;
      }
      await api<TipView>(`/api/tips/${encodeURIComponent(intent.tip.id)}`, { method: "PATCH", json: { status: "awaiting_wallet" } });
      setPhase({ k: "wallet", intent });
      // The token contract comes from the server; it must be the one this page expects for the chosen token.
      const tokenAddr = getAddress(intent.payment.token);
      if (tokenAddr.toLowerCase() !== tokenInfo(intent.payment.tokenSymbol).address.toLowerCase() || intent.payment.tokenSymbol !== token) {
        throw new Error("This tip's details didn't match the page. Nothing was sent. Reload and try again.");
      }
      let hash: Hex;
      try {
        hash = await writeContractAsync({
          address: tokenAddr,
          abi: erc20Abi,
          functionName: "transfer",
          args: [getAddress(intent.payment.recipient), BigInt(intent.payment.amountRaw)],
          dataSuffix: intent.payment.dataSuffix,
          chainId: MEZO_TESTNET_ID,
        });
      } catch (err) {
        // Some wallets broadcast and then still throw. If we got a hash, the transfer may be real: report it.
        const leaked = (err as { hash?: unknown } | null)?.hash;
        if (typeof leaked === "string" && /^0x[0-9a-fA-F]{64}$/.test(leaked)) {
          setPhase({ k: "tracking", intent, hash: leaked as Hex, submitError: null });
          await submitHash(intent, leaked as Hex);
          return;
        }
        const e = describeTxError(err);
        const reason = e.kind === "rejected" ? "user_rejected" : "wallet_error";
        void api(`/api/tips/${encodeURIComponent(intent.tip.id)}`, { method: "PATCH", json: { status: "failed", reason } }).catch(() => undefined);
        setPhase(e.kind === "rejected" ? { k: "rejected", intent } : { k: "error", error: e, intent });
        return;
      }
      setPhase({ k: "tracking", intent, hash, submitError: null });
      await submitHash(intent, hash);
    } catch (err) {
      setPhase({ k: "error", error: describeTxError(err), intent });
    } finally {
      setBusy(false);
    }
  };

  /** Report the hash. The tx is already on its way, so retry a few times before giving up. */
  const submitHash = async (intent: TipIntent, hash: Hex) => {
    let last: unknown = null;
    for (let i = 0; i < 4; i++) {
      try {
        const body: SubmitTipRequest = {
          txHash: hash,
          ...(funding && intent.payment.tokenSymbol === "MUSD" ? { funding: { kind: funding.kind, txHash: funding.txHash } } : {}),
        };
        await api<TipView>(`/api/tips/${encodeURIComponent(intent.tip.id)}/submit`, { method: "POST", json: body });
        setPhase({ k: "tracking", intent, hash, submitError: null });
        return;
      } catch (e) {
        last = e;
        if (e instanceof ApiClientError && e.status >= 400 && e.status < 500 && e.status !== 429) break;
        await sleep(1200 * (i + 1));
      }
    }
    setPhase({ k: "tracking", intent, hash, submitError: describeTxError(last).message });
  };

  const restart = () => {
    setPhase({ k: "form" });
    setFormError(null);
  };

  // ---------- render
  return (
    <div className="relative">
      <ConnectDialog
        open={connectOpen}
        onOpenChange={(v) => {
          setConnectOpen(v);
          if (!v && !w.isConnected) pendingContinue.current = false;
        }}
        onConnected={() => track(creator.username, "wallet_connect", params.source)}
      />
      <AnimatePresence mode="wait" initial={false}>
        {phase.k === "form" ? (
          <Step key="form">
            <h2 className="font-display text-[1.375rem] leading-tight font-bold tracking-[-0.02em]">Support {firstName}</h2>
            {creator.campaign ? <p className="mt-1 text-sm text-muted-foreground">For {creator.campaign.name}</p> : null}

            {options.length > 1 ? <TokenSwitch value={token} options={options} onChange={switchToken} /> : null}

            <fieldset className="mt-5">
              <legend className="sr-only">Amount in {symbol}</legend>
              <div className="grid grid-cols-3 gap-2" role="radiogroup" aria-label="Suggested amounts">
                {presetsFor(token, creator).map((a) => {
                  const chip = checkTipAmount(a, undefined, token);
                  if (!chip.ok) return null;
                  const selected = check.ok && check.value === chip.value;
                  return (
                    <button
                      key={a}
                      type="button"
                      role="radio"
                      aria-checked={selected}
                      onClick={() => {
                        setAmount(a);
                        setTouched(false);
                      }}
                      className={cn(
                        "num min-h-14 rounded-full border text-[1.0625rem] font-semibold transition-[background-color,border-color,color,transform] duration-150 active:scale-[0.97]",
                        selected ? "border-tint bg-tint text-tint-foreground" : "bg-card hover:border-foreground/30",
                      )}
                    >
                      {musdShort(chip.value)}
                      <span className="sr-only"> {symbol}</span>
                    </button>
                  );
                })}
              </div>
              <div className="mt-3">
                <Label htmlFor={ids.amount} className="text-[0.8125rem] font-medium text-muted-foreground">
                  Or enter an amount
                </Label>
                <div className="relative mt-1.5">
                  <Input
                    id={ids.amount}
                    inputMode="decimal"
                    autoComplete="off"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    onBlur={() => setTouched(true)}
                    aria-invalid={touched && !check.ok}
                    aria-describedby={`${ids.amount}-hint`}
                    className="num h-14 pr-20 text-xl font-semibold"
                  />
                  <span className="pointer-events-none absolute top-1/2 right-4 -translate-y-1/2 text-sm font-medium text-muted-foreground">{symbol}</span>
                </div>
                <p id={`${ids.amount}-hint`} className={cn("mt-1.5 text-[0.8125rem]", touched && !check.ok ? "text-bad" : "text-muted-foreground")}>
                  {touched && !check.ok ? check.message : limitsHint(token)}
                </p>
              </div>
            </fieldset>

            {creator.messagesEnabled || creator.anonymousTipsEnabled ? (
              <div className="mt-5 space-y-4">
                {creator.messagesEnabled && !anonymous ? (
                  <div>
                    <Label htmlFor={ids.name}>
                      Your name <span className="font-normal text-muted-foreground">(optional)</span>
                    </Label>
                    <Input id={ids.name} className="mt-1.5" maxLength={TIP_LIMITS.NAME_MAX} autoComplete="nickname" value={name} onChange={(e) => setName(e.target.value)} />
                  </div>
                ) : null}
                {creator.messagesEnabled ? (
                  <div>
                    <Label htmlFor={ids.message}>
                      Message <span className="font-normal text-muted-foreground">(optional)</span>
                    </Label>
                    <Textarea
                      id={ids.message}
                      className="mt-1.5 min-h-20"
                      maxLength={TIP_LIMITS.MESSAGE_MAX}
                      value={message}
                      onChange={(e) => setMessage(e.target.value)}
                      aria-describedby={`${ids.message}-count`}
                    />
                    <p id={`${ids.message}-count`} className="num mt-1 text-right text-xs text-muted-foreground">
                      {message.length}/{TIP_LIMITS.MESSAGE_MAX}
                    </p>
                  </div>
                ) : null}
                {creator.anonymousTipsEnabled ? (
                  <div className="flex min-h-11 items-center gap-3">
                    <Checkbox id={ids.anon} checked={anonymous} onCheckedChange={(v) => setAnonymous(v === true)} className="size-5" />
                    <Label htmlFor={ids.anon} className="font-normal">
                      Tip anonymously
                      <span className="sr-only">. Your name and wallet won&apos;t be shown on this page.</span>
                    </Label>
                  </div>
                ) : null}
              </div>
            ) : null}

            {ownWallet ? (
              <p role="alert" className="mt-5 rounded-xl bg-warn-soft p-3.5 text-sm">
                This is {firstName}&apos;s own wallet. Connect a different wallet to send a tip.
              </p>
            ) : null}
            {formError ? (
              <p role="alert" className="mt-5 rounded-xl bg-bad-soft p-3.5 text-sm">
                {formError}
              </p>
            ) : null}

            <Button variant="tint" size="lg" className="mt-6 h-14 w-full text-base" disabled={busy || ownWallet} onClick={onContinue}>
              {busy ? <Loader2 className="animate-spin" aria-hidden /> : null}
              {check.ok ? `Tip ${musdShort(check.value)} ${symbol}` : `Tip in ${symbol}`}
            </Button>
            <p className="mt-3 text-center text-[0.8125rem] text-muted-foreground">
              {mounted && w.isConnected ? "Next, you'll review everything before your wallet opens." : "You'll connect your wallet and review before anything is sent."}
            </p>
            {/* x402 needs a plain-key signature (MUSD permit + Permit2), so Passport smart accounts use the normal tip. */}
            {x402 && token === "MUSD" && mounted && w.isConnected && !w.isSmartAccount && check.ok && !ownWallet ? (
              <details className="group mt-5 border-t pt-3 text-sm">
                <summary className="flex min-h-11 cursor-pointer list-none items-center text-muted-foreground hover:text-foreground [&::-webkit-details-marker]:hidden">
                  Tip without gas (x402, experimental)
                </summary>
                <div className="pt-2">
                  <TipWithoutGas
                    username={creator.username}
                    amount={check.normalized}
                    recipientWallet={creator.recipientWallet}
                    name={creator.messagesEnabled && !anonymous ? name.trim() || undefined : undefined}
                    message={creator.messagesEnabled ? message.trim() || undefined : undefined}
                    anonymous={creator.anonymousTipsEnabled ? anonymous : undefined}
                    onDone={() => router.refresh()}
                  />
                </div>
              </details>
            ) : null}
          </Step>
        ) : phase.k === "review" || phase.k === "wallet" ? (
          <Step key="review">
            <Review
              creator={creator}
              intent={phase.intent}
              waiting={phase.k === "wallet"}
              busy={busy}
              funding={funding}
              onFunded={setFunding}
              source={params.source}
              onBack={restart}
              onSend={() => send(phase.intent)}
            />
          </Step>
        ) : phase.k === "tracking" ? (
          <Step key={`track-${phase.intent.tip.id}`}>
            <Tracking
              creator={creator}
              intent={phase.intent}
              hash={phase.hash}
              submitError={phase.submitError}
              onRetrySubmit={() => submitHash(phase.intent, phase.hash)}
              funded={funding !== null && phase.intent.payment.tokenSymbol === "MUSD"}
              onAgain={() => {
                restart();
                setFunding(null);
                router.refresh();
              }}
              source={params.source}
            />
          </Step>
        ) : phase.k === "rejected" ? (
          <Step key="rejected">
            <Outcome tone="idle" title="Cancelled in your wallet" body="Nothing was sent. Ready when you are." />
            <div className="mt-6 grid gap-2">
              <Button variant="tint" size="lg" className="h-14 w-full text-base" disabled={busy} onClick={() => void goReview()}>
                Try again
              </Button>
              <Button variant="ghost" onClick={restart}>
                Change amount
              </Button>
            </div>
          </Step>
        ) : (
          <Step key="error">
            <Outcome tone="bad" title={phase.error.title} body={phase.error.message} />
            {phase.error.kind === "funds_btc" || phase.error.kind === "funds_musd" ? <FaucetLink className="mt-3" /> : null}
            {phase.hash ? <TxLink hash={phase.hash} className="mt-3" /> : null}
            <div className="mt-6 grid gap-2">
              <Button variant="tint" size="lg" className="h-14 w-full text-base" disabled={busy} onClick={() => void goReview()}>
                Try again
              </Button>
              <Button variant="ghost" onClick={restart}>
                Back
              </Button>
            </div>
          </Step>
        )}
      </AnimatePresence>
    </div>
  );
}

/** Compact MUSD / MEZO switch, shown only when the creator accepts MEZO. */
function TokenSwitch({ value, options, onChange }: { value: TipToken; options: TipToken[]; onChange: (t: TipToken) => void }) {
  return (
    <div role="radiogroup" aria-label="Tip with" className="mt-4 inline-flex rounded-full border bg-muted p-1">
      {options.map((t) => (
        <button
          key={t}
          type="button"
          role="radio"
          aria-checked={value === t}
          onClick={() => onChange(t)}
          className={cn(
            "min-h-9 min-w-20 rounded-full px-4 text-sm font-semibold transition-[background-color,color,box-shadow] duration-150",
            value === t ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
          )}
        >
          {t}
        </button>
      ))}
    </div>
  );
}

function Step({ children }: { children: React.ReactNode }) {
  const reduce = useReducedMotion();
  return (
    <motion.div
      initial={reduce ? { opacity: 0 } : { opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={reduce ? { opacity: 0 } : { opacity: 0, y: -6 }}
      transition={{ duration: reduce ? 0.12 : 0.28, ease: [0.16, 1, 0.3, 1] }}
    >
      {children}
    </motion.div>
  );
}

function FaucetLink({ className }: { className?: string }) {
  return (
    <a
      href={FAUCET_URL}
      target="_blank"
      rel="noopener noreferrer"
      className={cn("inline-flex min-h-11 items-center gap-1 text-sm font-medium text-tint-ink underline underline-offset-4", className)}
    >
      Get testnet BTC and MUSD <ExternalLink className="size-3.5" aria-hidden />
    </a>
  );
}

function TxLink({ hash, className }: { hash: string; className?: string }) {
  return (
    <a
      href={explorerTx(hash)}
      target="_blank"
      rel="noopener noreferrer"
      className={cn("inline-flex min-h-11 items-center gap-1.5 font-mono text-[0.8125rem] text-muted-foreground underline underline-offset-4 hover:text-foreground", className)}
    >
      {shortHash(hash)} <ExternalLink className="size-3.5" aria-hidden />
      <span className="sr-only">View the transaction on the Mezo explorer</span>
    </a>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 py-3">
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd className="text-right text-sm">{children}</dd>
    </div>
  );
}

// ---------------------------------------------------------------- review

function Review({
  creator,
  intent,
  waiting,
  busy,
  funding,
  onFunded,
  source,
  onBack,
  onSend,
}: {
  creator: PublicCreator;
  intent: TipIntent;
  waiting: boolean;
  busy: boolean;
  funding: Funding | null;
  onFunded: (f: Funding) => void;
  source: string | null;
  onBack: () => void;
  onSend: () => void;
}) {
  const w = useWallet();
  const address = w.address as Address | undefined;
  const amountRaw = BigInt(intent.payment.amountRaw);
  const recipient = getAddress(intent.payment.recipient);
  const info = tokenInfo(intent.payment.tokenSymbol);
  const sym = info.symbol;
  const musdBal = useTokenBalance(info.address, address);
  const [fundingBusy, setFundingBusy] = useState(false);
  const btcBal = useBtcBalance(address);
  const pc = usePublicClient({ chainId: MEZO_TESTNET_ID });

  const gas = useQuery({
    queryKey: ["gas", intent.tip.id, address],
    enabled: Boolean(pc && address),
    staleTime: 30_000,
    retry: 1,
    queryFn: async () => {
      const gasPrice = await pc!.getGasPrice();
      let units = TRANSFER_GAS_ESTIMATE;
      let estimated = false;
      try {
        const data = concat([encodeFunctionData({ abi: erc20Abi, functionName: "transfer", args: [recipient, amountRaw] }), intent.payment.dataSuffix]);
        units = await pc!.estimateGas({ account: address!, to: info.address, data });
        estimated = true;
      } catch {
        /* usually "not enough MUSD"; fall back to a typical transfer */
      }
      return { fee: units * gasPrice, estimated };
    },
  });

  const musd = musdBal.data as bigint | undefined;
  const btcWei = btcBal.data?.value;
  const fee = gas.data?.fee;
  const musdShort_ = musd !== undefined && musd < amountRaw;
  const btcShort = btcWei !== undefined && fee !== undefined && btcWei < fee;
  const rpcDown = (musdBal.isError && btcBal.isError) || gas.isError;
  const wrongChain = w.network.kind === "wrong-network";
  const canSend = w.isReady && !musdShort_ && !btcShort && musd !== undefined && !waiting && !busy && !fundingBusy;
  // Fund from Bitcoin: MUSD tips only, when the wallet is short and holds some BTC.
  const needed = sym === "MUSD" ? shortfall(amountRaw, musd) : 0n;
  const canFund = Boolean(address) && w.isReady && needed > 0n && btcWei !== undefined && btcWei > BTC_GAS_RESERVE;

  return (
    <div>
      <button
        type="button"
        onClick={onBack}
        disabled={waiting || fundingBusy}
        className="-ml-2 inline-flex min-h-11 items-center gap-1.5 rounded-full px-2 text-sm font-medium text-muted-foreground hover:text-foreground disabled:opacity-50"
      >
        <ArrowLeft className="size-4" aria-hidden /> Edit
      </button>
      <h2 className="mt-1 font-display text-[1.375rem] leading-tight font-bold tracking-[-0.02em]">Review your tip</h2>

      <p className="num mt-4 font-display text-5xl font-bold tracking-[-0.03em]">
        {musdExact(amountRaw)} <span className="text-2xl font-semibold text-muted-foreground">{sym}</span>
      </p>

      <dl className="mt-4 divide-y border-y">
        <Row label="To">
          <span className="block font-medium">{creator.displayName}</span>
          <span className="mt-1 flex items-center justify-end gap-1">
            <a
              href={explorerAddress(recipient)}
              target="_blank"
              rel="noopener noreferrer"
              className="font-mono text-[0.75rem] leading-snug break-all text-muted-foreground underline-offset-4 hover:underline"
              title="View this wallet on the Mezo explorer"
            >
              {recipient}
            </a>
            <CopyButton value={recipient} label="Copy wallet address" />
          </span>
        </Row>
        <Row label="Network fee">
          {gas.isLoading ? (
            <span className="text-muted-foreground">Estimating…</span>
          ) : fee !== undefined ? (
            <span className="num">≈ {btc(fee)}</span>
          ) : (
            <span className="text-muted-foreground">Unavailable</span>
          )}
        </Row>
        <Row label="Your balance">
          <span className="num block">{musd !== undefined ? `${musdNumber(musd)} ${sym}` : musdBal.isLoading ? "…" : "--"}</span>
          <span className="num block text-muted-foreground">{btcWei !== undefined ? btc(btcWei) : btcBal.isLoading ? "…" : "--"}</span>
        </Row>
        <Row label="Network">Mezo Testnet</Row>
      </dl>

      <div aria-live="polite" className="mt-4 space-y-3">
        {wrongChain ? (
          <div className="rounded-xl bg-warn-soft p-3.5 text-sm">
            <p>Your wallet is on another network. Switch to Mezo Testnet to send.</p>
            <Button variant="outline" className="mt-2.5" disabled={w.isSwitching} onClick={() => w.switchToMezo().catch(() => undefined)}>
              {w.isSwitching ? "Check your wallet…" : "Switch to Mezo Testnet"}
            </Button>
          </div>
        ) : null}
        {musdShort_ && canFund && address ? (
          <FundFromBitcoin
            address={address}
            needed={needed}
            btcBalance={btcWei!}
            isSmartAccount={w.isSmartAccount}
            username={creator.username}
            source={source}
            onBusy={setFundingBusy}
            onFunded={(f) => {
              onFunded(f);
              void musdBal.refetch();
            }}
          />
        ) : musdShort_ ? (
          <div className="rounded-xl bg-bad-soft p-3.5 text-sm">
            <p>
              Not enough {sym}. You have {musdNumber(musd)}, this tip is {musdShort(amountRaw)}.
            </p>
            <FaucetLink />
          </div>
        ) : null}
        {funding && sym === "MUSD" && !musdShort_ ? (
          <div className="rounded-xl bg-tint-soft p-3.5 text-sm">
            <p>You have the MUSD now. Send your tip to finish.</p>
            <Stepper steps={FUNDING_STEPS[funding.kind]} current={-1} doneUpTo={FUNDING_STEPS[funding.kind].length - 2} />
            <TxLink hash={funding.txHash} className="min-h-9" />
          </div>
        ) : null}
        {!musdShort_ && btcShort ? (
          <div className="rounded-xl bg-bad-soft p-3.5 text-sm">
            <p>Not enough BTC for the network fee. You have {btc(btcWei ?? 0n)}, about {btc(fee ?? 0n)} is needed.</p>
            <FaucetLink />
          </div>
        ) : null}
        {rpcDown ? <p className="rounded-xl bg-warn-soft p-3.5 text-sm">We can&apos;t reach Mezo Testnet right now. Check your connection, then try again.</p> : null}
        {waiting ? (
          <p className="flex items-center gap-2 rounded-xl bg-tint-soft p-3.5 text-sm">
            <Loader2 className="size-4 shrink-0 animate-spin" aria-hidden /> Confirm the transfer in your wallet.
          </p>
        ) : null}
      </div>

      <Button variant="tint" size="lg" className="mt-5 h-14 w-full text-base" disabled={!canSend} onClick={onSend}>
        {waiting || busy ? <Loader2 className="animate-spin" aria-hidden /> : null}
        {waiting ? "Waiting for your wallet…" : `Send ${musdShort(amountRaw)} ${sym}`}
      </Button>
      <p className="mt-3 text-center text-[0.8125rem] text-muted-foreground">Goes straight from your wallet to {creator.displayName}. Tips can&apos;t be reversed.</p>
    </div>
  );
}

// ---------------------------------------------------------------- tracking + result

function Tracking({
  creator,
  intent,
  hash,
  submitError,
  onRetrySubmit,
  onAgain,
  source,
  funded,
}: {
  creator: PublicCreator;
  intent: TipIntent;
  hash: Hex;
  submitError: string | null;
  onRetrySubmit: () => void;
  onAgain: () => void;
  source: string | null;
  funded: boolean;
}) {
  const tip = useTip(intent.tip.id);
  const sym = intent.payment.tokenSymbol;
  const t = tip.data;
  const status = t?.status;
  const confirmed = status === "confirmed";
  const amountRaw = t?.amountRaw ?? intent.payment.amountRaw;

  if (confirmed && t) {
    return (
      <div aria-live="polite">
        <SuccessMark />
        <h2 className="mt-5 font-display text-[1.75rem] leading-tight font-bold tracking-[-0.025em]">
          You tipped {creator.displayName} {musdShort(amountRaw)} {sym}
        </h2>
        <p className="mt-2 text-sm text-muted-foreground">Confirmed on Mezo Testnet. It&apos;s already in their wallet.</p>
        {t.thankYouMessage ? (
          <blockquote className="mt-5 rounded-2xl bg-tint-soft p-4 text-[0.9375rem]">
            <p className="whitespace-pre-line">{t.thankYouMessage}</p>
            <footer className="mt-2 text-[0.8125rem] text-muted-foreground">{creator.displayName}</footer>
          </blockquote>
        ) : null}
        <dl className="mt-5 divide-y border-y">
          <Row label="Amount">
            <span className="num">{musdExact(amountRaw)} {sym}</span>
          </Row>
          {t.funding?.verified ? <Row label="Paid with">Funded from Bitcoin via Mezo</Row> : null}
          <Row label="To">
            <span className="font-mono text-[0.75rem] break-all">{getAddress(t.recipientAddress)}</span>
          </Row>
          <Row label="Transaction">
            <TxLink hash={t.txHash ?? hash} className="min-h-0" />
          </Row>
        </dl>
        <div className="mt-6">
          <p className="text-sm font-medium">Tell people</p>
          <ShareRow
            className="mt-2"
            url={creator.tipUrl}
            text={`I just tipped ${creator.displayName} ${musdShort(amountRaw)} ${sym}${t.funding?.verified ? ", paid with my Bitcoin through Mezo" : ""}.`}
            onShare={() => track(creator.username, "share_click", source)}
          />
        </div>
        <div className="mt-6 grid gap-2 sm:grid-cols-2">
          <Button variant="outline" size="lg" onClick={onAgain}>
            Send another tip
          </Button>
          <Button variant="ghost" size="lg" asChild>
            <a href={`/tip/${encodeURIComponent(t.id)}`}>View receipt</a>
          </Button>
        </div>
      </div>
    );
  }

  if (status === "failed" || status === "expired") {
    const copy = failureCopy(status === "expired" ? "expired" : t?.failureReason);
    return (
      <div>
        <Outcome tone="bad" title={copy.title} body={copy.body} />
        <TxLink hash={t?.txHash ?? hash} className="mt-3" />
        <Button variant="tint" size="lg" className="mt-6 h-14 w-full text-base" onClick={onAgain}>
          Start again
        </Button>
      </div>
    );
  }

  const n = t?.confirmations ?? 0;
  const m = t?.requiredConfirmations ?? 1;
  const label =
    status === "pending_confirmation"
      ? `Confirming on Mezo: ${Math.min(n, m)} of ${m}`
      : status === "submitted"
        ? "Sent. Waiting for Mezo to include it…"
        : "Sent. Recording your tip…";

  return (
    <div>
      <div className="flex items-center gap-3">
        <span className="relative flex size-12 items-center justify-center rounded-full bg-tint-soft text-tint-ink">
          <Loader2 className="size-6 animate-spin" aria-hidden />
        </span>
        <div>
          <h2 className="font-display text-[1.375rem] leading-tight font-bold tracking-[-0.02em]">Sending {musdShort(amountRaw)} {sym}</h2>
          <p className="text-sm text-muted-foreground" aria-live="polite" role="status">
            {label}
          </p>
        </div>
      </div>
      <ol className="mt-6 space-y-3 text-sm" aria-label="Progress">
        {funded ? <ProgressItem done label="Got MUSD with your Bitcoin" /> : null}
        <ProgressItem done label="Approved in your wallet" />
        <ProgressItem done={status === "pending_confirmation" || isTerminal(status)} active={status !== "pending_confirmation"} label="Included on Mezo" />
        <ProgressItem done={false} active={status === "pending_confirmation"} label="Verified by TipMUSD" />
      </ol>
      <TxLink hash={hash} className="mt-4" />
      {submitError ? (
        <div role="alert" className="mt-4 rounded-xl bg-warn-soft p-3.5 text-sm">
          <p>Your transfer was sent, but we couldn&apos;t record it yet. {submitError}</p>
          <Button variant="outline" className="mt-2.5" onClick={onRetrySubmit}>
            Try again
          </Button>
        </div>
      ) : null}
      <p className="mt-4 text-[0.8125rem] text-muted-foreground">You can close this page. The tip still counts once it confirms.</p>
    </div>
  );
}

function ProgressItem({ done, active, label }: { done: boolean; active?: boolean; label: string }) {
  return (
    <li className="flex items-center gap-3">
      <span
        className={cn(
          "flex size-5 items-center justify-center rounded-full border-2",
          done ? "border-tint bg-tint" : active ? "border-tint" : "border-border",
        )}
        aria-hidden
      >
        {active && !done ? <span className="size-1.5 animate-pulse rounded-full bg-tint" /> : null}
      </span>
      <span className={done || active ? "" : "text-muted-foreground"}>
        {label}
        <span className="sr-only">{done ? " (done)" : active ? " (in progress)" : ""}</span>
      </span>
    </li>
  );
}

function Outcome({ tone, title, body }: { tone: "bad" | "idle"; title: string; body: string }) {
  return (
    <div role={tone === "bad" ? "alert" : "status"}>
      <h2 className="font-display text-[1.375rem] leading-tight font-bold tracking-[-0.02em]">{title}</h2>
      <p className="mt-2 text-sm text-muted-foreground">{body}</p>
    </div>
  );
}
