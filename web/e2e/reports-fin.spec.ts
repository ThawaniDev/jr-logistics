import { test, expect, type APIRequestContext, type Browser, type Page } from "@playwright/test";
import { staffLogin, gotoReady, DEMO, apiLogin } from "./helpers";

/**
 * Reports › Deliveries, Cash on delivery and Revenue & finance: KPI groups with definitions, every chart and its table view, the section nav, filters in the URL,
 * drill-down tables with CSV, access rules (finance needs finance access, COD amounts are hidden without it), phone width and Arabic.
 * The spec publishes one request with cash-on-delivery parcels through the business API and tops up the wallet, so every report has something to show whatever ran before.
 * Numbers are judged against the API for the same filters, never against absolute counts, because specs share one database.
 */
test.describe.configure({ mode: "serial" });
const BASE = `http://localhost:${process.env.E2E_PORT ?? 3101}`; // not 3100: other projects on this machine use it
const ADMIN = { email: "admin@jrlogistics.test", password: "E2e!Password2026" };
const req = { id: "", ref: "", businessId: "" };

async function api(ctx: APIRequestContext, method: "GET" | "POST", path: string, data?: unknown) {
  const res = await ctx.fetch(`${BASE}/api/v1${path}`, { method, data, headers: { origin: BASE, "content-type": "application/json" } });
  return { status: res.status(), json: await res.json().catch(() => null) };
}
const businessApi = (browser: Browser) => apiLogin(browser, DEMO.business); // the shared helper reuses the session of an earlier sign-in (the OTP endpoint is rate-limited per IP)
const admin = (page: Page) => staffLogin(page, ADMIN.email, ADMIN.password);
const group = (page: Page, name: string) => page.getByRole("group", { name, exact: true });
const noSideways = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);

const DLV_KPIS = ["dlv_created", "dlv_handed", "parcels_delivered", "dlv_failed", "dlv_returned", "dlv_missing", "dlv_pending", "delivery_success", "first_attempt", "dlv_attempts_avg", "dlv_defer_rate", "dlv_return_rate", "dlv_return_time",
  "dlv_incomplete_rate", "dlv_b2b_share", "dlv_b2c_success", "dlv_b2b_success", "dlv_evidence_rate", "dlv_otp_fail_rate", "dlv_far_rate", "dlv_time_p50", "dlv_time_p90", "dlv_dwell_p50", "dlv_dist_p50", "dlv_dist_p90",
  "dlv_sms_per_parcel", "dlv_parcels_per_job", "dlv_stops_per_hour", "dlv_leg_ratio"];
const DLV_SECTIONS = ["dlv-chart-outcomes", "dlv-chart-success", "dlv-chart-flow", "dlv-chart-funnel", "dlv-chart-reasons", "dlv-rank-reasons", "dlv-matrix-city", "dlv-matrix-company", "dlv-chart-defer", "dlv-chart-attempts",
  "dlv-chart-time", "dlv-chart-speed", "dlv-chart-distance", "dlv-chart-proof", "dlv-heat-delivered", "dlv-heat-failed", "dlv-groups", "dlv-worst", "dlv-insights", "dlv-drill-parcels", "dlv-drill-failed", "dlv-drill-slow", "dlv-drill-returns"];
const COD_KPIS = ["cod_collected", "cod_remitted", "cod_outstanding", "cod_remit_rate", "cod_avg_value", "cod_collection_rate", "cod_uncollected", "cod_aged_value", "cod_parcels", "cod_share", "cod_failed", "cod_mismatch", "cod_aged_orders", "cod_holders", "cod_lag_p50", "cod_lag_p90"];
const COD_SECTIONS = ["cod-chart-cash", "cod-chart-mix", "cod-chart-aging", "cod-holders-switch", "cod-chart-lag", "cod-chart-received", "cod-slowest", "cod-insights", "cod-drill-outstanding", "cod-drill-remittances", "cod-drill-collected"];
const FIN_KPIS = ["fin_billed", "fin_vat", "fin_net_sales", "fin_provider", "fin_revenue", "fin_margin_pct", "fin_net_position", "fin_aov", "fin_rev_per_request", "fin_rev_per_parcel", "fin_settlements", "fin_concentration", "fin_payout_office", "fin_payout_direct",
  "fin_settle_latency", "fin_settle_unpaid", "fin_settle_held", "fin_wd_requested", "fin_wd_paid", "fin_wd_rejected", "fin_wd_turnaround", "fin_wd_pending", "fin_topups", "fin_wallet_liability", "fin_escrow", "fin_cash_drivers", "fin_credit_used",
  "fin_credit_util", "fin_invoices", "fin_invoiced", "fin_cancel_refunds", "fin_settle_refunds", "fin_adjustments"];
