import { test, expect, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { otpLogin, gotoReady, apiLogin, DEMO } from "./helpers";

/**
 * Reports of the company and courier-office portals (decision G12): `/business/reports{,/deliveries,/spending}` and `/office/reports{,/drivers,/earnings}`.
 * The numbers on the page are judged against the owner's own API for the same filters (specs share one database, so never against absolute counts); the security checks
 * prove the browser session of one portal cannot read the other portal's, or the staff, reports; sections degrade one at a time; phone width and Arabic work.
 */
test.describe.configure({ mode: "serial" });
const BASE = `http://localhost:${process.env.E2E_PORT ?? 3101}`; // not 3100: other projects on this machine use it
const group = (page: Page, name: string) => page.getByRole("group", { name, exact: true });
const noSideways = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
const kpiOf = (j: { kpis: Array<{ key: string; value: number | null }> }, key: string) => j.kpis.find((k) => k.key === key);
const getJson = async (ctx: BrowserContext, path: string) => { const r = await ctx.request.get(`${BASE}/api/v1${path}`); return { status: r.status(), json: await r.json().catch(() => null), text: await r.text().catch(() => ""), type: r.headers()["content-type"] ?? "" }; };

const BIZ = {
  overview: { path: "/business/reports", api: "/business/analytics/overview", h1: "Reports", kpis: ["biz_requests", "requests_completed", "cancellation_rate", "biz_parcels_sent", "parcels_delivered", "biz_parcels_failed", "biz_parcels_returned", "delivery_success", "first_attempt", "biz_spend", "biz_avg_order", "biz_cost_per_parcel", "biz_cod_collected", "biz_cod_received", "biz_cod_outstanding"], sections: ["chart-requests", "chart-parcels", "chart-spend", "chart-cod", "chart-funnel", "bd-city", "bd-service", "bd-service-spend", "bd-vehicle", "bd-channel", "chart-heatmap", "chart-fill", "insights", "bd-city-fail", "drill-requests"] },
  deliveries: { path: "/business/reports/deliveries", api: "/business/analytics/deliveries", h1: "Deliveries", kpis: ["parcels_delivered", "biz_parcels_failed", "biz_parcels_returned", "delivery_success", "first_attempt", "biz_deferred_rate", "biz_delivery_time", "biz_otp_issue_rate", "biz_sms_failure_rate", "biz_returns_outstanding"], sections: ["chart-parcels", "chart-delivery-time", "chart-reasons", "rk-reasons", "chart-heatmap", "chart-proof", "chart-sms", "stats-codes", "stats-defer", "bd-city-fail", "rk-drivers", "stats-returns", "insights", "drill-returns", "drill-parcels"] },
  spending: { path: "/business/reports/spending", api: "/business/analytics/spending", h1: "Spending", kpis: ["biz_spend", "biz_orders_billed", "biz_avg_order", "biz_cost_per_parcel", "biz_invoiced", "biz_vat", "biz_topups", "biz_wallet_balance", "biz_credit_usage", "biz_cod_collected", "biz_cod_received", "biz_cod_outstanding"], sections: ["chart-spend", "chart-price", "chart-wallet", "chart-cod", "card-wallet", "card-forecast", "bd-service", "bd-vehicle", "bd-city", "bd-ledger", "insights", "drill-invoices", "drill-ledger", "drill-cod"] },
};
const OFF = {
  overview: { path: "/office/reports", api: "/office/analytics/overview", h1: "Reports", kpis: ["off_drivers", "active_drivers", "off_utilisation", "off_jobs", "off_completion_rate", "parcels_delivered", "delivery_success", "on_time_start", "off_earnings", "off_paid", "off_pending"], sections: ["chart-jobs", "chart-parcels", "chart-earnings", "chart-funnel", "bd-city", "bd-service", "bd-vehicle", "rk-companies", "chart-heatmap", "insights", "money-status", "lifetime", "drill-jobs"] },
  drivers: { path: "/office/reports/drivers", api: "/office/analytics/drivers", h1: "Drivers", kpis: ["active_drivers", "off_avg_jobs", "off_coach", "delivery_success", "on_time_start", "off_acceptance_rate", "off_no_show_rate", "off_cancel_rate"], sections: ["chart-jobs", "chart-dist-jobs", "chart-dist-success", "chart-dist-rating", "guard-note", "rk-top", "rk-bottom", "coach", "idle", "chart-online", "chart-arrivals", "insights", "drill-drivers"] },
  earnings: { path: "/office/reports/earnings", api: "/office/analytics/earnings", h1: "Earnings", kpis: ["off_earnings", "off_paid", "off_pending", "off_settlements", "off_avg_per_job", "off_avg_per_parcel", "off_time_to_pay", "off_withdrawn", "off_withdrawals_pending", "off_wallet"], sections: ["chart-earnings", "chart-withdrawals", "rk-drivers", "rk-companies", "bd-city", "bd-service", "chart-pipeline", "bd-settle-status", "chart-pay-time", "bd-withdrawals", "card-wallet", "insights", "drill-settlements", "drill-payouts", "drill-ledger"] },
};
type Spec = (typeof BIZ)[keyof typeof BIZ] | (typeof OFF)[keyof typeof OFF];

let biz: BrowserContext, office: BrowserContext;
test.beforeAll(async ({ browser }: { browser: Browser }) => { biz = await apiLogin(browser, DEMO.business); office = await apiLogin(browser, DEMO.office); });
test.afterAll(async () => { await biz.close(); await office.close(); });

async function expectComplete(page: Page, ctx: BrowserContext, s: Spec) {
  const oracle = (await getJson(ctx, `${s.api}?compare=none`)).json;
  await gotoReady(page, `${s.path}?compare=none`);
  await expect(page.getByRole("heading", { level: 1, name: s.h1, exact: true })).toBeVisible();
  if (oracle.meta.empty) { await expect(page.getByText("No data for this selection").first()).toBeVisible(); return; }
  for (const k of s.kpis) await expect(page.getByTestId(`kpi-${k}`), k).toBeVisible();
  for (const id of s.sections) await expect(page.getByTestId(id).first(), id).toBeVisible();
  for (const k of oracle.kpis) if (k.value != null && !["biz_forecast"].includes(k.key)) await expect(page.getByTestId(`kpi-${k.key}`).first(), k.key).toHaveAttribute("data-value", String(k.value));
  await expect(page.getByTestId("report-summary")).toContainText("Days: 30");
  await expect(page.getByTestId("report-summary")).toContainText("No comparison");
  await expect(page.getByTestId("report-updated")).toContainText("Updated");
  expect(await noSideways(page)).toBe(true);
}

test.describe("company portal", () => {
  for (const [name, s] of Object.entries(BIZ)) {
    test(`${name}: header, every KPI and section, and the numbers are the API's`, async ({ page }) => {
      await otpLogin(page, DEMO.business);
      await expectComplete(page, biz, s);
    });
  }
  test("filters: the company's own set only, in the URL, with the definitions legend", async ({ page }) => {
    await otpLogin(page, DEMO.business);
    await gotoReady(page, "/business/reports");
    for (const k of ["city", "service", "vehicle", "status", "channel"]) await expect(page.getByTestId(`report-filter-${k}`), k).toBeVisible();
    for (const k of ["company", "office", "driver"]) await expect(page.getByTestId(`report-filter-${k}`), k).toHaveCount(0);
    await group(page, "Period").getByRole("button", { name: "7 days" }).click();
    await expect(page).toHaveURL(/preset=7d/);
    await expect(page.getByTestId("report-summary")).toContainText("Days: 7");
    await page.getByTestId("report-filter-channel").click();
    await page.getByRole("dialog", { name: "Channel" }).getByRole("checkbox", { name: /Web/ }).check();
    await expect(page).toHaveURL(/channel=web/);
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("report-chips")).toContainText("Channel: Web");
    const j = (await getJson(biz, "/business/analytics/overview?preset=7d&channel=web")).json;
    if (!j.meta.empty) await expect(page.getByTestId("kpi-biz_requests")).toHaveAttribute("data-value", String(kpiOf(j, "biz_requests")!.value));
    await page.getByTestId("report-reset").click();
    await expect(page).toHaveURL(/\/business\/reports$/);
    await page.getByTestId("report-definitions").locator("summary").click();
    await expect(page.getByTestId("report-definitions")).toContainText("Everything shown is your company's own data");
    await expect(page.getByTestId("report-definitions")).toContainText("Cost per parcel");
  });
  test("a forged company / office / driver filter is ignored and says so; the numbers stay the company's", async ({ page }) => {
    await otpLogin(page, DEMO.business);
    const own = (await getJson(biz, "/business/analytics/overview?compare=none")).json;
    const forged = "11111111-2222-4333-8444-555555555555";
    const spoof = (await getJson(biz, `/business/analytics/overview?compare=none&company=${forged}&office=${forged}&driver=${forged}`)).json;
    expect(spoof.kpis.map((k: { key: string; value: number | null }) => [k.key, k.value])).toEqual(own.kpis.map((k: { key: string; value: number | null }) => [k.key, k.value]));
    expect(spoof.meta.ignored.sort()).toEqual(["company", "driver", "office"]);
    await gotoReady(page, `/business/reports?compare=none&company=${forged}&office=${forged}`);
    await expect(page.getByText(/were ignored/)).toBeVisible();
    await expect(page.getByTestId("report-chips")).toHaveCount(0);
    if (!own.meta.empty) await expect(page.getByTestId("kpi-biz_requests")).toHaveAttribute("data-value", String(kpiOf(own, "biz_requests")!.value));
  });
  test("tables: sort by a header, page, and CSV of the company's own rows only", async ({ page }) => {
    await otpLogin(page, DEMO.business);
    const probe = (await getJson(biz, "/business/analytics/table/parcels?pageSize=5")).json;
    await gotoReady(page, "/business/reports/deliveries");
    const t = page.getByTestId("drill-parcels");
    await expect(t.getByRole("button", { name: /^Registered, sorted descending/ })).toBeVisible(); // the default order
    if (probe.total > 0) {
      await expect(t.getByRole("table")).toBeVisible();
      await t.getByRole("button", { name: /^Sort by Parcel/ }).click();
      await expect(t.getByRole("button", { name: /^Parcel, sorted ascending/ })).toBeVisible();
      const href = await page.getByTestId("drill-parcels-csv").getAttribute("href");
      expect(href).toContain("/api/v1/business/analytics/table/parcels"); expect(href).toContain("format=csv");
      const csv = await getJson(biz, href!.replace("/api/v1", ""));
      expect(csv.status).toBe(200); expect(csv.type).toContain("text/csv");
      expect(csv.text.split("\n")[0]).toContain("code,"); expect(csv.text.split("\n").length - 1).toBe(probe.total);
      expect(csv.text).not.toMatch(/recipient|phone/i);
    } else await expect(t).toContainText("No data for this selection");
    // the header CSV button belongs to the owner too (no staff permission needed)
    await expect(page.getByTestId("report-csv")).toHaveAttribute("href", /\/api\/v1\/business\/analytics\/table\/parcels\?.*format=csv/);
  });
  test("the drivers who served the company show a first name and a rating, never a phone", async ({ page }) => {
    await otpLogin(page, DEMO.business);
    await gotoReady(page, "/business/reports/deliveries");
    const card = page.getByTestId("rk-drivers");
    await expect(card).toBeVisible();
    expect(await card.innerText()).not.toMatch(/(\+?966|05)\d{8}/);
    await expect(page.getByTestId("report-filter-driver")).toHaveCount(0);
  });
  test("spending: the estimate is labelled, and credit use is explained", async ({ page }) => {
    await otpLogin(page, DEMO.business);
    await gotoReady(page, "/business/reports/spending");
    const f = page.getByTestId("card-forecast");
    await expect(f).toContainText("Estimate");
    await expect(f.getByTestId("forecast-total").or(f.getByTestId("forecast-none"))).toBeVisible();
    await expect(page.getByTestId("card-wallet")).toContainText(/Credit limit/);
  });
  test("sidebar: the Reports group has the three pages and navigates between them", async ({ page }) => {
    await otpLogin(page, DEMO.business);
    await gotoReady(page, "/business/reports");
    const nav = page.getByRole("navigation", { name: "Main navigation" }).first();
    for (const href of ["/business/reports", "/business/reports/deliveries", "/business/reports/spending"]) await expect(nav.locator(`a[href="${href}"]`), href).toBeVisible();
    await nav.locator('a[href="/business/reports/spending"]').click();
    await expect(page).toHaveURL(/\/business\/reports\/spending/);
    await expect(page.getByRole("heading", { level: 1, name: "Spending", exact: true })).toBeVisible();
  });
});

