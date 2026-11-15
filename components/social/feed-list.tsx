import Link from "next/link";
import type { FeedItem } from "@/lib/api-types";
import { explorerTx } from "@/lib/chain/config";
import { musdShort, relativeTime } from "@/lib/client/format";
import { Avatar } from "@/components/creator/avatar";

/** Public tips: "Ana tipped Sam 5 MUSD". Server-safe; pass `now` from the caller so it renders the same twice. */
export function FeedList({ items, now, showCreator = true }: { items: FeedItem[]; now: number; showCreator?: boolean }) {
  return (
    <ul className="divide-y">
      {items.map((f) => (
        <li key={f.tipId} className="flex gap-3 py-3.5">
          {showCreator ? (
            <Link href={`/${f.creator.username}`} className="shrink-0" tabIndex={-1} aria-hidden>
              <Avatar name={f.creator.displayName} url={f.creator.avatarUrl} preset={f.creator.avatarPreset} seed={f.creator.username} className="size-9" />
            </Link>
          ) : null}
          <div className="min-w-0 flex-1">
            <p className="text-sm">
              {f.supporterAddress ? (
                <Link href={`/supporter/${f.supporterAddress}`} className="font-medium underline-offset-4 hover:underline">
                  {f.supporterLabel}
                </Link>
              ) : (
                <span className="font-medium">{f.supporterLabel}</span>
              )}
              <span className="text-muted-foreground"> tipped </span>
              {showCreator ? (
                <>
                  <Link href={`/${f.creator.username}`} className="font-medium underline-offset-4 hover:underline">
                    {f.creator.displayName}
                  </Link>{" "}
                </>
              ) : null}
              <span className="num font-medium">
                {musdShort(f.amountRaw)} {f.token}
              </span>
              {f.fundedFromBitcoin ? <span className="text-muted-foreground"> from Bitcoin</span> : null}
            </p>
            {f.message ? <p className="mt-1 line-clamp-3 text-sm break-words whitespace-pre-line text-muted-foreground">{f.message}</p> : null}
          </div>
          <a
            href={explorerTx(f.txHash)}
            target="_blank"
            rel="noopener noreferrer"
            className="shrink-0 self-start pt-0.5 text-xs text-muted-foreground underline-offset-4 hover:underline"
          >
            <time dateTime={f.confirmedAt}>{relativeTime(f.confirmedAt, now)}</time>
            <span className="sr-only"> (view transaction)</span>
          </a>
        </li>
      ))}
    </ul>
  );
}
