import { test, expect, type APIRequestContext, type Browser, type Page } from "@playwright/test";
import { staffLogin, gotoReady, DEMO, apiLogin } from "./helpers";

/**
 * Admin support, quality and system pages after the redesign (decisions F1–F12):
 *  - support cases and complaints are list views that open each case as its own view (/admin/cases/:id, /admin/complaints/:id)
 *  - settings is a workspace of route-based sub-pages, each with its own Save
 *  - staff, ratings, audit log, integrations and notifications start with a KPI row and use filters instead of tabs
 * Customers' sides are driven through the API; assertions are relative to what each test creates (the specs share one database).
 */
test.describe.configure({ mode: "serial" });
const BASE = "http://localhost:3100";
const ADMIN = { email: "admin@jrlogistics.test", password: "E2e!Password2026" };

async function api(ctx: APIRequestContext, method: "GET" | "POST" | "PATCH", path: string, data?: unknown) {
  const res = await ctx.fetch(`${BASE}/api/v1${path}`, { method, data, headers: { origin: BASE, "content-type": "application/json" } });
  return { status: res.status(), json: await res.json().catch(() => null) };
}
async function adminPage(browser: Browser, width?: number): Promise<Page> {
  const ctx = await browser.newContext(width ? { viewport: { width, height: 900 } } : undefined);
  const p = await ctx.newPage();
  await staffLogin(p, ADMIN.email, ADMIN.password);
  return p;
}
/** One pill of a <Segmented> filter (the pills are buttons with aria-pressed; their text is the label followed by the count). */
const pill = (p: Page, text: RegExp) => p.locator("button[aria-pressed]").filter({ hasText: text });
const noSideScroll = (p: Page) => p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);

test("cases: KPI row, filters, deep links, and a ticket opened as its own view", async ({ browser }) => {
  test.setTimeout(120_000);
  const drv = await apiLogin(browser, DEMO.driver);
  const tag = `E2E${Date.now()}`;
  const made = await api(drv.request, "POST", "/tickets", { category: "app_problem", subject: `Map is blank ${tag}`, body: "The map does not load on my phone." });
  expect(made.status).toBe(201);
  const id: string = made.json.id;
  const ap = await adminPage(browser);

  await gotoReady(ap, "/admin/cases");
  await expect(ap.getByRole("heading", { level: 1, name: "Support cases" })).toBeVisible();
  for (const href of ["status=open", "status=in_review", "status=open&assignee=unassigned", "priority=urgent", "status=resolved"]) await expect(ap.locator(`a[href="/admin/cases?${href}"]`)).toBeVisible();
  // tabs became filters: a pill group with counts, no tab bar
  await expect(ap.getByRole("tab")).toHaveCount(0);
  await expect(pill(ap, /^Active/)).toHaveAttribute("aria-pressed", "true");

  // search, then status pills (the new ticket is open, not resolved)
  await ap.getByTestId("foa-case-filter-q").locator("input").fill(tag);
  await expect(ap.getByTestId(`foa-case-row-${id}`)).toBeVisible();
  await pill(ap, /^Resolved/).click();
  await expect(ap).toHaveURL(/status=resolved/);
  await expect(ap.getByTestId(`foa-case-row-${id}`)).toHaveCount(0);
  await pill(ap, /^Open/).click();
  await expect(ap.getByTestId(`foa-case-row-${id}`)).toBeVisible();

  // deep links: unassigned open tickets (a dashboard tile) and "assigned to me" (nothing yet)
  await gotoReady(ap, `/admin/cases?status=open&assignee=unassigned&q=${tag}`);
  await expect(ap.getByTestId(`foa-case-row-${id}`)).toBeVisible();
  await gotoReady(ap, `/admin/cases?assignee=me&q=${tag}`);
  await expect(ap.getByText("No results found")).toBeVisible();
  await expect(ap.getByTestId(`foa-case-row-${id}`)).toHaveCount(0);

  // the ticket view
  await gotoReady(ap, `/admin/cases?q=${tag}`);
  await ap.getByTestId(`foa-case-row-${id}`).click();
  await expect(ap).toHaveURL(new RegExp(`/admin/cases/${id}$`));
  await expect(ap.getByRole("heading", { level: 1, name: `Map is blank ${tag}` })).toBeVisible();
  await expect(ap.getByRole("navigation", { name: "Breadcrumb" }).getByRole("link", { name: "Support cases" }).first()).toBeVisible();
  await expect(ap.getByTestId("foa-case-thread")).toContainText("The map does not load on my phone.");
  await expect(ap.getByTestId("foa-case-facts")).toContainText(made.json.ref);
  await ap.getByTestId("foa-case-status").selectOption("in_review");
  await expect.poll(async () => (await api(drv.request, "GET", `/tickets/${id}`)).json.ticket.status).toBe("in_review");
  await ap.getByTestId("foa-case-priority").selectOption("urgent");
  await expect.poll(async () => (await api(drv.request, "GET", `/tickets/${id}`)).json.ticket.priority).toBe("urgent");
  // an internal note is shown to staff only
  await ap.getByTestId("foa-case-internal").check();
  await ap.getByTestId("foa-case-reply").fill(`internal ${tag}`);
  await ap.getByTestId("foa-case-send").click();
  await expect(ap.getByTestId("foa-case-thread")).toContainText(`internal ${tag}`);
  expect(JSON.stringify((await api(drv.request, "GET", `/tickets/${id}`)).json.replies)).not.toContain(`internal ${tag}`);
  // a public reply, then resolve from the header
  await ap.getByTestId("foa-case-reply").fill(`We fixed it ${tag}`);
  await ap.getByTestId("foa-case-send").click();
  await expect(ap.getByTestId("foa-case-thread")).toContainText(`We fixed it ${tag}`);
  await ap.getByTestId("foa-case-resolve").click();
  await expect.poll(async () => (await api(drv.request, "GET", `/tickets/${id}`)).json.ticket.status).toBe("resolved");
  await expect(ap.getByTestId("rdb-case-reopen")).toBeVisible();
  // back to the list through the breadcrumb: the ticket is now under Resolved
  await ap.getByRole("navigation", { name: "Breadcrumb" }).getByRole("link", { name: "Support cases" }).first().click();
  await expect(ap.getByRole("heading", { level: 1, name: "Support cases" })).toBeVisible();
  await gotoReady(ap, `/admin/cases?status=resolved&q=${tag}`);
  await expect(ap.getByTestId(`foa-case-row-${id}`)).toBeVisible();
});

