// In-app notifications for creators (tip_received | wallet_changed | username_changed).
import type { NotificationItem } from "@/lib/api-types";
import type { Sql } from "./db";
import { isoOrNull, iso, strOrNull } from "./db/rows";
import { clock } from "./clock";

export async function notify(
  sql: Sql,
  n: { userId: string; type: string; title: string; message?: string; tipId?: string | null },
): Promise<void> {
  // Tip notifications are unique per (user, type, tip): concurrent verifiers / the indexer never double-notify.
  await sql`INSERT INTO notifications (user_id, type, title, message, tip_id, created_at)
            VALUES (${n.userId}, ${n.type}, ${n.title}, ${n.message ?? ""}, ${n.tipId ?? null}, ${clock.now()})
            ON CONFLICT DO NOTHING`;
}

export async function listNotifications(sql: Sql, userId: string, limit = 50): Promise<NotificationItem[]> {
  const rows = await sql<Record<string, unknown>>`
    SELECT id, type, title, message, tip_id, read_at, created_at FROM notifications
    WHERE user_id = ${userId} ORDER BY created_at DESC, id DESC LIMIT ${limit}`;
  return rows.map((r) => ({
    id: String(r.id),
    type: String(r.type),
    title: String(r.title),
    message: String(r.message ?? ""),
    tipId: strOrNull(r.tip_id),
    readAt: isoOrNull(r.read_at),
    createdAt: iso(r.created_at),
  }));
}

/** Marks the given ids (or all) as read. Only ever touches the caller's own rows. */
export async function markNotificationsRead(sql: Sql, userId: string, ids?: string[]): Promise<void> {
  const now = clock.now();
  if (ids && ids.length) {
    const list = sql.join(ids.map((i) => sql.frag`${i}::uuid`), ", ");
    await sql`UPDATE notifications SET read_at = ${now} WHERE user_id = ${userId} AND read_at IS NULL AND id IN (${list})`;
  } else {
    await sql`UPDATE notifications SET read_at = ${now} WHERE user_id = ${userId} AND read_at IS NULL`;
  }
}
