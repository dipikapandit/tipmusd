"use client";

import { useState } from "react";
import { Check, Copy } from "lucide-react";
import { walletDeepLinks } from "@/lib/client/deeplinks";
import { Button } from "@/components/ui/button";

/** Phone with no wallet in this browser (e.g. inside the X app): open this page in a wallet app's browser. */
export function OpenInWallet() {
  const [copied, setCopied] = useState(false);
  const here = typeof window !== "undefined" ? window.location.href : "";
  const links = walletDeepLinks(here);
  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">This browser has no wallet. Open this page in your wallet app instead.</p>
      <ul className="grid grid-cols-2 gap-2">
        {links.map((l) => (
          <li key={l.id}>
            <a
              href={l.href}
              className="flex min-h-12 items-center justify-center rounded-xl border bg-card px-3 text-sm font-medium transition-colors hover:bg-muted"
            >
              {l.name}
            </a>
          </li>
        ))}
      </ul>
      <div className="rounded-xl bg-muted p-3.5 text-sm">
        <p className="text-muted-foreground">Using another wallet? Copy this link and paste it into its browser.</p>
        <Button
          variant="outline"
          size="sm"
          className="mt-2.5 h-10"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(here);
              setCopied(true);
              setTimeout(() => setCopied(false), 1800);
            } catch {
              /* clipboard blocked: the link is still selectable in the address bar */
            }
          }}
        >
          {copied ? <Check aria-hidden /> : <Copy aria-hidden />}
          {copied ? "Link copied" : "Copy link"}
        </Button>
      </div>
    </div>
  );
}
