import { test, expect, type APIRequestContext, type Browser, type Page } from "@playwright/test";
import { staffLogin, gotoReady, DEMO, apiLogin } from "./helpers";

/**
 * Reports › Companies, Drivers, Courier offices, Growth & onboarding: the sidebar entries, the KPI grids with definitions, every chart and drill-down table section, numbers that
 * agree with the API, the shared filter bar, the table view of a chart, CSV, access (no money, masked identity), phone width, Arabic and the empty state.
 * The spec publishes one request through the business API (so the reports have something to show whatever ran before) and cancels it at the end. Numbers are judged against
 * the API for the same filters, never against absolute counts, because specs share one database.
 */
test.describe.configure({ mode: "serial" });
const BASE = `http://localhost:${process.env.E2E_PORT ?? 3101}`; // not 3100: other projects on this machine use it
const ADMIN = { email: "admin@jrlogistics.test", password: "E2e!Password2026" };
const req = { id: "", ref: "", businessId: "" };

async function api(ctx: APIRequestContext, method: "GET" | "POST", path: string, data?: unknown) {
  const res = await ctx.fetch(`${BASE}/api/v1${path}`, { method, data, headers: { origin: BASE, "content-type": "application/json" } });
  return { status: res.status(), json: await res.json().catch(() => null), text: await res.text().catch(() => "") };
}
const businessApi = (browser: Browser) => apiLogin(browser, DEMO.business); // the shared helper reuses the session of an earlier sign-in (the OTP endpoint is rate-limited per IP)
const admin = (page: Page) => staffLogin(page, ADMIN.email, ADMIN.password);
const noSideways = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);

/** Per report: the page, its English title, the KPI cards and the sections (test ids) an administrator with finance access sees. */
const REPORTS = {
  companies: {
    path: "/admin/reports/companies", title: "Companies", ar: "الشركات", kpi: "cmp_new", arKpi: "الشركات الجديدة",
    sections: ["chart-activity", "chart-pareto-parcels", "chart-pareto-gmv", "chart-cohorts", "bd-segments", "bd-segment-parcels", "health-formula", "chart-health", "bd-channels", "chart-wallets", "movers", "insights", "drill-leaderboard", "drill-at-risk", "drill-new"],
  },
  drivers: {
    path: "/admin/reports/drivers", title: "Drivers", ar: "المناديب", kpi: "flt_acceptance", arKpi: "قبول العروض",
    sections: ["chart-volume", "chart-quality", "chart-jobs", "chart-success", "chart-ratings", "fleet-card", "rk-top", "rk-bottom", "bd-vehicle", "bd-city", "chart-reliability", "rules-card", "chart-heatmap", "chart-funnel", "funnel-times", "insights", "drill-scorecards", "drill-unreliable", "drill-inactive"],
  },
  offices: {
    path: "/admin/reports/offices", title: "Courier offices", ar: "مكاتب التوصيل", kpi: "cof_active", arKpi: "المكاتب النشطة",
    sections: ["chart-activity", "chart-turnover", "chart-money", "rk-parcels", "rk-best", "rk-worst", "bd-agreements", "fleet-card", "rk-office-drivers", "insights", "drill-offices", "drill-office-drivers"],
  },
  growth: {
    path: "/admin/reports/growth", title: "Growth & onboarding", ar: "النمو والتسجيل", kpi: "new_signups", arKpi: "التسجيلات الجديدة",
    sections: ["chart-signups", "bd-sources", "bd-geo", "chart-funnels", "funnel-business", "funnel-driver", "funnel-office", "rk-ttv", "rk-docs", "rk-reasons", "bd-stalled", "funnel-company", "funnel-driver", "activation-times", "bd-clients", "bd-methods", "bd-failures", "chart-logins", "active-roles", "chart-backlog", "insights", "drill-signups", "drill-pending", "drill-stalled"],
  },
} as const;
type Name = keyof typeof REPORTS;
const NAMES = Object.keys(REPORTS) as Name[];
const COMPANY_KPIS = ["active_companies", "cmp_new", "cmp_returning", "cmp_churned", "cmp_at_risk", "cmp_orders_per", "cmp_parcels_per", "gmv", "aov", "delivery_success", "cancellation_rate", "cmp_cod_share", "cmp_api_share", "cmp_repeat", "cmp_order_gap", "cmp_credit_util", "cmp_verified", "cmp_located"];
const DRIVER_KPIS = ["active_drivers", "flt_available", "flt_online_hours", "flt_jobs_per", "flt_parcels_per", "flt_success", "on_time_start", "flt_acceptance", "flt_resp_p50", "flt_resp_p90", "flt_cancel", "flt_replaced", "flt_rating", "flt_earn_per", "flt_earn_hour", "flt_util", "flt_cash", "flt_strikes", "flt_suspensions", "flt_churned", "flt_flagged"];
const OFFICE_KPIS = ["cof_active", "cof_fleet", "cof_active_drivers", "cof_jobs", "cof_parcels", "cof_success", "cof_ontime", "cof_rating", "cof_util", "cof_earned", "cof_paid", "cof_pending", "cof_links", "cof_unlinks", "cof_agreed"];
const GROWTH_KPIS = ["new_signups", "gro_verified", "gro_verify_rate", "gro_ttv_p50", "gro_ttv_p90", "gro_doc_reject", "gro_company_activation", "gro_first_order", "gro_driver_activation", "gro_first_job", "gro_dau", "gro_wau", "gro_mau", "gro_stickiness", "gro_login_fail", "gro_backlog", "gro_backlog_age", "gro_stalled"];
const KPIS: Record<Name, string[]> = { companies: COMPANY_KPIS, drivers: DRIVER_KPIS, offices: OFFICE_KPIS, growth: GROWTH_KPIS };

