import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import ar from "@/i18n/ar";
import en from "@/i18n/en";
import ur from "@/i18n/ur";
import { translate } from "@/i18n/core";
import path from "node:path";
import { SERVICES, VEHICLE_TYPES, TICKET_CATEGORIES, COMPLAINT_CATEGORIES, CUSTODY_ITEM_TYPES, REQUEST_STATUS, OFFER_STATUS, DRIVER_DOC_TYPES, OFFICE_DOC_TYPES, BUSINESS_DOC_TYPES, DEFAULT_CITIES, STAFF_PRESETS, SHIPMENT_STATUS, RECIPIENT_TYPES, STOP_FAIL_REASONS } from "@/server/catalog";

const walk = (d: string): string[] => readdirSync(d).flatMap((f) => { const p = join(d, f); return statSync(p).isDirectory() ? walk(p) : /\.tsx?$/.test(p) ? [p] : []; });
const placeholders = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(",");
/** `<key>__one` = English singular twin used by translate() when n is 1; ar/ur have none on purpose (number-neutral wording). */
const isOne = (k: string) => k.endsWith("__one");

describe("i18n parity (ar / en / ur)", () => {
  it("all three dictionaries have identical key sets", () => {
    const e = Object.keys(en).sort().filter((k) => !isOne(k));
    expect(Object.keys(ar).sort().filter((k) => !(k in en))).toEqual([]);
    expect(Object.keys(ur).sort().filter((k) => !(k in en))).toEqual([]);
    expect(e.filter((k) => !(k in ar))).toEqual([]);
    expect(e.filter((k) => !(k in ur))).toEqual([]);
    expect(Object.keys(ar).concat(Object.keys(ur)).filter(isOne), "singular twins are English only").toEqual([]);
  });
  it("no empty values and placeholders match across languages", () => {
    for (const [k, v] of Object.entries(en)) {
      expect(v.trim(), `en ${k}`).not.toBe("");
      if (isOne(k)) { // the singular twin needs a base key and may only use the base key's placeholders
        const base = k.slice(0, -5); expect(base in en, `${k} has a base key`).toBe(true);
        const baseVars = new Set(placeholders(en[base]).split(",")); for (const p of placeholders(v).split(",").filter(Boolean)) expect(baseVars.has(p), `${k} uses {${p}}`).toBe(true);
        continue;
      }
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
    SHIPMENT_STATUS.forEach((s) => need.push(`shipstatus.${s}`));
    RECIPIENT_TYPES.forEach((s) => need.push(`rtype.${s}`));
    STOP_FAIL_REASONS.forEach((s) => need.push(`stopfail.${s}`));
    for (const s of ["driver_unavailable", "request_cancelled", "not_fully_staffed", "unfulfilled"]) need.push(`stopfail.${s}`);
    for (const s of ["preparing", "on_the_way", "arrived", "delivered", "attempt_failed", "cancelled"]) need.push(`track.stage.${s}`);
    Object.values(TICKET_CATEGORIES).flat().forEach((c) => need.push(`ticket_cat.${c}`));
    COMPLAINT_CATEGORIES.forEach((c) => need.push(`complaint_cat.${c}`));
    CUSTODY_ITEM_TYPES.forEach((c) => need.push(`custody.${c}`));
    [...DRIVER_DOC_TYPES, ...OFFICE_DOC_TYPES, ...BUSINESS_DOC_TYPES].forEach((d) => need.push(`doc.${d.key}`));
    Object.keys(STAFF_PRESETS).forEach((p) => need.push(`preset.${p}`));
    ["UNAUTHENTICATED", "FORBIDDEN", "NOT_FOUND", "VALIDATION", "CONFLICT", "INVALID_TRANSITION", "INSUFFICIENT_FUNDS", "NO_APPROVED_PRICE", "SERVICE_DISABLED", "OVERLAPPING_JOB", "NOT_ELIGIBLE", "SLOT_TAKEN", "RATE_LIMITED", "VERIFICATION_REQUIRED", "TERMS_REQUIRED", "DISPUTE_BLOCKS", "DEPENDENCY_UNAVAILABLE", "MANIFEST_REQUIRED", "OTP_REQUIRED", "OTP_INVALID", "OTP_LOCKED", "STOP_LOCKED", "STOPS_PENDING", "RETURNS_PENDING", "WAIT_REQUIRED", "INTERNAL"].forEach((c) => need.push(`err.${c}`));
    for (const s of ["pending", "info_requested", "rejected", "suspended"]) need.push(`verify.${s}_title`, `verify.${s}_body`);
    for (const s of ["pending", "rejected", "expired"]) need.push(`verify.driver_${s}_title`);
    for (const s of ["offered", "accepted", "arrived", "attendance_confirmed", "attendance_confirmed_ack", "delivered_reported", "qty_disputed", "pending_settlement", "completed", "cancelled", "rejected", "expired", "no_show", "replaced"]) need.push(`job.hint_${s}`);
    // every ledger kind, job-event type and notification type emitted by the server
    const server = walk("src/server").map((f) => readFileSync(f, "utf8")).join("\n");
    // calls only (not the `function logEvent(` definition) and the `type:` of the SAME call: an unbounded gap ran from the definition into unrelated files (`type: "text"` of a spreadsheet column)
    for (const m of server.matchAll(/(?<!function )logEvent\((?:(?!\blogEvent\()[\s\S]){0,700}?type:\s*"([a-z_]+)"/g)) need.push(`event.${m[1]}`);
    for (const m of server.matchAll(/notify(?:Many)?\(\s*[^,]+,\s*"([a-z_]+)"/g)) need.push(`notif.${m[1]}`);
    // the `kind` of a wallet `post(tx, { …, kind: "…" })` call — within that one object literal, so a `kind:` elsewhere in the code is not mistaken for a ledger kind
    for (const m of server.matchAll(/\bpost\(\s*[A-Za-z_.]+\s*,\s*\{(?:[^{}]|\$\{[^}]*\})*?\bkind:\s*"([a-z_]+)"/g)) need.push(`ledger.${m[1]}`);
    for (const d of ["approved", "rejected", "info_requested"]) need.push(`notif.document_${d}`);
    for (const d of ["verified", "rejected", "info_requested", "suspended"]) need.push(`notif.verification_${d}`);
    expect([...new Set(need)].filter((k) => !(k in en)).sort(), "missing translation keys").toEqual([]);
  });
  it("translate() interpolates and falls back to English then to the key", () => {
    expect(translate({ a: "Hi {name}" }, {}, "a", { name: "Sara" })).toBe("Hi Sara");
    expect(translate({}, { a: "EN" }, "a")).toBe("EN");
    expect(translate({}, {}, "missing.key")).toBe("missing.key");
  });
  it("translate() fills placeholders in one pass: a value that contains braces is not substituted again", () => {
    expect(translate({ a: "{name} has {n} parcels" }, {}, "a", { name: "Acme {n}", n: 5 })).toBe("Acme {n} has 5 parcels");
    expect(translate({ a: "{a} and {b}" }, {}, "a", { a: "{b}", b: "x" })).toBe("{b} and x");
    expect(translate({ a: "Hi {name} {missing}" }, {}, "a", { name: "Sara" }), "a placeholder without a value stays visible").toBe("Hi Sara {missing}");
  });
  it("translate() uses the singular twin (<key>__one) for n = 1 when the active dictionary has one", () => {
    const d = { p: "{n} parcels", p__one: "{n} parcel" };
    expect(translate(d, {}, "p", { n: 1 })).toBe("1 parcel");
    expect(translate(d, {}, "p", { n: "1" }), "formatted numbers arrive as strings").toBe("1 parcel");
    expect(translate(d, {}, "p", { n: 2 })).toBe("2 parcels");
    expect(translate(d, {}, "p", { n: 0 })).toBe("0 parcels");
    expect(translate(d, {}, "p", { n: "1,000" })).toBe("1,000 parcels");
    expect(translate({ p: "{n} طرد" }, d, "p", { n: 1 }), "Arabic has no twin: the English one must not leak in").toBe("1 طرد");
    expect(translate(d, {}, "p"), "no vars: plain text").toBe("{n} parcels");
    expect(translate(en, en, "ops.open_slots", { n: 1 })).toBe("1 slot open");
    expect(translate(en, en, "ops.open_slots", { n: 3 })).toBe("3 slots open");
    expect(translate(ar, en, "ops.open_slots", { n: 1 })).toBe(ar["ops.open_slots"].replace("{n}", "1"));
  });
  it("the no-access copy exists in all three languages", () => {
    for (const k of ["err.no_access_title", "err.no_access_hint", "err.no_access_home"]) { expect(en[k]).toBeTruthy(); expect(ar[k]).not.toBe(en[k]); expect(ur[k]).not.toBe(en[k]); }
  });
  it("Arabic and Urdu are actually translated (not English copies) for UI-critical keys", () => {
    for (const k of ["nav.dashboard", "auth.login", "act.accept", "wizard.publish", "status.completed", "err.INSUFFICIENT_FUNDS"]) {
      expect(ar[k]).not.toBe(en[k]); expect(ur[k]).not.toBe(en[k]);
    }
  });
  it("Flutter assets are in sync with the web dictionaries (run `npm run i18n:export` if this fails)", () => {
    for (const [name, d] of Object.entries({ en, ar, ur })) {
      const exported = JSON.parse(readFileSync(path.resolve(__dirname, `../../../mobile/assets/i18n/${name}.json`), "utf8"));
      expect(exported, name).toEqual(Object.fromEntries(Object.entries(d).filter(([k]) => !k.endsWith("__one")))); // the app has no plural engine (see scripts/export-i18n.ts)
    }
  });
});
