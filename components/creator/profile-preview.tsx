import type { Accent, AvatarPreset, SocialLink } from "@/lib/api-types";
import { checkTipAmount } from "@/lib/client/amount";
import { musdShort } from "@/lib/client/format";
import { cn } from "@/lib/client/utils";
import { Avatar } from "./avatar";
import { SocialLinks } from "./social-links";

/** Static preview of the public tip page card, for Settings. Mirrors the real page, nothing is interactive. */
export function ProfilePreview({
  displayName,
  username,
  bio,
  avatarUrl,
  avatarPreset,
  socialLinks,
  accent,
  amounts,
  defaultAmount,
  messagesEnabled,
  className,
}: {
  displayName: string;
  username: string;
  bio: string;
  avatarUrl: string | null;
  avatarPreset: AvatarPreset | null;
  socialLinks: SocialLink[];
  accent: Accent;
  amounts: string[];
  defaultAmount: string;
  messagesEnabled: boolean;
  className?: string;
}) {
  const chips = amounts.map((a) => checkTipAmount(a)).filter((c): c is Extract<typeof c, { ok: true }> => c.ok);
  const def = checkTipAmount(defaultAmount);
  const first = displayName.trim().split(/\s+/)[0] || "them";
  return (
    <div data-accent={accent} className={cn("overflow-hidden rounded-[1.25rem] border bg-card", className)} aria-label="Preview of your tip page">
      <div className="h-14 bg-tint-soft" />
      <div className="px-5 pb-5">
        <Avatar name={displayName || "?"} url={avatarUrl} preset={avatarPreset} seed={username} className="-mt-8 size-16 ring-4 ring-card" />
        <p className="mt-3 font-display text-xl leading-tight font-bold tracking-[-0.02em] break-words">{displayName || "Your name"}</p>
        <p className="text-sm text-muted-foreground">@{username}</p>
        {bio ? <p className="mt-2 line-clamp-4 text-sm whitespace-pre-line">{bio}</p> : null}
        {socialLinks.length ? <SocialLinks links={socialLinks} className="-ml-2.5 [&_a]:min-h-9" /> : null}
        <p className="mt-4 text-sm font-semibold">Support {first}</p>
        <div className="mt-2 grid grid-cols-3 gap-1.5">
          {chips.map((c) => (
            <span
              key={c.normalized}
              className={cn(
                "num flex h-10 items-center justify-center rounded-full border text-sm font-semibold",
                def.ok && def.value === c.value ? "border-tint bg-tint text-tint-foreground" : "bg-card",
              )}
            >
              {musdShort(c.value)}
            </span>
          ))}
        </div>
        {messagesEnabled ? <div className="mt-2 h-10 rounded-xl border bg-card px-3 py-2.5 text-xs text-muted-foreground">Message (optional)</div> : null}
        <div className="mt-3 flex h-11 items-center justify-center rounded-full bg-tint text-sm font-semibold text-tint-foreground">
          Tip {def.ok ? musdShort(def.value) : chips[0] ? musdShort(chips[0].value) : ""} MUSD
        </div>
      </div>
    </div>
  );
}
