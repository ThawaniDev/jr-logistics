import { test, expect, type APIRequestContext, type Page } from "@playwright/test";
import { staffLogin, gotoReady, DEMO } from "./helpers";

/**
 * Driver and courier-office detail views (decisions G6–G7): the period-driven KPI strip with definitions, charts, risk flags, every section of both views,
 * the office scorecard, permissions (money = finance, personal data = drivers.sensitive), a phone and Arabic.
 * The spec reads the demo accounts (a direct driver, a driver of the demo office, the demo office) and judges every number against the API it comes from,
 * so it does not depend on how much history the database holds; the only thing it writes is one internal note, which it deletes again.
 */
test.describe.configure({ mode: "serial" });
const BASE = `http://localhost:${process.env.E2E_PORT ?? 3101}`; // not 3100: other projects on this machine use it
const ADMIN = { email: "admin@jrlogistics.test", password: "E2e!Password2026" };
const ids = { driver: "", direct: "", office: "" };

async function api(ctx: APIRequestContext, method: "GET" | "POST" | "DELETE", path: string, data?: unknown) {
  const res = await ctx.fetch(`${BASE}/api/v1${path}`, { method, data, headers: { origin: BASE, "content-type": "application/json" } });
  const text = await res.text();
  let json: any = null; try { json = JSON.parse(text); } catch { /* csv */ }
  return { status: res.status(), json, text, headers: res.headers() };
}
const admin = (page: Page) => staffLogin(page, ADMIN.email, ADMIN.password);
const driverTabs = (page: Page) => page.getByRole("navigation", { name: "Driver sections" });
const officeTabs = (page: Page) => page.getByRole("navigation", { name: "Office sections" });
const noSideways = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
const DRIVER_KPIS = ["drv_jobs", "drv_parcels", "drv_success", "drv_first_attempt", "drv_on_time", "drv_acceptance", "drv_cancels", "drv_rating", "drv_response", "drv_online", "drv_utilisation", "drv_earnings", "drv_earnings_life", "drv_cash_held"];
const OFFICE_KPIS = ["ofc_drivers", "ofc_active_drivers", "ofc_new_drivers", "ofc_jobs", "ofc_parcels", "ofc_success", "ofc_on_time", "ofc_rating", "ofc_utilisation", "ofc_earnings", "ofc_paid", "ofc_pending", "ofc_agreement_age", "ofc_turnover"];

test("the demo accounts to look at: a driver of the demo office, a direct driver and the office", async ({ page }) => {
  await admin(page);
  const tariq = (await api(page.request, "GET", "/admin/drivers-list?q=Tariq")).json.items[0];
  const nasser = (await api(page.request, "GET", "/admin/drivers-list?q=Nasser")).json.items[0];
  const office = (await api(page.request, "GET", "/admin/offices?q=Al%20Wajiha")).json.items[0];
  expect(tariq && nasser && office).toBeTruthy();
  Object.assign(ids, { driver: tariq.id, direct: nasser.id, office: office.id });
  expect(tariq.officeId).toBe(office.id);
});

test("insights API: the 14 driver KPIs with definitions' keys, a zero-filled series, comparison only for periods that have one", async ({ page }) => {
  await admin(page);
  for (const [period, days, bucket, prev] of [["30d", 30, "day", true], ["90d", 90, "week", true], ["12m", null, "week", true], ["all", null, null, false]] as const) {
    const r = await api(page.request, "GET", `/admin/drivers/${ids.driver}/insights?period=${period}`);
    expect(r.status, r.text).toBe(200);
    expect(r.json.kpis.map((k: any) => k.key)).toEqual(DRIVER_KPIS);
    if (days) expect(r.json.period.days).toBe(days);
    if (bucket) expect(r.json.period.bucket).toBe(bucket);
    expect(!!r.json.period.prevFrom).toBe(prev); expect(r.json.series.length).toBeGreaterThan(0); expect(r.json.heatmap).toHaveLength(7);
    for (const k of r.json.kpis) { expect(k.label).toMatch(/^dv2\.kpi_/); expect(k.definition).toMatch(/^dv2\.def_/); if (k.unit === "percent" && k.value != null) { expect(k.value).toBeGreaterThanOrEqual(0); expect(k.value).toBeLessThanOrEqual(1); } }
  }
  expect((await api(page.request, "GET", `/admin/drivers/${ids.driver}/insights?period=bogus`)).status).toBe(422);
});

