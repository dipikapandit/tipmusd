"use client";

import Link from "next/link";
import { getAddress } from "viem";
import { ExternalLink } from "lucide-react";
import { explorerAddress, explorerTx } from "@/lib/chain/config";
import { isNotFound } from "@/lib/client/api";
import { formatDateTime, musdExact, musdShort } from "@/lib/client/format";
import { STATUS_LABEL, failureCopy, statusTone } from "@/lib/client/tip-status";
import { useTip } from "@/hooks/use-api";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusBadge } from "@/components/tip/status-badge";
import { SuccessMark } from "./success-mark";

const checksum = (a: string) => {
  try {
    return getAddress(a);
  } catch {
    return a;
  }
};

export function Receipt({ id }: { id: string }) {
  const q = useTip(id);
  const t = q.data;

  if (q.isLoading) {
    return (
      <div aria-busy="true" className="space-y-3">
        <Skeleton className="h-16 w-16 rounded-full" />
        <Skeleton className="h-9 w-64" />
        <Skeleton className="h-40 w-full rounded-2xl" />
      </div>
    );
  }
  if (!t) {
    return (
      <div>
        <h1 className="font-display text-3xl font-bold tracking-[-0.03em]">{isNotFound(q.error) ? "We couldn't find this tip" : "We can't load this tip right now"}</h1>
        <p className="mt-2 text-muted-foreground">{isNotFound(q.error) ? "Check the link and try again." : "Check your connection and refresh the page."}</p>
      </div>
    );
  }

  const amount = t.amountRaw ?? t.expectedAmountRaw;
  const sym = t.token ?? "MUSD";
  const tone = statusTone(t.status);
  const failed = t.status === "failed" || t.status === "expired";
  const copy = failed ? failureCopy(t.status === "expired" ? "expired" : t.failureReason) : null;

  return (
    <article aria-live="polite">
      {t.status === "confirmed" ? <SuccessMark /> : null}
      <p className="mt-5 text-sm text-muted-foreground">Tip to {t.creatorDisplayName}</p>
      <h1 className="num mt-1 font-display text-5xl font-bold tracking-[-0.03em]">
        {musdShort(amount)} <span className="text-2xl font-semibold text-muted-foreground">{sym}</span>
      </h1>
      <div className="mt-3">
        <StatusBadge status={t.status} />
      </div>
      {copy ? (
        <div className="mt-4 rounded-xl bg-bad-soft p-3.5 text-sm">
          <p className="font-medium">{copy.title}</p>
          <p className="mt-1">{copy.body}</p>
        </div>
      ) : tone === "pending" ? (
        <p className="mt-4 text-sm text-muted-foreground">
          {t.status === "pending_confirmation" && t.confirmations !== null
            ? `Confirming on Mezo: ${Math.min(t.confirmations, t.requiredConfirmations)} of ${t.requiredConfirmations}.`
            : "Waiting for Mezo Testnet. This page updates by itself."}
        </p>
      ) : null}

      {t.status === "confirmed" && t.thankYouMessage ? (
        <blockquote className="mt-6 rounded-2xl bg-muted p-4">
          <p className="whitespace-pre-line">{t.thankYouMessage}</p>
          <footer className="mt-2 text-[0.8125rem] text-muted-foreground">{t.creatorDisplayName}</footer>
        </blockquote>
      ) : null}

      <dl className="mt-6 divide-y border-y text-sm">
        <div className="flex justify-between gap-4 py-3">
          <dt className="text-muted-foreground">Status</dt>
          <dd>{STATUS_LABEL[t.status]}</dd>
        </div>
        {amount ? (
          <div className="flex justify-between gap-4 py-3">
            <dt className="text-muted-foreground">Amount</dt>
            <dd className="num">
              {musdExact(amount)} {sym}
            </dd>
          </div>
        ) : null}
        {t.funding?.verified ? (
          <div className="flex justify-between gap-4 py-3">
            <dt className="text-muted-foreground">Paid with</dt>
            <dd className="text-right">
              Funded from Bitcoin via Mezo
              {t.funding.txHash ? (
                <a href={explorerTx(t.funding.txHash)} target="_blank" rel="noopener noreferrer" className="mt-0.5 block font-mono text-xs text-muted-foreground hover:underline">
                  {t.funding.txHash.slice(0, 10)}…{t.funding.txHash.slice(-6)}
                </a>
              ) : null}
            </dd>
          </div>
        ) : null}
        <div className="flex justify-between gap-4 py-3">
          <dt className="text-muted-foreground">To</dt>
          <dd className="text-right">
            <Link href={`/${t.creatorUsername}`} className="font-medium underline-offset-4 hover:underline">
              {t.creatorDisplayName}
            </Link>
            <a href={explorerAddress(t.recipientAddress)} target="_blank" rel="noopener noreferrer" className="mt-0.5 block font-mono text-xs break-all text-muted-foreground hover:underline">
              {checksum(t.recipientAddress)}
            </a>
          </dd>
        </div>
        {t.supporterName && !t.isAnonymous ? (
          <div className="flex justify-between gap-4 py-3">
            <dt className="text-muted-foreground">From</dt>
            <dd>{t.supporterName}</dd>
          </div>
        ) : null}
        {t.message ? (
          <div className="py-3">
            <dt className="text-muted-foreground">Message</dt>
            <dd className="mt-1 break-words whitespace-pre-line">{t.message}</dd>
          </div>
        ) : null}
        <div className="flex justify-between gap-4 py-3">
          <dt className="text-muted-foreground">{t.verifiedAt ? "Confirmed" : "Started"}</dt>
          <dd>{formatDateTime(t.verifiedAt ?? t.createdAt)}</dd>
        </div>
        {t.txHash ? (
          <div className="flex justify-between gap-4 py-3">
            <dt className="text-muted-foreground">Transaction</dt>
            <dd>
              <a href={t.explorerUrl ?? explorerTx(t.txHash)} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 font-mono text-xs underline-offset-4 hover:underline">
                {t.txHash.slice(0, 10)}…{t.txHash.slice(-6)} <ExternalLink className="size-3" aria-hidden />
              </a>
            </dd>
          </div>
        ) : null}
      </dl>

      <Link href={`/${t.creatorUsername}`} className="mt-8 inline-flex min-h-11 items-center text-sm font-medium text-brand-ink underline underline-offset-4">
        Back to {t.creatorDisplayName}&apos;s page
      </Link>
    </article>
  );
}
