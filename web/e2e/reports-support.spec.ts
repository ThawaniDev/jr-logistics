import { readFileSync } from "node:fs";
import { test, expect, type APIRequestContext, type Browser, type Page } from "@playwright/test";
import { apiLogin, staffLogin, gotoReady, DEMO } from "./helpers";

/**
 * Reports › Support & quality and Reports › Data explorer: KPIs with their definitions and SLA targets, charts with table views, the backlog alerts, the drill-down
 * tables and their views; the explorer's dataset picker, filters, column chooser, sorting, grouping, saved views and CSV export; phone width, Arabic, permissions.
 * The spec opens one support ticket as the demo business (so the report has something to show whatever ran before) and judges numbers against the API, never against
 * absolute counts, because specs share one database.
 */
test.describe.configure({ mode: "serial" });
const BASE = `http://localhost:${process.env.E2E_PORT ?? 3101}`; // not 3100: other projects on this machine use it
const ADMIN = { email: "admin@jrlogistics.test", password: "E2e!Password2026" };
const SUBJECT = `Report support spec ${Date.now()}`;
const made = { id: "", ref: "" };

async function api(ctx: APIRequestContext, method: "GET" | "POST", path: string, data?: unknown) {
  const res = await ctx.fetch(`${BASE}/api/v1${path}`, { method, data, headers: { origin: BASE, "content-type": "application/json" } });
  return { status: res.status(), json: await res.json().catch(() => null), headers: res.headers() };
}
const admin = (page: Page) => staffLogin(page, ADMIN.email, ADMIN.password);
const noSideways = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
const KPI_KEYS = ["sup_tickets_opened", "sup_tickets_resolved", "sup_backlog", "sup_unassigned", "sup_tickets_per_100", "sup_urgent_share", "sup_reopen_rate", "sup_first_response_p50", "sup_first_response_p90", "sup_resolution_p50", "sup_resolution_p90", "sup_sla_response", "sup_sla_resolution", "sup_breaches", "sup_complaints_filed", "sup_complaints_resolved", "sup_complaints_open", "sup_held_complaints", "sup_held_amount", "sup_rating_avg", "sup_ratings_count", "sup_rating_low_share", "sup_rating_response"];
const SECTIONS = ["rpq-chart-volume", "rpq-chart-flow", "rpq-bd-category", "rpq-bd-priority", "rpq-bd-role", "rpq-chart-aging", "rpq-alerts", "rpq-chart-resolution", "rpq-chart-heatmap", "rpq-workload", "rpq-repeat", "rpq-per-company", "rpq-per-driver", "rpq-bd-complaint-category", "rpq-bd-complaint-outcome", "rpq-chart-stars", "rpq-chart-rating", "rpq-lowest-drivers", "rpq-lowest-companies", "rpq-chart-quality", "rpq-insights", "rpq-tickets", "rpq-complaints", "rpq-ratings"];

test("a support ticket for the report to show", async ({ browser }) => {
  const biz = await apiLogin(browser, DEMO.business);
  const t = await api(biz.request, "POST", "/tickets", { category: "other", subject: SUBJECT, body: "Created by the support report spec." });
  expect(t.status, JSON.stringify(t.json)).toBe(201);
  made.id = t.json.id; made.ref = t.json.ref;
  await biz.close();
});

test("support report: header, every KPI, every chart and table section, the SLA targets", async ({ page }) => {
  await admin(page);
  await gotoReady(page, "/admin/reports/support");
  await expect(page.getByRole("heading", { level: 1, name: "Support & quality", exact: true })).toBeVisible();
  for (const k of KPI_KEYS) await expect(page.getByTestId(`kpi-${k}`), k).toBeVisible();
  for (const g of ["tickets", "speed", "complaints", "ratings"]) await expect(page.getByTestId(`rpq-kpis-${g}`), g).toBeVisible();
  await expect(page.getByTestId("rpq-targets")).toContainText("4 h"); await expect(page.getByTestId("rpq-targets")).toContainText("2 d");
  for (const s of SECTIONS) await expect(page.getByTestId(s), s).toBeVisible();
  await expect(page.getByTestId("report-summary")).toContainText("Compared with");
  await expect(page.getByTestId("report-updated")).toContainText("Updated");
  expect(await noSideways(page)).toBe(true);
});