test("driver overview: header with vehicle, risk flags and actions; KPI strip with definitions; the period selector re-reads the numbers; charts", async ({ page }) => {
  await admin(page);
  await gotoReady(page, `/admin/drivers/${ids.driver}`);
  await expect(page.getByRole("heading", { level: 1, name: "Tariq Mahmood" })).toBeVisible();
  await expect(page.getByTestId("dv2-driver-sub")).toBeVisible();
  await expect(page.getByTestId("dv2-risk-row")).toBeVisible();
  await expect(page.getByRole("link", { name: "Al Wajiha Courier Office" }).first()).toHaveAttribute("href", `/admin/offices/${ids.office}`);
  for (const a of ["acr-edit-driver"]) await expect(page.getByTestId(a)).toBeVisible();
  const tabs = ["Overview", "Jobs", "Parcels", "Location", "Wallet & cash", "Documents", "Security", "Reviews & support", "Activity", "Notes", "Raw data"];
  for (const name of tabs) await expect(driverTabs(page).getByRole("link", { name }), name).toBeVisible();
  await expect(driverTabs(page).getByRole("link", { name: "Overview" })).toHaveAttribute("aria-current", "page");
  // the KPI strip: one card per KPI, each with its definition
  await expect(page.getByTestId("dv2-kpis").locator('[data-testid^="kpi-drv_"]')).toHaveCount(DRIVER_KPIS.length);
  const base = (await api(page.request, "GET", `/admin/drivers/${ids.driver}/insights?period=30d`)).json;
  await expect(page.getByTestId("kpi-drv_jobs")).toHaveAttribute("data-value", String(base.kpis[0].value));
  await page.getByRole("button", { name: /What does .*Delivery success rate.* mean/ }).click();
  await expect(page.getByRole("tooltip")).toContainText(/parcels/i);
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("dv2-period-note")).toContainText("30 days");
  const all = (await api(page.request, "GET", `/admin/drivers/${ids.driver}/insights?period=all`)).json;
  await page.getByRole("group", { name: "Period" }).getByRole("button", { name: "All time" }).click();
  await expect(page).toHaveURL(/[?&]period=all/);
  await expect(page.getByTestId("kpi-drv_jobs")).toHaveAttribute("data-value", String(all.kpis[0].value));
  await expect(page.getByTestId("dv2-period-note")).toContainText("no comparison");
  await gotoReady(page, `/admin/drivers/${ids.driver}?period=90d`); // a link keeps the period
  await expect(page.getByRole("group", { name: "Period" }).getByRole("button", { name: "90 days" })).toHaveAttribute("aria-pressed", "true");
  for (const c of ["deliveries", "success", "jobs", "ratings", "response", "heatmap", "failures", "cities", "companies"]) await expect(page.getByTestId(`dv2-drv-${c}`), c).toBeVisible();
  await expect(page.locator("#rdq-driver-strikes")).toContainText("Strikes & suspension");
});

test("driver jobs: groups with counts that match the API, search, expandable timeline; parcels: filters, counts and the CSV link", async ({ page }) => {
  await admin(page);
  const jobs = (await api(page.request, "GET", `/admin/drivers/${ids.driver}/offers`)).json;
  await gotoReady(page, `/admin/drivers/${ids.driver}/jobs`);
  await expect(page.getByRole("group", { name: "Jobs", exact: true })).toBeVisible();
  await expect(page.getByRole("group", { name: "Jobs", exact: true }).getByRole("button", { name: /^All/ })).toContainText(String(jobs.counts.all));
  if (jobs.total > 0) {
    await page.locator('[data-testid^="rdq-driver-job-toggle-"]').first().click();
    await expect(page.getByTestId("dv2-timeline").first()).toBeVisible();
    await expect(page.getByTestId("dv2-timeline").first()).toContainText("Offered");
  } else await expect(page.getByText("No jobs yet")).toBeVisible();
  await page.getByRole("textbox", { name: "Search order or company" }).fill("zzz-no-such-order");
  await expect(page.getByText("No results found")).toBeVisible();
  await page.getByRole("button", { name: "Clear filters" }).click();
  await page.getByRole("group", { name: "Period" }).getByRole("button", { name: "30 days" }).click();
  await expect(page).toHaveURL(/[?&]period=30d/);

  const parcels = (await api(page.request, "GET", `/admin/drivers/${ids.driver}/parcels`)).json;
  await gotoReady(page, `/admin/drivers/${ids.driver}/parcels`);
  await expect(page.getByTestId("dv2-parcels")).toBeVisible();
  await expect(page.getByRole("group", { name: "Parcels", exact: true }).getByRole("button", { name: /^All/ })).toContainText(String(parcels.counts.all));
  await expect(page.getByTestId("dv2-parcels-csv")).toHaveAttribute("href", /\/api\/v1\/admin\/drivers\/.+\/parcels\?.*format=csv/);
  if (parcels.total > 0) { await page.getByRole("group", { name: "Parcels", exact: true }).getByRole("button", { name: /^Delivered/ }).click(); await expect(page.locator('[data-testid^="dv2-parcel-"]').first()).toBeVisible(); }
  const csv = await api(page.request, "GET", `/admin/drivers/${ids.driver}/parcels?format=csv`);
  expect(csv.status).toBe(200); expect(csv.headers["content-type"]).toContain("text/csv"); expect(csv.text.replace(/^﻿/, "").split("\n")[0]).toContain("code,order_ref");
});

