"use client";

import { useState } from "react";
import type { Analytics } from "@/lib/api-types";
import { musdShort } from "@/lib/client/format";
import { cn } from "@/lib/client/utils";
import { useAnalytics } from "@/hooks/use-api";
import { Skeleton } from "@/components/ui/skeleton";
import { DailyBars } from "./bars";

const RANGES: Analytics["range"][] = ["7d", "30d", "90d"];
const RANGE_LABEL: Record<Analytics["range"], string> = { "7d": "7 days", "30d": "30 days", "90d": "90 days" };

const SOURCE_LABEL: Record<string, string> = { qr: "QR code", direct: "Direct", embed: "Website button", copy: "Copied link" };

export function AnalyticsView() {
  const [range, setRange] = useState<Analytics["range"]>("30d");
  const q = useAnalytics(range);
  const a = q.data;

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <h1 className="font-display text-3xl font-bold tracking-[-0.03em] sm:text-4xl">Analytics</h1>
        <div role="radiogroup" aria-label="Time range" className="inline-flex rounded-full bg-muted p-1">
          {RANGES.map((r) => (
            <button
              key={r}
              type="button"
              role="radio"
              aria-checked={range === r}
              onClick={() => setRange(r)}
              className={cn(
                "min-h-10 rounded-full px-4 text-sm font-medium transition-colors",
                range === r ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
              )}
            >
              {RANGE_LABEL[r]}
            </button>
          ))}
        </div>
      </div>

      {q.isLoading ? (
        <div className="mt-8 space-y-6" aria-busy="true">
          <Skeleton className="h-24 w-full rounded-2xl" />
          <Skeleton className="h-52 w-full rounded-2xl" />
        </div>
      ) : !a ? (
        <div role="alert" className="mt-8 rounded-2xl bg-bad-soft p-5">
          <p className="font-medium">We can&apos;t load analytics right now.</p>
          <button type="button" className="mt-2 text-sm font-medium underline underline-offset-4" onClick={() => q.refetch()}>
            Try again
          </button>
        </div>
      ) : (
        <div className={cn("transition-opacity", q.isFetching && "opacity-70")}>
          <section aria-labelledby="a-tips" className="mt-8">
            <h2 id="a-tips" className="text-lg font-semibold">
              MUSD tips <span className="font-normal text-muted-foreground">(confirmed on chain)</span>
            </h2>
            <dl className="mt-4 grid grid-cols-2 gap-6 border-y py-6 sm:grid-cols-5">
              <Stat label="Received" value={`${musdShort(a.totals.confirmedRaw)} MUSD`} big />
              <Stat label="Tips" value={a.totals.tips.toLocaleString()} />
              <Stat label="Supporters" value={a.totals.supporters.toLocaleString()} />
              <Stat label="Average" value={a.totals.tips ? `${musdShort(a.totals.averageRaw)} MUSD` : "--"} />
              <Stat label="Largest" value={a.totals.tips ? `${musdShort(a.totals.largestRaw)} MUSD` : "--"} />
            </dl>
            <div className="mt-6">
              <h3 className="text-sm font-medium text-muted-foreground">MUSD per day</h3>
              <div className="mt-3">
                <DailyBars series={a.series} />
              </div>
            </div>
            {a.totals.mezoTips > 0 ? (
              <div className="mt-10">
                <h3 className="text-base font-semibold">MEZO</h3>
                <dl className="mt-3 grid grid-cols-2 gap-6 sm:grid-cols-5">
                  <Stat label="Received" value={`${musdShort(a.totals.confirmedMezoRaw)} MEZO`} big />
                  <Stat label="Tips" value={a.totals.mezoTips.toLocaleString()} />
                </dl>
                <div className="mt-6">
                  <DailyBars symbol="MEZO" series={a.series.map((d) => ({ day: d.day, amountRaw: d.mezoAmountRaw ?? "0", tips: -1 }))} />
                </div>
              </div>
            ) : null}
          </section>

          <section aria-labelledby="a-visits" className="mt-12 border-t pt-10">
            <h2 id="a-visits" className="text-lg font-semibold">
              Visits <span className="font-normal text-muted-foreground">(people who opened your page)</span>
            </h2>
            <dl className="mt-4 grid grid-cols-2 gap-6 sm:grid-cols-5">
              <Stat label="Page views" value={a.visits.pageViews.toLocaleString()} />
              <Stat label="Unique visitors" value={a.visits.uniqueVisitors.toLocaleString()} />
              <Stat label="QR scans" value={a.visits.qrViews.toLocaleString()} />
              <Stat label="Started a tip" value={a.visits.tipStarts.toLocaleString()} />
              <Stat label="Share clicks" value={a.visits.shareClicks.toLocaleString()} />
            </dl>
            <p className="mt-4 max-w-xl text-sm text-muted-foreground">
              Visits are counted on our side and are approximate. Supporters above only count tips confirmed on Mezo.
            </p>
          </section>

          <section aria-labelledby="a-sources" className="mt-12 border-t pt-10">
            <h2 id="a-sources" className="text-lg font-semibold">
              Where people came from
            </h2>
            {a.sources.length ? (
              <table className="mt-4 w-full max-w-xl text-sm">
                <thead>
                  <tr className="border-b text-left text-muted-foreground">
                    <th scope="col" className="py-2.5 font-medium">Source</th>
                    <th scope="col" className="py-2.5 text-right font-medium">Visits</th>
                    <th scope="col" className="py-2.5 text-right font-medium">Tips</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {a.sources.map((s) => (
                    <tr key={s.source}>
                      <td className="py-2.5">{SOURCE_LABEL[s.source] ?? s.source}</td>
                      <td className="num py-2.5 text-right">{s.visits.toLocaleString()}</td>
                      <td className="num py-2.5 text-right">{s.tips.toLocaleString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <p className="mt-3 text-sm text-muted-foreground">
                No visits in this range yet. Add <span className="font-mono">?src=name</span> to a link to see it here.
              </p>
            )}
          </section>
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, big }: { label: string; value: string; big?: boolean }) {
  return (
    <div className={big ? "col-span-2 sm:col-span-1" : undefined}>
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd className={cn("num mt-1 font-semibold", big ? "font-display text-2xl font-bold tracking-[-0.02em]" : "text-xl")}>{value}</dd>
    </div>
  );
}