test("the numbers on the page are the numbers of the API for the same filters, and our ticket is in the open list", async ({ page }) => {
  await admin(page);
  const j = (await api(page.request, "GET", "/admin/analytics/support?compare=none")).json;
  const opened = j.kpis.find((k: { key: string }) => k.key === "sup_tickets_opened").value as number;
  const backlog = j.kpis.find((k: { key: string }) => k.key === "sup_backlog").value as number;
  expect(opened).toBeGreaterThanOrEqual(1); expect(backlog).toBeGreaterThanOrEqual(1);
  await gotoReady(page, "/admin/reports/support?compare=none");
  await expect(page.getByTestId("kpi-sup_tickets_opened")).toHaveAttribute("data-value", String(opened));
  await expect(page.getByTestId("kpi-sup_backlog")).toHaveAttribute("data-value", String(backlog));
  await expect(page.getByTestId("report-summary")).toContainText("No comparison");
  const tickets = page.getByTestId("rpq-tickets-table");
  await expect(tickets).toContainText(made.ref);
  await expect(tickets).toContainText(SUBJECT);
});

test("definitions: a KPI explains itself, the SLA numbers say what they divide and name the targets", async ({ page }) => {
  await admin(page);
  await gotoReady(page, "/admin/reports/support");
  await page.getByTestId("kpi-sup_sla_response").getByRole("button", { name: /What does .* mean\?/ }).click();
  const tip = page.getByRole("tooltip");
  await expect(tip).toContainText("within 4 hours"); await expect(tip).toContainText("Numerator"); await expect(tip).toContainText("Denominator");
  await expect(tip).toBeInViewport();
  await page.keyboard.press("Escape");
  await page.getByTestId("report-definitions").locator("summary").click();
  for (const name of ["Tickets opened", "First-response SLA", "Resolution SLA", "SLA breaches", "Rating response rate"]) await expect(page.getByTestId("report-definitions")).toContainText(name);
});

test("every chart has a table view, and the backlog alert list shows the open ticket with its state", async ({ page }) => {
  await admin(page);
  await gotoReady(page, "/admin/reports/support?preset=7d");
  const card = page.getByTestId("rpq-chart-volume");
  await page.getByTestId("rpq-chart-volume-toggle").click();
  await expect(card.getByRole("table")).toBeVisible();
  await expect(card.getByRole("columnheader", { name: "Previous period total" })).toBeVisible();
  expect(await card.getByRole("row").count()).toBe(1 + 7); // header + one row per day: no holes
  await page.getByTestId("rpq-chart-volume-toggle").click();
  await page.getByTestId("rpq-chart-aging-toggle").click();
  await expect(page.getByTestId("rpq-chart-aging").getByRole("table")).toContainText("0–1 d");
  await expect(page.getByTestId("rpq-chart-aging").getByRole("table")).toContainText("15+ d");
  // the alert list holds the longest-waiting open tickets (up to 8), each with its SLA state
  const alerts = page.getByTestId("rpq-alerts").locator('[data-testid="rpq-alert"]');
  expect(await alerts.count()).toBeGreaterThanOrEqual(1); expect(await alerts.count()).toBeLessThanOrEqual(8);
  await expect(alerts.first()).toHaveAttribute("data-state", /breached|at_risk|pending|ok/);
});

