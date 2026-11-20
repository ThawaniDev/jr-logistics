/**
 * Render smoke test of the six portal report screens with REAL response shapes (captured from the reports running against a small Postgres): every section appears, nothing
 * shows a raw translation key or an unfilled {placeholder} in English, Arabic or Urdu, an empty account renders, and a section the server could not compute degrades alone.
 */
import { describe, it, expect, vi } from "vitest";
import { createElement as h, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
vi.mock("next/navigation", () => ({ useSearchParams: () => new URLSearchParams(), usePathname: () => "/x", useRouter: () => ({ replace() {}, push() {} }) }));
import { I18nProvider } from "@/i18n/provider";
import en from "@/i18n/en";
import ar from "@/i18n/ar";
import ur from "@/i18n/ur";
import type { Locale } from "@/i18n/core";
import { BusinessOverviewBody } from "@/components/reports/portal/business/BusinessOverview";
import { BusinessDeliveriesBody } from "@/components/reports/portal/business/BusinessDeliveries";
import { BusinessSpendingBody } from "@/components/reports/portal/business/BusinessSpending";
import { OfficeOverviewBody } from "@/components/reports/portal/office/OfficeOverview";
import { OfficeDriversBody } from "@/components/reports/portal/office/OfficeDrivers";
import { OfficeEarningsBody } from "@/components/reports/portal/office/OfficeEarnings";

const FIX = JSON.parse(readFileSync("tests/unit/fixtures/portal-reports.json", "utf8")) as Record<string, any>;
const DICT = { en, ar, ur };
const view = (role: "business" | "office") => ({ role, comparing: true, cityName: () => undefined, filters: { qs: "preset=30d" } as never });
const render = (el: ReactElement, l: Locale = "en") => renderToStaticMarkup(h(I18nProvider, { locale: l, dict: DICT[l], fallback: en, children: el }));

const SCREENS = [
  { key: "bizOverview", Body: BusinessOverviewBody, role: "business", kpis: ["biz_requests", "parcels_delivered", "biz_spend", "biz_cod_outstanding"], sections: ["chart-requests", "chart-parcels", "chart-spend", "chart-cod", "chart-funnel", "bd-city", "bd-service", "bd-service-spend", "bd-vehicle", "bd-channel", "chart-heatmap", "chart-fill", "insights", "bd-city-fail", "drill-requests"] },
  { key: "bizDeliveries", Body: BusinessDeliveriesBody, role: "business", kpis: ["biz_deferred_rate", "biz_delivery_time", "biz_returns_outstanding"], sections: ["chart-parcels", "chart-delivery-time", "chart-reasons", "rk-reasons", "chart-heatmap", "chart-proof", "chart-sms", "stats-codes", "stats-defer", "bd-city-fail", "rk-drivers", "stats-returns", "insights", "drill-returns", "drill-parcels"] },
  { key: "bizSpending", Body: BusinessSpendingBody, role: "business", kpis: ["biz_invoiced", "biz_wallet_balance", "biz_credit_usage"], sections: ["chart-spend", "chart-price", "chart-wallet", "chart-cod", "card-wallet", "card-forecast", "bd-service", "bd-vehicle", "bd-city", "bd-ledger", "insights", "drill-invoices", "drill-ledger", "drill-cod"] },
  { key: "offOverview", Body: OfficeOverviewBody, role: "office", kpis: ["off_drivers", "off_jobs", "off_earnings", "off_pending"], sections: ["office-report", "chart-jobs", "chart-parcels", "chart-earnings", "chart-funnel", "bd-city", "bd-service", "bd-vehicle", "rk-companies", "chart-heatmap", "insights", "money-status", "lifetime", "drill-jobs", "office-report-export"] },
  { key: "offDrivers", Body: OfficeDriversBody, role: "office", kpis: ["off_avg_jobs", "off_acceptance_rate", "off_coach"], sections: ["chart-jobs", "chart-dist-jobs", "chart-dist-success", "chart-dist-rating", "guard-note", "rk-top", "rk-bottom", "coach", "idle", "chart-online", "chart-arrivals", "insights", "drill-drivers"] },
  { key: "offEarnings", Body: OfficeEarningsBody, role: "office", kpis: ["off_earnings", "off_avg_per_parcel", "off_wallet"], sections: ["chart-earnings", "chart-withdrawals", "rk-drivers", "rk-companies", "bd-city", "bd-service", "chart-pipeline", "bd-settle-status", "chart-pay-time", "bd-withdrawals", "card-wallet", "insights", "drill-settlements", "drill-payouts", "drill-ledger"] },
] as const;
const el = (s: (typeof SCREENS)[number], data: unknown) => h(s.Body as never, { data, view: view(s.role) });
const clean = (html: string, where: string) => {
  expect(html.match(/rpr\.[a-z_.]+/g) ?? [], `${where}: raw key`).toEqual([]);
  expect(html.match(/rpf\.[a-z_.]+/g) ?? [], `${where}: raw key`).toEqual([]);
  expect(html.match(/\{[a-z_]+\}/g) ?? [], `${where}: unfilled placeholder`).toEqual([]);
  expect(html, where).not.toMatch(/undefined|NaN|\[object/);
};

describe("every screen renders its KPIs and sections from a real response", () => {
  for (const s of SCREENS) {
    it(s.key, () => {
      const data = FIX[`data.${s.key}`];
      expect(data.meta.empty).toBe(false); expect(data.meta.failed).toEqual([]);
      for (const l of ["en", "ar", "ur"] as const) {
        const html = render(el(s, data), l);
        for (const k of s.kpis) expect(html, `${l} kpi-${k}`).toContain(`data-testid="kpi-${k}"`);
        for (const id of s.sections) expect(html, `${l} ${id}`).toContain(`data-testid="${id}"`);
        expect(html).not.toContain("-unavailable");
        clean(html, `${s.key} ${l}`);
      }
    });
  }
});

describe("an account with no data renders every screen without a crash", () => {
  for (const s of SCREENS) {
    it(s.key, () => {
      const data = FIX[`empty.${s.key}`];
      expect(data.meta.empty).toBe(true);
      for (const l of ["en", "ar"] as const) clean(render(el(s, data), l), `${s.key} empty ${l}`);
    });
  }
});

describe("a failed section degrades alone", () => {
  it("marks it unavailable and still renders the others", () => {
    const data = structuredClone(FIX["data.bizSpending"]); data.series.price = null; data.wallet = null; data.meta.failed = ["series_spend"];
    const html = render(el(SCREENS[2], data));
    expect(html).toContain('data-testid="chart-price-unavailable"'); expect(html).toContain('data-testid="card-wallet-unavailable"');
    expect(html).toContain('data-testid="chart-wallet"'); expect(html).toContain('data-testid="drill-invoices"'); expect(html).toContain('data-testid="kpi-biz_spend"');
    expect(html).toContain("could not be loaded"); clean(html, "partial");
    const off = structuredClone(FIX["data.offOverview"]); off.series.jobs = null; off.byStatus = null; off.lifetime = null;
    const oh = render(el(SCREENS[3], off));
    expect(oh).toContain('data-testid="chart-jobs-unavailable"'); expect(oh).toContain('data-testid="lifetime-unavailable"'); expect(oh).toContain('data-testid="drill-jobs"'); clean(oh, "office partial");
  });
});

describe("what the data says", () => {
  it("the company's forecast card says 'estimate' and refuses to guess with little history", () => {
    const html = render(el(SCREENS[2], FIX["data.bizSpending"]));
    expect(html).toContain("Estimate"); expect(html).toContain('data-testid="forecast-none"'); expect(html).not.toContain('data-testid="forecast-total"');
    const rich = structuredClone(FIX["data.bizSpending"]); rich.forecast = { perDay: 1000, total: 30000, low: 24000, high: 36000, basisDays: 28, activeDays: 20, horizon: 30 };
    const r = render(el(SCREENS[2], rich));
    expect(r).toContain('data-testid="forecast-total"'); expect(r).toMatch(/Plausible range/);
  });
  it("offices only ever see anonymous customers", () => {
    const html = render(el(SCREENS[3], FIX["data.offOverview"]));
    expect(html).toMatch(/Company C-[0-9A-F]{5}/); expect(html).not.toContain("Alpha"); expect(html).not.toContain("Co Alpha");
  });
  it("the driver cards show reasons with thresholds and the minimum-volume note", () => {
    const d = structuredClone(FIX["data.offDrivers"]);
    d.coach = [{ id: "d1", name: "Omar", jobs: 12, resolved: 30, success: 0.7, rating: 3, earnings: 100, flags: ["low_success", "no_shows", "idle"], onTime: 0.5, noShow: 3, cancelled: 0 }];
    const html = render(el(SCREENS[4], d));
    expect(html).toContain("Delivery success below 85% (at least 10 parcels)"); expect(html).toContain("No-shows: 2 or more, or at least 10% of jobs"); expect(html).toContain("No job or offer in the period");
    expect(html).toContain("at least 10 resolved parcels");
    const ar = render(el(SCREENS[4], d), "ar"); expect(ar).toContain("نجاح التسليم أقل من"); expect(ar).toContain("لا مهمة ولا عرض خلال الفترة"); clean(ar, "coach ar");
  });
  it("a customer-facing number is never formatted as 0% when there is no data", () => {
    const html = render(el(SCREENS[0], FIX["empty.bizOverview"]));
    expect(html).not.toMatch(/data-testid="kpi-delivery_success" data-value="0"/); expect(html).toMatch(/data-testid="kpi-delivery_success" data-value=""/);
  });
});
