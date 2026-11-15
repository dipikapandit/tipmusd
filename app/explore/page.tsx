import type { Metadata } from "next";
import type { ExploreResponse } from "@/lib/api-types";
import { getExplore } from "@/lib/server/social";
import { SiteHeader } from "@/components/site/header";
import { SiteFooter } from "@/components/site/footer";
import { ExploreView } from "@/components/social/explore-view";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Explore",
  description: "Creators and the latest public tips in MUSD and MEZO on Mezo Testnet.",
  alternates: { canonical: "/explore" },
};

export default async function ExplorePage() {
  // Server render for a fast first paint; the client keeps it live. If the DB is down, the client retries.
  let initial: ExploreResponse | null = null;
  try {
    initial = await getExplore({ sort: "supporters", limit: 24 });
  } catch {
    initial = null;
  }
  return (
    <>
      <SiteHeader />
      <main id="main" className="mx-auto w-full max-w-6xl flex-1 px-4 py-12 sm:px-6 sm:py-16">
        <h1 className="font-display text-3xl font-bold tracking-[-0.03em] text-balance sm:text-4xl">Explore</h1>
        <p className="mt-3 max-w-2xl text-lg text-muted-foreground">Who&apos;s getting tipped on Mezo right now, in MUSD and MEZO.</p>
        <ExploreView initial={initial} />
      </main>
      <SiteFooter />
    </>
  );
}