test("ticket views: the segmented control switches the registered table; views that ignore the period say so", async ({ page }) => {
  await admin(page);
  await gotoReady(page, "/admin/reports/support");
  const sec = page.getByTestId("rpq-tickets");
  await expect(sec.getByRole("button", { name: "All in the period" })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByTestId("rpq-tickets-noperiod")).toHaveCount(0);
  const open = page.waitForResponse((r) => r.url().includes("/support/table/tickets-open") && r.status() === 200);
  await sec.getByRole("button", { name: "Open now" }).click();
  await open;
  await expect(page.getByTestId("rpq-tickets-noperiod")).toContainText("the period does not apply");
  await expect(page.getByTestId("rpq-tickets-table").getByRole("table")).toBeVisible();
  await sec.getByRole("button", { name: "Urgent" }).click();
  await expect(page.getByTestId("rpq-tickets-noperiod")).toHaveCount(0);
  await page.getByTestId("rpq-complaints").getByRole("button", { name: "Holding a settlement" }).click();
  await expect(page.getByTestId("rpq-complaints-noperiod")).toBeVisible();
  const csv = page.getByTestId("rpq-tickets-table-csv");
  const href = (await csv.getAttribute("href"))!;
  expect(href).toContain("/api/v1/admin/analytics/support/table/tickets-urgent"); expect(href).toContain("format=csv");
  const res = await page.request.get(href);
  expect(res.status()).toBe(200); expect(res.headers()["content-type"]).toContain("text/csv");
});

test("filters live in the URL and narrow the report; an impossible selection shows the empty state and recovers", async ({ page }) => {
  await admin(page);
  await gotoReady(page, "/admin/reports/support");
  await page.getByRole("group", { name: "Period", exact: true }).getByRole("button", { name: "7 days" }).click();
  await expect(page).toHaveURL(/preset=7d/);
  await expect(page.getByTestId("report-summary")).toContainText("Days: 7");
  await gotoReady(page, "/admin/reports/support?from=2020-01-01&to=2020-01-10&compare=none");
  await expect(page.getByText("No data for this selection").first()).toBeVisible();
  await page.getByTestId("report-reset").click();
  await expect(page.getByTestId("rpq-kpis")).toBeVisible();
  await expect(page).toHaveURL(/\/admin\/reports\/support$/);
});

test("support report at phone width and in Arabic", async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();
  await admin(page);
  await gotoReady(page, "/admin/reports/support");
  await expect(page.getByTestId("rpq-kpis")).toBeVisible();
  expect(await noSideways(page)).toBe(true);
  for (const s of SECTIONS) { const box = await page.getByTestId(s).boundingBox(); expect(box!.x + box!.width, s).toBeLessThanOrEqual(391); }
  await ctx.addCookies([{ name: "jr_lang", value: "ar", url: BASE }]);
  await gotoReady(page, "/admin/reports/support");
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  await expect(page.getByRole("heading", { level: 1, name: "الدعم والجودة" })).toBeVisible();
  await expect(page.getByTestId("kpi-sup_tickets_opened")).toContainText("التذاكر المفتوحة حديثًا");
  await expect(page.getByTestId("rpq-chart-volume")).toContainText("التذاكر حسب النوع");
  expect(await noSideways(page)).toBe(true);
  await ctx.close();
});

