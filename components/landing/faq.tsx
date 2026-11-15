import { ChevronDown } from "lucide-react";

const ITEMS: { q: string; a: React.ReactNode }[] = [
  {
    q: "Does TipMUSD hold my money?",
    a: "No. A tip is a normal MUSD or MEZO transfer from the supporter's wallet to yours. We never hold funds or keys, and there is no TipMUSD contract in the middle.",
  },
  {
    q: "What do supporters need?",
    a: "A Bitcoin wallet (through Mezo Passport) or an Ethereum wallet like MetaMask or Rabby, some MUSD or MEZO, and a little BTC for the network fee. On a phone they can open your link inside their wallet app.",
  },
  {
    q: "What if a supporter only has Bitcoin?",
    a: "The tip page offers to get the MUSD first: swap a little BTC on Mezo pools, borrow a bit more on an existing Mezo loan, or open one with Mezo Borrow. Each step is signed in their own wallet, and the tip is sent right after.",
  },
  {
    q: "Is this real money?",
    a: "Not yet. TipMUSD runs on Mezo Testnet, where MUSD, MEZO and BTC are free test tokens with no value. You can get them from the faucet.",
  },
  {
    q: "Are there fees?",
    a: "We don't take a cut. The supporter pays a small network fee in BTC, like any transfer on Mezo.",
  },
  {
    q: "How do I know a tip really arrived?",
    a: "We check every tip on chain before it shows as confirmed: the right token, the right amount, to your wallet. Each one links to the transaction on the Mezo explorer.",
  },
  {
    q: "Can I change my wallet or username later?",
    a: "Yes. You can switch the wallet tips go to (you sign with the new wallet to prove it's yours), and change your username once every 30 days. Old links keep working.",
  },
  {
    q: "Is TipMUSD made by Mezo?",
    a: "No. TipMUSD is an independent project built on Mezo Testnet. Profiles aren't verified by anyone, so check a creator's links before you tip.",
  },
];

export function Faq() {
  return (
    <div className="divide-y border-y">
      {ITEMS.map((it) => (
        <details key={it.q} className="group">
          <summary className="flex min-h-14 cursor-pointer list-none items-center justify-between gap-4 py-4 text-left font-medium [&::-webkit-details-marker]:hidden">
            <span className="text-[1.0625rem]">{it.q}</span>
            <ChevronDown className="size-5 shrink-0 text-muted-foreground transition-transform duration-200 group-open:rotate-180" aria-hidden />
          </summary>
          <p className="max-w-[65ch] pb-5 text-muted-foreground">{it.a}</p>
        </details>
      ))}
    </div>
  );
}
