import { test, expect, type APIRequestContext, type BrowserContext, type Page } from "@playwright/test";
import { staffLogin, gotoReady } from "./helpers";

/**
 * Admin companies (list + detail view with route tabs) and the verification workspace (redesign F1–F12).
 * The spec registers its own company through the public API, so nothing depends on another spec's data: it starts pending and without a
 * warehouse location, is reviewed through every view, and ends verified. Counters are judged against a baseline taken first.
 */
test.describe.configure({ mode: "serial" });
const BASE = "http://localhost:3100";
const ADMIN = { email: "admin@jrlogistics.test", password: "E2e!Password2026" };
const STAMP = Date.now().toString();
const co = { id: "", name: `Views Co ${STAMP.slice(-6)}`, phone: `05${STAMP.slice(-8)}`, ctx: null as BrowserContext | null };
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
let before = { total: 0, pending: 0, noWarehouse: 0 };

async function api(ctx: APIRequestContext, method: "GET" | "POST", path: string, data?: unknown) {
  const res = await ctx.fetch(`${BASE}/api/v1${path}`, { method, data, headers: { origin: BASE, "content-type": "application/json" } });
  return { status: res.status(), json: await res.json().catch(() => null) };
}
const admin = (page: Page) => staffLogin(page, ADMIN.email, ADMIN.password);
const group = (page: Page, name: string) => page.getByRole("group", { name, exact: true });
const dialog = (page: Page) => page.getByRole("dialog");
/** Fills the note / reason of the open dialog and confirms with the button that carries the action's name. */
async function decide(page: Page, label: string, note: string, confirm: string) {
  await expect(dialog(page)).toBeVisible();
  await dialog(page).getByLabel(label).fill(note);
  await dialog(page).getByRole("button", { name: confirm, exact: true }).click();
  await expect(page.getByText("Saved").first()).toBeVisible();
  await expect(dialog(page)).toBeHidden();
}
const noSideways = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);

test("a new company registers: pending, no warehouse location, and the KPI counters move by one", async ({ page, browser }) => {
  await admin(page);
  const s0 = (await api(page.request, "GET", "/admin/companies/summary")).json;
  before = { total: s0.total, pending: s0.pending, noWarehouse: s0.noWarehouse };
  co.ctx = await browser.newContext();
  const sent = await api(co.ctx.request, "POST", "/auth/otp/send", { phone: co.phone });
  const ver = await api(co.ctx.request, "POST", "/auth/otp/verify", { phone: co.phone, code: sent.json.demoCode });
  expect(ver.json.isNew, JSON.stringify(ver.json)).toBe(true);
  const reg = await api(co.ctx.request, "POST", "/auth/register", { registrationToken: ver.json.registrationToken, role: "business", name: "Views Owner", companyName: co.name, city: "riyadh", crNumber: "7001234567", termsAccepted: true });
  expect(reg.status, JSON.stringify(reg.json)).toBe(201);
  co.id = reg.json.user.id;
  const s1 = (await api(page.request, "GET", "/admin/companies/summary")).json;
  expect(s1).toMatchObject({ total: before.total + 1, pending: before.pending + 1, noWarehouse: before.noWarehouse + 1 });
});

