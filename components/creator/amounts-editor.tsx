"use client";

import { Plus, X } from "lucide-react";
import { TIP_LIMITS } from "@/lib/chain/config";
import { checkTipAmount } from "@/lib/client/amount";
import { cn } from "@/lib/client/utils";
import { Input } from "@/components/ui/input";

/** Edit up to MAX_SUGGESTED suggested amounts and choose the preselected one. */
export function AmountsEditor({
  amounts,
  onAmounts,
  defaultAmount,
  onDefault,
}: {
  amounts: string[];
  onAmounts: (a: string[]) => void;
  defaultAmount: string;
  onDefault: (a: string) => void;
}) {
  const checks = amounts.map((a) => checkTipAmount(a));
  const def = checkTipAmount(defaultAmount);
  const defNorm = def.ok ? def.normalized : null;
  return (
    <div className="space-y-3">
      <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {amounts.map((a, i) => {
          const c = checks[i];
          const bad = a.trim() !== "" && !c.ok;
          const isDefault = c.ok && c.normalized === defNorm;
          return (
            <li key={i} className="relative">
              <label className="sr-only" htmlFor={`amt-${i}`}>
                Amount {i + 1} in MUSD
              </label>
              <Input
                id={`amt-${i}`}
                inputMode="decimal"
                value={a}
                aria-invalid={bad}
                onChange={(e) => onAmounts(amounts.map((x, j) => (j === i ? e.target.value : x)))}
                className={cn("num pr-11 font-semibold", isDefault && "border-brand")}
              />
              {amounts.length > 1 ? (
                <button
                  type="button"
                  aria-label={`Remove amount ${a || i + 1}`}
                  onClick={() => onAmounts(amounts.filter((_, j) => j !== i))}
                  className="absolute top-0 right-0 inline-flex size-11 items-center justify-center rounded-full text-muted-foreground hover:text-foreground"
                >
                  <X className="size-4" aria-hidden />
                </button>
              ) : null}
            </li>
          );
        })}
        {amounts.length < TIP_LIMITS.MAX_SUGGESTED ? (
          <li>
            <button
              type="button"
              onClick={() => onAmounts([...amounts, ""])}
              className="inline-flex h-11 w-full items-center justify-center gap-1.5 rounded-xl border border-dashed text-sm font-medium text-muted-foreground hover:text-foreground"
            >
              <Plus className="size-4" aria-hidden /> Add
            </button>
          </li>
        ) : null}
      </ul>
      {checks.some((c, i) => amounts[i].trim() !== "" && !c.ok) ? (
        <p className="text-sm text-bad" role="alert">
          {(checks.find((c, i) => amounts[i].trim() !== "" && !c.ok) as { message: string }).message}
        </p>
      ) : null}
      <div>
        <p className="text-sm font-medium" id="default-amount">
          Preselected amount
        </p>
        <div className="mt-2 flex flex-wrap gap-2" role="radiogroup" aria-labelledby="default-amount">
          {checks
            .filter((c): c is Extract<typeof c, { ok: true }> => c.ok)
            .map((c) => {
              const on = c.normalized === defNorm;
              return (
                <button
                  key={c.normalized}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  onClick={() => onDefault(c.normalized)}
                  className={cn(
                    "num inline-flex min-h-11 min-w-14 items-center justify-center rounded-full border px-4 text-sm font-semibold",
                    on ? "border-foreground bg-foreground text-background" : "bg-card hover:bg-muted",
                  )}
                >
                  {Number(c.normalized).toLocaleString("en-US", { maximumFractionDigits: 6 })}
                </button>
              );
            })}
        </div>
      </div>
    </div>
  );
}
