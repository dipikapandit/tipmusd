// Operator CLI (uses DATABASE_URL or the local PGlite store).
//   npx tsx scripts/admin.ts suspend <username>
//   npx tsx scripts/admin.ts unsuspend <username>
//   npx tsx scripts/admin.ts reports [--all]
//   npx tsx scripts/admin.ts resolve <reportId> dismissed|actioned
import "../worker/load-env";
import { normalizeUsername } from "@/lib/usernames";
import { closeDb, getDb } from "@/lib/server/db";

async function main() {
  const [cmd, arg, arg2] = process.argv.slice(2);
  const sql = await getDb();
  try {
    if (cmd === "suspend" || cmd === "unsuspend") {
      if (!arg) throw new Error(`usage: admin.ts ${cmd} <username>`);
      const status = cmd === "suspend" ? "suspended" : "active";
      const u = normalizeUsername(arg);
      const rows = await sql<{ username: string }>`
        UPDATE creator_profiles SET status = ${status}, updated_at = now()
        WHERE username = ${u} OR id = (SELECT creator_id FROM username_aliases WHERE username = ${u})
        RETURNING username`;
      if (!rows.length) throw new Error(`no creator @${u}`);
      console.log(`@${rows[0].username} → ${status}`);
    } else if (cmd === "reports") {
      const all = arg === "--all";
      const rows = await sql<Record<string, unknown>>`
        SELECT r.id, p.username, p.status AS profile_status, r.reason, r.details, r.status, r.created_at
        FROM reports r JOIN creator_profiles p ON p.id = r.creator_id
        WHERE ${all ? sql.frag`TRUE` : sql.frag`r.status = 'open'`}
        ORDER BY r.created_at DESC LIMIT 200`;
      if (!rows.length) console.log(all ? "no reports" : "no open reports");
      for (const r of rows)
        console.log(
          `${String(r.id)}  @${String(r.username)} (${String(r.profile_status)})  ${String(r.reason)}  [${String(r.status)}]  ${new Date(r.created_at as string).toISOString()}\n    ${String(r.details ?? "")}`,
        );
    } else if (cmd === "resolve") {
      if (!arg || !["dismissed", "actioned"].includes(arg2 ?? "")) throw new Error("usage: admin.ts resolve <reportId> dismissed|actioned");
      const rows = await sql`UPDATE reports SET status = ${arg2} WHERE id = ${arg}::uuid RETURNING id`;
      if (!rows.length) throw new Error("no such report");
      console.log(`report ${arg} → ${arg2}`);
    } else {
      console.log("commands: suspend <username> | unsuspend <username> | reports [--all] | resolve <reportId> dismissed|actioned");
      process.exitCode = cmd ? 1 : 0;
    }
  } finally {
    await closeDb();
  }
}

main().catch((e) => {
  console.error(`[admin] ${(e as Error).message}`);
  process.exit(1);
});