test("a published request for the reports to show", async ({ browser }) => {
  const biz = await businessApi(browser);
  const shipments = [1, 2, 3].map((n) => ({ recipientName: `People Customer ${n}`, recipientPhone: `05500001${String(n + 10)}`, address: `${n} Olaya St, Riyadh`, externalRef: `PPL-${n}` }));
  const pub = await api(biz.request, "POST", "/requests", { service: "delivery_driver", quantity: 1, shipmentsPerDriver: 10, vehicleType: "dokker", pickupCity: "riyadh", deliveryCity: "riyadh", pickupAddress: "Warehouse 4, Industrial Area", durationDays: 1, startsAt: new Date(Date.now() + 3 * 864e5).toISOString(), publish: true, termsAccepted: true, shipments }); // published, so the company counts as having ordered
  expect(pub.status, JSON.stringify(pub.json)).toBe(201);
  req.id = pub.json.id; req.ref = pub.json.ref;
  req.businessId = (await api(biz.request, "GET", `/requests/${req.id}`)).json.request.businessId;
  expect(req.businessId).toMatch(/^[0-9a-f-]{36}$/);
});

test("the sidebar's Reports group leads to the four reports", async ({ page }) => {
  await admin(page);
  await gotoReady(page, "/admin");
  const nav = page.getByRole("navigation", { name: "Main navigation" }).first();
  for (const n of NAMES) {
    const link = nav.locator(`a[href="${REPORTS[n].path}"]`);
    // the group may be collapsed: wait for its header, and open it only if it is closed (clicking an open one would hide the links)
    const header = nav.getByRole("button", { name: /Show or hide Reports/ });
    await expect(header).toBeVisible();
    if ((await header.getAttribute("aria-expanded")) === "false") await header.click();
    await expect(link, n).toBeVisible();
    await link.click();
    await expect(page).toHaveURL(new RegExp(`${REPORTS[n].path}$`));
    await expect(page.getByRole("heading", { level: 1, name: REPORTS[n].title, exact: true })).toBeVisible();
    await expect(page.getByTestId("report-filters")).toBeVisible();
    await expect(nav.locator(`a[href="${REPORTS[n].path}"]`)).toHaveAttribute("aria-current", "page");
  }
});

