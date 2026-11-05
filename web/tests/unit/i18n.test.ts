import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import ar from "@/i18n/ar";
import en from "@/i18n/en";
import ur from "@/i18n/ur";
import { translate } from "@/i18n/core";
import path from "node:path";
import { SERVICES, VEHICLE_TYPES, TICKET_CATEGORIES, COMPLAINT_CATEGORIES, CUSTODY_ITEM_TYPES, REQUEST_STATUS, OFFER_STATUS, DRIVER_DOC_TYPES, OFFICE_DOC_TYPES, BUSINESS_DOC_TYPES, DEFAULT_CITIES, STAFF_PRESETS } from "@/server/catalog";

const walk = (d: string): string[] => readdirSync(d).flatMap((f) => { const p = join(d, f); return statSync(p).isDirectory() ? walk(p) : /\.tsx?$/.test(p) ? [p] : []; });
const placeholders = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(",");

describe("i18n parity (ar / en / ur)", () => {
  it("all three dictionaries have identical key sets", () => {
    const e = Object.keys(en).sort();
    expect(Object.keys(ar).sort().filter((k) => !(k in en))).toEqual([]);
    expect(Object.keys(ur).sort().filter((k) => !(k in en))).toEqual([]);
    expect(e.filter((k) => !(k in ar))).toEqual([]);
    expect(e.filter((k) => !(k in ur))).toEqual([]);
  });
  it("no empty values and placeholders match across languages", () => {
    for (const [k, v] of Object.entries(en)) {
      expect(v.trim(), `en ${k}`).not.toBe("");
      expect(ar[k]?.trim(), `ar ${k}`).toBeTruthy();
      expect(ur[k]?.trim(), `ur ${k}`).toBeTruthy();
      expect(placeholders(ar[k]), `ar placeholders ${k}`).toBe(placeholders(v));
      expect(placeholders(ur[k]), `ur placeholders ${k}`).toBe(placeholders(v));
    }
  });
  it("every literal key used in source exists (no raw keys shown to users)", () => {
    const used = new Set<string>();
    for (const f of walk("src")) {
      if (f.includes("src/server/") || f.includes("src/db/") || f.includes("src/i18n/")) continue;
      const s = readFileSync(f, "utf8");
      for (const m of s.matchAll(/\bt\(\s*"([^"]+)"/g)) used.add(m[1]);
      for (const m of s.matchAll(/(?:success[:=]\s*\{?|success:\s*[a-z]+\s*\?\s*)"([a-z_]+\.[a-z_0-9.]+)"/g)) used.add(m[1]);
      for (const m of s.matchAll(/(?:\bkey:\s*)"((?:nav)\.[a-z_]+)"/g)) used.add(m[1]);
    }
    expect([...used].filter((k) => !(k in en)).sort()).toEqual([]);
  });
  it("dynamic namespaces cover every domain constant", () => {
    const need: string[] = [];
    SERVICES.forEach((s) => need.push(`svc.${s.key}`, `svc.${s.key}_desc`, `unit.${s.unit}`));
    VEHICLE_TYPES.forEach((v) => need.push(`vehicle.${v}`));
    DEFAULT_CITIES.forEach((c) => need.push(`city.${c.key}`));
    [...REQUEST_STATUS, ...OFFER_STATUS].forEach((s) => need.push(`status.${s}`));
    OFFER_STATUS.forEach((s) => need.push(`jobstatus.${s}`));
    Object.values(TICKET_CATEGORIES).flat().forEach((c) => need.push(`ticket_cat.${c}`));
    COMPLAINT_CATEGORIES.forEach((c) => need.push(`complaint_cat.${c}`));
    CUSTODY_ITEM_TYPES.forEach((c) => need.push(`custody.${c}`));
    [...DRIVER_DOC_TYPES, ...OFFICE_DOC_TYPES, ...BUSINESS_DOC_TYPES].forEach((d) => need.push(`doc.${d.key}`));
    Object.keys(STAFF_PRESETS).forEach((p) => need.push(`preset.${p}`));
    ["UNAUTHENTICATED", "FORBIDDEN", "NOT_FOUND", "VALIDATION", "CONFLICT", "INVALID_TRANSITION", "INSUFFICIENT_FUNDS", "NO_APPROVED_PRICE", "SERVICE_DISABLED", "OVERLAPPING_JOB", "NOT_ELIGIBLE", "SLOT_TAKEN", "RATE_LIMITED", "VERIFICATION_REQUIRED", "TERMS_REQUIRED", "DISPUTE_BLOCKS", "DEPENDENCY_UNAVAILABLE", "INTERNAL"].forEach((c) => need.push(`err.${c}`));
    for (const s of ["pending", "info_requested", "rejected", "suspended"]) need.push(`verify.${s}_title`, `verify.${s}_body`);
    for (const s of ["pending", "rejected", "expired"]) need.push(`verify.driver_${s}_title`);
    for (const s of ["offered", "accepted", "arrived", "attendance_confirmed", "attendance_confirmed_ack", "delivered_reported", "qty_disputed", "pending_settlement", "completed", "cancelled", "rejected", "expired", "no_show", "replaced"]) need.push(`job.hint_${s}`);
    // every ledger kind, job-event type and notification type emitted by the server
    const server = walk("src/server").map((f) => readFileSync(f, "utf8")).join("\n");
    for (const m of server.matchAll(/logEvent\([\s\S]*?type:\s*"([a-z_]+)"/g)) need.push(`event.${m[1]}`);
    for (const m of server.matchAll(/notify(?:Many)?\(\s*[^,]+,\s*"([a-z_]+)"/g)) need.push(`notif.${m[1]}`);
    for (const m of server.matchAll(/\b(?:post\([\s\S]*?kind:)\s*"([a-z_]+)"/g)) need.push(`ledger.${m[1]}`);
    for (const d of ["approved", "rejected", "info_requested"]) need.push(`notif.document_${d}`);
    for (const d of ["verified", "rejected", "info_requested", "suspended"]) need.push(`notif.verification_${d}`);
    expect([...new Set(need)].filter((k) => !(k in en)).sort(), "missing translation keys").toEqual([]);
  });
  it("translate() interpolates and falls back to English then to the key", () => {
    expect(translate({ a: "Hi {name}" }, {}, "a", { name: "Sara" })).toBe("Hi Sara");
    expect(translate({}, { a: "EN" }, "a")).toBe("EN");
    expect(translate({}, {}, "missing.key")).toBe("missing.key");
  });
  it("Arabic and Urdu are actually translated (not English copies) for UI-critical keys", () => {
    for (const k of ["nav.dashboard", "auth.login", "act.accept", "wizard.publish", "status.completed", "err.INSUFFICIENT_FUNDS"]) {
      expect(ar[k]).not.toBe(en[k]); expect(ur[k]).not.toBe(en[k]);
    }
  });
  it("Flutter assets are in sync with the web dictionaries (run `npm run i18n:export` if this fails)", () => {
    for (const [name, d] of Object.entries({ en, ar, ur })) {
      const exported = JSON.parse(readFileSync(path.resolve(__dirname, `../../../mobile/assets/i18n/${name}.json`), "utf8"));
      expect(exported, name).toEqual(d);
    }
  });
});
