import type { Metadata } from "next";
import Link from "next/link";
import { SiteHeader } from "@/components/site/header";
import { SiteFooter } from "@/components/site/footer";
import { CodeBlock } from "@/components/x402/code-block";
import { X402Status } from "@/components/x402/x402-status";
import { agentSnippet, curlSnippet, scriptSnippet } from "@/components/x402/snippets";
import { x402Info, x402Env } from "@/lib/server/x402/config";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Developers",
  description: "Let agents, bots and scripts tip creators in MUSD over HTTP with x402 (Mezo Testnet, experimental).",
  alternates: { canonical: "/developers" },
};

export default function DevelopersPage() {
  const info = x402Info();
  const appUrl = x402Env.appUrl();
  const example = "yourname";

  return (
    <>
      <SiteHeader />
      <main id="main" className="mx-auto w-full max-w-3xl flex-1 px-4 py-12 sm:px-6 sm:py-16">
        <h1 className="font-display text-3xl font-bold tracking-tight sm:text-4xl">Tips from code</h1>
        <p className="mt-4 max-w-2xl text-lg text-muted-foreground">
          People tip from their own wallet. Software can tip too: an agent, bot or script can pay a creator in MUSD with a
          single HTTP request, using the open <a className="text-foreground underline underline-offset-4" href="https://www.x402.org" target="_blank" rel="noopener noreferrer">x402</a> standard.
        </p>
        <p className="mt-3 max-w-2xl text-sm text-muted-foreground">
          Experimental and Mezo Testnet only. Ordinary tips don&apos;t use any of this.
        </p>

        <X402Status info={info} className="mt-8" />

        <section className="mt-12" aria-labelledby="how">
          <h2 id="how" className="font-display text-xl font-semibold">How it works</h2>
          <ol className="mt-4 space-y-3 text-[0.95rem]">
            <li><strong className="font-medium">Ask.</strong> Request a creator&apos;s tip URL with an amount. The answer is <code className="font-mono text-sm">402 Payment Required</code> with the exact MUSD amount and the creator&apos;s wallet.</li>
            <li><strong className="font-medium">Sign.</strong> Your code signs a payment for exactly that. It needs MUSD, but no BTC for gas.</li>
            <li><strong className="font-medium">Done.</strong> A payment service called a facilitator sends it on chain and pays the gas. The MUSD goes straight from your wallet to the creator. We check the transaction on chain, save the tip and send back a receipt.</li>
          </ol>
        </section>

        <section className="mt-12 space-y-4" aria-labelledby="try">
          <h2 id="try" className="font-display text-xl font-semibold">Try it</h2>
          <p className="text-sm text-muted-foreground">
            Endpoint: <code className="break-all font-mono text-[0.8rem] text-foreground">{info.endpointTemplate}</code>. Optional
            <code className="font-mono text-[0.8rem]"> &amp;name=</code>, <code className="font-mono text-[0.8rem]">&amp;message=</code> and <code className="font-mono text-[0.8rem]">&amp;anonymous=1</code>.
          </p>
          <CodeBlock label="See the price" code={curlSnippet(appUrl, example, "1")} />
          <CodeBlock label="Pay with the script (from the TipMUSD repo)" code={scriptSnippet(appUrl, example, "1")} />
          <CodeBlock label="Pay from your own agent (TypeScript)" code={agentSnippet(appUrl, example, "1")} />
          <p className="text-sm text-muted-foreground">
            Use a testnet-only key holding a little MUSD from the{" "}
            <a className="underline underline-offset-4" href="https://faucet.test.mezo.org" target="_blank" rel="noopener noreferrer">Mezo faucet</a>.
            The first payment from a new wallet also signs a one-time approval for Permit2, the contract that moves the MUSD.
          </p>
        </section>

        <section className="mt-12" aria-labelledby="limits">
          <h2 id="limits" className="font-display text-xl font-semibold">Good to know</h2>
          <ul className="mt-4 list-disc space-y-2 pl-5 text-[0.95rem] text-muted-foreground">
            <li>The facilitator is run by a third party, not by TipMUSD or Mezo. If it&apos;s down or out of gas, the request fails and nothing is charged.</li>
            <li>The creator&apos;s wallet always comes from their profile. Nothing in the request can change where the money goes.</li>
            <li>Names and messages are whatever the sender typed. The paying wallet is shown on the receipt.</li>
            <li>Testnet MUSD and BTC have no real value.</li>
          </ul>
        </section>

        <p className="mt-12 text-sm text-muted-foreground">
          Have a tip link? Your own endpoint and snippets are in{" "}
          <Link className="text-foreground underline underline-offset-4" href="/dashboard/developers">Dashboard → Developers</Link>.
        </p>
      </main>
      <SiteFooter />
    </>
  );
}