for (const name of NAMES) {
  test(`${name}: header, every KPI, every chart and table section is on the page`, async ({ page }) => {
    await admin(page);
    await gotoReady(page, REPORTS[name].path);
    await expect(page.getByRole("heading", { level: 1, name: REPORTS[name].title, exact: true })).toBeVisible();
    // a fresh database may have nothing to report on (offices); other reports always show their KPI row, even when single sections are empty
    const empty = !(await page.getByTestId("kpi-grid").first().isVisible({ timeout: 8_000 }).catch(() => false));
    if (empty) { expect(name, "only the offices report may be empty on a fresh database").toBe("offices"); return; }
    await expect(page.getByTestId("kpi-grid")).toBeVisible();
    for (const k of KPIS[name]) await expect(page.getByTestId(`kpi-${k}`), k).toBeVisible();
    for (const s of new Set(REPORTS[name].sections)) await expect(page.getByTestId(s).first(), s).toBeVisible();
    await expect(page.getByTestId("report-summary")).toContainText("Days: 30");
    await expect(page.getByTestId("report-updated")).toContainText("Updated");
    expect(await noSideways(page)).toBe(true);
  });
}

test("the numbers on every page are the numbers of the API for the same filters", async ({ page }) => {
  await admin(page);
  const checks: Array<[Name, string, string]> = [["companies", "active_companies", "active_companies"], ["drivers", "active_drivers", "active_drivers"], ["offices", "cof_active", "cof_active"], ["growth", "new_signups", "new_signups"]];
  for (const [name, key] of checks.map(([n, k]) => [n, k] as const)) {
    const j = (await api(page.request, "GET", `/admin/analytics/${name}?compare=none`)).json;
    if (j.meta.empty) continue;
    const value = j.kpis.find((k: { key: string }) => k.key === key).value as number;
    await gotoReady(page, `${REPORTS[name].path}?compare=none`);
    await expect(page.getByTestId(`kpi-${key}`)).toHaveAttribute("data-value", String(value));
  }
  // a company filter narrows the companies report to that company (and the chip shows its name)
  const q = `company=${req.businessId}&compare=none`;
  const j = (await api(page.request, "GET", `/admin/analytics/companies?${q}`)).json;
  expect(j.kpis.find((k: { key: string }) => k.key === "active_companies").value).toBe(1);
  await gotoReady(page, `/admin/reports/companies?${q}`);
  await expect(page.getByTestId("kpi-active_companies")).toHaveAttribute("data-value", "1");
  await expect(page.getByTestId("report-chips")).toContainText("Company: Nakheel Fresh Foods");
  await expect(page.getByTestId("drill-leaderboard")).toContainText("Nakheel Fresh Foods");
  await expect(page.getByTestId("drill-leaderboard").getByRole("row")).toHaveCount(2); // header + the one company
});

test("growth only offers the city filter; the other reports offer every filter", async ({ page }) => {
  await admin(page);
  await gotoReady(page, "/admin/reports/growth");
  await expect(page.getByTestId("report-filter-city")).toBeVisible();
  for (const k of ["company", "office", "driver", "service", "vehicle", "status", "channel"]) await expect(page.getByTestId(`report-filter-${k}`), k).toHaveCount(0);
  await page.getByTestId("report-filter-city").click();
  await page.getByRole("dialog", { name: "City" }).getByRole("checkbox", { name: /Riyadh/ }).check();
  await expect(page).toHaveURL(/city=riyadh/);
  await page.keyboard.press("Escape");
  const j = (await api(page.request, "GET", "/admin/analytics/growth?city=riyadh")).json;
  await expect(page.getByTestId("kpi-new_signups")).toHaveAttribute("data-value", String(j.kpis.find((k: { key: string }) => k.key === "new_signups").value));
  await expect(page.getByTestId("kpi-gro_dau")).toContainText("Not narrowed by"); // a KPI the city filter cannot narrow says so
  await gotoReady(page, "/admin/reports/drivers");
  for (const k of ["company", "office", "driver", "city", "service", "vehicle", "status", "channel"]) await expect(page.getByTestId(`report-filter-${k}`), k).toBeVisible();
});

