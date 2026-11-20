import { readFileSync } from "node:fs";
import { test, expect, type APIRequestContext, type Browser, type Page } from "@playwright/test";
import { staffLogin, otpLogin, gotoReady, DEMO } from "./helpers";

/**
 * Fleet reports — the screens (decisions I7–I9, memory/FLEET_REPORTS.md): the Reports tab of an office and of a driver, the courier-office portal page
 * `/office/reports/performance`, and the "Performance tables" of Reports › Drivers / Courier offices. Covered: the period bar (presets, custom range, comparison, 366-day cap),
 * the KPI strip, the view switch in the URL, every download (the table as .xlsx and CSV, the whole workbook) judged by the file that arrives, the "How to read this" notes,
 * permissions (no money views without finance.view, downloads disabled without reports.export), the portal never sending an entity filter, phone width and Arabic.
 * The spec reads the demo accounts (the demo office and two of its drivers) and judges numbers against the API for the same filters, never against absolute counts, because specs
 * share one database that may or may not hold any work for them. It writes nothing except temporary staff accounts.
 */
test.describe.configure({ mode: "serial" });
const BASE = `http://localhost:${process.env.E2E_PORT ?? 3101}`; // not 3100: other projects on this machine use it
const ADMIN = { email: "admin@jrlogistics.test", password: "E2e!Password2026" };
const ids = { office: "", driver: "", direct: "" };
const XLSX = /spreadsheetml/;

async function api(ctx: APIRequestContext, method: "GET" | "POST", path: string, data?: unknown) {
  const res = await ctx.fetch(`${BASE}/api/v1${path}`, { method, data, headers: { origin: BASE, "content-type": "application/json" } });
  const text = await res.text();
  let json: any = null; try { json = JSON.parse(text); } catch { /* a file */ }
  return { status: res.status(), json, text, headers: res.headers() };
}
const admin = (page: Page) => staffLogin(page, ADMIN.email, ADMIN.password);
const noSideways = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
const officeTabs = (page: Page) => page.getByRole("navigation", { name: "Office sections" });
const driverTabs = (page: Page) => page.getByRole("navigation", { name: "Driver sections" });
const view = (page: Page, v: string) => page.getByTestId(`fr-view-${v}`);
const OFFICE_VIEWS = ["daily", "drivers", "money", "money_daily", "jobs", "earnings", "failures"];
const DRIVER_VIEWS = ["daily", "money", "money_daily", "jobs", "failures"];
const riyadhToday = () => new Date(Date.now() + 3 * 3_600_000).toISOString().slice(0, 10);
const shift = (ymd: string, n: number) => new Date(Date.parse(`${ymd}T00:00:00Z`) + n * 864e5).toISOString().slice(0, 10);

/** Clicks something that produces a file and returns it: the browser's download (name, bytes) and the response of the request that made it. */
async function fileFrom(page: Page, urlPart: RegExp, click: () => Promise<void>) {
  const [dl, res] = await Promise.all([page.waitForEvent("download"), page.waitForResponse((r) => urlPart.test(r.url())), click()]);
  const path = await dl.path();
  return { name: dl.suggestedFilename(), bytes: readFileSync(path!), res, url: res.url(), headers: res.headers() };
}
const isZip = (b: Buffer) => b.length > 500 && b.subarray(0, 2).toString("latin1") === "PK";
async function openMenu(page: Page) {
  await page.getByTestId("fr-download").click();
  await expect(page.getByTestId("fr-download-xlsx")).toBeVisible();
}
/** A signed-in browser page for a new staff member with exactly these permissions (the temporary password is replaced through the API first). */
async function staffPage(browser: Browser, page: Page, permissions: string[], tag: string) {
  const email = `fru${tag}${Date.now()}@jrlogistics.test`, first = "Temp0rary!Pass1", next = "Brand-New-Pass9x";
  const made = await api(page.request, "POST", "/admin/staff", { name: `Fleet ${tag}`, email, password: first, permissions });
  expect(made.status, JSON.stringify(made.json)).toBe(201);
  const ctx = await browser.newContext();
  await ctx.addCookies([{ name: "jr_lang", value: "en", url: BASE }]); // a new staff member's saved language is not guaranteed to be English
  const post = (path: string, data: unknown) => ctx.request.fetch(`${BASE}/api/v1${path}`, { method: "POST", data, headers: { origin: BASE, "content-type": "application/json" } });
  expect((await post("/auth/staff/login", { email, password: first })).status()).toBe(200);
  expect((await post("/auth/change-password", { currentPassword: first, newPassword: next })).status()).toBe(200);
  expect((await post("/auth/staff/login", { email, password: next })).status()).toBe(200);
  return ctx.newPage();
}