test("complaints: a status filter with counts and a complaint opened as its own view", async ({ browser }) => {
  test.setTimeout(120_000);
  const biz = await apiLogin(browser, DEMO.business);
  const tag = `E2E${Date.now()}`;
  const made = await api(biz.request, "POST", "/complaints", { category: "delay", description: `The driver was two hours late ${tag}` });
  expect(made.status).toBe(201);
  const id: string = made.json.id;
  const ap = await adminPage(browser);

  await gotoReady(ap, "/admin/complaints");
  await expect(ap.getByRole("heading", { level: 1, name: "Complaints" })).toBeVisible();
  await expect(ap.getByRole("tab")).toHaveCount(0);
  for (const name of [/^Active/, /^Open/, /^In progress/, /^Resolved/, /^Closed/, /^All/]) await expect(pill(ap, name)).toBeVisible();
  await gotoReady(ap, `/admin/complaints?q=${tag}`);
  await ap.getByTestId(`complaints-row-${id}`).click();
  await expect(ap).toHaveURL(new RegExp(`/admin/complaints/${id}$`));
  await expect(ap.getByTestId("complaints-description")).toContainText(tag);
  // take it, add a note, hold the payment, resolve with a resolution
  await ap.getByTestId("complaints-take").click();
  await expect.poll(async () => (await api(biz.request, "GET", `/complaints/${id}`)).json.complaint.status).toBe("in_progress");
  await ap.getByTestId("complaints-note").fill(`Called the driver ${tag}`);
  await ap.getByTestId("complaints-add-note").click();
  await expect(ap.getByTestId("complaints-notes")).toContainText(`Called the driver ${tag}`);
  await ap.getByTestId("complaints-hold").click(); // controlled by the saved complaint: it flips once the server has answered
  await expect(ap.getByTestId("complaints-hold")).toBeChecked();
  await expect.poll(async () => (await api(biz.request, "GET", `/complaints/${id}`)).json.complaint.holdsSettlement).toBe(true);
  await expect(ap.getByTestId("complaints-to-resolved")).toBeDisabled(); // a resolution is required
  await ap.getByTestId("complaints-resolution-input").fill(`Late fee credited ${tag}`);
  await ap.getByTestId("complaints-to-resolved").click();
  await expect(ap.getByTestId("complaints-resolution")).toContainText(`Late fee credited ${tag}`);
  const done = (await api(biz.request, "GET", `/complaints/${id}`)).json.complaint;
  expect(done.status).toBe("resolved"); expect(done.holdsSettlement).toBe(false);
});

