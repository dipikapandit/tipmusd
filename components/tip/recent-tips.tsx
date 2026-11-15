import type { PublicTip } from "@/lib/api-types";
import { explorerTx } from "@/lib/chain/config";
import { musdShort, relativeTime } from "@/lib/client/format";

/** Public recent tips (only rendered when the creator made activity public). */
export function RecentTips({ tips, now }: { tips: PublicTip[]; now: number }) {
  if (!tips.length) return null;
  return (
    <section aria-labelledby="recent-tips" className="mt-12">
      <h2 id="recent-tips" className="font-display text-lg font-bold tracking-[-0.02em]">
        Recent supporters
      </h2>
      <ul className="mt-3 divide-y">
        {tips.map((t) => (
          <li key={t.id} className="flex gap-3 py-3.5">
            <div className="min-w-0 flex-1">
              <p className="text-sm">
                <span className="font-medium">{t.supporterName || t.senderShort || "Anonymous"}</span>
                <span className="text-muted-foreground"> sent </span>
                <span className="num font-medium">
                  {musdShort(t.amountRaw)} {t.token ?? "MUSD"}
                </span>
                {t.fundedFromBitcoin ? <span className="text-muted-foreground"> from Bitcoin</span> : null}
              </p>
              {t.message ? <p className="mt-1 text-sm break-words whitespace-pre-line text-muted-foreground">{t.message}</p> : null}
            </div>
            <a
              href={explorerTx(t.txHash)}
              target="_blank"
              rel="noopener noreferrer"
              className="shrink-0 self-start pt-0.5 text-xs text-muted-foreground underline-offset-4 hover:underline"
            >
              <time dateTime={t.confirmedAt}>{relativeTime(t.confirmedAt, now)}</time>
              <span className="sr-only"> (view transaction)</span>
            </a>
          </li>
        ))}
      </ul>
    </section>
  );
}
