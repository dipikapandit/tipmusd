"use client";

import { useEffect } from "react";
import Link from "next/link";
import { Button, buttonVariants } from "@/components/ui/button";

export default function ErrorPage({ error, retry, reset }: { error: unknown; retry?: () => void; reset?: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);
  return (
    <main id="main" className="mx-auto flex w-full max-w-2xl flex-1 flex-col justify-center px-4 py-20">
      <h1 className="font-display text-4xl font-bold tracking-[-0.03em]">Something went wrong</h1>
      <p className="mt-3 max-w-md text-lg text-muted-foreground">This page hit a problem. No money moved because of it. Try again in a moment.</p>
      <div className="mt-8 flex flex-wrap gap-3">
        <Button size="lg" onClick={() => (retry ?? reset)?.()}>
          Try again
        </Button>
        <Link href="/" className={buttonVariants({ size: "lg", variant: "outline" })}>
          Go home
        </Link>
      </div>
    </main>
  );
}
