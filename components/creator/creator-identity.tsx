import type { PublicCreator } from "@/lib/api-types";
import { cn } from "@/lib/client/utils";
import { pluralize } from "@/lib/client/format";
import { Avatar } from "./avatar";
import { SocialLinks } from "./social-links";

/** Avatar, name, @username, bio, links. Used on the tip page and in previews. */
export function CreatorIdentity({
  creator,
  className,
  size = "lg",
  as: H = "h1",
}: {
  creator: Pick<PublicCreator, "displayName" | "username" | "bio" | "avatarUrl" | "avatarPreset" | "socialLinks" | "stats">;
  className?: string;
  size?: "lg" | "sm";
  as?: "h1" | "h2" | "p";
}) {
  const lg = size === "lg";
  return (
    <div className={className}>
      <Avatar
        name={creator.displayName}
        url={creator.avatarUrl}
        preset={creator.avatarPreset}
        seed={creator.username}
        className={cn("ring-4 ring-background", lg ? "size-24 sm:size-28" : "size-16")}
      />
      <H className={cn("mt-4 font-display font-bold tracking-[-0.03em] break-words", lg ? "text-[2rem] leading-[1.05] sm:text-[2.5rem]" : "text-xl leading-tight")}>
        {creator.displayName}
      </H>
      <p className="mt-1 text-[0.9375rem] text-muted-foreground">@{creator.username}</p>
      {creator.bio ? <p className={cn("mt-3 max-w-[52ch] whitespace-pre-line", lg ? "text-[1.0625rem] leading-relaxed" : "text-sm")}>{creator.bio}</p> : null}
      {creator.stats && creator.stats.tips > 0 ? (
        <p className="num mt-3 text-sm text-muted-foreground">
          {pluralize(creator.stats.supporters, "supporter")} so far
        </p>
      ) : null}
      {creator.socialLinks.length ? <SocialLinks links={creator.socialLinks} className="mt-2 -ml-2.5" /> : null}
    </div>
  );
}
