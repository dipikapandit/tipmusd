import type { X402Info } from "@/lib/api-types";
import { explorerToken } from "@/lib/chain/config";
import { cn } from "@/lib/client/utils";

/** Read-only summary of GET /api/x402/info. */
export function X402Status({ info, className }: { info: X402Info; className?: string }) {
  const rows: [string, React.ReactNode][] = [
    ["Status", info.enabled ? "On" : "Off on this server"],
    ["Network", <code key="n" className="font-mono text-[0.8rem]">{info.network}</code>],
    [
      "Token",
      <a key="t" className="font-mono text-[0.8rem] underline-offset-4 hover:underline" href={explorerToken(info.asset)} target="_blank" rel="noopener noreferrer">
        MUSD {info.asset.slice(0, 6)}…{info.asset.slice(-4)}
      </a>,
    ],
    ["Facilitator", <span key="f" className="break-all font-mono text-[0.8rem]">{info.facilitator}</span>],
  ];
  return (
    <dl className={cn("grid gap-x-6 gap-y-2 rounded-[var(--radius)] border p-4 text-sm sm:grid-cols-[auto_1fr]", className)}>
      {rows.map(([k, v]) => (
        <div key={k} className="contents">
          <dt className="text-muted-foreground">{k}</dt>
          <dd className="flex items-center gap-2">
            {k === "Status" && (
              <span aria-hidden className={cn("size-2 rounded-full", info.enabled ? "bg-ok" : "bg-idle")} />
            )}
            {v}
          </dd>
        </div>
      ))}
    </dl>
  );
}
