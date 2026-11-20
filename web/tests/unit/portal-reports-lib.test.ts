/** Client-side mapping of the portal reports, and the translations (rpr.*): every key the screens, tables and KPIs can ask for exists in en, ar and ur. */
import { describe, it, expect, vi } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
vi.mock("@/db", () => ({ db: {} }));
vi.mock("@/server/settings", () => ({ getSettings: async () => ({ lateGraceMin: 15, cities: [] }) }));
vi.mock("@/server/office", () => ({ officeReport: async () => ({}) }));
import en from "@/i18n/en";
import ar from "@/i18n/ar";
import ur from "@/i18n/ur";
import { duplicateKeys } from "@/i18n/fragments";
import { translate } from "@/i18n/core";
import { allKpiDefs, kpiConflicts } from "@/server/analytics/definitions";
import { BUSINESS_KPI_KEYS, OFFICE_KPI_KEYS } from "@/server/analytics/portal-definitions";
import { FLAGS } from "@/server/analytics/portal-calc";
import { listPortalTables } from "@/server/analytics/portal-registry";
import "@/server/analytics/portal-tables-business";
import "@/server/analytics/portal-tables-office";
import { cityFailureRows, countBuckets, topRows, durationBuckets, funnelOf, groupRows, groupSlices, histBuckets, insightText, percentBuckets, ratingBuckets, reasonLabel, reasonRows, reasonSlices } from "@/components/reports/portal/lib";
import { histogram } from "@/server/analytics/stats";

const t = (k: string, v?: Record<string, string | number>) => translate(en, en, k, v);
const walk = (d: string): string[] => readdirSync(d).flatMap((f) => { const p = join(d, f); return statSync(p).isDirectory() ? walk(p) : /\.tsx?$/.test(p) ? [p] : []; });
const placeholders = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(",");
const mine = [...walk("src/components/reports/portal"), ...walk("src/server/analytics").filter((f) => /portal/.test(f)), "src/server/api/routes/portal-analytics.ts", ...walk("src/app/(app)/business/reports"), ...walk("src/app/(app)/office/reports")];
const keys = Object.keys(en).filter((k) => k.startsWith("rpr."));

