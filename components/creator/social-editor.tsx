"use client";

import { Plus, X } from "lucide-react";
import type { SocialKind, SocialLink } from "@/lib/api-types";
import { Input } from "@/components/ui/input";
import { SOCIAL_KINDS, SOCIAL_META } from "./social-links";

export const MAX_SOCIAL = 6;

export function SocialEditor({ links, onChange }: { links: SocialLink[]; onChange: (l: SocialLink[]) => void }) {
  return (
    <div className="space-y-2">
      {links.map((l, i) => {
        const bad = l.url.trim() !== "" && !/^https:\/\/\S+\.\S+/i.test(l.url.trim());
        return (
          <div key={i} className="flex items-start gap-2">
            <label className="sr-only" htmlFor={`social-kind-${i}`}>
              Link type
            </label>
            <select
              id={`social-kind-${i}`}
              value={l.kind}
              onChange={(e) => onChange(links.map((x, j) => (j === i ? { ...x, kind: e.target.value as SocialKind } : x)))}
              className="h-11 w-32 shrink-0 rounded-xl border border-input bg-card px-3 text-sm"
            >
              {SOCIAL_KINDS.map((k) => (
                <option key={k} value={k}>
                  {SOCIAL_META[k].label}
                </option>
              ))}
            </select>
            <div className="min-w-0 flex-1">
              <label className="sr-only" htmlFor={`social-url-${i}`}>
                {SOCIAL_META[l.kind].label} URL
              </label>
              <Input
                id={`social-url-${i}`}
                inputMode="url"
                placeholder={SOCIAL_META[l.kind].placeholder}
                value={l.url}
                aria-invalid={bad}
                onChange={(e) => onChange(links.map((x, j) => (j === i ? { ...x, url: e.target.value.trim() } : x)))}
              />
              {bad ? <p className="mt-1 text-xs text-bad">Use a full https:// link.</p> : null}
            </div>
            <button
              type="button"
              aria-label={`Remove ${SOCIAL_META[l.kind].label} link`}
              onClick={() => onChange(links.filter((_, j) => j !== i))}
              className="inline-flex size-11 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              <X className="size-4" aria-hidden />
            </button>
          </div>
        );
      })}
      {links.length < MAX_SOCIAL ? (
        <button
          type="button"
          onClick={() => onChange([...links, { kind: links.some((l) => l.kind === "x") ? "website" : "x", url: "" }])}
          className="inline-flex min-h-11 items-center gap-1.5 rounded-full border border-dashed px-4 text-sm font-medium text-muted-foreground hover:text-foreground"
        >
          <Plus className="size-4" aria-hidden /> Add a link
        </button>
      ) : null}
    </div>
  );
}
