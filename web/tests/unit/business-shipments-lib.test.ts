import { describe, it, expect } from "vitest";
import {
  bulkWire, countMissing, demoToRow, emptyRow, fromServer, incompleteSheetCsv, isBlankRow, mapServerBulkErrors, parseBulkCsv, parseManifestCsv,
  splitServerManifest, toWire, validateDetails, validateRow, type ShipmentItem,
} from "@/components/features/business-shipments-lib";

/** Pure client logic of the business manifest: "details later" validation, draft reload, bulk completion sheet. No DB, no network. */

const item = (over: Partial<ShipmentItem>): ShipmentItem => ({
  id: "id-" + Math.random().toString(36).slice(2), seq: 1, code: "JR-000012-001", externalRef: null, recipientType: "consumer", recipientName: "", recipientPhone: "", address: "", city: "riyadh",
  lat: null, lng: null, contents: null, notes: null, status: "pending", offerId: null, driverName: null, stopOrder: null, attempts: 0, loadedAt: null, arrivedAt: null, deliveredAt: null,
  deliveredDistanceM: null, proofType: null, receiverName: null, hasProof: false, failReason: null, failNote: null, failedAt: null, returnedAt: null, detailsComplete: false, ...over,
});

describe("row validation: strict vs details-later (partial)", () => {
  const blank = emptyRow();
  it("strict mode still requires name, phone and address", () => {
    expect(Object.keys(validateRow(blank)).sort()).toEqual(["address", "recipientName", "recipientPhone"]);
  });
  it("partial mode accepts a blank row", () => expect(validateRow(blank, { partial: true })).toEqual({}));
  it("partial mode still validates whatever was typed (mirrors the server)", () => {
    expect(validateRow(emptyRow({ recipientName: "A" }), { partial: true }).recipientName).toBe("bs.val_name");
    expect(validateRow(emptyRow({ recipientPhone: "12345" }), { partial: true }).recipientPhone).toBe("bs.val_phone");
    expect(validateRow(emptyRow({ address: "abcd" }), { partial: true }).address).toBe("bs.val_address");
    expect(validateRow(emptyRow({ recipientName: "Mona", recipientPhone: "0555555555", address: "King Fahd Rd 120" }), { partial: true })).toEqual({});
    expect(validateRow(emptyRow({ recipientName: "  " }), { partial: true })).toEqual({});
  });
  it("validateDetails is the shared core", () => expect(validateDetails({ recipientName: "Mona" }, true)).toEqual({}));
});

describe("wire format", () => {
  it("sends blank text as null, never as an empty string", () => {
    const w = toWire(emptyRow({ recipientName: "  ", contents: " " }));
    expect(w).toMatchObject({ recipientType: "consumer", recipientName: null, recipientPhone: null, address: null, contents: null, notes: null, externalRef: null });
    expect(JSON.stringify(w)).not.toContain('""');
  });
  it("keeps pins and partner links of filled rows", () => {
    const w = toWire(emptyRow({ recipientName: "Mona", recipientPhone: "0555555555", address: "King Fahd Rd", externalRef: "DEMO-001", lat: 24.7, lng: 46.6, partnerId: "p1" }));
    expect(w).toMatchObject({ recipientName: "Mona", externalRef: "DEMO-001", lat: 24.7, lng: 46.6, partnerId: "p1" });
  });
});

describe("saved draft → editor state", () => {
  it("collapses placeholder parcels into a count and keeps real rows", () => {
    const items = [
      { recipientName: "Mona", recipientPhone: "+966555555555", address: "King Fahd Rd 120", detailsComplete: true, externalRef: "ORD-1" },
      { recipientName: "", recipientPhone: "", address: "", detailsComplete: false },
      { recipientName: "", recipientPhone: "", address: "", detailsComplete: false, externalRef: null, contents: null },
      { recipientName: "Partial Co", recipientPhone: "", address: "", detailsComplete: false },
      { recipientName: "", recipientPhone: "", address: "", detailsComplete: false, recipientType: "business" },
    ];
    const m = splitServerManifest(items);
    expect(m.later).toBe(true);
    expect(m.blank).toBe(2);
    expect(m.rows.map((r) => r.recipientName)).toEqual(["Mona", "Partial Co", ""]);
    expect(m.rows[2].recipientType).toBe("business"); // a typed recipient type is information: it stays a row
    expect(countMissing(m.rows, m.blank)).toBe(2 + 2); // 2 blank + "Partial Co" + business placeholder
  });
  it("a fully detailed draft stays in strict mode", () => {
    const m = splitServerManifest([{ recipientName: "Mona", recipientPhone: "+966555555555", address: "King Fahd Rd 120", detailsComplete: true }]);
    expect(m).toMatchObject({ later: false, blank: 0 });
    expect(m.rows).toHaveLength(1);
  });
  it("placeholders reload as empty rows that re-send as omitted values", () => {
    const row = fromServer({ recipientName: "", recipientPhone: "", address: "", contents: null, notes: null, externalRef: null, lat: null, lng: null, recipientType: "consumer" });
    expect(isBlankRow(row)).toBe(true);
    expect(validateRow(row, { partial: true })).toEqual({});
    expect(toWire(row)).toMatchObject({ recipientName: null, recipientPhone: null, address: null });
  });
});

