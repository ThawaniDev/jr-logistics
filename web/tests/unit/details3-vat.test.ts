import { describe, it, expect } from "vitest";
import { FIELDS, SENSITIVE, buildCreatePayload, buildPatch, changedKeys, emptyForm, formFromAccount, maskedValue, softWarnings, validateForm } from "@/components/features/admin-create-lib";
import { PROFILE_FIELDS, SENSITIVE_FIELDS, checkFields, maskDiff } from "@/server/account-admin-rules";

const rules = { cityKeys: ["riyadh"], serviceKeys: ["delivery_driver"], canSensitive: false, mode: "create" as const };
const fill = (o: object) => ({ ...emptyForm("business"), name: "Sara Ali", phone: "0501234567", city: "riyadh", companyName: "Alpha Trading", ...o });
const perms = { canSensitive: false, canVerify: false, canAffiliate: false };

describe("VAT (tax) number of a company", () => {
  it("is a field of the company form and the server rules, and is not payout data", () => {
    expect(FIELDS.business).toContain("taxNumber"); expect(PROFILE_FIELDS.business).toContain("taxNumber");
    expect(SENSITIVE.business).not.toContain("taxNumber"); expect(SENSITIVE_FIELDS.business).not.toContain("taxNumber");
    expect(SENSITIVE.office).toContain("taxNumber"); // an office's stays sensitive
  });
  it("is optional, validated like the registration number, and softly checked for 15 digits", () => {
    expect(validateForm("business", fill({ taxNumber: "" }), rules)).toEqual({});
    expect(validateForm("business", fill({ taxNumber: "<<" }), rules).taxNumber).toBe("acr.err_reg_number");
    expect(validateForm("business", fill({ taxNumber: "310122393500003" }), rules)).toEqual({});
    expect(softWarnings("business", fill({ taxNumber: "12345" })).taxNumber).toBe("acr.warn_tax");
    expect(softWarnings("business", fill({ taxNumber: "310122393500003" })).taxNumber).toBeUndefined();
    expect(softWarnings("driver", fill({ taxNumber: "12345" })).taxNumber).toBeUndefined();
  });
  it("is sent on create and edit even without drivers.sensitive", () => {
    expect(buildCreatePayload("business", fill({ taxNumber: "310122393500003", sendSms: false }), perms)).toMatchObject({ taxNumber: "310122393500003" });
    const initial = formFromAccount("business", { fields: { companyName: "Alpha", taxNumber: "310122393500003" }, phone: null });
    expect(initial.taxNumber).toBe("310122393500003");
    expect(changedKeys("business", initial, { ...initial, taxNumber: "310122393500004" }, { canSensitive: false })).toEqual(["taxNumber"]);
    expect(buildPatch("business", initial, { ...initial, taxNumber: "" }, { canSensitive: false })).toEqual({ taxNumber: null });
  });
  it("is shown in the change summary for a company (an office's stays masked)", () => {
    expect(maskedValue("taxNumber", "310122393500003", "business")).toBe("310122393500003");
    expect(maskedValue("taxNumber", "310122393500003", "office")).toBe("••••"); expect(maskedValue("taxNumber", "310122393500003")).toBe("••••");
  });
  it("the server cleans Arabic digits and the audit diff does not write the number in full", () => {
    expect(checkFields("business", { name: "Sara", phone: "0501234567", city: "riyadh", companyName: "Co", taxNumber: "٣١٠١٢٢٣٩٣٥٠٠٠٠٣" }, { cityKeys: ["riyadh"], enabledServices: [] }).values.taxNumber).toBe("310122393500003");
    expect(maskDiff({ taxNumber: { from: null, to: "310122393500003" } })).toEqual({ taxNumber: { from: null, to: "set" } });
  });
});
