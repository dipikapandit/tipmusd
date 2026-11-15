import Link from "next/link";
import { Logo } from "@/components/brand/logo";
import { ThemeToggle } from "@/components/brand/theme-toggle";
import { HeaderAccount } from "./header-account";

export function SiteHeader() {
  return (
    <header className="sticky top-0 z-[var(--z-sticky)] border-b border-transparent bg-background/90 backdrop-blur-md supports-[backdrop-filter]:bg-background/75">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-3 px-4 sm:px-6">
        <Logo />
        <nav className="flex items-center gap-1" aria-label="Main">
          <Link href="/explore" className="inline-flex min-h-11 items-center rounded-full px-3 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground">
            Explore
          </Link>
          <Link href="/#how" className="hidden min-h-11 items-center rounded-full px-3 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground sm:inline-flex">
            How it works
          </Link>
          <Link href="/#faq" className="hidden min-h-11 items-center rounded-full px-3 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground md:inline-flex">
            FAQ
          </Link>
          <ThemeToggle />
          <HeaderAccount />
        </nav>
      </div>
    </header>
  );
}
