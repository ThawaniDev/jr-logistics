import { config } from "dotenv";
config({ path: process.env.ENV_FILE ?? ".env.local" });
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";

/** Applies pending SQL migrations (forward-only, transactional). Safe to run on every deploy. */
async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is required");
  const pool = new Pool({ connectionString: url, max: 1 });
  await migrate(drizzle(pool), { migrationsFolder: "./drizzle" });
  await pool.end();
  console.log("migrations applied");
}
main().catch((e) => { console.error(e); process.exit(1); });
