import Link from "next/link";
import { cn } from "@/lib/client/utils";

/** The mark: a coin dropping into a slot. Geometric on purpose so it survives 16px. */
export function LogoMark({ className, title }: { className?: string; title?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={cn("size-7", className)} role={title ? "img" : undefined} aria-hidden={title ? undefined : true}>
      {title ? <title>{title}</title> : null}
      <rect width="32" height="32" rx="9" fill="var(--brand)" />
      <circle cx="16" cy="13" r="6" fill="var(--brand-foreground)" />
      <rect x="8" y="22.5" width="16" height="3" rx="1.5" fill="var(--brand-foreground)" opacity="0.85" />
    </svg>
  );
}

export function Logo({ className, href = "/" }: { className?: string; href?: string }) {
  return (
    <Link href={href} className={cn("inline-flex min-h-11 items-center gap-2 rounded-full pr-1 font-display text-[1.0625rem] font-bold tracking-[-0.02em]", className)}>
      <LogoMark />
      <span>
        Tip<span className="text-brand-ink">MUSD</span>
      </span>
    </Link>
  );
}
