"use client";

// EXPERIMENTAL. "Tip without gas": the supporter signs an x402 payment (Permit2 + a one-time EIP-2612 permit) and the
// community facilitator submits it and pays the BTC gas. Not mounted anywhere by default; the normal tip flow
// (a plain MUSD.transfer from the supporter's wallet) stays the primary path. See docs/X402.md.
import { useState } from "react";
import { usePublicClient, useWalletClient } from "wagmi";
import { getAddress, parseUnits } from "viem";
import { wrapFetchWithPaymentFromConfig } from "@x402/fetch";
import { ExactEvmScheme } from "@x402/evm/exact/client";
import { toClientEvmSigner } from "@x402/evm";
import type { PaymentRequirements } from "@x402/core/types";
import type { ApiError, X402TipReceipt } from "@/lib/api-types";
import { MEZO_TESTNET_ID, MUSD, MUSD_DECIMALS } from "@/lib/chain/config";
import { useWallet } from "@/hooks/use-wallet";
import { Button } from "@/components/ui/button";

const NETWORK = `eip155:${MEZO_TESTNET_ID}` as const;

export interface TipWithoutGasProps {
  username: string;
  /** MUSD decimal string, already validated by the tip form. */
  amount: string;
  /** Creator wallet shown on the page (PublicCreator.recipientWallet); the payment is refused if the 402 differs. */
  recipientWallet: string;
  name?: string;
  message?: string;
  anonymous?: boolean;
  onDone?: (receipt: X402TipReceipt) => void;
}

type Phase = { kind: "idle" } | { kind: "busy"; label: string } | { kind: "error"; message: string } | { kind: "done"; receipt: X402TipReceipt };

function friendly(e: unknown): string {
  const m = e instanceof Error ? e.message : String(e);
  if (/user rejected|denied|rejected the request/i.test(m)) return "You cancelled the signature.";
  if (/spendControls|rejected by/i.test(m)) return "The payment request didn't match this tip, so nothing was signed.";
  return m.length > 200 ? `${m.slice(0, 200)}…` : m;
}

export function TipWithoutGas(props: TipWithoutGasProps) {
  const wallet = useWallet();
  const { data: walletClient } = useWalletClient();
  const publicClient = usePublicClient({ chainId: MEZO_TESTNET_ID });
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });

  async function run() {
    try {
      if (!wallet.address || !walletClient || !publicClient) throw new Error("Connect a wallet first.");
      if (wallet.chainId !== MEZO_TESTNET_ID) {
        setPhase({ kind: "busy", label: "Switch to Mezo Testnet in your wallet…" });
        await wallet.switchToMezo();
      }
      const amountRaw = parseUnits(props.amount, MUSD_DECIMALS);
      const payTo = getAddress(props.recipientWallet);
      const account = wallet.address;

      const signer = toClientEvmSigner(
        {
          address: account,
          signTypedData: (msg) =>
            walletClient.signTypedData({ account, ...msg } as Parameters<typeof walletClient.signTypedData>[0]),
        },
        publicClient,
      );

      const onlyThisTip = (_v: number, reqs: PaymentRequirements[]) =>
        reqs.filter(
          (r) =>
            r.network === NETWORK &&
            r.asset.toLowerCase() === MUSD.toLowerCase() &&
            r.amount === amountRaw.toString() &&
            r.payTo.toLowerCase() === payTo.toLowerCase(),
        );

      const pay = wrapFetchWithPaymentFromConfig(fetch, {
        schemes: [{ network: NETWORK, client: new ExactEvmScheme(signer) }],
        policies: [onlyThisTip],
        spendControls: { allowedAssets: [{ network: NETWORK, asset: MUSD, maxAmountPerPayment: amountRaw.toString() }] },
      });

      const url = new URL(`/api/x402/tip/${encodeURIComponent(props.username)}`, window.location.origin);
      url.searchParams.set("amount", props.amount);
      if (props.name) url.searchParams.set("name", props.name);
      if (props.message) url.searchParams.set("message", props.message);
      if (props.anonymous) url.searchParams.set("anonymous", "1");

      setPhase({ kind: "busy", label: "Sign in your wallet. No gas needed…" });
      const res = await pay(url, { headers: { accept: "application/json" } });
      const body = (await res.json().catch(() => null)) as X402TipReceipt | ApiError | null;
      if (!res.ok || !body || !("tip" in body)) {
        const err = body && "error" in body ? body.error : null;
        throw new Error(
          typeof err === "object" && err?.message ? err.message : typeof err === "string" ? err : `Request failed (HTTP ${res.status}).`,
        );
      }
      setPhase({ kind: "done", receipt: body });
      props.onDone?.(body);
    } catch (e) {
      setPhase({ kind: "error", message: friendly(e) });
    }
  }

  const busy = phase.kind === "busy";
  return (
    <div className="space-y-2">
      <Button type="button" variant="outline" className="w-full" disabled={busy || !wallet.isConnected} onClick={run}>
        {busy ? phase.label : "Tip without gas (x402, experimental)"}
      </Button>
      <p className="text-xs text-muted-foreground">
        You sign, a third-party service pays the gas. The first time, you also approve Permit2 to move your MUSD.
      </p>
      {phase.kind === "error" && (
        <p role="alert" className="text-sm text-bad">
          {phase.message}
        </p>
      )}
      {phase.kind === "done" && (
        <p role="status" className="text-sm text-ok">
          {phase.receipt.tip.status === "confirmed" ? "Tip sent." : "Tip sent. Waiting for the network to confirm."}
        </p>
      )}
    </div>
  );
}
