"use client";

import { useState } from "react";
import { cn } from "@/lib/client/utils";
import { Avatar } from "@/components/creator/avatar";

const AMOUNTS = ["2", "5", "10", "25", "50", "100"];

/**
 * Illustrative tip page for the landing hero. Clearly marked "Example": a fictional creator, no real data.
 * The amounts are clickable so visitors can feel the flow; nothing is ever sent from here.
 */
export function ExampleCard({ className }: { className?: string }) {
  const [amount, setAmount] = useState("5");
  const [nudge, setNudge] = useState(false);
  return (
    <div data-accent="orange" className={cn("w-full max-w-[22rem] rounded-[1.25rem] bg-card text-card-foreground shadow-panel", className)}>
      <div className="h-16 rounded-t-[1.25rem] bg-tint-soft" />
      <div className="px-5 pb-5">
        <Avatar name="Mara Lindqvist" preset="dusk" className="-mt-9 size-[4.5rem] ring-4 ring-card" />
        <p className="mt-3 font-display text-[1.375rem] leading-tight font-bold tracking-[-0.02em]">Mara Lindqvist</p>
        <p className="text-sm text-muted-foreground">@mara · illustrator</p>
        <p className="mt-2.5 text-sm leading-relaxed">I draw a small comic every Friday. If one made your week, a tip keeps the next one coming.</p>
        <p className="mt-5 text-sm font-semibold">Support Mara</p>
        <div className="mt-2 grid grid-cols-3 gap-1.5" role="radiogroup" aria-label="Example amounts">
          {AMOUNTS.map((a) => (
            <button
              key={a}
              type="button"
              role="radio"
              aria-checked={amount === a}
              onClick={() => {
                setAmount(a);
                setNudge(false);
              }}
              className={cn(
                "num min-h-11 rounded-full border text-sm font-semibold transition-colors duration-150",
                amount === a ? "border-tint bg-tint text-tint-foreground" : "bg-card hover:border-foreground/30",
              )}
            >
              {a}
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={() => setNudge(true)}
          className="mt-3 flex h-12 w-full items-center justify-center rounded-full bg-tint text-[0.9375rem] font-semibold text-tint-foreground transition-transform active:scale-[0.98]"
        >
          Tip {amount} MUSD
        </button>
        <p className="mt-2 min-h-5 text-center text-xs text-muted-foreground" aria-live="polite">
          {nudge ? "Just an example. Nothing is sent from here." : "Goes straight to Mara's wallet."}
        </p>
      </div>
    </div>
  );
}