test("settings: a workspace of sub-pages, each with its own Save and edits that survive switching tabs", async ({ browser }) => {
  test.setTimeout(120_000);
  const ap = await adminPage(browser);
  const tabs = ap.getByRole("navigation", { name: "Settings" });
  await gotoReady(ap, "/admin/settings");
  for (const name of ["General", "Matching & jobs", "Field operations", "Finance & limits", "Security & access", "Terms"]) await expect(tabs.getByRole("link", { name })).toBeVisible();
  await expect(tabs.getByRole("link", { name: "General" })).toHaveAttribute("aria-current", "page");
  await expect(ap.getByTestId("rdb-set-service-delivery_driver")).toBeVisible();

  const before = (await api(ap.request, "GET", "/admin/settings")).json;
  try {
    // finance: an out-of-range VAT blocks Save, a valid one marks the tab as unsaved
    await tabs.getByRole("link", { name: "Finance & limits" }).click();
    await expect(ap).toHaveURL(/\/admin\/settings\/finance$/);
    await expect(ap.getByTestId("foa-settings-save")).toBeDisabled();
    await ap.getByTestId("rdb-set-vatPct").fill("99");
    await expect(ap.getByText("Enter a value from 0 to 30.")).toBeVisible();
    await expect(ap.getByTestId("foa-settings-save")).toBeDisabled();
    const next = before.vatPct === 12 ? "11" : "12";
    await ap.getByTestId("rdb-set-vatPct").fill(next);
    await expect(ap.getByTestId("rdb-set-dirty-finance")).toBeVisible();
    // the edit survives a trip to another tab, whose own Save stays off
    await tabs.getByRole("link", { name: "Matching & jobs" }).click();
    await expect(ap).toHaveURL(/\/admin\/settings\/jobs$/);
    await expect(ap.getByTestId("rdb-set-dirty-finance")).toBeVisible();
    await expect(ap.getByTestId("foa-settings-save")).toBeDisabled();
    await expect(ap.getByTestId("rdb-set-lateGraceMin")).toBeVisible();
    await tabs.getByRole("link", { name: "Finance & limits" }).click();
    await expect(ap.getByTestId("rdb-set-vatPct")).toHaveValue(next);
    await ap.getByTestId("foa-settings-save").click();
    await expect.poll(async () => (await api(ap.request, "GET", "/admin/settings")).json.vatPct).toBe(Number(next));
    await expect(ap.getByTestId("rdb-set-dirty-finance")).toHaveCount(0);
    // the change is in the audit log as before → after
    const audit = (await api(ap.request, "GET", "/admin/audit?entity=settings&pageSize=5")).json;
    expect(audit.items[0]).toMatchObject({ action: "settings.update", diff: { vatPct: { from: before.vatPct, to: Number(next) } } });
  } finally {
    await api(ap.request, "PATCH", "/admin/settings", { vatPct: before.vatPct });
  }

  // security and terms are pages of their own; nothing is toggled here (it would affect every staff account)
  await tabs.getByRole("link", { name: "Security & access" }).click();
  await expect(ap.getByTestId("rdb-set-pw-current")).toBeVisible();
  await expect(ap.getByTestId("rdb-set-requireStaffMfa")).toBeVisible();
  await tabs.getByRole("link", { name: "Terms" }).click();
  await expect(ap.getByTestId("rdb-set-termsVersion")).toBeVisible();
  await tabs.getByRole("link", { name: "Field operations" }).click();
  await expect(ap.getByTestId("foa-settings-card")).toBeVisible();
  await expect(ap.getByTestId("foa-set-arrivalRadiusM")).toBeVisible();
});

