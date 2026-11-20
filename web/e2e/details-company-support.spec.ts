import { test, expect, type APIRequestContext, type BrowserContext, type Page } from "@playwright/test";
import { staffLogin, gotoReady, apiLogin } from "./helpers";

/**
 * Detail views of a company, a user, a support ticket and a complaint (decisions G6–G7), as the admin sees them.
 * The spec creates its own company through the admin API (with a VAT number), signs in as it through the OTP flow, opens a ticket and a complaint, and then walks every
 * section; it knows nothing about other specs' data, so counts are asserted relative to what it created. The company has no orders: this also pins the "sparse data" look
 * (no data is a dash, never 0%).
 */
test.describe.configure({ mode: "serial" });
const BASE = `http://localhost:${process.env.E2E_PORT ?? 3101}`; // not 3100: other projects on this machine use it
const ADMIN = { email: "admin@jrlogistics.test", password: "E2e!Password2026" };
const STAMP = Date.now().toString();
const co = { id: "", name: `Detail Co ${STAMP.slice(-6)}`, phone: `05${STAMP.slice(-8)}`, vat: "310122393500003", cr: "1010123456", ticket: "", ticketRef: "", complaint: "", ctx: null as BrowserContext | null };
let adminId = "";

async function api(ctx: APIRequestContext, method: "GET" | "POST" | "PATCH", path: string, data?: unknown) {
  const res = await ctx.fetch(`${BASE}/api/v1${path}`, { method, data, headers: { origin: BASE, "content-type": "application/json" } });
  return { status: res.status(), json: await res.json().catch(() => null), text: await res.text().catch(() => "") };
}
const admin = (page: Page) => staffLogin(page, ADMIN.email, ADMIN.password);
const noSideways = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
const tabs = (page: Page) => page.getByRole("navigation", { name: co.name });
const group = (page: Page, name: string) => page.getByRole("group", { name, exact: true });
const tile = (page: Page, id: string) => page.getByTestId(`dv3-kpi-${id}-value`);

test("setup: a company with a VAT number is created by staff, signs in, and opens a ticket and a complaint", async ({ page, browser }) => {
  await admin(page);
  adminId = ((await api(page.request, "GET", "/auth/me")).json.user ?? {}).id;
  const made = await api(page.request, "POST", "/admin/accounts", { kind: "business", name: "Detail Owner", phone: co.phone, city: "riyadh", companyName: co.name, crNumber: co.cr, taxNumber: co.vat, industry: "Retail" });
  expect(made.status, made.text).toBe(201);
  co.id = made.json.user.id;
  expect((await api(page.request, "GET", `/admin/accounts/${co.id}`)).json.fields).toMatchObject({ taxNumber: co.vat, crNumber: co.cr });
  co.ctx = await apiLogin(browser, co.phone);
  const t = await api(co.ctx.request, "POST", "/tickets", { category: "payment_issue", subject: `Refund question ${STAMP.slice(-6)}`, body: "Where is my refund for the cancelled order?" });
  expect(t.status, t.text).toBe(201); co.ticket = t.json.id; co.ticketRef = t.json.ref;
  const c = await api(co.ctx.request, "POST", "/complaints", { category: "delay", description: `The driver was two hours late ${STAMP}` });
  expect(c.status, c.text).toBe(201); co.complaint = c.json.id;
});

