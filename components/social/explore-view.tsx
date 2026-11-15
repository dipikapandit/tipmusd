"use client";

import { useState } from "react";
import Link from "next/link";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import type { ExploreResponse } from "@/lib/api-types";
import { api } from "@/lib/client/api";
import { musdShort, pluralize, relativeTime } from "@/lib/client/format";
import { cn } from "@/lib/client/utils";
import { useNow } from "@/hooks/use-now";
import { Avatar } from "@/components/creator/avatar";
import { Skeleton } from "@/components/ui/skeleton";
import { FeedList } from "./feed-list";

type Sort = "supporters" | "recent";

/** Network totals, creator directory and the live feed. Polls /api/explore every 15 s. */
export function ExploreView({ initial }: { initial: ExploreResponse | null }) {
  const [sort, setSort] = useState<Sort>("supporters");
  const now = useNow(30_000);
  const q = useQuery({
    queryKey: ["api", "explore", sort],
    queryFn: () => api<ExploreResponse>(`/api/explore?sort=${sort}&limit=24`),
    initialData: sort === "supporters" && initial ? initial : undefined,
    placeholderData: keepPreviousData,
    refetchInterval: 15_000,
    staleTime: 10_000,
  });
  const d = q.data;

  if (!d) {
    return q.isError ? (
      <p role="alert" className="mt-10 rounded-xl bg-warn-soft p-4 text-sm">
        We can&apos;t load the network right now. This page will try again by itself.
      </p>
    ) : (
      <div aria-busy="true" className="mt-10 space-y-3">
        <Skeleton className="h-20 w-full rounded-2xl" />
        <Skeleton className="h-64 w-full rounded-2xl" />
      </div>
    );
  }

  const t = d.totals;
  return (
    <>
      <dl className="mt-8 grid grid-cols-2 gap-x-6 gap-y-5 border-y py-5 sm:grid-cols-4">
        <Figure label="MUSD tipped" value={musdShort(t.musdRaw)} />
        <Figure label="MEZO tipped" value={musdShort(t.mezoRaw)} />
        <Figure label="Tips" value={t.tips.toLocaleString()} sub={`from ${pluralize(t.supporters, "supporter")}`} />
        <Figure label="Paid with Bitcoin" value={t.fundedFromBitcoin.toLocaleString()} sub="tips funded through Mezo" />
      </dl>

      <div className="mt-10 grid gap-12 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:gap-16">
        <section aria-labelledby="creators">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 id="creators" className="font-display text-xl font-bold tracking-[-0.02em]">
              Creators
            </h2>
            <div role="radiogroup" aria-label="Sort creators" className="inline-flex rounded-full border bg-muted p-1">
              {(
                [
                  ["supporters", "Most supporters"],
                  ["recent", "Recent"],
                ] as const
              ).map(([k, label]) => (
                <button
                  key={k}
                  type="button"
                  role="radio"
                  aria-checked={sort === k}
                  onClick={() => setSort(k)}
                  className={cn(
                    "min-h-9 rounded-full px-3.5 text-sm font-medium transition-[background-color,color] duration-150",
                    sort === k ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
          {d.creators.length ? (
            <ol className={cn("mt-3 divide-y transition-opacity duration-150", q.isPlaceholderData && "opacity-60")}>
              {d.creators.map((c) => (
                <li key={c.username}>
                  <Link href={`/${c.username}`} className="group flex items-center gap-3 py-3">
                    <Avatar name={c.displayName} url={c.avatarUrl} preset={c.avatarPreset} seed={c.username} className="size-11" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium group-hover:underline group-hover:underline-offset-4">{c.displayName}</span>
                      <span className="block truncate text-[0.8125rem] text-muted-foreground">
                        @{c.username}
                        {c.bio ? ` · ${c.bio}` : ""}
                      </span>
                    </span>
                    <span className="shrink-0 text-right text-[0.8125rem]">
                      <span className="num block font-medium">{pluralize(c.supporters, "supporter")}</span>
                      <span className="block text-muted-foreground">{c.lastTipAt ? relativeTime(c.lastTipAt, now) : "No tips yet"}</span>
                    </span>
                  </Link>
                </li>
              ))}
            </ol>
          ) : (
            <p className="mt-4 text-sm text-muted-foreground">
              No public creators yet.{" "}
              <Link href="/start" className="font-medium text-foreground underline underline-offset-4">
                Make your tip link
              </Link>
            </p>
          )}
        </section>

        <section aria-labelledby="feed">
          <h2 id="feed" className="font-display text-xl font-bold tracking-[-0.02em]">
            Latest tips
          </h2>
          <p className="mt-1 text-[0.8125rem] text-muted-foreground" aria-live="polite">
            Updates every 15 seconds.
          </p>
          {d.feed.length ? (
            <div className="mt-2">
              <FeedList items={d.feed} now={now} />
            </div>
          ) : (
            <p className="mt-4 text-sm text-muted-foreground">No public tips yet.</p>
          )}
        </section>
      </div>
    </>
  );
}

function Figure({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div>
      <dt className="text-[0.8125rem] text-muted-foreground">{label}</dt>
      <dd className="num mt-0.5 font-display text-2xl font-bold tracking-[-0.02em]">{value}</dd>
      {sub ? <dd className="text-[0.8125rem] text-muted-foreground">{sub}</dd> : null}
    </div>
  );
}
