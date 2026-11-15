// Public analytics events + abuse reports. Visitors are never identified: the visitor hash is an HMAC keyed by
// SESSION_SECRET + the UTC day over ip+user-agent, so it can't be linked across days or reversed.
import { createHmac } from "node:crypto";
import type { AnalyticsEventType, ReportReason } from "@/lib/api-types";
import { clock } from "./clock";
import type { Sql } from "./db";
import { env } from "./env";
import { notFound } from "./errors";
import { getCreatorForPayment } from "./creators";
import { cleanOptional, cleanSource } from "./sanitize";

export const ANALYTICS_EVENT_TYPES: readonly AnalyticsEventType[] = ["page_view", "qr_view", "share_click", "wallet_connect", "tip_started", "funding_started"];
export const REPORT_REASONS: readonly ReportReason[] = ["impersonation", "scam", "spam", "offensive", "other"];

export function utcDay(d: Date = clock.now()): string {
  return d.toISOString().slice(0, 10);
}

export function visitorHash(ip: string, userAgent: string, day: string = utcDay()): string {
  return createHmac("sha256", `${env.sessionSecret()}:${day}`).update(`${ip}\n${userAgent}`).digest("hex").slice(0, 32);
}

/** Records one event; duplicates (same visitor, creator, type, day) are ignored. Unknown creators → 404. */
export async function recordAnalyticsEvent(
  sql: Sql,
  input: { username: string; type: AnalyticsEventType; source?: string | null },
  client: { ip: string; userAgent: string },
): Promise<{ recorded: boolean }> {
  const creator = await getCreatorForPayment(sql, input.username);
  if (!creator) throw notFound("Creator not found");
  const now = clock.now();
  const day = utcDay(now);
  const rows = await sql`
    INSERT INTO analytics_events (creator_id, event_type, source, visitor_hash, day, created_at)
    VALUES (${creator.id}, ${input.type}, ${cleanSource(input.source)}, ${visitorHash(client.ip, client.userAgent, day)}, ${day}::date, ${now})
    ON CONFLICT DO NOTHING RETURNING id`;
  return { recorded: rows.length > 0 };
}

export async function createReport(
  sql: Sql,
  input: { username: string; reason: ReportReason; details?: string | null },
  client: { ip: string },
): Promise<void> {
  const creator = await getCreatorForPayment(sql, input.username);
  if (!creator) throw notFound("Creator not found");
  const reporter = createHmac("sha256", env.sessionSecret()).update(`report:${client.ip}`).digest("hex").slice(0, 32);
  await sql`INSERT INTO reports (creator_id, reason, details, reporter_hash, created_at)
            VALUES (${creator.id}, ${input.reason}, ${cleanOptional(input.details, { max: 500, multiline: true })}, ${reporter}, ${clock.now()})`;
}
