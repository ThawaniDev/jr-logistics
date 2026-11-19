import { describe, it, expect } from "vitest";
import en from "@/i18n/en";
import ar from "@/i18n/ar";
import ur from "@/i18n/ur";
import {
  ATTACH_MAX, COD_MAX_CENTS, assigneeName, attachmentProblem, formatLatLng, formatSarInput, isAssigned, isShortMapsLink, mapsUrl, outstandingOf, parseCoordinate, parseCoordinates, parseSarToCents,
  progressPct, receiveAmountCheck, reopenWindowOpen, sumCash, sumCod, ticketNeedsYou, validateCod, validateLatLng,
} from "@/components/features/business-fieldops-lib";
import {
  TEMPLATE_HEADER, emptyRow, fromServer, isBlankRow, mapServerRowErrors, parseManifestCsv, splitServerManifest, templateCsv, toWire, validateRow,
} from "@/components/features/business-shipments-lib";

/** Pure client logic of the warehouse field-operations screens: coordinates, SAR ↔ halalas, cash-on-delivery maths, CSV `cod`, support helpers. */

describe("warehouse location: coordinates and Google Maps links (E1)", () => {
  const RIYADH = { lat: 24.7136, lng: 46.6753 };
  it("reads a plain pair in every common spelling", () => {
    expect(parseCoordinates("24.7136, 46.6753")).toEqual(RIYADH);
    expect(parseCoordinates("24.7136,46.6753")).toEqual(RIYADH);
    expect(parseCoordinates("  24.7136 46.6753  ")).toEqual(RIYADH);
    expect(parseCoordinates("24.7136; 46.6753")).toEqual(RIYADH);
    expect(parseCoordinates("(24.7136, 46.6753)")).toEqual(RIYADH);
    expect(parseCoordinates("-33.8688, 151.2093")).toEqual({ lat: -33.8688, lng: 151.2093 });
  });
  it("reads Arabic and Urdu digits and separators", () => {
    expect(parseCoordinates("٢٤٫٧١٣٦، ٤٦٫٦٧٥٣")).toEqual(RIYADH);
    expect(parseCoordinates("۲۴.۷۱۳۶, ۴۶.۶۷۵۳")).toEqual(RIYADH);
  });
  it("reads Google Maps links: map centre, place pin, query forms", () => {
    expect(parseCoordinates("https://www.google.com/maps/@24.7136,46.6753,15z")).toEqual(RIYADH);
    expect(parseCoordinates("https://www.google.com/maps?q=24.7136,46.6753")).toEqual(RIYADH);
    expect(parseCoordinates("https://maps.google.com/?q=24.7136%2C46.6753")).toEqual(RIYADH);
    expect(parseCoordinates("https://www.google.com/maps?ll=24.7136,46.6753&z=14")).toEqual(RIYADH);
    expect(parseCoordinates("https://www.google.com/maps/search/?api=1&query=24.7136,46.6753")).toEqual(RIYADH);
    expect(parseCoordinates("https://www.google.com/maps?q=loc:24.7136,46.6753")).toEqual(RIYADH);
  });
  it("prefers the pin of a place page over the map centre", () => {
    const url = "https://www.google.com/maps/place/JR+Warehouse/@24.7000,46.6000,17z/data=!3m1!4b1!4m6!3m5!1s0x0:0x0!8m2!3d24.7136!4d46.6753!16s";
    expect(parseCoordinates(url)).toEqual(RIYADH);
  });
  it("reads OpenStreetMap links and degrees-minutes-seconds", () => {
    expect(parseCoordinates("https://www.openstreetmap.org/#map=17/24.7136/46.6753")).toEqual(RIYADH);
    expect(parseCoordinates("https://www.openstreetmap.org/?mlat=24.7136&mlon=46.6753")).toEqual(RIYADH);
    const dms = parseCoordinates(`24°42'48.96"N 46°40'31.08"E`);
    expect(dms?.lat).toBeCloseTo(24.7136, 4); expect(dms?.lng).toBeCloseTo(46.6753, 4);
    const west = parseCoordinates(`33°52'7.68"S 151°12'33.48"E`);
    expect(west?.lat).toBeCloseTo(-33.8688, 4); expect(west?.lng).toBeCloseTo(151.2093, 4);
  });
  it("returns null for text that has no usable point", () => {
    for (const bad of ["", "   ", "Riyadh warehouse", "https://www.google.com/maps/place/Riyadh", "95.5, 46.6", "24.7, 190", "24.7", "https://maps.app.goo.gl/AbCdEf123"]) expect(parseCoordinates(bad), bad).toBeNull();
  });
  it("recognises shortened links that cannot be read in the browser", () => {
    expect(isShortMapsLink("https://maps.app.goo.gl/AbCdEf123")).toBe(true);
    expect(isShortMapsLink("https://goo.gl/maps/xyz")).toBe(true);
    expect(isShortMapsLink("https://www.google.com/maps/@24.7,46.6,15z")).toBe(false);
  });
  it("parses one typed coordinate (decimal comma, Arabic digits) and rejects junk", () => {
    expect(parseCoordinate("24.7136")).toBe(24.7136);
    expect(parseCoordinate("24,7136")).toBe(24.7136);
    expect(parseCoordinate("٤٦٫٦٧٥٣")).toBe(46.6753);
    expect(parseCoordinate("-0.5")).toBe(-0.5);
    for (const bad of ["", "abc", "24.7.1", "24.7, 46.6", "1e3"]) expect(parseCoordinate(bad), bad).toBeNull();
  });
  it("validates the two boxes with i18n keys and rounds to 6 decimals", () => {
    expect(validateLatLng("24.7136", "46.6753")).toMatchObject({ ok: true, lat: 24.7136, lng: 46.6753 });
    expect(validateLatLng("24.71360049", "46.67530049")).toMatchObject({ ok: true, lat: 24.7136, lng: 46.6753 });
    expect(validateLatLng("", "").errors).toEqual({ lat: "val.required", lng: "val.required" });
    expect(validateLatLng("91", "46").errors).toEqual({ lat: "fob.val_lat" });
    expect(validateLatLng("24", "181").errors).toEqual({ lng: "fob.val_lng" });
    expect(validateLatLng("x", "46").ok).toBe(false);
    expect(validateLatLng("-90", "-180").ok).toBe(true);
  });
  it("builds the map link and the display text", () => {
    expect(mapsUrl(24.7136, 46.6753)).toBe("https://www.google.com/maps?q=24.7136,46.6753");
    expect(formatLatLng(24.7136, 46.6753)).toBe("24.7136, 46.6753");
  });
});

