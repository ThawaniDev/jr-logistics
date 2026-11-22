/**
 * The notification renderer (`lib/notif-text.ts`): a raw `{placeholder}` is never shown, in any language, for any type, whatever the data holds.
 */
import { describe, it, expect } from "vitest";
import { dictionaries } from "@/i18n/dictionaries";
import { translate, LOCALES, type Locale } from "@/i18n/core";
import { notificationText, notificationVars, placeholdersOf } from "@/lib/notif-text";

const tFor = (l: Locale) => (key: string, vars?: Record<string, string | number>) => translate(dictionaries[l], dictionaries.en, key, vars);
const types = Object.keys(dictionaries.en).filter((k) => k.startsWith("notif.") && !k.endsWith("__short") && !["notif.mark_all", "notif.empty"].includes(k)).map((k) => k.slice(6));

describe("notificationText", () => {
  it("full data → the template, cities localized, amount from amountCents", () => {
    const t = tFor("en");
    expect(notificationText(t, { type: "offer_new", data: { ref: "JR-000012", parcels: 14, pickupCity: "riyadh", deliveryCity: "jeddah" } })).toBe("New job offer JR-000012: 14 parcels, Riyadh → Jeddah");
    expect(notificationText(tFor("ar"), { type: "offer_new", data: { ref: "JR-000012", parcels: 14, pickupCity: "riyadh", deliveryCity: "jeddah" } })).toContain("الرياض");
    expect(notificationText(t, { type: "cod_received", data: { ref: "JR-000012", amountCents: 12550 } })).toContain("125.50");
  });

  it("a missing parcel count uses the short variant (vehicle-day offers); a missing city value does not leak the key either", () => {
    const t = tFor("en");
    expect(notificationText(t, { type: "offer_new", data: { ref: "JR-000013", pickupCity: "riyadh", deliveryCity: "dammam" } })).toBe("New job offer JR-000013: Riyadh → Dammam");
    expect(notificationText(tFor("ur"), { type: "offer_replacement", data: { ref: "JR-000013", pickupCity: "riyadh", deliveryCity: "dammam" } })).not.toMatch(/[{}]/);
  });

  it("old rows with no params at all (offer_new written by a manual assignment before the fix) show the text up to the missing part", () => {
    expect(notificationText(tFor("en"), { type: "offer_new", data: { requestId: "x", ref: "JR-000014" } })).toBe("New job offer JR-000014");
    expect(notificationText(tFor("ar"), { type: "offer_new", data: { ref: "JR-000014" } })).toBe("عرض مهمة جديد JR-000014");
    expect(notificationText(tFor("en"), { type: "offer_new", data: null })).toBe("New job offer"); // the template up to its first missing parameter
    expect(notificationText(tFor("en"), { type: "cod_received", data: null })).toBe("You have a new update"); // nothing usable left
  });

  it("an unknown type and a null / empty / object value are handled", () => {
    expect(notificationText(tFor("en"), { type: "something_new_from_a_newer_server", data: { ref: "x" } })).toBe("You have a new update");
    expect(notificationVars(tFor("en"), { a: null, b: "", c: { x: 1 }, d: 0, e: "ok" })).toEqual({ d: "0", e: "ok" });
  });

  for (const l of LOCALES) {
    it(`every notif.* type (${l}) renders without a raw placeholder, with full data, with no data and with half of the data`, () => {
      const t = tFor(l);
      for (const type of types) {
        const all = Object.fromEntries(placeholdersOf(dictionaries.en[`notif.${type}`]).map((p) => [p, p === "pickupCity" || p === "deliveryCity" ? "riyadh" : "seven"]));
        const half = Object.fromEntries(Object.entries(all).filter((_, i) => i % 2 === 0));
        for (const data of [all, half, {}, null]) {
          const text = notificationText(t, { type, data });
          expect(text, `${l}/${type}`).not.toMatch(/[{}]/);
          expect(text.startsWith("notif."), `${l}/${type}`).toBe(false);
          expect(text.length, `${l}/${type} -> "${text}" with ${JSON.stringify(data)}`).toBeGreaterThan(2);
        }
        expect(notificationText(t, { type, data: all }), `${l}/${type}`).not.toBe(t("ubz.notif_generic"));
      }
    });
  }
});
