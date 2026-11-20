/**
 * The create / edit forms' pure logic (decision G1): instant validation, request bodies, the diff of an edit, API error mapping, redirects and the
 * "what will happen" list. Includes a parity check against the server rules, so the form never accepts what the API would refuse (or the other way round).
 */
import { describe, it, expect } from "vitest";
import { ApiError } from "@/lib/api";
import { checkFields } from "@/server/account-admin-rules";
import {
  apiFieldErrors, buildCreatePayload, buildPatch, changedKeys, emptyForm, entityHref, formFromAccount, labelKeyOf, maskedValue, softWarnings, validateForm, whatHappens,
  type FormState, type Kind,
} from "@/components/features/admin-create-lib";

const rules = { cityKeys: ["riyadh", "jeddah"], serviceKeys: ["delivery_driver", "car_with_driver"], canSensitive: true, mode: "create" as const };
const perms = { canSensitive: true, canVerify: true, canAffiliate: true };
const IBAN = "SA0380000000608010167519";
const fill = (kind: Kind, o: Partial<FormState> = {}): FormState => ({
  ...emptyForm(kind), name: "Sara Ali", phone: "0501234567", city: "riyadh",
  ...(kind === "driver" ? { vehicleType: "sedan" } : { companyName: "Alpha Trading" }), ...o,
});

describe("validateForm", () => {
  it("accepts a minimal valid form of each kind and rejects an empty one", () => {
    for (const k of ["business", "office", "driver"] as const) {
      expect(validateForm(k, fill(k), rules), k).toEqual({});
      expect(Object.keys(validateForm(k, emptyForm(k), rules)).length, k).toBeGreaterThan(2);
    }
  });
  it("checks phone, email, city and the company name", () => {
    const e = validateForm("business", fill("business", { phone: "123", email: "x", city: "mars", companyName: "A" }), rules);
    expect(e).toMatchObject({ phone: "val.phone", email: "profile.invalid_email", city: "val.required", companyName: "val.required" });
    expect(validateForm("business", fill("business", { phone: "٠٥٠١٢٣٤٥٦٧" }), rules).phone).toBeUndefined();
  });
  it("checks the warehouse pin as a pair in range", () => {
    expect(validateForm("business", fill("business", { lat: "24.7" }), rules).lng).toBe("foa.wh_err_pair");
    expect(validateForm("business", fill("business", { lat: "95", lng: "46" }), rules).lat).toBe("foa.wh_err_coords");
    expect(validateForm("business", fill("business", { lat: "24.7136", lng: "46.6753" }), rules)).toEqual({});
  });
  it("checks driver vehicle, temperature and services", () => {
    expect(validateForm("driver", fill("driver", { vehicleType: "" }), rules).vehicleType).toBe("val.required");
    expect(validateForm("driver", fill("driver", { vehicleType: "van" }), rules).vehicleTemperature).toBe("profile.temp_required");
    expect(validateForm("driver", fill("driver", { vehicleType: "van", vehicleTemperature: "dry" }), rules)).toEqual({});
    expect(validateForm("driver", fill("driver", { services: [] }), rules).services).toBe("profile.services_required");
    expect(validateForm("driver", fill("driver", { services: ["car_without_driver"] }), rules).services).toBe("profile.services_required");
  });
  it("needs a reason of at least three characters to verify on creation", () => {
    expect(validateForm("business", fill("business", { verifyNow: true }), rules).verifyReason).toBe("acr.err_reason");
    expect(validateForm("business", fill("business", { verifyNow: true, verifyReason: "ok" }), rules).verifyReason).toBe("acr.err_reason");
    expect(validateForm("business", fill("business", { verifyNow: true, verifyReason: "Checked in person" }), rules)).toEqual({});
    expect(validateForm("business", fill("business", { verifyNow: false }), rules)).toEqual({});
  });
  it("skips sensitive fields the person may not use", () => {
    const f = fill("office", { iban: "bad", taxNumber: "<<" });
    expect(Object.keys(validateForm("office", f, rules)).sort()).toEqual(["iban", "taxNumber"]);
    expect(validateForm("office", f, { ...rules, canSensitive: false })).toEqual({});
  });
  it("on an edit, a masked phone may stay empty but a typed one must be valid", () => {
    const edit = { ...rules, mode: "edit" as const, maskedPhone: true };
    expect(validateForm("driver", fill("driver", { phone: "" }), edit).phone).toBeUndefined();
    expect(validateForm("driver", fill("driver", { phone: "12" }), edit).phone).toBe("val.phone");
    expect(validateForm("driver", fill("driver", { phone: "" }), { ...rules, mode: "edit" }).phone).toBe("val.required");
  });
  it("never disagrees with the server rules (same verdict, same cleaned values)", () => {
    const cases: Array<[Kind, Partial<FormState>]> = [
      ["business", {}], ["business", { phone: "05" }], ["business", { email: "a@b" }], ["business", { crNumber: "10 10" }], ["business", { crNumber: "!!!" }], ["business", { lat: "24.7", lng: "46.7" }], ["business", { lat: "0", lng: "0" }], ["business", { lat: "24" }],
      ["office", { iban: IBAN }], ["office", { iban: "sa03 8000 0000 6080 1016 7519" }], ["office", { iban: "SA03" }], ["office", { taxNumber: "310122393500003" }], ["office", { taxNumber: "x" }],
      ["driver", { vehicleType: "van" }], ["driver", { vehicleType: "van", vehicleTemperature: "cold" }], ["driver", { vehicleType: "tank" }], ["driver", { nationalId: "10876" }], ["driver", { nationalId: "1" }], ["driver", { vehiclePlate: "ABC 1234" }], ["driver", { vehiclePlate: "$" }],
      ["driver", { services: ["delivery_driver", "car_with_driver"] }], ["driver", { services: [] }], ["driver", { city: "jeddah" }], ["driver", { city: "nowhere" }], ["driver", { name: "A" }],
    ];
    for (const [kind, o] of cases) {
      const f = fill(kind, o);
      const client = Object.keys(validateForm(kind, f, rules)).length === 0;
      const { verifyNow: _v, officeId: _o, sendSms: _s, kind: _k, ...fields } = buildCreatePayload(kind, f, perms) as Record<string, unknown>;
      void _v; void _o; void _s; void _k;
      const server = checkFields(kind, fields, { cityKeys: rules.cityKeys, enabledServices: rules.serviceKeys });
      expect(client, `${kind} ${JSON.stringify(o)} → ${JSON.stringify(server.errors)}`).toBe(Object.keys(server.errors).length === 0);
    }
  });
});

