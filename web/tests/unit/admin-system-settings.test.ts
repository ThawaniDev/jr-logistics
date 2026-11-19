import { describe, expect, it } from "vitest";
import { LEGACY_SETTINGS_KEYS, FIELDOPS_KEYS } from "@/components/features/admin-fieldops-lib";
import { SETTINGS_ORDER, SETTINGS_PATH, SETTINGS_SECTIONS, rangeErrors, sectionOfKey, sectionState, touchedSections, withoutSection } from "@/components/features/admin-system-settings-lib";

const server: Record<string, unknown> = {
  enabledServices: ["delivery_driver", "car_with_driver"], vatPct: 15, cancelPolicyEnabled: true, cancelWarnAt: 2, cancelSuspendAt: 4, cancelWindowDays: 7, cancelSuspendDays: 3, lateGraceMin: 30, checkinEarlyMin: 180,
  overlapPolicy: "time_window", requireBusinessVerification: true, requireDriverVerification: true, requireStaffMfa: false, minWithdrawalCents: 10000, termsVersion: "1.0", termsBusiness: "a", termsDriver: "b", termsOffice: "c",
  cities: [{ key: "riyadh", ar: "الرياض", en: "Riyadh", ur: "ریاض", lat: 24.7, lng: 46.6, pickup: true, delivery: true }],
  arrivalGeofenceEnabled: true, arrivalRadiusM: 200, stopWaitMin: 0, settlementPeriod: "weekly", separationOfDuties: true,
  warehouseDefaults: { requireArrivalConfirmation: true, requireLoadingRecord: false, requireDeliveryOtp: true, requireSignature: false },
};

describe("settings sections", () => {
  it("covers every setting the legacy form saved and every field-operations key exactly once", () => {
    const all = SETTINGS_ORDER.flatMap((s) => [...SETTINGS_SECTIONS[s]]);
    for (const k of [...LEGACY_SETTINGS_KEYS, ...FIELDOPS_KEYS]) expect(all.filter((x) => x === k), k).toHaveLength(1);
    expect(new Set(all).size).toBe(all.length);
    expect(all).not.toContain("settlementPeriod"); expect(all).not.toContain("separationOfDuties");
  });
  it("has one route per section, the first being /admin/settings itself", () => {
    expect(SETTINGS_ORDER[0]).toBe("general"); expect(SETTINGS_PATH.general).toBe("/admin/settings");
    expect(new Set(Object.values(SETTINGS_PATH)).size).toBe(SETTINGS_ORDER.length);
    for (const p of Object.values(SETTINGS_PATH)) expect(p.startsWith("/admin/settings")).toBe(true);
    expect(SETTINGS_PATH.fieldops).toBe("/admin/settings/field-operations");
  });
  it("finds the section of a key", () => {
    expect(sectionOfKey("vatPct")).toBe("finance"); expect(sectionOfKey("arrivalRadiusM")).toBe("fieldops"); expect(sectionOfKey("cities")).toBe("general"); expect(sectionOfKey("nope")).toBeNull();
  });
});

describe("range checks (mirror PATCH /admin/settings)", () => {
  it("accepts values inside the range and flags the rest", () => {
    expect(rangeErrors({ vatPct: 15, cancelWarnAt: 2, lateGraceMin: 0, checkinEarlyMin: 1440, minWithdrawalCents: 0 })).toEqual({});
    expect(rangeErrors({ vatPct: 31 })).toEqual({ vatPct: "range" }); expect(rangeErrors({ vatPct: 12.5 })).toEqual({}); expect(rangeErrors({ cancelWarnAt: 0 })).toEqual({ cancelWarnAt: "range" });
    expect(rangeErrors({ cancelWarnAt: 1.5 })).toEqual({ cancelWarnAt: "range" }); expect(rangeErrors({ lateGraceMin: NaN })).toEqual({ lateGraceMin: "range" });
    expect(rangeErrors({ cancelWindowDays: 91 })).toEqual({ cancelWindowDays: "range" }); expect(rangeErrors({ minWithdrawalCents: -1 })).toEqual({ minWithdrawalCents: "range" });
    expect(rangeErrors({ minWithdrawalCents: 1_000_000_001 })).toEqual({ minWithdrawalCents: "range" });
  });
  it("only checks what was edited and ignores unknown keys", () => {
    expect(rangeErrors({})).toEqual({}); expect(rangeErrors({ termsVersion: "999" })).toEqual({});
  });
});

