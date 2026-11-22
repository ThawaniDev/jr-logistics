import { config } from "dotenv";
config({ path: process.env.ENV_FILE ?? ".env.local" });
import { Pool } from "pg";

/**
 * `npx tsx scripts/validate-constraints.ts [--dry-run]` — turns every `NOT VALID` CHECK / FOREIGN KEY constraint into a validated one (audit K, A4).
 *
 * Why: the migrations add integrity constraints as NOT VALID so a deploy never fails on legacy rows. They are enforced for every new or updated row from the start, but
 * Postgres only trusts them for old rows after `VALIDATE CONSTRAINT`. Validation takes a SHARE UPDATE EXCLUSIVE lock (reads and writes continue; only other DDL and
 * VACUUM wait) and scans the table once, so run it off-peak. A constraint that existing rows violate is reported (Postgres names it) and left NOT VALID; nothing is changed or deleted.
 * Read-only apart from the validation itself. Exit code 1 when any constraint is violated by existing data.
 */
async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is required");
  const dry = process.argv.includes("--dry-run");
  const pool = new Pool({ connectionString: url, max: 1 });
  let failed = 0;
  try {
    const { rows } = await pool.query<{ tbl: string; name: string; kind: string }>(
      `select conrelid::regclass::text as tbl, conname as name, contype as kind from pg_constraint where connamespace = 'public'::regnamespace and not convalidated order by 1, 2`);
    if (!rows.length) console.log("every constraint is validated");
    for (const c of rows) {
      if (dry) { console.log(`would validate ${c.name} on ${c.tbl}`); continue; }
      try {
        await pool.query(`set statement_timeout = 0; set lock_timeout = '10s'`);
        await pool.query(`alter table ${c.tbl} validate constraint "${c.name.replace(/"/g, '""')}"`);
        console.log(`validated  ${c.name} on ${c.tbl}`);
      } catch (e) {
        failed++;
        console.log(`VIOLATED   ${c.name} on ${c.tbl}: ${(e as Error).message}`);
      }
    }
  } finally { await pool.end(); }
  if (failed) { console.log(`${failed} constraint(s) are violated by existing rows: fix the data, then run this again.`); process.exitCode = 1; }
}
main().catch((e) => { console.error(e); process.exit(1); });