test("location (replay + availability), wallet & cash, documents, security, reviews, activity, notes and raw data", async ({ page }) => {
  await admin(page);
  await gotoReady(page, `/admin/drivers/${ids.driver}/location`);
  await expect(page.getByTestId("dv2-location")).toBeVisible();
  await expect(page.getByText("Path replay")).toBeVisible();
  const loc = (await api(page.request, "GET", `/admin/drivers/${ids.driver}/location`)).json;
  if (loc.days.length) { await page.locator('[data-testid^="dv2-day-"]').first().click(); await expect(page.getByTestId("dv2-path").or(page.getByText("Not enough points to draw a path"))).toBeVisible(); }
  else await expect(page.getByText("No GPS path recorded")).toBeVisible();
  await expect(page.getByText("Availability timeline")).toBeVisible();

  await gotoReady(page, `/admin/drivers/${ids.driver}/wallet`);
  await expect(page.getByText("Earnings pending")).toBeVisible(); await expect(page.getByText("Cash with the driver")).toBeVisible();
  for (const id of ["dv2-settlements", "dv2-ledger", "dv2-withdrawals", "dv2-cod", "dv2-remittances"]) await expect(page.getByTestId(id), id).toBeVisible();
  await expect(page.getByText("This driver works through Al Wajiha Courier Office")).toBeVisible();

  await gotoReady(page, `/admin/drivers/${ids.driver}/documents`);
  await expect(page.getByTestId("dv2-doc-history")).toBeVisible(); await expect(page.getByText("Submission history")).toBeVisible();
  await gotoReady(page, `/admin/drivers/${ids.driver}/security`);
  await expect(page.getByTestId("dv2-security")).toBeVisible(); await expect(page.getByText("Sign-in attempts")).toBeVisible();
  await gotoReady(page, `/admin/drivers/${ids.driver}/reviews`);
  await expect(page.getByTestId("dv2-reviews")).toBeVisible(); await expect(page.getByText("Ratings received").first()).toBeVisible(); await expect(page.getByText("Support cases").first()).toBeVisible();
  await gotoReady(page, `/admin/drivers/${ids.driver}/activity`);
  await expect(page.getByTestId("dtk-log")).toBeVisible();

  await gotoReady(page, `/admin/drivers/${ids.driver}/notes`);
  const before = await page.getByTestId("dtk-note").count();
  await page.getByTestId("dtk-note-body").fill("E2E: driver detail note");
  await page.getByTestId("dtk-note-add").click();
  await expect(page.getByTestId("dtk-note")).toHaveCount(before + 1);
  const notes = (await api(page.request, "GET", `/admin/notes/user/${ids.driver}`)).json.items as Array<{ id: string; body: string }>;
  for (const n of notes.filter((x) => x.body === "E2E: driver detail note")) expect((await api(page.request, "DELETE", `/admin/notes/${n.id}`)).status).toBe(200);

  await gotoReady(page, `/admin/drivers/${ids.driver}/raw`);
  await expect(page.getByTestId("dv2-raw")).toBeVisible();
  const raw = (await api(page.request, "GET", `/admin/drivers/${ids.driver}/raw`)).text;
  expect(raw).not.toContain("passwordHash"); expect(raw).not.toContain("totpSecret");
});