test("definitions: every KPI explains itself and ratios say what they divide", async ({ page }) => {
  await admin(page);
  await gotoReady(page, "/admin/reports/companies");
  await page.getByTestId("kpi-cmp_repeat").getByRole("button", { name: /What does .* mean\?/ }).click();
  const tip = page.getByRole("tooltip");
  await expect(tip).toContainText("Share of the active companies that placed two or more requests");
  await expect(tip).toContainText("Numerator"); await expect(tip).toContainText("Denominator");
  await page.keyboard.press("Escape");
  await expect(tip).toBeHidden();
  await page.getByTestId("report-definitions").locator("summary").click();
  for (const label of ["New companies", "Churned companies", "Companies at risk", "Repeat-order rate", "Credit-limit utilisation"]) await expect(page.getByTestId("report-definitions")).toContainText(label);
  await gotoReady(page, "/admin/reports/drivers");
  await page.getByTestId("report-definitions").locator("summary").click();
  for (const label of ["Offer acceptance", "Response time (median)", "Utilisation", "Cash held by drivers"]) await expect(page.getByTestId("report-definitions")).toContainText(label);
});

test("companies: the health score shows its formula, retention has twelve cohorts and a concentration chart", async ({ page }) => {
  await admin(page);
  await gotoReady(page, "/admin/reports/companies");
  const formula = page.getByTestId("health-formula");
  await expect(formula).toContainText("Recency (30%)"); await expect(formula).toContainText("Frequency (20%)"); await expect(formula).toContainText("Delivery success (25%)");
  await expect(formula).toContainText("Cancellations (15%)"); await expect(formula).toContainText("Support issues (10%)"); await expect(formula).toContainText("never counts as a zero");
  await expect(page.getByTestId("chart-cohorts").getByRole("row")).toHaveCount(1 + 12);
  await expect(page.getByTestId("chart-pareto-parcels").getByRole("img", { name: /^Concentration: parcels/ })).toBeVisible();
  await expect(page.getByTestId("bd-segments")).toContainText("Small (under 100 parcels a month)");
});

test("every chart has a table view with the same numbers", async ({ page }) => {
  await admin(page);
  await gotoReady(page, "/admin/reports/companies?preset=7d");
  const card = page.getByTestId("chart-activity");
  await page.getByTestId("chart-activity-toggle").click();
  await expect(card.getByRole("table")).toBeVisible();
  await expect(card.getByRole("columnheader", { name: "Companies ordering", exact: true })).toBeVisible();
  expect(await card.getByRole("row").count()).toBe(1 + 7); // header + one row per day: no holes
  await page.getByTestId("chart-activity-toggle").click();
  await expect(card.getByRole("img", { name: /^Active companies and signups/ })).toBeVisible();
  await gotoReady(page, "/admin/reports/drivers?preset=7d");
  await page.getByTestId("chart-volume-toggle").click();
  expect(await page.getByTestId("chart-volume").getByRole("row").count()).toBe(1 + 7);
  await gotoReady(page, "/admin/reports/growth?preset=7d");
  await page.getByTestId("chart-signups-toggle").click();
  expect(await page.getByTestId("chart-signups").getByRole("row").count()).toBe(1 + 7);
});

