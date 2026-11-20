import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { PgDialect } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import en from "@/i18n/en";
import ar from "@/i18n/ar";
import ur from "@/i18n/ur";
import { allKpiDefs, kpiConflicts, kpiDef } from "@/server/analytics/definitions";
import { visibleKpis } from "@/server/analytics/kpi";
import { parseFilters } from "@/server/analytics/filters";
import { SUPPORT_GROUPS, supportKpis, type SupportFacts } from "@/server/analytics/support-kpis";
import { complaintScope, slaSql, FRT } from "@/server/analytics/support-sql";
import { kpisOf, KPI_GROUPS, agingBuckets, categoryLabel, groupRows, ratingTrend, roleHref, starBuckets, volumeSeries, groupLabel } from "@/components/reports/support/support-lib";

const P = (cur: number | null, prev: number | null = null) => ({ cur, prev });
const facts = (o: Partial<SupportFacts> = {}): SupportFacts => ({
  tickets: { opened: P(40, 20), resolved: P(30, 15), urgent: P(8, 2), reopened: P(3, 1), everResolved: P(30, 10), frP50: P(1800, 3600), frP90: P(10_000, null), resP50: P(7200, 10_800), resP90: P(100_000, null), respDue: P(38, 18), respMet: P(30, 9), resDue: P(35, 15), resMet: P(28, 12), breaches: P(9, 4) },
  backlog: P(12, 8), unassigned: 3, complaints: { filed: P(6, 3), resolved: P(4, 3), open: P(5, 2) }, orders: P(400, 250),
  ratings: { n: P(20, 10), sum: P(80, 30), low: P(4, 1), jobs: P(50, 40), rated: P(45, 32) }, held: { n: 2, cents: 150_00 }, ...o,
});
const kpi = (ks: ReturnType<typeof supportKpis>, key: string) => ks.find((k) => k.key === key)!;

describe("supportKpis", () => {
  const ks = supportKpis(facts(), {});
  it("builds every KPI of every group from the facts", () => {
    expect(ks.map((k) => k.key).sort()).toEqual(Object.values(SUPPORT_GROUPS).flat().sort());
    expect(kpi(ks, "sup_tickets_opened")).toMatchObject({ value: 40, prev: 20, delta: 20, deltaPct: 1 });
    expect(kpi(ks, "sup_tickets_per_100").value).toBeCloseTo(10, 6);
    expect(kpi(ks, "sup_tickets_per_100").prev).toBeCloseTo(8, 6);
    expect(kpi(ks, "sup_urgent_share").value).toBeCloseTo(0.2, 6);
    expect(kpi(ks, "sup_reopen_rate").value).toBeCloseTo(0.1, 6);
    expect(kpi(ks, "sup_sla_response").value).toBeCloseTo(30 / 38, 6);
    expect(kpi(ks, "sup_sla_resolution").value).toBeCloseTo(0.8, 6);
    expect(kpi(ks, "sup_rating_avg").value).toBe(4); expect(kpi(ks, "sup_rating_avg").prev).toBe(3);
    expect(kpi(ks, "sup_rating_low_share").value).toBeCloseTo(0.2, 6);
    expect(kpi(ks, "sup_rating_response").value).toBeCloseTo(45 / 100, 6);
    expect(kpi(ks, "sup_first_response_p50")).toMatchObject({ value: 1800, prev: 3600, delta: -1800 });
    expect(kpi(ks, "sup_backlog")).toMatchObject({ value: 12, prev: 8 });
  });
  it("right-now figures have no previous value", () => {
    expect(kpi(ks, "sup_unassigned")).toMatchObject({ value: 3, prev: null, delta: null });
    expect(kpi(ks, "sup_held_complaints")).toMatchObject({ value: 2, prev: null });
    expect(kpi(ks, "sup_held_amount")).toMatchObject({ value: 15_000, unit: "money" });
  });
  it("no data is null, never 0: ratios without a denominator, percentiles without tickets, no orders", () => {
    const e = supportKpis(facts({
      tickets: { opened: P(0, 0), resolved: P(0, 0), urgent: P(0, 0), reopened: P(0, 0), everResolved: P(0, 0), frP50: P(null, null), frP90: P(null, null), resP50: P(null, null), resP90: P(null, null), respDue: P(0, 0), respMet: P(0, 0), resDue: P(0, 0), resMet: P(0, 0), breaches: P(0, 0) },
      orders: P(0, 0), ratings: { n: P(0, 0), sum: P(0, 0), low: P(0, 0), jobs: P(0, 0), rated: P(0, 0) }, unassigned: 0, held: { n: 0, cents: 0 },
    }), {});
    for (const key of ["sup_tickets_per_100", "sup_urgent_share", "sup_reopen_rate", "sup_sla_response", "sup_sla_resolution", "sup_first_response_p50", "sup_resolution_p90", "sup_rating_avg", "sup_rating_low_share", "sup_rating_response"]) expect(kpi(e, key).value, key).toBeNull();
    expect(kpi(e, "sup_tickets_opened").value).toBe(0);
    expect(kpi(e, "sup_held_amount").value).toBe(0);
  });
  it("the settlement amount on hold is left out without finance access", () => {
    const noMoney = supportKpis(facts({ held: { n: 2, cents: null } }), {}, false);
    expect(noMoney.some((k) => k.key === "sup_held_amount")).toBe(false);
    expect(visibleKpis(supportKpis(facts(), {}), false).some((k) => k.key === "sup_held_amount")).toBe(false);
    expect(visibleKpis(supportKpis(facts(), {}), true).some((k) => k.key === "sup_held_amount")).toBe(true);
  });
  it("carries sparklines and a good / bad direction per KPI", () => {
    const withSpark = supportKpis(facts(), { sup_tickets_opened: [1, 2, 3] });
    expect(kpi(withSpark, "sup_tickets_opened").spark).toEqual([1, 2, 3]);
    expect(kpi(ks, "sup_tickets_opened").good).toBe("lower"); expect(kpi(ks, "sup_sla_response").good).toBe("higher"); expect(kpi(ks, "sup_first_response_p50").good).toBe("lower");
  });
});

