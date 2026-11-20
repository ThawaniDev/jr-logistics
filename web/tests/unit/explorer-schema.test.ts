/**
 * Every SQL statement of the Support report, its drill-down tables and the Data explorer only names tables and columns that exist in `db/schema.ts`.
 * (The queries are captured instead of run: `rows()` is replaced, so no database is needed. A typo in a column name fails here, not in front of a user.)
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { getTableConfig, PgTable } from "drizzle-orm/pg-core";
import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";
import * as schema from "@/db/schema";
import type { User } from "@/db/schema";

const captured: SQL[] = [];
vi.mock("@/server/analytics/guard", async (orig) => ({ ...(await orig<typeof import("@/server/analytics/guard")>()), rows: vi.fn(async (q: SQL) => { captured.push(q); return []; }) }));
vi.mock("@/server/settings", () => ({ getSettings: async () => ({ lateGraceMin: 30 }) }));

import { parseFilters } from "@/server/analytics/filters";
import { supportFacts, agingAlerts } from "@/server/analytics/support-facts";
import { complaintsSeries, qualitySeries, ratingsSeries, ticketsSeries } from "@/server/analytics/support-series";
import { companiesPerOrder, complaintBreakdowns, driversPerOrder, lowestRated, repeatRequesters, ticketBreakdowns, ticketHeatmap, workload } from "@/server/analytics/support-groups";
import { getTable, listTables } from "@/server/analytics/registry";
import "@/server/analytics/support-tables";
import "@/server/analytics/explorer";
import { allDatasets } from "@/server/analytics/explorer-registry";
import { countQuery, groupQuery, pageQuery, parseRequest } from "@/server/analytics/explorer-query";

const dialect = new PgDialect();
const TABLES = new Map<string, Set<string>>();
for (const v of Object.values(schema)) if (v instanceof PgTable) { const c = getTableConfig(v); TABLES.set(c.name, new Set(c.columns.map((x) => x.name))); }
const render = (q: SQL) => dialect.sqlToQuery(q).sql;
const ID = "0b8f3d3e-7b53-4c36-9f0c-6a8f0d2a7a11";
const F = parseFilters({ company: ID, driver: ID, office: ID, city: "riyadh", service: "delivery_driver", vehicle: "sedan", status: "completed", channel: "web" });

/** `a.b` references whose `a` is a real table (or an alias of one in the same statement) must name a real column. Aliases of CTEs and sub-selects are skipped. */
function check(sqlText: string): string[] {
  const alias = new Map<string, Set<string>>();
  for (const m of sqlText.matchAll(/\b(?:from|join)\s+"?([a-z_]+)"?(?:\s+(?:as\s+)?(?!on\b|where\b|left\b|join\b|inner\b|group\b|order\b|limit\b|union\b|using\b|cross\b|full\b|right\b|lateral\b)([a-z_][a-z0-9_]*))?/gi)) {
    const table = m[1];
    if (!TABLES.has(table)) continue;
    for (const a of [table, m[2]].filter(Boolean) as string[]) { (alias.get(a) ?? alias.set(a, new Set()).get(a)!).add(table); }
  }
  const bad: string[] = [];
  for (const m of sqlText.matchAll(/(?<![\w."])"?([a-z_][a-z0-9_]*)"?\."?([a-z_][a-z0-9_]*)"?(?![\w(])/gi)) {
    const [, a, col] = m;
    const tables = alias.get(a);
    if (!tables) continue;
    if (![...tables].some((t) => TABLES.get(t)!.has(col))) bad.push(`${a}.${col} (${[...tables].join("|")})`);
  }
  return [...new Set(bad)];
}
const admin = { id: ID, role: "admin", permissions: [] } as unknown as User;
beforeEach(() => { captured.length = 0; });

describe("the schema probe itself", () => {
  it("knows the tables and flags a wrong column", () => {
    expect(TABLES.has("tickets") && TABLES.has("ticket_replies") && TABLES.has("login_events")).toBe(true);
    expect(check("select tickets.ref, tickets.nope from tickets")).toEqual(["tickets.nope (tickets)"]);
    expect(check("select a.id, a.nope from complaints a join users u on u.id = a.filed_by where u.nope = 1")).toEqual(["a.nope (complaints)", "u.nope (users)"]);
    expect(check("with t as (select tickets.id from tickets) select t.whatever from t")).toEqual([]);
  });
});

describe("Support report SQL", () => {
  it("facts, series, groups use only real tables and columns, for money and non-money viewers and with every filter set", async () => {
    for (const money of [true, false]) {
      await supportFacts(F, money); await agingAlerts(F);
      await Promise.all([ticketsSeries(F), complaintsSeries(F), ratingsSeries(F), qualitySeries(F), ticketBreakdowns(F), complaintBreakdowns(F), ticketHeatmap(F), workload(F), repeatRequesters(F), companiesPerOrder(F), driversPerOrder(F), lowestRated(F)]);
    }
    expect(captured.length).toBeGreaterThan(30);
    const bad = captured.flatMap((q) => check(render(q)));
    expect(bad).toEqual([]);
  });
  it("drill-down tables too, for every sort key", async () => {
    const tables = listTables("support");
    expect(tables.map((t) => t.name).sort()).toEqual(["complaints", "complaints-holding", "complaints-open", "low-ratings", "ratings", "tickets", "tickets-at-risk", "tickets-breached", "tickets-open", "tickets-reopened", "tickets-urgent"]);
    for (const def of tables) for (const key of Object.keys(def.sorts)) {
      await def.query({ filters: F, user: admin, limit: 25, offset: 0, order: def.sorts[key], sort: { key, dir: "asc" } });
    }
    expect(captured.length).toBeGreaterThan(40);
    expect(captured.flatMap((q) => check(render(q)))).toEqual([]);
    expect(getTable("support", "tickets")!.columns.every((c) => !c.sub || def(c.sub))).toBe(true);
    function def(_: string) { return true; }
  });
});

describe("Data explorer SQL", () => {
  it("every dataset: page (all columns, every shared filter, search), count and group queries name only real tables and columns", async () => {
    for (const ds of allDatasets()) {
      const cols = ds.columns.map((c) => c.key).join(",");
      const p = await parseRequest(admin, ds, new URLSearchParams(`cols=${cols}&q=abc&city=riyadh&service=delivery_driver&vehicle=sedan&status=completed&channel=web&company=${ID}&driver=${ID}&office=${ID}`), { graceMin: 30 });
      const queries = [pageQuery(p, 25, 0), countQuery(p, 100000)];
      for (const c of ds.columns.filter((x) => x.type === "enum" || x.type === "status" || x.type === "bool" || x.type === "datetime" || x.type === "date")) {
        const num = ds.columns.filter((x) => x.type === "number" || x.type === "money" || x.type === "duration").slice(0, 2).map((x) => `sum:${x.key},p50:${x.key}`).join(",");
        queries.push(groupQuery(await parseRequest(admin, ds, new URLSearchParams(`group=${c.key}${num ? `&agg=${num}` : ""}`), { graceMin: 30 })));
      }
      for (const f of ds.filters) {
        const val = f.kind === "enum" ? (f.values?.[0] ?? "x") : f.kind === "flag" ? "yes" : f.kind === "num" ? "1..2" : f.kind === "date" ? "2026-01-01..2026-01-31" : "abc";
        queries.push(pageQuery(await parseRequest(admin, ds, new URLSearchParams(`f.${f.key}=${val}`), { graceMin: 30 }), 10, 0));
      }
      for (const q of queries) expect(check(render(q)), ds.key).toEqual([]);
    }
  });
});
