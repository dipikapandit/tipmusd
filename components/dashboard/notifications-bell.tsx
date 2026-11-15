"use client";

import Link from "next/link";
import { Bell } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { useMarkNotificationsRead, useNotifications } from "@/hooks/use-api";
import { useMounted } from "@/hooks/use-mounted";
import { relativeTime } from "@/lib/client/format";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

export function NotificationsBell() {
  const mounted = useMounted();
  const auth = useAuth();
  const enabled = mounted && Boolean(auth.profile);
  const q = useNotifications(enabled);
  const mark = useMarkNotificationsRead();
  if (!enabled) return null;
  const items = q.data ?? [];
  const unread = items.filter((n) => !n.readAt).length;
  return (
    <Popover
      onOpenChange={(open) => {
        if (!open && unread) mark.mutate(items.filter((n) => !n.readAt).map((n) => n.id));
      }}
    >
      <PopoverTrigger asChild>
        <button
          type="button"
          className="relative inline-flex size-11 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          aria-label={unread ? `Notifications, ${unread} unread` : "Notifications"}
        >
          <Bell className="size-[1.125rem]" aria-hidden />
          {unread ? (
            <span className="num absolute top-1.5 right-1.5 flex min-w-4 items-center justify-center rounded-full bg-brand px-1 text-[0.625rem] leading-4 font-semibold text-brand-foreground">
              {unread > 9 ? "9+" : unread}
            </span>
          ) : null}
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[min(22rem,calc(100vw-2rem))] rounded-2xl p-0">
        <p className="border-b px-4 py-3 text-sm font-semibold">Notifications</p>
        {items.length ? (
          <ul className="max-h-96 divide-y overflow-y-auto">
            {items.slice(0, 20).map((n) => {
              const body = (
                <>
                  <span className="flex items-start justify-between gap-3">
                    <span className="text-sm font-medium">{n.title}</span>
                    {!n.readAt ? <span className="mt-1.5 size-2 shrink-0 rounded-full bg-brand" aria-label="Unread" /> : null}
                  </span>
                  {n.message ? <span className="mt-0.5 block text-sm text-muted-foreground">{n.message}</span> : null}
                  <span className="mt-1 block text-xs text-muted-foreground">{relativeTime(n.createdAt)}</span>
                </>
              );
              return (
                <li key={n.id}>
                  {n.tipId ? (
                    <Link href={`/tip/${n.tipId}`} className="block px-4 py-3 hover:bg-muted">
                      {body}
                    </Link>
                  ) : (
                    <div className="px-4 py-3">{body}</div>
                  )}
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="px-4 py-6 text-sm text-muted-foreground">Nothing yet. You&apos;ll hear here when a tip arrives.</p>
        )}
      </PopoverContent>
    </Popover>
  );
}
