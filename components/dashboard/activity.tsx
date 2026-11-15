"use client";

import { useId, useState } from "react";

import { cn } from "@/lib/client/utils";
import { useTipsPage } from "@/hooks/use-api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { TipList } from "./tip-list";

type Filter = "all" | "confirmed" | "pending" | "failed";
const FILTERS: { v: Filter; label: string }[] = [
  { v: "all", label: "All" },
  { v: "confirmed", label: "Confirmed" },
  { v: "pending", label: "Pending" },
  { v: "failed", label: "Failed" },
];

export function Activity() {
  const [filter, setFilter] = useState<Filter>("all");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const id = useId();
  const status = filter === "all" ? undefined : filter;
  const q = useTipsPage({ status, from: from || undefined, to: to || undefined });
  const all = q.data?.pages.flatMap((p) => p.items) ?? [];
  const items = all;

  return (
    <div>
      <h1 className="font-display text-3xl font-bold tracking-[-0.03em] sm:text-4xl">Activity</h1>

      <div className="mt-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div role="radiogroup" aria-label="Filter by status" className="inline-flex w-fit rounded-full bg-muted p-1">
          {FILTERS.map((f) => (
            <button
              key={f.v}
              type="button"
              role="radio"
              aria-checked={filter === f.v}
              onClick={() => setFilter(f.v)}
              className={cn(
                "min-h-10 rounded-full px-4 text-sm font-medium transition-colors",
                filter === f.v ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
              )}
            >
              {f.label}
            </button>
          ))}
        </div>
        <div className="flex items-end gap-2">
          <div>
            <label htmlFor={`${id}-from`} className="text-xs text-muted-foreground">
              From
            </label>
            <Input id={`${id}-from`} type="date" value={from} max={to || undefined} onChange={(e) => setFrom(e.target.value)} className="mt-1 h-11 w-40" />
          </div>
          <div>
            <label htmlFor={`${id}-to`} className="text-xs text-muted-foreground">
              To
            </label>
            <Input id={`${id}-to`} type="date" value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} className="mt-1 h-11 w-40" />
          </div>
          {from || to ? (
            <Button
              variant="ghost"
              onClick={() => {
                setFrom("");
                setTo("");
              }}
            >
              Clear
            </Button>
          ) : null}
        </div>
      </div>

      <div className="mt-6" aria-busy={q.isFetching}>
        {q.isLoading ? (
          <div className="space-y-3">
            {Array.from({ length: 5 }, (_, i) => (
              <Skeleton key={i} className="h-14 w-full rounded-xl" />
            ))}
          </div>
        ) : q.isError && !all.length ? (
          <div role="alert" className="rounded-2xl bg-bad-soft p-5">
            <p className="font-medium">We can&apos;t load your tips right now.</p>
            <button type="button" className="mt-2 text-sm font-medium underline underline-offset-4" onClick={() => q.refetch()}>
              Try again
            </button>
          </div>
        ) : items.length ? (
          <TipList tips={items} />
        ) : (
          <div className="rounded-2xl border border-dashed p-6">
            <p className="font-medium">{filter === "all" && !from && !to ? "No tips yet" : "Nothing matches these filters"}</p>
            <p className="mt-1 text-sm text-muted-foreground">
              {filter === "all" && !from && !to ? "Share your link to get your first tip." : "Try another status or date range."}
            </p>
          </div>
        )}
        {q.hasNextPage ? (
          <Button variant="outline" className="mt-6" disabled={q.isFetchingNextPage} onClick={() => q.fetchNextPage()}>
            {q.isFetchingNextPage ? "Loading…" : "Load more"}
          </Button>
        ) : null}
      </div>
    </div>
  );
}