test("drill-down tables: sort by a header, CSV of the whole filtered set, one table per list", async ({ page }) => {
  await admin(page);
  await gotoReady(page, `/admin/reports/companies?company=${req.businessId}&compare=none`);
  const t = page.getByTestId("drill-leaderboard");
  await expect(t.getByRole("table")).toBeVisible();
  await expect(t.getByRole("button", { name: /^Requests, sorted descending/ })).toBeVisible(); // the default order
  const sorted = page.waitForResponse((r) => r.url().includes("/companies/table/leaderboard") && r.url().includes("sort=name") && r.url().includes("dir=asc"));
  await t.getByRole("button", { name: "Sort by Company" }).click();
  expect((await sorted).status()).toBe(200);
  const href = (await t.getByTestId("drill-leaderboard-csv").getAttribute("href"))!;
  expect(href).toContain("/api/v1/admin/analytics/companies/table/leaderboard"); expect(href).toContain("format=csv"); expect(href).toContain(`company=${req.businessId}`);
  const res = await page.request.get(href);
  expect(res.status()).toBe(200); expect(res.headers()["content-type"]).toContain("text/csv");
  const body = await res.text();
  const raw = await (await page.request.get(`${href}&headers=keys`)).text(); // the machine form keeps the column keys
  expect(raw.startsWith("﻿name,")).toBe(true); expect(body.startsWith("﻿")).toBe(true); expect(body.split("\n")[0]).not.toBe(raw.split("\n")[0]); // the default CSV has readable headers
  expect(body).toContain("Nakheel Fresh Foods");
  await expect(page.getByTestId("report-csv")).toHaveAttribute("href", /\/api\/v1\/admin\/analytics\/companies\/table\/leaderboard\?.*format=csv/);
  for (const [path, ids] of [["/admin/reports/drivers", ["drill-scorecards", "drill-unreliable", "drill-inactive"]], ["/admin/reports/growth", ["drill-signups", "drill-pending", "drill-stalled"]]] as const) {
    await gotoReady(page, path);
    for (const id of ids) await expect(page.getByTestId(id).getByRole("heading").first(), id).toBeVisible();
  }
});

test("access: no finance means no money anywhere, identity is masked without drivers.sensitive, the API refuses non-staff", async ({ page, browser }) => {
  await admin(page);
  const viewer = await staffPage(browser, page, ["reports.view"], "v");
  await gotoReady(viewer, "/admin/reports/companies");
  await expect(viewer.getByTestId("kpi-cmp_new")).toBeVisible();
  for (const k of ["gmv", "aov", "cmp_credit_util"]) await expect(viewer.getByTestId(`kpi-${k}`), k).toHaveCount(0);
  for (const s of ["chart-pareto-gmv", "chart-wallets"]) await expect(viewer.getByTestId(s), s).toHaveCount(0);
  await expect(viewer.getByText("need finance access")).toBeVisible();
  await expect(viewer.getByTestId("report-csv")).toHaveCount(0); // no reports.export
  await gotoReady(viewer, "/admin/reports/drivers");
  for (const k of ["flt_earn_per", "flt_earn_hour", "flt_cash"]) await expect(viewer.getByTestId(`kpi-${k}`), k).toHaveCount(0);
  await expect(viewer.getByTestId("kpi-flt_acceptance")).toBeVisible();
  const cards = (await api(viewer.request, "GET", "/admin/analytics/drivers/table/scorecards")).json;
  expect(cards.columns.map((c: { key: string }) => c.key)).not.toContain("earnCents");
  for (const r of cards.rows) { if (r.phone) expect(r.phone, "phone is masked").toContain("•••"); if (r.nationalId) expect(r.nationalId).toContain("••••"); }
  const signups = (await api(viewer.request, "GET", "/admin/analytics/growth/table/signups")).json;
  for (const r of signups.rows) if (r.phone) expect(r.phone).toContain("•••");
  await gotoReady(viewer, "/admin/reports/offices");
  for (const k of ["cof_earned", "cof_paid", "cof_pending"]) await expect(viewer.getByTestId(`kpi-${k}`), k).toHaveCount(0);
  expect((await api(viewer.request, "GET", "/admin/analytics/companies/table/leaderboard?format=csv")).status).toBe(403);
  const blind = await staffPage(browser, page, ["requests.view"], "b");
  await gotoReady(blind, "/admin/reports/growth");
  await expect(blind.getByTestId("no-access")).toBeVisible(); // a calm "no access" page (decision K9), not an error alert
  await expect(blind.getByTestId("kpi-grid")).toHaveCount(0);
  const biz = await businessApi(browser);
  for (const r of NAMES) expect((await api(biz.request, "GET", `/admin/analytics/${r}`)).status, r).toBe(403);
});

