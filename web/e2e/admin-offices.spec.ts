import { test, expect, type APIRequestContext, type BrowserContext, type Page } from "@playwright/test";
import { staffLogin, gotoReady, DEMO } from "./helpers";

/**
 * Admin courier offices, drivers and users (redesign F1–F12): list views with KPI tiles + URL filters, the office view with route tabs and
 * its actions (verify / request info / agreement / suspend), the driver view and the users directory.
 * The spec registers its own office through the public API (so nothing depends on another spec's data): it starts pending without documents
 * or agreement, is verified and given an agreement through the UI, and ends active. Counters are judged against a baseline taken first.
 */
test.describe.configure({ mode: "serial" });
const BASE = "http://localhost:3100";
const ADMIN = { email: "admin@jrlogistics.test", password: "E2e!Password2026" };
const STAMP = Date.now().toString();
const off = { id: "", name: `Views Office ${STAMP.slice(-6)}`, phone: `05${STAMP.slice(-8)}`, ctx: null as BrowserContext | null };
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
let before = { offices: 0, review: 0, verified: 0 };

async function api(ctx: APIRequestContext, method: "GET" | "POST", path: string, data?: unknown) {
  const res = await ctx.fetch(`${BASE}/api/v1${path}`, { method, data, headers: { origin: BASE, "content-type": "application/json" } });
  return { status: res.status(), json: await res.json().catch(() => null) };
}
const admin = (page: Page) => staffLogin(page, ADMIN.email, ADMIN.password);
const group = (page: Page, name: string) => page.getByRole("group", { name, exact: true });
const dialog = (page: Page) => page.getByRole("dialog");
const header = (page: Page) => page.getByRole("heading", { level: 1 }).locator("..");
const tabs = (page: Page) => page.getByRole("navigation", { name: "Office sections" });
const kpis = (page: Page) => page.getByRole("region", { name: "Key figures" });
const noSideways = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
async function confirm(page: Page, label: string, field: string, text: string, button: string) {
  await expect(dialog(page)).toBeVisible();
  await dialog(page).getByLabel(field).fill(text);
  await dialog(page).getByRole("button", { name: button, exact: true }).click();
  await expect(page.getByText("Saved").first()).toBeVisible();
  await expect(dialog(page), label).toBeHidden();
}

test("a new office registers: pending, and the KPI counters move by one", async ({ page, browser }) => {
  await admin(page);
  const s0 = (await api(page.request, "GET", "/admin/offices/summary")).json;
  before = { offices: s0.offices, review: s0.review, verified: s0.verified };
  off.ctx = await browser.newContext();
  const sent = await api(off.ctx.request, "POST", "/auth/otp/send", { phone: off.phone });
  const ver = await api(off.ctx.request, "POST", "/auth/otp/verify", { phone: off.phone, code: sent.json.demoCode });
  expect(ver.json.isNew, JSON.stringify(ver.json)).toBe(true);
  const reg = await api(off.ctx.request, "POST", "/auth/register", { registrationToken: ver.json.registrationToken, role: "office", name: "Views Contact", companyName: off.name, city: "riyadh", crNumber: "7007654321", termsAccepted: true });
  expect(reg.status, JSON.stringify(reg.json)).toBe(201);
  off.id = reg.json.user.id;
  const s1 = (await api(page.request, "GET", "/admin/offices/summary")).json;
  expect(s1).toMatchObject({ offices: before.offices + 1, review: before.review + 1, verified: before.verified });
  expect((await api(page.request, "GET", `/admin/offices/${off.id}`)).json.readiness.issues).toEqual(["not_verified", "no_agreement"]);
});