test("permissions: operations staff see the driver but no money, no personal data and no sign-in security", async ({ page }) => {
  await staffLogin(page, "ops@jrlogistics.demo", DEMO.staffPw);
  const p = page.request;
  expect((await api(p, "GET", `/admin/drivers/${ids.driver}/insights`)).json.kpis.map((k: any) => k.key)).toEqual(DRIVER_KPIS.filter((k) => !["drv_earnings", "drv_earnings_life"].includes(k)));
  for (const path of ["money/ledger", "money/settlements", "location", "security"]) expect((await api(p, "GET", `/admin/drivers/${ids.driver}/${path}`)).status, path).toBe(403);
  expect((await api(p, "GET", `/admin/drivers/${ids.driver}/raw`)).json.user.phone).toContain("•");
  await gotoReady(page, `/admin/drivers/${ids.driver}/location`);
  await expect(page.getByText("Restricted: personal data")).toBeVisible();
  await gotoReady(page, `/admin/drivers/${ids.driver}/security`);
  await expect(page.getByText("Restricted: personal data")).toBeVisible();
  await gotoReady(page, `/admin/drivers/${ids.driver}`);
  await expect(page.getByText("Money figures are hidden")).toBeVisible();
  await expect(page.getByTestId("kpi-drv_earnings")).toHaveCount(0);
  // the office view: no money tab, no agreement tab, no payout figures
  await gotoReady(page, `/admin/offices/${ids.office}`);
  await expect(officeTabs(page).getByRole("link", { name: "Money" })).toHaveCount(0);
  await expect(officeTabs(page).getByRole("link", { name: "Agreement" })).toHaveCount(0);
  await expect(page.getByTestId("kpi-ofc_earnings")).toHaveCount(0);
  expect((await api(p, "GET", `/admin/offices/${ids.office}/money`)).status).toBe(403);
});

test("office overview: KPI strip with definitions, charts, readiness kept; period selector; every tab", async ({ page }) => {
  await admin(page);
  await gotoReady(page, `/admin/offices/${ids.office}`);
  await expect(page.getByRole("heading", { level: 1, name: "Al Wajiha Courier Office" })).toBeVisible();
  for (const name of ["Overview", "Drivers", "Jobs", "Money", "Agreement", "Documents", "Security", "Activity", "Notes", "Raw data"]) await expect(officeTabs(page).getByRole("link", { name }), name).toBeVisible();
  await expect(page.getByText("Payouts due")).toBeVisible(); await expect(page.getByText("Wallet balance")).toBeVisible(); await expect(page.getByTestId("rdq-office-checklist")).toBeVisible();
  const perf = page.getByTestId("dv2-office-performance");
  await expect(perf.locator('[data-testid^="kpi-ofc_"]')).toHaveCount(OFFICE_KPIS.length);
  const api30 = (await api(page.request, "GET", `/admin/offices/${ids.office}/insights?period=30d`)).json;
  expect(api30.kpis.map((k: any) => k.key)).toEqual(OFFICE_KPIS);
  await expect(page.getByTestId("kpi-ofc_jobs")).toHaveAttribute("data-value", String(api30.kpis.find((k: any) => k.key === "ofc_jobs").value));
  for (const c of ["deliveries", "success", "jobs", "pareto", "funnel", "failures", "cities", "companies"]) await expect(page.getByTestId(`dv2-ofc-${c}`), c).toBeVisible();
  await perf.getByRole("group", { name: "Period" }).getByRole("button", { name: "12 months" }).click();
  await expect(page).toHaveURL(/[?&]period=12m/);
  await expect(perf.getByTestId("dv2-period-note")).toContainText("compared with");
});

