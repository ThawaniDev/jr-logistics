import { test, expect, type APIRequestContext, type Browser, type Page } from "@playwright/test";
import { staffLogin, gotoReady, DEMO } from "./helpers";

/**
 * Admin control center, operations, requests (list + detail), cancellations, reports and the live map (redesign F1–F12).
 * The spec creates its own published request through the business API (so nothing depends on another spec's data), walks it through the
 * admin views and cancels it at the end (which also refunds the business and puts one row on the cancellations page).
 */
test.describe.configure({ mode: "serial" });
const BASE = "http://localhost:3100";
const ADMIN = { email: "admin@jrlogistics.test", password: "E2e!Password2026" };
const req: { id: string; ref: string; businessId: string } = { id: "", ref: "", businessId: "" };

async function api(ctx: APIRequestContext, method: "GET" | "POST", path: string, data?: unknown) {
  const res = await ctx.fetch(`${BASE}/api/v1${path}`, { method, data, headers: { origin: BASE, "content-type": "application/json" } });
  return { status: res.status(), json: await res.json().catch(() => null) };
}
async function businessApi(browser: Browser) {
  const ctx = await browser.newContext();
  const s = await api(ctx.request, "POST", "/auth/otp/send", { phone: DEMO.business });
  const v = await api(ctx.request, "POST", "/auth/otp/verify", { phone: DEMO.business, code: s.json.demoCode });
  expect(v.status).toBe(200);
  return ctx;
}
const admin = (page: Page) => staffLogin(page, ADMIN.email, ADMIN.password);
const group = (page: Page, name: string) => page.getByRole("group", { name, exact: true });

test("a published request for the views below", async ({ browser }) => {
  const biz = await businessApi(browser);
  const shipments = [1, 2, 3].map((n) => ({ recipientName: `Ops View Customer ${n}`, recipientPhone: `05400000${String(n + 10)}`, address: `${n} Olaya St, Riyadh`, externalRef: `OPSV-${n}` }));
  const pub = await api(biz.request, "POST", "/requests", { service: "delivery_driver", quantity: 1, shipmentsPerDriver: 10, vehicleType: "dokker", pickupCity: "riyadh", deliveryCity: "riyadh", pickupAddress: "Warehouse 4, Industrial Area", durationDays: 1, startsAt: new Date(Date.now() + 6 * 864e5).toISOString(), publish: true, termsAccepted: true, shipments });
  expect(pub.status, JSON.stringify(pub.json)).toBe(201);
  req.id = pub.json.id; req.ref = pub.json.ref;
  expect(req.ref).toBeTruthy();
  req.businessId = (await api(biz.request, "GET", `/requests/${req.id}`)).json.request.businessId;
  expect(req.businessId).toMatch(/^[0-9a-f-]{36}$/);
});

