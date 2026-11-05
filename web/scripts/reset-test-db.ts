import { config } from "dotenv";
config({ path: ".env.test", override: true });
import { sql } from "drizzle-orm";

/** Safety: only ever truncates a database whose name ends in _test. */
async function main() {
  const url = process.env.DATABASE_URL ?? "";
  if (!/_test(\?|$)/.test(url)) throw new Error(`Refusing to reset non-test database: ${url}`);
  const { db, closeDb } = await import("../src/db");
  const rows = await db.execute<{ tablename: string }>(sql`select tablename from pg_tables where schemaname='public' and tablename not like '%drizzle%'`);
  await db.execute(sql.raw(`truncate ${rows.rows.map((r) => `"${r.tablename}"`).join(",")} restart identity cascade`));
  await closeDb();
  console.log("test db reset");
}
main().catch((e) => { console.error(e); process.exit(1); });