test("company overview: header with the VAT number, every section as a tab, KPI strip with definitions and a period selector, health, charts, profile", async ({ page }) => {
  await admin(page);
  await gotoReady(page, `/admin/companies/${co.id}`);
  await expect(page.getByRole("heading", { level: 1, name: co.name })).toBeVisible();
  await expect(page.getByTestId("dv3-header-tax")).toHaveText(co.vat);
  for (const t of ["Overview", "Orders", "Parcels", "Finance", "Warehouse", "Integrations", "Documents", "Support", "Security", "Activity", "Notes", "Raw data"]) await expect(tabs(page).getByRole("link", { name: new RegExp(`^${t}`) }), t).toBeVisible();
  await expect(page.getByTestId("companies-act-verify")).toBeVisible(); // the existing actions are all still there
  await expect(page.getByTestId("acr-edit-company")).toBeVisible();

  // KPI strip: no orders yet → counts are 0, ratios and the score are a dash
  await expect(page.getByTestId("dv3-kpis")).toBeVisible();
  await expect(tile(page, "orders")).toHaveText("0");
  await expect(tile(page, "active")).toHaveText("0");
  for (const k of ["success", "cancellation", "on_time", "aov", "health"]) await expect(tile(page, k), k).toHaveText("—");
  await expect(page.getByText("Active orders")).toBeVisible();
  await expect(page.getByText("No requests yet")).toBeVisible();
  await expect(page.getByTestId("dv3-kpi-last_order")).toContainText("No orders yet");
  // definitions are tooltips with numerator and denominator for ratios
  await page.getByRole("button", { name: /What does .Cancellation rate. mean/ }).focus();
  await expect(page.getByRole("tooltip")).toContainText("Share of the orders created in the period that were cancelled");
  await expect(page.getByRole("tooltip")).toContainText("Denominator");
  // health: no score without orders, the formula and the five parts are shown
  await expect(page.getByTestId("dv3-health-score")).toHaveText("—");
  await expect(page.getByTestId("dv3-health")).toContainText("Not enough data");
  for (const p of ["recency", "frequency", "success", "cancellations", "support"]) await expect(page.getByTestId(`dv3-health-part-${p}`), p).toBeVisible();
  await expect(page.getByTestId("dv3-charts")).toBeVisible();
  // period selector lives in the URL; all time has no comparison
  const range = page.getByTestId("dv3-period-range");
  await expect(range).toContainText("Compared with");
  await group(page, "Period").getByRole("button", { name: "90 days" }).click();
  await expect(page).toHaveURL(/[?&]period=90d/);
  await group(page, "Period").getByRole("button", { name: "All time" }).click();
  await expect(page).toHaveURL(/[?&]period=all/);
  await expect(range).toContainText("No comparison for this period");
  await group(page, "Period").getByRole("button", { name: "30 days" }).click();
  await expect(page).not.toHaveURL(/period=/);
  // profile facts include the registration and VAT numbers; the verification history is there for reviewers
  await expect(page.getByTestId("dv3-fact-cr")).toHaveText(co.cr);
  await expect(page.getByTestId("dv3-fact-tax")).toHaveText(co.vat);
  await expect(page.getByTestId("dv3-profile")).toContainText("Created by staff");
  await expect(page.getByTestId("dv3-created-by")).toHaveAttribute("href", `/admin/users/${adminId}`);
  await gotoReady(page, `/admin/companies/${co.id}?period=12m`);
  await expect(group(page, "Period").getByRole("button", { name: "12 months" })).toHaveAttribute("aria-pressed", "true");
});