test("dashboard: KPI groups by theme, every tile and shortcut opens the page that handles it", async ({ page }) => {
  await admin(page);
  await gotoReady(page, "/admin");
  await expect(page.getByRole("heading", { level: 1, name: "Control center" })).toBeVisible();
  for (const id of ["ops", "partners", "money", "support"]) await expect(page.getByTestId(`admin-dash-${id}`)).toBeVisible();
  const tile = (g: string, name: RegExp) => page.getByTestId(`admin-dash-${g}`).getByRole("link", { name });
  await expect(tile("ops", /^Live requests/)).toHaveAttribute("href", "/admin/requests");
  await expect(tile("ops", /^Critical alerts/)).toHaveAttribute("href", "/admin/operations");
  await expect(tile("ops", /^Warehouse sync problems/)).toHaveAttribute("href", "/admin/integrations?problems=1");
  await expect(tile("partners", /^Pending verification/)).toHaveAttribute("href", "/admin/verification");
  await expect(tile("partners", /^Companies/)).toHaveAttribute("href", "/admin/companies");
  await expect(tile("partners", /^Courier offices/)).toHaveAttribute("href", "/admin/offices");
  await expect(tile("money", /^Settlements on hold/)).toHaveAttribute("href", "/admin/finance/settlements");
  await expect(tile("money", /^Withdrawals pending/)).toHaveAttribute("href", "/admin/finance/withdrawals");
  await expect(tile("money", /^Billed to businesses/)).toHaveAttribute("href", "/admin/finance");
  await expect(tile("support", /^Open tickets/)).toHaveAttribute("href", "/admin/cases");
  await expect(tile("support", /^Open complaints/)).toHaveAttribute("href", "/admin/complaints");
  // quick actions are permission-gated shortcuts (the super admin holds every permission)
  for (const [id, href] of [["ops", "/admin/operations"], ["requests", "/admin/requests"], ["verification", "/admin/verification"], ["settlements", "/admin/finance/settlements"], ["withdrawals", "/admin/finance/withdrawals"], ["cod", "/admin/finance/cod"], ["cases", "/admin/cases"], ["reports", "/admin/reports"]] as const) {
    await expect(page.getByTestId(`admin-qa-${id}`), id).toHaveAttribute("href", href);
  }
  // requests by status: the request this spec published is counted, and its status opens the filtered list
  await expect(page.getByTestId("admin-status-breakdown")).toBeVisible();
  await page.getByTestId("admin-status-published").click();
  await expect(page).toHaveURL(/\/admin\/requests\?status=published/);
  await expect(group(page, "Status").getByRole("button", { name: /^Open for drivers/ })).toHaveAttribute("aria-pressed", "true");
  // the broadcast form lives on the dashboard, inside its own section
  await gotoReady(page, "/admin");
  await expect(page.getByTestId("admin-broadcast")).toBeVisible();
  await expect(page.getByTestId("admin-broadcast-send")).toBeDisabled();
  await page.getByTestId("admin-broadcast-message").fill("hi");
  await expect(page.getByTestId("admin-broadcast-send")).toBeDisabled(); // fewer than 3 characters
});

test("dashboard for a support staff member: no money figures, no finance shortcuts, no broadcast", async ({ page }) => {
  await staffLogin(page, "support@jrlogistics.demo", DEMO.staffPw);
  await gotoReady(page, "/admin");
  await expect(page.getByRole("heading", { level: 1, name: "Control center" })).toBeVisible();
  await expect(page.getByText("Billed to businesses")).toHaveCount(0); // finance.view only
  await expect(page.getByTestId("admin-dash-money").getByRole("link")).toHaveCount(0); // tiles show, but link nowhere the viewer cannot go
  await expect(page.getByTestId("admin-dash-support").getByRole("link", { name: /^Open tickets/ })).toHaveAttribute("href", "/admin/cases");
  await expect(page.getByTestId("admin-qa-cases")).toBeVisible();
  for (const id of ["withdrawals", "settlements", "reports", "broadcast"]) await expect(page.getByTestId(`admin-qa-${id}`), id).toHaveCount(0);
  await expect(page.getByTestId("admin-broadcast")).toHaveCount(0);
});

test("requests list: status segments and filters live in the URL, search by ref, the company links to its view", async ({ page }) => {
  await admin(page);
  await gotoReady(page, "/admin/requests?status=published");
  await expect(page.getByRole("heading", { level: 1, name: "Requests" })).toBeVisible();
  const status = group(page, "Status");
  await expect(status.getByRole("button", { name: /^Open for drivers/ })).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("textbox", { name: "Search", exact: true }).fill(req.ref);
  const row = page.locator(`[data-testid="admin-request-row"][data-ref="${req.ref}"]`);
  await expect(row).toBeVisible();
  await expect(row.getByTestId("admin-request-company")).toHaveAttribute("href", /^\/admin\/companies\/[0-9a-f-]{36}$/);
  // a different segment hides it and writes the filter to the URL; "Clear filters" brings everything back
  await status.getByRole("button", { name: /^Completed/ }).click();
  await expect(page).toHaveURL(/status=completed/);
  await expect(row).toHaveCount(0);
  await page.getByTestId("admin-requests-clear").click();
  await expect(page).not.toHaveURL(/status=/);
  await expect(page.getByRole("textbox", { name: "Search", exact: true })).toHaveValue("");
  await expect(page.getByTestId("admin-requests-total")).toBeVisible();
  // a deep link with a date range (the operations tile "Scheduled today" uses it) is applied
  await gotoReady(page, "/admin/requests?from=2020-01-01&to=2020-01-02");
  await expect(page.getByLabel("From", { exact: true })).toHaveValue("2020-01-01");
  await expect(page.getByText("No results found")).toBeVisible();
  // ?go=1&q=<ref> jumps straight into the request
  await gotoReady(page, `/admin/requests?go=1&q=${req.ref}`);
  await expect(page).toHaveURL(new RegExp(`/admin/requests/${req.id}`));
});

