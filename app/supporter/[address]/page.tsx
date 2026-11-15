import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getAddress, isAddress } from "viem";
import { getSupporterProfile } from "@/lib/server/social";
import { explorerAddress } from "@/lib/chain/config";
import { nowMs, pluralize } from "@/lib/client/format";
import { perTokenTotals } from "@/lib/client/tokens";
import { SiteHeader } from "@/components/site/header";
import { SiteFooter } from "@/components/site/footer";
import { Avatar } from "@/components/creator/avatar";
import { CopyButton } from "@/components/share/copy-button";
import { FeedList } from "@/components/social/feed-list";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ address: string }> };

async function load(props: Props) {
  const { address } = await props.params;
  if (!isAddress(address, { strict: false })) return null;
  return getSupporterProfile(getAddress(address));
}

export async function generateMetadata(props: Props): Promise<Metadata> {
  const p = await load(props).catch(() => null);
  if (!p) return { title: "Supporter not found", robots: { index: false } };
  return {
    title: `${p.label} on TipMUSD`,
    description: `${p.label} has backed ${pluralize(p.totals.creators, "creator")} on Mezo.`,
    alternates: { canonical: `/supporter/${p.address}` },
    robots: { index: false },
  };
}

export default async function SupporterPage(props: Props) {
  const p = await load(props);
  if (!p) notFound();
  const now = nowMs();

  return (
    <>
      <SiteHeader />
      <main id="main" className="mx-auto w-full max-w-3xl flex-1 px-4 py-12 sm:px-6 sm:py-16">
        <h1 className="font-display text-3xl font-bold tracking-[-0.03em] break-words text-balance sm:text-4xl">{p.label}</h1>
        <p className="mt-2 flex items-center gap-1">
          <a href={explorerAddress(p.address)} target="_blank" rel="noopener noreferrer" className="font-mono text-[0.8125rem] break-all text-muted-foreground underline-offset-4 hover:underline">
            {p.address}
          </a>
          <CopyButton value={p.address} label="Copy address" />
        </p>
        <p className="mt-5 text-lg">
          Backed {pluralize(p.totals.creators, "creator")} with {pluralize(p.totals.tips, "tip")}: <span className="num font-medium">{perTokenTotals(p.totals.musdRaw, p.totals.mezoRaw)}</span>.
        </p>

        <section aria-labelledby="backed" className="mt-10">
          <h2 id="backed" className="font-display text-xl font-bold tracking-[-0.02em]">
            Creators backed
          </h2>
          <ul className="mt-3 divide-y">
            {p.creators.map((c) => (
              <li key={c.username}>
                <Link href={`/${c.username}`} className="group flex items-center gap-3 py-3">
                  <Avatar name={c.displayName} url={c.avatarUrl} preset={c.avatarPreset} seed={c.username} className="size-10" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium group-hover:underline group-hover:underline-offset-4">{c.displayName}</span>
                    <span className="block text-[0.8125rem] text-muted-foreground">
                      @{c.username} · {pluralize(c.tips, "tip")}
                    </span>
                  </span>
                  <span className="num shrink-0 text-right text-sm">{perTokenTotals(c.musdRaw, c.mezoRaw)}</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>

        {p.recent.length ? (
          <section aria-labelledby="recent" className="mt-10">
            <h2 id="recent" className="font-display text-xl font-bold tracking-[-0.02em]">
              Recent tips
            </h2>
            <div className="mt-2">
              <FeedList items={p.recent} now={now} />
            </div>
          </section>
        ) : null}

        <p className="mt-10 text-[0.8125rem] text-muted-foreground">Only public tips are shown here. Anonymous tips never appear.</p>
      </main>
      <SiteFooter />
    </>
  );
}
