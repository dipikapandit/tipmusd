import Link from "next/link";
import { ArrowRight, ExternalLink } from "lucide-react";
import { FAUCET_URL, MEZO_TESTNET_ID, MEZO_TOKEN, MUSD, TESTNET_DAPP_URL, explorerToken } from "@/lib/chain/config";
import { SITE } from "@/lib/client/site";
import { buttonVariants } from "@/components/ui/button";
import { SiteHeader } from "@/components/site/header";
import { SiteFooter } from "@/components/site/footer";
import { ExampleCard } from "@/components/landing/example-card";
import { Faq } from "@/components/landing/faq";
import { QrDemo } from "@/components/landing/qr-demo";

const AUDIENCES = ["Writers", "Illustrators", "Open-source maintainers", "Streamers", "Podcasters", "Teachers", "Musicians", "Newsletter authors"];

export default function Home() {
  return (
    <>
      <SiteHeader />
      <main id="main" className="flex-1">
        {/* Hero */}
        <section className="mx-auto grid max-w-6xl items-center gap-12 px-4 pt-10 pb-16 sm:px-6 md:pt-16 lg:grid-cols-[1.05fr_1fr] lg:gap-10 lg:pb-24">
          <div>
            <h1 className="rise font-display text-[2.625rem] leading-[1.02] font-extrabold tracking-[-0.035em] sm:text-6xl lg:text-[4.25rem]">
              Your work deserves support. <span className="text-brand-ink">Get tipped on Mezo.</span>
            </h1>
            <p className="rise mt-6 max-w-[34rem] text-lg leading-relaxed text-muted-foreground [--d:90ms] sm:text-xl">
              One link for tips in MUSD or MEZO, straight to your wallet. No MUSD? Supporters can pay with their Bitcoin, right on your page.
            </p>
            <div className="rise mt-8 flex flex-wrap items-center gap-3 [--d:180ms]">
              <Link href="/start" className={buttonVariants({ variant: "brand", size: "lg", className: "h-14 px-7 text-base" })}>
                Create your tip link <ArrowRight aria-hidden />
              </Link>
              <Link href="/explore" className={buttonVariants({ variant: "ghost", size: "lg", className: "h-14 px-5 text-base" })}>
                See who&apos;s getting tipped
              </Link>
            </div>
          </div>

          <div className="rise relative flex justify-center [--d:240ms] lg:justify-end">
            <div className="relative flex w-full max-w-[30rem] flex-col items-center rounded-[1.75rem] bg-brand px-5 pt-5 pb-10 sm:px-10 sm:pt-6">
              <p className="mb-5 self-start text-sm font-semibold text-brand-foreground">Example</p>
              <ExampleCard />
            </div>
          </div>
        </section>

        {/* How it works: a real sequence, so it is numbered */}
        <section id="how" aria-labelledby="how-title" className="border-t bg-surface">
          <div className="mx-auto max-w-6xl px-4 py-20 sm:px-6 lg:py-28">
            <h2 id="how-title" className="max-w-xl font-display text-4xl leading-[1.05] font-bold tracking-[-0.03em] sm:text-5xl">
              Set up once. Share it everywhere.
            </h2>
            <ol className="mt-14 grid gap-12 md:grid-cols-3 md:gap-8">
              <li>
                <span className="num font-display text-6xl leading-none font-extrabold text-brand-ink">1</span>
                <h3 className="mt-5 text-xl font-semibold">Connect your wallet</h3>
                <p className="mt-2 text-muted-foreground">Tips land in this wallet. Signing in is free and sends nothing.</p>
                <p className="mt-5 inline-flex rounded-full border bg-card px-4 py-2 font-mono text-sm">0x8f3C…A21e</p>
              </li>
              <li>
                <span className="num font-display text-6xl leading-none font-extrabold text-brand-ink">2</span>
                <h3 className="mt-5 text-xl font-semibold">Claim your link</h3>
                <p className="mt-2 text-muted-foreground">Pick a username, add a photo and a line about what you make.</p>
                <p className="mt-5 inline-flex rounded-full border bg-card px-4 py-2 text-sm">
                  <span className="text-muted-foreground">{SITE.host}/</span>
                  <span className="font-semibold">yourname</span>
                </p>
              </li>
              <li>
                <span className="num font-display text-6xl leading-none font-extrabold text-brand-ink">3</span>
                <h3 className="mt-5 text-xl font-semibold">Share it anywhere</h3>
                <p className="mt-2 text-muted-foreground">Your bio, a post, a slide, a printed QR code. Supporters tip from their own wallet.</p>
                <p className="mt-5 text-sm text-muted-foreground">Your dashboard shows each tip once it confirms on chain.</p>
              </li>
            </ol>
          </div>
        </section>

        {/* Fund from Bitcoin: the Mezo part */}
        <section aria-labelledby="btc-title" className="mx-auto max-w-6xl px-4 py-20 sm:px-6 lg:py-28">
          <div className="grid gap-12 lg:grid-cols-[1fr_1.1fr] lg:gap-20">
            <div>
              <h2 id="btc-title" className="font-display text-4xl leading-[1.05] font-bold tracking-[-0.03em] sm:text-5xl">
                No MUSD? Pay with Bitcoin.
              </h2>
              <p className="mt-5 max-w-xl text-lg text-muted-foreground">
                Lots of people on Mezo hold BTC and nothing else. When a supporter is short, the tip page offers a way to get the MUSD first, without leaving the page.
              </p>
            </div>
            <dl className="divide-y border-y text-[1.0625rem]">
              <div className="py-5">
                <dt className="font-semibold">Swap a little BTC</dt>
                <dd className="mt-1 text-muted-foreground">On Mezo pools, for just enough MUSD to cover the tip. Two taps in the wallet.</dd>
              </div>
              <div className="py-5">
                <dt className="font-semibold">Borrow against your BTC</dt>
                <dd className="mt-1 text-muted-foreground">
                  With Mezo Borrow: draw a little more from a loan you already have, or open one and keep your Bitcoin. Manage it any time at{" "}
                  <a href={TESTNET_DAPP_URL} target="_blank" rel="noopener noreferrer" className="font-medium text-foreground underline underline-offset-4">
                    testnet.mezo.org
                  </a>
                  .
                </dd>
              </div>
              <div className="py-5">
                <dt className="font-semibold">Or tip in MEZO</dt>
                <dd className="mt-1 text-muted-foreground">Creators can accept MEZO too. Totals for each token are kept apart, never mixed.</dd>
              </div>
            </dl>
          </div>
        </section>

        {/* Who it's for */}
        <section aria-labelledby="who-title" className="border-t">
          <div className="mx-auto max-w-6xl px-4 py-20 sm:px-6 lg:py-28">
          <h2 id="who-title" className="text-lg font-semibold text-muted-foreground">
            Who it&apos;s for
          </h2>
          <p className="mt-4 max-w-5xl font-display text-3xl leading-[1.18] font-bold tracking-[-0.025em] sm:text-[2.75rem]">
            {AUDIENCES.map((a, i) => (
              <span key={a}>
                <span className={i % 3 === 1 ? "text-brand-ink" : undefined}>{a}</span>
                {i < AUDIENCES.length - 1 ? ", " : ""}
              </span>
            ))}
            <span className="text-muted-foreground">, and anyone whose work people want to thank.</span>
          </p>
          <p className="mt-8">
            <Link href="/explore" className="inline-flex min-h-11 items-center gap-1.5 font-medium text-brand-ink underline underline-offset-4">
              See the latest public tips <ArrowRight className="size-4" aria-hidden />
            </Link>
          </p>
          </div>
        </section>

        {/* QR demo */}
        <section aria-labelledby="qr-title" className="border-y bg-surface">
          <div className="mx-auto grid max-w-6xl items-center gap-12 px-4 py-20 sm:px-6 md:grid-cols-[auto_1fr] md:gap-16 lg:py-24">
            <div className="mx-auto w-56 sm:w-64">
              <div className="aspect-square rounded-[1.25rem] bg-[#fdfbfa] p-5 shadow-panel">
                <QrDemo url={`${SITE.url}/start?src=qr`} />
              </div>
              <p className="mt-3 text-center text-sm text-muted-foreground">Scan to try it on your phone</p>
            </div>
            <div className="max-w-xl">
              <h2 id="qr-title" className="font-display text-4xl leading-[1.05] font-bold tracking-[-0.03em] sm:text-5xl">
                A QR code that comes with your link.
              </h2>
              <p className="mt-5 text-lg text-muted-foreground">
                Put it on a stall, a conference slide or a stream overlay. Download it as a PNG, an SVG, or a ready-made card with your name and photo.
              </p>
              <p className="mt-4 text-lg text-muted-foreground">Scans are counted on their own, so you can see which tips came from the room.</p>
            </div>
          </div>
        </section>

        {/* Non-custodial + network */}
        <section aria-labelledby="safe-title" className="mx-auto max-w-6xl px-4 py-20 sm:px-6 lg:py-28">
          <div className="grid gap-14 lg:grid-cols-[1fr_1.1fr] lg:gap-20">
            <div>
              <h2 id="safe-title" className="font-display text-4xl leading-[1.05] font-bold tracking-[-0.03em] sm:text-5xl">
                Your money never passes through us.
              </h2>
              <ul className="mt-8 space-y-5 text-[1.0625rem]">
                <li>
                  <p className="font-semibold">Wallet to wallet</p>
                  <p className="mt-1 text-muted-foreground">A tip is a plain MUSD or MEZO transfer from the supporter straight to the creator. No contract in between, nothing to withdraw.</p>
                </li>
                <li>
                  <p className="font-semibold">You see where it goes</p>
                  <p className="mt-1 text-muted-foreground">Before signing, supporters see the full wallet address the tip is going to, with a link to check it on the explorer.</p>
                </li>
                <li>
                  <p className="font-semibold">Checked on chain</p>
                  <p className="mt-1 text-muted-foreground">A tip only shows as confirmed after we find the transfer on Mezo, with the right amount, to the right wallet.</p>
                </li>
                <li>
                  <p className="font-semibold">No keys, no custody</p>
                  <p className="mt-1 text-muted-foreground">We never ask for a recovery phrase and never hold funds. Signing in is a free signature, not a transaction.</p>
                </li>
              </ul>
            </div>

            <div className="self-start rounded-[1.25rem] border bg-card p-6 sm:p-8">
              <h3 className="font-display text-2xl font-bold tracking-[-0.02em]">Network details</h3>
              <dl className="mt-6 divide-y text-[0.9375rem]">
                <div className="grid gap-1 py-4 sm:grid-cols-[8rem_1fr]">
                  <dt className="text-muted-foreground">Network</dt>
                  <dd>
                    Mezo Testnet <span className="text-muted-foreground">(chain {MEZO_TESTNET_ID})</span>
                  </dd>
                </div>
                <div className="grid gap-1 py-4 sm:grid-cols-[8rem_1fr]">
                  <dt className="text-muted-foreground">Tips are in</dt>
                  <dd>
                    <a href={explorerToken(MUSD)} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 font-medium text-brand-ink underline underline-offset-4">
                      MUSD <ExternalLink className="size-3.5" aria-hidden />
                    </a>
                    , a dollar-pegged token on Mezo, or{" "}
                    <a href={explorerToken(MEZO_TOKEN)} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 font-medium text-brand-ink underline underline-offset-4">
                      MEZO <ExternalLink className="size-3.5" aria-hidden />
                    </a>
                    , if the creator accepts it.
                  </dd>
                </div>
                <div className="grid gap-1 py-4 sm:grid-cols-[8rem_1fr]">
                  <dt className="text-muted-foreground">Fees are in</dt>
                  <dd>BTC. The supporter pays a small network fee for each tip.</dd>
                </div>
                <div className="grid gap-1 py-4 sm:grid-cols-[8rem_1fr]">
                  <dt className="text-muted-foreground">Test funds</dt>
                  <dd>
                    Free from the{" "}
                    <a href={FAUCET_URL} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 font-medium text-brand-ink underline underline-offset-4">
                      Mezo faucet <ExternalLink className="size-3.5" aria-hidden />
                    </a>
                    . They have no real value.
                  </dd>
                </div>
              </dl>
            </div>
          </div>
        </section>

        {/* FAQ */}
        <section id="faq" aria-labelledby="faq-title" className="border-t">
          <div className="mx-auto grid max-w-6xl gap-10 px-4 py-20 sm:px-6 lg:grid-cols-[1fr_2fr] lg:py-28">
            <h2 id="faq-title" className="font-display text-4xl leading-[1.05] font-bold tracking-[-0.03em] sm:text-5xl">
              Questions
            </h2>
            <Faq />
          </div>
        </section>

        {/* Closing */}
        <section className="bg-brand text-brand-foreground">
          <div className="mx-auto flex max-w-6xl flex-col items-start gap-8 px-4 py-16 sm:px-6 md:flex-row md:items-center md:justify-between lg:py-20">
            <h2 className="max-w-xl font-display text-4xl leading-[1.05] font-bold tracking-[-0.03em] sm:text-5xl">Your link is two minutes away.</h2>
            <Link
              href="/start"
              className="inline-flex h-14 shrink-0 items-center gap-2 rounded-full bg-brand-foreground px-7 text-base font-semibold text-brand transition-transform active:scale-[0.98]"
            >
              Create your tip link <ArrowRight className="size-4" aria-hidden />
            </Link>
          </div>
        </section>
      </main>
      <SiteFooter />
    </>
  );
}
