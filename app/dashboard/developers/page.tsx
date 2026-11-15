"use client";

import { useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import type { X402Info } from "@/lib/api-types";
import { useAuth } from "@/hooks/use-auth";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { CodeBlock } from "@/components/x402/code-block";
import { X402Status } from "@/components/x402/x402-status";
import { agentSnippet, curlSnippet, endpointUrl, scriptSnippet } from "@/components/x402/snippets";

async function fetchInfo(): Promise<X402Info> {
  const res = await fetch("/api/x402/info", { cache: "no-store" });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await res.json()) as X402Info;
}

export default function DashboardDevelopersPage() {
  const { profile, sessionLoading } = useAuth();
  const info = useQuery({ queryKey: ["x402", "info"], queryFn: fetchInfo, staleTime: 60_000 });
  const [amount, setAmount] = useState("1");

  const appUrl = info.data ? new URL(info.data.endpointTemplate).origin : typeof window !== "undefined" ? window.location.origin : "";
  const cleanAmount = /^\d+(\.\d{1,6})?$/.test(amount.trim()) ? amount.trim() : "1";

  return (
    <div className="max-w-3xl space-y-8">
      <header>
        <h1 className="font-display text-2xl font-bold tracking-tight">Developers</h1>
        <p className="mt-2 text-muted-foreground">
          Agents, bots and scripts can tip you over HTTP with x402. They pay in MUSD, the facilitator pays the gas, and
          the money goes straight to your wallet. These tips show up in your activity like any other.
        </p>
        <p className="mt-2 text-sm text-muted-foreground">
          Experimental, Mezo Testnet only. Your normal tip link doesn&apos;t change.{" "}
          <Link className="underline underline-offset-4" href="/developers">How it works</Link>
        </p>
      </header>

      {info.isLoading ? (
        <Skeleton className="h-32 w-full" />
      ) : info.data ? (
        <X402Status info={info.data} />
      ) : (
        <p className="rounded-[var(--radius)] border p-4 text-sm text-muted-foreground">Couldn&apos;t load the x402 status. Try again in a moment.</p>
      )}

      {info.data && !info.data.enabled && (
        <p className="rounded-[var(--radius)] border border-dashed p-4 text-sm text-muted-foreground">
          x402 is switched off on this server, so the endpoint below answers 404 for now.
        </p>
      )}

      {sessionLoading ? (
        <Skeleton className="h-48 w-full" />
      ) : profile ? (
        <section className="space-y-4" aria-labelledby="endpoint">
          <h2 id="endpoint" className="font-display text-lg font-semibold">Your endpoint</h2>
          <div className="max-w-40 space-y-1.5">
            <Label htmlFor="x402-amount">Example amount (MUSD)</Label>
            <Input id="x402-amount" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
          </div>
          <CodeBlock label="Endpoint" code={endpointUrl(appUrl, profile.username, cleanAmount)} />
          <CodeBlock label="See the price" code={curlSnippet(appUrl, profile.username, cleanAmount)} />
          <CodeBlock label="Pay with the script" code={scriptSnippet(appUrl, profile.username, cleanAmount)} />
          <CodeBlock label="Pay from an agent (TypeScript)" code={agentSnippet(appUrl, profile.username, cleanAmount)} />
          <p className="text-sm text-muted-foreground">
            Payments always go to your payout wallet on file. Nobody can change that through the URL.
          </p>
        </section>
      ) : (
        <p className="text-sm text-muted-foreground">
          <Link className="underline underline-offset-4" href="/start">Create your tip link</Link> to get your own endpoint.
        </p>
      )}
    </div>
  );
}