test("company sections: orders filters, parcels, finance extras, integrations, security, support, activity, notes, raw data", async ({ page }) => {
  await admin(page);
  await gotoReady(page, `/admin/companies/${co.id}/orders`);
  await expect(page.getByTestId("dv3-orders-city")).toBeVisible();
  await page.getByTestId("dv3-orders-from").fill("2026-01-01");
  await expect(page).toHaveURL(/[?&]from=2026-01-01/);
  await expect(page.getByText("No results found")).toBeVisible(); // a filter that matches nothing offers a way out
  await page.getByRole("button", { name: "Clear filters" }).first().click();
  await expect(page.getByText("No requests yet")).toBeVisible();

  await gotoReady(page, `/admin/companies/${co.id}/parcels`);
  await expect(page.getByTestId("dv3-parcels")).toBeVisible();
  await expect(page.getByText("No parcels yet")).toBeVisible();
  await expect(page.getByTestId("dv3-parcels-csv")).toHaveAttribute("href", new RegExp(`/api/v1/admin/companies/${co.id}/parcels.*format=csv`));

  await gotoReady(page, `/admin/companies/${co.id}/finance`);
  await expect(page.getByText("Available balance")).toBeVisible();
  await expect(page.getByTestId("dv3-money")).toBeVisible();
  await page.getByTestId("dv3-credit-open").click();
  await page.getByTestId("dv3-credit-input").fill("500");
  await page.getByTestId("dv3-credit-save").click();
  await expect(page.getByText("Saved").first()).toBeVisible();
  expect((await api(page.request, "GET", `/admin/companies/${co.id}/money`)).json.wallet).toMatchObject({ creditLimitCents: 50_000, creditUse: 0 });
  await expect(page.getByTestId("dv3-credit-use")).toContainText("0%");

  await gotoReady(page, `/admin/companies/${co.id}/integrations`);
  await expect(page.getByTestId("dv3-integrations")).toBeVisible();
  await expect(page.getByText("No warehouse system connected")).toBeVisible();
  await expect(page.getByText("No API keys")).toBeVisible();

  await gotoReady(page, `/admin/companies/${co.id}/security`);
  await expect(page.getByTestId("dv3-company-security")).toBeVisible();
  await expect(page.getByTestId("dv3-login-row").first()).toBeVisible(); // the company's own sign-in from the setup
  await expect(page.getByTestId("dv3-session-row").first()).toBeVisible();

  await gotoReady(page, `/admin/companies/${co.id}/support`);
  await expect(page.getByTestId("dv3-support-ticket")).toHaveCount(1);
  await expect(page.getByTestId("dv3-support-ticket")).toContainText(co.ticketRef);
  await expect(page.getByTestId("dv3-support-ticket").getByRole("link").first()).toHaveAttribute("href", `/admin/cases/${co.ticket}`);
  await expect(page.getByTestId("dv3-support-ticket")).toContainText("On track");
  await expect(page.getByTestId("dv3-support-complaint")).toHaveCount(1);

  await gotoReady(page, `/admin/companies/${co.id}/activity`);
  await expect(page.getByTestId("dtk-log")).toBeVisible();
  await gotoReady(page, `/admin/companies/${co.id}/notes`);
  const note = `Call before the next order ${STAMP}`;
  await page.getByTestId("dtk-note-body").fill(note);
  await page.getByTestId("dtk-note-add").click();
  await expect(page.getByTestId("dtk-note").filter({ hasText: note })).toHaveCount(1);
  await expect(page.getByRole("navigation", { name: co.name }).getByRole("link", { name: /^Notes/ })).toHaveAttribute("aria-current", "page");
  await gotoReady(page, `/admin/companies/${co.id}/raw`);
  await expect(page.getByTestId("dv3-raw")).toContainText(co.id);
  await expect(page.getByTestId("dv3-raw")).not.toContainText("passwordHash");
});

test("user view: any role, source and creator, staff permissions, security, notes; unknown ids are a clear page", async ({ page }) => {
  await admin(page);
  await gotoReady(page, `/admin/users/${co.id}`);
  await expect(page.getByRole("heading", { level: 1, name: "Detail Owner" })).toBeVisible();
  await expect(page.getByTestId("dv3-user-entity-link")).toHaveAttribute("href", `/admin/companies/${co.id}`);
  await expect(page.getByTestId("dv3-user-source")).toHaveText("Created by staff");
  await expect(page.getByTestId("dv3-user-created-by")).toHaveAttribute("href", `/admin/users/${adminId}`);
  await expect(page.getByTestId("dv3-user-entity")).toContainText(co.name);
  const ut = page.getByRole("navigation", { name: "Detail Owner" });
  for (const t of ["Overview", "Security", "Activity", "Notes", "Raw data"]) await expect(ut.getByRole("link", { name: new RegExp(`^${t}`) }), t).toBeVisible();
  await ut.getByRole("link", { name: /^Security/ }).click();
  await expect(page).toHaveURL(new RegExp(`/admin/users/${co.id}/security$`));
  await expect(page.getByTestId("dv3-user-security")).toBeVisible();
  await ut.getByRole("link", { name: /^Raw data/ }).click();
  await expect(page.getByTestId("dv3-user-raw")).toContainText(co.id);

  // the admin account: staff blocks, and the actions it performed (it created the company)
  await gotoReady(page, `/admin/users/${adminId}`);
  await expect(page.getByTestId("dv3-user-staff")).toBeVisible();
  await expect(page.getByTestId("dv3-user-mfa")).toBeVisible();
  await expect(page.getByTestId("dv3-user-lock")).toHaveText("Not locked");
  await expect(page.getByTestId("dv3-user-actions")).toContainText("Account created by staff");
  await expect(page.getByTestId("dv3-user-entity-link")).toHaveCount(0);
  await gotoReady(page, "/admin/users/00000000-0000-4000-8000-000000000000");
  await expect(page.getByTestId("dv3-user-not-found")).toBeVisible();
  await expect(page.getByRole("link", { name: "Back to users" })).toHaveAttribute("href", "/admin/users");
  const detail = await api(page.request, "GET", `/admin/users/${co.id}/detail`);
  expect(detail.text).not.toContain("passwordHash");
});