describe("SAR ↔ halalas", () => {
  it("parses amounts without floating point drift", () => {
    expect(parseSarToCents("120")).toBe(12000);
    expect(parseSarToCents("120.5")).toBe(12050);
    expect(parseSarToCents("120.50")).toBe(12050);
    expect(parseSarToCents("0.29")).toBe(29);
    expect(parseSarToCents("1.10")).toBe(110);
    expect(parseSarToCents(".5")).toBe(50);
    expect(parseSarToCents("19.99")).toBe(1999);
    expect(parseSarToCents(100000)).toBe(10_000_000);
  });
  it("accepts thousands separators, decimal commas, currency words and Arabic digits", () => {
    expect(parseSarToCents("1,250.75")).toBe(125075);
    expect(parseSarToCents("1,250")).toBe(125000);
    expect(parseSarToCents("12,5")).toBe(1250);
    expect(parseSarToCents("1.250,75")).toBe(125075);
    expect(parseSarToCents("SAR 99")).toBe(9900);
    expect(parseSarToCents("99 ر.س")).toBe(9900);
    expect(parseSarToCents("١٢٠٫٥٠")).toBe(12050);
    expect(parseSarToCents("۱۲۰")).toBe(12000);
  });
  it("treats blank as zero and rejects everything that is not an amount", () => {
    expect(parseSarToCents("")).toBe(0);
    expect(parseSarToCents("   ")).toBe(0);
    expect(parseSarToCents(null)).toBe(0);
    for (const bad of ["abc", "-5", "12.345", "1.2.3.4", "12,34,56", "1e3", ".", "12 50", "٪"]) expect(parseSarToCents(bad), bad).toBeNull();
    expect(parseSarToCents(-1)).toBeNull();
    expect(parseSarToCents(1.234)).toBeNull();
    expect(parseSarToCents(Number.NaN)).toBeNull();
  });
  it("formats halalas back into an input value", () => {
    expect(formatSarInput(12050)).toBe("120.5");
    expect(formatSarInput(12000)).toBe("120");
    expect(formatSarInput(5)).toBe("0.05");
    expect(formatSarInput(10)).toBe("0.1");
    expect(formatSarInput(0)).toBe("");
    expect(formatSarInput(null)).toBe("");
    for (const c of [1, 9, 10, 29, 99, 100, 12050, 9_999_999, COD_MAX_CENTS]) expect(parseSarToCents(formatSarInput(c)), String(c)).toBe(c);
  });
  it("applies the cash-on-delivery limits of one parcel (≤ 10 000 000 halalas)", () => {
    expect(validateCod("")).toEqual({ cents: 0 });
    expect(validateCod("120.50")).toEqual({ cents: 12050 });
    expect(validateCod("100000")).toEqual({ cents: COD_MAX_CENTS });
    expect(validateCod("100000.01").error).toBe("fob.val_cod_max");
    expect(validateCod("12x").error).toBe("fob.val_cod");
    expect(validateCod("-3").error).toBe("fob.val_cod");
  });
});

