import { test, expect, type APIRequestContext, type Browser, type Page } from "@playwright/test";
import { staffLogin, gotoReady, DEMO, apiLogin } from "./helpers";

/**
 * Reports › Overview and the reports framework (decisions G2–G4): the KPI grid with definitions, the charts and their table views, rankings,
 * the filter bar that lives in the URL, drill-down tables with CSV, the empty state, phone width and Arabic.
 * The spec publishes one request through the business API (so the report has something to show whatever ran before) and cancels it at the end.
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
const KPIS = ["gmv", "revenue", "margin_pct", "aov", "requests_created", "requests_completed", "parcels_delivered", "delivery_success", "first_attempt", "cancellation_rate", "active_companies", "active_drivers", "new_signups", "parcels_per_request", "on_time_start", "time_to_fill"];
const SECTIONS = ["chart-money", "chart-requests", "chart-parcels", "chart-funnel", "bd-city", "bd-service", "bd-channel", "bd-vehicle", "chart-heatmap", "chart-fill", "rk-companies", "rk-drivers", "insights", "movers", "drill-requests", "drill-settlements"];

test("a published request for the report to show", async ({ browser }) => {
  const biz = await businessApi(browser);
  const shipments = [1, 2, 3].map((n) => ({ recipientName: `Report Customer ${n}`, recipientPhone: `05500000${String(n + 10)}`, address: `${n} Olaya St, Riyadh`, externalRef: `RPT-${n}` }));
  const pub = await api(biz.request, "POST", "/requests", { service: "delivery_driver", quantity: 1, shipmentsPerDriver: 10, vehicleType: "dokker", pickupCity: "riyadh", deliveryCity: "riyadh", pickupAddress: "Warehouse 4, Industrial Area", durationDays: 1, startsAt: new Date(Date.now() + 7 * 864e5).toISOString(), publish: true, termsAccepted: true, shipments });
  expect(pub.status, JSON.stringify(pub.json)).toBe(201);
  req.id = pub.json.id; req.ref = pub.json.ref;
  req.businessId = (await api(biz.request, "GET", `/requests/${req.id}`)).json.request.businessId;
  expect(req.businessId).toMatch(/^[0-9a-f-]{36}$/);
});

test("overview: header, every KPI, every chart and table section is on the page", async ({ page }) => {
  await admin(page);
  await gotoReady(page, "/admin/reports");
  await expect(page.getByRole("heading", { level: 1, name: "Overview", exact: true })).toBeVisible();
  await expect(page.getByTestId("kpi-grid")).toBeVisible();
  for (const k of KPIS) await expect(page.getByTestId(`kpi-${k}`), k).toBeVisible();
  for (const s of SECTIONS) await expect(page.getByTestId(s), s).toBeVisible();
  await expect(page.getByTestId("report-summary")).toContainText("Showing");
  await expect(page.getByTestId("report-summary")).toContainText("Days: 30");
  await expect(page.getByTestId("report-summary")).toContainText("Compared with");
  await expect(page.getByTestId("report-updated")).toContainText("Updated");
  expect(await noSideways(page)).toBe(true);
});

test("overview: the numbers on the page are the numbers of the API for the same filters", async ({ page }) => {
  await admin(page);
  const q = `company=${req.businessId}&compare=none`;
  const j = (await api(page.request, "GET", `/admin/analytics/overview?${q}`)).json;
  const created = j.kpis.find((k: { key: string }) => k.key === "requests_created").value as number;
  expect(created).toBeGreaterThanOrEqual(1);
  await gotoReady(page, `/admin/reports?${q}`);
  await expect(page.getByTestId("kpi-requests_created")).toHaveAttribute("data-value", String(created));
  await expect(page.getByTestId("report-chips")).toContainText("Company: Nakheel Fresh Foods");
  await expect(page.getByTestId("report-summary")).toContainText("No comparison");
  // without a comparison the cards show no change pill and the movers panel says how to get one
  await expect(page.getByTestId("movers")).toContainText("Turn on a comparison");
  // the request just published appears in the drill-down table with its reference
  await expect(page.getByTestId("drill-requests")).toContainText(req.ref);
});

test("definitions: every KPI explains itself, ratios say what they divide, and the legend lists them all", async ({ page }) => {
  await admin(page);
  await gotoReady(page, "/admin/reports");
  await page.getByTestId("kpi-delivery_success").getByRole("button", { name: /What does .* mean\?/ }).click();
  const tip = page.getByRole("tooltip");
  await expect(tip).toContainText("Share of resolved parcels that were delivered");
  await expect(tip).toContainText("Numerator");
  await expect(tip).toContainText("Denominator");
  await expect(tip).toBeInViewport();
  await page.keyboard.press("Escape");
  await expect(tip).toBeHidden();
  await page.getByTestId("report-definitions").locator("summary").click();
  for (const name of ["Billed amount (GMV)", "Delivery success rate", "On-time start rate", "Average time to fill"]) await expect(page.getByTestId("report-definitions")).toContainText(name);
  await expect(page.getByTestId("report-definitions")).toContainText("City is the delivery city of the request");
});

test("filters live in the URL: period, comparison, grouping, multi-selects, chips, reset, reload", async ({ page }) => {
  await admin(page);
  await gotoReady(page, "/admin/reports");
  await expect(group(page, "Period").getByRole("button", { name: "30 days" })).toHaveAttribute("aria-pressed", "true"); // the default
  await group(page, "Period").getByRole("button", { name: "7 days" }).click();
  await expect(page).toHaveURL(/preset=7d/);
  await expect(page.getByTestId("report-summary")).toContainText("Days: 7");
  await page.getByLabel("Compare with").selectOption("none");
  await expect(page).toHaveURL(/compare=none/);
  await expect(page.getByTestId("report-summary")).toContainText("No comparison");
  await page.getByLabel("Compare with").selectOption("yoy");
  await expect(page).toHaveURL(/compare=yoy/);
  await page.getByLabel("Compare with").selectOption("prev");
  await expect(page).not.toHaveURL(/compare=/); // the default is not written
  await page.getByLabel("Group by").selectOption("week");
  await expect(page).toHaveURL(/bucket=week/);
  await expect(page.getByTestId("report-summary")).toContainText("Grouped by: Week");
  // several values of one filter, set in one URL update
  await page.getByTestId("report-filter-city").click();
  const city = page.getByRole("dialog", { name: "City" });
  await city.getByRole("checkbox", { name: /Riyadh/ }).check();
  await city.getByRole("checkbox", { name: /Jeddah/ }).check();
  await expect(page).toHaveURL(/city=riyadh(%2C|,)jeddah/);
  await page.keyboard.press("Escape");
  await expect(city).toBeHidden();
  await expect(page.getByTestId("report-chips")).toContainText("City: Riyadh");
  await expect(page.getByTestId("report-chips")).toContainText("City: Jeddah");
  await page.getByRole("button", { name: "Remove Jeddah" }).click();
  await expect(page).toHaveURL(/city=riyadh(&|$)/);
  // an account filter is searched on the server and shows the name, not the id
  await page.getByTestId("report-filter-company").click();
  const co = page.getByRole("dialog", { name: "Company" });
  await co.getByPlaceholder("Search…").fill("Nakheel");
  await co.getByRole("checkbox", { name: /Nakheel Fresh Foods/ }).check();
  await expect(page).toHaveURL(/company=[0-9a-f-]{36}/);
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("report-chips")).toContainText("Company: Nakheel Fresh Foods");
  // a shared link restores everything, with the names resolved from the ids
  const shared = page.url();
  await gotoReady(page, shared);
  await expect(group(page, "Period").getByRole("button", { name: "7 days" })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByTestId("report-chips")).toContainText("Company: Nakheel Fresh Foods");
  await expect(page.getByTestId("report-chips")).toContainText("City: Riyadh");
  await expect(page.getByTestId("report-filter-city")).toContainText("1");
  await page.getByTestId("report-reset").click();
  await expect(page).toHaveURL(/\/admin\/reports$/);
  await expect(page.getByTestId("report-chips")).toHaveCount(0);
  await expect(group(page, "Period").getByRole("button", { name: "30 days" })).toHaveAttribute("aria-pressed", "true");
});

test("custom range: two dates in the URL, the comparison follows, the browser refuses an impossible range", async ({ page }) => {
  await admin(page);
  await gotoReady(page, "/admin/reports");
  await group(page, "Period").getByRole("button", { name: "Custom" }).click();
  await expect(page.getByTestId("report-from")).toBeVisible();
  await page.getByTestId("report-from").fill("2026-01-01");
  await page.getByTestId("report-to").fill("2026-01-31");
  await expect(page).toHaveURL(/from=2026-01-01/);
  await expect(page).toHaveURL(/to=2026-01-31/);
  await expect(page.getByTestId("report-summary")).toContainText("Days: 31");
  // whole calendar months compare with the month before
  await expect(page.getByTestId("report-summary")).toContainText("Compared with");
  await expect(page.getByTestId("report-summary")).toContainText("1 Dec 2025");
  expect(await page.getByTestId("report-from").getAttribute("max")).toBe("2026-01-31");
  expect(await page.getByTestId("report-to").getAttribute("min")).toBe("2026-01-01");
  await expect(page.getByRole("heading", { level: 1, name: "Overview" })).toBeVisible();
  // a grouping that makes no sense for the period (hours over 90 days) falls back to automatic instead of failing
  await gotoReady(page, "/admin/reports?preset=90d&bucket=hour");
  await expect(page.getByTestId("kpi-grid")).toBeVisible();
  await expect(page.getByLabel("Group by")).toHaveValue("auto");
  await expect(page.getByTestId("report-summary")).toContainText("Grouped by: Day");
  // a hand-typed value the server refuses shows the reason and a way back, not a blank page
  await gotoReady(page, "/admin/reports?city=" + "x".repeat(50));
  await expect(page.locator('[role="alert"]:not(#__next-route-announcer__)')).toBeVisible();
  await expect(page.getByTestId("report-error-detail")).toBeVisible();
  await page.getByTestId("report-reset").click();
  await expect(page.getByTestId("kpi-grid")).toBeVisible();
});

test("every chart has a table view with the same numbers", async ({ page }) => {
  await admin(page);
  await gotoReady(page, "/admin/reports?preset=7d");
  const card = page.getByTestId("chart-requests");
  await expect(card.getByRole("img", { name: /^Requests/ })).toBeVisible();
  await page.getByTestId("chart-requests-toggle").click();
  await expect(card.getByRole("table")).toBeVisible();
  await expect(card.getByRole("columnheader", { name: "Completed" })).toBeVisible();
  await expect(card.getByRole("columnheader", { name: "Previous period total" })).toBeVisible();
  expect(await card.getByRole("row").count()).toBe(1 + 7); // header + one row per day of the period: no holes
  await page.getByTestId("chart-requests-toggle").click();
  await expect(card.getByRole("img", { name: /^Requests/ })).toBeVisible();
  // breakdown rows carry their numbers as text, and the donut offers the table
  await expect(page.getByTestId("bd-city").getByRole("list").first()).toContainText("Riyadh");
  await page.getByTestId("bd-service-toggle").click();
  await expect(page.getByTestId("bd-service").getByRole("table")).toContainText("Delivery driver");
});

test("empty selection: says so, offers the way back, and the page recovers", async ({ page }) => {
  await admin(page);
  await gotoReady(page, "/admin/reports?from=2020-01-01&to=2020-01-10&compare=none");
  await expect(page.getByText("No data for this selection").first()).toBeVisible();
  await expect(page.getByTestId("kpi-grid")).toHaveCount(0);
  await page.getByTestId("report-reset").click();
  await expect(page.getByTestId("kpi-grid")).toBeVisible();
  await expect(page).toHaveURL(/\/admin\/reports$/);
});

test("drill-down table: sort by a header, CSV of the whole filtered set", async ({ page }) => {
  await admin(page);
  await gotoReady(page, `/admin/reports?company=${req.businessId}&compare=none`);
  const t = page.getByTestId("drill-requests");
  await expect(t.getByRole("table")).toBeVisible();
  await expect(t.getByRole("button", { name: /^Created, sorted descending/ })).toBeVisible(); // the default order
  const sorted = page.waitForResponse((r) => r.url().includes("/overview/table/requests") && r.url().includes("sort=ref") && r.url().includes("dir=asc"));
  await t.getByRole("button", { name: "Sort by Request" }).click();
  expect((await sorted).status()).toBe(200);
  await expect(t.getByRole("button", { name: /^Request, sorted ascending/ })).toBeVisible();
  const csv = t.getByTestId("drill-requests-csv");
  const href = (await csv.getAttribute("href"))!;
  expect(href).toContain("/api/v1/admin/analytics/overview/table/requests");
  expect(href).toContain("format=csv"); expect(href).toContain(`company=${req.businessId}`);
  const res = await page.request.get(href);
  expect(res.status()).toBe(200);
  expect(res.headers()["content-type"]).toContain("text/csv");
  const body = await res.text();
  const raw = await (await page.request.get(`${href}&headers=keys`)).text(); // the machine form keeps the column keys
  expect(raw.startsWith("﻿ref,")).toBe(true); expect(body.startsWith("﻿")).toBe(true); expect(body.split("\n")[0]).not.toBe(raw.split("\n")[0]); // the default CSV has readable headers
  expect(body).toContain(req.ref);
  await expect(page.getByTestId("report-csv")).toHaveAttribute("href", /\/api\/v1\/admin\/analytics\/overview\/table\/requests\?.*format=csv/);
});

test("phone width: nothing scrolls sideways, popovers stay on screen, the filter bar is usable", async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();
  await admin(page);
  await gotoReady(page, "/admin/reports");
  await expect(page.getByTestId("kpi-grid")).toBeVisible();
  await expect(page.getByTestId("chart-heatmap")).toBeVisible();
  expect(await noSideways(page)).toBe(true);
  for (const s of SECTIONS) { const box = await page.getByTestId(s).boundingBox(); expect(box!.x + box!.width, s).toBeLessThanOrEqual(391); }
  for (const k of ["channel", "city", "driver"]) {
    await page.getByTestId(`report-filter-${k}`).scrollIntoViewIfNeeded();
    await page.getByTestId(`report-filter-${k}`).click();
    const box = await page.getByRole("dialog").boundingBox();
    expect(box!.x, `${k} popover left`).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width, `${k} popover right`).toBeLessThanOrEqual(391);
    expect(await noSideways(page)).toBe(true);
    await page.keyboard.press("Escape");
  }
  await group(page, "Period").getByRole("button", { name: "Custom" }).click();
  await expect(page.getByTestId("report-from")).toBeVisible();
  expect(await noSideways(page)).toBe(true);
  // the drill-down rows become cards (the header row is hidden on phones)
  await expect(page.getByTestId("drill-requests").getByRole("row").nth(1)).toBeVisible();
  await ctx.close();
});

test("Arabic: right-to-left, translated, nothing scrolls sideways", async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();
  await admin(page); // the sign-in screen is English; switch the language after it
  await ctx.addCookies([{ name: "jr_lang", value: "ar", url: BASE }]);
  await gotoReady(page, "/admin/reports");
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  await expect(page.getByRole("heading", { level: 1, name: "نظرة عامة" })).toBeVisible();
  await expect(page.getByTestId("kpi-requests_created")).toContainText("الطلبات المُنشأة");
  await expect(page.getByTestId("report-summary")).toContainText("عرض");
  await expect(page.getByTestId("chart-requests")).toContainText("الطلبات");
  expect(await noSideways(page)).toBe(true);
  await page.getByTestId("report-filter-channel").click();
  const box = await page.getByRole("dialog").boundingBox();
  expect(box!.x).toBeGreaterThanOrEqual(0); expect(box!.x + box!.width).toBeLessThanOrEqual(391);
  await page.keyboard.press("Escape");
  await group(page, "الفترة").getByRole("button", { name: "7 أيام" }).click();
  await expect(page).toHaveURL(/preset=7d/);
  await ctx.close();
});

/** A signed-in browser page for a new staff member with exactly these permissions (the temporary password is replaced through the API first). */
async function staffPage(browser: Browser, page: Page, permissions: string[], tag: string) {
  const email = `rpt${tag}${Date.now()}@jrlogistics.test`, first = "Temp0rary!Pass1", next = "Brand-New-Pass9x";
  const made = await api(page.request, "POST", "/admin/staff", { name: `Report ${tag}`, email, password: first, permissions });
  expect(made.status, JSON.stringify(made.json)).toBe(201);
  const ctx = await browser.newContext();
  const post = (path: string, data: unknown) => ctx.request.fetch(`${BASE}/api/v1${path}`, { method: "POST", data, headers: { origin: BASE, "content-type": "application/json" } });
  expect((await post("/auth/staff/login", { email, password: first })).status()).toBe(200);
  expect((await post("/auth/change-password", { currentPassword: first, newPassword: next })).status()).toBe(200);
  expect((await post("/auth/staff/login", { email, password: next })).status()).toBe(200);
  return ctx.newPage();
}

