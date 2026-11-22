import { config } from "dotenv";
config({ path: process.env.ENV_FILE ?? ".env.local" });
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";

/**
 * Applies pending SQL migrations (forward-only, ONE transaction for everything pending). Safe to run on every deploy / container start.
 *
 * Two guards the drizzle migrator does not have (audit K, A4):
 *  - a session advisory lock: when several replicas start together, the second waits until the first has committed and then finds nothing to do
 *    (drizzle reads "the last applied migration" outside its transaction, so without the lock both would try to apply the same DDL and the loser would crash-loop);
 *  - `lock_timeout` (default 30 s, `MIGRATE_LOCK_TIMEOUT_MS`): a migration that needs a table lock behind a long-running transaction fails fast (and the container
 *    retries) instead of queueing in front of every other query on that table.
 *
 * The pool has ONE connection, so the lock, the timeout and the migration share one session.
 * Big tables: `CREATE INDEX` here is NOT concurrent (drizzle wraps the migration in a transaction, which forbids `CONCURRENTLY`). Before deploying a migration that adds
 * an index to a large table, create it by hand first with `CREATE INDEX CONCURRENTLY IF NOT EXISTS …` — the migration's `IF NOT EXISTS` then does nothing. See memory/audit/data.md.
 */
export const MIGRATE_LOCK_KEY = 7788100;
export async function migrateWithLock(url: string, folder = "./drizzle", lockTimeoutMs = Number(process.env.MIGRATE_LOCK_TIMEOUT_MS ?? 30_000)) {
  const pool = new Pool({ connectionString: url, max: 1, idleTimeoutMillis: 0 }); // one session for the lock, the timeout and the DDL: never recycled
  try {
    await pool.query("select pg_advisory_lock($1)", [MIGRATE_LOCK_KEY]);
    try {
      await pool.query(`set lock_timeout = ${Math.max(0, Math.floor(lockTimeoutMs))}`);
      await migrate(drizzle(pool), { migrationsFolder: folder });
    } finally {
      await pool.query("reset lock_timeout").catch(() => {});
      await pool.query("select pg_advisory_unlock($1)", [MIGRATE_LOCK_KEY]).catch(() => {});
    }
  } finally {
    await pool.end();
  }
}

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is required");
  await migrateWithLock(url);
  console.log("migrations applied");
}
if (process.argv[1] && /migrate\.ts$/.test(process.argv[1])) main().catch((e) => { console.error(e); process.exit(1); });
