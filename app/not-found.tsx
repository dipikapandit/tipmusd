import Link from "next/link";
import type { Metadata } from "next";
import { SiteHeader } from "@/components/site/header";
import { SiteFooter } from "@/components/site/footer";
import { buttonVariants } from "@/components/ui/button";

export const metadata: Metadata = { title: "Page not found", robots: { index: false } };

export default function NotFound() {
  return (
    <>
      <SiteHeader />
      <main id="main" className="mx-auto flex w-full max-w-2xl flex-1 flex-col justify-center px-4 py-20">
        <p className="num font-display text-7xl font-extrabold text-brand-ink">404</p>
        <h1 className="mt-4 font-display text-4xl font-bold tracking-[-0.03em]">Nothing here</h1>
        <p className="mt-3 max-w-md text-lg text-muted-foreground">
          This link doesn&apos;t lead to a tip page. The name may be misspelled, or the page may have been taken down.
        </p>
        <div className="mt-8 flex flex-wrap gap-3">
          <Link href="/" className={buttonVariants({ size: "lg" })}>
            Go home
          </Link>
          <Link href="/start" className={buttonVariants({ size: "lg", variant: "outline" })}>
            Create your tip link
          </Link>
        </div>
      </main>
      <SiteFooter />
    </>
  );
}