test("list view: KPI tiles link to the filtered list, search + state filter live in the URL, the row shows what needs attention", async ({ page }) => {
  await admin(page);
  await gotoReady(page, "/admin/companies");
  await expect(page.getByRole("heading", { level: 1, name: "Companies" })).toBeVisible();
  for (const [name, href] of [[/^Verified/, "/admin/companies?state=verified"], [/^Awaiting review/, "/admin/companies?state=pending"], [/^Suspended/, "/admin/companies?state=suspended"], [/^Location missing/, "/admin/companies?warehouse=missing"]] as const) {
    await expect(page.getByRole("link", { name }).first(), String(name)).toHaveAttribute("href", href);
  }
  await expect(page.getByRole("link", { name: /^Awaiting review/ })).toContainText(String(before.pending + 1));
  const row = page.getByTestId("companies-row").filter({ hasText: co.name });
  await page.getByRole("textbox", { name: "Search company, contact, phone or CR number" }).fill(co.name);
  await expect(row).toHaveCount(1);
  await expect(row).toContainText("Views Owner");
  await expect(row).toContainText("Pending");
  await expect(page.getByTestId(`foa-wh-badge-${co.id}`)).toHaveText("Location missing");
  await group(page, "Verification").getByRole("button", { name: /^Pending/ }).click();
  await expect(page).toHaveURL(/[?&]state=pending/);
  await expect(row).toHaveCount(1);
  await group(page, "Verification").getByRole("button", { name: /^Verified/ }).click();
  await expect(page).toHaveURL(/[?&]state=verified/);
  await expect(row).toHaveCount(0);
  await expect(page.getByText("No results found")).toBeVisible(); // empty state with a way out
  await page.getByRole("button", { name: "Clear filters" }).click();
  await expect(row).toHaveCount(1);
  await page.getByLabel("Location", { exact: true }).selectOption("missing");
  await expect(page).toHaveURL(/[?&]warehouse=missing/);
  await expect(row).toHaveCount(1);
  // a link with the filters already set opens the filtered list
  await gotoReady(page, "/admin/companies?state=pending&warehouse=missing");
  await expect(group(page, "Verification").getByRole("button", { name: /^Pending/ })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByTestId("companies-row").filter({ hasText: co.name })).toHaveCount(1);
});