const FIN_SECTIONS = ["fin-chart-money", "fin-chart-margin-pct", "fin-chart-waterfall", "fin-chart-services", "fin-margin-switch", "fin-chart-payouts", "fin-chart-pipeline", "fin-chart-unpaid", "fin-chart-latency", "fin-chart-wd", "fin-chart-wd-turnaround",
  "fin-chart-balances", "fin-chart-refunds", "fin-rank-companies", "fin-rank-credit", "fin-outliers-low", "fin-outliers-high", "fin-insights", "fin-drill-companies", "fin-drill-settlements", "fin-drill-withdrawals", "fin-drill-ledger", "fin-drill-invoices"];

test("a published request with cash-on-delivery parcels and a wallet top-up, for the reports to show", async ({ browser }) => {
  const biz = await businessApi(browser);
  const shipments = [1, 2, 3].map((n) => ({ recipientName: `Fin Customer ${n}`, recipientPhone: `05500001${String(n + 10)}`, address: `${n} Olaya St, Riyadh`, externalRef: `FIN-${n}`, codCents: n * 2500 }));
  const pub = await api(biz.request, "POST", "/requests", { service: "delivery_driver", quantity: 1, shipmentsPerDriver: 10, vehicleType: "dokker", pickupCity: "riyadh", deliveryCity: "riyadh", pickupAddress: "Warehouse 4, Industrial Area", durationDays: 1, startsAt: new Date(Date.now() + 3 * 864e5).toISOString(), shipments });
  expect(pub.status, JSON.stringify(pub.json)).toBe(201);
  req.id = pub.json.id; req.ref = pub.json.ref;
  req.businessId = (await api(biz.request, "GET", `/requests/${req.id}`)).json.request.businessId;
  expect(req.businessId).toMatch(/^[0-9a-f-]{36}$/);
  const top = await api(biz.request, "POST", "/wallet/topup", { amountCents: 12_345, idempotencyKey: `fin-spec-${Date.now()}` });
  expect(top.status, JSON.stringify(top.json)).toBeLessThan(300);
});

test("deliveries: header, every KPI, every chart and table section is on the page", async ({ page }) => {
  await admin(page);
  await gotoReady(page, "/admin/reports/deliveries");
  await expect(page.getByRole("heading", { level: 1, name: "Deliveries", exact: true })).toBeVisible();
  for (const k of DLV_KPIS) await expect(page.getByTestId(`kpi-${k}`), k).toBeVisible();
  for (const g of ["flow", "quality", "speed"]) await expect(page.getByTestId(`group-${g}`), g).toBeVisible();
  for (const s of DLV_SECTIONS) await expect(page.getByTestId(s), s).toBeVisible();
  await expect(page.getByTestId("report-summary")).toContainText("Days: 30");
  await expect(page.getByTestId("report-updated")).toContainText("Updated");
  expect(await noSideways(page)).toBe(true);
});

