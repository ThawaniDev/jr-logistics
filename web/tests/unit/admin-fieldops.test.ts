import { describe, it, expect } from "vitest";
import {
  FIELDOPS_DEFAULTS, LEGACY_SETTINGS_KEYS, WAREHOUSE_SWITCHES, attachmentKind, attachmentUrl, buildSettingsPatch, buildWarehousePatch, centsToSarText, checkReceiveAmount, driversOf, effectiveOf,
  fieldopsErrors, filterByOpenerRole, fmtBytes, intInRange, isEmptyPatch, mapsLink, normalizeDigits, ordersOf, overrideFromTri, parseCoordinates, parseOneCoord, parseSarToCents,
  receiveMaxFrom, scopeCodRows, settingValue, settlementKind, ticketFileProblem, ticketPatch, triFromOverride, uniqueWarehouses, validLatLng, warehouseDefaultsOf, warehouseFormFrom, type CodRow,
} from "@/components/features/admin-fieldops-lib";

describe("coordinates", () => {
  it("parses plain pairs", () => {
    expect(parseCoordinates("24.7136, 46.6753")).toEqual({ lat: 24.7136, lng: 46.6753 });
    expect(parseCoordinates("24.7136 46.6753")).toEqual({ lat: 24.7136, lng: 46.6753 });
    expect(parseCoordinates("  -33.8688;151.2093 ")).toEqual({ lat: -33.8688, lng: 151.2093 });
    expect(parseCoordinates("24.7136° N, 46.6753° E")).toEqual({ lat: 24.7136, lng: 46.6753 });
    expect(parseCoordinates("33.9° S, 18.4° W")).toEqual({ lat: -33.9, lng: -18.4 });
  });
  it("parses Arabic-Indic digits and separators", () => {
    expect(normalizeDigits("٢٤٫٧١٣٦، ٤٦٫٦٧٥٣")).toBe("24.7136, 46.6753");
    expect(parseCoordinates("٢٤٫٧١٣٦، ٤٦٫٦٧٥٣")).toEqual({ lat: 24.7136, lng: 46.6753 });
  });
  it("parses Google Maps links, preferring the pin over the viewport", () => {
    expect(parseCoordinates("https://www.google.com/maps/place/Riyadh/@24.7136,46.6753,12z")).toEqual({ lat: 24.7136, lng: 46.6753 });
    expect(parseCoordinates("https://www.google.com/maps/place/X/@24.5,46.5,17z/data=!3m1!4b1!4m6!3m5!1s0x0:0x0!8m2!3d24.7001!4d46.7002")).toEqual({ lat: 24.7001, lng: 46.7002 });
    expect(parseCoordinates("https://maps.google.com/?q=24.7136,46.6753")).toEqual({ lat: 24.7136, lng: 46.6753 });
    expect(parseCoordinates("https://www.google.com/maps?q=24.7136%2C46.6753")).toEqual({ lat: 24.7136, lng: 46.6753 });
    expect(parseCoordinates("https://www.google.com/maps/search/?api=1&query=24.7136,46.6753")).toEqual({ lat: 24.7136, lng: 46.6753 });
    expect(parseCoordinates("geo:24.7136,46.6753")).toEqual({ lat: 24.7136, lng: 46.6753 });
  });
  it("rejects junk, short links and out-of-range values", () => {
    expect(parseCoordinates("")).toBeNull();
    expect(parseCoordinates("hello")).toBeNull();
    expect(parseCoordinates("https://maps.app.goo.gl/AbCdEf123")).toBeNull();
    expect(parseCoordinates("124.7, 46.6")).toBeNull();
    expect(parseCoordinates("24.7, 246.6")).toBeNull();
    expect(parseCoordinates("0, 0")).toBeNull();
    expect(validLatLng(90, 180)).toBe(true);
    expect(validLatLng(90.01, 0)).toBe(false);
  });
  it("parses a single coordinate box", () => {
    expect(parseOneCoord("24.7136")).toBe(24.7136);
    expect(parseOneCoord(" -46.5 ")).toBe(-46.5);
    expect(parseOneCoord("٤٦٫٥")).toBe(46.5);
    expect(parseOneCoord("24.7, 46.6")).toBeNull();
    expect(parseOneCoord("")).toBeNull();
    expect(parseOneCoord("abc")).toBeNull();
  });
  it("builds a map link", () => { expect(mapsLink(24.7136, 46.6753)).toBe("https://www.google.com/maps?q=24.7136,46.6753"); });
});