test("the demo accounts to look at: the demo office, a driver of it and a direct driver", async ({ page }) => {
  await admin(page);
  const office = (await api(page.request, "GET", "/admin/offices?q=Al%20Wajiha")).json.items[0];
  const tariq = (await api(page.request, "GET", "/admin/drivers-list?q=Tariq")).json.items[0];
  const nasser = (await api(page.request, "GET", "/admin/drivers-list?q=Nasser")).json.items[0];
  expect(office && tariq && nasser).toBeTruthy();
  Object.assign(ids, { office: office.id, driver: tariq.id, direct: nasser.id });
});

test("office: a Reports tab with the period bar, the KPI strip and seven views", async ({ page }) => {
  await admin(page);
  await gotoReady(page, `/admin/offices/${ids.office}`);
  await officeTabs(page).getByRole("link", { name: "Reports" }).click();
  await expect(page).toHaveURL(new RegExp(`/admin/offices/${ids.office}/reports$`));
  await expect(officeTabs(page).getByRole("link", { name: "Reports" })).toHaveAttribute("aria-current", "page");
  await expect(page.getByRole("heading", { level: 1, name: "Al Wajiha Courier Office" })).toBeVisible(); // the shell stays
  const center = page.getByTestId("fr-center");
  await expect(center).toBeVisible();
  await expect(center).toHaveAttribute("data-kind", "office");
  for (const v of OFFICE_VIEWS) await expect(view(page, v), v).toBeVisible();
  await expect(view(page, "daily")).toHaveAttribute("aria-pressed", "true");
  await expect(center).toHaveAttribute("data-view", "daily");
  // the default period: 30 days, compared with the previous period
  await expect(page.getByTestId("fr-period-30d")).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByTestId("fr-period-summary")).toContainText("Days: 30");
  await expect(page.getByTestId("fr-period-summary")).toContainText("Compared with");
  await expect(page.getByTestId("fr-period-compare")).toBeChecked();
  await expect(page.getByTestId("fr-view-hint")).toContainText("One row per day");
  // a zero-filled row for every day of the period
  await expect(page.getByTestId("fr-table-daily").getByRole("row")).toHaveCount(1 + 30);
  // KPI strip = the offices report narrowed to this office; an office page never shows "active offices"
  const j = (await api(page.request, "GET", `/admin/analytics/offices?office=${ids.office}&preset=30d&compare=prev`)).json;
  if (j.meta.empty) await expect(page.getByTestId("fr-kpis")).toContainText("No data for this selection");
  else {
    await expect(page.getByTestId("kpi-grid")).toBeVisible();
    for (const k of j.kpis as Array<{ key: string; value: number | null }>) {
      if (k.key === "cof_active") { await expect(page.getByTestId(`kpi-${k.key}`)).toHaveCount(0); continue; }
      await expect(page.getByTestId(`kpi-${k.key}`), k.key).toHaveAttribute("data-value", String(k.value ?? ""));
    }
  }
  expect(await noSideways(page)).toBe(true);
});

test("driver: a Reports tab with five views (no Drivers, no Earnings), for a driver of an office and a direct driver", async ({ page }) => {
  await admin(page);
  for (const id of [ids.driver, ids.direct]) {
    await gotoReady(page, `/admin/drivers/${id}`);
    await driverTabs(page).getByRole("link", { name: "Reports" }).click();
    await expect(page).toHaveURL(new RegExp(`/admin/drivers/${id}/reports$`));
    await expect(driverTabs(page).getByRole("link", { name: "Reports" })).toHaveAttribute("aria-current", "page");
    await expect(page.getByTestId("fr-center")).toHaveAttribute("data-kind", "driver");
    for (const v of DRIVER_VIEWS) await expect(view(page, v), v).toBeVisible();
    for (const v of ["drivers", "earnings"]) await expect(view(page, v), v).toHaveCount(0);
    await expect(page.getByTestId("fr-table-daily").getByRole("row")).toHaveCount(1 + 30);
    const j = (await api(page.request, "GET", `/admin/analytics/drivers?driver=${id}&preset=30d&compare=prev`)).json;
    if (j.meta.empty) await expect(page.getByTestId("fr-kpis")).toContainText("No data for this selection");
    else {
      await expect(page.getByTestId("kpi-active_drivers")).toHaveCount(0); // "active drivers" says nothing about one driver
      for (const k of j.kpis as Array<{ key: string; value: number | null }>) if (k.key !== "active_drivers") await expect(page.getByTestId(`kpi-${k.key}`), k.key).toHaveAttribute("data-value", String(k.value ?? ""));
    }
    expect(await noSideways(page)).toBe(true);
  }
});

