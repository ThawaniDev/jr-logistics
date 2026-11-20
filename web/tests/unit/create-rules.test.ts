/**
 * Server-side rules of admin account creation / editing (decision G1): cleaning and validation per kind of account, the sensitive-field gate,
 * the audit diff and its masking. Pure — no database.
 */
import { describe, it, expect } from "vitest";
import { checkFields, diffFields, isAccountKind, maskDiff, maskPhone, normalizeIban, sensitiveIn, validPoint, SENSITIVE_FIELDS, PROFILE_FIELDS } from "@/server/account-admin-rules";
import { ALL_PERMISSIONS, STAFF_PRESETS } from "@/server/catalog";

const ctx = { cityKeys: ["riyadh", "jeddah"], enabledServices: ["delivery_driver", "car_with_driver"] };
const holder = { name: "Sara Ali", phone: "0501234567", city: "riyadh" };
const IBAN = "SA0380000000608010167519";

describe("business accounts", () => {
  it("accepts a complete company and normalises phone, email, numbers and the pin", () => {
    const r = checkFields("business", { ...holder, phone: "٠٥٠١٢٣٤٥٦٧", email: " Sara@Example.COM ", companyName: " Alpha Trading ", crNumber: "١٠١٠١٢٣٤٥٦", industry: "Retail", lat: "24.7136", lng: 46.6753, language: "en" }, ctx);
    expect(r.errors).toEqual({});
    expect(r.values).toMatchObject({ name: "Sara Ali", phone: "+966501234567", email: "sara@example.com", companyName: "Alpha Trading", crNumber: "1010123456", industry: "Retail", city: "riyadh", language: "en", lat: 24.7136, lng: 46.6753 });
  });
  it("requires name, phone, city and company name on create, but not on a partial edit", () => {
    const r = checkFields("business", {}, ctx);
    expect(Object.keys(r.errors).sort()).toEqual(["city", "companyName", "name", "phone"]);
    expect(checkFields("business", { industry: "Food" }, ctx, { partial: true }).errors).toEqual({});
  });
  it("never lets an edit empty a required field", () => {
    const r = checkFields("business", { name: " ", companyName: "", city: "" }, ctx, { partial: true });
    expect(Object.keys(r.errors).sort()).toEqual(["city", "companyName", "name"]);
  });
  it("rejects a malformed phone, email, unknown city, language and registration number", () => {
    const r = checkFields("business", { ...holder, phone: "12", email: "nope", city: "atlantis", language: "fr", companyName: "A", crNumber: "<script>" }, ctx);
    expect(Object.keys(r.errors).sort()).toEqual(["city", "companyName", "crNumber", "email", "language", "phone"]);
  });
  it("allows clearing optional text with null or an empty string", () => {
    const r = checkFields("business", { email: "", industry: null, address: " " }, ctx, { partial: true });
    expect(r.errors).toEqual({});
    expect(r.values).toMatchObject({ email: null, industry: null, address: null });
  });
  it("takes the warehouse pin as a pair inside the valid range", () => {
    expect(checkFields("business", { ...holder, companyName: "Co", lat: 24.7 }, ctx).errors.lng).toMatch(/both/i);
    expect(checkFields("business", { ...holder, companyName: "Co", lat: 91, lng: 40 }, ctx).errors.lat).toMatch(/range/i);
    expect(checkFields("business", { ...holder, companyName: "Co", lat: 0, lng: 0 }, ctx).errors.lat).toMatch(/range/i);
    expect(checkFields("business", { ...holder, companyName: "Co", lat: null, lng: null }, ctx).errors).toEqual({});
    expect(checkFields("business", { lat: 25 }, ctx, { partial: true, current: { lat: 24, lng: 46 } }).values).toMatchObject({ lat: 25, lng: 46 }); // the other half comes from the stored pin
  });
  it("flags fields that belong to another kind of account", () => {
    const r = checkFields("business", { ...holder, companyName: "Co", vehicleType: "van", iban: IBAN, bankName: "Al Rajhi" }, ctx);
    expect(Object.keys(r.errors).sort()).toEqual(["bankName", "iban", "vehicleType"]);
  });
  it("accepts a VAT (tax) number for a company, cleaned like the commercial registration, and rejects a malformed one", () => {
    const ok = checkFields("business", { ...holder, companyName: "Co", crNumber: "1010123456", taxNumber: " ٣١٠١٢٢٣٩٣٥٠٠٠٠٣ " }, ctx);
    expect(ok.errors).toEqual({}); expect(ok.values).toMatchObject({ taxNumber: "310122393500003" });
    expect(checkFields("business", { ...holder, companyName: "Co", taxNumber: "<<>>" }, ctx).errors.taxNumber).toMatch(/tax number/i);
    expect(checkFields("business", { taxNumber: "" }, ctx, { partial: true }).values.taxNumber).toBeNull(); // clearable
    expect(PROFILE_FIELDS.business).toContain("taxNumber"); expect(SENSITIVE_FIELDS.business).not.toContain("taxNumber"); // not payout data for a company
  });
});