describe("the KPI definitions", () => {
  const mine = allKpiDefs().filter((d) => d.key.startsWith("sup_"));
  it("are registered once, without clashes with the other reports", () => { expect(mine).toHaveLength(23); expect(kpiConflicts()).toEqual([]); });
  it("every label, definition, numerator and denominator exists in en, ar and ur", () => {
    for (const d of mine) for (const k of [d.label, d.definition, d.numerator, d.denominator].filter(Boolean) as string[]) { expect(en[k], `en ${k}`).toBeTruthy(); expect(ar[k], `ar ${k}`).toBeTruthy(); expect(ur[k], `ur ${k}`).toBeTruthy(); }
  });
  it("every percentage, rate and average says what it divides", () => {
    for (const d of mine.filter((x) => x.unit === "percent" || x.unit === "rate")) { expect(d.numerator, d.key).toBeTruthy(); expect(d.denominator, d.key).toBeTruthy(); }
    expect(kpiDef("sup_held_amount").money).toBe(true);
  });
});

describe("support SQL", () => {
  const dialect = new PgDialect();
  const render = (q: ReturnType<typeof sql>) => dialect.sqlToQuery(q);
  const ID = "0b8f3d3e-7b53-4c36-9f0c-6a8f0d2a7a11";
  it("complaints match who filed OR who the complaint is about, and never put values in the text", () => {
    const f = parseFilters({ company: ID, driver: ID, office: ID, city: "riyadh" });
    const q = render(complaintScope(f));
    expect(q.sql).toContain("complaints.filed_by in ($");
    expect(q.sql).toContain("requests.business_id in");
    expect(q.sql).toContain("offers.driver_id in"); expect(q.sql).toContain("offers.office_id in");
    expect(q.sql).not.toContain(ID); expect(q.params).toContain(ID); expect(q.params).toContain("riyadh");
    expect(render(complaintScope(parseFilters({}))).sql).toBe("true");
  });
  it("the SLA tests use the constants (14400 s and 172800 s) and the first staff reply fallback", () => {
    const s = slaSql({ created: sql`t.created_at`, frt: sql`t.frt`, resolved: sql`t.resolved_at` });
    const q = render(sql`${s.breached} ${s.atRisk}`);
    expect(q.params).toEqual(expect.arrayContaining([14400, 172800, 10800, 129600]));
    expect(q.sql).toContain("make_interval(secs =>");
    expect(render(FRT).sql).toMatch(/coalesce\(tickets\.first_response_at, \(select min\(r\.created_at\) from ticket_replies r where r\.ticket_id = tickets\.id and not r\.internal and r\.author_role in \('staff','admin'\)\)\)/);
  });
});

