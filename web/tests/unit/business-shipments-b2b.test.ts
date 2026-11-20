import { describe, it, expect } from "vitest";
import { b2bEnabledOf } from "@/components/features/business-shipments-policy";
import { demoToRow, emptyRow, parseManifestCsv, templateCsv, toWire } from "@/components/features/business-shipments-lib";

/** Update J3: while the platform's B2B switch is off the manifest has no recipient type — everything is an individual and "business" is never sent. */
describe("B2B shipments switch (J3)", () => {
  it("reads the flag from the catalog: not loaded = off, an older server without the flag = on", () => {
    expect(b2bEnabledOf(null)).toBe(false); expect(b2bEnabledOf(undefined)).toBe(false);
    expect(b2bEnabledOf({ policy: { b2bShipmentsEnabled: false } })).toBe(false);
    expect(b2bEnabledOf({ policy: { b2bShipmentsEnabled: true } })).toBe(true);
    expect(b2bEnabledOf({ policy: {} })).toBe(true); expect(b2bEnabledOf({})).toBe(true);
  });
  it("never sends recipientType business while B2B is off, and keeps it while on", () => {
    const biz = emptyRow({ recipientType: "business", recipientName: "Al Noor", recipientPhone: "0501234567", address: "Olaya St 8, Riyadh" });
    expect(toWire(biz, false).recipientType).toBe("consumer");
    expect(toWire(biz, true).recipientType).toBe("business");
    expect(toWire(biz).recipientType).toBe("business"); // default = as before update J
  });
  const csv = "name,phone,address,type,ref\nMona Ali,0555555555,King Fahd Rd 120 Riyadh,consumer,A1\nAl Noor,0501234567,Olaya St 8 Riyadh,business,A2\nSara,0502222222,Tahlia St 5 Riyadh,wholesaler,A3";
  it("CSV import: with B2B off the type column is ignored, business rows become individuals and are counted", () => {
    const off = parseManifestCsv(csv, new Map(), { b2b: false });
    expect(off.rows.map((r) => r.row.recipientType)).toEqual(["consumer", "consumer", "consumer"]);
    expect(off.coerced).toBe(1);
    expect(off.rows.every((r) => !r.errors.recipientType)).toBe(true); // an unknown type word is no problem when there is no type
  });
  it("CSV import with B2B on: unchanged (types parsed, unknown words flagged)", () => {
    const on = parseManifestCsv(csv, new Map(), { b2b: true });
    expect(on.rows.map((r) => r.row.recipientType)).toEqual(["consumer", "business", "consumer"]);
    expect(on.rows[2].errors.recipientType).toBe("bs.val_type"); expect(on.coerced).toBe(0);
    expect(parseManifestCsv(csv).rows[1].row.recipientType).toBe("business");
  });
  it("a sheet without a header has no type column while B2B is off", () => {
    const p = parseManifestCsv("Mona Ali,0555555555,King Fahd Rd 120 Riyadh,ORD-1,Clothes,Gate 2,12.5", new Map(), { b2b: false });
    expect(p.header).toBe(false);
    expect(p.rows[0].row).toMatchObject({ recipientName: "Mona Ali", externalRef: "ORD-1", contents: "Clothes", notes: "Gate 2", cod: "12.5", recipientType: "consumer" });
  });
  it("the template has no type column while B2B is off, and no business example row", () => {
    const off = templateCsv(false); const on = templateCsv(true);
    expect(off.split("\r\n")[0]).toBe("﻿name,phone,address,ref,contents,notes,cod");
    expect(off).not.toContain("business"); expect(off).not.toContain(",type,");
    expect(on.split("\r\n")[0]).toContain(",type,"); expect(on).toContain("business");
  });
  it("demo parcels are added as individuals while B2B is off", () => {
    const d = { n: 1, ref: "DEMO-001", recipientType: "business" as const, recipientName: "Al Noor", recipientPhone: "0500000001", address: "Olaya", city: "riyadh", lat: 24.7, lng: 46.7, district: "", contents: null, notes: null };
    expect(demoToRow(d, false).recipientType).toBe("consumer"); expect(demoToRow(d, true).recipientType).toBe("business"); expect(demoToRow(d).recipientType).toBe("business");
  });
});