describe("office accounts", () => {
  it("accepts bank, tax and registration data and normalises the IBAN", () => {
    const r = checkFields("office", { ...holder, companyName: "Fast Couriers", crNumber: "1010123456", taxNumber: "310122393500003", bankName: "Al Rajhi", iban: "sa03 8000 0000 6080 1016 7519", contactPerson: "Omar" }, ctx);
    expect(r.errors).toEqual({});
    expect(r.values).toMatchObject({ companyName: "Fast Couriers", iban: IBAN, taxNumber: "310122393500003", contactPerson: "Omar" });
  });
  it("rejects an IBAN that is not Saudi", () => {
    expect(checkFields("office", { ...holder, companyName: "Fast", iban: "GB82WEST12345698765432" }, ctx).errors.iban).toMatch(/IBAN/);
    expect(checkFields("office", { ...holder, companyName: "Fast", iban: "" }, ctx).errors).toEqual({});
  });
  it("requires an office name", () => { expect(checkFields("office", holder, ctx).errors.companyName).toMatch(/Office name/); });
});

describe("driver accounts", () => {
  const driver = { ...holder, vehicleType: "sedan", services: ["delivery_driver"] };
  it("accepts a driver and drops the temperature of a vehicle it does not apply to", () => {
    const r = checkFields("driver", { ...driver, vehicleTemperature: "cold", nationalId: "1087654321", vehiclePlate: "ABC 1234" }, ctx);
    expect(r.errors).toEqual({});
    expect(r.values).toMatchObject({ vehicleType: "sedan", vehicleTemperature: null, nationalId: "1087654321", vehiclePlate: "ABC 1234", services: ["delivery_driver"] });
  });
  it("needs dry or cold for a van or dyna", () => {
    expect(checkFields("driver", { ...driver, vehicleType: "van" }, ctx).errors.vehicleTemperature).toBeTruthy();
    expect(checkFields("driver", { ...driver, vehicleType: "dyna", vehicleTemperature: "cold" }, ctx).values.vehicleTemperature).toBe("cold");
  });
  it("needs a known vehicle type and at least one enabled service (duplicates collapse)", () => {
    expect(checkFields("driver", { ...holder, services: ["delivery_driver"] }, ctx).errors.vehicleType).toBeTruthy();
    expect(checkFields("driver", { ...driver, vehicleType: "tank" }, ctx).errors.vehicleType).toBeTruthy();
    expect(checkFields("driver", { ...driver, services: [] }, ctx).errors.services).toBeTruthy();
    expect(checkFields("driver", { ...driver, services: ["car_without_driver"] }, ctx).errors.services).toBeTruthy();
    expect(checkFields("driver", { ...driver, services: ["delivery_driver", "delivery_driver", "car_with_driver"] }, ctx).values.services).toEqual(["delivery_driver", "car_with_driver"]);
  });
  it("on a partial edit reads the current vehicle when only the temperature changes", () => {
    const cur = { vehicleType: "van", vehicleTemperature: "dry" };
    expect(checkFields("driver", { vehicleTemperature: "cold" }, ctx, { partial: true, current: cur })).toMatchObject({ errors: {}, values: { vehicleTemperature: "cold" } });
    expect(checkFields("driver", { vehicleTemperature: "cold" }, ctx, { partial: true, current: { vehicleType: "sedan" } }).values.vehicleTemperature).toBeUndefined();
    expect(checkFields("driver", { vehicleType: "sedan" }, ctx, { partial: true, current: cur }).values).toMatchObject({ vehicleType: "sedan", vehicleTemperature: null });
    expect(checkFields("driver", { vehicleType: "dyna" }, ctx, { partial: true, current: { vehicleType: "sedan" } }).errors.vehicleTemperature).toBeTruthy();
  });
  it("rejects a malformed national id and plate", () => {
    const r = checkFields("driver", { ...driver, nationalId: "12 34", vehiclePlate: "@@" }, ctx);
    expect(Object.keys(r.errors).sort()).toEqual(["nationalId", "vehiclePlate"]);
  });
});