describe("sign-in details of a new account (username + temporary password)", () => {
  it("are optional, but checked when typed (same rules as the server)", () => {
    expect(validateForm("business", fill("business"), rules).username).toBeUndefined();
    expect(validateForm("business", fill("business"), rules).password).toBeUndefined();
    expect(validateForm("business", fill("business", { username: "ab" }), rules).username).toBe("ja.un_invalid");
    expect(validateForm("business", fill("business", { username: "Admin" }), rules).username).toBe("ja.un_reserved");
    expect(validateForm("business", fill("business", { username: "Alpha.Co" }), rules).username).toBeUndefined();
    expect(validateForm("business", fill("business", { password: "short1" }), rules).password).toBe("ja.err_pw_short");
    expect(validateForm("business", fill("business", { password: "onlyletterspass" }), rules).password).toBe("ja.err_pw_weak");
    expect(validateForm("business", fill("business", { password: "Temp#By2027staff" }), rules).password).toBeUndefined();
    expect(validateForm("business", fill("business", { username: "ab", password: "x" }), { ...rules, mode: "edit" }).username).toBeUndefined(); // an edit has no sign-in boxes
  });
  it("go into the create body only when filled in (lower-cased username), never into an edit", () => {
    expect(buildCreatePayload("business", fill("business"), perms)).not.toHaveProperty("username");
    expect(buildCreatePayload("business", fill("business"), perms)).not.toHaveProperty("password");
    expect(buildCreatePayload("business", fill("business", { username: " Alpha.Co ", password: "Temp#By2027staff" }), perms)).toMatchObject({ username: "alpha.co", password: "Temp#By2027staff" });
    const initial = fill("business"); const edited = { ...initial, username: "other", password: "Temp#By2027staff" };
    expect(buildPatch("business", initial, edited, { canSensitive: true })).toEqual({});
  });
});

describe("softWarnings", () => {
  it("hints at the usual Saudi formats without blocking", () => {
    expect(softWarnings("business", fill("business", { crNumber: "ABC-123" })).crNumber).toBe("acr.warn_cr");
    expect(softWarnings("business", fill("business", { crNumber: "1010123456" })).crNumber).toBeUndefined();
    expect(softWarnings("office", fill("office", { taxNumber: "12345" })).taxNumber).toBe("acr.warn_tax");
    expect(softWarnings("office", fill("office", { taxNumber: "310122393500003" })).taxNumber).toBeUndefined();
    expect(softWarnings("driver", fill("driver", { nationalId: "12345678" })).nationalId).toBe("acr.warn_national_id");
    expect(softWarnings("driver", fill("driver", { nationalId: "1087654321" })).nationalId).toBeUndefined();
  });
});