describe("support-lib (props of the components)", () => {
  const t = (k: string, v?: Record<string, string | number>) => (en[k] ?? k).replace(/\{(\w+)\}/g, (_, n) => String(v?.[n] ?? `{${n}}`));
  it("groups the KPIs in the order of their group", () => {
    const ks = supportKpis(facts(), {});
    expect(KPI_GROUPS).toEqual(["tickets", "speed", "complaints", "ratings"]);
    expect(kpisOf(ks, "speed").map((k) => k.key)).toEqual(SUPPORT_GROUPS.speed);
    expect(kpisOf(supportKpis(facts({ held: { n: 1, cents: null } }), {}, false), "complaints").map((k) => k.key)).not.toContain("sup_held_amount");
  });
  it("labels categories, folds the rest, and falls back to the raw key", () => {
    expect(categoryLabel("payment_issue", t)).toBe("Payment issue"); expect(categoryLabel("_other", t)).toBe("Other categories"); expect(groupLabel("rpq.pri", "urgent", t)).toBe("Urgent");
    expect(groupLabel("rpq.pri", "", t)).toBe("Not specified"); expect(groupLabel("ticket_cat", "brand_new", t)).toBe("brand_new");
    const s = volumeSeries(["payment_issue", "_other"], t);
    expect(s.map((x) => x.key)).toEqual(["payment_issue", "_other"]); expect(s[1].color).toBe("var(--jr-muted)"); expect(s[0].color).toMatch(/^var\(--rpf-c\d\)$/);
  });
  it("turns group rows into bar rows with their share and previous value", () => {
    expect(groupRows([{ key: "urgent", value: 3, prev: 1, share: 0.75 }], "rpq.pri", t)).toEqual([{ key: "urgent", label: "Urgent", value: 3, prev: 1, share: 0.75 }]);
  });
  it("labels the five aging buckets 0–1, 2–3, 4–7, 8–14 and 15+ days, and the five star columns", () => {
    const h = [0, 1, 2, 3, 4].map((i) => ({ from: null, to: null, count: i }));
    expect(agingBuckets(h, t).map((b) => b.label)).toEqual(["0–1 d", "2–3 d", "4–7 d", "8–14 d", "15+ d"]);
    expect(agingBuckets(h, t).map((b) => b.count)).toEqual([0, 1, 2, 3, 4]);
    expect(starBuckets([1, 0, 0, 2, 5], t).map((b) => b.label)).toEqual(["1 ★", "2 ★", "3 ★", "4 ★", "5 ★"]);
  });
  it("an average rating per bucket is a gap, not 0, where nothing was rated", () => {
    expect(ratingTrend([{ t: "a", n: 2, stars: 9 }, { t: "b", n: 0, stars: 0 }])).toEqual([{ t: "a", avg: 4.5, n: 2 }, { t: "b", avg: null, n: 0 }]);
  });
  it("links people to their detail page by role", () => {
    expect(roleHref("business", "x")).toBe("/admin/companies/x"); expect(roleHref("driver", "x")).toBe("/admin/drivers/x"); expect(roleHref("office", "x")).toBe("/admin/offices/x"); expect(roleHref("staff", "x")).toBeUndefined();
  });
});

describe("every literal rpq.* key the Support UI can ask for exists in en, ar and ur", () => {
  const walk = (d: string): string[] => readdirSync(d).flatMap((f) => { const p = join(d, f); return statSync(p).isDirectory() ? walk(p) : /\.tsx?$/.test(p) ? [p] : []; });
  const files = [...walk("src/components/reports/support"), ...walk("src/components/reports/explorer"), ...walk("src/server/analytics").filter((f) => /\/(support|explorer)[^/]*\.ts$/.test(f)), "src/app/(app)/admin/reports/support/page.tsx", "src/app/(app)/admin/reports/explorer/page.tsx"];
  it("literal keys", () => {
    const used = new Set<string>();
    for (const f of files) for (const m of readFileSync(f, "utf8").matchAll(/["'`](rpq\.[a-z0-9_.-]*[a-z0-9])["'`]/g)) used.add(m[1]);
    expect(used.size).toBeGreaterThan(100);
    // a dictionary namespace (`rpq.pri`, used as `ns: "rpq.pri"`) is not a key itself: it must have keys under it
    const isNamespace = (k: string) => Object.keys(en).some((x) => x.startsWith(`${k}.`));
    expect([...used].filter((k) => !isNamespace(k) && (!(k in en) || !(k in ar) || !(k in ur))).sort()).toEqual([]);
    for (const ns of [...used].filter(isNamespace)) expect(Object.keys(ar).filter((x) => x.startsWith(`${ns}.`)).length, ns).toBe(Object.keys(en).filter((x) => x.startsWith(`${ns}.`)).length);
  });
  it("keys built at run time", () => {
    const need = [
      ...KPI_GROUPS.map((g) => `rpq.grp_${g}`), ...["normal", "urgent"].map((p) => `rpq.pri.${p}`), ...["breached", "at_risk", "ok", "pending"].map((s) => `rpq.sla.${s}`), ...["yes", "no"].map((s) => `rpq.yn.${s}`),
      ...["sum", "avg", "min", "max", "p50", "p90"].map((f) => `rpq.fn_${f}`), ...["operations", "finance", "people", "support", "system"].map((g) => `rpq.dg_${g}`),
      "rpq.view_all", "rpq.view_open", "rpq.view_breached", "rpq.view_at_risk", "rpq.view_urgent", "rpq.view_reopened", "rpq.view_holding", "rpq.view_low",
      ...["tickets", "tickets_open", "tickets_breached", "tickets_at_risk", "tickets_urgent", "tickets_reopened", "complaints", "complaints_open", "complaints_holding", "low_ratings", "ratings"].map((n) => `rpq.tbl_${n}`),
      ...["day", "week", "month"].map((b) => `rpf.b_${b}`), ...["business", "driver", "office"].map((r) => `role.${r}`),
    ];
    expect(need.filter((k) => !(k in en) || !(k in ar) || !(k in ur))).toEqual([]);
  });
});
