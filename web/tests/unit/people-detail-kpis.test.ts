import { describe, it, expect } from "vitest";
import { en, ar, ur } from "@/i18n/fragments/rd-detail-2";
import { allKpiDefs, kpiConflicts, kpiDef } from "@/server/analytics/definitions";
import { PEOPLE_KPI_KEYS, driverKpis, officeKpis, type DriverFacts, type OfficeFacts, type Twin } from "@/server/details-people-kpis";

const T = (cur: number | null, prev: number | null = null): Twin => ({ cur, prev });
const driver = (o: Partial<DriverFacts> = {}): DriverFacts => ({
  jobs: T(8, 4), parcels: T(120, 100), delivered: T(120, 100), outcomes: T(130, 100), firstAttempt: T(108, 80), onTime: T(7, 4), due: T(8, 4), accepted: T(8, 6), decided: T(10, 6), cancelled: T(1, 0), noShow: T(0, 1),
  ratingSum: T(23, 8), ratingCount: T(5, 2), respSum: T(1200, 900), respCount: T(8, 6), online: T(36_000, null), utilisation: T(0.4, null), earnings: T(480_000, 300_000), earningsLife: 2_000_000, cashHeld: 15_000, ...o,
});
const office = (o: Partial<OfficeFacts> = {}): OfficeFacts => ({
  drivers: 12, availableDrivers: 5, onJobDrivers: 3, activeDrivers: T(9, 7), newDrivers: T(2, 1), jobs: T(40, 30), parcels: T(500, 400), delivered: T(480, 380), outcomes: T(500, 400), onTime: T(35, 20), due: T(40, 30),
  ratingSum: T(90, 60), ratingCount: T(20, 14), utilisation: T(0.55, 0.5), earnings: T(900_000, 700_000), paid: T(500_000, 600_000), pending: 200_000, agreementAgeSec: 86_400 * 40, churned: 1, workedPrev: 8, ...o,
});
const by = (ks: Array<{ key: string }>, k: string) => ks.find((x) => x.key === k) as any;

describe("driver KPIs", () => {
  it("builds every KPI of the strip with its change against the previous period", () => {
    const k = driverKpis(driver());
    expect(k.map((x) => x.key)).toEqual(PEOPLE_KPI_KEYS.driver);
    expect(by(k, "drv_jobs")).toMatchObject({ value: 8, prev: 4, delta: 4, deltaPct: 1 });
    expect(by(k, "drv_success")).toMatchObject({ unit: "percent" }); expect(by(k, "drv_success").value).toBeCloseTo(120 / 130, 5); expect(by(k, "drv_success").prev).toBeCloseTo(1);
    expect(by(k, "drv_first_attempt").value).toBeCloseTo(0.9); expect(by(k, "drv_on_time").value).toBeCloseTo(0.875); expect(by(k, "drv_acceptance").value).toBeCloseTo(0.8);
    expect(by(k, "drv_rating").value).toBeCloseTo(4.6); expect(by(k, "drv_rating").parts).toEqual([{ key: "ratings", value: 5 }]);
    expect(by(k, "drv_response")).toMatchObject({ unit: "duration", value: 150 });
    expect(by(k, "drv_cancels")).toMatchObject({ value: 1, prev: 1, parts: [{ key: "cancelled", value: 1 }, { key: "no_show", value: 0 }] });
    expect(by(k, "drv_earnings")).toMatchObject({ value: 480_000, prev: 300_000 }); expect(by(k, "drv_earnings_life").value).toBe(2_000_000); expect(by(k, "drv_cash_held").value).toBe(15_000);
  });
  it("empty periods are 'no data', never 0 %", () => {
    const k = driverKpis(driver({ delivered: T(0, 0), outcomes: T(0, 0), onTime: T(0), due: T(0), accepted: T(0), decided: T(0), ratingSum: T(0), ratingCount: T(0), respSum: T(0), respCount: T(0), online: T(null), utilisation: T(null) }));
    for (const key of ["drv_success", "drv_first_attempt", "drv_on_time", "drv_acceptance", "drv_rating", "drv_response", "drv_online", "drv_utilisation"]) expect(by(k, key).value, key).toBeNull();
    expect(by(k, "drv_jobs").value).toBe(8); // counts stay numbers
  });
  it("money is left out, not zeroed, without the permission", () => {
    const k = driverKpis(driver({ earnings: null, earningsLife: null, cashHeld: null }));
    expect(k.map((x) => x.key)).not.toContain("drv_earnings"); expect(k.map((x) => x.key)).not.toContain("drv_earnings_life"); expect(k.map((x) => x.key)).not.toContain("drv_cash_held"); expect(k).toHaveLength(PEOPLE_KPI_KEYS.driver.length - 3);
    const cashOnly = driverKpis(driver({ earnings: null, earningsLife: null })); expect(cashOnly.map((x) => x.key)).toContain("drv_cash_held");
  });
  it("without a comparison window nothing has a previous value", () => {
    const k = driverKpis(driver({ jobs: T(8, null), cancelled: T(1, null), noShow: T(0, null), delivered: T(120, null), outcomes: T(130, null) }));
    expect(by(k, "drv_jobs")).toMatchObject({ prev: null, delta: null }); expect(by(k, "drv_cancels").prev).toBeNull(); expect(by(k, "drv_success").prev).toBeNull();
  });
  it("lower is better for cancellations, response time and cash held", () => {
    expect(kpiDef("drv_cancels").good).toBe("lower"); expect(kpiDef("drv_response").good).toBe("lower"); expect(kpiDef("drv_cash_held").good).toBe("lower"); expect(kpiDef("drv_jobs").good).toBe("higher");
  });
});