describe("buildCreatePayload", () => {
  it("sends a company with the pin as numbers and nothing that is empty", () => {
    const b = buildCreatePayload("business", fill("business", { email: "S@X.com", lat: "24.7136", lng: "46.6753", industry: " Food ", sendSms: false }), perms);
    expect(b).toEqual({ kind: "business", name: "Sara Ali", phone: "+966501234567", email: "s@x.com", city: "riyadh", language: "ar", companyName: "Alpha Trading", industry: "Food", lat: 24.7136, lng: 46.6753 });
  });
  it("sends a driver with services, temperature only for vans, and the office only with the permission", () => {
    const f = fill("driver", { vehicleType: "van", vehicleTemperature: "cold", nationalId: "1087654321", iban: "sa03 8000 0000 6080 1016 7519", officeId: "off-1" });
    const b = buildCreatePayload("driver", f, perms);
    expect(b).toMatchObject({ kind: "driver", vehicleType: "van", vehicleTemperature: "cold", services: ["delivery_driver"], nationalId: "1087654321", iban: IBAN, officeId: "off-1", sendSms: true });
    expect(buildCreatePayload("driver", f, { ...perms, canAffiliate: false })).not.toHaveProperty("officeId");
    expect(buildCreatePayload("driver", fill("driver", { vehicleTemperature: "cold" }), perms)).not.toHaveProperty("vehicleTemperature");
  });
  it("leaves sensitive fields out without drivers.sensitive and the verification out without verification.manage", () => {
    const f = fill("office", { taxNumber: "310122393500003", bankName: "Al Rajhi", iban: IBAN, verifyNow: true, verifyReason: " Checked in person " });
    const b = buildCreatePayload("office", f, { canSensitive: false, canVerify: false, canAffiliate: false });
    for (const k of ["taxNumber", "bankName", "iban", "verifyNow"]) expect(b, k).not.toHaveProperty(k);
    expect(buildCreatePayload("office", f, perms)).toMatchObject({ taxNumber: "310122393500003", bankName: "Al Rajhi", iban: IBAN, verifyNow: { reason: "Checked in person" } });
  });
  it("omits sendSms when it is off", () => { expect(buildCreatePayload("driver", fill("driver", { sendSms: false }), perms)).not.toHaveProperty("sendSms"); });
});

describe("editing", () => {
  const stored = { fields: { name: "Sara Ali", email: "s@x.com", city: "riyadh", language: "ar", companyName: "Alpha", contactPerson: "Sara Ali", industry: null, address: "Olaya", crNumber: "1010123456", lat: 24.7136, lng: 46.6753 }, phone: "+966501234567" };
  const initial = formFromAccount("business", stored);
  it("loads the stored values into the form", () => {
    expect(initial).toMatchObject({ name: "Sara Ali", phone: "+966501234567", email: "s@x.com", companyName: "Alpha", industry: "", lat: "24.7136", lng: "46.6753", sendSms: false });
    expect(formFromAccount("driver", { fields: { vehicleType: "van", services: ["delivery_driver"] }, phone: null })).toMatchObject({ phone: "", vehicleType: "van", services: ["delivery_driver"] });
  });
  it("an untouched form has no changes and an empty patch", () => {
    expect(changedKeys("business", initial, { ...initial }, { canSensitive: true })).toEqual([]);
    expect(buildPatch("business", initial, { ...initial }, { canSensitive: true })).toEqual({});
  });
  it("sends only the fields that changed (and null for a cleared optional one)", () => {
    const f = { ...initial, name: "Sara A.", email: "", industry: "Retail", phone: "0502222222" };
    expect(buildPatch("business", initial, f, { canSensitive: true })).toEqual({ name: "Sara A.", email: null, industry: "Retail", phone: "+966502222222" });
  });
  it("treats the same phone written differently as unchanged, and an empty masked phone as no change", () => {
    expect(changedKeys("business", initial, { ...initial, phone: "0501234567" }, { canSensitive: true })).toEqual([]);
    const masked = { ...initial, phone: "" };
    expect(changedKeys("business", masked, { ...masked }, { canSensitive: true })).toEqual([]);
    expect(changedKeys("business", initial, { ...initial, phone: "" }, { canSensitive: true })).toEqual([]);
  });
  it("sends the pin as a pair when either half moves", () => {
    expect(buildPatch("business", initial, { ...initial, lat: "24.8" }, { canSensitive: true })).toEqual({ lat: 24.8, lng: 46.6753 });
    expect(changedKeys("business", initial, { ...initial, lat: "24.7136000" }, { canSensitive: true })).toEqual([]);
  });
  it("sends the temperature along when a vehicle changes", () => {
    const d = formFromAccount("driver", { fields: { vehicleType: "van", vehicleTemperature: "dry", services: ["delivery_driver"], city: "riyadh", name: "A B" }, phone: "+966501234567" });
    expect(buildPatch("driver", d, { ...d, vehicleType: "dyna", vehicleTemperature: "cold" }, { canSensitive: true })).toEqual({ vehicleType: "dyna", vehicleTemperature: "cold" });
    expect(buildPatch("driver", d, { ...d, vehicleType: "sedan" }, { canSensitive: true })).toEqual({ vehicleType: "sedan", vehicleTemperature: null });
    expect(buildPatch("driver", d, { ...d, services: ["car_with_driver", "delivery_driver"] }, { canSensitive: true })).toEqual({ services: ["car_with_driver", "delivery_driver"] });
    expect(changedKeys("driver", d, { ...d, services: ["delivery_driver"] }, { canSensitive: true })).toEqual([]);
  });
  it("never offers sensitive fields to someone without the permission", () => {
    const o = formFromAccount("office", { fields: { companyName: "Fast", iban: null }, phone: null });
    expect(changedKeys("office", o, { ...o, iban: IBAN, taxNumber: "310" }, { canSensitive: false })).toEqual([]);
    expect(changedKeys("office", o, { ...o, iban: IBAN }, { canSensitive: true })).toEqual(["iban"]);
  });
});