test("staff: KPI row, filters and the role / permission editor", async ({ browser }) => {
  const ap = await adminPage(browser);
  await gotoReady(ap, "/admin/staff");
  await expect(ap.getByRole("heading", { level: 1, name: "Staff" })).toBeVisible();
  for (const href of ["/admin/staff", "/admin/staff?filter=locked", "/admin/staff?filter=no_mfa"]) await expect(ap.locator(`#main a[href="${href}"]`)).toBeVisible(); // the KPI tiles (the sidebar links to /admin/staff too)
  await ap.getByRole("textbox", { name: "Search", exact: true }).fill("finance1@");
  await expect(ap.getByText("finance1@jrlogistics.demo")).toBeVisible();
  await expect(ap.getByText("support@jrlogistics.demo")).toHaveCount(0);
  await ap.getByRole("textbox", { name: "Search", exact: true }).fill("");
  await pill(ap, /^Suspended/).click();
  await expect(ap).toHaveURL(/filter=suspended/);
  await pill(ap, /^All/).click();
  // the editor: account + role & permissions; a preset fills the permissions, editing one marks it customised
  await ap.getByTestId("rdb-staff-add").click();
  await expect(ap.getByTestId("rdb-staff-perms")).toBeVisible();
  await ap.getByTestId("rdb-staff-preset").selectOption("support");
  await expect(ap.getByTestId("foa-perm-tickets.manage")).toBeChecked();
  await expect(ap.getByTestId("foa-perm-finance.view")).not.toBeChecked();
  await ap.getByTestId("foa-perm-tickets.manage").uncheck();
  await expect(ap.getByText("Customised: the permissions differ from this preset.")).toBeVisible();
  await expect(ap.getByTestId("rdb-staff-save")).toBeDisabled(); // name, email and a temporary password are required
  await ap.getByRole("button", { name: "Cancel" }).click();
  await expect(ap.getByTestId("rdb-staff-perms")).toHaveCount(0);
});

test("ratings, audit log, integrations and notifications start with KPIs and filter instead of tabs", async ({ browser }) => {
  const ap = await adminPage(browser);
  await gotoReady(ap, "/admin/ratings");
  await expect(ap.getByRole("heading", { level: 1, name: "Ratings" })).toBeVisible();
  await expect(ap.getByText("Average rating")).toBeVisible();
  await expect(pill(ap, /^All/)).toHaveAttribute("aria-pressed", "true");
  await pill(ap, /2★ or less/).click();
  await expect(ap).toHaveURL(/max=2/);

  await gotoReady(ap, "/admin/audit");
  await expect(ap.getByRole("heading", { level: 1, name: "Audit log" })).toBeVisible();
  await expect(ap.getByText("Events today")).toBeVisible();
  await pill(ap, /^Today$/).click();
  await expect(ap).toHaveURL(/period=today/);
  await ap.getByLabel("Entity").selectOption("settings");
  await expect(ap).toHaveURL(/entity=settings/);

  await gotoReady(ap, "/admin/integrations?problems=1"); // the legacy deep link still works
  await expect(ap.getByRole("heading", { level: 1, name: "Integrations" })).toBeVisible();
  await expect(pill(ap, /^Need attention/)).toHaveAttribute("aria-pressed", "true");
  await expect(ap.getByText("Stuck updates").first()).toBeVisible();

  await gotoReady(ap, "/admin/notifications");
  await expect(ap.getByRole("heading", { level: 1, name: "Notifications" })).toBeVisible();
  await expect(ap.getByRole("tab")).toHaveCount(0);
  await pill(ap, /^Unread/).click();
  await expect(pill(ap, /^Unread/)).toHaveAttribute("aria-pressed", "true");
});

test("the new views fit a phone: no sideways page scroll", async ({ browser }) => {
  const ap = await adminPage(browser, 390);
  for (const path of ["/admin/cases", "/admin/complaints", "/admin/staff", "/admin/settings/jobs", "/admin/ratings", "/admin/audit", "/admin/integrations", "/admin/notifications"]) {
    await gotoReady(ap, path);
    await expect(ap.getByRole("heading", { level: 1 }).first()).toBeVisible();
    expect(await noSideScroll(ap), path).toBe(true);
  }
});
