import { ExternalLink } from "lucide-react";
import { FAUCET_URL, MEZO_TESTNET_ID } from "@/lib/chain/config";
import { cn } from "@/lib/client/utils";

const ext = "inline-flex items-center gap-1 font-medium text-brand-ink underline underline-offset-4";

/** No-wallet guidance for desktop. We never create a wallet for anyone. */
export function WalletGuide({ className }: { className?: string }) {
  return (
    <ol className={cn("space-y-4 text-sm", className)}>
      <li className="grid grid-cols-[1.5rem_1fr] gap-x-3">
        <span className="num font-display text-base font-semibold text-muted-foreground">1</span>
        <div>
          <p className="font-medium">Install a wallet</p>
          <p className="text-muted-foreground">Any browser wallet for Ethereum apps works, like MetaMask or Rabby. Keep its recovery phrase private.</p>
        </div>
      </li>
      <li className="grid grid-cols-[1.5rem_1fr] gap-x-3">
        <span className="num font-display text-base font-semibold text-muted-foreground">2</span>
        <div>
          <p className="font-medium">Come back and connect</p>
          <p className="text-muted-foreground">We ask your wallet to add Mezo Testnet (network {MEZO_TESTNET_ID}) for you.</p>
        </div>
      </li>
      <li className="grid grid-cols-[1.5rem_1fr] gap-x-3">
        <span className="num font-display text-base font-semibold text-muted-foreground">3</span>
        <div>
          <p className="font-medium">Get free testnet funds</p>
          <p className="text-muted-foreground">
            You need a little BTC for the network fee, plus the MUSD you want to send.{" "}
            <a className={ext} href={FAUCET_URL} target="_blank" rel="noopener noreferrer">
              Open the faucet <ExternalLink className="size-3" aria-hidden />
            </a>
          </p>
        </div>
      </li>
    </ol>
  );
}
