import { describe, it, expect } from "vitest";
import { KPI_GROUPS, KPI_TAB, kpiDelta, kpiKeys, kpiText, parcelQuery, parsePeriod, alertKey } from "@/components/features/admin-company-detail-lib";
import { userEntityHref, userTabHref, userTabs, auditTargetHref, isStaffRole } from "@/components/features/admin-user-detail-lib";

const can = (...p: string[]) => (x: string) => p.includes(x);

describe("company KPI formatting", () => {
  it("shows percentages, money and counts; no data is a dash, not 0%", () => {
    expect(kpiText({ unit: "percent", value: 0.915 }, "en")).toMatch(/91\.5/);
    expect(kpiText({ unit: "percent", value: null }, "en")).toBe("—");
    expect(kpiText({ unit: "count", value: 1250 }, "en")).toBe("1,250");
    expect(kpiText({ unit: "money", value: 123_456 }, "en")).toMatch(/1,234\.56/);
    expect(kpiText({ unit: "score", value: 82 }, "en")).toBe("82/100");
    expect(kpiText({ unit: "score", value: null }, "en")).toBe("—");
  });
  it("percent KPIs change in points, others relatively; colour follows which direction is good", () => {
    expect(kpiDelta({ unit: "percent", value: 0.9, prev: 0.8, good: "higher" }, "en")).toMatchObject({ dir: "up", tone: "good" });
    expect(kpiDelta({ unit: "percent", value: 0.9, prev: 0.8, good: "higher" }, "en")?.text).toMatch(/^\+10/);
    expect(kpiDelta({ unit: "percent", value: 0.1, prev: 0.05, good: "lower" }, "en")).toMatchObject({ dir: "up", tone: "bad" });
    expect(kpiDelta({ unit: "count", value: 150, prev: 100, good: "higher" }, "en")).toMatchObject({ dir: "up", tone: "good", text: "+50%" });
    expect(kpiDelta({ unit: "count", value: 50, prev: 100, good: "higher" }, "en")).toMatchObject({ dir: "down", tone: "bad", text: "−50%" });
    expect(kpiDelta({ unit: "money", value: 5, prev: 5, good: "neutral" }, "en")).toMatchObject({ dir: "flat", tone: "flat" });
    expect(kpiDelta({ unit: "money", value: 200, prev: 100, good: "neutral" }, "en")?.tone).toBe("flat");
  });
  it("no comparison when either side has no data; a rise from zero is 'new'", () => {
    expect(kpiDelta({ unit: "count", value: 5, prev: null, good: "higher" }, "en")).toBeNull();
    expect(kpiDelta({ unit: "percent", value: null, prev: 0.5, good: "higher" }, "en")).toBeNull();
    expect(kpiDelta({ unit: "count", value: 5, prev: 0, good: "higher" }, "en")).toMatchObject({ dir: "up", isNew: true });
    expect(kpiDelta({ unit: "count", value: 0, prev: 0, good: "higher" }, "en")).toMatchObject({ dir: "flat" });
  });
  it("every KPI tile knows its i18n keys; ratios have a numerator and denominator", () => {
    expect(kpiKeys("success")).toEqual({ label: "dv3.k_success", def: "dv3.d_success", num: "dv3.dn_success", den: "dv3.dd_success" });
    expect(kpiKeys("orders")).toMatchObject({ num: null, den: null });
    const shown = KPI_GROUPS.flatMap((g) => g.keys);
    expect(new Set(shown).size).toBe(shown.length);
    for (const k of Object.keys(KPI_TAB)) expect(shown).toContain(k as never);
  });
  it("alert i18n keys: the average-order variant has its own text", () => {
    expect(alertKey({ key: "wallet_low", params: { ref: "JR-1" } })).toBe("dv3.al_wallet_low");
    expect(alertKey({ key: "wallet_low", params: { ref: "" } })).toBe("dv3.al_wallet_low_avg");
    expect(alertKey({ key: "no_orders", params: { days: 50 } })).toBe("dv3.al_no_orders");
  });
  it("period and parcel query helpers keep URLs clean", () => {
    expect(parsePeriod("90d")).toBe("90d"); expect(parsePeriod("all")).toBe("all"); expect(parsePeriod("bogus")).toBe("30d"); expect(parsePeriod(null)).toBe("30d");
    expect(parcelQuery({})).toBe("");
    expect(parcelQuery({ status: "all", q: "  ", page: 1 })).toBe("");
    expect(parcelQuery({ status: "failed", city: "riyadh", q: " JR-1 ", from: "2026-11-01", cod: "yes", page: 3, pageSize: 25 })).toBe("?status=failed&city=riyadh&q=JR-1&from=2026-11-01&cod=yes&page=3&pageSize=25");
    expect(parcelQuery({ status: "delivered", format: "csv" })).toBe("?status=delivered&format=csv");
  });
});

describe("user view sections and links", () => {
  it("staff and admin accounts follow the staff permissions, everyone else the people permissions", () => {
    expect(userTabs("business", can("users.view"))).toEqual(["overview", "security", "activity", "notes", "raw"]);
    expect(userTabs("business", can("offices.view"))).toEqual(["overview", "activity", "notes", "raw"]);
    expect(userTabs("staff", can("users.view"))).toEqual(["overview", "activity", "notes", "raw"]);
    expect(userTabs("staff", can("staff.view"))).toEqual(["overview", "security", "raw"]);
    expect(userTabs("admin", can("staff.manage", "users.view"))).toEqual(["overview", "security", "activity", "notes", "raw"]);
    expect(userTabs("driver", can())).toEqual(["overview", "raw"]);
  });
  it("builds hrefs: people with their own entity view go there, staff and admin to the user view", () => {
    expect(userTabHref("u1", "overview")).toBe("/admin/users/u1"); expect(userTabHref("u1", "security")).toBe("/admin/users/u1/security");
    expect(userEntityHref("business", "x")).toBe("/admin/companies/x"); expect(userEntityHref("office", "x")).toBe("/admin/offices/x"); expect(userEntityHref("driver", "x")).toBe("/admin/drivers/x");
    expect(userEntityHref("staff", "x")).toBe("/admin/users/x"); expect(userEntityHref(null, "x")).toBe("/admin/users/x");
    expect(isStaffRole("admin")).toBe(true); expect(isStaffRole("driver")).toBe(false);
  });
  it("audit targets link to the pages that exist", () => {
    expect(auditTargetHref("user", "a")).toBe("/admin/users/a"); expect(auditTargetHref("request", "a")).toBe("/admin/requests/a"); expect(auditTargetHref("ticket", "a")).toBe("/admin/cases/a");
    expect(auditTargetHref("complaint", "a")).toBe("/admin/complaints/a"); expect(auditTargetHref("settings", "a")).toBeNull(); expect(auditTargetHref("user", null)).toBeNull();
  });
});