test("deliveries: the section nav jumps to its sections and the numbers are the API's for the same filters", async ({ page }) => {
  await admin(page);
  const q = `company=${req.businessId}&compare=none`;
  const j = (await api(page.request, "GET", `/admin/analytics/deliveries?${q}`)).json;
  const created = j.kpis.find((k: { key: string }) => k.key === "dlv_created").value as number;
  expect(created).toBeGreaterThanOrEqual(3);
  await gotoReady(page, `/admin/reports/deliveries?${q}`);
  await expect(page.getByTestId("kpi-dlv_created")).toHaveAttribute("data-value", String(created));
  await expect(page.getByTestId("report-chips")).toContainText("Company: Nakheel Fresh Foods");
  await expect(page.getByTestId("report-summary")).toContainText("No comparison");
  const nav = page.getByTestId("section-nav");
  await expect(nav.getByRole("link", { name: "Why parcels fail" })).toBeVisible();
  await nav.getByRole("link", { name: "Breakdowns" }).click();
  await expect(page).toHaveURL(/#groups$/);
  await expect(page.getByTestId("dlv-groups")).toBeInViewport();
  // the parcels of the request are in the drill-down table (it loads when it scrolls into view)
  await page.getByTestId("dlv-drill-parcels").scrollIntoViewIfNeeded();
  await expect(page.getByTestId("dlv-drill-parcels")).toContainText(/JR-\d+-\d{3}/);
});

test("deliveries: one breakdown at a time, switched with the pills; worst performers state the minimum volume", async ({ page }) => {
  await admin(page);
  await gotoReady(page, "/admin/reports/deliveries?preset=90d");
  const g = page.getByTestId("dlv-groups");
  await expect(g.getByTestId("dlv-bd-city")).toBeVisible();
  await g.getByRole("button", { name: "Company" }).click();
  await expect(g.getByTestId("dlv-bd-company")).toBeVisible();
  await expect(g.getByRole("button", { name: "Company" })).toHaveAttribute("aria-pressed", "true");
  await g.getByRole("button", { name: "Driver" }).click();
  await expect(g.getByTestId("dlv-bd-driver")).toBeVisible();
  await expect(page.getByTestId("dlv-worst")).toContainText("at least 10 resolved parcels");
});

test("definitions: a KPI explains itself, ratios say what they divide, and the legend lists the report's KPIs", async ({ page }) => {
  await admin(page);
  await gotoReady(page, "/admin/reports/deliveries");
  await page.getByTestId("kpi-dlv_evidence_rate").getByRole("button", { name: /What does .* mean\?/ }).click();
  const tip = page.getByRole("tooltip");
  await expect(tip).toContainText("confirmed with a delivery code, a receipt photo or a signature");
  await expect(tip).toContainText("Numerator"); await expect(tip).toContainText("Denominator");
  await expect(tip).toBeInViewport();
  await page.keyboard.press("Escape");
  await page.getByTestId("report-definitions").locator("summary").click();
  for (const name of ["Parcels registered", "Strong-proof rate", "Actual vs planned leg time (×)", "Delivery success rate"]) await expect(page.getByTestId("report-definitions")).toContainText(name);
});

test("charts have a table view with the same numbers and no holes in the period", async ({ page }) => {
  await admin(page);
  await gotoReady(page, "/admin/reports/deliveries?preset=7d");
  const card = page.getByTestId("dlv-chart-outcomes");
  await expect(card.getByRole("img", { name: /^Parcels by outcome/ })).toBeVisible();
  await page.getByTestId("dlv-chart-outcomes-toggle").click();
  await expect(card.getByRole("table")).toBeVisible();
  await expect(card.getByRole("columnheader", { name: "Delivered" })).toBeVisible();
  expect(await card.getByRole("row").count()).toBe(1 + 7);
  await page.getByTestId("dlv-chart-outcomes-toggle").click();
  await page.getByTestId("dlv-chart-proof-toggle").click();
  await expect(page.getByTestId("dlv-chart-proof").getByRole("table")).toContainText("Delivery code");
  await gotoReady(page, "/admin/reports/finance?preset=7d");
  await page.getByTestId("fin-chart-money-toggle").click();
  expect(await page.getByTestId("fin-chart-money").getByRole("row").count()).toBe(1 + 7);
});

test("filters live in the URL and every report keeps them", async ({ page }) => {
  await admin(page);
  await gotoReady(page, "/admin/reports/cod");
  await group(page, "Period").getByRole("button", { name: "7 days" }).click();
  await expect(page).toHaveURL(/preset=7d/);
  await page.getByTestId("report-filter-city").click();
  const city = page.getByRole("dialog", { name: "City" });
  await city.getByRole("checkbox", { name: /Riyadh/ }).check();
  await expect(page).toHaveURL(/city=riyadh/);
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("report-chips")).toContainText("City: Riyadh");
  const shared = page.url();
  await gotoReady(page, shared.replace("/reports/cod", "/reports/finance"));
  await expect(page.getByRole("heading", { level: 1, name: "Revenue & finance" })).toBeVisible();
  await expect(group(page, "Period").getByRole("button", { name: "7 days" })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByTestId("report-chips")).toContainText("City: Riyadh");
  // a card that a filter cannot narrow says so
  await expect(page.getByTestId("kpi-fin_wallet_liability")).toContainText("Not narrowed by");
  await page.getByTestId("report-reset").click();
  await expect(page).toHaveURL(/\/admin\/reports\/finance$/);
});