test("ticket view: deadlines, requester, canned reply with 'send and resolve', handling history, notes — every existing control still works", async ({ page }) => {
  await admin(page);
  await gotoReady(page, `/admin/cases/${co.ticket}`);
  await expect(page.getByRole("heading", { level: 1, name: new RegExp("Refund question") })).toBeVisible();
  await expect(page.getByTestId("foa-case-thread")).toContainText("Where is my refund");
  await expect(page.getByTestId("foa-case-facts")).toContainText(co.ticketRef);
  // deadlines and requester
  await expect(page.getByTestId("dv3-sla-first")).toHaveAttribute("data-state", "on_track");
  await expect(page.getByTestId("dv3-sla-resolution")).toHaveAttribute("data-state", "on_track");
  await expect(page.getByTestId("dv3-sla")).toContainText("Target 4 h");
  await expect(page.getByTestId("dv3-requester")).toContainText(co.name);
  await expect(page.getByTestId("dv3-requester-link")).toHaveAttribute("href", `/admin/companies/${co.id}`);
  await expect(page.getByTestId("dv3-requester-user-link")).toHaveAttribute("href", `/admin/users/${co.id}`);
  await expect(page.getByTestId("dv3-requester-tickets")).toContainText("1 open of 1");
  await expect(page.getByTestId("dv3-history")).toContainText("Opened");
  // handling controls
  await page.getByTestId("foa-case-priority").selectOption("urgent");
  await expect.poll(async () => (await api(co.ctx!.request, "GET", `/tickets/${co.ticket}`)).json.ticket.priority).toBe("urgent");
  await expect(page.getByTestId("dv3-history")).toContainText("Priority changed from Normal to Urgent");
  // canned reply for the category: inserted into the box, editable, nothing sent by itself
  await page.getByTestId("dv3-canned").selectOption({ index: 1 });
  await expect(page.getByTestId("foa-case-reply")).toHaveValue(/Detail|reviewing the payment details/);
  await expect(page.getByTestId("foa-case-reply")).toHaveValue(new RegExp(co.ticketRef));
  expect((await api(co.ctx!.request, "GET", `/tickets/${co.ticket}`)).json.replies).toHaveLength(1);
  // an internal note stays internal; the canned list is hidden for it
  await page.getByTestId("foa-case-internal").check();
  await expect(page.getByTestId("dv3-canned")).toHaveCount(0);
  await page.getByTestId("foa-case-internal").uncheck();
  // send and resolve: the public reply goes out and the ticket is resolved
  await expect(page.getByTestId("dv3-ticket-resolve-reply")).toBeEnabled();
  await page.getByTestId("dv3-ticket-resolve-reply").click();
  await expect(page.getByTestId("rdb-case-reopen")).toBeVisible();
  await expect(page.getByTestId("dv3-sla-first-state")).toHaveText("Met");
  await expect(page.getByTestId("dv3-sla-resolution-state")).toHaveText("Met");
  const after = await api(co.ctx!.request, "GET", `/tickets/${co.ticket}`);
  expect(after.json.ticket.status).toBe("resolved"); expect(after.json.replies).toHaveLength(2);
  await expect(page.getByTestId("dv3-history")).toContainText("Resolved");
  await expect(page.getByTestId("dv3-history")).toContainText("First response by");
  // notes are separate from internal replies
  const note = `Refund approved by finance ${STAMP}`;
  await page.getByTestId("dtk-note-body").fill(note);
  await page.getByTestId("dtk-note-add").click();
  await expect(page.getByTestId("dtk-note").filter({ hasText: note })).toHaveCount(1);
  await expect(page.getByTestId("foa-case-thread")).not.toContainText(note);
  await expect(page.getByTestId("dtk-log")).toBeVisible();
  await expect(page.getByTestId("dv3-raw")).toBeHidden(); // collapsed until opened
  await page.getByTestId("dv3-raw-toggle").click();
  await expect(page.getByTestId("dv3-raw")).toContainText(co.ticket);
  // an unknown ticket is a clear error, not a blank page
  await gotoReady(page, "/admin/cases/00000000-0000-4000-8000-000000000000");
  await expect(page.locator('[role="alert"]:not(#__next-route-announcer__)')).toContainText("We couldn't find what you were looking for.");
});

