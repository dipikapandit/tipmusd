import type { AnalyticsEventType } from "@/lib/api-types";

/** Fire-and-forget public analytics event. Never throws, never blocks the UI. */
export function track(username: string, type: AnalyticsEventType, source?: string | null): void {
  if (typeof window === "undefined" || !username) return;
  try {
    const body = JSON.stringify({ username, type, ...(source ? { source } : {}) });
    void fetch("/api/analytics/event", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
      keepalive: true,
      credentials: "same-origin",
    }).catch(() => undefined);
  } catch {
    /* ignore */
  }
}