describe("warehouse tri-state switches", () => {
  it("maps override <-> tri-state both ways", () => {
    expect(triFromOverride(true)).toBe("on"); expect(triFromOverride(false)).toBe("off");
    expect(triFromOverride(null)).toBe("inherit"); expect(triFromOverride(undefined)).toBe("inherit");
    expect(overrideFromTri("on")).toBe(true); expect(overrideFromTri("off")).toBe(false); expect(overrideFromTri("inherit")).toBeNull();
    for (const v of [true, false, null] as const) expect(overrideFromTri(triFromOverride(v))).toBe(v);
  });
  it("computes the effective value from the platform default", () => {
    expect(effectiveOf("inherit", true)).toBe(true); expect(effectiveOf("inherit", false)).toBe(false);
    expect(effectiveOf("on", false)).toBe(true); expect(effectiveOf("off", true)).toBe(false);
  });
  const data = { lat: 24.7, lng: 46.6, overrides: { requireArrivalConfirmation: null, requireLoadingRecord: true, requireDeliveryOtp: false, requireSignature: null }, defaults: { requireArrivalConfirmation: true } };
  it("builds the form from the API data", () => {
    const f = warehouseFormFrom(data);
    expect(f.lat).toBe("24.7"); expect(f.lng).toBe("46.6");
    expect(f.ops).toEqual({ requireArrivalConfirmation: "inherit", requireLoadingRecord: "on", requireDeliveryOtp: "off", requireSignature: "inherit" });
    expect(warehouseFormFrom(null).lat).toBe("");
  });
  it("sends nothing when nothing changed", () => {
    const r = buildWarehousePatch(data, warehouseFormFrom(data));
    expect(r.problem).toBeUndefined(); expect(isEmptyPatch(r.patch)).toBe(true);
  });
  it("sends only the changed switches, null meaning inherit", () => {
    const f = warehouseFormFrom(data);
    f.ops.requireLoadingRecord = "inherit"; f.ops.requireSignature = "on";
    expect(buildWarehousePatch(data, f).patch).toEqual({ ops: { requireLoadingRecord: null, requireSignature: true } });
  });
  it("sends the location as a pair and only when it changed", () => {
    const f = warehouseFormFrom(data); f.lat = "24.8"; f.lng = "46.7";
    expect(buildWarehousePatch(data, f).patch).toEqual({ lat: 24.8, lng: 46.7 });
    const g = warehouseFormFrom(data); g.lat = "24.7"; g.lng = "46.6";
    expect(isEmptyPatch(buildWarehousePatch(data, g).patch)).toBe(true);
    const first = warehouseFormFrom(null); first.lat = "24.5"; first.lng = "46.5";
    expect(buildWarehousePatch(null, first).patch).toEqual({ lat: 24.5, lng: 46.5 });
  });
  it("reports half-filled and invalid locations; an empty location is no change", () => {
    const f = warehouseFormFrom(data); f.lng = "";
    expect(buildWarehousePatch(data, f).problem).toBe("coords_pair");
    f.lng = "999"; expect(buildWarehousePatch(data, f).problem).toBe("coords_invalid");
    f.lat = "x"; f.lng = "46"; expect(buildWarehousePatch(data, f).problem).toBe("coords_invalid");
    const none = warehouseFormFrom(null);
    expect(buildWarehousePatch(null, none)).toEqual({ patch: {} });
    expect(WAREHOUSE_SWITCHES).toHaveLength(4);
  });
});