describe("office KPIs", () => {
  it("builds the strip, with parts for the fleet and a turnover that needs a previous period", () => {
    const k = officeKpis(office());
    expect(k.map((x) => x.key)).toEqual(PEOPLE_KPI_KEYS.office);
    expect(by(k, "ofc_drivers")).toMatchObject({ value: 12, parts: [{ key: "available", value: 5 }, { key: "on_job", value: 3 }] });
    expect(by(k, "ofc_success").value).toBeCloseTo(0.96); expect(by(k, "ofc_on_time").value).toBeCloseTo(0.875); expect(by(k, "ofc_rating").value).toBeCloseTo(4.5);
    expect(by(k, "ofc_turnover").value).toBeCloseTo(0.125); expect(by(k, "ofc_agreement_age").value).toBe(86_400 * 40); expect(by(k, "ofc_pending").value).toBe(200_000);
    expect(by(k, "ofc_paid")).toMatchObject({ value: 500_000, prev: 600_000, delta: -100_000 });
  });
  it("hides money and shows no turnover for 'all time'", () => {
    const k = officeKpis(office({ earnings: null, paid: null, pending: null, churned: null, workedPrev: null, agreementAgeSec: null }));
    expect(k.map((x) => x.key)).toEqual(PEOPLE_KPI_KEYS.office.filter((x) => !["ofc_earnings", "ofc_paid", "ofc_pending"].includes(x)));
    expect(by(k, "ofc_turnover").value).toBeNull(); expect(by(k, "ofc_agreement_age").value).toBeNull();
    expect(by(officeKpis(office({ workedPrev: 0, churned: 0 })), "ofc_turnover").value).toBeNull(); // nobody worked before: no rate
  });
});

describe("definitions (decision G8)", () => {
  const mine = allKpiDefs().filter((d) => d.label.startsWith("dv2."));
  it("registers every key once with no clash with other reports", () => {
    expect(kpiConflicts()).toEqual([]); expect(mine.map((d) => d.key).sort()).toEqual([...PEOPLE_KPI_KEYS.driver, ...PEOPLE_KPI_KEYS.office].sort());
  });
  it("every label, definition, numerator and denominator exists in en, ar and ur", () => {
    for (const d of mine) for (const k of [d.label, d.definition, d.numerator, d.denominator].filter(Boolean) as string[]) { expect(en[k], `en ${k}`).toBeTruthy(); expect(ar[k], `ar ${k}`).toBeTruthy(); expect(ur[k], `ur ${k}`).toBeTruthy(); }
  });
  it("a percentage or an average always says what it is a share of", () => {
    for (const d of mine.filter((x) => x.unit === "percent" || x.key === "drv_rating" || x.key === "drv_response" || x.key === "ofc_rating")) { expect(d.numerator, d.key).toBeTruthy(); expect(d.denominator, d.key).toBeTruthy(); }
  });
  it("money KPIs are flagged so the generic filter can drop them", () => {
    expect(mine.filter((d) => d.money).map((d) => d.key).sort()).toEqual(["drv_cash_held", "drv_earnings", "drv_earnings_life", "ofc_earnings", "ofc_paid", "ofc_pending"]);
  });
});