test("cash on delivery: KPIs, aging, holders and tables for finance staff", async ({ page }) => {
  await admin(page);
  await gotoReady(page, "/admin/reports/cod");
  await expect(page.getByRole("heading", { level: 1, name: "Cash on delivery", exact: true })).toBeVisible();
  for (const k of COD_KPIS) await expect(page.getByTestId(`kpi-${k}`), k).toBeVisible();
  for (const s of COD_SECTIONS) await expect(page.getByTestId(s), s).toBeVisible();
  const holders = page.getByTestId("cod-holders-switch");
  await holders.getByRole("button", { name: "Companies" }).click();
  await expect(holders.getByTestId("cod-holders-company")).toBeVisible();
  const j = (await api(page.request, "GET", "/admin/analytics/cod?compare=none")).json;
  await expect(page.getByTestId("cod-chart-aging")).toContainText("15 days or more");
  expect(j.aging).toHaveLength(5);
  await gotoReady(page, "/admin/reports/cod?compare=none");
  await expect(page.getByTestId("kpi-cod_collected")).toHaveAttribute("data-value", String(j.kpis.find((k: { key: string }) => k.key === "cod_collected").value));
  expect(await noSideways(page)).toBe(true);
});

test("finance: every KPI, chart and table, the waterfall and the company ranking", async ({ page }) => {
  await admin(page);
  await gotoReady(page, "/admin/reports/finance");
  await expect(page.getByRole("heading", { level: 1, name: "Revenue & finance", exact: true })).toBeVisible();
  for (const k of FIN_KPIS) await expect(page.getByTestId(`kpi-${k}`), k).toBeVisible();
  for (const s of FIN_SECTIONS) await expect(page.getByTestId(s), s).toBeVisible();
  await expect(page.getByTestId("fin-chart-waterfall")).toContainText("Margin after VAT");
  const j = (await api(page.request, "GET", `/admin/analytics/finance?compare=none`)).json;
  await gotoReady(page, "/admin/reports/finance?compare=none");
  await expect(page.getByTestId("kpi-fin_topups")).toHaveAttribute("data-value", String(j.kpis.find((k: { key: string }) => k.key === "fin_topups").value));
  expect(j.kpis.find((k: { key: string }) => k.key === "fin_topups").value).toBeGreaterThanOrEqual(12_345);
  const m = page.getByTestId("fin-margin-switch");
  await m.getByRole("button", { name: "Vehicle" }).click();
  await expect(m.getByTestId("fin-margin-vehicle")).toBeVisible();
  expect(await noSideways(page)).toBe(true);
});

