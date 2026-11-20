import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import en from "@/i18n/en";
import ar from "@/i18n/ar";
import ur from "@/i18n/ur";
import { allKpiDefs } from "@/server/analytics/definitions";
import "@/server/analytics/deliveries";
import "@/server/analytics/cod";
import "@/server/analytics/finance";
import { COD_KPI_GROUPS } from "@/server/analytics/cod-defs";
import { DELIVERY_KPI_GROUPS } from "@/server/analytics/deliveries-defs";
import { FINANCE_KPI_GROUPS } from "@/server/analytics/finance-defs";
import { SERVICES } from "@/server/catalog";
import { AGE_KEYS } from "@/server/analytics/finance-core";
import { DEFER_KEYS, PROOF_KEYS } from "@/components/reports/fin/fin-lib";
import { DIMS } from "@/server/analytics/deliveries-groups";

const walk = (d: string): string[] => readdirSync(d).flatMap((f) => { const p = join(d, f); return statSync(p).isDirectory() ? walk(p) : /\.tsx?$/.test(p) ? [p] : []; });
const mine = [
  ...walk("src/components/reports/fin"), "src/app/(app)/admin/reports/deliveries/page.tsx", "src/app/(app)/admin/reports/cod/page.tsx", "src/app/(app)/admin/reports/finance/page.tsx",
  ...walk("src/server/analytics").filter((f) => /\/(deliveries|cod|finance)[-.]/.test(f)),
];
const ph = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(",");
const rpd = (d: Record<string, string>) => Object.keys(d).filter((k) => k.startsWith("rpd."));
const has = (k: string) => k in en && k in ar && k in ur;

describe("rpd.* dictionary", () => {
  it("has the same keys in en, ar and ur, with the same placeholders and real translations", () => {
    expect(rpd(en).length).toBeGreaterThan(400);
    expect(rpd(ar).sort()).toEqual(rpd(en).sort());
    expect(rpd(ur).sort()).toEqual(rpd(en).sort());
    for (const k of rpd(en)) {
      expect(ph(ar[k]), `ar ${k}`).toBe(ph(en[k])); expect(ph(ur[k]), `ur ${k}`).toBe(ph(en[k]));
      expect(ar[k].trim(), `ar ${k}`).not.toBe(""); expect(ur[k].trim(), `ur ${k}`).not.toBe("");
    }
    // the headline strings are translated, not copied
    for (const k of ["rpd.dlv_title", "rpd.cod_title", "rpd.fin_title", "rpd.kpi_fin_billed", "rpd.def_dlv_created", "rpd.sec_trends"]) { expect(ar[k]).not.toBe(en[k]); expect(ur[k]).not.toBe(en[k]); }
  });
  it("every rpd.* key written in my files exists in all three languages", () => {
    const used = new Set<string>();
    for (const f of mine) for (const m of readFileSync(f, "utf8").matchAll(/["'`](rpd\.[a-z0-9_]+(?:\.[a-z0-9_]+)*)["'`]/g)) used.add(m[1]);
    expect(used.size).toBeGreaterThan(150);
    // `ns: "rpd.proof"` / `"rpd.held"` are dictionary namespaces: their members are checked below
    const missing = [...used].filter((k) => !has(k) && !["rpd.proof", "rpd.held"].includes(k));
    expect(missing.sort()).toEqual([]);
  });
  it("keys built at run time exist", () => {
    const need = [
      ...AGE_KEYS.map((k) => `rpd.age.${k}`), ...PROOF_KEYS.map((k) => `rpd.proof.${k}`), "rpd.proof.signed", ...DEFER_KEYS.map((k) => `rpd.defer.${k}`), "rpd.held.held",
      ...DIMS.flatMap((d) => [`rpd.dim_${d}`, `rpd.bd_${d}`]), ...["created", "handed", "delivered"].map((k) => `rpd.fn_${k}`), ...["created", "handed", "delivered", "failed"].map((k) => `rpd.s_${k}`),
      ...["driver", "office", "company"].flatMap((d) => [`rpd.holder_${d}`, `rpd.holders_${d}`]), ...["service", "vehicle", "city"].flatMap((d) => [`rpd.margin_by_${d}`, `rpd.dim_${d}`]),
      ...["billed", "vat", "provider", "net"].map((k) => `rpd.wf_${k}`), ...["liability", "escrow", "cash", "credit"].map((k) => `rpd.s_${k}`),
      ...["pending", "approved", "paid", "rejected"].map((k) => `wdstatus.${k}`), ...["failed", "delivered", "returned"].map((k) => `rpf.s_${k}`),
      ...SERVICES.map((s) => `svc.${s.key}`),
    ];
    expect(need.filter((k) => !has(k))).toEqual([]);
  });
  it("every KPI of the three reports has a label and a definition (and, for a share or an average, a numerator and a denominator)", () => {
    const mineKpis = allKpiDefs().filter((d) => d.label.startsWith("rpd."));
    expect(mineKpis.length).toBeGreaterThanOrEqual(70);
    for (const d of mineKpis) {
      for (const k of [d.label, d.definition, d.numerator, d.denominator].filter(Boolean) as string[]) expect(has(k), k).toBe(true);
      if (d.unit === "percent") { expect(d.numerator, d.key).toBeTruthy(); expect(d.denominator, d.key).toBeTruthy(); }
      // money KPIs of the finance and COD reports carry the flag so they vanish without finance.view
      if (d.unit === "money") expect(d.money, d.key).toBe(true);
    }
  });
  it("the KPI groups only name registered KPIs, once each", () => {
    const keys = new Set(allKpiDefs().map((d) => d.key));
    for (const g of [DELIVERY_KPI_GROUPS, COD_KPI_GROUPS, FINANCE_KPI_GROUPS]) {
      const all = Object.values(g).flat() as string[];
      expect(all.filter((k) => !keys.has(k))).toEqual([]);
      expect(new Set(all).size).toBe(all.length);
    }
    const registered = allKpiDefs().filter((d) => d.label.startsWith("rpd.")).map((d) => d.key).sort();
    const grouped = [DELIVERY_KPI_GROUPS, COD_KPI_GROUPS, FINANCE_KPI_GROUPS].flatMap((g) => Object.values(g).flat() as string[]).filter((k) => registered.includes(k)).sort();
    expect(grouped).toEqual(registered);
  });
});