test("access: no finance means no money anywhere, no reports.view means an error, the API refuses non-staff", async ({ page, browser }) => {
  await admin(page);
  const viewer = await staffPage(browser, page, ["reports.view"], "v");
  await gotoReady(viewer, "/admin/reports");
  await expect(viewer.getByTestId("kpi-requests_created")).toBeVisible();
  await expect(viewer.getByTestId("kpi-gmv")).toHaveCount(0);
  await expect(viewer.getByTestId("kpi-aov")).toHaveCount(0);
  await expect(viewer.getByTestId("chart-money")).toHaveCount(0);
  await expect(viewer.getByTestId("drill-settlements")).toHaveCount(0);
  await expect(viewer.getByText("need finance access")).toBeVisible();
  await expect(viewer.getByTestId("report-csv")).toHaveCount(0); // no reports.export
  await expect(viewer.getByTestId("rk-companies")).toContainText("Ranked by requests created");
  expect((await api(viewer.request, "GET", "/admin/analytics/overview/table/settlements")).status).toBe(403);
  expect((await api(viewer.request, "GET", "/admin/analytics/overview/table/requests?format=csv")).status).toBe(403);
  const blind = await staffPage(browser, page, ["requests.view"], "b");
  await gotoReady(blind, "/admin/reports");
  await expect(blind.getByTestId("no-access")).toBeVisible(); // a calm "no access" page (decision K9), not an error alert
  await expect(blind.getByTestId("kpi-grid")).toHaveCount(0);
  const biz = await businessApi(browser);
  expect((await api(biz.request, "GET", "/admin/analytics/overview")).status).toBe(403);
  expect((await api(biz.request, "GET", "/admin/analytics/options")).status).toBe(403);
});

test("cleanup: the request published for this spec is cancelled", async ({ browser }) => {
  const biz = await businessApi(browser);
  const res = await api(biz.request, "POST", `/requests/${req.id}/cancel`, { reason: "e2e reports overview cleanup" });
  expect(res.status, JSON.stringify(res.json)).toBeLessThan(300);
});
