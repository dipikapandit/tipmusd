import type { Metadata } from "next";
import Link from "next/link";
import { notFound, permanentRedirect } from "next/navigation";
import { parseTipParams } from "@/lib/client/tip-params";
import { nowMs } from "@/lib/client/format";
import { SITE } from "@/lib/client/site";
import { LogoMark } from "@/components/brand/logo";
import { ThemeToggle } from "@/components/brand/theme-toggle";
import { CreatorIdentity } from "@/components/creator/creator-identity";
import { TipFlow } from "@/components/tip/tip-flow";
import { RecentTips } from "@/components/tip/recent-tips";
import { TopSupporters } from "@/components/tip/top-supporters";
import { ReportDialog } from "@/components/tip/report-dialog";
import { loadCreator, loadTips } from "./data";


type Props = {
  params: Promise<{ username: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

async function resolve(props: Props) {
  const { username } = await props.params;
  const sp = await props.searchParams;
  const tp = parseTipParams(sp);
  const result = await loadCreator(decodeURIComponent(username), tp.campaign);
  return { username, sp, tp, result };
}

export async function generateMetadata(props: Props): Promise<Metadata> {
  const { result } = await resolve(props);
  if (!result || "redirectTo" in result) return { title: "Tip page not found", robots: { index: false } };
  const title = `Support ${result.displayName} on Mezo`;
  const description = result.bio ? result.bio.slice(0, 160) : `Send ${result.displayName} a tip in ${result.acceptMezo ? "MUSD or MEZO" : "MUSD"}, straight to their wallet.`;
  return {
    title,
    description,
    alternates: { canonical: `/${result.username}` },
    openGraph: { type: "profile", title, description, url: `/${result.username}`, siteName: SITE.name },
    twitter: { card: "summary_large_image", title, description },
  };
}

export default async function TipPage(props: Props) {
  const { sp, tp, result } = await resolve(props);
  if (!result) notFound();
  if ("redirectTo" in result) {
    // Old username: keep every query param (amount, campaign, source) on the new address.
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(sp)) if (typeof v === "string") qs.set(k, v);
    const q = qs.toString();
    permanentRedirect(`/${encodeURIComponent(result.redirectTo)}${q ? `?${q}` : ""}`);
  }
  const creator = result;
  const tips = creator.publicActivityEnabled ? await loadTips(creator.username) : [];
  const now = nowMs();

  return (
    <div data-accent={creator.accent} className="flex min-h-dvh flex-col">
      <div className="bg-tint-soft">
        <div className="mx-auto flex h-36 max-w-5xl items-start justify-between px-4 pt-3 sm:h-44 sm:px-6">
          <Link href="/" className="inline-flex min-h-11 items-center gap-2 rounded-full pr-2 text-sm font-semibold" aria-label="TipMUSD home">
            <LogoMark className="size-6" />
            <span className="hidden sm:inline">TipMUSD</span>
          </Link>
          <ThemeToggle />
        </div>
      </div>

      <main id="main" className="mx-auto w-full max-w-5xl flex-1 px-4 pb-16 sm:px-6">
        <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_25rem] lg:gap-16">
          <div className="-mt-14 sm:-mt-16">
            <CreatorIdentity creator={creator} />
            <div className="hidden lg:block">
              <TopSupporters supporters={creator.topSupporters ?? []} />
              <RecentTips tips={tips} now={now} />
            </div>
          </div>
          <section aria-label={`Tip ${creator.displayName}`} className="lg:sticky lg:top-6 lg:-mt-20 lg:self-start">
            <div className="lg:rounded-[1.25rem] lg:border lg:bg-card lg:p-6 lg:shadow-panel">
              <TipFlow creator={creator} params={tp} />
            </div>
          </section>
          <div className="lg:hidden">
            <TopSupporters supporters={creator.topSupporters ?? []} />
            <RecentTips tips={tips} now={now} />
          </div>
        </div>
      </main>

      <footer className="border-t">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-x-6 gap-y-1 px-4 py-4 text-[0.8125rem] text-muted-foreground sm:px-6">
          <p>Mezo Testnet. Test tokens have no real value.</p>
          <div className="flex items-center gap-4">
            <ReportDialog username={creator.username} />
            <Link href="/start" className="inline-flex min-h-11 items-center font-medium text-foreground underline-offset-4 hover:underline">
              Make your own tip link
            </Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