describe("platform settings patch (E.0)", () => {
  const server: Record<string, unknown> = {
    enabledServices: ["delivery_driver"], vatPct: 15, cancelPolicyEnabled: true, cancelWarnAt: 3, cancelSuspendAt: 5, cancelWindowDays: 30, cancelSuspendDays: 7, lateGraceMin: 10, checkinEarlyMin: 60,
    overlapPolicy: "time_window", requireBusinessVerification: true, requireDriverVerification: true, requireStaffMfa: false, minWithdrawalCents: 5000, termsVersion: "1", termsBusiness: "a", termsDriver: "b", termsOffice: "c", cities: [],
    settlementPeriod: "weekly", separationOfDuties: true, stopWaitMin: 0, arrivalGeofenceEnabled: true, arrivalRadiusM: 200,
    warehouseDefaults: { requireArrivalConfirmation: true, requireLoadingRecord: false, requireDeliveryOtp: true, requireSignature: false },
  };
  it("always re-sends the legacy keys but never settlementPeriod / separationOfDuties / stopWaitMin unless changed", () => {
    const p = buildSettingsPatch(server, {});
    expect(Object.keys(p).sort()).toEqual([...LEGACY_SETTINGS_KEYS].sort());
    expect(p).not.toHaveProperty("settlementPeriod"); expect(p).not.toHaveProperty("separationOfDuties"); expect(p).not.toHaveProperty("stopWaitMin");
  });
  it("sends a new field only when it differs from the stored value", () => {
    expect(buildSettingsPatch(server, { arrivalGeofenceEnabled: true })).not.toHaveProperty("arrivalGeofenceEnabled");
    expect(buildSettingsPatch(server, { arrivalGeofenceEnabled: false })).toMatchObject({ arrivalGeofenceEnabled: false });
    expect(buildSettingsPatch(server, { driverCanReorderRoute: false, stopFailStrictRules: true })).toMatchObject({ driverCanReorderRoute: false, stopFailStrictRules: true });
    // missing from an older server = platform default (true) → switching it on is not a change, off is
    expect(buildSettingsPatch(server, { rescheduleEvidencePhoto: true })).not.toHaveProperty("rescheduleEvidencePhoto");
    expect(buildSettingsPatch(server, { rescheduleEvidencePhoto: false })).toMatchObject({ rescheduleEvidencePhoto: false });
  });
  it("coerces typed numbers and drops invalid ones", () => {
    expect(buildSettingsPatch(server, { arrivalRadiusM: "350" })).toMatchObject({ arrivalRadiusM: 350 });
    expect(buildSettingsPatch(server, { arrivalRadiusM: "200" })).not.toHaveProperty("arrivalRadiusM");
    expect(buildSettingsPatch(server, { arrivalRadiusM: "19" })).not.toHaveProperty("arrivalRadiusM");
    expect(buildSettingsPatch(server, { arrivalRadiusM: "5001" })).not.toHaveProperty("arrivalRadiusM");
    expect(buildSettingsPatch(server, { arrivalRadiusM: "" })).not.toHaveProperty("arrivalRadiusM");
    expect(buildSettingsPatch(server, { stopWaitMin: "15" })).toMatchObject({ stopWaitMin: 15 });
    expect(buildSettingsPatch(server, { stopWaitMin: "0" })).not.toHaveProperty("stopWaitMin");
    expect(buildSettingsPatch(server, { stopWaitMin: "121" })).not.toHaveProperty("stopWaitMin");
  });
  it("validates ranges", () => {
    expect(intInRange("20", 20, 5000)).toBe(20); expect(intInRange("5000", 20, 5000)).toBe(5000);
    expect(intInRange("19", 20, 5000)).toBeNull(); expect(intInRange("1.5", 0, 10)).toBeNull(); expect(intInRange("-1", 0, 10)).toBeNull(); expect(intInRange("", 0, 10)).toBeNull();
    expect(intInRange(7, 0, 10)).toBe(7); expect(intInRange("٧", 0, 10)).toBe(7);
    expect(fieldopsErrors({})).toEqual({});
    expect(fieldopsErrors({ arrivalRadiusM: "10", stopWaitMin: "5" })).toEqual({ arrivalRadiusM: "range" });
    expect(fieldopsErrors({ stopWaitMin: "abc" })).toEqual({ stopWaitMin: "range" });
  });
  it("sends the whole warehouseDefaults object only when a default changed", () => {
    const same = { ...(server.warehouseDefaults as object) };
    expect(buildSettingsPatch(server, { warehouseDefaults: same })).not.toHaveProperty("warehouseDefaults");
    const p = buildSettingsPatch(server, { warehouseDefaults: { ...same, requireSignature: true } });
    expect(p.warehouseDefaults).toEqual({ requireArrivalConfirmation: true, requireLoadingRecord: false, requireDeliveryOtp: true, requireSignature: true });
  });
  it("falls back to the platform defaults for values an older server does not send", () => {
    expect(settingValue({}, {}, "arrivalRadiusM")).toBe(FIELDOPS_DEFAULTS.arrivalRadiusM);
    expect(settingValue({}, {}, "stopWaitMin")).toBe(0);
    expect(settingValue({ driverSingleActiveJob: false }, {}, "driverSingleActiveJob")).toBe(false);
    expect(settingValue({ driverSingleActiveJob: false }, { driverSingleActiveJob: true }, "driverSingleActiveJob")).toBe(true);
    expect(warehouseDefaultsOf({}, {})).toEqual({ requireArrivalConfirmation: true, requireLoadingRecord: false, requireDeliveryOtp: true, requireSignature: false });
    expect(warehouseDefaultsOf({ warehouseDefaults: { requireLoadingRecord: true } }, {}).requireLoadingRecord).toBe(true);
  });
});

