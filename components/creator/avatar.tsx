import type { AvatarPreset } from "@/lib/api-types";
import { PRESET_COLORS, fallbackPreset, initials } from "@/lib/client/accents";
import { cn } from "@/lib/client/utils";

/** Uploaded photo, or a generated preset (gradient + initials). Server-safe. */
export function Avatar({
  name,
  url,
  preset,
  seed,
  className,
}: {
  name: string;
  url?: string | null;
  preset?: AvatarPreset | null;
  seed?: string;
  className?: string;
}) {
  if (url) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img src={url} alt="" width={512} height={512} className={cn("size-16 shrink-0 rounded-full bg-muted object-cover", className)} />
    );
  }
  const p = PRESET_COLORS[preset ?? fallbackPreset(seed ?? name)];
  return (
    <span
      aria-hidden
      className={cn("inline-flex size-16 shrink-0 items-center justify-center rounded-full font-display font-semibold select-none", className)}
      style={{ background: `linear-gradient(135deg, ${p.from}, ${p.to})`, color: p.ink, containerType: "inline-size" }}
    >
      <span style={{ fontSize: "38cqi", lineHeight: 1 }}>{initials(name)}</span>
    </span>
  );
}
