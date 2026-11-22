import { config } from "dotenv";
config({ path: process.env.ENV_FILE ?? ".env.local" });

/**
 * Demo history generator: months of realistic activity (orders, parcels, money, support, sign-ins, snapshots …) so reports and detail pages can be judged.
 * Opt-in, development / demo databases only. See memory/DEMO_HISTORY.md.
 *
 *   npm run db:seed:history -- --yes                  generate the default 180 days
 *   npm run db:seed:history -- --dry-run              simulate and print the counts, write nothing
 *   npm run db:seed:history -- --reset --yes          remove only what this tool generated
 */
async function main() {
  const { parseHistoryArgs, USAGE, runHistory } = await import("../src/server/demo-history");
  const { closeDb } = await import("../src/db");
  let opts;
  try { opts = parseHistoryArgs(process.argv.slice(2)); } catch (e) { console.error(`${(e as Error).message}\n\n${USAGE}`); process.exit(2); }
  if (opts.help) { console.log(USAGE); return; }
  try {
    const r = await runHistory(opts, { log: (m) => console.log(m) });
    console.log(`\n${r.mode.toUpperCase()} done in ${r.seconds.toFixed(1)} s`);
    if (r.window) console.log(`Window ${r.window.from} → ${r.window.to}`);
    const shown = Object.entries(r.counts).filter(([, n]) => n > 0);
    if (shown.length) console.log(shown.map(([k, n]) => `${k}: ${n.toLocaleString()}`).join("\n"));
    if (r.money) console.log(`ledger postings: ${r.money.postings.toLocaleString()} (top-ups ${r.money.topups}, withdrawals ${r.money.withdrawals})`);
    if (r.stats) console.log(`simulation: ${Object.entries(r.stats).filter(([k]) => process.env.HISTORY_DEBUG || !k.startsWith("dbg:")).map(([k, n]) => `${k} ${n}`).join(", ")}`);
    if (r.verify) console.log(`\nMoney & integrity: ${r.verify.ok ? "PASS" : "FAIL"} (${r.verify.checks.filter((c) => c.ok).length}/${r.verify.checks.length} checks)`);
  } catch (e) {
    const pg = (e as { cause?: { message?: string; detail?: string } }).cause; // Drizzle hides the Postgres reason (which row still references what) in `cause`
    console.error(`\nFAILED: ${(e as Error).message}${pg?.message ? `\n  because: ${pg.message}${pg.detail ? ` — ${pg.detail}` : ""}` : ""}`);
    process.exitCode = 1;
  } finally { await closeDb(); }
}
main();