test("the view switch lives in the URL: each view reads its own table with the office filter, an unknown view falls back to Daily", async ({ page }) => {
  await admin(page);
  const base = `/admin/offices/${ids.office}/reports`;
  await gotoReady(page, base);
  // view → the registered table it reads (drivers and the per-driver money come from the drivers report narrowed to the office)
  const TABLE: Record<string, string> = { drivers: "/analytics/drivers/table/perf", money: "/analytics/drivers/table/money", money_daily: "/analytics/offices/table/money_daily", jobs: "/analytics/offices/table/jobs", earnings: "/analytics/offices/table/earnings", failures: "/analytics/offices/table/failures" };
  for (const [v, path] of Object.entries(TABLE)) {
    const [res] = await Promise.all([
      page.waitForResponse((r) => r.url().includes(path) && !r.url().includes("format=")),
      view(page, v).click(),
    ]);
    expect(res.url(), v).toContain(`office=${ids.office}`);
    expect(res.status(), `${v}: ${res.url()}`).toBe(200);
    await expect(page).toHaveURL(new RegExp(`[?&]view=${v}`));
    await expect(view(page, v)).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByTestId("fr-center")).toHaveAttribute("data-view", v);
    await expect(page.getByTestId(`fr-table-${v}`)).toBeVisible();
    await expect(page.getByTestId("fr-view-hint")).not.toBeEmpty();
  }
  // back to Daily: a clean URL; a deep link opens the view; unknown views fall back
  await view(page, "daily").click();
  await expect(page).not.toHaveURL(/view=/);
  await expect(page.getByTestId("fr-table-daily")).toBeVisible();
  await gotoReady(page, `${base}?view=money_daily`);
  await expect(view(page, "money_daily")).toHaveAttribute("aria-pressed", "true");
  for (const bad of ["bogus", "__proto__"]) {
    await gotoReady(page, `${base}?view=${bad}`);
    await expect(view(page, "daily")).toHaveAttribute("aria-pressed", "true");
  }
  // a driver has no Drivers or Earnings view: the URL of an office view falls back to Daily
  await gotoReady(page, `/admin/drivers/${ids.driver}/reports?view=earnings`);
  await expect(view(page, "daily")).toHaveAttribute("aria-pressed", "true");
  const [res] = await Promise.all([page.waitForResponse((r) => r.url().includes("/analytics/drivers/table/jobs")), view(page, "jobs").click()]);
  expect(res.url()).toContain(`driver=${ids.driver}`); expect(res.status()).toBe(200);
});

test("the period: presets, a custom range, the comparison switch and the 366-day cap, all in the URL and in every request", async ({ page }) => {
  await admin(page);
  const base = `/admin/offices/${ids.office}/reports`;
  await gotoReady(page, base);
  const daily = (q: RegExp) => page.waitForResponse((r) => /\/analytics\/offices\/table\/daily/.test(r.url()) && q.test(r.url()) && !r.url().includes("format="));
  for (const [key, days] of [["7d", 7], ["90d", 90], ["today", 1]] as const) {
    const [res] = await Promise.all([daily(new RegExp(`preset=${key}`)), page.getByTestId(`fr-period-${key}`).click()]);
    expect(res.url()).toContain(`office=${ids.office}`);
    await expect(page).toHaveURL(new RegExp(`[?&]preset=${key}`));
    await expect(page.getByTestId(`fr-period-${key}`)).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByTestId("fr-period-summary")).toContainText(`Days: ${days}`);
    await expect(page.getByTestId("fr-table-daily").getByRole("row")).toHaveCount(1 + Math.min(days, 31)); // a page holds a month
  }
  // month to date
  const today = riyadhToday();
  await page.getByTestId("fr-period-mtd").click();
  await expect(page.getByTestId("fr-period-summary")).toContainText(`Days: ${Number(today.slice(8, 10))}`);
  // custom range: two dates, no more than 366 days apart
  await page.getByTestId("fr-period-custom").click();
  await expect(page.getByTestId("fr-period-from")).toBeVisible();
  const a = shift(today, -9), b = shift(today, -5);
  await page.getByTestId("fr-period-from").fill(a);
  await page.getByTestId("fr-period-to").fill(b);
  await expect(page).toHaveURL(new RegExp(`from=${a}&to=${b}`));
  await expect(page.getByTestId("fr-period-summary")).toContainText("Days: 5");
  await expect(page.getByTestId("fr-table-daily").getByRole("row")).toHaveCount(1 + 5);
  const min = await page.getByTestId("fr-period-from").getAttribute("min");
  expect(min).toBe(shift(b, -365)); // 366 days at most
  // the comparison switch
  await page.getByTestId("fr-period-compare").uncheck();
  await expect(page).toHaveURL(/compare=none/);
  await expect(page.getByTestId("fr-period-summary")).toContainText("No comparison");
  await page.getByTestId("fr-period-compare").check();
  await expect(page).not.toHaveURL(/compare=none/);
  await expect(page.getByTestId("fr-period-summary")).toContainText("Compared with");
  // a period of more than 366 days: the daily views say so instead of failing, the others work
  await gotoReady(page, `${base}?from=${shift(today, -500)}&to=${today}`);
  await expect(page.getByTestId("fr-too-long")).toContainText("366");
  await expect(page.getByTestId("fr-table-daily")).toHaveCount(0);
  await view(page, "jobs").click();
  await expect(page.getByTestId("fr-too-long")).toHaveCount(0);
  await expect(page.getByTestId("fr-table-jobs")).toBeVisible();
});

