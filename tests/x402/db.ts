// Isolated in-memory Postgres (PGlite + pgcrypto) for the x402 tests, exposing the app's `Sql` interface.
// Uses the app's own query compiler (sql.frag + compile) so behaviour matches lib/server/db.
import fs from "node:fs";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { compile, sql as appSql, type Row, type Sql } from "@/lib/server/db";

type Query = (text: string, params: unknown[]) => Promise<Row[]>;

function wrap(q: Query, db: PGlite, inTx: boolean): Sql {
  const fn = ((strings: TemplateStringsArray, ...values: unknown[]) => {
    const { text, params } = compile(appSql.frag(strings, ...values));
    return q(text, params);
  }) as unknown as Sql;
  Object.defineProperties(fn, { kind: { value: "pglite" }, inTransaction: { value: inTx } });
  fn.frag = appSql.frag;
  fn.join = appSql.join;
  fn.raw = appSql.raw;
  fn.begin = async (cb) => {
    if (inTx) return cb(fn);
    return db.transaction(async (tx) => cb(wrap(async (t, p) => (await tx.query(t, p)).rows as Row[], db, true)));
  };
  return fn;
}

let db: PGlite | null = null;

export async function freshTestDb(): Promise<Sql> {
  if (db) await db.close();
  db = new PGlite({ extensions: { pgcrypto } });
  await db.waitReady;
  await db.exec(fs.readFileSync(path.join(process.cwd(), "lib/server/db/schema.sql"), "utf8"));
  const pg = db;
  return wrap(async (t, p) => (await pg.query(t, p)).rows as Row[], pg, false);
}