describe("cash on delivery", () => {
  it("parses SAR text into halalas without float drift", () => {
    expect(parseSarToCents("12.5")).toBe(1250); expect(parseSarToCents("12,50")).toBe(1250); expect(parseSarToCents("0.07")).toBe(7); expect(parseSarToCents("1230")).toBe(123000);
    expect(parseSarToCents("١٢٫٥")).toBe(1250); expect(parseSarToCents("19.99")).toBe(1999); expect(parseSarToCents("0.1")).toBe(10);
    expect(parseSarToCents("0")).toBeNull(); expect(parseSarToCents("-5")).toBeNull(); expect(parseSarToCents("1.234")).toBeNull(); expect(parseSarToCents("")).toBeNull(); expect(parseSarToCents("abc")).toBeNull();
    expect(centsToSarText(123000)).toBe("1230.00"); expect(centsToSarText(7)).toBe("0.07");
  });
  it("accepts amounts up to the outstanding and flags the rest", () => {
    expect(checkReceiveAmount("100", 10000)).toEqual({ cents: 10000 });
    expect(checkReceiveAmount("40.50", 10000)).toEqual({ cents: 4050 });
    expect(checkReceiveAmount("100.01", 10000)).toEqual({ cents: 10001, problem: "max" });
    expect(checkReceiveAmount("0", 10000)).toEqual({ cents: null, problem: "invalid" });
    expect(checkReceiveAmount("x", 10000).problem).toBe("invalid");
  });
  it("reads the server's max from a VALIDATION error", () => {
    expect(receiveMaxFrom({ field: "amountCents", max: 2500 })).toBe(2500);
    expect(receiveMaxFrom({ max: "2500" })).toBe(2500);
    expect(receiveMaxFrom({ field: "amountCents", max: 0 })).toBe(0);
    expect(receiveMaxFrom({ field: "note", max: 5 })).toBeNull();
    expect(receiveMaxFrom({ field: "amountCents" })).toBeNull();
    expect(receiveMaxFrom(undefined)).toBeNull();
  });
  const rows: CodRow[] = [
    { offerId: "o1", ref: "JR-1", businessId: "b1", businessName: "Zeta", driverId: "d1", driverName: "Omar", collectedCents: 1000, receivedCents: 0, outstandingCents: 1000 },
    { offerId: "o2", ref: "JR-2", businessId: "b1", businessName: "Zeta", driverId: "d2", driverName: "Ali", collectedCents: 500, receivedCents: 100, outstandingCents: 400 },
    { offerId: "o3", ref: "JR-3", businessId: "b2", businessName: "Alpha", driverId: "d1", driverName: "Omar", collectedCents: 700, receivedCents: 0, outstandingCents: 700 },
  ];
  it("derives the warehouse → driver → order chooser from the rows", () => {
    expect(uniqueWarehouses(rows).map((w) => w.name)).toEqual(["Alpha", "Zeta"]);
    expect(driversOf(rows, "b1").map((d) => d.name)).toEqual(["Ali", "Omar"]);
    expect(driversOf(rows, "").map((d) => d.id)).toEqual(["d2", "d1"]);
    expect(ordersOf(rows, "b1", "d1").map((o) => o.offerId)).toEqual(["o1"]);
    expect(ordersOf(rows, "b2", "d2")).toEqual([]);
  });
  it("counts what the warehouse / driver / search filters leave, like the server filters", () => {
    expect(scopeCodRows(rows, {})).toMatchObject({ outstanding: 3, all: 3 });
    expect(scopeCodRows(rows, { businessId: "b1" }).rows.map((r) => r.offerId)).toEqual(["o1", "o2"]);
    expect(scopeCodRows(rows, { driverId: "d1" }).all).toBe(2);
    expect(scopeCodRows(rows, { q: "  alpha " }).rows.map((r) => r.offerId)).toEqual(["o3"]);
    expect(scopeCodRows(rows, { q: "jr-2" }).rows.map((r) => r.offerId)).toEqual(["o2"]);
    expect(scopeCodRows(rows, { q: "omar", businessId: "b2" }).all).toBe(1);
    expect(scopeCodRows([...rows, { ...rows[0], offerId: "o4", outstandingCents: 0, receivedCents: 1000 }], { driverId: "d1" })).toMatchObject({ all: 3, outstanding: 2 });
    expect(scopeCodRows(rows, { q: "nobody" })).toEqual({ rows: [], outstanding: 0, all: 0 });
  });
});

