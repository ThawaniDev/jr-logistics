import { config } from "dotenv";
config({ path: process.env.ENV_FILE ?? ".env.local" });

/**
 * `npm run db:backfill:auth` — for a database that existed before username sign-in (J1). Idempotent, never deletes anything.
 *   1. every account without a username gets one (staff / admin from the e-mail, everyone else `u` + the digits of the phone — what migration 0021 does);
 *   2. every demo account (`is_demo`) gets a readable username (demo.business, demo.driver …) and the published demo password, without a forced change.
 * Real accounts are never given a password: until staff set one (Admin › user › Security › Reset password) they cannot sign in.
 * Demo deployments only (DEMO_MODE=true): the demo password is public.
 */
async function main() {
  const { closeDb } = await import("../src/db");
  const { env } = await import("../src/lib/env");
  const { backfillAuth, DEMO_PASSWORD } = await import("../src/server/demo-credentials");
  if (!env.demoMode) { console.log("DEMO_MODE is off → nothing to do (demo passwords are only set on demo deployments)"); await closeDb(); return; }
  const r = await backfillAuth();
  console.log(`✓ usernames filled in: ${r.usernamesFilled}`);
  for (const s of r.skipped) console.log(`! ${s}`);
  console.log(`✓ demo accounts (password ${DEMO_PASSWORD}):`);
  for (const d of r.demoUpdated) console.log(`   ${d.role.padEnd(9)} ${d.username.padEnd(16)} ${d.name}`);
  await closeDb();
}
main().catch((e) => { console.error(e); process.exit(1); });