async function staffPage(browser: Browser, page: Page, permissions: string[], tag: string) {
  const email = `rpq${tag}${Date.now()}@jrlogistics.test`, first = "Temp0rary!Pass1", next = "Brand-New-Pass9x";
  const created = await api(page.request, "POST", "/admin/staff", { name: `Support ${tag}`, email, password: first, permissions });
  expect(created.status, JSON.stringify(created.json)).toBe(201);
  const ctx = await browser.newContext();
  const post = (path: string, data: unknown) => ctx.request.fetch(`${BASE}/api/v1${path}`, { method: "POST", data, headers: { origin: BASE, "content-type": "application/json" } });
  expect((await post("/auth/staff/login", { email, password: first })).status()).toBe(200);
  expect((await post("/auth/change-password", { currentPassword: first, newPassword: next })).status()).toBe(200);
  expect((await post("/auth/staff/login", { email, password: next })).status()).toBe(200);
  return ctx.newPage();
}
test("access: no finance hides the amount on hold, no reports.export hides the CSV and refuses the explorer", async ({ page, browser }) => {
  await admin(page);
  const viewer = await staffPage(browser, page, ["reports.view"], "v");
  await gotoReady(viewer, "/admin/reports/support");
  await expect(viewer.getByTestId("kpi-sup_tickets_opened")).toBeVisible();
  await expect(viewer.getByTestId("kpi-sup_held_amount")).toHaveCount(0);
  await expect(viewer.getByText("need finance access")).toBeVisible();
  await expect(viewer.getByTestId("report-csv")).toHaveCount(0); await expect(viewer.getByTestId("rpq-tickets-table-csv")).toHaveCount(0);
  expect((await api(viewer.request, "GET", "/admin/analytics/explorer/tickets")).status).toBe(403);
  expect((await api(viewer.request, "GET", "/admin/analytics/support/table/tickets?format=csv")).status).toBe(403);
  await gotoReady(viewer, "/admin/reports/explorer");
  await expect(viewer.getByTestId("no-access")).toBeVisible(); // a calm "no access" page (decision K9), not an error alert
  const exporter = await staffPage(browser, page, ["reports.view", "reports.export"], "e");
  await gotoReady(exporter, "/admin/reports/explorer");
  await expect(exporter.getByTestId("rpq-x-controls")).toBeVisible();
  const cat = (await api(exporter.request, "GET", "/admin/analytics/explorer/datasets")).json;
  expect(cat.datasets.map((d: { key: string }) => d.key)).not.toContain("settlements");
  expect((await api(exporter.request, "GET", "/admin/analytics/explorer/settlements")).status).toBe(403);
});

// ───────── Data explorer ─────────
test("explorer: pick a dataset by area, the table shows our ticket, the count matches the API", async ({ page }) => {
  await admin(page);
  await gotoReady(page, "/admin/reports/explorer");
  await expect(page.getByRole("heading", { level: 1, name: "Data explorer", exact: true })).toBeVisible();
  await expect(page.getByTestId("rpq-x-dataset")).toHaveValue("requests");
  await page.getByRole("group", { name: "Area", exact: true }).getByRole("button", { name: "Support and quality" }).click();
  await expect(page).toHaveURL(/ds=tickets/);
  await expect(page.getByTestId("rpq-x-dataset")).toHaveValue("tickets");
  await expect(page.getByTestId("rpq-x-desc")).toContainText("Support tickets");
  await expect(page.getByTestId("rpq-x-results")).toContainText(SUBJECT);
  const api1 = (await api(page.request, "GET", "/admin/analytics/explorer/tickets?cols=ref&pageSize=1")).json;
  await expect(page.getByTestId("rpq-x-count")).toContainText(String(api1.total).replace(/\B(?=(\d{3})+(?!\d))/g, ","));
  await page.getByTestId("rpq-x-dataset").selectOption("complaints");
  await expect(page).toHaveURL(/ds=complaints/);
  await expect(page).not.toHaveURL(/f\./);
});

