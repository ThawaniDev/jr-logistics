/**
 * Translations of the people reports (prefix `rpp.`): every key the code can ask for exists in English, Arabic and Urdu with the same placeholders, the fragments do not
 * overlap, nothing is left in English, and every registered KPI and drill-down table is fully labelled.
 */
import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import en from "@/i18n/en";
import ar from "@/i18n/ar";
import ur from "@/i18n/ur";
import * as cmp from "@/i18n/fragments/rd-reports-p-cmp";
import * as drv from "@/i18n/fragments/rd-reports-p-drv";
import * as off from "@/i18n/fragments/rd-reports-p-off";
import * as gro from "@/i18n/fragments/rd-reports-p-gro";
import * as tbl from "@/i18n/fragments/rd-reports-p-tbl";
import { allKpiDefs } from "@/server/analytics/definitions";
import { listTables } from "@/server/analytics/registry";
import "@/server/analytics/companies-kpis"; import "@/server/analytics/drivers-kpis"; import "@/server/analytics/offices-kpis"; import "@/server/analytics/growth-kpis";
import "@/server/analytics/companies-tables"; import "@/server/analytics/drivers-tables"; import "@/server/analytics/offices-tables"; import "@/server/analytics/growth-tables";
import { FLAG_ORDER } from "@/server/analytics/drivers-lib";
import { STALLED_REASONS } from "@/server/analytics/growth-lib";

const walk = (d: string): string[] => readdirSync(d).flatMap((f) => { const p = join(d, f); return statSync(p).isDirectory() ? walk(p) : /\.tsx?$/.test(p) ? [p] : []; });
const placeholders = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(",");
const parts = { cmp, drv, off, gro, tbl };
const mine = (d: Record<string, string>) => Object.keys(d).filter((k) => k.startsWith("rpp."));

describe("rpp fragments", () => {
  it("every key starts with rpp., exists in all three languages, and no key is defined in two fragments", () => {
    const seen = new Map<string, string>();
    for (const [name, p] of Object.entries(parts)) {
      expect(Object.keys(p.ar).sort(), `${name} ar keys`).toEqual(Object.keys(p.en).sort()); expect(Object.keys(p.ur).sort(), `${name} ur keys`).toEqual(Object.keys(p.en).sort());
      for (const k of Object.keys(p.en)) { expect(k.startsWith("rpp."), k).toBe(true); expect(seen.has(k), `${k} is in ${seen.get(k)} and ${name}`).toBe(false); seen.set(k, name); }
    }
    expect(seen.size).toBeGreaterThan(450);
    for (const k of seen.keys()) { expect(en[k], k).toBeTruthy(); expect(ar[k], `ar ${k}`).toBeTruthy(); expect(ur[k], `ur ${k}`).toBeTruthy(); }
  });
  it("placeholders match across languages and nothing is empty", () => {
    for (const k of mine(en)) { for (const d of [ar, ur]) { expect(d[k]?.trim(), k).toBeTruthy(); expect(placeholders(d[k]), `placeholders of ${k}`).toBe(placeholders(en[k])); } }
  });
  it("Arabic and Urdu are translated, not copies of the English text", () => {
    const same = { ar: [] as string[], ur: [] as string[] };
    for (const k of mine(en)) { if (!/[A-Za-z]{3}/.test(en[k].replace(/\{\w+\}/g, ""))) continue; if (ar[k] === en[k]) same.ar.push(k); if (ur[k] === en[k]) same.ur.push(k); }
    expect(same.ar).toEqual([]); expect(same.ur.filter((k) => !["rpp.src.api", "rpp.client.api"].includes(k))).toEqual([]);
  });
  it("Arabic and Urdu use their own script", () => {
    for (const k of mine(en)) { if (!/[A-Za-z]{4}/.test(en[k].replace(/\{\w+\}/g, ""))) continue; expect(/[؀-ۿ]/.test(ar[k]), `ar ${k}`).toBe(true); expect(/[؀-ۿ]/.test(ur[k]), `ur ${k}`).toBe(true); }
  });
});

