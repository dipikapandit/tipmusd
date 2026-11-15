"use client";

import { Share2 } from "lucide-react";
import { shareIntents, type ShareChannel } from "@/lib/client/share";
import { useMounted } from "@/hooks/use-mounted";
import { cn } from "@/lib/client/utils";

const LABELS: Record<ShareChannel, string> = { x: "X", linkedin: "LinkedIn", telegram: "Telegram", whatsapp: "WhatsApp" };

/** Native share (when the browser has it) plus X, LinkedIn, Telegram and WhatsApp intents. */
export function ShareRow({ url, text, onShare, className }: { url: string; text: string; onShare?: (channel: string) => void; className?: string }) {
  const mounted = useMounted();
  const canNative = mounted && typeof navigator !== "undefined" && typeof navigator.share === "function";
  const intents = shareIntents(url, text);
  const item = "inline-flex min-h-11 items-center gap-1.5 rounded-full border bg-card px-4 text-sm font-medium transition-colors hover:bg-muted";
  return (
    <ul className={cn("flex flex-wrap gap-2", className)}>
      {canNative ? (
        <li>
          <button
            type="button"
            className={item}
            onClick={async () => {
              try {
                await navigator.share({ url, text });
                onShare?.("native");
              } catch {
                /* dismissed */
              }
            }}
          >
            <Share2 className="size-4" aria-hidden /> Share
          </button>
        </li>
      ) : null}
      {(Object.keys(intents) as ShareChannel[]).map((k) => (
        <li key={k}>
          <a href={intents[k]} target="_blank" rel="noopener noreferrer" className={item} onClick={() => onShare?.(k)}>
            {LABELS[k]}
          </a>
        </li>
      ))}
    </ul>
  );
}