test("office drivers: scorecard that matches the API, sortable, with trend, unlink kept; link history; jobs, money, agreements, documents, security, activity, notes, raw", async ({ page }) => {
  await admin(page);
  const sc = (await api(page.request, "GET", `/admin/offices/${ids.office}/scorecard?pageSize=50`)).json;
  expect(sc.total).toBeGreaterThan(0); expect(sc.sparkWeeks).toHaveLength(8);
  await gotoReady(page, `/admin/offices/${ids.office}/drivers`);
  await expect(page.locator("#dv2-scorecard")).toBeVisible();
  await expect(page.getByTestId(`rdq-office-driver-${ids.driver}`)).toBeVisible();
  await expect(page.getByTestId(`dv2-spark-${ids.driver}`)).toBeVisible();
  await expect(page.getByRole("link", { name: "Tariq Mahmood" }).first()).toHaveAttribute("href", `/admin/drivers/${ids.driver}`);
  await expect(page.getByTestId(`rdq-office-unlink-${ids.driver}`)).toBeVisible();
  await page.getByLabel("Sort by").selectOption("name");
  await page.getByTestId("dv2-sort-dir").click();
  const asc = (await api(page.request, "GET", `/admin/offices/${ids.office}/scorecard?sort=name&dir=asc&pageSize=50`)).json.items.map((i: any) => i.name);
  await expect(page.locator('[data-testid^="rdq-office-driver-"]').first()).toContainText(asc[0]); // the same order the API gives
  await expect(page.getByTestId("dv2-driver-history")).toBeVisible();

  await gotoReady(page, `/admin/offices/${ids.office}/jobs`);
  await expect(page.getByRole("group", { name: "Jobs", exact: true })).toBeVisible();
  await gotoReady(page, `/admin/offices/${ids.office}/money`);
  for (const id of ["dv2-settlements", "dv2-ledger", "dv2-withdrawals"]) await expect(page.getByTestId(id), id).toBeVisible();
  await expect(page.getByTestId("dv2-cod")).toHaveCount(0);
  await gotoReady(page, `/admin/offices/${ids.office}/agreements`);
  await expect(page.getByTestId("rdq-agreement-list")).toBeVisible(); await expect(page.getByText("Agreement age")).toBeVisible();
  await gotoReady(page, `/admin/offices/${ids.office}/documents`);
  await expect(page.getByTestId("dv2-doc-history")).toBeVisible();
  await gotoReady(page, `/admin/offices/${ids.office}/security`);
  await expect(page.getByTestId("dv2-security")).toBeVisible();
  await gotoReady(page, `/admin/offices/${ids.office}/activity`);
  await expect(page.getByTestId("dtk-log")).toBeVisible(); await expect(page.getByTestId("dv2-driver-history")).toBeVisible();
  const evs = (await api(page.request, "GET", `/admin/offices/${ids.office}/driver-events`)).json;
  if (evs.total > 0) await expect(page.getByTestId("dv2-driver-events").locator("li").first()).toBeVisible(); // what the office's drivers did on its jobs
  await gotoReady(page, `/admin/offices/${ids.office}/notes`);
  await expect(page.getByTestId("dtk-notes")).toBeVisible();
  await gotoReady(page, `/admin/offices/${ids.office}/raw`);
  await expect(page.getByTestId("dv2-raw")).toBeVisible();
});

test("unknown ids give the not-found state; a phone shows every page without sideways scrolling; Arabic mirrors the layout and shows no raw keys", async ({ page }) => {
  await admin(page);
  await gotoReady(page, "/admin/drivers/00000000-0000-4000-8000-000000000000");
  await expect(page.getByText("We couldn't find what you were looking for.")).toBeVisible();
  await gotoReady(page, "/admin/offices/00000000-0000-4000-8000-000000000000");
  await expect(page.getByText("We couldn't find what you were looking for.")).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  const paths = ["", "/jobs", "/parcels", "/location", "/wallet", "/documents", "/security", "/reviews", "/activity", "/notes", "/raw"].map((s) => `/admin/drivers/${ids.driver}${s}`)
    .concat(["", "/drivers", "/jobs", "/money", "/agreements", "/documents", "/security", "/activity", "/notes", "/raw"].map((s) => `/admin/offices/${ids.office}${s}`));
  for (const path of paths) {
    await gotoReady(page, path);
    await expect(page.getByRole("heading", { level: 1 }).first()).toBeVisible();
    await page.waitForTimeout(400);
    expect(await noSideways(page), path).toBe(true);
  }
  await page.context().addCookies([{ name: "jr_lang", value: "ar", url: BASE }]);
  for (const path of [`/admin/drivers/${ids.driver}`, `/admin/drivers/${ids.driver}/jobs`, `/admin/drivers/${ids.driver}/location`, `/admin/offices/${ids.office}`, `/admin/offices/${ids.office}/drivers`, `/admin/offices/${ids.office}/money`]) {
    await gotoReady(page, path);
    await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
    await page.waitForTimeout(500);
    const text = await page.locator("main").innerText();
    expect(text, path).not.toMatch(/\bdv2\.[a-z_0-9]+/); expect(text, path).not.toMatch(/\b(rdq|rpf|dtk)\.[a-z_0-9]+/);
    expect(await noSideways(page), path).toBe(true);
  }
});
