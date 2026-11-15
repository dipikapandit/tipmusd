import type { TipStatus } from "@/lib/api-types";
import { STATUS_LABEL, statusTone } from "@/lib/client/tip-status";
import { cn } from "@/lib/client/utils";

const TONE = {
  ok: "text-ok",
  pending: "text-warn",
  bad: "text-bad",
  idle: "text-muted-foreground",
} as const;

/** Status as a word with a small glyph. Colour is never the only signal. */
export function StatusBadge({ status, className }: { status: TipStatus; className?: string }) {
  const tone = statusTone(status);
  return (
    <span className={cn("inline-flex items-center gap-1.5 text-sm font-medium", TONE[tone], className)}>
      <span aria-hidden className={cn("size-2 rounded-full bg-current", tone === "pending" && "animate-pulse")} />
      {STATUS_LABEL[status]}
    </span>
  );
}