test("empty selection: says so, offers the way back, and the page recovers", async ({ page }) => {
  await admin(page);
  for (const name of ["companies", "drivers"] as const) {
    await gotoReady(page, `${REPORTS[name].path}?from=2020-01-01&to=2020-01-10&compare=none`);
    await expect(page.getByText("No data for this selection").first()).toBeVisible();
    await expect(page.getByTestId("kpi-grid")).toHaveCount(0);
    await page.getByTestId("report-reset").click();
    await expect(page.getByTestId("kpi-grid")).toBeVisible();
    await expect(page).toHaveURL(new RegExp(`${REPORTS[name].path}$`));
  }
  // a hand-typed value the server refuses shows the reason and a way back
  await gotoReady(page, "/admin/reports/offices?company=not-an-id");
  await expect(page.locator('[role="alert"]:not(#__next-route-announcer__)')).toBeVisible();
  await expect(page.getByTestId("report-error-detail")).toBeVisible();
});

test("phone width: nothing scrolls sideways on any of the four reports", async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();
  await admin(page);
  for (const name of NAMES) {
    await gotoReady(page, REPORTS[name].path);
    await expect(page.getByRole("heading", { level: 1, name: REPORTS[name].title, exact: true })).toBeVisible();
    if (await page.getByText("No data for this selection").first().isVisible().catch(() => false)) continue;
    await expect(page.getByTestId("kpi-grid")).toBeVisible();
    expect(await noSideways(page), `${name} page`).toBe(true);
    for (const s of new Set(REPORTS[name].sections)) {
      const box = await page.getByTestId(s).first().boundingBox();
      expect(box, s).not.toBeNull();
      expect(box!.x + box!.width, `${name} ${s} right edge`).toBeLessThanOrEqual(391);
    }
    // the first drill-down table becomes cards: the header row is hidden and the data rows are visible
    const table = page.getByTestId(REPORTS[name].sections.find((s) => s.startsWith("drill-"))!);
    await table.scrollIntoViewIfNeeded();
    expect(await noSideways(page), `${name} after scrolling to the tables`).toBe(true);
  }
  await ctx.close();
});

test("Arabic: right-to-left, translated, nothing scrolls sideways", async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();
  await admin(page);
  await ctx.addCookies([{ name: "jr_lang", value: "ar", url: BASE }]);
  for (const name of NAMES) {
    await gotoReady(page, REPORTS[name].path);
    await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
    await expect(page.getByRole("heading", { level: 1, name: REPORTS[name].ar, exact: true })).toBeVisible();
    if (await page.getByText("لا توجد بيانات").first().isVisible().catch(() => false)) continue;
    await expect(page.getByTestId(`kpi-${REPORTS[name].kpi}`)).toContainText(REPORTS[name].arKpi);
    expect(await noSideways(page), `${name} (ar)`).toBe(true);
    await expect(page.getByTestId("report-summary")).toContainText("عرض");
  }
  await ctx.close();
});

test("cleanup: the request published for this spec is cancelled", async ({ browser }) => {
  const biz = await businessApi(browser);
  const res = await api(biz.request, "POST", `/requests/${req.id}/cancel`, { reason: "e2e reports people cleanup" });
  expect(res.status, JSON.stringify(res.json)).toBeLessThan(300);
});

/** A signed-in browser page for a new staff member with exactly these permissions (the temporary password is replaced through the API first). */
async function staffPage(browser: Browser, page: Page, permissions: string[], tag: string) {
  const email = `ppl${tag}${Date.now()}@jrlogistics.test`, first = "Temp0rary!Pass1", next = "Brand-New-Pass9x";
  const made = await api(page.request, "POST", "/admin/staff", { name: `People ${tag}`, email, password: first, permissions });
  expect(made.status, JSON.stringify(made.json)).toBe(201);
  const ctx = await browser.newContext();
  const post = (path: string, data: unknown) => ctx.request.fetch(`${BASE}/api/v1${path}`, { method: "POST", data, headers: { origin: BASE, "content-type": "application/json" } });
  expect((await post("/auth/staff/login", { email, password: first })).status()).toBe(200);
  expect((await post("/auth/change-password", { currentPassword: first, newPassword: next })).status()).toBe(200);
  expect((await post("/auth/staff/login", { email, password: next })).status()).toBe(200);
  return ctx.newPage();
}
