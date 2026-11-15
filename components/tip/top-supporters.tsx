import Link from "next/link";
import type { TopSupporter } from "@/lib/api-types";
import { pluralize } from "@/lib/client/format";
import { perTokenTotals } from "@/lib/client/tokens";

/** The creator's biggest public supporters (max 5, from the server). Hidden when there are none. */
export function TopSupporters({ supporters }: { supporters: TopSupporter[] }) {
  if (!supporters.length) return null;
  return (
    <section aria-labelledby="top-supporters" className="mt-12">
      <h2 id="top-supporters" className="font-display text-lg font-bold tracking-[-0.02em]">
        Top supporters
      </h2>
      <ol className="mt-3 divide-y">
        {supporters.map((s, i) => {
          const name = <span className="font-medium">{s.label}</span>;
          return (
            <li key={s.address ?? `${s.label}-${i}`} className="flex items-baseline gap-3 py-3 text-sm">
              <span className="num w-5 shrink-0 text-muted-foreground">{i + 1}</span>
              <span className="min-w-0 flex-1 truncate">
                {s.address ? (
                  <Link href={`/supporter/${s.address}`} className="underline-offset-4 hover:underline">
                    {name}
                  </Link>
                ) : (
                  name
                )}
                <span className="text-muted-foreground"> · {pluralize(s.tips, "tip")}</span>
              </span>
              <span className="num shrink-0 text-right">{perTokenTotals(s.musdRaw, s.mezoRaw)}</span>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
