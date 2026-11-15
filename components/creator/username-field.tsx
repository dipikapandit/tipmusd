"use client";

import { useId } from "react";
import { Check, Loader2, X } from "lucide-react";
import { USERNAME_HINT, normalizeUsername, usernameProblem } from "@/lib/usernames";
import { SITE } from "@/lib/client/site";
import { cn } from "@/lib/client/utils";
import { useDebounced } from "@/hooks/use-debounced";
import { useUsernameCheck } from "@/hooks/use-api";

export type UsernameState = "idle" | "checking" | "available" | "unavailable" | "error" | "same";

const REASON: Record<string, string> = {
  invalid: USERNAME_HINT,
  reserved: "That name is reserved. Try another.",
  taken: "Someone already has that name.",
  retired: "That name was used before and can't be claimed again.",
};

/** Username input with live, debounced availability and a link preview. */
export function useUsernameAvailability(value: string, current?: string) {
  const u = normalizeUsername(value);
  const debounced = useDebounced(u, 350);
  const local = u ? usernameProblem(u) : null;
  const same = Boolean(current && u === current);
  const remote = useUsernameCheck(debounced, Boolean(debounced) && !usernameProblem(debounced) && !(current && debounced === current));
  let state: UsernameState = "idle";
  let message = USERNAME_HINT;
  if (!u) state = "idle";
  else if (same) {
    state = "same";
    message = "This is your current username.";
  } else if (local) {
    state = "unavailable";
    message = REASON[local];
  } else if (debounced !== u || remote.isFetching) {
    state = "checking";
    message = "Checking…";
  } else if (remote.isError) {
    state = "error";
    message = "We couldn't check right now. You can still try.";
  } else if (remote.data) {
    state = remote.data.available ? "available" : "unavailable";
    message = remote.data.available ? "It's yours if you want it." : (remote.data.message ?? REASON[remote.data.reason ?? "taken"] ?? "That name isn't available.");
  }
  return { username: u, state, message };
}

export function UsernameField({ value, onChange, current, autoFocus }: { value: string; onChange: (v: string) => void; current?: string; autoFocus?: boolean }) {
  const id = useId();
  const { username, state, message } = useUsernameAvailability(value, current);
  return (
    <div>
      <label htmlFor={id} className="text-sm font-medium">
        Username
      </label>
      <div
        className={cn(
          "mt-1.5 flex h-14 items-center rounded-xl border border-input bg-card pr-3 pl-4 text-lg focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/50",
          state === "unavailable" && "border-bad",
        )}
      >
        <span className="shrink-0 text-muted-foreground select-none">{SITE.host}/</span>
        <input
          id={id}
          value={value}
          onChange={(e) => onChange(e.target.value.replace(/\s/g, "").toLowerCase().slice(0, 30))}
          autoFocus={autoFocus}
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          autoComplete="off"
          placeholder="yourname"
          aria-invalid={state === "unavailable"}
          aria-describedby={`${id}-status`}
          className="min-w-0 flex-1 bg-transparent font-semibold outline-none placeholder:font-normal placeholder:text-muted-foreground/70"
        />
        <span aria-hidden className="ml-2 shrink-0">
          {state === "checking" ? (
            <Loader2 className="size-5 animate-spin text-muted-foreground" />
          ) : state === "available" || state === "same" ? (
            <Check className="size-5 text-ok" />
          ) : state === "unavailable" ? (
            <X className="size-5 text-bad" />
          ) : null}
        </span>
      </div>
      <p
        id={`${id}-status`}
        aria-live="polite"
        className={cn("mt-1.5 text-[0.8125rem]", state === "unavailable" ? "text-bad" : state === "available" ? "text-ok" : "text-muted-foreground")}
      >
        {message}
      </p>
      {username && (state === "available" || state === "checking") ? (
        <p className="mt-1 truncate text-sm text-muted-foreground">
          Your link: <span className="font-medium text-foreground">{SITE.host}/{username}</span>
        </p>
      ) : null}
    </div>
  );
}
