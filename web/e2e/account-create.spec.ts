import { test, expect, type APIRequestContext, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { staffLogin, gotoReady, apiLogin, uiSignIn, rememberLogin } from "./helpers";

/**
 * Admin-side creation and editing of accounts (decision G1): the "Add …" buttons, the chooser, the three forms (live duplicate check, inline problems,
 * verified-at-creation needing a reason, office affiliation, create-and-add-another), the edit pages (diff-aware save, phone change signs the person out),
 * permissions, 390 px and Arabic, and how the person signs in (username + temporary password shown once, must be replaced at the first sign-in; staff rename / reset
 * from the Security tab). Specs share one database: every account is unique to this run, counters are judged against a baseline.
 */
test.describe.configure({ mode: "serial" });
const BASE = `http://localhost:${process.env.E2E_PORT ?? 3101}`; // not 3100: other projects on this machine use it
const ADMIN = { email: "admin@jrlogistics.test", password: "E2e!Password2026" };
const STAMP = Date.now().toString();
/** A Saudi mobile number that is unique to this run (offset keeps the specs' numbers apart). */
const phoneN = (n: number) => `05${String((Number(STAMP.slice(-8)) + 40_000_000 + n * 7) % 100_000_000).padStart(8, "0")}`;
const intl = (p: string) => `+966${p.slice(1)}`;
const tag = STAMP.slice(-6);
const co = { id: "", name: `Create Co ${tag}`, phone: phoneN(1), contact: `Create Owner ${tag}`, username: `create.co.${tag}`, password: "" };
const off = { id: "", name: `Create Office ${tag}`, phone: phoneN(2) };
const drv = { id: "", name: `Create Driver ${tag}`, phone: phoneN(3), username: "", password: "" };
const more = { name: `Create Another ${tag}`, phone: phoneN(4) };
const sup = { ctx: null as BrowserContext | null };

const admin = (page: Page) => staffLogin(page, ADMIN.email, ADMIN.password);
async function api(ctx: APIRequestContext, method: "GET" | "POST" | "PATCH", path: string, data?: unknown) {
  const res = await ctx.fetch(`${BASE}/api/v1${path}`, { method, data, headers: { origin: BASE, "content-type": "application/json" } });
  return { status: res.status(), json: await res.json().catch(() => null) };
}
const noSideways = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
const idFromUrl = (page: Page) => page.url().split("?")[0].split("/").pop()!;
/** A back-office session for a staff preset: the temporary password is replaced through the API, so the browser context is ready to browse. */
async function staffContext(browser: Browser, page: Page, preset: string) {
  const email = `acr${STAMP}${preset}@jrlogistics.demo`; const first = "Temp0rary!Pass1", next = "Brand-New-Pass9x";
  const made = await api(page.request, "POST", "/admin/staff", { name: `Acr ${preset}`, email, password: first, staffRole: preset });
  expect(made.status, JSON.stringify(made.json)).toBe(201);
  const ctx = await browser.newContext();
  const post = (path: string, data: unknown) => ctx.request.fetch(`${BASE}/api/v1${path}`, { method: "POST", data, headers: { origin: BASE, "content-type": "application/json" } });
  expect((await post("/auth/staff/login", { email, password: first })).status()).toBe(200);
  expect((await post("/auth/change-password", { currentPassword: first, newPassword: next })).status()).toBe(200);
  expect((await post("/auth/staff/login", { email, password: next })).status()).toBe(200);
  return ctx;
}
const fillHolder = async (page: Page, name: string, phone: string, city: string) => {
  await page.getByTestId("acr-name").fill(name);
  await page.getByTestId("acr-phone").fill(phone);
  await page.getByTestId("acr-city").selectOption(city);
};

test("the list pages have an Add button and the chooser offers company, office, driver and staff", async ({ page }) => {
  await admin(page);
  for (const [path, testid, target] of [["/admin/companies", "acr-add-company", "/admin/companies/new"], ["/admin/offices", "acr-add-office", "/admin/offices/new"], ["/admin/drivers", "acr-add-driver", "/admin/drivers/new"], ["/admin/users", "acr-add-user", "/admin/users/new"]] as const) {
    await gotoReady(page, path);
    await page.getByTestId(testid).click();
    await expect(page).toHaveURL(new RegExp(`${target}$`));
  }
  await expect(page.getByRole("heading", { level: 1, name: "Add user" })).toBeVisible();
  await expect(page.getByTestId("acr-chooser").getByRole("link")).toHaveCount(4);
  for (const k of ["business", "office", "driver", "staff"]) await expect(page.getByTestId(`acr-choose-${k}`)).toBeVisible();
  await page.getByTestId("acr-choose-driver").click();
  await expect(page).toHaveURL(/\/admin\/drivers\/new$/);
  await gotoReady(page, "/admin/users/new");
  await page.getByTestId("acr-choose-staff").click(); // the existing staff form, opened straight away
  await expect(page).toHaveURL(/\/admin\/staff\?add=1/);
  await expect(page.getByRole("dialog", { name: "Add staff" })).toBeVisible();
  await gotoReady(page, "/admin/staff"); // the staff list keeps its own button
  await expect(page.getByTestId("rdb-staff-add")).toBeVisible();
});

test("a company is created through the form: live phone check, summary, pin; it lands on its view pending and the counters move by one", async ({ page }) => {
  await admin(page);
  const s0 = (await api(page.request, "GET", "/admin/companies/summary")).json;
  await gotoReady(page, "/admin/companies/new");
  await expect(page.getByRole("heading", { level: 1, name: "Add company" })).toBeVisible();
  await page.getByTestId("acr-submit").click(); // inline problems, nothing is sent
  await expect(page.getByTestId("acr-problems")).toBeVisible();
  await expect(page).toHaveURL(/\/admin\/companies\/new$/);
  await fillHolder(page, co.contact, co.phone, "riyadh");
  await expect(page.getByTestId("acr-phone-check")).toHaveAttribute("data-state", "free");
  await page.getByTestId("acr-username").fill(co.username); // the name the person signs in with, checked live
  await expect(page.getByTestId("acr-username-status")).toHaveText("Available");
  await page.getByTestId("acr-generate-password").click(); // a strong temporary password, shown once after saving
  co.password = await page.getByTestId("acr-password").inputValue();
  expect(co.password).toMatch(/^[A-Za-z0-9]{4}-[A-Za-z0-9]{4}-[A-Za-z0-9]{4}$/);
  await page.getByTestId("acr-email").fill(`create.${STAMP}@example.com`);
  await expect(page.getByTestId("acr-email-check")).toHaveAttribute("data-state", "free");
  await page.getByTestId("acr-companyName").fill(co.name);
  await page.getByTestId("acr-crNumber").fill("1010123456");
  await page.getByTestId("acr-paste").fill("24.7136, 46.6753"); // fills both boxes
  await expect(page.getByTestId("acr-lat")).toHaveValue("24.7136");
  await expect(page.getByTestId("acr-map-link")).toBeVisible();
  await expect(page.getByTestId("acr-summary")).toContainText(co.username);
  await expect(page.getByTestId("acr-summary")).toContainText("pending verification");
  await page.getByTestId("acr-submit").click();
  // the sign-in details are shown now and never again; the account is opened from there
  await expect(page.getByTestId("acr-created")).toBeVisible();
  await expect(page.getByTestId("acr-created-username")).toHaveText(co.username);
  await expect(page.getByTestId("acr-created-password")).toHaveText(co.password);
  await page.getByTestId("acr-open-created").click();
  await expect(page).toHaveURL(/\/admin\/companies\/[0-9a-f-]{36}$/);
  co.id = idFromUrl(page);
  rememberLogin(co.phone, co.username, co.password);
  await expect(page.getByRole("heading", { level: 1, name: co.name })).toBeVisible();
  const made = (await api(page.request, "GET", `/admin/accounts/${co.id}`)).json;
  expect(made).toMatchObject({ kind: "business", source: "admin", verificationStatus: "pending", fields: { companyName: co.name, lat: 24.7136, lng: 46.6753, crNumber: "1010123456" } });
  const s1 = (await api(page.request, "GET", "/admin/companies/summary")).json;
  expect(s1).toMatchObject({ total: s0.total + 1, pending: s0.pending + 1, noWarehouse: s0.noWarehouse }); // the pin was set, so it is not counted as missing
  const trail = (await api(page.request, "GET", "/admin/audit?action=account.create")).json.items;
  expect(trail.some((a: { entityId: string; actorRole: string }) => a.entityId === co.id && a.actorRole === "admin")).toBe(true);
});

test("the person signs in with the username and password shown at creation, must choose a new one first, and is then at home", async ({ browser }) => {
  const ctx = await browser.newContext(); const page = await ctx.newPage();
  await uiSignIn(page, co.username.toUpperCase(), co.password); // the username is not case-sensitive
  await expect(page).toHaveURL(/\/account\/change-password/);
  const me = await api(page.request, "GET", "/auth/me");
  expect(me.json.user).toMatchObject({ id: co.id, role: "business", name: co.contact, username: co.username, mustChangePassword: true });
  expect((await api(page.request, "GET", "/wallet")).json.error.code).toBe("PASSWORD_CHANGE_REQUIRED"); // the server holds everything else back
  await page.goto("/business");
  await expect(page).toHaveURL(/\/account\/change-password/);
  const chosen = "Chosen#By2027me";
  await page.getByTestId("cp-current").fill(co.password);
  await page.getByTestId("cp-new").fill(chosen);
  await page.getByTestId("cp-confirm").fill(chosen);
  await page.getByTestId("cp-submit").click();
  await expect(page).toHaveURL(/\/business$/);
  co.password = chosen; rememberLogin(co.phone, co.username, co.password);
  const after = await api(page.request, "GET", "/auth/me");
  expect(after.json.user.mustChangePassword).toBe(false); expect(after.json.profile.companyName).toBe(co.name);
  await ctx.close();
});

test("a phone number that is already used is caught live, names the account, and blocks the form", async ({ page }) => {
  await admin(page);
  await gotoReady(page, "/admin/companies/new");
  await fillHolder(page, "Dup Owner", co.phone, "riyadh");
  await page.getByTestId("acr-companyName").fill(`Dup Co ${tag}`);
  const check = page.getByTestId("acr-phone-check");
  await expect(check).toHaveAttribute("data-state", "taken");
  await expect(check).toContainText(co.contact);
  await expect(check.getByRole("link", { name: "Open account" })).toHaveAttribute("href", `/admin/companies/${co.id}`);
  await expect(page.getByTestId("acr-phone")).toHaveAttribute("aria-invalid", "true");
  await page.getByTestId("acr-submit").click();
  await expect(page).toHaveURL(/\/admin\/companies\/new$/);
  await page.getByTestId("acr-phone").fill(phoneN(9)); // a free number clears it
  await expect(check).toHaveAttribute("data-state", "free");
  await expect(page.getByTestId("acr-phone")).not.toHaveAttribute("aria-invalid", "true");
});

test("an office verified at creation needs a reason; bank details and the audit trail are kept", async ({ page }) => {
  await admin(page);
  await gotoReady(page, "/admin/offices/new");
  await fillHolder(page, "Office Owner", off.phone, "jeddah");
  await page.getByTestId("acr-companyName").fill(off.name);
  await page.getByTestId("acr-bankName").fill("Al Rajhi");
  await page.getByTestId("acr-iban").fill("sa03 8000 0000 6080 1016 7519");
  await page.getByTestId("acr-password").fill("Office#Typed2027"); // typed, not generated; the username is left empty
  await page.getByTestId("acr-verify-now").click();
  await expect(page.getByTestId("acr-verify-reason")).toBeVisible();
  await page.getByTestId("acr-submit").click();
  await expect(page.getByTestId("acr-verify-reason")).toHaveAttribute("aria-invalid", "true");
  await expect(page).toHaveURL(/\/admin\/offices\/new$/);
  await page.getByTestId("acr-verify-reason").fill("Known partner, documents seen in person");
  await expect(page.getByTestId("acr-summary")).toContainText("marked verified now");
  await page.getByTestId("acr-submit").click();
  await expect(page.getByTestId("acr-created-username")).toHaveText(`u966${off.phone.slice(1)}`); // the default: u + the digits of the phone
  await expect(page.getByTestId("acr-created-password")).toHaveText("Office#Typed2027");
  await page.getByTestId("acr-open-created").click();
  await expect(page).toHaveURL(/\/admin\/offices\/[0-9a-f-]{36}$/);
  off.id = idFromUrl(page);
  await expect(page.getByRole("heading", { level: 1, name: off.name })).toBeVisible();
  const made = (await api(page.request, "GET", `/admin/accounts/${off.id}`)).json;
  expect(made).toMatchObject({ kind: "office", verificationStatus: "verified", fields: { companyName: off.name, iban: "SA0380000000608010167519", bankName: "Al Rajhi" } });
  const trail = (await api(page.request, "GET", "/admin/audit?action=account.verify")).json.items;
  expect(trail.find((a: { entityId: string }) => a.entityId === off.id)?.diff).toMatchObject({ note: "Known partner, documents seen in person", via: "account.create" });
});

test("a driver is created with a temperature-controlled vehicle and placed in the office", async ({ page }) => {
  await admin(page);
  await gotoReady(page, "/admin/drivers/new");
  await fillHolder(page, drv.name, drv.phone, "riyadh");
  await page.getByTestId("acr-vehicleType").selectOption("van");
  await expect(page.getByTestId("acr-vehicleTemperature")).toBeVisible(); // only vans and dynas
  await page.getByTestId("acr-submit").click();
  await expect(page.getByTestId("acr-vehicleTemperature")).toHaveAttribute("aria-invalid", "true");
  await page.getByTestId("acr-vehicleTemperature").selectOption("cold");
  await page.getByTestId("acr-nationalId").fill("1087654321");
  await page.getByTestId("acr-vehiclePlate").fill("ABC 1234");
  await expect(page.getByTestId("acr-service-delivery_driver")).toHaveAttribute("aria-pressed", "true");
  await page.getByTestId("acr-service-car_with_driver").click();
  await expect(page.getByTestId("acr-service-car_with_driver")).toHaveAttribute("aria-pressed", "true");
  await page.getByTestId("acr-officeId").selectOption(off.id);
  await expect(page.getByTestId("acr-summary")).toContainText("joins the fleet");
  await page.getByTestId("acr-submit").click();
  // nothing typed: the server chose the username (u + digits) and generated the password, which is shown once
  drv.username = `u966${drv.phone.slice(1)}`;
  await expect(page.getByTestId("acr-created-username")).toHaveText(drv.username);
  drv.password = (await page.getByTestId("acr-created-password").textContent())!.trim();
  expect(drv.password).toMatch(/^[A-Za-z0-9]{4}-[A-Za-z0-9]{4}-[A-Za-z0-9]{4}$/);
  await page.getByTestId("acr-open-created").click();
  await expect(page).toHaveURL(/\/admin\/drivers\/[0-9a-f-]{36}$/);
  drv.id = idFromUrl(page);
  rememberLogin(drv.phone, drv.username, drv.password);
  await expect(page.getByRole("heading", { level: 1, name: drv.name })).toBeVisible();
  const o = (await api(page.request, "GET", `/admin/drivers/${drv.id}/overview`)).json;
  expect(o).toMatchObject({ officeId: off.id, vehicleType: "van", vehicleTemperature: "cold", verificationStatus: "pending", availability: "unavailable" });
  const trail = (await api(page.request, "GET", "/admin/audit?action=office.link_driver")).json.items;
  expect(trail.some((a: { entityId: string }) => a.entityId === drv.id)).toBe(true);
});

test("create and add another keeps the form open for the next account and links to the one just created", async ({ page }) => {
  await admin(page);
  await gotoReady(page, "/admin/drivers/new");
  await fillHolder(page, more.name, more.phone, "riyadh");
  await page.getByTestId("acr-vehicleType").selectOption("sedan");
  await page.getByTestId("acr-create-another").click();
  await expect(page.getByTestId("acr-created")).toBeVisible(); // the sign-in details come first …
  await expect(page.getByTestId("acr-created-password")).not.toBeEmpty();
  const openHref = (await page.getByTestId("acr-open-created").getAttribute("href"))!;
  expect(openHref).toMatch(/\/admin\/drivers\/[0-9a-f-]{36}$/);
  await page.getByTestId("acr-created-another").click(); // … then the form is ready for the next account
  await expect(page).toHaveURL(/\/admin\/drivers\/new$/);
  await expect(page.getByTestId("acr-name")).toHaveValue("");
  await expect(page.getByTestId("acr-city")).toHaveValue("riyadh"); // the city is kept for the next one
  await expect(page.getByTestId("acr-username")).toHaveValue(""); // credentials never carry over
  await page.goto(openHref);
  await expect(page.getByRole("heading", { level: 1, name: more.name })).toBeVisible();
});

test("editing: Edit sits in the header, Save stays off until something changes, only the change is saved", async ({ page }) => {
  await admin(page);
  await gotoReady(page, `/admin/companies/${co.id}`);
  await page.getByTestId("acr-edit-company").click();
  await expect(page).toHaveURL(new RegExp(`/admin/companies/${co.id}/edit$`));
  await expect(page.getByTestId("acr-edit-title")).toHaveText("Edit company");
  await expect(page.getByTestId("acr-companyName")).toHaveValue(co.name);
  await expect(page.getByTestId("acr-submit")).toBeDisabled();
  await page.getByTestId("acr-companyName").fill(`${co.name} Ltd`);
  await page.getByTestId("acr-industry").fill("Retail");
  await expect(page.getByTestId("acr-change-companyName")).toContainText(`${co.name} Ltd`);
  await expect(page.getByTestId("acr-change-industry")).toBeVisible();
  await expect(page.getByTestId("acr-changes")).not.toContainText("signed out"); // only a phone change warns about that
  await page.getByTestId("acr-reset").click(); // discard
  await expect(page.getByTestId("acr-companyName")).toHaveValue(co.name);
  await expect(page.getByTestId("acr-submit")).toBeDisabled();
  await page.getByTestId("acr-companyName").fill(`${co.name} Ltd`);
  await page.getByTestId("acr-submit").click();
  await expect(page).toHaveURL(new RegExp(`/admin/companies/${co.id}$`));
  await expect(page.getByRole("heading", { level: 1, name: `${co.name} Ltd` })).toBeVisible();
  const after = (await api(page.request, "GET", `/admin/accounts/${co.id}`)).json;
  expect(after.fields).toMatchObject({ companyName: `${co.name} Ltd`, industry: null, crNumber: "1010123456" });
  const trail = (await api(page.request, "GET", "/admin/audit?action=account.update")).json.items;
  expect(trail.find((a: { entityId: string }) => a.entityId === co.id)?.diff.changes).toMatchObject({ companyName: { from: co.name, to: `${co.name} Ltd` } });
});

test("changing the phone number warns, audits old and new, and signs the person out", async ({ page, browser }) => {
  await admin(page);
  const person = await apiLogin(browser, co.phone);
  expect((await api(person.request, "GET", "/auth/me")).status).toBe(200);
  await gotoReady(page, `/admin/companies/${co.id}/edit`);
  const next = phoneN(11);
  await page.getByTestId("acr-phone").fill(co.phone === next ? phoneN(12) : next);
  await expect(page.getByTestId("acr-changes")).toContainText("signed out of all their devices");
  await page.getByTestId("acr-submit").click();
  await expect(page).toHaveURL(new RegExp(`/admin/companies/${co.id}$`));
  expect((await api(person.request, "GET", "/auth/me")).status).toBe(401);
  const trail = (await api(page.request, "GET", "/admin/audit?action=account.phone_change")).json.items;
  expect(trail.find((a: { entityId: string }) => a.entityId === co.id)?.diff).toMatchObject({ from: intl(co.phone) });
  await person.close();
});

test("a driver's identity and payout fields can be edited by staff cleared for sensitive data", async ({ page }) => {
  await admin(page);
  await gotoReady(page, `/admin/drivers/${drv.id}/edit`);
  await expect(page.getByTestId("acr-edit-title")).toHaveText("Edit driver");
  await expect(page.getByTestId("acr-nationalId")).toHaveValue("1087654321");
  await expect(page.getByTestId("acr-office-note")).toContainText("Linked to");
  await page.getByTestId("acr-vehiclePlate").fill("XYZ 9876");
  await page.getByTestId("acr-iban").fill("SA6980000204608016211111");
  await expect(page.getByTestId("acr-change-iban")).toContainText("…1111");
  await page.getByTestId("acr-submit").click();
  await expect(page).toHaveURL(new RegExp(`/admin/drivers/${drv.id}$`));
  const after = (await api(page.request, "GET", `/admin/accounts/${drv.id}`)).json;
  expect(after.fields).toMatchObject({ vehiclePlate: "XYZ 9876", iban: "SA6980000204608016211111", vehicleType: "van" });
});

test("staff without accounts.create see no Add buttons and are refused by page and API; operations may create", async ({ page, browser }) => {
  await admin(page);
  sup.ctx = await staffContext(browser, page, "support");
  const p = await sup.ctx.newPage();
  await gotoReady(p, "/admin/companies");
  await expect(p.getByRole("heading", { level: 1, name: "Companies" })).toBeVisible();
  await expect(p.getByTestId("acr-add-company")).toHaveCount(0);
  await gotoReady(p, "/admin/companies/new");
  await expect(p.getByTestId("acr-no-access")).toBeVisible();
  await gotoReady(p, "/admin/users/new");
  await expect(p.getByTestId("acr-no-access")).toBeVisible();
  expect((await api(sup.ctx.request, "POST", "/admin/accounts", { kind: "business", name: "No Way", phone: phoneN(20), city: "riyadh", companyName: "No Way Co" })).status).toBe(403);
  expect((await api(sup.ctx.request, "PATCH", `/admin/accounts/${co.id}`, { industry: "x" })).status).toBe(403);
  await sup.ctx.close();
  const ops = await staffContext(browser, page, "operations");
  const q = await ops.newPage();
  await gotoReady(q, "/admin/drivers");
  await expect(q.getByTestId("acr-add-driver")).toBeVisible();
  await gotoReady(q, "/admin/drivers/new");
  await expect(q.getByTestId("acr-officeId")).toHaveCount(0); // placing a driver in an office needs offices.manage, which operations does not hold
  await expect(q.getByTestId("acr-verify-now")).toBeDisabled(); // and so does verifying (verification.manage)
  await expect(q.getByTestId("acr-nationalId")).toBeDisabled(); // personal data needs drivers.sensitive
  await expect(q.getByTestId("acr-locked-note").first()).toBeVisible(); // one note per locked section
  await ops.close();
});

test("the create form works at 390 px and in Arabic (right to left)", async ({ page }) => {
  await admin(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await gotoReady(page, "/admin/companies/new");
  expect(await noSideways(page)).toBe(true);
  await expect(page.getByTestId("acr-actions")).toBeVisible();
  await expect(page.getByTestId("acr-submit")).toBeVisible();
  await page.context().addCookies([{ name: "jr_lang", value: "ar", url: BASE }]);
  await gotoReady(page, "/admin/drivers/new");
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  await expect(page.getByRole("heading", { level: 1, name: "إضافة مندوب" })).toBeVisible();
  expect(await noSideways(page)).toBe(true);
  await page.getByTestId("acr-phone").fill("0501234567");
  await expect(page.getByTestId("acr-phone")).toHaveAttribute("dir", "ltr"); // numbers stay left to right inside the Arabic page
  await gotoReady(page, "/admin/users/new");
  await expect(page.getByTestId("acr-chooser").getByRole("link")).toHaveCount(4);
  expect(await noSideways(page)).toBe(true);
  await page.context().addCookies([{ name: "jr_lang", value: "en", url: BASE }]);
});

test("staff change a username and reset a password from the Security tab; the person signs in with the new details and must replace the password", async ({ page, browser }) => {
  await admin(page);
  await gotoReady(page, `/admin/drivers/${drv.id}/security`);
  await expect(page.getByTestId("cred-card")).toBeVisible();
  await expect(page.getByTestId("cred-username")).toHaveText(drv.username);
  // rename: the format and availability are checked live; a taken name is refused
  await page.getByTestId("cred-rename").click();
  await page.getByTestId("cred-username-input").fill("demo.driver");
  await expect(page.getByText("This username is already taken")).toBeVisible();
  await expect(page.getByTestId("cred-rename-save")).toBeDisabled();
  const renamed = `create.drv.${tag}`;
  await page.getByTestId("cred-username-input").fill(renamed);
  await expect(page.getByTestId("cred-username-input-status")).toHaveText("Available");
  await page.getByTestId("cred-rename-save").click();
  await expect(page.getByTestId("cred-username")).toHaveText(renamed);
  const trail = (await api(page.request, "GET", "/admin/audit?action=user.username_change")).json.items;
  expect(trail.find((a: { entityId: string }) => a.entityId === drv.id)?.diff).toMatchObject({ from: drv.username, to: renamed });
  drv.username = renamed;
  // reset: a strong password is generated and shown once
  await page.getByTestId("cred-reset").click();
  await page.getByTestId("cred-reset-submit").click();
  const pw = (await page.getByTestId("cred-new-password").textContent())!.trim();
  expect(pw).toMatch(/^[A-Za-z0-9]{4}-[A-Za-z0-9]{4}-[A-Za-z0-9]{4}$/);
  await page.getByTestId("cred-reset-close").click();
  await expect(page.getByText("Temporary password")).toBeVisible(); // the card now says it must be replaced
  rememberLogin(drv.phone, drv.username, pw);
  const person = await browser.newContext(); const pp = await person.newPage();
  await uiSignIn(pp, drv.username, drv.password); // the old password no longer works
  await expect(pp.getByTestId("login-error")).toBeVisible();
  await uiSignIn(pp, drv.username, pw);
  await expect(pp).toHaveURL(/\/account\/change-password/); // a driver on the web is held at the same screen
  await person.close();
});
