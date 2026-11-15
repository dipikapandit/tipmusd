import Link from "next/link";
import { FAUCET_URL, MEZO_BORROW, MEZO_POOLS, MEZO_TOKEN, MUSD, explorerAddress } from "@/lib/chain/config";
import { LogoMark } from "@/components/brand/logo";

/** Mezo Testnet contracts TipMUSD uses. TipMUSD deploys none of its own: tips are direct token transfers. */
const CONTRACTS = [
  { label: "MUSD", address: MUSD },
  { label: "MEZO", address: MEZO_TOKEN },
  { label: "Mezo pools router", address: MEZO_POOLS.router },
  { label: "Mezo Borrow", address: MEZO_BORROW.borrowerOperations },
] as const;

const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

export function SiteFooter() {
  return (
    <footer className="mt-auto border-t">
      <div className="mx-auto grid max-w-6xl gap-8 px-4 py-10 text-sm sm:px-6 md:grid-cols-[1.4fr_1fr_1fr_1.2fr]">
        <div className="max-w-sm space-y-3">
          <p className="flex items-center gap-2 font-display text-base font-bold">
            <LogoMark className="size-6" /> TipMUSD
          </p>
          <p className="text-muted-foreground">
            Runs on Mezo Testnet. Testnet MUSD, MEZO and BTC have no real value. TipMUSD is an independent project, not run by or affiliated with Mezo.
          </p>
        </div>
        <div>
          <p className="font-medium">Product</p>
          <ul className="mt-2 space-y-0.5 text-muted-foreground">
            <li><Link className="inline-flex min-h-10 items-center hover:text-foreground" href="/start">Create your tip link</Link></li>
            <li><Link className="inline-flex min-h-10 items-center hover:text-foreground" href="/explore">Explore</Link></li>
            <li><Link className="inline-flex min-h-10 items-center hover:text-foreground" href="/dashboard">Dashboard</Link></li>
            <li><Link className="inline-flex min-h-10 items-center hover:text-foreground" href="/developers">Developers</Link></li>
          </ul>
        </div>
        <div>
          <p className="font-medium">Testnet</p>
          <ul className="mt-2 space-y-0.5 text-muted-foreground">
            <li><a className="inline-flex min-h-10 items-center hover:text-foreground" href={FAUCET_URL} target="_blank" rel="noopener noreferrer">Get testnet BTC and MEZO</a></li>
            <li><Link className="inline-flex min-h-10 items-center hover:text-foreground" href="/#faq">FAQ</Link></li>
          </ul>
        </div>
        <div>
          <p className="font-medium">Contracts used</p>
          <p className="mt-1 text-[0.8125rem] text-muted-foreground">Mezo Testnet. TipMUSD adds no contract of its own.</p>
          <ul className="mt-2 space-y-0.5 text-muted-foreground">
            {CONTRACTS.map((c) => (
              <li key={c.label}>
                <a className="inline-flex min-h-10 items-center gap-2 hover:text-foreground" href={explorerAddress(c.address)} target="_blank" rel="noopener noreferrer">
                  {c.label} <span className="font-mono text-[0.8125rem]">{short(c.address)}</span>
                </a>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </footer>
  );
}