describe("helpers", () => {
  it("knows the three account kinds only", () => {
    expect(["business", "office", "driver"].every(isAccountKind)).toBe(true);
    expect(["staff", "admin", "x", undefined].some(isAccountKind)).toBe(false);
  });
  it("normalizeIban and validPoint", () => {
    expect(normalizeIban(` sa0380000000608010167519 `)).toBe(IBAN); expect(normalizeIban("SA12")).toBeNull();
    expect(validPoint(24.7, 46.7)).toBe(true); expect(validPoint(0, 0)).toBe(false); expect(validPoint(NaN, 1)).toBe(false); expect(validPoint("1", 1)).toBe(false);
  });
  it("lists the sensitive fields of a payload that actually carry a value", () => {
    expect(sensitiveIn("driver", { nationalId: "1087654321", iban: "", bankName: null, vehiclePlate: "X" })).toEqual(["nationalId"]);
    expect(sensitiveIn("office", { taxNumber: "310", bankName: "B", iban: IBAN })).toEqual(["taxNumber", "bankName", "iban"]);
    expect(sensitiveIn("business", { crNumber: "1010123456" })).toEqual([]);
    expect(Object.keys(SENSITIVE_FIELDS)).toEqual(["business", "office", "driver"]);
    for (const k of ["business", "office", "driver"] as const) for (const f of SENSITIVE_FIELDS[k]) expect(PROFILE_FIELDS[k]).toContain(f);
  });
  it("diffFields keeps only what changed, including cleared values", () => {
    const d = diffFields({ name: "A", email: "a@x.com", industry: null, services: ["a"] }, { name: "A", email: null, industry: "Food", services: ["a"] });
    expect(d).toEqual({ email: { from: "a@x.com", to: null }, industry: { from: null, to: "Food" } });
    expect(diffFields({}, { address: null })).toEqual({});
  });
  it("maskDiff hides payout and identity numbers but keeps the phone's old and new value", () => {
    const m = maskDiff({ iban: { from: IBAN, to: "SA6980000204608016211111" }, nationalId: { from: null, to: "1087654321" }, bankName: { from: "A", to: "B" }, phone: { from: "+966501111111", to: "+966502222222" }, city: { from: "riyadh", to: "jeddah" } });
    expect(m.iban).toEqual({ from: "…7519", to: "…1111" }); expect(m.nationalId).toEqual({ from: null, to: "…4321" }); expect(m.bankName).toEqual({ from: "set", to: "set" });
    expect(m.phone).toEqual({ from: "+966501111111", to: "+966502222222" }); expect(JSON.stringify(m)).not.toContain("0000000608");
    expect(maskPhone("+966501234567")).toBe("+966•••67"); expect(maskPhone(null)).toBeNull();
  });
});

describe("permissions catalog (G1a)", () => {
  it("defines accounts.create and accounts.edit and gives them to operations and hr_verification only", () => {
    expect(ALL_PERMISSIONS).toEqual(expect.arrayContaining(["accounts.create", "accounts.edit"]));
    for (const [role, perms] of Object.entries(STAFF_PRESETS)) {
      const has = perms.includes("accounts.create") && perms.includes("accounts.edit");
      expect(has, role).toBe(role === "operations" || role === "hr_verification");
      expect(perms.includes("accounts.create"), role).toBe(perms.includes("accounts.edit"));
    }
  });
});
