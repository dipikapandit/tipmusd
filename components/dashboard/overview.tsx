"use client";

import { useEffect, useRef } from "react";
import Link from "next/link";
import { ArrowRight, ExternalLink } from "lucide-react";
import { getAddress } from "viem";
import { explorerAddress } from "@/lib/chain/config";
import { musdShort, pluralize, relativeTime } from "@/lib/client/format";
import { creatorShareText, qrTarget } from "@/lib/client/share";
import { stripScheme } from "@/lib/client/deeplinks";
import { useIndexerSync, useOverview } from "@/hooks/use-api";
import { useNow } from "@/hooks/use-now";
import { Skeleton } from "@/components/ui/skeleton";
import { buttonVariants } from "@/components/ui/button";
import { CopyField } from "@/components/share/copy-button";
import { QrImage } from "@/components/share/qr-image";
import { ShareRow } from "@/components/share/share-row";
import { TipList } from "./tip-list";

export function Overview() {
  const q = useOverview();
  const sync = useIndexerSync();
  const now = useNow(30_000);
  const synced = useRef(false);
  useEffect(() => {
    if (synced.current) return;
    synced.current = true;
    sync.mutate();
  }, [sync]);

  if (q.isLoading) {
    return (
      <div aria-busy="true" className="space-y-6">
        <Skeleton className="h-10 w-64" />
        <Skeleton className="h-28 w-full rounded-2xl" />
        <Skeleton className="h-64 w-full rounded-2xl" />
      </div>
    );
  }
  if (!q.data) {
    return (
      <div role="alert" className="rounded-2xl bg-bad-soft p-5">
        <p className="font-medium">We can&apos;t load your dashboard right now.</p>
        <button type="button" className="mt-2 text-sm font-medium underline underline-offset-4" onClick={() => q.refetch()}>
          Try again
        </button>
      </div>
    );
  }

  const { profile: p, totals, recent, indexer } = q.data;
  const firstName = p.displayName.split(/\s+/)[0] || p.displayName;
  const hasTips = totals.tips > 0 || recent.length > 0;

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <h1 className="font-display text-3xl font-bold tracking-[-0.03em] sm:text-4xl">Hi, {firstName}</h1>
        <Link href={`/${p.username}`} className="inline-flex min-h-11 items-center gap-1.5 text-sm font-medium text-muted-foreground hover:text-foreground">
          View your page <ArrowRight className="size-4" aria-hidden />
        </Link>
      </div>

      {/* totals: one row, no cards. MUSD and MEZO are never added together. */}
      <dl className="mt-8 grid grid-cols-2 gap-x-6 gap-y-6 border-y py-6 sm:grid-cols-3 lg:grid-cols-6">
        <div className="col-span-2 sm:col-span-1 lg:col-span-2">
          <dt className="text-sm text-muted-foreground">Received</dt>
          <dd className="num mt-1 font-display text-4xl font-bold tracking-[-0.03em]">
            {musdShort(totals.confirmedRaw)} <span className="text-lg font-semibold text-muted-foreground">MUSD</span>
          </dd>
          {BigInt(totals.confirmedMezoRaw ?? "0") > 0n ? (
            <dd className="num mt-1 font-display text-xl font-bold tracking-[-0.02em]">
              {musdShort(totals.confirmedMezoRaw)} <span className="text-base font-semibold text-muted-foreground">MEZO</span>
            </dd>
          ) : null}
        </div>
        <div>
          <dt className="text-sm text-muted-foreground">Tips</dt>
          <dd className="num mt-1 text-2xl font-semibold">{totals.tips.toLocaleString()}</dd>
        </div>
        <div>
          <dt className="text-sm text-muted-foreground">Supporters</dt>
          <dd className="num mt-1 text-2xl font-semibold">{totals.supporters.toLocaleString()}</dd>
        </div>
        <div>
          <dt className="text-sm text-muted-foreground">Paid with Bitcoin</dt>
          <dd className="num mt-1 text-2xl font-semibold">{(totals.fundedFromBitcoin ?? 0).toLocaleString()}</dd>
        </div>
        <div>
          <dt className="text-sm text-muted-foreground">Pending</dt>
          <dd className="num mt-1 text-2xl font-semibold">{totals.pending.toLocaleString()}</dd>
        </div>
      </dl>

      <div className="mt-10 grid gap-10 lg:grid-cols-[minmax(0,1fr)_18rem]">
        <section aria-labelledby="recent-title" className="min-w-0">
          <div className="flex items-center justify-between gap-3">
            <h2 id="recent-title" className="font-display text-xl font-bold tracking-[-0.02em]">
              Recent activity
            </h2>
            {hasTips ? (
              <Link href="/dashboard/activity" className="inline-flex min-h-11 items-center text-sm font-medium text-muted-foreground hover:text-foreground">
                See all
              </Link>
            ) : null}
          </div>
          {recent.length ? (
            <div className="mt-2">
              <TipList tips={recent} compact />
            </div>
          ) : (
            <div className="mt-4 rounded-2xl border border-dashed p-6">
              <p className="font-medium">Share your link to get your first tip</p>
              <p className="mt-1 text-sm text-muted-foreground">Post it in your bio, pin it in a thread, or show the QR code. Tips show up here as soon as they confirm.</p>
              <ShareRow className="mt-4" url={p.tipUrl} text={creatorShareText(p.displayName)} />
            </div>
          )}
          <p className="mt-4 text-xs text-muted-foreground" aria-live="polite">
            {sync.isPending
              ? "Checking Mezo for new tips…"
              : indexer.updatedAt
                ? `Checked Mezo ${relativeTime(indexer.updatedAt, now)}${indexer.lagBlocks && indexer.lagBlocks > 5 ? `, ${pluralize(indexer.lagBlocks, "block")} behind` : ""}.`
                : "Not synced with Mezo yet."}
          </p>
        </section>

        <aside className="space-y-8">
          <section aria-labelledby="link-title">
            <h2 id="link-title" className="font-display text-xl font-bold tracking-[-0.02em]">
              Your link
            </h2>
            <CopyField className="mt-3" value={p.tipUrl} display={stripScheme(p.tipUrl)} />
            <div className="mt-4 flex items-center gap-4">
              <QrImage text={qrTarget(p.tipUrl)} className="w-28 border" label="QR code for your tip link" />
              <Link href="/dashboard/share" className={buttonVariants({ variant: "outline" })}>
                QR and sharing
              </Link>
            </div>
          </section>
          <section aria-labelledby="wallet-title">
            <h2 id="wallet-title" className="font-display text-xl font-bold tracking-[-0.02em]">
              Tips go to
            </h2>
            <a
              href={explorerAddress(p.recipientWallet)}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-2 inline-flex items-start gap-1.5 font-mono text-xs break-all text-muted-foreground hover:text-foreground"
            >
              {getAddress(p.recipientWallet)} <ExternalLink className="mt-0.5 size-3 shrink-0" aria-hidden />
            </a>
            <Link href="/dashboard/settings#wallet" className="mt-1 block min-h-11 py-2 text-sm font-medium text-muted-foreground hover:text-foreground">
              Change wallet
            </Link>
          </section>
        </aside>
      </div>
    </div>
  );
}