describe("cash on delivery maths", () => {
  it("sums what drivers will collect over a manifest, ignoring blanks and flagging bad boxes", () => {
    expect(sumCod([{ cod: "120.50" }, { cod: "" }, { cod: "80" }, { cod: undefined }, { cod: "0" }])).toEqual({ totalCents: 20050, parcels: 2, invalid: 0 });
    expect(sumCod([{ cod: "abc" }, { cod: "10" }, { cod: "999999" }])).toEqual({ totalCents: 1000, parcels: 1, invalid: 2 });
    expect(sumCod([])).toEqual({ totalCents: 0, parcels: 0, invalid: 0 });
  });
  it("outstanding = collected − received, never negative, server value wins", () => {
    expect(outstandingOf({ collectedCents: 10000, receivedCents: 2500 })).toBe(7500);
    expect(outstandingOf({ collectedCents: 1000, receivedCents: 5000 })).toBe(0);
    expect(outstandingOf({ collectedCents: 10000, receivedCents: 2500, outstandingCents: 7000 })).toBe(7000);
    expect(outstandingOf({})).toBe(0);
  });
  it("totals several orders", () => {
    expect(sumCash([{ collectedCents: 10000, receivedCents: 4000 }, { collectedCents: 5000, receivedCents: 5000 }, { collectedCents: 300, receivedCents: 0 }])).toEqual({ collectedCents: 15300, receivedCents: 9000, outstandingCents: 6300 });
  });
  it("checks the amount typed in 'Receive money from driver'", () => {
    expect(receiveAmountCheck("75", 7500)).toEqual({ cents: 7500 });
    expect(receiveAmountCheck("20.5", 7500)).toEqual({ cents: 2050 });
    expect(receiveAmountCheck("75.01", 7500)).toEqual({ cents: 7501, error: "max" });
    expect(receiveAmountCheck("0", 7500).error).toBe("required");
    expect(receiveAmountCheck("", 7500).error).toBe("required");
    expect(receiveAmountCheck("abc", 7500).error).toBe("invalid");
  });
  it("progress bar share is clamped", () => {
    expect(progressPct(12, 30)).toBe(40);
    expect(progressPct(0, 0)).toBe(0);
    expect(progressPct(35, 30)).toBe(100);
    expect(progressPct(-1, 30)).toBe(0);
  });
});