test("detail view: header with state, warnings, route tabs, empty states", async ({ page }) => {
  await admin(page);
  await gotoReady(page, "/admin/companies");
  await page.getByRole("textbox", { name: "Search company, contact, phone or CR number" }).fill(co.name);
  await page.getByTestId("companies-row").filter({ hasText: co.name }).getByRole("link", { name: co.name, exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/admin/companies/${co.id}$`));
  await expect(page.getByRole("heading", { level: 1, name: co.name })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Breadcrumb" })).toContainText("Companies");
  await expect(page.getByTestId("companies-flag-pending")).toBeVisible(); // unverified companies are flagged
  await expect(page.getByText("7001234567").first()).toBeVisible();
  const tabs = page.getByRole("navigation", { name: co.name });
  for (const t of ["Overview", "Orders", "Warehouse", "Finance", "Documents"]) await expect(tabs.getByRole("link", { name: new RegExp(`^${t}`) })).toBeVisible();
  await expect(tabs.getByRole("link", { name: /^Overview/ })).toHaveAttribute("aria-current", "page");
  await expect(page.getByText("Active orders")).toBeVisible();
  await expect(page.getByText("No requests yet")).toBeVisible();
  await tabs.getByRole("link", { name: /^Orders/ }).click();
  await expect(page).toHaveURL(new RegExp(`/admin/companies/${co.id}/orders$`));
  await expect(page.getByText("No requests yet")).toBeVisible();
  await tabs.getByRole("link", { name: /^Finance/ }).click();
  await expect(page).toHaveURL(new RegExp(`/admin/companies/${co.id}/finance$`));
  await expect(page.getByText("Available balance")).toBeVisible();
  await expect(page.getByText("No invoices yet")).toBeVisible();
  await tabs.getByRole("link", { name: /^Documents/ }).click();
  await expect(page.getByTestId("companies-doc-type-business_cr")).toContainText("Not uploaded");
  await expect(tabs.getByRole("link", { name: /^Documents/ })).toHaveAttribute("aria-current", "page");
});

test("warehouse tab: set the location and the company stops being flagged as missing one", async ({ page }) => {
  await admin(page);
  await gotoReady(page, `/admin/companies/${co.id}/warehouse`);
  await expect(page.getByTestId("foa-wh-panel")).toBeVisible();
  await expect(page.getByTestId("foa-wh-status")).toHaveText("Location missing");
  await page.getByTestId("foa-wh-lat").fill("24.7136");
  await page.getByTestId("foa-wh-lng").fill("46.6753");
  await page.getByTestId("foa-wh-save").click();
  await expect(page.getByTestId("foa-wh-saved")).toBeVisible();
  expect((await api(page.request, "GET", `/admin/businesses/${co.id}/warehouse`)).json).toMatchObject({ lat: 24.7136, lng: 46.6753 });
  await gotoReady(page, `/admin/companies/${co.id}`);
  await expect(page.getByText("Location set").first()).toBeVisible();
  const s = (await api(page.request, "GET", "/admin/companies/summary")).json;
  expect(s.noWarehouse).toBe(before.noWarehouse);
});

test("documents tab: the company's upload shows up and is approved from the company view", async ({ page }) => {
  const up = await co.ctx!.request.post(`${BASE}/api/v1/documents`, { multipart: { type: "business_cr", file: { name: "cr.png", mimeType: "image/png", buffer: PNG } }, headers: { origin: BASE } });
  expect(up.status()).toBe(201);
  await admin(page);
  await gotoReady(page, `/admin/companies/${co.id}/documents`);
  const row = page.getByTestId("companies-doc-row");
  await expect(row).toHaveCount(1);
  await expect(row).toContainText("Commercial registration");
  await expect(row).toContainText("Submitted");
  await expect(page.getByTestId("companies-doc-type-business_cr")).toContainText("Submitted");
  await expect(row.getByTestId("companies-doc-view")).toHaveAttribute("href", /\/api\/v1\/documents\/.+\/file$/);
  // a decision that needs a note asks for it; approval does not
  await row.getByTestId("companies-doc-info").click();
  await expect(dialog(page).getByRole("button", { name: "Request info", exact: true })).toBeDisabled();
  await dialog(page).getByLabel("Note to the user").fill("Please send a sharper copy");
  await dialog(page).getByRole("button", { name: "Request info", exact: true }).click();
  await expect(page.getByText("Saved").first()).toBeVisible();
  await expect(row).toContainText("More info needed");
  await expect(row).toContainText("Please send a sharper copy");
  await row.getByTestId("companies-doc-approve").click();
  await expect(row).toContainText("Approved");
  await expect(row.getByTestId("companies-doc-approve")).toHaveCount(0);
  await expect(page.getByTestId("companies-doc-type-business_cr")).toContainText("Approved");
});

test("verification workspace: KPI row, route tabs, the accounts queue with quick decisions, the documents queue, old ?tab= links", async ({ page }) => {
  await admin(page);
  await gotoReady(page, "/admin/verification");
  await expect(page.getByRole("heading", { level: 1, name: "Verification" })).toBeVisible();
  const tabs = page.getByRole("navigation", { name: "Verification" });
  for (const t of ["Accounts", "Documents", "Drivers"]) await expect(tabs.getByRole("link", { name: new RegExp(`^${t}`) })).toBeVisible();
  await expect(tabs.getByRole("link", { name: /^Accounts/ })).toHaveAttribute("aria-current", "page");
  await expect(page.getByRole("link", { name: /^Companies in the queue/ })).toHaveAttribute("href", "/admin/verification?kind=business");
  await expect(page.getByRole("link", { name: /^Documents to review/ })).toHaveAttribute("href", "/admin/verification/documents");
  const row = page.getByTestId("verification-account-row").filter({ hasText: co.name });
  await expect(row).toHaveCount(1);
  await expect(row).toContainText("Pending");
  await expect(row.getByTestId("verification-account-open")).toHaveAttribute("href", `/admin/companies/${co.id}`);
  await group(page, "Account type").getByRole("button", { name: /^Courier offices/ }).click();
  await expect(page).toHaveURL(/[?&]kind=office/);
  await expect(row).toHaveCount(0);
  await group(page, "Account type").getByRole("button", { name: /^Companies/ }).click();
  await expect(page).toHaveURL(/[?&]kind=business/);
  await expect(row).toHaveCount(1);
  // quick decision in the queue: request info keeps the company in the queue with the new state
  await row.getByTestId("verification-account-info").click();
  await decide(page, "Note to the user", "Please upload your tax certificate too", "Request info");
  await expect(row).toContainText("Info requested");
  await expect(row.getByTestId("verification-account-info")).toHaveCount(0);
  expect((await api(page.request, "GET", `/admin/companies/${co.id}`)).json.profile).toMatchObject({ verificationStatus: "info_requested", verificationNote: "Please upload your tax certificate too" });
  // documents queue: filter by state, owner links to the company view
  await tabs.getByRole("link", { name: /^Documents/ }).click();
  await expect(page).toHaveURL(/\/admin\/verification\/documents$/);
  await group(page, "Status").getByRole("button", { name: /^Approved/ }).click();
  await expect(page).toHaveURL(/[?&]status=approved/);
  const doc = page.getByTestId("verification-doc-row").filter({ hasText: "Views Owner" }); // the documents API names the owner by contact person
  await expect(doc).toHaveCount(1);
  await expect(doc).toContainText("Commercial registration");
  await doc.getByRole("link", { name: "Views Owner", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/admin/companies/${co.id}$`));
  // the drivers queue is its own page
  await gotoReady(page, "/admin/verification/drivers");
  await expect(page.getByRole("navigation", { name: "Verification" }).getByRole("link", { name: /^Drivers/ })).toHaveAttribute("aria-current", "page");
});

