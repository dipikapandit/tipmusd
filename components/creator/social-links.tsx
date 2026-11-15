import { ArrowUpRight } from "lucide-react";
import type { SocialKind, SocialLink } from "@/lib/api-types";
import { cn } from "@/lib/client/utils";

export const SOCIAL_META: Record<SocialKind, { label: string; placeholder: string }> = {
  x: { label: "X", placeholder: "https://x.com/yourname" },
  linkedin: { label: "LinkedIn", placeholder: "https://www.linkedin.com/in/yourname" },
  github: { label: "GitHub", placeholder: "https://github.com/yourname" },
  instagram: { label: "Instagram", placeholder: "https://instagram.com/yourname" },
  youtube: { label: "YouTube", placeholder: "https://youtube.com/@yourname" },
  telegram: { label: "Telegram", placeholder: "https://t.me/yourname" },
  discord: { label: "Discord", placeholder: "https://discord.gg/invite" },
  farcaster: { label: "Farcaster", placeholder: "https://farcaster.xyz/yourname" },
  website: { label: "Website", placeholder: "https://yoursite.com" },
};

export const SOCIAL_KINDS = Object.keys(SOCIAL_META) as SocialKind[];

/** Only https links are ever rendered as links. */
const safeHref = (u: string) => (/^https:\/\//i.test(u) ? u : null);

export function SocialLinks({ links, className }: { links: SocialLink[]; className?: string }) {
  const items = links.map((l) => ({ ...l, href: safeHref(l.url) })).filter((l) => l.href);
  if (!items.length) return null;
  return (
    <ul className={cn("flex flex-wrap items-center gap-x-1 gap-y-0", className)} aria-label="Links">
      {items.map((l) => {
        const m = SOCIAL_META[l.kind] ?? SOCIAL_META.website;
        return (
          <li key={`${l.kind}-${l.url}`}>
            <a
              href={l.href!}
              target="_blank"
              rel="me noopener noreferrer"
              className="group inline-flex min-h-11 items-center gap-0.5 rounded-full px-2.5 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
            >
              {m.label}
              <ArrowUpRight className="size-3.5 opacity-60 transition-transform group-hover:-translate-y-px group-hover:translate-x-px" aria-hidden />
            </a>
          </li>
        );
      })}
    </ul>
  );
}
