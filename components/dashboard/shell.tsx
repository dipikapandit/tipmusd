"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { BarChart3, Code2, Home, ListChecks, Settings, Share2 } from "lucide-react";
import { cn } from "@/lib/client/utils";
import { stripScheme } from "@/lib/client/deeplinks";
import { useAuth } from "@/hooks/use-auth";
import { useMounted } from "@/hooks/use-mounted";
import { Logo } from "@/components/brand/logo";
import { ThemeToggle } from "@/components/brand/theme-toggle";
import { AuthGate } from "@/components/wallet/auth-gate";
import { WalletButton } from "@/components/wallet/wallet-button";
import { Skeleton } from "@/components/ui/skeleton";
import { buttonVariants } from "@/components/ui/button";
import { Avatar } from "@/components/creator/avatar";
import { NotificationsBell } from "./notifications-bell";

const NAV = [
  { href: "/dashboard", label: "Overview", Icon: Home },
  { href: "/dashboard/activity", label: "Activity", Icon: ListChecks },
  { href: "/dashboard/share", label: "Share", Icon: Share2 },
  { href: "/dashboard/analytics", label: "Analytics", Icon: BarChart3 },
  { href: "/dashboard/settings", label: "Settings", Icon: Settings },
  { href: "/dashboard/developers", label: "Developers", Icon: Code2 },
] as const;

const isActive = (path: string, href: string) => (href === "/dashboard" ? path === href : path === href || path.startsWith(`${href}/`));

export function DashboardShell({ children }: { children: React.ReactNode }) {
  const path = usePathname() ?? "/dashboard";
  return (
    <div className="flex min-h-dvh flex-col">
      {/* top bar */}
      <header className="sticky top-0 z-[var(--z-sticky)] border-b bg-background/90 backdrop-blur-md">
        <div className="flex h-16 items-center justify-between gap-2 px-4 lg:px-6">
          <Logo href="/dashboard" />
          <div className="flex items-center gap-1">
            <ThemeToggle />
            <NotificationsBell />
            <div className="hidden sm:block">
              <WalletButton />
            </div>
          </div>
        </div>
      </header>

      <div className="flex flex-1">
        {/* desktop sidebar */}
        <nav aria-label="Dashboard" className="sticky top-16 hidden h-[calc(100dvh-4rem)] w-60 shrink-0 flex-col border-r px-3 py-6 lg:flex">
          <ul className="space-y-0.5">
            {NAV.map(({ href, label, Icon }) => {
              const on = isActive(path, href);
              return (
                <li key={href}>
                  <Link
                    href={href}
                    aria-current={on ? "page" : undefined}
                    className={cn(
                      "flex min-h-11 items-center gap-3 rounded-full px-4 text-sm font-medium transition-colors",
                      on ? "bg-foreground text-background" : "text-muted-foreground hover:bg-muted hover:text-foreground",
                    )}
                  >
                    <Icon className="size-[1.125rem]" aria-hidden />
                    {label}
                  </Link>
                </li>
              );
            })}
          </ul>
          <SidebarProfile />
        </nav>

        <main id="main" className="min-w-0 flex-1 px-4 pt-6 pb-28 sm:px-6 lg:px-10 lg:pt-10 lg:pb-16">
          <div className="mx-auto max-w-5xl">
            <SessionGate>
              <NeedsProfile>{children}</NeedsProfile>
            </SessionGate>
          </div>
        </main>
      </div>

      {/* mobile bottom nav: five primary items; Developers lives in the top of Settings on mobile */}
      <nav aria-label="Dashboard" className="fixed inset-x-0 bottom-0 z-[var(--z-sticky)] border-t bg-background/95 pb-[env(safe-area-inset-bottom)] backdrop-blur-md lg:hidden">
        <ul className="grid grid-cols-5">
          {NAV.slice(0, 5).map(({ href, label, Icon }) => {
            const on = isActive(path, href);
            return (
              <li key={href}>
                <Link
                  href={href}
                  aria-current={on ? "page" : undefined}
                  className={cn("flex min-h-16 flex-col items-center justify-center gap-1 text-[0.6875rem] font-medium", on ? "text-foreground" : "text-muted-foreground")}
                >
                  <Icon className={cn("size-5", on && "text-brand-ink")} aria-hidden />
                  {label}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
    </div>
  );
}

function SidebarProfile() {
  const mounted = useMounted();
  const auth = useAuth();
  const p = auth.profile;
  if (!mounted || !p) return null;
  return (
    <Link href={`/${p.username}`} className="mt-auto flex items-center gap-3 rounded-2xl p-2 hover:bg-muted">
      <Avatar name={p.displayName} url={p.avatarUrl} preset={p.avatarPreset} seed={p.username} className="size-9" />
      <span className="min-w-0">
        <span className="block truncate text-sm font-medium">{p.displayName}</span>
        <span className="block truncate text-xs text-muted-foreground">{stripScheme(p.tipUrl)}</span>
      </span>
    </Link>
  );
}

/**
 * The dashboard needs a session, not a matching wallet: changing the payout wallet means connecting a different one.
 * A session-less visitor gets the connect → switch → sign steps.
 */
function SessionGate({ children }: { children: React.ReactNode }) {
  const mounted = useMounted();
  const auth = useAuth();
  if (!mounted || auth.sessionLoading) return <Skeleton className="h-40 w-full rounded-2xl" />;
  if (auth.session?.user) return <>{children}</>;
  return (
    <AuthGate title="Sign in to your dashboard" body="Your wallet is your login. Signing in is free and doesn't send a transaction.">
      {children}
    </AuthGate>
  );
}

function NeedsProfile({ children }: { children: React.ReactNode }) {
  const auth = useAuth();
  if (auth.sessionLoading) return <Skeleton className="h-40 w-full rounded-2xl" />;
  if (!auth.profile) {
    return (
      <div className="max-w-md py-10">
        <h1 className="font-display text-3xl font-bold tracking-[-0.03em]">Finish your tip page</h1>
        <p className="mt-2 text-muted-foreground">You&apos;re signed in, but you haven&apos;t claimed a username yet. It takes about a minute.</p>
        <Link href="/start" className={buttonVariants({ size: "lg", className: "mt-6" })}>
          Claim your link
        </Link>
      </div>
    );
  }
  return <>{children}</>;
}