test("request view: header, sections, parcels, timeline and the admin actions (assign dialog, cancel)", async ({ page }) => {
  await admin(page);
  await gotoReady(page, `/admin/requests/${req.id}`);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(req.ref);
  await expect(page.getByRole("navigation", { name: "Breadcrumb" }).getByRole("link", { name: "Requests" })).toHaveAttribute("href", "/admin/requests");
  for (const name of ["Drivers", "Request details", "Business", "Cost", "Shipments", "Timeline"]) await expect(page.getByRole("heading", { name, exact: true }), name).toBeVisible();
  await expect(page.getByTestId("admin-req-open-company")).toHaveAttribute("href", `/admin/companies/${req.businessId}`);
  await expect(page.getByTestId("admin-req-open-ledger")).toHaveAttribute("href", new RegExp(`^/admin/finance/ledger\\?request=${req.id}`));
  await expect(page.getByTestId("admin-parcel-row")).toHaveCount(3);
  await page.getByRole("textbox", { name: "Search", exact: true }).fill("Customer 2"); // the parcel list has its own filters
  await expect(page.getByTestId("admin-parcel-row")).toHaveCount(1);
  await page.getByRole("textbox", { name: "Search", exact: true }).fill("");
  await expect(page.getByTestId("admin-parcel-row")).toHaveCount(3);
  await expect(page.getByText("Request published")).toBeVisible();
  // assign: the dialog lists candidates and needs a driver AND a reason
  await page.getByTestId("admin-req-assign").click();
  const dlg = page.getByRole("dialog", { name: "Assign driver" });
  await expect(dlg).toBeVisible();
  await expect(dlg.getByTestId("admin-assign-confirm")).toBeDisabled();
  await dlg.getByTestId("admin-assign-reason").fill("E2E: only checking the dialog");
  await expect(dlg.getByTestId("admin-assign-confirm")).toBeDisabled(); // still no driver chosen
  await dlg.getByRole("button", { name: "Cancel" }).click();
  await expect(dlg).toBeHidden();
  await expect(page.getByTestId("admin-req-rematch")).toBeVisible();
  // cancel the request: a reason is required; afterwards the cancel action is gone and the status says so
  await page.getByTestId("admin-req-cancel").click();
  const cancel = page.getByRole("dialog", { name: "Cancel request" });
  await expect(cancel.getByTestId("admin-cancel-confirm")).toBeDisabled();
  await cancel.getByTestId("admin-cancel-reason").fill("E2E clean-up");
  await cancel.getByTestId("admin-cancel-confirm").click();
  await expect(page.getByTestId("admin-req-cancel")).toHaveCount(0);
  await expect(page.getByTestId("admin-req-assign")).toHaveCount(0);
  await expect(page.getByText("Cancelled", { exact: true }).first()).toBeVisible();
});