test("downloads: a table as .xlsx and as CSV for the office and for a driver, with the period, the entity and the language", async ({ page }) => {
  await admin(page);
  await gotoReady(page, `/admin/offices/${ids.office}/reports?preset=7d`);
  await expect(page.getByTestId("fr-download")).toBeEnabled();
  // Excel
  await openMenu(page);
  const x = await fileFrom(page, /format=xlsx/, () => page.getByTestId("fr-download-xlsx").click());
  expect(x.res.status()).toBe(200);
  expect(x.headers["content-type"]).toMatch(XLSX);
  expect(x.url).toContain("/admin/analytics/offices/table/daily"); expect(x.url).toContain("preset=7d"); expect(x.url).toContain(`office=${ids.office}`); expect(x.url).toContain("lang=en");
  expect(x.name).toMatch(/\.xlsx$/); expect(isZip(x.bytes), "an .xlsx is a zip").toBe(true);
  // CSV: raw keys, UTF-8 BOM, the zero-filled days
  await openMenu(page);
  const c = await fileFrom(page, /format=csv/, () => page.getByTestId("fr-download-csv").click());
  expect(c.headers["content-type"]).toContain("text/csv"); expect(c.name).toMatch(/\.csv$/);
  const text = c.bytes.toString("utf8");
  expect(text.startsWith("﻿")).toBe(true);
  expect(text.trim().split(/\r?\n/).length).toBe(1 + 7);
  // another view downloads ITS table
  await view(page, "jobs").click();
  await expect(page.getByTestId("fr-table-jobs")).toBeVisible();
  await openMenu(page);
  const j = await fileFrom(page, /format=xlsx/, () => page.getByTestId("fr-download-xlsx").click());
  expect(j.url).toContain("/admin/analytics/offices/table/jobs"); expect(isZip(j.bytes)).toBe(true);
  await view(page, "drivers").click();
  await openMenu(page);
  const d = await fileFrom(page, /format=xlsx/, () => page.getByTestId("fr-download-xlsx").click());
  expect(d.url).toContain("/admin/analytics/drivers/table/perf"); expect(d.url).toContain(`office=${ids.office}`);
  // a driver
  await gotoReady(page, `/admin/drivers/${ids.driver}/reports?view=money`);
  await expect(page.getByTestId("fr-table-money")).toBeVisible();
  await openMenu(page);
  const m = await fileFrom(page, /format=xlsx/, () => page.getByTestId("fr-download-xlsx").click());
  expect(m.url).toContain("/admin/analytics/drivers/table/money"); expect(m.url).toContain(`driver=${ids.driver}`); expect(isZip(m.bytes)).toBe(true);
  // the menu closes after a click and on Escape
  await expect(page.getByTestId("fr-download-xlsx")).toHaveCount(0);
  await page.getByTestId("fr-download").click();
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("fr-download-xlsx")).toHaveCount(0);
});

test("a refused download says why instead of saving an error page", async ({ page }) => {
  await admin(page);
  await gotoReady(page, `/admin/offices/${ids.office}/reports`);
  await page.route(/format=xlsx/, (route) => route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: { code: "DEPENDENCY_UNAVAILABLE", message: "busy", details: { reason: "timeout" } } }) }));
  await openMenu(page);
  let downloaded = false; page.on("download", () => { downloaded = true; });
  await page.getByTestId("fr-download-xlsx").click();
  await expect(page.locator("[data-sonner-toast]").first()).toBeVisible();
  expect(downloaded).toBe(false);
  await expect(page.getByTestId("fr-download")).toBeEnabled();
});