describe("rpr.* translations", () => {
  it("every key has a real Arabic and Urdu text with the same placeholders", () => {
    expect(keys.length).toBeGreaterThan(300);
    for (const k of keys) {
      expect(ar[k]?.trim(), `ar ${k}`).toBeTruthy(); expect(ur[k]?.trim(), `ur ${k}`).toBeTruthy();
      expect(placeholders(ar[k]), `ar placeholders ${k}`).toBe(placeholders(en[k])); expect(placeholders(ur[k]), `ur placeholders ${k}`).toBe(placeholders(en[k]));
      if (!/^[A-Z%]+( %)?$/.test(en[k])) { expect(ar[k], `ar ${k} is an English copy`).not.toBe(en[k]); expect(ur[k], `ur ${k} is an English copy`).not.toBe(en[k]); }
    }
  });
  it("no key is defined twice across the fragments", () => { expect(duplicateKeys().filter((k) => k.startsWith("rpr."))).toEqual([]); });
  it("every literal key the portal screens, pages and server code use exists", () => {
    const used = new Set<string>();
    for (const f of mine) for (const m of readFileSync(f, "utf8").matchAll(/["'`](rpr\.[a-z0-9_.]*[a-z0-9])["'`]/g)) used.add(m[1]);
    expect(used.size).toBeGreaterThan(150);
    expect([...used].filter((k) => k !== "rpr.proof" /* a namespace, checked below */ && (!(k in en) || !(k in ar) || !(k in ur))).sort()).toEqual([]);
  });
  it("keys built at run time", () => {
    const need: string[] = [
      ...["otp", "receipt", "none"].map((p) => `rpr.proof.${p}`), ...["service", "vehicle", "city"].map((d) => `rpr.by_${d}`), "rpr.other", ...["queued", "sent", "delivered", "failed"].map((s) => `rpr.sms_${s}`), ...[...FLAGS, "idle"].map((f) => `rpr.flag_${f}`),
      ...["available", "reserved", "held", "limit"].map((k) => `rpr.wallet_${k}`), ...["available", "held", "pending"].map((k) => `rpr.office_wallet_${k}`),
      ...["offered", "accepted", "arrived", "delivered", "completed"].map((s) => `rpr.of_${s}`), ...["created", "approved", "paid"].map((s) => `rpr.pl_${s}`),
      ...["completed", "active", "cancelled", "no_show", "replaced"].filter((s) => s !== "active").map((s) => `jobstatus.${s}`), "rpf.s_active",
      ...["paid", "approved", "pending", "failed", "rejected"].map((s) => `office.money_${s}`), ...["pending", "approved", "paid", "rejected"].map((s) => `status.${s}`),
      ...["pending_review", "reviewed", "approved", "batch_ready", "paid", "failed", "rejected"].filter((s) => s !== "batch_ready").map((s) => `settle.${s}`),
      ...["topup", "reserve", "release_reserve", "charge", "refund", "adjustment", "payout", "withdrawal_hold", "withdrawal_paid", "withdrawal_release"].map((k) => `ledger.${k}`),
      ...["pending", "loaded", "delivered", "failed", "returned", "missing", "cancelled"].map((s) => `shipstatus.${s}`), "rpf.hist_lt", "rpf.hist_gte", "rpf.hist_range", "rpf.bd_billed", "rpf.fn_published", "rpf.sec_insights", "nav.reports", "nav.rep_overview", "nav.rep_deliveries", "nav.rep_spending", "nav.rep_drivers", "nav.rep_earnings",
      ...["published", "accepted", "filled", "started", "completed"].map((s) => `rpf.fn_${s}`), ...["web", "api", "mobile"].map((c) => `rpf.ch_${c}`),
    ];
    expect(need.filter((k) => !(k in en) || !(k in ar) || !(k in ur))).toEqual([]);
  });
});

describe("portal KPI definitions", () => {
  const defs = allKpiDefs().filter((d) => d.label.startsWith("rpr."));
  it("registers every portal KPI once, with a label, a definition and — for every ratio — what is counted and out of what", () => {
    expect(kpiConflicts()).toEqual([]);
    expect(defs.map((d) => d.key).sort()).toEqual([...BUSINESS_KPI_KEYS, ...OFFICE_KPI_KEYS].sort());
    expect(defs.length).toBe(42);
    for (const d of defs) {
      for (const k of [d.label, d.definition, d.numerator, d.denominator].filter(Boolean) as string[]) { expect(en[k], `en ${k}`).toBeTruthy(); expect(ar[k], `ar ${k}`).toBeTruthy(); expect(ur[k], `ur ${k}`).toBeTruthy(); }
      if (d.unit === "percent") { expect(d.numerator, d.key).toBeTruthy(); expect(d.denominator, d.key).toBeTruthy(); }
      expect(d.money === true, `${d.key} must not be a staff-only money KPI: owners see their own money`).toBe(false);
    }
  });
  it("the reused admin KPIs exist", () => {
    const keys = allKpiDefs().map((d) => d.key);
    for (const k of ["parcels_delivered", "delivery_success", "first_attempt", "on_time_start", "time_to_fill", "cancellation_rate", "requests_completed", "active_drivers"]) expect(keys).toContain(k);
  });
});

describe("drill-down tables", () => {
  it("every column and title has a translation and every enum namespace resolves", () => {
    for (const tb of listPortalTables()) {
      expect(en[tb.title], tb.title).toBeTruthy();
      expect(tb.columns.length).toBeGreaterThan(3);
      for (const c of tb.columns) {
        expect(en[c.label] && ar[c.label] && ur[c.label], `${tb.portal}/${tb.name}.${c.key} ${c.label}`).toBeTruthy();
        if (c.type === "link") expect(c.href, c.key).toMatch(/^\/(business|office)\//);
      }
      expect(Object.keys(tb.sorts)).toContain(tb.defaultSort.key);
      for (const c of tb.columns.filter((x) => x.type === "enum" && x.ns === "rpr.proof")) expect(en[`${c.ns}.otp`]).toBeTruthy();
    }
  });
  it("no table exposes the platform margin, the provider cost or (for offices) a customer name", () => {
    const text = readFileSync("src/server/analytics/portal-tables-business.ts", "utf8") + readFileSync("src/server/analytics/portal-company-money.ts", "utf8") + readFileSync("src/server/analytics/portal-company-reports.ts", "utf8") + readFileSync("src/server/analytics/portal-company.ts", "utf8") + readFileSync("src/server/analytics/portal-company-deliveries.ts", "utf8");
    expect(text).not.toMatch(/margin_cents|provider_cents|recipient_phone|recipient_name|\.address/);
    const office = readFileSync("src/server/analytics/portal-tables-office.ts", "utf8") + readFileSync("src/server/analytics/portal-office-facts.ts", "utf8") + readFileSync("src/server/analytics/portal-office-drivers.ts", "utf8") + readFileSync("src/server/analytics/portal-office.ts", "utf8") + readFileSync("src/server/analytics/portal-office-reports.ts", "utf8");
    expect(office).not.toMatch(/customer_cents|margin_cents|recipient_phone|recipient_name|company_name|business_profiles|requests\.total_cents/);
    expect(office).not.toMatch(/business_id\s+as|requests\.business_id\s*,/); // the id only ever goes through the anonymising hash
  });
});

describe("mapping to components", () => {
  const city = (k: string) => (k === "custom_town" ? "Custom Town" : undefined);
  it("groups rows into labelled bars with the comparison and a sub-line, and companies stay anonymous", () => {
    const rows = [{ key: "riyadh", requests: 10, prevRequests: 8, spend: 5000, prevSpend: null, share: 0.5 }, { key: "custom_town", requests: 2, prevRequests: null, share: 0.1 }, { key: "", requests: 1, share: 0.05 }];
    const bars = groupRows(rows, "city", "requests", t, city, (r) => (r.spend ? `${r.spend} billed` : undefined));
    expect(bars.map((b) => b.label)).toEqual(["Riyadh", "Custom Town", "Not specified"]);
    expect(bars[0]).toMatchObject({ value: 10, prev: 8, share: 0.5, sub: "5000 billed" }); expect(bars[2].key).toBe("—");
    expect(groupRows([{ key: "C-3F9A", jobs: 4, share: 1 }], "company", "jobs", t)[0].label).toBe("Company C-3F9A");
    expect(groupSlices(rows, "city", "spend", t, city).map((s) => s.value)).toEqual([5000, 0, 0]);
    expect(groupRows([{ key: "delivery_driver", earned: 900, prevEarned: 700, share: null }], "service", "earned", t)[0]).toMatchObject({ label: "Delivery driver", value: 900, prev: 700 });
  });
  it("failure reasons use the stop-failure dictionary and fall back to the raw text", () => {
    expect(reasonLabel("unreachable", t)).toBe("Recipient not answering"); expect(reasonLabel("something_new", t)).toBe("something_new");
    const rows = reasonRows([{ key: "refused", count: 3, prev: 1 }, { key: "other", count: 1, prev: null }], t);
    expect(rows[0]).toMatchObject({ value: 3, prev: 1, share: 0.75 }); expect(reasonSlices([{ key: "refused", count: 3 }], t)[0].label).toBe("Recipient refused the parcel");
    expect(reasonRows([], t)).toEqual([]);
  });
  it("ranks cities by failure rate, puts the thin ones last and marks them", () => {
    const r = cityFailureRows([
      { key: "riyadh", resolved: 100, failed: 5, prevResolved: 80, prevFailed: 8 }, { key: "jeddah", resolved: 40, failed: 12, prevResolved: 30, prevFailed: 3 },
      { key: "abha", resolved: 3, failed: 3, prevResolved: null, prevFailed: null }, { key: "custom_town", resolved: 0, failed: 0, prevResolved: null, prevFailed: null },
    ], t, city);
    expect(r.map((x) => x.key)).toEqual(["jeddah", "riyadh", "abha"]); // the empty city is dropped, 3 parcels is not ranked
    expect(r[0]).toMatchObject({ value: 0.3, prev: 0.1, sub: "Failed 12 of 40 parcels" }); expect(r[2]).toMatchObject({ value: 1, sub: "Too few to rank (parcels: 3)", tone: "gold" });
  });
  it("labels histogram buckets from their edges", () => {
    const h = histogram([10, 40, 80, 300], [30, 60]);
    expect(histBuckets(h, (n) => `${n}s`, t).map((b) => b.label)).toEqual(["Under 30s", "30s – 60s", "60s or more"]);
    expect(durationBuckets(histogram([100], [60, 3600]), t, "en").map((b) => b.label)).toEqual(["Under 1 min", "1 min – 1 h", "1 h or more"]);
    expect(percentBuckets(histogram([0.4, 0.9], [0.5, 0.85]), t, "en").map((b) => b.label)[1]).toBe("50% – 85%");
    expect(ratingBuckets(histogram([4.7], [4, 4.5]), t, "en")[2]).toMatchObject({ count: 1, label: "4.5 or more" });
  });
  it("ranked lists keep the ten biggest rows and drop the empty ones", () => {
    const rows = Array.from({ length: 14 }, (_, i) => ({ key: `r${i}`, label: `r${i}`, value: i === 3 ? 0 : i + 1 }));
    const top = topRows(rows);
    expect(top).toHaveLength(10); expect(top[0].key).toBe("r13"); expect(top.map((r) => r.value)).toEqual([14, 13, 12, 11, 10, 9, 8, 7, 6, 5]);
    expect(topRows([{ key: "a", label: "a", value: null }, { key: "b", label: "b", value: 0 }])).toEqual([]);
  });
  it("whole-number buckets read as inclusive ranges", () => {
    const h = histogram([0, 1, 2, 4, 5, 12, 30], [1, 2, 5, 10, 20]);
    expect(countBuckets(h, t, "en").map((b) => [b.label, b.count])).toEqual([["0", 1], ["1", 1], ["2–4", 2], ["5–9", 1], ["10–19", 1], ["20 or more", 1]]);
  });
  it("funnels use the page's own step names", () => {
    expect(funnelOf([{ key: "created", count: 5 }, { key: "paid", count: 2 }], "rpr.pl_", t)).toEqual([{ key: "created", label: "Created", count: 5 }, { key: "paid", label: "Paid", count: 2 }]);
  });
  it("insight sentences format amounts as money and name cities in the viewer's language", () => {
    const text = insightText({ key: "rpr.ins_cod_outstanding", tone: "info", vars: { amount: 12_345 }, money: ["amount"] }, t, "en");
    expect(text).toMatch(/123\.45/); expect(text).toContain("still with drivers");
    expect(insightText({ key: "rpr.ins_city_fail_up", tone: "bad", refs: { city: "city.riyadh" }, vars: { now: 30, before: 10 } }, t, "en")).toBe("Failed deliveries rose in Riyadh: 30% of parcels failed, up from 10%.");
    expect(insightText({ key: "rpr.ins_city_fail_up", tone: "bad", refs: { city: "city.custom_town" }, vars: { now: 30, before: 10 } }, t, "en", city)).toContain("Custom Town");
    expect(insightText({ key: "rpf.ins_swing_up", tone: "info", refs: { kpi: "rpr.kpi_biz_spend" }, vars: { n: 50 } }, t, "en")).toBe("Spending is up 50% on the comparison period.");
    expect(insightText({ key: "rpr.ins_top_reason", tone: "info", refs: { reason: "stopfail.unreachable" }, vars: { n: 75 } }, t, "ar")).not.toContain("{");
  });
});