test("cancellations: the cancelled request shows up, and the party filter narrows the list", async ({ page }) => {
  await admin(page);
  await gotoReady(page, "/admin/cancellations");
  await expect(page.getByRole("heading", { level: 1, name: "Cancellations" })).toBeVisible();
  // the request itself is one row (business, "Request cancelled"); offers that were still open are withdrawn with it and show as follow-on rows of the business
  const theRequest = page.locator(`[data-testid="admin-cx-row"][data-kind="request_cancelled"]`).filter({ hasText: req.ref });
  await expect(theRequest).toHaveCount(1);
  await group(page, "Party").getByRole("button", { name: /^Business/ }).click();
  await expect(page).toHaveURL(/party=business/);
  await expect(theRequest).toHaveCount(1);
  await group(page, "Party").getByRole("button", { name: /^Driver/ }).click();
  await expect(theRequest).toHaveCount(0);
  // the period presets write a date range into the URL, "Clear filters" removes it
  await group(page, "Period").getByRole("button", { name: "Last 7 days" }).click();
  await expect(page).toHaveURL(/from=\d{4}-\d{2}-\d{2}&to=\d{4}-\d{2}-\d{2}|to=\d{4}-\d{2}-\d{2}&from=/);
  await page.getByTestId("admin-cx-clear").click();
  await expect(page).not.toHaveURL(/from=|party=/);
});

test("operations: today's KPIs, the alert queue and the cities table; the page refreshes on demand", async ({ page }) => {
  await admin(page);
  await gotoReady(page, "/admin/operations");
  await expect(page.getByRole("heading", { level: 1, name: "Operations" })).toBeVisible();
  await expect(page.getByRole("link", { name: /^Today's jobs/ })).toHaveAttribute("href", /^\/admin\/requests\?from=\d{4}-\d{2}-\d{2}&to=\d{4}-\d{2}-\d{2}$/);
  await expect(page.getByRole("heading", { name: "Alerts", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Cities today" })).toBeVisible();
  await page.getByTestId("admin-ops-refresh").click();
  await expect(page.getByTestId("admin-ops-updated")).toContainText("Updated");
});

test("reports: report types and periods are filters in the URL, the CSV export follows them", async ({ page }) => {
  await admin(page);
  await gotoReady(page, "/admin/reports");
  await expect(page.getByRole("heading", { level: 1, name: "Reports", exact: true })).toBeVisible();
  const type = group(page, "Report");
  await expect(type.getByRole("button", { name: "Requests", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByTestId("admin-reports-export")).toHaveAttribute("href", /\/api\/v1\/admin\/reports\/requests\?format=csv/);
  await type.getByRole("button", { name: "Start-time SLA" }).click();
  await expect(page).toHaveURL(/type=sla/);
  await expect(type.getByRole("button", { name: "Start-time SLA" })).toHaveAttribute("aria-pressed", "true");
  await group(page, "Period").getByRole("button", { name: "Last 30 days" }).click();
  await expect(page.getByTestId("admin-reports-export")).toHaveAttribute("href", /\/admin\/reports\/sla\?format=csv&from=/);
  await page.getByTestId("admin-reports-clear").click();
  await expect(page.getByTestId("admin-reports-export")).not.toHaveAttribute("href", /from=/);
  // a report type the viewer may not see falls back to the first allowed one (support staff have no reports at all, so use finance for the positive case)
  await gotoReady(page, "/admin/reports?type=nonsense");
  await expect(type.getByRole("button", { name: "Requests", exact: true })).toHaveAttribute("aria-pressed", "true");
});

test("live map: KPIs, filters and the plot render (the demo database may have no live drivers)", async ({ page }) => {
  await admin(page);
  await gotoReady(page, "/admin/map");
  await expect(page.getByRole("heading", { level: 1, name: "Live map" })).toBeVisible();
  await expect(page.getByText("Location views are logged.")).toBeVisible();
  await expect(page.getByTestId("admin-map-canvas")).toBeVisible();
  const status = group(page, "Status");
  await status.getByRole("button", { name: /^On a job/ }).click();
  await expect(page).toHaveURL(/status=on_job/);
  await expect(status.getByRole("button", { name: /^On a job/ })).toHaveAttribute("aria-pressed", "true");
  await page.getByTestId("admin-map-refresh").click();
});

test("Arabic: the control center is right-to-left and translated", async ({ browser }) => {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await admin(page); // sign in in English, then switch the language cookie
  await ctx.addCookies([{ name: "jr_lang", value: "ar", url: BASE }]);
  await gotoReady(page, "/admin");
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  await expect(page.getByText("إجراءات سريعة")).toBeVisible();
  await expect(page.getByTestId("admin-dash-ops")).toBeVisible();
  await ctx.close();
});
