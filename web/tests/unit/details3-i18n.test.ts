import { describe, it, expect } from "vitest";
import { en as dv3en, ar as dv3ar, ur as dv3ur, DV3_ROWS } from "@/i18n/fragments/rd-detail-3";
import { TICKET_CATEGORIES } from "@/server/catalog";
import { CANNED_CATEGORIES, CANNED_GENERIC, cannedKeys } from "@/server/details-pure";
import { ALERT_KEYS, ALL_KPI_KEYS } from "@/components/features/admin-company-detail-lib";
import { COMPANY_TABS } from "@/components/features/admin-companies-lib";
import { USER_TABS } from "@/components/features/admin-user-detail-lib";

const placeholders = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(",");
const need = (keys: string[]) => { const miss = keys.filter((k) => !(k in dv3en)); expect(miss, "missing dv3 keys").toEqual([]); };

describe("dv3 translations", () => {
  it("every key is in en, ar and ur with the same placeholders, and starts with dv3.", () => {
    expect(DV3_ROWS.length).toBeGreaterThan(300);
    expect(new Set(DV3_ROWS.map((r) => r[0])).size).toBe(DV3_ROWS.length); // no duplicate rows
    for (const [k, en] of Object.entries(dv3en)) {
      expect(k.startsWith("dv3."), k).toBe(true);
      expect(en.trim(), `en ${k}`).not.toBe(""); expect(dv3ar[k]?.trim(), `ar ${k}`).toBeTruthy(); expect(dv3ur[k]?.trim(), `ur ${k}`).toBeTruthy();
      expect(placeholders(dv3ar[k]), `ar placeholders ${k}`).toBe(placeholders(en)); expect(placeholders(dv3ur[k]), `ur placeholders ${k}`).toBe(placeholders(en));
    }
  });
  it("Arabic and Urdu are not English copies", () => {
    const same = DV3_ROWS.filter((r) => r[2] === r[1] || r[3] === r[1]).map((r) => r[0]);
    // identical on purpose: technical names that are written the same in every language
    expect(same.filter((k) => !["dv3.client_api", "dv3.rel_units_v"].includes(k))).toEqual([]);
  });
  it("covers every KPI definition, numerator / denominator, alert and alert title", () => {
    need(ALL_KPI_KEYS.flatMap((k) => [`dv3.k_${k}`, `dv3.d_${k}`]));
    need(["success", "cancellation", "on_time"].flatMap((k) => [`dv3.dn_${k}`, `dv3.dd_${k}`]));
    need(ALERT_KEYS.flatMap((k) => [`dv3.al_${k}`, `dv3.al_${k}_t`]));
  });
  it("covers the SLA states, health parts and bands, hidden-part names, sources, clients and sections", () => {
    need(["met", "met_late", "on_track", "at_risk", "breached"].map((s) => `dv3.sla_${s}`));
    need(["recency", "frequency", "success", "cancellations", "support"].map((s) => `dv3.hpn_${s}`));
    need(["healthy", "watch", "risk", "none"].map((s) => `dv3.band_${s}`));
    need(["orders", "money", "wallet", "cod", "support", "traffic", "keys", "tickets", "complaints", "request", "driver", "company"].map((s) => `dv3.hid_${s}`));
    need(["self", "admin", "import", "api", "seed"].map((s) => `dv3.src_${s}`));
    need(["web", "mobile", "api"].map((s) => `dv3.client_${s}`));
    need(["otp", "password", "api_key", "session"].map((s) => `dv3.sec_m_${s}`));
    need(["active", "disabled"].map((s) => `dv3.int_st_${s}`));
    need(["available", "unavailable"].map((s) => `dv3.u_avail_${s}`));
    need(["business", "office", "driver"].flatMap((s) => [`dv3.u_open_${s}`, `dv3.u_entity_${s}`]));
    need(USER_TABS.map((s) => `dv3.ut_${s}`));
    need(["starts", "accepted", "arrived", "attendance", "loaded", "delivered", "final", "cancelled"].map((s) => `dv3.cp_step_${s}`));
    need(["user", "request", "ticket", "complaint", "offer", "shipment", "settlement", "withdrawal", "document", "settings", "pricing", "pricing_rule", "report", "driver_location", "business", "company", "office_agreement", "wallet"].map((s) => `dv3.u_t_${s}`));
  });
  it("every company tab beyond the original five has a label", () => {
    const own: Record<string, string> = { parcels: "dv3.tab_parcels", integrations: "dv3.tab_integrations", support: "dv3.tab_support", security: "dv3.tab_security", activity: "dv3.tab_activity", notes: "dv3.tab_notes", raw: "dv3.tab_raw" };
    for (const t of COMPANY_TABS) if (!["overview", "orders", "warehouse", "finance", "documents"].includes(t)) expect(own[t], t).toBeTruthy();
    need(Object.values(own));
  });
  it("every ticket category of every role has a canned reply, plus the three general ones", () => {
    const all = [...new Set(Object.values(TICKET_CATEGORIES).flat())];
    expect(all.filter((c) => !(CANNED_CATEGORIES as readonly string[]).includes(c))).toEqual([]);
    need([...CANNED_CATEGORIES.map((c) => `dv3.canned_${c}`), ...CANNED_GENERIC.map((g) => `dv3.canned_g_${g}`)]);
    for (const c of all) expect(cannedKeys(c).length, c).toBe(4);
    for (const k of [...CANNED_CATEGORIES.map((c) => `dv3.canned_${c}`), ...CANNED_GENERIC.map((g) => `dv3.canned_g_${g}`)]) for (const d of [dv3en, dv3ar, dv3ur]) { expect(d[k], k).toContain("{ref}"); expect(d[k], k).toContain("{name}"); }
  });
});
