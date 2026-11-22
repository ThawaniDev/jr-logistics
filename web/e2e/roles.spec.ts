import { test, expect, type APIRequestContext, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { staffLogin, gotoReady } from "./helpers";

/**
 * Roles & permissions (J8): create a role in the editor, tick permissions (dependencies come along, with a note), assign it to a staff member,
 * sign in as him and see exactly those pages, edit the role and see the sidebar change, the matrix and its CSV, reset a system role, delete a role
 * that has members, a read-only viewer, 390 px and Arabic. Specs share one database: every name is unique to this run.
 */
test.describe.configure({ mode: "serial" });
const BASE = `http://localhost:${process.env.E2E_PORT ?? 3101}`; // not 3100: other projects on this machine use it
const ADMIN = { email: "admin@jrlogistics.test", password: "E2e!Password2026" };
const tag = Date.now().toString().slice(-6);
const roleName = `E2E Desk ${tag}`;
const roleKey = `e2e_desk_${tag}`;
const person = { id: "", name: `Role Holder ${tag}`, email: `roleholder${tag}@jrlogistics.demo`, ctx: null as BrowserContext | null, page: null as Page | null };

const admin = (page: Page) => staffLogin(page, ADMIN.email, ADMIN.password);
const nav = (page: Page) => page.getByRole("navigation", { name: "Main navigation" }).first();
async function api(ctx: APIRequestContext, method: "GET" | "POST" | "PATCH" | "DELETE", path: string, data?: unknown) {
  const res = await ctx.fetch(`${BASE}/api/v1${path}`, { method, data, headers: { origin: BASE, "content-type": "application/json" } });
  return { status: res.status(), json: await res.json().catch(() => null) };
}
/** The pages of the sidebar (sorted), polled: the links appear a moment after hydration. */
const expectNav = (page: Page, expected: string[]) => expect.poll(() => nav(page).locator("a").evaluateAll((els) => els.map((a) => a.getAttribute("href")!).sort()), { timeout: 15_000 }).toEqual(expected);
const noSideways = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
/** A signed-in back-office context for a staff account created through the API (its temporary password is replaced first). */
async function staffContext(browser: Browser, email: string, first = "Temp0rary!Pass1") {
  const next = "Brand-New-Pass9x"; const ctx = await browser.newContext();
  const post = (path: string, data: unknown) => ctx.request.fetch(`${BASE}/api/v1${path}`, { method: "POST", data, headers: { origin: BASE, "content-type": "application/json" } });
  expect((await post("/auth/staff/login", { email, password: first })).status()).toBe(200);
  expect((await post("/auth/change-password", { currentPassword: first, newPassword: next })).status()).toBe(200);
  expect((await post("/auth/staff/login", { email, password: next })).status()).toBe(200);
  return ctx;
}

test("create a role: dependencies come along with a note, search and 'only selected' narrow the matrix, Save creates it", async ({ page }) => {
  await admin(page);
  await gotoReady(page, "/admin/roles");
  await expect(page.getByRole("heading", { level: 1, name: "Roles & permissions" })).toBeVisible();
  for (const k of ["support", "operations", "finance", "hr_verification", "account_manager", "reports"]) await expect(page.getByTestId(`rj-role-${k}`)).toBeVisible();
  await expect(nav(page).locator('a[href="/admin/roles"]')).toHaveAttribute("aria-current", "page");

  await page.getByTestId("rj-create").click();
  await page.getByTestId("rj-create-name").fill(roleName);
  await page.getByTestId("rj-create-desc").fill("Front desk for the e2e run");
  await page.getByTestId("rj-create-continue").click();
  await expect(page).toHaveURL(/role=new/);
  await expect(page.getByTestId("rj-editor-title")).toHaveText(roleName);
  await expect(page.getByTestId("rj-save")).toBeDisabled(); // nothing chosen yet

  // ticking "Export data" brings "View reports" and says so; unticking "View reports" takes "Export data" with it
  await page.getByTestId("rj-perm-reports.export").check();
  await expect(page.getByTestId("rj-perm-reports.view")).toBeChecked();
  await expect(page.getByTestId("rj-dep-note")).toContainText("Also added: View reports");
  await page.getByTestId("rj-perm-reports.view").uncheck();
  await expect(page.getByTestId("rj-perm-reports.export")).not.toBeChecked();
  await expect(page.getByTestId("rj-dep-note")).toContainText("Also removed: Export data");

  await page.getByTestId("rj-perm-tickets.view").check();
  await page.getByTestId("rj-perm-audit.view").check();
  await expect(page.getByTestId("rj-selected-count")).toContainText("2 of 42 selected");
  await expect(page.getByTestId("rj-perm-audit.view")).toBeVisible();
  // sensitive permissions are marked
  await expect(page.getByTestId("rj-group-admin")).toContainText("Sensitive");

  await page.getByTestId("rj-search").fill("audit");
  await expect(page.getByTestId("rj-perm-audit.view")).toBeVisible();
  await expect(page.getByTestId("rj-perm-tickets.view")).toHaveCount(0);
  await page.getByTestId("rj-search").fill("");
  await page.getByTestId("rj-only-selected").check();
  await expect(page.locator('[data-testid^="rj-perm-"]')).toHaveCount(2);
  await page.getByTestId("rj-only-selected").uncheck();
  // "select all" of a group
  await page.getByTestId("rj-group-all-integrations").click();
  await expect(page.getByTestId("rj-perm-integrations.manage")).toBeChecked();
  await expect(page.getByTestId("rj-perm-integrations.view")).toBeChecked();
  await page.getByTestId("rj-group-all-integrations").click();
  await expect(page.getByTestId("rj-perm-integrations.view")).not.toBeChecked();

  await page.getByTestId("rj-save").click();
  await expect(page).toHaveURL(new RegExp(`role=${roleKey}`));
  await expect(page.getByTestId("rj-editor")).toHaveAttribute("data-role", roleKey);
  await expect(page.getByTestId(`rj-role-${roleKey}`)).toContainText("Custom");
  await expect(page.getByTestId("rj-members")).toContainText("Nobody holds this role yet");
  await expect(page.getByTestId("rj-bar-status")).toContainText("No unsaved changes");
  const saved = (await api(page.request, "GET", `/admin/roles/${roleKey}`)).json;
  expect(saved.permissions).toEqual(["tickets.view", "audit.view"]); expect(saved.description).toBe("Front desk for the e2e run");
});

test("assign it to a staff member on the Staff page; he signs in and sees exactly those pages", async ({ page, browser }) => {
  await admin(page);
  const made = await api(page.request, "POST", "/admin/staff", { name: person.name, email: person.email, password: "Temp0rary!Pass1", permissions: ["requests.view"] });
  expect(made.status, JSON.stringify(made.json)).toBe(201);
  person.id = made.json.id;
  await gotoReady(page, "/admin/staff");
  await page.getByRole("textbox", { name: "Search", exact: true }).fill(person.name);
  await page.getByTestId(`rdb-staff-edit-${person.id}`).click();
  // the role select lists system and custom roles with their permission counts; "Custom" shows the picker
  await expect(page.getByTestId("rdb-staff-perms")).toBeVisible();
  await expect(page.getByTestId("rdb-staff-preset").locator("option", { hasText: `${roleName} (2 permissions)` })).toHaveCount(1);
  await page.getByTestId("rdb-staff-preset").selectOption(roleKey);
  await expect(page.getByTestId("rj-staff-role-summary")).toContainText(roleName);
  await expect(page.getByTestId("rdb-staff-perms")).toHaveCount(0);
  await page.getByTestId("rdb-staff-save").click();
  await expect(page.getByTestId("rdb-staff-save")).toHaveCount(0);
  await expect(page.getByTestId(`rdb-staff-row-${person.id}`)).toContainText(roleName);
  await expect(page.getByTestId(`rdb-staff-row-${person.id}`)).toContainText("2"); // permissions column
  // filter by role
  await page.getByRole("textbox", { name: "Search", exact: true }).fill("");
  await page.getByTestId("rj-staff-role-filter").selectOption(roleKey);
  await expect(page).toHaveURL(new RegExp(`role=${roleKey}`));
  await expect(page.locator('[data-testid^="rdb-staff-row-"]')).toHaveCount(1);
  // the role page lists him as a member, and the staff page links to the role
  await page.getByTestId(`rj-staff-role-${roleKey}`).click();
  await expect(page).toHaveURL(new RegExp(`/admin/roles\\?role=${roleKey}`));
  await expect(page.getByTestId(`rj-member-${person.id}`)).toContainText(person.name);

  // he signs in and sees exactly the pages of the role (plus the two every back-office person has)
  person.ctx = await staffContext(browser, person.email);
  person.page = await person.ctx.newPage();
  await gotoReady(person.page, "/admin/cases");
  await expectNav(person.page, ["/admin/audit", "/admin/cases", "/admin/notifications"]);
  expect((await api(person.page.request, "GET", "/admin/audit?pageSize=1")).status).toBe(200);
  expect((await api(person.page.request, "GET", "/admin/pricing")).status).toBe(403);
  expect((await api(person.page.request, "GET", "/admin/roles")).status).toBe(403);
});

test("editing the role changes his access at once and his sidebar after a reload; the unsaved bar shows the diff", async ({ page }) => {
  await admin(page);
  await gotoReady(page, `/admin/roles?role=${roleKey}`);
  await expect(page.getByTestId("rj-editor")).toHaveAttribute("data-role", roleKey);
  await page.getByTestId("rj-name").fill(`${roleName} v2`);
  await page.getByTestId("rj-perm-audit.view").uncheck();
  await page.getByTestId("rj-perm-pricing.view").check();
  await expect(page.getByTestId("rj-bar-status")).toContainText("3 unsaved changes");
  await page.getByTestId("rj-bar-details").click();
  await expect(page.getByTestId("rj-bar-diff")).toContainText("View audit log");
  await expect(page.getByTestId("rj-bar-diff")).toContainText("View pricing");
  await expect(page.getByTestId("rj-bar-diff")).toContainText("Name changed");
  // leaving with unsaved changes asks first
  await page.getByTestId("rj-role-support").click();
  await expect(page.getByRole("dialog")).toContainText("Leave without saving?");
  await page.getByRole("button", { name: "Cancel" }).click();
  await expect(page.getByTestId("rj-editor")).toHaveAttribute("data-role", roleKey);
  await page.getByTestId("rj-save").click();
  await expect(page.getByTestId("rj-bar-status")).toContainText("No unsaved changes");
  await expect(page.getByTestId("rj-editor-title")).toHaveText(`${roleName} v2`);
  expect((await api(page.request, "GET", `/admin/roles/${roleKey}`)).json).toMatchObject({ name: `${roleName} v2`, key: roleKey, permissions: ["tickets.view", "pricing.view"], memberCount: 1 });

  const him = person.page!;
  expect((await api(him.request, "GET", "/admin/audit?pageSize=1")).status).toBe(403); // the same session, the very next request
  expect((await api(him.request, "GET", "/admin/pricing")).status).toBe(200);
  await him.reload(); await him.waitForSelector('html[data-hydrated="true"]');
  await expectNav(him, ["/admin/cases", "/admin/finance/pricing", "/admin/notifications"]);
});

test("the matrix lists every role and permission, filters, and exports a CSV", async ({ page }) => {
  await admin(page);
  await gotoReady(page, "/admin/roles?view=matrix");
  await expect(page.getByTestId("rj-matrix")).toBeVisible();
  await expect(page.getByRole("columnheader", { name: `${roleName} v2` })).toBeVisible();
  await expect(page.getByTestId(`rj-cell-${roleKey}-tickets.view`)).toHaveAttribute("data-has", "1");
  await expect(page.getByTestId(`rj-cell-${roleKey}-audit.view`)).toHaveAttribute("data-has", "0");
  await expect(page.getByTestId("rj-cell-finance-payouts.execute")).toHaveAttribute("data-has", "1");
  await page.getByTestId("rj-matrix-sensitive").check();
  await expect(page.getByTestId("rj-matrix-row-payouts.execute")).toBeVisible();
  await expect(page.getByTestId("rj-matrix-row-users.view")).toHaveCount(0);
  await page.getByTestId("rj-matrix-sensitive").uncheck();
  await page.getByTestId("rj-matrix-search").fill("pricing");
  await expect(page.locator('[data-testid^="rj-matrix-row-"]')).toHaveCount(2);
  await page.getByTestId("rj-matrix-search").fill("");
  const [download] = await Promise.all([page.waitForEvent("download"), page.getByTestId("rj-export").click()]);
  expect(download.suggestedFilename()).toBe("roles-matrix.csv");
  const csv = (await (await import("node:fs/promises")).readFile((await download.path())!, "utf8"));
  expect(csv.charCodeAt(0)).toBe(0xfeff);
  const lines = csv.slice(1).split("\n");
  expect(lines[0]).toContain(`${roleName} v2`); expect(lines[0].startsWith("Group,Permission,Key,")).toBe(true);
  expect(lines).toHaveLength(43);
  expect(lines.find((l) => l.includes(",tickets.view,"))).toMatch(/,tickets\.view,[01],[01],[01],[01],[01],[01],[01]$/); // 7 roles: the six system roles and this run's role
  // the view is in the URL, and switching back keeps the role
  await page.getByRole("button", { name: "Roles", exact: true }).click();
  await expect(page).not.toHaveURL(/view=matrix/);
});

test("a system role can be changed and reset to its factory permissions; Duplicate starts from a copy", async ({ page }) => {
  await admin(page);
  await gotoReady(page, "/admin/roles?role=account_manager");
  await expect(page.getByTestId("rj-editor")).toHaveAttribute("data-role", "account_manager");
  await expect(page.getByTestId("rj-editor-title")).toHaveText("Account manager");
  await expect(page.getByTestId("rj-name")).toHaveCount(0); // system roles keep their name
  await expect(page.getByTestId("rj-delete")).toHaveCount(0);
  await expect(page.getByTestId("rj-reset")).toBeDisabled();
  await page.getByTestId("rj-perm-audit.view").check();
  await page.getByTestId("rj-save").click();
  await expect(page.getByTestId("rj-bar-status")).toContainText("No unsaved changes");
  await expect(page.getByTestId("rj-role-account_manager")).toContainText("Modified");
  await page.getByTestId("rj-reset").click();
  await expect(page.getByRole("dialog")).toContainText("1 removed");
  await page.getByTestId("rj-reset-confirm").click();
  await expect(page.getByTestId("rj-role-account_manager")).not.toContainText("Modified");
  await expect(page.getByTestId("rj-perm-audit.view")).not.toBeChecked();

  // duplicate: a dialog with the source and a name, then the editor with the copied permissions (nothing is saved until Create)
  await page.getByTestId("rj-duplicate").click();
  await expect(page.getByTestId("rj-create-from")).toHaveValue("account_manager");
  await expect(page.getByTestId("rj-create-name")).toHaveValue("Account manager (copy)");
  await page.getByTestId("rj-create-name").fill(`E2E Copy ${tag}`);
  await page.getByTestId("rj-create-continue").click();
  await expect(page.getByTestId("rj-selected-count")).toContainText("6 of 42 selected");
  await expect(page.getByTestId("rj-perm-pricing.view")).toBeChecked();
  await page.getByTestId("rj-discard").click(); // abandon the draft
  await expect(page.getByTestId("rj-editor")).not.toHaveAttribute("data-role", "new");
  expect((await api(page.request, "GET", "/admin/roles")).json.items.some((r: { name: string }) => r.name === `E2E Copy ${tag}`)).toBe(false);
});

test("deleting a role with members asks where they go; 'no role' keeps their permissions", async ({ page }) => {
  await admin(page);
  await gotoReady(page, `/admin/roles?role=${roleKey}`);
  await page.getByTestId("rj-delete").click();
  await expect(page.getByRole("dialog")).toContainText("1 staff members hold this role");
  await expect(page.getByTestId("rj-delete-confirm")).toBeDisabled();
  await page.getByTestId("rj-delete-to").selectOption("custom");
  await page.getByTestId("rj-delete-confirm").click();
  await expect(page.getByTestId(`rj-role-${roleKey}`)).toHaveCount(0);
  const row = (await api(page.request, "GET", "/admin/staff")).json.items.find((s: { id: string }) => s.id === person.id);
  expect(row.staffRole).toBeNull(); expect([...row.permissions].sort()).toEqual(["pricing.view", "tickets.view"]);
  expect((await api(page.request, "GET", `/admin/roles/${roleKey}`)).status).toBe(404);
  await person.ctx?.close();
});

test("a viewer with staff.view can read roles and the matrix but not change anything", async ({ page, browser }) => {
  await admin(page);
  const email = `roleviewer${tag}@jrlogistics.demo`;
  expect((await api(page.request, "POST", "/admin/staff", { name: `Role Viewer ${tag}`, email, password: "Temp0rary!Pass1", permissions: ["staff.view"] })).status).toBe(201);
  const ctx = await staffContext(browser, email); const v = await ctx.newPage();
  await gotoReady(v, "/admin/roles");
  await expect(nav(v).locator('a[href="/admin/roles"]')).toBeVisible();
  await expect(v.getByTestId("rj-role-support")).toBeVisible();
  await expect(v.getByTestId("rj-create")).toHaveCount(0);
  await expect(v.getByTestId("rj-bar")).toHaveCount(0);
  await expect(v.getByTestId("rj-duplicate")).toHaveCount(0);
  await expect(v.getByTestId("rj-perm-tickets.view")).toBeDisabled();
  await expect(v.getByText("You can look at roles but not change them.")).toBeVisible();
  await gotoReady(v, "/admin/roles?view=matrix");
  await expect(v.getByTestId("rj-matrix")).toBeVisible();
  expect((await api(v.request, "POST", "/admin/roles", { name: "Sneaky role", permissions: ["audit.view"] })).status).toBe(403);
  await ctx.close();
});

test("phones stack the page without sideways scrolling, and Arabic mirrors it", async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } }); const p = await ctx.newPage();
  await admin(p);
  await gotoReady(p, "/admin/roles?role=operations");
  await expect(p.getByTestId("rj-editor")).toBeVisible();
  expect(await noSideways(p)).toBe(true);
  await gotoReady(p, "/admin/roles?view=matrix");
  await expect(p.getByTestId("rj-matrix")).toBeVisible();
  expect(await noSideways(p)).toBe(true); // the matrix scrolls inside its own frame
  await p.getByTestId("rj-matrix-search").fill("zzzz");
  await expect(p.getByText("No permissions match")).toBeVisible();
  await ctx.close();

  const ar = await browser.newContext({ viewport: { width: 1360, height: 900 } });
  await ar.addCookies([{ name: "jr_lang", value: "ar", url: BASE }]);
  const a = await ar.newPage();
  await admin(a);
  await gotoReady(a, "/admin/roles?role=finance");
  await expect(a.locator("html")).toHaveAttribute("dir", "rtl");
  await expect(a.getByRole("heading", { level: 1, name: "الأدوار والصلاحيات" })).toBeVisible();
  await expect(a.getByTestId("rj-perm-payouts.execute")).toBeChecked();
  await expect(a.getByTestId("rj-group-finance")).toContainText("حساسة");
  expect(await noSideways(a)).toBe(true);
  await ar.close();
});
