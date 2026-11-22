import { config } from "dotenv";
config({ path: process.env.ENV_FILE ?? ".env.local" });
import { writeFileSync } from "node:fs";
import pg from "pg";

/**
 * Report profiler (audit K / A4). Runs every analytics report and the first page of every registered drill-down table against the database in
 * DATABASE_URL, as the super admin, and prints wall time + the slowest SQL statements of each. READ-ONLY: it only issues SELECTs (reports run in read-only
 * transactions). Point it at a scratch database filled by `npm run db:seed:history -- --yes --days 365 --companies 300 --offices 30 --drivers 1000`
 * to see how the reports behave at 10-40x the demo volume.
 *
 *   ENV_FILE=/path/to/env npx tsx scripts/profile-reports.ts [--preset 30d] [--explain 400] [--out plans.txt] [--exports] [--only overview,drivers]
 *
 *   --preset   period of every report (default 30d; the comparison period is read too)
 *   --explain  statements slower than N ms get EXPLAIN (ANALYZE, BUFFERS) appended to --out (default off)
 *   --exports  also time the CSV export of every table (50 000 row cap) -- this is the slow part, it pages with OFFSET
 *   --only     comma separated report names
 *   --dump     write every report / table-page result as JSON (volatile fields removed): run once per database time zone
 *              (`PGOPTIONS="-c TimeZone=UTC"` vs the default) and `diff` the files -- a report must not depend on the session time zone
 */
type Stmt = { ms: number; text: string; values: unknown[] };
let sink: Stmt[] | null = null;
const proto = pg.Client.prototype as unknown as { query: (...a: unknown[]) => unknown };
const orig = proto.query;
proto.query = function (this: unknown, ...args: unknown[]) {
  const a0 = args[0] as { text?: string; values?: unknown[] } | string;
  const text = typeof a0 === "string" ? a0 : a0?.text ?? "";
  const values = (typeof a0 === "string" ? (args[1] as unknown[] | undefined) : a0?.values ?? (Array.isArray(args[1]) ? (args[1] as unknown[]) : undefined)) ?? []; // Drizzle passes the values as the 2nd argument
  const t0 = performance.now();
  const r = orig.apply(this, args) as unknown;
  if (sink && r && typeof (r as Promise<unknown>).then === "function" && /^\s*(with|select)/i.test(text)) {
    (r as Promise<unknown>).then(() => sink?.push({ ms: performance.now() - t0, text, values }), () => sink?.push({ ms: performance.now() - t0, text, values }));
  }
  return r;
};

const arg = (k: string) => { const i = process.argv.indexOf(k); return i >= 0 ? process.argv[i + 1] : undefined; };
const flag = (k: string) => process.argv.includes(k);
const preset = arg("--preset") ?? "30d";
const explainMs = Number(arg("--explain") ?? 0);
const only = arg("--only")?.split(",");
const outFile = arg("--out");
const dumpFile = arg("--dump");
const dump: Record<string, unknown> = {};
const stable = (_k: string, v: unknown) => (_k === "generatedAt" || _k === "cached" ? undefined : v);