test("the workbook of a whole office and of a driver", async ({ page }) => {
  await admin(page);
  await gotoReady(page, `/admin/offices/${ids.office}/reports?preset=7d&compare=none`);
  const o = await fileFrom(page, /\/analytics\/workbook\//, () => page.getByTestId("fr-workbook").click());
  expect(o.res.status()).toBe(200); expect(o.headers["content-type"]).toMatch(XLSX);
  expect(o.url).toContain(`/admin/analytics/workbook/office/${ids.office}`); expect(o.url).toContain("preset=7d"); expect(o.url).toContain("compare=none"); expect(o.url).toContain("lang=en");
  expect(o.url, "the entity is in the path, not a filter").not.toContain("office=");
  expect(o.name).toMatch(/\.xlsx$/); expect(isZip(o.bytes)).toBe(true);
  await gotoReady(page, `/admin/drivers/${ids.driver}/reports`);
  const d = await fileFrom(page, /\/analytics\/workbook\//, () => page.getByTestId("fr-workbook").click());
  expect(d.url).toContain(`/admin/analytics/workbook/driver/${ids.driver}`); expect(isZip(d.bytes)).toBe(true);
  await expect(page.getByTestId("fr-workbook")).toBeEnabled(); // ready for the next one
});

test("How to read this: the notes of the table on screen load when the disclosure opens, follow the table and the period, in the viewer's language", async ({ page, browser }) => {
  await admin(page);
  await gotoReady(page, `/admin/offices/${ids.office}/reports`);
  const notes = page.getByTestId("fr-notes");
  await expect(notes).toBeVisible();
  await expect(notes.locator("summary")).toContainText("How to read this");
  await expect(page.getByTestId("fr-notes-list")).toBeHidden();
  const [res] = await Promise.all([page.waitForResponse((r) => /\/analytics\/offices\/notes\?/.test(r.url())), notes.locator("summary").click()]);
  expect(res.status()).toBe(200);
  expect(res.url()).toContain("table=daily"); expect(res.url()).toContain("lang=en"); expect(res.url()).toContain("preset=30d"); expect(res.url()).toContain(`office=${ids.office}`);
  const list = page.getByTestId("fr-notes-list");
  await expect(list).toBeVisible();
  expect(await list.locator("li").count()).toBeGreaterThan(0);
  expect((await res.json()).notes.length).toBe(await list.locator("li").count());
  await expect(list.locator("li").first()).toContainText("Period:");
  // the disclosure stays open: another table → that table's notes (the Drivers view is the drivers report's perf table)
  const [res2] = await Promise.all([page.waitForResponse((r) => /\/analytics\/drivers\/notes\?/.test(r.url())), view(page, "drivers").click()]);
  expect(res2.status()).toBe(200); expect(res2.url()).toContain("table=perf"); expect(res2.url()).toContain(`office=${ids.office}`);
  await expect(page.getByTestId("fr-notes")).toHaveJSProperty("open", true);
  // another period → the notes name it
  const [res3] = await Promise.all([page.waitForResponse((r) => /\/analytics\/drivers\/notes\?/.test(r.url()) && r.url().includes("preset=7d")), page.getByTestId("fr-period-7d").click()]);
  expect(res3.status()).toBe(200);
  await expect(list.locator("li").first()).toContainText("(7 days");
  // Arabic
  const ctx = await browser.newContext(); const ar = await ctx.newPage();
  await admin(ar);
  await ctx.addCookies([{ name: "jr_lang", value: "ar", url: BASE }]);
  await gotoReady(ar, `/admin/offices/${ids.office}/reports`);
  const [res4] = await Promise.all([ar.waitForResponse((r) => /\/analytics\/offices\/notes\?/.test(r.url())), ar.getByTestId("fr-notes").locator("summary").click()]);
  expect(res4.status()).toBe(200); expect(res4.url()).toContain("lang=ar");
  await ctx.close();
});

test("access: without finance.view there are no money views; without reports.export the downloads are disabled with a hint; without reports.view there is no tab", async ({ page, browser }) => {
  await admin(page);
  const viewer = await staffPage(browser, page, ["reports.view", "offices.view", "drivers.view"], "v");
  await gotoReady(viewer, `/admin/offices/${ids.office}/reports?view=money`);
  for (const v of ["daily", "drivers", "jobs", "failures"]) await expect(view(viewer, v), v).toBeVisible();
  for (const v of ["money", "money_daily", "earnings"]) await expect(view(viewer, v), v).toHaveCount(0);
  await expect(view(viewer, "daily")).toHaveAttribute("aria-pressed", "true"); // ?view=money is not available to this viewer
  await expect(viewer.getByTestId("fr-table-daily")).toBeVisible();
  await expect(viewer.getByTestId("fr-download")).toBeDisabled();
  await expect(viewer.getByTestId("fr-download")).toHaveAttribute("aria-label", /export permission/);
  await expect(viewer.getByTestId("fr-workbook")).toBeDisabled();
  await expect(viewer.getByText("need finance access").first()).toBeVisible();
  await gotoReady(viewer, `/admin/drivers/${ids.driver}/reports`);
  for (const v of ["money", "money_daily"]) await expect(view(viewer, v), v).toHaveCount(0);
  await expect(view(viewer, "jobs")).toBeVisible();
  // exports on, money off: the downloads work and are still free of money views
  const exporter = await staffPage(browser, page, ["reports.view", "reports.export", "offices.view"], "x");
  await gotoReady(exporter, `/admin/offices/${ids.office}/reports`);
  await expect(exporter.getByTestId("fr-download")).toBeEnabled();
  await expect(exporter.getByTestId("fr-workbook")).toBeEnabled();
  await expect(view(exporter, "money")).toHaveCount(0);
  // no reports.view: the tab is not offered
  const blind = await staffPage(browser, page, ["offices.view"], "b");
  await gotoReady(blind, `/admin/offices/${ids.office}`);
  await expect(officeTabs(blind).getByRole("link", { name: "Overview" })).toBeVisible();
  await expect(officeTabs(blind).getByRole("link", { name: "Reports" })).toHaveCount(0);
  await gotoReady(blind, `/admin/offices/${ids.office}/reports`);
  await expect(blind.getByText("You do not have access to reports.")).toBeVisible();
  await expect(blind.getByTestId("fr-center")).toHaveCount(0);
});

test("office portal: Performance in the sidebar, the same views for the signed-in office, never an entity filter", async ({ page }) => {
  await otpLogin(page, DEMO.office);
  const urls: string[] = [];
  page.on("request", (r) => { if (r.url().includes("/api/v1/office/analytics/")) urls.push(r.url()); });
  await gotoReady(page, "/office");
  const nav = page.getByRole("navigation", { name: "Main navigation" }).first();
  const link = nav.locator('a[href="/office/reports/performance"]');
  await expect(link).toBeVisible();
  await expect(link).toContainText("Performance");
  await link.click();
  await expect(page).toHaveURL(/\/office\/reports\/performance$/);
  await expect(page.getByRole("heading", { level: 1, name: "Fleet performance" })).toBeVisible();
  await expect(page.getByTestId("fr-center")).toHaveAttribute("data-kind", "portal");
  for (const v of OFFICE_VIEWS) await expect(view(page, v), v).toBeVisible(); // an office always sees its own money
  await expect(page.getByTestId("fr-table-daily").getByRole("row")).toHaveCount(1 + 30);
  const [res] = await Promise.all([page.waitForResponse((r) => r.url().includes("/office/analytics/table/perf")), view(page, "drivers").click()]);
  expect(res.status()).toBe(200);
  await view(page, "money").click(); await expect(page.getByTestId("fr-table-money")).toBeVisible();
  await view(page, "earnings").click(); await expect(page.getByTestId("fr-table-earnings")).toBeVisible();
  // period + downloads
  await page.getByTestId("fr-period-7d").click();
  await expect(page.getByTestId("fr-period-summary")).toContainText("Days: 7");
  await view(page, "daily").click();
  await openMenu(page);
  const x = await fileFrom(page, /format=xlsx/, () => page.getByTestId("fr-download-xlsx").click());
  expect(x.headers["content-type"]).toMatch(XLSX); expect(x.url).toContain("/office/analytics/table/daily"); expect(x.url).toContain("preset=7d"); expect(isZip(x.bytes)).toBe(true);
  const w = await fileFrom(page, /\/office\/analytics\/workbook/, () => page.getByTestId("fr-workbook").click());
  expect(w.res.status()).toBe(200); expect(isZip(w.bytes)).toBe(true);
  await page.getByTestId("fr-notes").locator("summary").click();
  await expect(page.getByTestId("fr-notes-list")).toBeVisible();
  // the owner is the session: no request of the page names an office or a driver
  expect(urls.length).toBeGreaterThan(3);
  for (const u of urls) { expect(u, u).not.toMatch(/[?&](office|driver|company)=/); expect(u, u).toContain("/api/v1/office/analytics/"); }
  // the other portal reports are still there
  for (const href of ["/office/reports", "/office/reports/drivers", "/office/reports/earnings"]) await expect(nav.locator(`a[href="${href}"]`), href).toBeVisible();
});

test("report pages: Performance tables at the bottom of Drivers and Courier offices, narrowed by the page's filters, with downloads", async ({ page }) => {
  await admin(page);
  await gotoReady(page, "/admin/reports/drivers?city=riyadh");
  const empty = await page.getByText("No data for this selection").first().isVisible().catch(() => false);
  if (empty) return;
  const perf = page.getByTestId("fr-perf");
  await perf.scrollIntoViewIfNeeded();
  await expect(perf).toBeVisible();
  await expect(perf.getByRole("heading", { name: "Performance tables" })).toBeVisible();
  for (const v of ["perf", "daily", "money", "jobs", "failures"]) await expect(page.getByTestId(`fr-perf-${v}`), v).toBeVisible();
  await expect(page.getByTestId("fr-perf-earnings")).toHaveCount(0); // drivers have no settlements of their own table
  await expect(page.getByTestId("fr-perf-perf")).toHaveAttribute("aria-pressed", "true");
  const [res] = await Promise.all([page.waitForResponse((r) => r.url().includes("/analytics/drivers/table/daily") && !r.url().includes("format=")), page.getByTestId("fr-perf-daily").click()]);
  expect(res.url()).toContain("city=riyadh"); expect(res.status()).toBe(200);
  await expect(page).toHaveURL(/ptable=daily/);
  await expect(page.getByTestId("fr-perf-table-daily")).toBeVisible();
  await page.getByTestId("fr-download").click();
  await expect(page.getByTestId("fr-download-xlsx")).toHaveAttribute("href", /\/api\/v1\/admin\/analytics\/drivers\/table\/daily\?.*city=riyadh.*format=xlsx&lang=en$/);
  await expect(page.getByTestId("fr-download-csv")).toHaveAttribute("href", /format=csv&lang=en$/);
  const x = await fileFrom(page, /format=xlsx/, () => page.getByTestId("fr-download-xlsx").click());
  expect(x.headers["content-type"]).toMatch(XLSX); expect(isZip(x.bytes)).toBe(true);
  await page.getByTestId("fr-perf-failures").click();
  await expect(page.getByTestId("fr-perf-table-failures")).toBeVisible();
  await page.getByTestId("fr-perf-hint").scrollIntoViewIfNeeded();
  await page.getByTestId("fr-notes").locator("summary").click();
  await expect(page.getByTestId("fr-notes-list")).toBeVisible();
  // the existing sections are still there, and every KPI the report returns is on the page, in groups
  await expect(page.getByTestId("drill-scorecards")).toBeVisible();
  const j = (await api(page.request, "GET", "/admin/analytics/drivers?city=riyadh")).json;
  await expect(page.getByTestId("kpi-grid")).toBeVisible(); // one grid, however many groups
  await expect(page.getByTestId("kpis-fleet")).toBeVisible();
  await expect(page.locator('[data-testid^="kpi-"][data-value]')).toHaveCount(j.kpis.length);
  // courier offices
  await gotoReady(page, "/admin/reports/offices");
  if (await page.getByText("No data for this selection").first().isVisible().catch(() => false)) return;
  await expect(page.getByTestId("fr-perf")).toBeVisible();
  for (const v of ["perf", "daily", "money", "jobs", "earnings", "failures"]) await expect(page.getByTestId(`fr-perf-${v}`), v).toBeVisible();
  const [r2] = await Promise.all([page.waitForResponse((r) => r.url().includes("/analytics/offices/table/earnings") && !r.url().includes("format=")), page.getByTestId("fr-perf-earnings").click()]);
  expect(r2.status()).toBe(200);
  const o = (await api(page.request, "GET", "/admin/analytics/offices")).json;
  await expect(page.locator('[data-testid^="kpi-"][data-value]')).toHaveCount(o.kpis.length);
});

test("report pages: without finance.view the money tables are not offered", async ({ page, browser }) => {
  await admin(page);
  const viewer = await staffPage(browser, page, ["reports.view"], "p");
  await gotoReady(viewer, "/admin/reports/drivers");
  if (await viewer.getByText("No data for this selection").first().isVisible().catch(() => false)) return;
  await expect(viewer.getByTestId("fr-perf")).toBeVisible();
  for (const v of ["perf", "daily", "jobs", "failures"]) await expect(viewer.getByTestId(`fr-perf-${v}`), v).toBeVisible();
  await expect(viewer.getByTestId("fr-perf-money")).toHaveCount(0);
  await gotoReady(viewer, "/admin/reports/drivers?ptable=money"); // not available: falls back to the first table
  await expect(viewer.getByTestId("fr-perf-perf")).toHaveAttribute("aria-pressed", "true");
  await expect(viewer.getByTestId("fr-download")).toBeDisabled();
});

test("phone width: nothing scrolls sideways, the view switch and the download menu stay on screen", async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();
  await admin(page);
  const inside = async (id: string) => { const b = await page.getByTestId(id).boundingBox(); expect(b, id).not.toBeNull(); expect(b!.x, `${id} left`).toBeGreaterThanOrEqual(-1); expect(b!.x + b!.width, `${id} right`).toBeLessThanOrEqual(391); };
  for (const path of [`/admin/offices/${ids.office}/reports`, `/admin/drivers/${ids.driver}/reports`, `/admin/offices/${ids.office}/reports?view=jobs&preset=7d`]) {
    await gotoReady(page, path);
    await expect(page.getByTestId("fr-center")).toBeVisible();
    for (const id of ["fr-period", "fr-view-switch", "fr-views"]) await inside(id);
    await page.getByTestId("fr-download").scrollIntoViewIfNeeded();
    await openMenu(page);
    const menu = await page.getByRole("menu").boundingBox();
    expect(menu!.x).toBeGreaterThanOrEqual(0); expect(menu!.x + menu!.width).toBeLessThanOrEqual(391);
    await page.keyboard.press("Escape");
    await page.getByTestId("fr-period-custom").click();
    await expect(page.getByTestId("fr-period-from")).toBeVisible();
    expect(await noSideways(page), path).toBe(true);
  }
  await page.getByTestId("fr-notes").scrollIntoViewIfNeeded();
  expect(await noSideways(page)).toBe(true);
  await gotoReady(page, "/admin/reports/offices");
  if (!(await page.getByText("No data for this selection").first().isVisible().catch(() => false))) {
    await page.getByTestId("fr-perf").scrollIntoViewIfNeeded();
    await inside("fr-perf"); await inside("fr-perf-switch");
    expect(await noSideways(page), "offices report").toBe(true);
  }
  await ctx.close();
  // the portal
  const octx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const op = await octx.newPage();
  await otpLogin(op, DEMO.office);
  await gotoReady(op, "/office/reports/performance");
  await expect(op.getByTestId("fr-center")).toBeVisible();
  expect(await noSideways(op), "portal").toBe(true);
  await octx.close();
});

test("Arabic: right-to-left, translated views, periods and downloads, nothing scrolls sideways", async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();
  await admin(page);
  await ctx.addCookies([{ name: "jr_lang", value: "ar", url: BASE }]);
  await gotoReady(page, `/admin/offices/${ids.office}/reports`);
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  await expect(view(page, "daily")).toHaveText("يومي");
  await expect(view(page, "drivers")).toHaveText("السائقون");
  await expect(view(page, "jobs")).toHaveText("المهام");
  await expect(page.getByTestId("fr-period-summary")).toContainText("عرض");
  await expect(page.getByTestId("fr-period-compare")).toBeChecked();
  await expect(page.getByTestId("fr-workbook")).toContainText("تنزيل");
  await page.getByTestId("fr-download").scrollIntoViewIfNeeded();
  await page.getByTestId("fr-download").click();
  const menu = await page.getByRole("menu").boundingBox();
  expect(menu!.x).toBeGreaterThanOrEqual(0); expect(menu!.x + menu!.width).toBeLessThanOrEqual(391);
  const x = await fileFrom(page, /format=xlsx/, () => page.getByTestId("fr-download-xlsx").click());
  expect(x.url).toContain("lang=ar"); expect(isZip(x.bytes)).toBe(true);
  expect(await noSideways(page)).toBe(true);
  await gotoReady(page, "/admin/reports/drivers");
  if (!(await page.getByText("لا توجد بيانات").first().isVisible().catch(() => false))) {
    await expect(page.getByTestId("fr-perf")).toBeVisible();
    await expect(page.getByTestId("fr-perf-daily")).toHaveText("يومي");
    expect(await noSideways(page)).toBe(true);
  }
  await ctx.close();
});