test("drill-down tables: sort by a header and the CSV of the whole filtered set (every report)", async ({ page }) => {
  await admin(page);
  await gotoReady(page, `/admin/reports/deliveries?company=${req.businessId}&compare=none`);
  const t = page.getByTestId("dlv-drill-parcels");
  await expect(t.getByRole("table")).toBeVisible();
  const sorted = page.waitForResponse((r) => r.url().includes("/deliveries/table/parcels") && r.url().includes("sort=code") && r.url().includes("dir=asc"));
  await t.getByRole("button", { name: "Sort by Parcel" }).click();
  expect((await sorted).status()).toBe(200);
  await expect(t.getByRole("button", { name: /^Parcel, sorted ascending/ })).toBeVisible();
  const href = (await t.getByTestId("dlv-drill-parcels-csv").getAttribute("href"))!;
  expect(href).toContain("/api/v1/admin/analytics/deliveries/table/parcels"); expect(href).toContain("format=csv"); expect(href).toContain(`company=${req.businessId}`);
  const res = await page.request.get(href);
  expect(res.status()).toBe(200); expect(res.headers()["content-type"]).toContain("text/csv");
  const body = await res.text();
  const raw = await (await page.request.get(`${href}&headers=keys`)).text(); // the machine form keeps the column keys
  expect(raw.startsWith("﻿code,")).toBe(true); expect(body.startsWith("﻿")).toBe(true); expect(body.split("\n")[0]).not.toBe(raw.split("\n")[0]); // the default CSV has readable headers
  expect(body).toMatch(/JR-\d+-\d{3}/);
  await expect(page.getByTestId("report-csv")).toHaveAttribute("href", /\/analytics\/deliveries\/table\/parcels\?.*format=csv/);
  for (const [path, id, table] of [["cod", "cod-drill-remittances", "remittances"], ["finance", "fin-drill-companies", "companies"]] as const) {
    await gotoReady(page, `/admin/reports/${path}?compare=none`);
    const href2 = (await page.getByTestId(`${id}-csv`).getAttribute("href"))!;
    expect(href2).toContain(`/analytics/${path}/table/${table}`);
    const r2 = await page.request.get(href2);
    expect(r2.status(), table).toBe(200); expect(r2.headers()["content-type"]).toContain("text/csv");
  }
});

test("empty selection says so and the page recovers", async ({ page }) => {
  await admin(page);
  for (const path of ["deliveries", "cod", "finance"]) {
    await gotoReady(page, `/admin/reports/${path}?from=2020-01-01&to=2020-01-10&compare=none`);
    await expect(page.getByText("No data for this selection").first(), path).toBeVisible();
    await page.getByTestId("report-reset").click();
    await expect(page.getByTestId("report-shell")).toBeVisible();
  }
});

/** A signed-in browser page for a new staff member with exactly these permissions (the temporary password is replaced through the API first). */
async function staffPage(browser: Browser, page: Page, permissions: string[], tag: string) {
  const email = `fin${tag}${Date.now()}@jrlogistics.test`, first = "Temp0rary!Pass1", next = "Brand-New-Pass9x";
  const made = await api(page.request, "POST", "/admin/staff", { name: `Fin ${tag}`, email, password: first, permissions });
  expect(made.status, JSON.stringify(made.json)).toBe(201);
  const ctx = await browser.newContext();
  const post = (path: string, data: unknown) => ctx.request.fetch(`${BASE}/api/v1${path}`, { method: "POST", data, headers: { origin: BASE, "content-type": "application/json" } });
  expect((await post("/auth/staff/login", { email, password: first })).status()).toBe(200);
  expect((await post("/auth/change-password", { currentPassword: first, newPassword: next })).status()).toBe(200);
  expect((await post("/auth/staff/login", { email, password: next })).status()).toBe(200);
  return ctx.newPage();
}