async function main() {
  process.env.ANALYTICS_CACHE_TTL_MS = "0";
  const { db, closeDb } = await import("../src/db");
  const { users } = await import("../src/db/schema");
  const { eq } = await import("drizzle-orm");
  const [admin] = await db.select().from(users).where(eq(users.role, "admin")).limit(1);
  if (!admin) throw new Error("no admin user in this database");
  const mod = async (p: string) => import(p);
  const reports: Record<string, (q: URLSearchParams) => Promise<unknown>> = {
    overview: (q) => import("../src/server/analytics/overview").then((m) => m.overviewReport(admin, q)),
    operations: (q) => import("../src/server/analytics/ops-report").then((m) => m.operationsReport(admin, q)),
    geography: (q) => import("../src/server/analytics/geo-report").then((m) => m.geographyReport(admin, q)),
    deliveries: (q) => import("../src/server/analytics/deliveries").then((m) => m.deliveriesReport(admin, q)),
    cod: (q) => import("../src/server/analytics/cod").then((m) => m.codReport(admin, q)),
    finance: (q) => import("../src/server/analytics/finance").then((m) => m.financeReport(admin, q)),
    companies: (q) => import("../src/server/analytics/companies").then((m) => m.companiesReport(admin, q)),
    drivers: (q) => import("../src/server/analytics/drivers").then((m) => m.driversReport(admin, q)),
    offices: (q) => import("../src/server/analytics/offices").then((m) => m.officesReport(admin, q)),
    growth: (q) => import("../src/server/analytics/growth").then((m) => m.growthReport(admin, q)),
    support: (q) => import("../src/server/analytics/support").then((m) => m.supportReport(admin, q)),
  };
  await mod("../src/server/analytics/fleet-tables-drivers"); await mod("../src/server/analytics/fleet-tables-offices");
  const { listTables, runTable } = await import("../src/server/analytics/registry");

  const q = new URLSearchParams({ preset });
  const plans: Array<{ label: string; s: Stmt }> = [];
  const lines: string[] = [];
  const run = async (label: string, fn: () => Promise<unknown>) => {
    sink = [];
    const t0 = performance.now();
    let status = "ok";
    try { const out = await fn(); if (dumpFile && !label.startsWith("CSV")) dump[label] = out; } catch (e) { status = `ERR ${(e as { code?: string; message?: string }).code ?? ""} ${(e as Error).message.slice(0, 70)}`; }
    const ms = performance.now() - t0;
    const st = sink; sink = null;
    const slow = [...st].sort((a, b) => b.ms - a.ms)[0];
    lines.push(`${label.padEnd(38)} ${ms.toFixed(0).padStart(7)} ms  stmts ${String(st.length).padStart(3)}  slowest ${slow ? slow.ms.toFixed(0).padStart(6) : "     -"} ms  ${status}`);
    if (explainMs) for (const s of st) if (s.ms >= explainMs) plans.push({ label, s });
  };

  for (const [name, fn] of Object.entries(reports)) if (!only || only.includes(name)) await run(`report ${name}`, () => fn(q));
  for (const def of listTables()) {
    if (only && !only.includes(def.report)) continue;
    const tq = new URLSearchParams({ preset, pageSize: "25" });
    await run(`table ${def.report}/${def.name}`, () => runTable(admin, def, tq));
  }
  // Data explorer: every dataset, first page for the period and for "all time" (the heaviest honest request), plus the search box
  if (!only || only.includes("explorer")) {
    const ex = await import("../src/server/analytics/explorer");
    const cat = (await ex.explorerCatalog(admin)) as { datasets: Array<{ key: string }> };
    for (const d of cat.datasets) {
      await run(`explorer ${d.key} (${preset})`, () => ex.explorerQuery(admin, d.key, new URLSearchParams({ preset, pageSize: "25" })));
      await run(`explorer ${d.key} (all, q=a)`, () => ex.explorerQuery(admin, d.key, new URLSearchParams({ all: "1", q: "a", pageSize: "25" })));
    }
  }
  // Finance > Drivers (list over every driver, then the busiest driver's summary and detail tables) — not analytics tables, own routes
  if (!only || only.includes("finance-drivers")) {
    const fd = await import("../src/server/finance-drivers");
    const { sql } = await import("drizzle-orm");
    for (const label of [preset, "all"]) {
      const lq = new URLSearchParams(label === "all" ? { period: "all", pageSize: "50" } : { preset, pageSize: "50" });
      await run(`finance-drivers list (${label})`, () => fd.financeDriversList(admin, lq));
    }
    const top = (await db.execute(sql`select driver_id as id from settlements group by driver_id order by count(*) desc limit 1`)).rows[0] as { id: string } | undefined;
    if (top) {
      const dq = new URLSearchParams({ period: "all", pageSize: "50" });
      await run("finance-drivers summary", () => fd.financeDriverSummary(admin, top.id, dq));
      for (const t of ["settlements", "ledger", "withdrawals", "cash", "statement"] as const) await run(`finance-drivers ${t}`, () => fd.financeDriverTable(admin, top.id, t, dq));
    }
  }
  if (flag("--exports")) {
    for (const def of listTables()) {
      if (only && !only.includes(def.report)) continue;
      const tq = new URLSearchParams({ preset, format: "csv" });
      await run(`CSV   ${def.report}/${def.name}`, async () => { const r = (await runTable(admin, def, tq)) as Response; await r.text(); });
    }
  }
  console.log(lines.join("\n"));
  if (dumpFile) writeFileSync(dumpFile, JSON.stringify(dump, stable, 1));

  if (plans.length) {
    const out: string[] = [];
    const client = await getPlanClient();
    for (const { label, s } of plans) {
      out.push(`\n===== ${label} (${s.ms.toFixed(0)} ms) =====\n${s.text.slice(0, 1500)}\n-- values: ${JSON.stringify(s.values).slice(0, 300)}`);
      try {
        await client.query("begin read only");
        const r = await client.query({ text: `explain (analyze, buffers) ${s.text}`, values: s.values as never });
        out.push((r.rows as Array<Record<string, string>>).map((x) => x["QUERY PLAN"]).join("\n"));
      } catch (e) { out.push(`explain failed: ${(e as Error).message}`); }
      finally { await client.query("rollback").catch(() => {}); }
    }
    await client.end();
    if (outFile) writeFileSync(outFile, out.join("\n")); else console.log(out.join("\n"));
  }
  await closeDb();
}
async function getPlanClient() { const c = new pg.Client({ connectionString: process.env.DATABASE_URL }); await c.connect(); return c; }
main().catch((e) => { console.error(e); process.exit(1); });