test("list view: KPI tiles link to the filtered list, state + agreement filters live in the URL, search finds the office", async ({ page }) => {
  await admin(page);
  await gotoReady(page, "/admin/offices");
  await expect(page.getByRole("heading", { level: 1, name: "Courier offices" })).toBeVisible();
  for (const [name, href] of [[/^Verified/, "/admin/offices?state=verified"], [/^In review/, "/admin/offices?state=review"], [/^Suspended/, "/admin/offices?state=suspended"], [/^Agreements/, "/admin/offices?agreement=pending"], [/^Drivers/, "/admin/drivers?link=office"]] as const) {
    await expect(kpis(page).getByRole("link", { name }), String(name)).toHaveAttribute("href", href);
  }
  await expect(kpis(page).getByRole("link", { name: /^In review/ })).toContainText(String(before.review + 1));
  const row = page.getByTestId(`rdq-office-row-${off.id}`);
  await page.getByRole("textbox", { name: "Search office, contact, phone or CR no." }).fill(off.name);
  await expect(row).toHaveCount(1);
  await expect(row).toContainText("Views Contact");
  await expect(row).toContainText("Pending");
  await expect(row).toContainText("No agreement");
  await group(page, "Verification").getByRole("button", { name: /^Awaiting review/ }).click();
  await expect(page).toHaveURL(/[?&]state=review/);
  await expect(row).toHaveCount(1);
  await group(page, "Verification").getByRole("button", { name: /^Verified/ }).click();
  await expect(page).toHaveURL(/[?&]state=verified/);
  await expect(row).toHaveCount(0);
  await expect(page.getByText("No results found")).toBeVisible(); // empty state with a way out
  await page.getByRole("button", { name: "Clear filters" }).click();
  await expect(row).toHaveCount(1);
  // a link with the filter already set opens the filtered list
  await gotoReady(page, "/admin/offices?agreement=none");
  await expect(page.getByTestId(`rdq-office-row-${off.id}`)).toHaveCount(1);
  await expect(page.getByLabel("Agreement")).toHaveValue("none");
  await page.getByRole("textbox", { name: "Search office, contact, phone or CR no." }).fill(off.name);
  await page.getByTestId(`rdq-office-open-${off.id}`).click();
  await expect(page).toHaveURL(new RegExp(`/admin/offices/${off.id}$`));
});