describe("finance history (E18)", () => {
  it("classifies settlements", () => {
    expect(settlementKind({ status: "paid" })).toBe("paid");
    expect(settlementKind({ status: "approved" })).toBe("hold");
    expect(settlementKind({ status: "pending_review", held: true })).toBe("hold");
    expect(settlementKind({ status: "paid", held: true })).toBe("paid");
    for (const s of ["pending_review", "reviewed", "failed", "rejected", "weird"]) expect(settlementKind({ status: s })).toBe("legacy");
  });
});

describe("support helpers", () => {
  it("tells attachment kinds apart and builds the download url", () => {
    expect(attachmentKind("image/png")).toBe("image"); expect(attachmentKind("IMAGE/JPEG")).toBe("image"); expect(attachmentKind("image/webp")).toBe("image");
    expect(attachmentKind("application/pdf")).toBe("pdf"); expect(attachmentKind("image/svg+xml")).toBe("file"); expect(attachmentKind(null)).toBe("file");
    expect(attachmentUrl("abc-123")).toBe("/api/v1/tickets/attachments/abc-123");
  });
  it("formats sizes and checks uploads", () => {
    expect(fmtBytes(512)).toBe("512 B"); expect(fmtBytes(2048)).toBe("2 KB"); expect(fmtBytes(5 * 1024 * 1024)).toBe("5 MB"); expect(fmtBytes(undefined)).toBe("");
    expect(ticketFileProblem({ type: "image/png", size: 1000 })).toBeNull();
    expect(ticketFileProblem({ type: "image/gif", size: 1000 })).toBe("type");
    expect(ticketFileProblem({ type: "application/pdf", size: 9 * 1024 * 1024 })).toBe("size");
  });
  it("filters by opener role", () => {
    const items = [{ id: 1, openedByRole: "driver" }, { id: 2, openedByRole: "business" }, { id: 3, openedByRole: "driver" }];
    expect(filterByOpenerRole(items, "driver").map((x) => x.id)).toEqual([1, 3]);
    expect(filterByOpenerRole(items, "")).toHaveLength(3);
    expect(filterByOpenerRole(items, "office")).toEqual([]);
  });
  it("builds the minimal ticket PATCH", () => {
    const t = { status: "open", priority: "normal", assignedTo: null as string | null };
    expect(ticketPatch(t, { status: "open" })).toBeNull();
    expect(ticketPatch(t, { status: "in_review" })).toEqual({ status: "in_review" });
    expect(ticketPatch(t, { status: "bogus" })).toBeNull();
    expect(ticketPatch(t, { priority: "urgent" })).toEqual({ priority: "urgent" });
    expect(ticketPatch(t, { assignedTo: "u1" })).toEqual({ assignTo: "u1" });
    expect(ticketPatch({ ...t, assignedTo: "u1" }, { assignedTo: "" })).toEqual({ assignTo: null });
    expect(ticketPatch({ ...t, assignedTo: "u1" }, { assignedTo: "u1" })).toBeNull();
    expect(ticketPatch(t, { assignToMe: true })).toEqual({ assignToMe: true });
  });
});