test("explorer: search, dataset filters, column chooser, sorting and 'all time' are in the URL and change the result", async ({ page }) => {
  await admin(page);
  await gotoReady(page, "/admin/reports/explorer?ds=tickets");
  await page.getByTestId("rpq-x-search").fill(SUBJECT);
  await expect(page).toHaveURL(/q=Report/);
  await expect(page.getByTestId("rpq-x-row")).toHaveCount(1);
  await page.getByTestId("rpq-x-search").fill("");
  await expect(page).not.toHaveURL(/q=/); // the search is written to the URL after a pause; let that finish so it cannot overwrite the next change
  await page.getByTestId("rpq-x-filters").locator("summary").click();
  await page.getByTestId("rpq-x-f-status-open").click(); // URL-synced: it flips once the URL has changed
  await expect(page.getByTestId("rpq-x-f-status-open")).toBeChecked();
  await expect(page).toHaveURL(/f\.status=open/);
  await expect(page.getByTestId("rpq-x-filters-count")).toHaveText("1");
  await page.getByTestId("rpq-x-f-unassigned").getByRole("button", { name: "Yes" }).click();
  await expect(page).toHaveURL(/f\.unassigned=yes/);
  await expect(page.getByTestId("rpq-x-results")).toContainText(SUBJECT);
  await page.getByTestId("rpq-x-filters-clear").click();
  await expect(page).not.toHaveURL(/f\./);
  // columns: untick one, the header goes; defaults bring it back
  await expect(page.getByRole("columnheader", { name: /Subject/ })).toBeVisible();
  await page.getByTestId("rpq-x-columns").locator("summary").click();
  await page.getByTestId("rpq-x-col-subject").click(); // URL-synced: it flips once the URL has changed
  await expect(page).toHaveURL(/cols=/);
  await expect(page.getByTestId("rpq-x-col-subject")).not.toBeChecked();
  await expect(page.getByRole("columnheader", { name: /Subject/ })).toHaveCount(0);
  await page.getByTestId("rpq-x-cols-default").click();
  await expect(page).not.toHaveURL(/cols=/);
  await expect(page.getByRole("columnheader", { name: /Subject/ })).toBeVisible();
  // sorting by a header toggles the direction in the URL
  const sorted = page.waitForResponse((r) => r.url().includes("/explorer/tickets") && r.url().includes("sort=ref") && r.url().includes("dir=asc"));
  await page.getByRole("button", { name: "Sort by Reference" }).click();
  expect((await sorted).status()).toBe(200);
  await expect(page).toHaveURL(/sort=ref/);
  await page.getByRole("button", { name: /^Reference, sorted ascending/ }).click();
  await expect(page).toHaveURL(/dir=desc/);
  // "all time" ignores the period
  await gotoReady(page, "/admin/reports/explorer?ds=tickets&from=2020-01-01&to=2020-01-10");
  await expect(page.getByTestId("rpq-x-results")).toContainText("No data for this selection");
  await page.getByTestId("rpq-x-all").click(); // URL-synced: it flips once the URL has changed
  await expect(page.getByTestId("rpq-x-all")).toBeChecked();
  await expect(page).toHaveURL(/all=1/);
  await expect(page.getByTestId("rpq-x-results")).toContainText(SUBJECT);
});

test("explorer: group and summarise, with a measure; a filter the dataset ignores is announced", async ({ page }) => {
  await admin(page);
  await gotoReady(page, "/admin/reports/explorer?ds=availability&channel=web");
  await expect(page.getByTestId("rpq-x-results")).toContainText("Not applied to this dataset: Channel");
  await gotoReady(page, "/admin/reports/explorer?ds=tickets");
  await page.getByTestId("rpq-x-group").locator("summary").click();
  await page.getByTestId("rpq-x-group-by").selectOption("status");
  await expect(page).toHaveURL(/group=status/);
  const g = page.getByTestId("rpq-x-group-result");
  await expect(g).toBeVisible();
  await expect(g.getByTestId("rpq-x-group-row").first()).toBeVisible();
  await page.getByTestId("rpq-x-agg-add").click();
  await expect(page).toHaveURL(/agg=sum%3A/);
  await expect(g.getByRole("columnheader", { name: /Sum/ })).toBeVisible();
  await page.getByTestId("rpq-x-group-by").selectOption("createdAt");
  await expect(page.getByTestId("rpq-x-group-bucket")).toBeVisible();
  await page.getByTestId("rpq-x-group-bucket").selectOption("month");
  await expect(page).toHaveURL(/group=createdAt(%7E|~)month/);
  await page.getByTestId("rpq-x-group-by").selectOption("");
  await expect(page.getByTestId("rpq-x-results")).toBeVisible();
});

