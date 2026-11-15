import Link from "next/link";
import { ExternalLink } from "lucide-react";
import type { DashboardTip } from "@/lib/api-types";
import { explorerTx } from "@/lib/chain/config";
import { formatDateTime, musdShort, shortAddress } from "@/lib/client/format";
import { failureCopy } from "@/lib/client/tip-status";
import { StatusBadge } from "@/components/tip/status-badge";

/** "5 MUSD", plus a quiet "from BTC" when the supporter funded it from Bitcoin via Mezo (verified on chain). */
function Amount({ t }: { t: DashboardTip }) {
  return (
    <>
      {musdShort(t.amountRaw ?? t.expectedAmountRaw)} {t.token ?? "MUSD"}
      {t.funding?.verified ? <span className="block text-xs font-normal text-muted-foreground">from BTC</span> : null}
    </>
  );
}

const SOURCE: Record<DashboardTip["source"], string> = { app: "Tip page", indexer: "Direct transfer", x402: "x402" };

export function supporterLabel(t: DashboardTip): string {
  if (t.isAnonymous) return "Anonymous";
  return t.supporterName || shortAddress(t.senderAddress) || "Someone";
}

function Tx({ t }: { t: DashboardTip }) {
  if (!t.txHash) return <span className="text-muted-foreground">--</span>;
  return (
    <a
      href={t.explorerUrl ?? explorerTx(t.txHash)}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex min-h-11 items-center gap-1 font-mono text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
    >
      {t.txHash.slice(0, 8)}…{t.txHash.slice(-4)} <ExternalLink className="size-3" aria-hidden />
      <span className="sr-only">(view on explorer)</span>
    </a>
  );
}

/** Table on wide screens, cards on phones. */
export function TipList({ tips, compact = false }: { tips: DashboardTip[]; compact?: boolean }) {
  return (
    <>
      <ul className="divide-y md:hidden">
        {tips.map((t) => (
          <li key={t.id} className="py-4">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="truncate font-medium">{supporterLabel(t)}</p>
                <p className="text-xs text-muted-foreground">
                  {formatDateTime(t.timestamp)} · {SOURCE[t.source]}
                </p>
              </div>
              <p className="num shrink-0 text-right font-semibold">
                <Amount t={t} />
              </p>
            </div>
            {t.message ? <p className="mt-2 text-sm break-words whitespace-pre-line">{t.message}</p> : null}
            <div className="mt-1 flex items-center justify-between gap-3">
              <StatusBadge status={t.status} />
              <Tx t={t} />
            </div>
            {t.status === "failed" && !compact ? <p className="text-xs text-muted-foreground">{failureCopy(t.failureReason).title}</p> : null}
          </li>
        ))}
      </ul>
      <div className="hidden md:block">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-left text-muted-foreground">
              <th scope="col" className="py-3 pr-4 font-medium">From</th>
              <th scope="col" className="py-3 pr-4 text-right font-medium">Amount</th>
              <th scope="col" className="py-3 pr-4 font-medium">Status</th>
              {compact ? null : <th scope="col" className="py-3 pr-4 font-medium">Source</th>}
              <th scope="col" className="py-3 pr-4 font-medium">When</th>
              <th scope="col" className="py-3 font-medium">Transaction</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {tips.map((t) => (
              <tr key={t.id} className="align-top">
                <td className="max-w-[18rem] py-2.5 pr-4">
                  <Link href={`/tip/${t.id}`} className="font-medium underline-offset-4 hover:underline">
                    {supporterLabel(t)}
                  </Link>
                  {t.message ? <p className="mt-0.5 line-clamp-2 break-words text-muted-foreground">{t.message}</p> : null}
                  {t.campaign && !compact ? <p className="mt-0.5 text-xs text-muted-foreground">Campaign: {t.campaign}</p> : null}
                </td>
                <td className="num py-2.5 pr-4 text-right font-semibold whitespace-nowrap">
                  <Amount t={t} />
                </td>
                <td className="py-2.5 pr-4 whitespace-nowrap">
                  <StatusBadge status={t.status} />
                  {t.status === "failed" && !compact ? <p className="text-xs text-muted-foreground">{failureCopy(t.failureReason).title}</p> : null}
                </td>
                {compact ? null : (
                  <td className="py-2.5 pr-4 whitespace-nowrap text-muted-foreground">
                    {SOURCE[t.source]}
                    {t.referralSource ? <span className="block text-xs">via {t.referralSource}</span> : null}
                  </td>
                )}
                <td className="py-2.5 pr-4 whitespace-nowrap text-muted-foreground">{formatDateTime(t.timestamp)}</td>
                <td className="py-0 whitespace-nowrap">
                  <Tx t={t} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