test("office view: header, tabs, readiness; verification needs approved documents, then the agreement completes it", async ({ page }) => {
  test.setTimeout(150_000);
  await admin(page);
  await gotoReady(page, `/admin/offices/${off.id}`);
  await expect(page.getByRole("heading", { level: 1, name: off.name })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Breadcrumb" })).toContainText("Courier offices");
  await expect(header(page)).toContainText("Pending");
  for (const name of ["Overview", "Drivers", "Jobs & payouts", "Agreement", "Documents"]) await expect(tabs(page).getByRole("link", { name })).toBeVisible();
  await expect(tabs(page).getByRole("link", { name: "Overview" })).toHaveAttribute("aria-current", "page");
  await expect(page.getByText("Not ready to receive jobs yet")).toBeVisible();
  await expect(page.getByText("The office is not verified yet.")).toBeVisible();
  await expect(page.getByText("No agreement has been sent to the office.")).toBeVisible();
  await expect(page.getByTestId("rdq-office-checklist")).toContainText("0/2");

  // verifying without approved documents is refused, with the documents named in the user's language
  await page.getByTestId("rdq-office-verify").click();
  await expect(page.getByText(/Required documents are not approved yet: Commercial registration, Office license/)).toBeVisible();
  await expect(header(page)).toContainText("Pending");

  // request info needs a note
  await page.getByTestId("rdq-office-request_info").click();
  await expect(dialog(page).getByRole("button", { name: "Request info", exact: true })).toBeDisabled();
  await confirm(page, "request info", "Note to the user", "Please upload the office licence", "Request info");
  await expect(header(page)).toContainText("Info requested");
  await expect(page.getByText("Please upload the office licence")).toBeVisible(); // the note stays visible on the overview

  // the office uploads both required documents, staff approves them (documents tab shows the state), then verification works
  for (const type of ["office_cr", "office_license"]) expect((await off.ctx!.request.post(`${BASE}/api/v1/documents`, { multipart: { type, file: { name: `${type}.png`, mimeType: "image/png", buffer: PNG } }, headers: { origin: BASE } })).status()).toBe(201);
  await tabs(page).getByRole("link", { name: "Documents" }).click();
  await expect(page).toHaveURL(/\/documents$/);
  await expect(page.getByTestId("rdq-doc-office_cr")).toContainText("Submitted");
  await expect(page.getByTestId("rdq-doc-other")).toContainText("Not uploaded"); // optional types are listed too
  const docs = (await api(page.request, "GET", `/admin/documents?ownerId=${off.id}&kind=office`)).json.items as Array<{ id: string }>;
  expect(docs).toHaveLength(2);
  for (const d of docs) expect((await api(page.request, "POST", `/admin/documents/${d.id}/review`, { decision: "approved" })).status).toBe(200);
  await page.reload();
  await expect(page.getByTestId("rdq-doc-office_cr")).toContainText("Approved");
  await expect(page.getByTestId("rdq-doc-office_license")).toContainText("Approved");
  await expect(page.getByTestId("rdq-doc-view-office_cr")).toHaveAttribute("href", /\/api\/v1\/documents\/.+\/file/);
  await tabs(page).getByRole("link", { name: "Overview" }).click();
  await page.getByTestId("rdq-office-verify").click();
  await expect(page.getByText("Saved").first()).toBeVisible();
  await expect(header(page)).toContainText("Verified");
  await expect(page.getByTestId("rdq-office-verify")).toHaveCount(0); // nothing left to verify
  await expect(page.getByTestId("rdq-office-checklist")).toContainText("2/2");

  // send the agreement from the header: it is pending until the office accepts it
  await page.getByTestId("rdq-office-send-agreement").click();
  await dialog(page).getByTestId("rdq-agreement-terms").fill("Standard courier terms, 2026");
  await dialog(page).getByTestId("rdq-agreement-send").click();
  await expect(page.getByText("Saved").first()).toBeVisible();
  await expect(dialog(page)).toBeHidden();
  await expect(header(page)).toContainText("Awaiting acceptance");
  await tabs(page).getByRole("link", { name: "Agreement" }).click();
  await expect(page).toHaveURL(/\/agreements$/);
  const v1 = page.getByTestId("rdq-agreement-1");
  await expect(v1).toContainText("Agreement v1"); await expect(v1).toContainText("Awaiting acceptance");
  await v1.getByText("Show terms").click();
  await expect(v1).toContainText("Standard courier terms, 2026");
  const mine = (await api(off.ctx!.request, "GET", "/office/agreements")).json.items as Array<{ id: string }>;
  expect((await api(off.ctx!.request, "POST", `/office/agreements/${mine[0].id}/accept`)).status).toBe(200);
  await page.reload();
  await expect(page.getByTestId("rdq-agreement-1")).toContainText("Accepted");
  await tabs(page).getByRole("link", { name: "Overview" }).click();
  await expect(page.getByText("Ready to receive jobs")).toBeVisible();
  const s = (await api(page.request, "GET", "/admin/offices/summary")).json;
  expect(s).toMatchObject({ review: before.review, verified: before.verified + 1 });
});

test("office view: suspending the account asks for a reason and can be undone; the jobs tab and drivers tab show empty states with a next step", async ({ page }) => {
  await admin(page);
  await gotoReady(page, `/admin/offices/${off.id}`);
  await page.getByTestId("rdq-office-suspend-account").click();
  await expect(dialog(page).getByRole("button", { name: "Suspend", exact: true })).toBeDisabled();
  await confirm(page, "suspend", "Reason", "Licence under review", "Suspend");
  await expect(header(page)).toContainText("Suspended");
  await expect(page.getByText("The account is suspended.")).toBeVisible();
  await expect(page.getByTestId("rdq-office-activate-account")).toBeVisible();
  await page.getByTestId("rdq-office-activate-account").click();
  await confirm(page, "activate", "Reason", "Review finished", "Activate");
  await expect(header(page)).toContainText("Active");
  await tabs(page).getByRole("link", { name: "Drivers" }).click();
  await expect(page.getByText("No drivers yet")).toBeVisible();
  await tabs(page).getByRole("link", { name: "Jobs & payouts" }).click();
  await expect(page.getByText("No jobs yet")).toBeVisible();
  await expect(page.getByText("No settlements yet")).toBeVisible();
  const log = (await api(page.request, "GET", `/admin/audit?entity=user&pageSize=20`)).json.items as Array<{ action: string; entityId: string }>;
  expect(log.filter((l) => l.entityId === off.id).map((l) => l.action)).toEqual(expect.arrayContaining(["user.suspended", "user.active", "account.verify"]));
});

test("the demo office lists its drivers with the unlink action behind a confirmation; staff without office permissions see no actions or money", async ({ page, browser }) => {
  await admin(page);
  const demo = (await api(page.request, "GET", "/admin/offices?q=Al%20Wajiha")).json.items[0] as { id: string };
  expect(demo).toBeTruthy();
  await gotoReady(page, `/admin/offices/${demo.id}/drivers`);
  await expect(page.getByRole("heading", { level: 1, name: "Al Wajiha Courier Office" })).toBeVisible();
  await expect(tabs(page).getByRole("link", { name: /^Drivers/ })).toHaveAttribute("aria-current", "page");
  await expect(page.getByRole("link", { name: "Tariq Mahmood" })).toHaveAttribute("href", /\/admin\/drivers\/.+/);
  const unlink = page.getByRole("button", { name: "Unlink" }).first();
  await unlink.click();
  await expect(dialog(page)).toContainText("Their earnings will be paid directly to them.");
  await dialog(page).getByRole("button", { name: "Cancel" }).click();
  await expect(dialog(page)).toBeHidden();
  await gotoReady(page, `/admin/offices/${demo.id}`);
  await expect(page.getByText("Payouts due")).toBeVisible();
  await expect(page.getByText("Wallet balance")).toBeVisible();

  // the operations preset can look (users.view, documents.review) but not act, and sees no payout / wallet figures or agreements
  const ctx = await browser.newContext(); const ops = await ctx.newPage();
  await staffLogin(ops, "ops@jrlogistics.demo", DEMO.staffPw);
  await gotoReady(ops, `/admin/offices/${demo.id}`);
  await expect(ops.getByRole("heading", { level: 1, name: "Al Wajiha Courier Office" })).toBeVisible();
  for (const id of ["rdq-office-verify", "rdq-office-reject", "rdq-office-send-agreement", "rdq-office-suspend-account"]) await expect(ops.getByTestId(id), id).toHaveCount(0);
  await expect(ops.getByText("Payouts due")).toHaveCount(0);
  await expect(ops.getByText("Wallet balance")).toHaveCount(0);
  await expect(tabs(ops).getByRole("link", { name: "Agreement" })).toHaveCount(0);
  await expect(tabs(ops).getByRole("link", { name: "Documents" })).toBeVisible();
  expect((await api(ops.request, "GET", `/admin/offices/${demo.id}/settlements`)).status).toBe(403);
  await ctx.close();
});

test("drivers: KPI tiles and filters in the URL, the driver view with its tabs, strikes and jobs", async ({ page }) => {
  await admin(page);
  await gotoReady(page, "/admin/drivers");
  await expect(page.getByRole("heading", { level: 1, name: "Drivers" })).toBeVisible();
  for (const [name, href] of [[/^Available now/, "/admin/drivers?state=available"], [/^Awaiting verification/, "/admin/drivers?state=pending"], [/^Suspended/, "/admin/drivers?state=suspended"]] as const) {
    await expect(kpis(page).getByRole("link", { name }), String(name)).toHaveAttribute("href", href);
  }
  const sum = (await api(page.request, "GET", "/admin/drivers-summary")).json;
  await expect(kpis(page).getByRole("link", { name: /^Available now/ })).toContainText(String(sum.available));
  await group(page, "Status").getByRole("button", { name: /^Available/ }).click();
  await expect(page).toHaveURL(/[?&]state=available/);
  await page.getByLabel("Courier office", { exact: true }).selectOption("direct");
  await expect(page).toHaveURL(/[?&]link=direct/);
  await expect(page.getByRole("link", { name: "Tariq Mahmood" })).toHaveCount(0); // Tariq works through the demo office
  await page.getByRole("textbox", { name: "Search name or phone" }).fill("Nasser");
  const link = page.locator('a[href^="/admin/drivers/"]', { hasText: "Nasser Alshammari" }).first();
  await expect(link).toBeVisible();
  await link.click();
  await expect(page).toHaveURL(/\/admin\/drivers\/[0-9a-f-]{36}$/);
  await expect(page.getByRole("heading", { level: 1, name: "Nasser Alshammari" })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Breadcrumb" })).toContainText("Drivers");
  await expect(page.getByRole("navigation", { name: "Driver sections" }).getByRole("link", { name: "Wallet & cash" })).toBeVisible();
  await expect(page.locator("#rdq-driver-strikes")).toContainText("Strikes & suspension");
  await expect(page.locator("#rdq-driver-strikes")).toContainText("Within limits");
  await expect(page.getByRole("button", { name: "Unlink from office" })).toHaveCount(0); // a direct driver has nothing to unlink
  await page.getByRole("navigation", { name: "Driver sections" }).getByRole("link", { name: "Jobs" }).click();
  await expect(page).toHaveURL(/\/jobs$/);
  await expect(group(page, "Jobs")).toBeVisible();
  await group(page, "Jobs").getByRole("button", { name: "Completed" }).click();
  await page.getByRole("navigation", { name: "Driver sections" }).getByRole("link", { name: "Wallet & cash" }).click();
  await expect(page.getByText("Cash with the driver")).toBeVisible();
  await expect(page.getByText("Earnings pending")).toBeVisible();
  // an office driver links back to the office
  const tariq = (await api(page.request, "GET", "/admin/drivers-list?q=Tariq")).json.items[0] as { id: string; officeId: string };
  await gotoReady(page, `/admin/drivers/${tariq.id}`);
  await expect(page.getByRole("link", { name: "Al Wajiha Courier Office" }).first()).toHaveAttribute("href", `/admin/offices/${tariq.officeId}`);
  await expect(page.getByRole("button", { name: "Unlink from office" })).toBeVisible();
});

test("users: role KPI tiles and filters in the URL; business / office / driver rows open their own view", async ({ page }) => {
  await admin(page);
  await gotoReady(page, "/admin/users");
  await expect(page.getByRole("heading", { level: 1, name: "Users" })).toBeVisible();
  for (const [name, href] of [[/^Businesses/, "/admin/users?role=business"], [/^Drivers/, "/admin/users?role=driver"], [/^Courier offices/, "/admin/users?role=office"], [/^Staff/, "/admin/users?role=staff"]] as const) {
    await expect(kpis(page).getByRole("link", { name }), String(name)).toHaveAttribute("href", href);
  }
  await group(page, "Role").getByRole("button", { name: /^Courier offices/ }).click();
  await expect(page).toHaveURL(/[?&]role=office/);
  const row = page.getByTestId(`rdq-user-row-${off.id}`);
  await page.getByRole("textbox", { name: "Search name, phone or email" }).fill("Views Contact");
  await expect(row).toHaveCount(1);
  await expect(row.getByRole("link", { name: "Views Contact", exact: true })).toHaveAttribute("href", `/admin/offices/${off.id}`);
  await page.getByLabel("Status", { exact: true }).selectOption("suspended");
  await expect(page).toHaveURL(/[?&]status=suspended/);
  await expect(row).toHaveCount(0);
  await gotoReady(page, "/admin/users?role=driver");
  const first = page.locator("[data-testid^='rdq-user-row-']").first();
  await expect(first.getByRole("link").first()).toHaveAttribute("href", /\/admin\/drivers\/[0-9a-f-]{36}$/);
  await gotoReady(page, "/admin/users?role=business");
  const biz = page.locator("[data-testid^='foa-wh-badge-']").first().locator("xpath=ancestor::a[1]");
  await expect(biz).toHaveAttribute("href", /\/admin\/companies\/[0-9a-f-]{36}$/);
  await expect(page.locator("[data-testid^='rdq-user-row-']").first().getByRole("link").first()).toHaveAttribute("href", /\/admin\/companies\/[0-9a-f-]{36}$/);
});

test("old links keep working and phones do not overflow: deep links, 404 for unknown ids, no horizontal scroll at 390 px", async ({ page }) => {
  await admin(page);
  await gotoReady(page, "/admin/offices?state=review&agreement=none");
  await expect(group(page, "Verification").getByRole("button", { name: /^Awaiting review/ })).toHaveAttribute("aria-pressed", "true");
  await gotoReady(page, "/admin/offices/00000000-0000-4000-8000-000000000000");
  await expect(page.getByText("We couldn't find what you were looking for.")).toBeVisible();
  await gotoReady(page, "/admin/drivers/not-a-uuid");
  await expect(page.getByText("We couldn't find what you were looking for.")).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  for (const path of ["/admin/offices", `/admin/offices/${off.id}`, `/admin/offices/${off.id}/agreements`, `/admin/offices/${off.id}/documents`, "/admin/drivers", "/admin/users"]) {
    await gotoReady(page, path);
    await expect(page.getByRole("heading", { level: 1 }).first()).toBeVisible();
    expect(await noSideways(page), path).toBe(true);
  }
  await off.ctx?.close();
});
