import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import en from "@/i18n/en";
import ar from "@/i18n/ar";
import ur from "@/i18n/ur";
import { INV_ROWS } from "@/i18n/fragments/rd-invoice";

const placeholders = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(",");
const FEATURES = "src/components/features";
const sources = [...readdirSync(FEATURES).filter((f) => /^invoice-.*\.tsx?$/.test(f)).map((f) => join(FEATURES, f)), join(FEATURES, "admin-finance-invoices.tsx")];

describe("invoice detail i18n (prefix inv.)", () => {
  it("has no duplicate keys, every key starts with inv., and en / ar / ur agree on the keys and the placeholders", () => {
    const keys = INV_ROWS.map((r) => r[0]);
    expect(new Set(keys).size).toBe(keys.length);
    for (const [k, e, a, u] of INV_ROWS) {
      expect(k.startsWith("inv."), k).toBe(true);
      for (const v of [e, a, u]) expect(v.trim(), k).not.toBe("");
      expect(placeholders(a), `ar ${k}`).toBe(placeholders(e));
      expect(placeholders(u), `ur ${k}`).toBe(placeholders(e));
      expect(en[k], k).toBe(e); expect(ar[k], k).toBe(a); expect(ur[k], k).toBe(u);
    }
  });
  it("Arabic and Urdu are real translations (Arabic script), not the English text", () => {
    for (const [k, e, a, u] of INV_ROWS) {
      if (/^[{}\w\s×]+$/.test(e)) continue; // "{n} × {unit}" is the same in every language
      expect(a, `ar ${k}`).toMatch(/[؀-ۿ]/); expect(u, `ur ${k}`).toMatch(/[؀-ۿ]/);
      expect(a, `ar ${k}`).not.toBe(e); expect(u, `ur ${k}`).not.toBe(e);
    }
  });
  it("every literal key used by the invoice pages exists (also the keys of the shared parts they reuse)", () => {
    const used = new Set<string>();
    for (const f of sources) for (const m of readFileSync(f, "utf8").matchAll(/\bt\(\s*"([a-z0-9_]+\.[A-Za-z0-9_.]+)"/g)) used.add(m[1]);
    expect(used.size).toBeGreaterThan(40);
    expect([...used].filter((k) => !(k in en)).sort()).toEqual([]);
  });
  it("covers the dynamic keys: parcel outcomes, price snapshot fields, units, services, ledger kinds, settlement statuses", () => {
    const need = ["failed", "returned", "missing"].map((k) => `inv.p_${k}`);
    need.push(...["ruleVersion", "unit", "unitPriceCents", "providerCostCents", "expectedUnits", "quantity", "totalUnits", "agreementRef", "currency"].map((k) => `inv.snap_${k}`));
    need.push("unit.shipment", "unit.vehicle_day", "svc.delivery_driver", "svc.car_with_driver", "svc.car_without_driver", "settle.paid", "status.completed", "role.office", "role.driver", "role.business");
    need.push(...["topup", "reserve", "release_reserve", "refund", "payout", "platform_fee", "charge", "adjustment"].map((k) => `ledger.${k}`));
    for (const k of need) for (const [name, d] of Object.entries({ en, ar, ur })) expect(d[k], `${name} ${k}`).toBeTruthy();
  });
});