test("old /admin/verification?tab= links keep working", async ({ page }) => {
  await admin(page);
  for (const [tab, url] of [["docs", /\/admin\/verification\/documents$/], ["drivers", /\/admin\/verification\/drivers$/], ["business", /\/admin\/verification\?kind=business$/], ["offices", /\/admin\/verification\?kind=office$/], ["accounts", /\/admin\/companies$/]] as const) {
    await page.goto(`/admin/verification?tab=${tab}`);
    await expect(page, tab).toHaveURL(url);
  }
});

test("header actions: reject, verify, suspend and activate the account, each reflected in the badges and warnings", async ({ page }) => {
  await admin(page);
  await gotoReady(page, `/admin/companies/${co.id}`);
  await expect(page.getByTestId("companies-flag-info_requested")).toBeVisible();
  // reject needs a note
  await page.getByTestId("companies-act-reject").click();
  await expect(dialog(page).getByRole("button", { name: "Reject", exact: true })).toBeDisabled();
  await decide(page, "Note to the user", "Commercial registration does not match", "Reject");
  await expect(page.getByTestId("companies-flag-rejected")).toBeVisible();
  await expect(page.getByTestId("companies-act-reject")).toHaveCount(0);
  // verify (no note)
  await page.getByTestId("companies-act-verify").click();
  await expect(page.getByText("Saved").first()).toBeVisible();
  await expect(page.getByTestId("companies-flags")).toHaveCount(0);
  await expect(page.getByTestId("companies-act-verify")).toHaveCount(0);
  expect((await api(page.request, "GET", `/admin/companies/${co.id}`)).json.profile.verificationStatus).toBe("verified");
  // suspend the account: reason required, the warning appears, Activate replaces Suspend
  await page.getByTestId("companies-act-suspend").click();
  await expect(dialog(page).getByRole("button", { name: "Suspend account", exact: true })).toBeDisabled();
  await decide(page, "Reason", "Chargeback investigation", "Suspend account");
  await expect(page.getByTestId("companies-flag-account_suspended")).toBeVisible();
  await expect(page.getByText("Account suspended").first()).toBeVisible();
  await expect(page.getByTestId("companies-act-suspend")).toHaveCount(0);
  expect((await api(page.request, "GET", `/admin/companies?state=suspended&q=${encodeURIComponent(co.name)}`)).json.total).toBe(1);
  await page.getByTestId("companies-act-activate").click();
  await decide(page, "Reason", "Cleared", "Activate account");
  await expect(page.getByTestId("companies-flags")).toHaveCount(0);
  await expect(page.getByTestId("companies-act-suspend")).toBeVisible();
  expect((await api(page.request, "GET", `/admin/companies/${co.id}`)).json.status).toBe("active");
  // verified company: verification can be suspended on its own
  await expect(page.getByTestId("companies-act-suspend-verification")).toBeVisible();
});

test("an id that is not a company shows a clear page, and the views fit a phone", async ({ page }) => {
  await admin(page);
  const me = (await api(page.request, "GET", "/auth/me")).json; const adminId = me.user?.id ?? me.id;
  for (const id of [adminId, "00000000-0000-4000-8000-000000000000", "not-an-id"]) {
    await gotoReady(page, `/admin/companies/${id}`);
    await expect(page.getByTestId("companies-not-found"), id).toBeVisible();
    await expect(page.getByRole("link", { name: "Back to companies" })).toHaveAttribute("href", "/admin/companies");
  }
  await page.setViewportSize({ width: 390, height: 844 });
  for (const path of ["/admin/companies", `/admin/companies/${co.id}`, `/admin/companies/${co.id}/finance`, `/admin/companies/${co.id}/documents`, "/admin/verification", "/admin/verification/documents"]) {
    await gotoReady(page, path);
    await expect(page.getByRole("heading", { level: 1 }).first()).toBeVisible();
    expect(await noSideways(page), path).toBe(true);
  }
});