test("explorer: export downloads the filtered rows as CSV (BOM, chosen columns) and is audited", async ({ page }) => {
  await admin(page);
  await gotoReady(page, `/admin/reports/explorer?ds=tickets&cols=ref,subject,status&q=${encodeURIComponent(SUBJECT)}&all=1`);
  await expect(page.getByTestId("rpq-x-results")).toContainText(SUBJECT);
  const [dl] = await Promise.all([page.waitForEvent("download"), page.getByTestId("rpq-x-export").click()]);
  expect(dl.suggestedFilename()).toBe("tickets.csv");
  const text = readFileSync((await dl.path())!, "utf8");
  expect(text.startsWith("\uFEFFref,subject,status")).toBe(true);
  expect(text).toContain(made.ref); expect(text).toContain(SUBJECT);
  expect(text.trim().split("\n")).toHaveLength(2);
  const audit = (await api(page.request, "GET", "/admin/audit?action=report.export&pageSize=5")).json;
  expect(audit.items.some((a: { entityId: string }) => a.entityId === "explorer/tickets")).toBe(true);
});

test("explorer: saved views are kept in the browser, open exactly the saved query, and can be deleted", async ({ page }) => {
  await admin(page);
  await gotoReady(page, "/admin/reports/explorer?ds=tickets&f.status=open&cols=ref,status&sort=ref&dir=asc");
  await page.evaluate(() => window.localStorage.removeItem("jr.explorer.views.v1"));
  await page.reload(); await page.waitForSelector('html[data-hydrated="true"]');
  await page.getByTestId("rpq-x-views").locator("summary").click();
  await expect(page.getByTestId("rpq-x-views-empty")).toBeVisible();
  await expect(page.getByTestId("rpq-x-view-save")).toBeDisabled();
  await page.getByTestId("rpq-x-view-name").fill("Open tickets by reference");
  await page.getByTestId("rpq-x-view-save").click();
  await expect(page.getByTestId("rpq-x-view")).toHaveCount(1);
  await expect(page.getByTestId("rpq-x-views-count")).toHaveText("1");
  await gotoReady(page, "/admin/reports/explorer");
  await page.getByTestId("rpq-x-views").locator("summary").click();
  await expect(page.getByTestId("rpq-x-view-open")).toHaveText("Open tickets by reference");
  await page.getByTestId("rpq-x-view-open").click();
  await expect(page).toHaveURL(/ds=tickets/); await expect(page).toHaveURL(/f\.status=open/); await expect(page).toHaveURL(/sort=ref/);
  await expect(page.getByTestId("rpq-x-filters-count")).toHaveText("1");
  const views = page.getByTestId("rpq-x-views"); // opening a view may leave the list open: only open it when it is closed
  if (!(await views.evaluate((el) => (el as HTMLDetailsElement).open))) await views.locator("summary").click();
  await page.getByTestId("rpq-x-view-delete").click();
  await expect(page.getByTestId("rpq-x-views-empty")).toBeVisible();
});

test("explorer at phone width and in Arabic", async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();
  await admin(page);
  await gotoReady(page, "/admin/reports/explorer?ds=tickets");
  await expect(page.getByTestId("rpq-x-results")).toContainText(SUBJECT);
  expect(await noSideways(page)).toBe(true);
  for (const s of ["rpq-x-controls", "rpq-x-filters", "rpq-x-columns", "rpq-x-group", "rpq-x-views", "rpq-x-results"]) { const box = await page.getByTestId(s).boundingBox(); expect(box!.x + box!.width, s).toBeLessThanOrEqual(391); }
  await ctx.addCookies([{ name: "jr_lang", value: "ar", url: BASE }]);
  await gotoReady(page, "/admin/reports/explorer?ds=tickets");
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  await expect(page.getByRole("heading", { level: 1, name: "مستكشف البيانات" })).toBeVisible();
  await expect(page.getByTestId("rpq-x-desc")).toContainText("تذاكر الدعم");
  await expect(page.getByTestId("rpq-x-results")).toContainText(SUBJECT);
  expect(await noSideways(page)).toBe(true);
  await ctx.close();
});