describe("apiFieldErrors", () => {
  it("maps validation details and conflict fields to the form's field names", () => {
    expect(apiFieldErrors(new ApiError("VALIDATION", "Invalid input", 422, { phone: "Invalid phone", zzz: "x", iban: "Invalid Saudi IBAN" }))).toEqual({ phone: "Invalid phone", iban: "Invalid Saudi IBAN" });
    expect(apiFieldErrors(new ApiError("CONFLICT", "Already exists", 409, { field: "email" }))).toEqual({ email: "Already exists" });
    expect(apiFieldErrors(new Error("boom"))).toEqual({});
  });
});

describe("navigation and copy helpers", () => {
  it("goes to the entity view when the staff member may open it, else to the list", () => {
    const all = () => true, none = () => false, only = (p: string) => p === "drivers.view";
    expect(entityHref("business", "x1", all)).toBe("/admin/companies/x1");
    expect(entityHref("office", "x2", all)).toBe("/admin/offices/x2");
    expect(entityHref("driver", "x3", only)).toBe("/admin/drivers/x3");
    expect(entityHref("business", "x1", only)).toBe("/admin/companies/x1".replace("/x1", ""));
    expect(entityHref("driver", "x3", none)).toBe("/admin/drivers");
  });
  it("labels fields like the form does and masks payout data", () => {
    expect(labelKeyOf("business", "companyName")).toBe("reg.company"); expect(labelKeyOf("office", "companyName")).toBe("reg.office_name"); expect(labelKeyOf("driver", "iban")).toBe("profile.iban");
    expect(maskedValue("iban", IBAN)).toBe("…7519"); expect(maskedValue("bankName", "Al Rajhi")).toBe("••••"); expect(maskedValue("city", "riyadh")).toBe("riyadh"); expect(maskedValue("iban", "")).toBe("");
  });
  it("lists what will happen for each kind", () => {
    const keys = (k: Kind, o: Partial<FormState>, v = true) => whatHappens(k, fill(k, o), { canVerify: v, officeName: "Fast" }).map((x) => x.key);
    expect(keys("business", {})).toEqual(["acr.will_signin", "acr.will_pending", "acr.will_wallet", "acr.will_pin_missing", "acr.will_terms", "acr.will_sms", "acr.will_audit"]);
    expect(keys("business", { lat: "24.7", lng: "46.7", verifyNow: true, sendSms: false })).toEqual(["acr.will_signin", "acr.will_verified", "acr.will_wallet", "acr.will_pin_set", "acr.will_terms", "acr.will_no_sms", "acr.will_audit"]);
    expect(keys("business", { verifyNow: true }, false)).toContain("acr.will_pending");
    expect(keys("driver", { officeId: "o1" })).toEqual(expect.arrayContaining(["acr.will_pending_driver", "acr.will_offline", "acr.will_office"]));
    expect(whatHappens("driver", fill("driver", { officeId: "o1" }), { canVerify: true, officeName: "Fast" }).find((x) => x.key === "acr.will_office")?.vars).toEqual({ office: "Fast" });
    expect(whatHappens("office", fill("office"), { canVerify: true })[0].vars).toEqual({ username: "u966501234567" }); // the default sign-in name: u + the digits of the phone
    expect(whatHappens("office", fill("office", { username: " Fast.Office " }), { canVerify: true })[0].vars).toEqual({ username: "fast.office" });
    expect(whatHappens("office", fill("office", { phone: "" }), { canVerify: true })[0].key).toBe("acr.will_signin_any");
  });
});