describe("CSV column `cod` (E17)", () => {
  it("is part of the template and survives a round trip", () => {
    expect(TEMPLATE_HEADER).toContain("cod");
    const back = parseManifestCsv(templateCsv());
    expect(back.header).toBe(true);
    expect(back.rows).toHaveLength(2);
    expect(back.rows[0].row.cod).toBe("120.5");
    expect(back.rows[1].row.cod).toBe("");
    expect(back.rows.every((r) => Object.keys(r.errors).length === 0)).toBe(true);
  });
  it("understands English and Arabic header names and decimals", () => {
    for (const h of ["cod", "COD", "cash", "Cash on delivery", "cash_on_delivery", "amount", "الدفع عند الاستلام", "المبلغ", "نقد"]) {
      const r = parseManifestCsv(`name,phone,address,${h}\nMona Ali,0555555555,King Fahd Rd 120 Riyadh,99.5`);
      expect(r.rows[0].row.cod, h).toBe("99.5");
      expect(r.rows[0].errors, h).toEqual({});
    }
  });
  it("blank means prepaid (0), Arabic digits and thousand separators are read", () => {
    const r = parseManifestCsv("name,phone,address,cod\nA One,0555555555,King Fahd Rd 120,\nB Two,0555555556,King Fahd Rd 121,\"1,250.50\"\nC Three,0555555557,King Fahd Rd 122,١٢٠");
    expect(r.rows.map((x) => x.row.cod)).toEqual(["", "1250.5", "120"]);
    expect(r.rows.every((x) => Object.keys(x.errors).length === 0)).toBe(true);
    expect(sumCod(r.rows.map((x) => x.row)).totalCents).toBe(125050 + 12000);
  });
  it("reports unreadable or too large amounts on the row", () => {
    const r = parseManifestCsv("name,phone,address,cod\nA One,0555555555,King Fahd Rd 120,abc\nB Two,0555555556,King Fahd Rd 121,100000.01\nC Three,0555555557,King Fahd Rd 122,12.345");
    expect(r.rows.map((x) => x.errors.cod)).toEqual(["fob.val_cod", "fob.val_cod_max", "fob.val_cod"]);
    expect(r.rows[0].row.cod).toBe("abc"); // kept as typed so the preview can show what was wrong
  });
  it("accepts the 8th column of a sheet without a header", () => {
    const r = parseManifestCsv("Mona Ali,0555555555,King Fahd Rd 120 Riyadh,consumer,ORD-1,Clothes,Gate 2,45");
    expect(r.header).toBe(false);
    expect(r.rows[0].row).toMatchObject({ externalRef: "ORD-1", notes: "Gate 2", cod: "45" });
  });
  it("older 7-column sheets still import (no cod = prepaid)", () => {
    const r = parseManifestCsv("Mona Ali,0555555555,King Fahd Rd 120 Riyadh,consumer,ORD-1,Clothes,Gate 2");
    expect(r.rows[0].row.cod).toBe("");
    expect(r.rows[0].errors).toEqual({});
  });
});

describe("manifest row ↔ wire format", () => {
  it("sends integer halalas only when there is something to collect", () => {
    expect(toWire(emptyRow({ recipientName: "Mona", cod: "120.50" }))).toMatchObject({ codCents: 12050 });
    expect("codCents" in toWire(emptyRow({ recipientName: "Mona", cod: "" }))).toBe(false);
    expect("codCents" in toWire(emptyRow({ recipientName: "Mona", cod: "0" }))).toBe(false);
    expect(Number.isInteger((toWire(emptyRow({ cod: "19.99" })) as { codCents: number }).codCents)).toBe(true);
  });
  it("validates the box and reloads a saved draft's amount", () => {
    expect(validateRow(emptyRow({ cod: "12x" }), { partial: true }).cod).toBe("fob.val_cod");
    expect(validateRow(emptyRow({ cod: "5" }), { partial: true }).cod).toBeUndefined();
    expect(fromServer({ codCents: 12050 }).cod).toBe("120.5");
    expect(fromServer({ codCents: 0 }).cod).toBe("");
    expect(fromServer({}).cod).toBe("");
  });
  it("a placeholder parcel with a cash amount is information: it stays an editable row", () => {
    expect(isBlankRow(emptyRow({ cod: "10" }))).toBe(false);
    const m = splitServerManifest([{ recipientName: "", recipientPhone: "", address: "", detailsComplete: false, codCents: 5000 }, { recipientName: "", recipientPhone: "", address: "", detailsComplete: false }]);
    expect(m.blank).toBe(1);
    expect(m.rows).toHaveLength(1);
  });
  it("maps the server's per-row `codCents` problem onto the cod box", () => {
    expect(mapServerRowErrors({ "shipments.2.codCents": "too big", field: "shipments.2.codCents" }).get(2)).toEqual({ cod: "fob.val_cod" });
  });
});