describe("keys used by the code exist", () => {
  const files = [
    ...walk("src/components/reports/people"), ...readdirSync("src/server/analytics").filter((f) => /^(companies|drivers|offices|growth)/.test(f)).map((f) => join("src/server/analytics", f)),
    ...["companies", "drivers", "offices", "growth"].map((r) => `src/app/(app)/admin/reports/${r}/page.tsx`),
  ];
  it("literal keys in components, pages and server modules", () => {
    const used = new Set<string>();
    for (const f of files) for (const m of readFileSync(f, "utf8").matchAll(/["'`](rpp\.[a-z0-9_.]*[a-z0-9])["'`]/g)) used.add(m[1]);
    expect(used.size).toBeGreaterThan(150);
    // a namespace (`rpp.ver`, used as `ns` of an enum column) is not a key: its values are checked below
    const isNamespace = (k: string) => Object.keys(en).some((x) => x.startsWith(`${k}.`));
    expect([...used].filter((k) => !(k in en) && !isNamespace(k)).sort()).toEqual([]);
  });
  it("keys the code builds from a list or an enum", () => {
    const need: string[] = [];
    for (const s of ["d30", "d60", "d90", "business", "driver", "office"]) need.push(`rpp.part_${s}`);
    for (const s of ["small", "medium", "large"]) need.push(`rpp.seg_${s}`);
    for (const s of ["registered", "docs", "verified", "first_job", "active"]) need.push(`rpp.fn_${s}`);
    for (const f of FLAG_ORDER) need.push(`rpp.flag.${f}`, `rpp.rule_${f}`);
    for (const s of ["accepted", "pending_acceptance", "expired", "none", "superseded"]) need.push(`rpp.agr.${s}`);
    for (const s of ["business", "driver", "office"]) need.push(`rpp.s_${s}`, `rpp.role.${s}`);
    for (let i = 0; i < 5; i++) need.push(`rpp.age_${i}`);
    for (const r of STALLED_REASONS) need.push(`rpp.stall.${r}`);
    for (const s of ["web", "mobile", "api", "unknown"]) need.push(`rpp.client.${s}`);
    for (const s of ["otp", "password", "api_key", "session"]) need.push(`rpp.method.${s}`);
    for (const s of ["invalid_code", "bad_password", "unknown_user", "unknown_account", "locked", "rate_limited", "suspended", "wrong_portal", "mfa_failed", "unknown"]) need.push(`rpp.fail.${s}`);
    for (const s of ["self", "admin", "import", "api", "seed"]) need.push(`rpp.src.${s}`);
    for (const s of ["pending", "verified", "rejected", "info_requested", "suspended", "expired"]) need.push(`rpp.ver.${s}`);
    for (const s of ["at_risk", "churned"]) need.push(`rpp.risk.${s}`);
    for (const s of ["available", "unavailable"]) need.push(`rpp.avail.${s}`);
    for (const s of ["fleet_total", "fleet_verified", "fleet_available", "fleet_suspended", "fleet_churn", "off_fleet_offices", "off_fleet_drivers", "off_fleet_verified", "off_fleet_available", "t_docs", "t_verify", "t_job"]) need.push(`rpp.${s}`);
    for (const s of ["act_dau", "act_wau", "act_mau", "act_stickiness", "act_type", "act_t_first", "act_t_complete", "act_t_job"]) need.push(`rpp.${s}`);
    expect(need.filter((k) => !(k in en) || !(k in ar) || !(k in ur))).toEqual([]);
  });
});

describe("KPIs and tables are labelled", () => {
  it("every registered people KPI has a label, a definition and — for ratios — a numerator and a denominator, in all three languages", () => {
    const defs = allKpiDefs().filter((d) => d.label.startsWith("rpp."));
    expect(defs.length).toBeGreaterThanOrEqual(55);
    for (const d of defs) for (const k of [d.label, d.definition, d.numerator, d.denominator].filter(Boolean) as string[]) { expect(en[k], `en ${k}`).toBeTruthy(); expect(ar[k], `ar ${k}`).toBeTruthy(); expect(ur[k], `ur ${k}`).toBeTruthy(); }
  });
  it("every drill-down table has a title, translated column labels and translated enum values", () => {
    const tables = listTables().filter((t) => ["companies", "drivers", "offices", "growth"].includes(t.report));
    expect(tables.map((t) => `${t.report}/${t.name}`).sort()).toEqual(["companies/at-risk", "companies/leaderboard", "companies/new", "drivers/inactive", "drivers/scorecards", "drivers/unreliable", "growth/pending", "growth/signups", "growth/stalled", "offices/drivers", "offices/scorecards"]);
    for (const t of tables) {
      for (const k of [t.title, ...t.columns.map((c) => c.label)]) { expect(en[k], `en ${k}`).toBeTruthy(); expect(ar[k], `ar ${k}`).toBeTruthy(); expect(ur[k], `ur ${k}`).toBeTruthy(); }
      for (const c of t.columns.filter((c) => c.ns?.startsWith("rpp."))) expect(Object.keys(en).some((k) => k.startsWith(`${c.ns}.`)), `${t.report}/${t.name}.${c.key} (${c.ns})`).toBe(true);
      for (const key of Object.keys(t.sorts)) expect(t.columns.some((c) => c.key === key), `${t.report}/${t.name} sort ${key} has a column`).toBe(true);
      expect(t.sorts[t.defaultSort.key], `${t.report}/${t.name} default sort`).toBeTruthy();
    }
  });
});
