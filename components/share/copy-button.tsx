"use client";

import { useState } from "react";
import { Check, Copy } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/client/utils";

export async function copyText(value: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(value);
    return true;
  } catch {
    return false;
  }
}

/** Icon-only copy button with a 44px hit area. */
export function CopyButton({ value, label = "Copy", className }: { value: string; label?: string; className?: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={async () => {
        if (await copyText(value)) {
          setDone(true);
          setTimeout(() => setDone(false), 1600);
        } else toast.error("Couldn't copy. Select the text and copy it yourself.");
      }}
      className={cn(
        "-m-2 inline-flex size-11 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground",
        className,
      )}
    >
      {done ? <Check className="size-4 text-ok" aria-hidden /> : <Copy className="size-4" aria-hidden />}
      <span className="sr-only" aria-live="polite">
        {done ? "Copied" : ""}
      </span>
    </button>
  );
}

/** A link field with a big copy button, for dashboards and the done screen. */
export function CopyField({ value, display, onCopy, className }: { value: string; display?: string; onCopy?: () => void; className?: string }) {
  const [done, setDone] = useState(false);
  return (
    <div className={cn("flex items-center gap-2 rounded-full border bg-card p-1.5 pl-4", className)}>
      <span className="min-w-0 flex-1 truncate font-medium" title={value}>
        {display ?? value}
      </span>
      <button
        type="button"
        onClick={async () => {
          if (await copyText(value)) {
            setDone(true);
            onCopy?.();
            setTimeout(() => setDone(false), 1600);
          } else toast.error("Couldn't copy. Select the text and copy it yourself.");
        }}
        className="inline-flex h-11 shrink-0 items-center gap-1.5 rounded-full bg-primary px-4 text-sm font-medium text-primary-foreground transition-transform active:scale-[0.98]"
      >
        {done ? <Check className="size-4" aria-hidden /> : <Copy className="size-4" aria-hidden />}
        {done ? "Copied" : "Copy"}
      </button>
    </div>
  );
}