test("access: without finance access COD shows counts but no amounts, finance is refused, the API agrees", async ({ page, browser }) => {
  await admin(page);
  const viewer = await staffPage(browser, page, ["reports.view"], "v");
  await gotoReady(viewer, "/admin/reports/cod");
  await expect(viewer.getByTestId("kpi-cod_parcels")).toBeVisible();
  await expect(viewer.getByTestId("kpi-cod_holders")).toBeVisible();
  for (const k of ["cod_collected", "cod_remitted", "cod_outstanding", "cod_avg_value", "cod_aged_value"]) await expect(viewer.getByTestId(`kpi-${k}`), k).toHaveCount(0);
  await expect(viewer.getByTestId("cod-chart-cash")).toHaveCount(0);
  await expect(viewer.getByTestId("cod-holders-switch")).toHaveCount(0);
  await expect(viewer.getByTestId("cod-alerts")).toHaveCount(0);
  await expect(viewer.getByTestId("cod-drill-outstanding")).toHaveCount(0);
  await expect(viewer.getByText("need finance access")).toBeVisible();
  await expect(viewer.getByTestId("cod-chart-aging")).toBeVisible(); // the order counts stay
  await gotoReady(viewer, "/admin/reports/deliveries");
  await expect(viewer.getByTestId("kpi-dlv_created")).toBeVisible(); // parcels carry no money
  await gotoReady(viewer, "/admin/reports/finance");
  await expect(viewer.getByTestId("no-access")).toBeVisible(); // a calm "no access" page (decision K9), not an error alert
  await expect(viewer.getByTestId("kpi-fin_billed")).toHaveCount(0);
  expect((await api(viewer.request, "GET", "/admin/analytics/finance")).status).toBe(403);
  expect((await api(viewer.request, "GET", "/admin/analytics/cod/table/outstanding")).status).toBe(403);
  expect((await api(viewer.request, "GET", "/admin/analytics/finance/table/ledger")).status).toBe(403);
  const moneyOnly = await staffPage(browser, page, ["finance.view"], "m");
  expect((await api(moneyOnly.request, "GET", "/admin/analytics/finance")).status).toBe(403); // finance needs reports.view too
  const biz = await businessApi(browser);
  for (const p of ["deliveries", "cod", "finance"]) expect((await api(biz.request, "GET", `/admin/analytics/${p}`)).status, p).toBe(403);
});

test("phone width: nothing scrolls sideways, sections stay on screen, the section nav scrolls on its own", async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();
  await admin(page);
  for (const [path, sections] of [["deliveries", DLV_SECTIONS], ["cod", COD_SECTIONS], ["finance", FIN_SECTIONS]] as const) {
    await gotoReady(page, `/admin/reports/${path}`);
    await expect(page.getByTestId("section-nav")).toBeVisible();
    expect(await noSideways(page), path).toBe(true);
    for (const s of sections) { const box = await page.getByTestId(s).boundingBox(); expect(box!.x + box!.width, `${path} ${s}`).toBeLessThanOrEqual(391); }
  }
  // the drill-down rows become cards (the header row is hidden on phones)
  await gotoReady(page, "/admin/reports/deliveries");
  await expect(page.getByTestId("dlv-drill-parcels").getByRole("row").nth(1)).toBeVisible();
  await ctx.close();
});

test("Arabic: right-to-left, translated, nothing scrolls sideways", async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();
  await admin(page); // the sign-in screen is English; switch the language after it
  await ctx.addCookies([{ name: "jr_lang", value: "ar", url: BASE }]);
  await gotoReady(page, "/admin/reports/deliveries");
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  await expect(page.getByRole("heading", { level: 1, name: "التوصيل", exact: true })).toBeVisible();
  await expect(page.getByTestId("kpi-dlv_created")).toContainText("الطرود المسجَّلة");
  await expect(page.getByTestId("dlv-chart-outcomes")).toContainText("الطرود حسب النتيجة");
  expect(await noSideways(page)).toBe(true);
  await gotoReady(page, "/admin/reports/cod");
  await expect(page.getByRole("heading", { level: 1, name: "الدفع عند الاستلام", exact: true })).toBeVisible();
  await expect(page.getByTestId("kpi-cod_collected")).toContainText("النقد المحصَّل");
  expect(await noSideways(page)).toBe(true);
  await gotoReady(page, "/admin/reports/finance");
  await expect(page.getByTestId("kpi-fin_billed")).toContainText("المبلغ المفوتر");
  await expect(page.getByTestId("fin-chart-waterfall")).toContainText("الهامش بعد الضريبة");
  expect(await noSideways(page)).toBe(true);
  await ctx.close();
});

test("cleanup: the request published for this spec is cancelled", async ({ browser }) => {
  const biz = await businessApi(browser);
  const res = await api(biz.request, "POST", `/requests/${req.id}/cancel`, { reason: "e2e reports fin cleanup" });
  expect(res.status, JSON.stringify(res.json)).toBeLessThan(300);
});