test("complaint view: deadlines, filer, payment hold with its effect, resolution, history and outcome stats", async ({ page }) => {
  await admin(page);
  await gotoReady(page, `/admin/complaints/${co.complaint}`);
  await expect(page.getByTestId("complaints-description")).toContainText(STAMP);
  await expect(page.getByTestId("dv3-sla-first")).toHaveAttribute("data-state", "on_track");
  await expect(page.getByTestId("dv3-filer")).toContainText(co.name);
  await expect(page.getByTestId("dv3-filer-link")).toHaveAttribute("href", `/admin/companies/${co.id}`);
  await expect(page.getByTestId("dv3-evidence")).toHaveCount(0); // not linked to an order: a clear empty state instead
  await expect(page.getByText("No order linked")).toBeVisible();
  await expect(page.getByTestId("dv3-respondents")).toContainText("No other party");
  await expect(page.getByTestId("dv3-hold-state")).toContainText("does not hold the payment");
  await page.getByTestId("complaints-take").click();
  await expect.poll(async () => (await api(co.ctx!.request, "GET", `/complaints/${co.complaint}`)).json.complaint.status).toBe("in_progress");
  await page.getByTestId("complaints-hold").click();
  await expect(page.getByTestId("complaints-hold")).toBeChecked();
  await expect(page.getByTestId("dv3-hold-state")).toContainText("holding the payment");
  await expect(page.getByTestId("dv3-sla-first-state")).toHaveText("Met"); // the first staff action answered it
  await page.getByTestId("complaints-resolution-input").fill(`Late fee credited ${STAMP}`);
  await page.getByTestId("complaints-to-resolved").click();
  await expect(page.getByTestId("complaints-resolution")).toContainText(`Late fee credited ${STAMP}`);
  await expect(page.getByTestId("dv3-hold-state")).toContainText("hold ended");
  await expect(page.getByTestId("dv3-history")).toContainText("Settlement hold turned on");
  await expect(page.getByTestId("dv3-history")).toContainText("Status set to");
  await expect(page.getByTestId("dv3-outcomes")).toBeVisible();
  await expect(page.getByTestId("dtk-log")).toBeVisible();
  const note = `Spoke to the driver ${STAMP}`;
  await page.getByTestId("dtk-note-body").fill(note);
  await page.getByTestId("dtk-note-add").click();
  await expect(page.getByTestId("dtk-note").filter({ hasText: note })).toHaveCount(1);
});

test("phone width and Arabic: nothing scrolls sideways; labels and numbers are translated and mirrored", async ({ page, context }) => {
  await admin(page);
  await page.setViewportSize({ width: 390, height: 844 });
  for (const path of [`/admin/companies/${co.id}`, `/admin/companies/${co.id}/parcels`, `/admin/companies/${co.id}/integrations`, `/admin/companies/${co.id}/security`, `/admin/companies/${co.id}/support`, `/admin/companies/${co.id}/finance`,
    `/admin/users/${co.id}`, `/admin/users/${adminId}`, `/admin/users/${co.id}/security`, `/admin/cases/${co.ticket}`, `/admin/complaints/${co.complaint}`]) {
    await gotoReady(page, path);
    await expect(page.getByRole("heading", { level: 1 }).first()).toBeVisible();
    expect(await noSideways(page), path).toBe(true);
  }
  await context.addCookies([{ name: "jr_lang", value: "ar", url: BASE }]);
  await gotoReady(page, `/admin/companies/${co.id}`);
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  await expect(page.getByTestId("dv3-kpis")).toContainText("الطلبات");
  await expect(page.getByTestId("dv3-health")).toContainText(/[\u0600-\u06FF]/); // the health panel is translated (a company without activity shows "not enough data")
  expect(await noSideways(page)).toBe(true);
  await gotoReady(page, `/admin/cases/${co.ticket}`);
  await expect(page.getByTestId("dv3-sla")).toContainText(/[\u0600-\u06FF]/); // the deadline panel is translated
  expect(await noSideways(page)).toBe(true);
  await context.addCookies([{ name: "jr_lang", value: "en", url: BASE }]);
});