describe("what a sub-page saves", () => {
  it("is empty and clean when nothing was edited", () => {
    expect(sectionState(server, {}, "finance")).toEqual({ patch: {}, errors: {}, touched: false, dirty: false, invalid: false });
    expect(sectionState(null, { vatPct: 10 }, "finance")).toMatchObject({ patch: {}, touched: true, dirty: false });
  });
  it("sends only the changed keys of its own page", () => {
    const edits = { vatPct: 12, lateGraceMin: 45, termsVersion: "2.0" };
    expect(sectionState(server, edits, "finance")).toMatchObject({ patch: { vatPct: 12 }, touched: true, dirty: true, invalid: false });
    expect(sectionState(server, edits, "jobs").patch).toEqual({ lateGraceMin: 45 });
    expect(sectionState(server, edits, "terms").patch).toEqual({ termsVersion: "2.0" });
    expect(sectionState(server, edits, "general")).toMatchObject({ patch: {}, touched: false, dirty: false });
  });
  it("does not re-send values that equal the stored ones (and is not dirty)", () => {
    const s = sectionState(server, { vatPct: 15, enabledServices: ["delivery_driver", "car_with_driver"] }, "finance");
    expect(s).toMatchObject({ patch: {}, touched: true, dirty: false });
    expect(sectionState(server, { enabledServices: ["delivery_driver", "car_with_driver"] }, "general")).toMatchObject({ patch: {}, dirty: false });
    expect(sectionState(server, { enabledServices: ["delivery_driver"] }, "general").patch).toEqual({ enabledServices: ["delivery_driver"] });
  });
  it("sends a changed city list whole", () => {
    const cities = [...(server.cities as object[]), { key: "jeddah", ar: "جدة", en: "Jeddah", ur: "جدہ", lat: 21.5, lng: 39.2, pickup: true, delivery: true }];
    expect(sectionState(server, { cities }, "general").patch).toEqual({ cities });
  });
  it("normalises field-operations values like the legacy form and drops invalid ones", () => {
    expect(sectionState(server, { arrivalRadiusM: "350", stopWaitMin: "5" }, "fieldops")).toMatchObject({ patch: { arrivalRadiusM: 350, stopWaitMin: 5 }, dirty: true, invalid: false });
    const bad = sectionState(server, { arrivalRadiusM: "10" }, "fieldops");
    expect(bad).toMatchObject({ patch: {}, dirty: false, invalid: true, errors: { arrivalRadiusM: "range" } });
    expect(sectionState(server, { arrivalGeofenceEnabled: false }, "fieldops").patch).toEqual({ arrivalGeofenceEnabled: false });
    expect(sectionState(server, { warehouseDefaults: { ...(server.warehouseDefaults as object), requireSignature: true } }, "fieldops").patch).toEqual({ warehouseDefaults: { requireArrivalConfirmation: true, requireLoadingRecord: false, requireDeliveryOtp: true, requireSignature: true } });
  });
  it("blocks Save on an out-of-range legacy value", () => {
    expect(sectionState(server, { vatPct: 50 }, "finance")).toMatchObject({ dirty: true, invalid: true, errors: { vatPct: "range" } });
    expect(sectionState(server, { cancelWarnAt: NaN }, "jobs").invalid).toBe(true);
  });
  it("sends the security switch alone", () => {
    expect(sectionState(server, { requireStaffMfa: true }, "security").patch).toEqual({ requireStaffMfa: true });
    expect(sectionState(server, { requireStaffMfa: false }, "security").patch).toEqual({});
  });
});

describe("edits across tabs", () => {
  it("removes only one page's edits after Save / Discard and lists the pages that still have some", () => {
    const edits = { vatPct: 12, lateGraceMin: 45, arrivalRadiusM: "300" };
    expect(touchedSections(edits)).toEqual(["jobs", "fieldops", "finance"]);
    expect(withoutSection(edits, "finance")).toEqual({ lateGraceMin: 45, arrivalRadiusM: "300" });
    expect(touchedSections(withoutSection(edits, "finance"))).toEqual(["jobs", "fieldops"]);
    expect(touchedSections({})).toEqual([]);
  });
});