describe("support tickets: attachments, waiting cue, reopen (E15)", () => {
  const file = (over: Partial<{ size: number; type: string; name: string }> = {}) => ({ size: 1000, type: "image/png", name: "a.png", ...over });
  it("accepts up to three jpg / png / webp / pdf files of at most 8 MB", () => {
    expect(ATTACH_MAX).toBe(3);
    expect(attachmentProblem(file(), 0)).toBeNull();
    expect(attachmentProblem(file({ type: "application/pdf", name: "x.pdf" }), 2)).toBeNull();
    expect(attachmentProblem(file(), 3)).toBe("fob.att_too_many");
    expect(attachmentProblem(file({ type: "image/gif", name: "a.gif" }), 0)).toBe("fob.att_bad_type");
    expect(attachmentProblem(file({ size: 8 * 1024 * 1024 + 1 }), 0)).toBe("fob.att_too_big");
    expect(attachmentProblem(file({ size: 8 * 1024 * 1024 }), 0)).toBeNull();
    expect(attachmentProblem(file({ type: "", name: "scan.PDF" }), 0)).toBeNull(); // some browsers send no type
    expect(attachmentProblem(file({ size: 0 }), 0)).toBe("fob.att_bad_type");
  });
  it("flags tickets support answered since the customer last looked", () => {
    const t = { id: "t1", status: "in_review", updatedAt: "2026-11-19T10:00:00Z" };
    expect(ticketNeedsYou(t, {})).toBe(true);
    expect(ticketNeedsYou(t, { t1: "2026-11-19T10:00:00Z" })).toBe(false);
    expect(ticketNeedsYou(t, { t1: "2026-11-19T09:00:00Z" })).toBe(true);
    expect(ticketNeedsYou({ ...t, status: "open" }, {})).toBe(false);
    expect(ticketNeedsYou({ ...t, status: "resolved" }, {})).toBe(false);
    expect(ticketNeedsYou({ id: "t2", status: "in_review" }, {})).toBe(false);
  });
  it("offers reopen for 14 days after resolving", () => {
    const now = Date.parse("2026-11-19T12:00:00Z");
    expect(reopenWindowOpen({ id: "t", status: "resolved", resolvedAt: "2026-11-10T12:00:00Z" }, now)).toBe(true);
    expect(reopenWindowOpen({ id: "t", status: "resolved", resolvedAt: "2026-11-05T11:59:00Z" }, now)).toBe(false);
    expect(reopenWindowOpen({ id: "t", status: "resolved", resolvedAt: "2026-11-05T12:00:00Z" }, now)).toBe(true);
    expect(reopenWindowOpen({ id: "t", status: "open", resolvedAt: null }, now)).toBe(false);
    expect(reopenWindowOpen({ id: "t", status: "resolved" }, now)).toBe(true); // unknown date: let the server decide
  });
  it("shows an assignee name when there is one, otherwise just that somebody is assigned", () => {
    expect(isAssigned({ assignedTo: "uuid" })).toBe(true);
    expect(isAssigned({ assignedTo: null })).toBe(false);
    expect(assigneeName({ assignedTo: "uuid" })).toBeNull();
    expect(assigneeName({ assignedTo: "uuid", assignedToName: " Sara " })).toBe("Sara");
    expect(assigneeName({ assignedTo: { id: "u", name: "Omar" } })).toBe("Omar");
  });
});

describe("every key the pure helpers return exists in en, ar and ur", () => {
  const keys = ["val.required", "fob.val_lat", "fob.val_lng", "fob.val_cod", "fob.val_cod_max", "fob.att_too_many", "fob.att_bad_type", "fob.att_too_big"];
  it.each(keys)("%s", (k) => { expect(en[k]).toBeTruthy(); expect(ar[k]).toBeTruthy(); expect(ur[k]).toBeTruthy(); });
});