test.describe("courier-office portal", () => {
  for (const [name, s] of Object.entries(OFF)) {
    test(`${name}: header, every KPI and section, and the numbers are the API's`, async ({ page }) => {
      await otpLogin(page, DEMO.office);
      await expectComplete(page, office, s);
    });
  }
  test("overview keeps what the old report showed: jobs by status with CSV, money by status, reliability", async ({ page }) => {
    await otpLogin(page, DEMO.office);
    await gotoReady(page, "/office/reports");
    await expect(page.getByTestId("office-report")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Jobs by status" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Settlements by status" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Export CSV" }).first()).toBeVisible();
    await expect(page.getByTestId("money-status")).toBeVisible();
    await expect(page.getByTestId("lifetime")).toBeVisible();
    const rows = page.getByTestId("office-report-row");
    if ((await rows.count()) > 0) {
      const [dl] = await Promise.all([page.waitForEvent("download"), page.getByTestId("office-report-export").click()]);
      expect(dl.suggestedFilename()).toMatch(/^office-report-.*\.csv$/);
    }
  });
  test("filters: the office's own drivers, nothing about companies or other offices", async ({ page }) => {
    await otpLogin(page, DEMO.office);
    const opts = (await getJson(office, "/office/analytics/options")).json;
    await gotoReady(page, "/office/reports");
    for (const k of ["city", "service", "vehicle", "driver"]) await expect(page.getByTestId(`report-filter-${k}`), k).toBeVisible();
    for (const k of ["company", "office", "status", "channel"]) await expect(page.getByTestId(`report-filter-${k}`), k).toHaveCount(0);
    if (opts.drivers.length === 0) return;
    const first = opts.drivers[0] as { id: string; name: string };
    await page.getByTestId("report-filter-driver").click();
    const dlg = page.getByRole("dialog", { name: "Driver" });
    await dlg.getByRole("checkbox", { name: new RegExp(first.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")) }).check();
    await expect(page).toHaveURL(new RegExp(`driver=${first.id}`));
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("report-chips")).toContainText(`Driver: ${first.name}`);
    const j = (await getJson(office, `/office/analytics/overview?driver=${first.id}`)).json;
    if (!j.meta.empty) await expect(page.getByTestId("kpi-off_jobs")).toHaveAttribute("data-value", String(kpiOf(j, "off_jobs")!.value));
    // a hand-typed driver of somebody else's fleet matches nothing and is reported as ignored, never as data
    const forged = "11111111-2222-4333-8444-555555555555";
    const f = (await getJson(office, `/office/analytics/overview?driver=${forged}`)).json;
    expect(kpiOf(f, "off_jobs")!.value).toBe(0); expect(f.meta.ignored).toContain("driver");
  });
  test("customers are anonymous: the company list shows Company C-…, never a name", async ({ page }) => {
    await otpLogin(page, DEMO.office);
    await gotoReady(page, "/office/reports");
    const rk = page.getByTestId("rk-companies");
    await expect(rk).toBeVisible();
    const text = await rk.innerText();
    if (!/No data for this selection/.test(text)) expect(text).toMatch(/Company C-[0-9A-F]{5}/);
    expect(text).not.toContain("Nakheel");
    const j = (await getJson(office, "/office/analytics/overview")).json;
    expect(JSON.stringify(j)).not.toContain("Nakheel");
  });
  test("the drivers report explains its minimum-volume guard and every flag has a reason", async ({ page }) => {
    await otpLogin(page, DEMO.office);
    await gotoReady(page, "/office/reports/drivers");
    await expect(page.getByTestId("guard-note")).toContainText("at least 10 resolved parcels");
    for (const item of await page.getByTestId("coach-item").all()) await expect(item.getByRole("list").getByRole("listitem").first()).not.toBeEmpty();
    const t = page.getByTestId("drill-drivers");
    await expect(t.getByRole("button", { name: /^Jobs, sorted descending/ })).toBeVisible();
  });
  test("sidebar: the Reports group has the four pages", async ({ page }) => {
    await otpLogin(page, DEMO.office);
    await gotoReady(page, "/office/reports/earnings");
    const nav = page.getByRole("navigation", { name: "Main navigation" }).first();
    for (const href of ["/office/reports", "/office/reports/drivers", "/office/reports/earnings", "/office/reports/performance"]) await expect(nav.locator(`a[href="${href}"]`), href).toBeVisible();
  });
});

test.describe("security from the browser session", () => {
  test("a company session cannot read the office or the staff reports, an office session cannot read the company or the staff reports", async () => {
    for (const p of ["/office/analytics/overview", "/office/analytics/options", "/office/analytics/table/jobs", "/admin/analytics/overview", "/admin/analytics/options"]) expect((await getJson(biz, p)).status, p).toBe(403);
    for (const p of ["/business/analytics/overview", "/business/analytics/options", "/business/analytics/table/parcels", "/admin/analytics/overview"]) expect((await getJson(office, p)).status, p).toBe(403);
    const anon = await (await office.browser()!.newContext()).request.get(`${BASE}/api/v1/business/analytics/overview`);
    expect(anon.status()).toBe(401);
  });
  test("the other portal's pages do not exist for the signed-in role", async ({ page }) => {
    await otpLogin(page, DEMO.business);
    await page.goto("/office/reports");
    await expect(page).not.toHaveURL(/\/office\/reports/); // the role layout sends a company home
    await otpLogin(page, DEMO.office);
    await page.goto("/business/reports/spending");
    await expect(page).not.toHaveURL(/\/business\/reports/);
  });
});

test.describe("resilience", () => {
  test("a section the server could not compute is marked unavailable while the rest of the report renders", async ({ page }) => {
    await otpLogin(page, DEMO.business);
    await page.route("**/api/v1/business/analytics/overview?*", async (route) => {
      const res = await route.fetch(); const j = await res.json();
      j.series.spend = null; j.meta.failed = ["series_spend"];
      await route.fulfill({ response: res, json: j });
    });
    await gotoReady(page, "/business/reports");
    await expect(page.getByTestId("portal-partial")).toBeVisible();
    await expect(page.getByTestId("chart-spend-unavailable")).toContainText("could not be loaded");
    await expect(page.getByTestId("chart-requests")).toBeVisible();
    await expect(page.getByTestId("kpi-biz_requests")).toBeVisible();
  });
  test("a timeout shows the hint and a retry that works", async ({ page }) => {
    await otpLogin(page, DEMO.office);
    let fail = true;
    await page.route("**/api/v1/office/analytics/earnings?*", (route) => (fail ? route.fulfill({ status: 503, json: { error: { code: "DEPENDENCY_UNAVAILABLE", message: "The report took too long to compute.", correlation_id: "t", details: { reason: "timeout" } } } }) : route.continue()));
    await gotoReady(page, "/office/reports/earnings");
    await expect(page.locator('[role="alert"]:not(#__next-route-announcer__)')).toBeVisible();
    await expect(page.getByText("The report took too long to compute. Narrow the period or the filters and try again.")).toBeVisible();
    fail = false;
    await page.getByRole("button", { name: "Try again" }).click();
    await expect(page.locator('[role="alert"]:not(#__next-route-announcer__)')).toHaveCount(0); // the error is gone: the report (or its "no data" state on a fresh database) is shown
    await expect(page.getByTestId("kpi-off_earnings").or(page.getByText("No data for this selection")).first()).toBeVisible();
  });
  test("a hand-typed invalid filter shows the reason and a way back", async ({ page }) => {
    await otpLogin(page, DEMO.business);
    await gotoReady(page, "/business/reports?city=" + "x".repeat(50));
    await expect(page.getByTestId("report-error-detail")).toBeVisible();
    await page.getByTestId("report-reset").click();
    await expect(page.getByTestId("kpi-biz_requests")).toBeVisible();
  });
  test("an empty selection says so and the page recovers", async ({ page }) => {
    await otpLogin(page, DEMO.business);
    await gotoReady(page, "/business/reports?from=2020-01-01&to=2020-01-10&compare=none");
    await expect(page.getByText("No data for this selection").first()).toBeVisible();
    await page.getByTestId("report-reset").click();
    await expect(page.getByTestId("kpi-biz_requests")).toBeVisible();
  });
});

test.describe("phone width and Arabic", () => {
  const all: Array<[string, string, string]> = [...Object.values(BIZ).map((s) => ["business", s.path, DEMO.business] as [string, string, string]), ...Object.values(OFF).map((s) => ["office", s.path, DEMO.office] as [string, string, string])];
  test("390 px: nothing scrolls sideways and tables become cards", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    for (const [role, path, phone] of all) {
      await otpLogin(page, phone);
      await gotoReady(page, path);
      await page.waitForTimeout(700);
      expect(await noSideways(page), `${role} ${path}`).toBe(true);
    }
    await otpLogin(page, DEMO.office);
    await gotoReady(page, "/office/reports/drivers");
    const row = page.getByTestId("drill-drivers").locator("tbody tr").first();
    if (await row.count()) await expect(row.locator("td[data-label]").first()).toBeVisible();
  });
  test("Arabic: the page mirrors, KPIs are translated and nothing overflows", async ({ page }) => {
    await page.context().addCookies([{ name: "jr_lang", value: "ar", url: BASE }]);
    for (const [role, path, phone] of all) {
      await otpLogin(page, phone);
      await gotoReady(page, path);
      await expect(page.locator("html"), `${role} ${path}`).toHaveAttribute("dir", "rtl");
      await expect(page.getByRole("heading", { level: 1 }).first()).toBeVisible();
      await expect(page.getByText(/\{[a-z_]+\}/), `${path} shows no raw placeholders`).toHaveCount(0);
      await expect(page.getByText(/rpr\.[a-z_.]+/), `${path} shows no raw keys`).toHaveCount(0);
      expect(await noSideways(page), `${role} ${path}`).toBe(true);
    }
    await gotoReady(page, "/business/reports");
    await expect(page.getByRole("heading", { level: 1 }).first()).toContainText(/[\u0600-\u06FF]/); // the page is translated (a company without activity has no KPI grid)
    if (await page.getByTestId("report-definitions").count()) { // (the legend only exists once the company has data)
      await page.getByTestId("report-definitions").locator("summary").click();
      await expect(page.getByTestId("report-definitions")).toContainText("بيانات شركتك");
    }
  });
});