describe("CSV import in details-later mode", () => {
  const csv = "name,phone,address\nMona Ali,0555555555,King Fahd Rd 120 Riyadh\n,,Olaya St 8 Riyadh\nAl Noor,12,Olaya St 8";
  it("strict flags blank cells, partial only what was typed wrong", () => {
    const strict = parseManifestCsv(csv);
    expect(Object.keys(strict.rows[1].errors).sort()).toEqual(["recipientName", "recipientPhone"]);
    const later = parseManifestCsv(csv, new Map(), { partial: true });
    expect(later.rows[0].errors).toEqual({});
    expect(later.rows[1].errors).toEqual({});
    expect(later.rows[2].errors).toEqual({ recipientPhone: "bs.val_phone" });
  });
});

describe("demo parcels", () => {
  it("maps ref → externalRef and keeps the pin, type and contents", () => {
    const r = demoToRow({ n: 7, ref: "DEMO-007", recipientType: "business", recipientName: "Al Noor", recipientPhone: "0500000007", address: "Olaya St 8", city: "riyadh", lat: 24.7, lng: 46.7, district: "Olaya", contents: "Medicines", notes: null });
    expect(r).toMatchObject({ externalRef: "DEMO-007", recipientType: "business", lat: 24.7, lng: 46.7, contents: "Medicines", notes: "" });
  });
});

describe("bulk completion (PATCH /requests/:id/shipments)", () => {
  const p1 = item({ id: "a", seq: 1, code: "JR-000012-001", externalRef: "ORD-1" });
  const p2 = item({ id: "b", seq: 2, code: "JR-000012-002" });
  const p3 = item({ id: "c", seq: 3, code: "JR-000012-003", status: "loaded" });
  const p4 = item({ id: "d", seq: 4, code: "JR-000012-004", recipientName: "Old", recipientPhone: "+966555555555", address: "Old address 1", detailsComplete: true });
  const all = [p1, p2, p3, p4];

  it("matches by parcel code, order reference or manifest number", () => {
    const r = parseBulkCsv("JR-000012-001,Mona Ali,0555555555,King Fahd Rd 120\nord-1,Dup,0555555555,King Fahd Rd 120\n2,Sara,0501234567,Olaya St 8 Riyadh", all);
    expect(r.header).toBe(false);
    expect(r.rows.map((x) => x.target?.id)).toEqual(["a", "a", "b"]);
    expect(r.rows[0].problem).toBeNull();
    expect(r.rows[1].problem).toBe("pb.cd_prob_dup");
    expect(r.rows[2].problem).toBeNull();
  });
  it("reports unknown keys, parcels already with the driver and empty lines", () => {
    const r = parseBulkCsv("NOPE,Mona,0555555555,King Fahd Rd 120\n3,Mona,0555555555,King Fahd Rd 120\n2,,,", all);
    expect(r.rows.map((x) => x.problem)).toEqual(["pb.cd_prob_not_found", "pb.cd_prob_locked", "pb.cd_prob_empty"]);
  });
  it("validates what was typed and warns when details would be overwritten", () => {
    const r = parseBulkCsv("1,M,123,abc\n4,New Name,,", all);
    expect(r.rows[0].errors).toMatchObject({ recipientName: "bs.val_name", recipientPhone: "bs.val_phone", address: "bs.val_address" });
    expect(r.rows[1].errors).toEqual({});
    expect(r.rows[1].overwrites).toBe(true);
  });
  it("detects a header row and maps columns by name (semicolon, any order)", () => {
    const r = parseBulkCsv("code;address;name;phone\n2;Olaya St 8 Riyadh;Sara;0501234567", all);
    expect(r.header).toBe(true);
    expect(r.rows[0].edit).toEqual({ recipientName: "Sara", recipientPhone: "0501234567", address: "Olaya St 8 Riyadh" });
    expect(r.rows[0].line).toBe(2);
  });
  it("sends only what was typed", () => {
    expect(bulkWire("x", { recipientName: " Mona ", recipientPhone: "", address: "  " })).toEqual({ id: "x", recipientName: "Mona" });
  });
  it("maps server row errors from `details.field` and from schema keys", () => {
    const m = mapServerBulkErrors({ field: "rows.2.recipientPhone", row: 3 });
    expect(m.get(2)).toEqual({ recipientPhone: "bs.val_phone" });
    const k = mapServerBulkErrors({ "rows.0.address": "too short", field: "rows.0.address" });
    expect(k.get(0)).toEqual({ address: "bs.val_address" });
    expect(mapServerBulkErrors({ field: "rows.1.id" }).get(1)).toEqual({ id: "pb.cd_prob_not_found" });
    expect(mapServerBulkErrors({ row: 4 }).size).toBe(0);
  });
  it("offers the incomplete parcels as a sheet with the code first", () => {
    const sheet = incompleteSheetCsv([p1, p2]);
    expect(sheet.replace("﻿", "").split("\r\n")[0]).toBe("code,name,phone,address");
    expect(sheet).toContain("JR-000012-001");
    // the sheet we hand out parses back into the same parcels
    const back = parseBulkCsv(sheet.replace("﻿", "").replace("JR-000012-001,,,", "JR-000012-001,Mona,0555555555,King Fahd Rd 120"), all);
    expect(back.header).toBe(true);
    expect(back.rows[0].target?.id).toBe("a");
    expect(back.rows[0].edit.recipientName).toBe("Mona");
  });
});
