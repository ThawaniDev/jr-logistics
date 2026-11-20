import { test, expect } from "@playwright/test";
import { otpLogin, staffLogin, gotoReady, uiSignIn, rememberLogin, DEMO } from "./helpers";
import { setFieldModes, type FieldModes } from "./field-modes";
import { openNext } from "./driver-ui";

test.describe.configure({ mode: "serial" });

let savedModes: FieldModes; // J2 / J3: routing and B2B shipments are OFF by default — this spec drives routes / "Approve route" / business parcels
test.beforeAll(async ({ browser }) => { savedModes = await setFieldModes(browser, { routingEnabled: true, b2bShipmentsEnabled: true }); });
test.afterAll(async ({ browser }) => { await setFieldModes(browser, savedModes); });

test("landing renders, language switch flips direction, brand tokens applied", async ({ page }) => {
  await gotoReady(page, "/");
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Assign your deliveries");
  await expect(page.locator("html")).toHaveAttribute("dir", "ltr");
  // Each switch reloads the page; the <select> is server-rendered before React attaches its handler, so wait for hydration before the next change.
  const switchTo = async (l: string) => {
    await page.waitForSelector('html[data-hydrated="true"]');
    await page.getByTestId("lang-switch").first().selectOption(l);
    await expect(page.locator("html")).toHaveAttribute("lang", l);
  };
  await switchTo("ar");
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  await expect(page.getByRole("heading", { level: 1 })).toContainText("أسند توصيل");
  const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  expect(bg).toBe("rgb(11, 19, 43)"); // #0B132B
  await switchTo("ur");
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  await switchTo("en");
  await expect(page.locator("html")).toHaveAttribute("dir", "ltr");
});

test("route guards: anonymous → login; business cannot open admin", async ({ page }) => {
  await page.goto("/business");
  await expect(page).toHaveURL(/\/login/);
  await otpLogin(page, DEMO.business);
  await expect(page).toHaveURL(/\/business$/);
  await page.goto("/admin");
  await expect(page).toHaveURL(/\/business$/);
  await page.goto("/driver");
  await expect(page).toHaveURL(/\/business$/);
});

test("sign-in screen: username + password for every role, demo quick-fill, kind errors, old staff address redirects, no code step", async ({ browser }) => {
  const ctx = await browser.newContext(); const page = await ctx.newPage();
  await gotoReady(page, "/login");
  await expect(page.getByRole("heading", { name: "Sign in", exact: true })).toBeVisible();
  await expect(page.getByTestId("login-username")).toBeVisible();
  await expect(page.getByText("Send code")).toHaveCount(0);
  await expect(page.getByLabel("Mobile number")).toHaveCount(0);
  // the password box hides what is typed until Show is pressed
  await page.getByTestId("login-password").fill("Secret#Pass2026");
  await expect(page.getByTestId("login-password")).toHaveAttribute("type", "password");
  await page.getByTestId("login-password-toggle").click();
  await expect(page.getByTestId("login-password")).toHaveAttribute("type", "text");
  // wrong password and unknown user get the same kind message, and the typed values stay
  await page.getByTestId("login-username").fill("demo.business");
  await page.getByTestId("login-password").fill("Wrong#Pass2026");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByTestId("login-error")).toContainText("username or password is not correct");
  await expect(page.getByTestId("login-username")).toHaveValue("demo.business");
  await page.getByTestId("login-username").fill("nobody.at.all");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByTestId("login-error")).toContainText("username or password is not correct");
  await expect(page.getByText(/ask your account manager or JR support/i)).toBeVisible();
  // demo mode: one button per demo account fills both boxes
  await expect(page.getByTestId("demo-accounts")).toBeVisible();
  await page.getByTestId("demo-demo.driver").click();
  await expect(page.getByTestId("login-username")).toHaveValue("demo.driver");
  await expect(page.getByTestId("login-password")).not.toHaveValue("");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(/\/driver/);
  // every role: business, office and staff by username, the super admin by e-mail address as well
  for (const [user, pw, home] of [["demo.business", DEMO.staffPw, /\/business/], ["demo.office", DEMO.staffPw, /\/office/], ["demo.ops", DEMO.staffPw, /\/admin/], ["Demo.Finance1", DEMO.staffPw, /\/admin/], ["admin@jrlogistics.test", "E2e!Password2026", /\/admin/]] as const) {
    const c = await browser.newContext(); const p = await c.newPage();
    await uiSignIn(p, user, pw);
    await expect(p, user).toHaveURL(home);
    await c.close();
  }
  // the old staff address lands on the one sign-in; the create-account link leads to the registration
  await page.context().clearCookies();
  await page.goto("/staff/login?expired=1");
  await expect(page).toHaveURL(/\/login\?expired=1/);
  await expect(page.getByText("Your session expired")).toBeVisible();
  await page.goto("/staff/change-password");
  await expect(page).toHaveURL(/\/login/); // not signed in: the change-password screen sends you to sign in
  await gotoReady(page, "/login");
  await page.getByTestId("login-register-link").click();
  await expect(page).toHaveURL(/\/register/);
  await ctx.close();
});

test("new user registers as a driver through the UI (username + password, live availability) and sees verification gating", async ({ page, browser }) => {
  await gotoReady(page, "/login?role=driver"); // the landing page's "register" links
  await expect(page).toHaveURL(/\/register\?role=driver/);
  await page.waitForSelector('html[data-hydrated="true"]');
  await page.getByRole("radio", { name: /Driver/ }).click();
  const username = page.getByTestId("reg-username");
  await username.fill("demo.driver"); // taken
  await expect(page.getByText("This username is already taken")).toBeVisible();
  await username.fill("ab"); // too short
  await expect(page.getByText(/Use 3–30 letters, digits/)).toBeVisible();
  await username.fill("admin"); // reserved
  await expect(page.getByText("This username is reserved")).toBeVisible();
  await username.fill("Ahmed.Driver");
  await expect(page.getByTestId("reg-username-status")).toHaveText("Available");
  await page.getByTestId("reg-password").fill("Short1");
  await page.getByTestId("reg-confirm").fill("Different#Pass2026");
  await page.getByTestId("reg-name").fill("Ahmed Test Driver");
  await page.getByLabel("City").selectOption("riyadh");
  await page.getByLabel("Vehicle type").selectOption("van");
  await page.getByLabel("Cargo temperature").selectOption("cold"); // appears only for van/dyna
  await page.getByRole("checkbox").check();
  await page.getByTestId("reg-submit").click();
  await expect(page.getByText("The password needs at least 10 characters")).toBeVisible();
  await page.getByTestId("reg-password").fill("Driver#Pass2026");
  await expect(page.getByText("The passwords do not match")).toBeVisible();
  await page.getByTestId("reg-confirm").fill("Driver#Pass2026");
  await page.getByTestId("reg-submit").click();
  await expect(page.getByTestId("reg-phone")).toHaveAttribute("aria-invalid", "true"); // the phone is required now (a contact number)
  await page.getByTestId("reg-phone").fill("0511122233");
  await page.getByTestId("reg-submit").click();
  await expect(page).toHaveURL(/\/driver$/);
  await expect(page.getByText("Your documents are not verified yet")).toBeVisible();
  await expect(page.getByRole("button", { name: "Go online" })).toBeDisabled();
  // the new person can sign in again with the username (any capitalisation) and the password they chose
  rememberLogin("0511122233", "ahmed.driver", "Driver#Pass2026");
  const again = await browser.newContext(); const p2 = await again.newPage();
  await uiSignIn(p2, "AHMED.driver", "Driver#Pass2026");
  await expect(p2).toHaveURL(/\/driver$/);
  // …and the profile shows the username and offers to change the password; another device is signed out by it
  await gotoReady(p2, "/driver/profile");
  await expect(p2.getByTestId("profile-username")).toHaveValue("ahmed.driver");
  await expect(p2.getByTestId("password-card")).toBeVisible();
  await p2.getByTestId("cp-current").fill("Driver#Pass2026");
  await p2.getByTestId("cp-new").fill("Driver#Pass2027");
  await p2.getByTestId("cp-confirm").fill("Driver#Pass2027");
  await p2.getByTestId("cp-submit").click();
  await expect(p2.getByText("Password changed", { exact: false }).first()).toBeVisible();
  await expect.poll(async () => (await page.request.get("/api/v1/auth/me")).status()).toBe(401); // the first browser's session ended
  expect((await p2.request.get("/api/v1/auth/me")).status()).toBe(200);                            // the one that changed it stays
  rememberLogin("0511122233", "ahmed.driver", "Driver#Pass2027");
  await again.close();
});

test("B2C + B2B parcels end to end: wizard (CSV) → accept → hand-over → stop by stop with recipient codes → returns → confirm → public tracking", async ({ browser }) => {
  test.setTimeout(240_000); // one test, the whole journey across three people
  const biz = await (await browser.newContext()).newPage();
  await otpLogin(biz, DEMO.business);
  // other specs leave their own funds reserved on the shared demo business: judge this journey against that baseline
  const reservedBefore = (await (await biz.request.get("/api/v1/wallet")).json()).reservedCents as number;
  await biz.getByRole("link", { name: "New request" }).first().click();
  await biz.getByRole("button", { name: /Delivery driver/ }).click();
  await biz.getByLabel(/^Vehicle/).selectOption("sedan");
  await biz.getByRole("button", { name: "Next", exact: true }).click();
  await biz.getByLabel(/Pickup address/).fill("Olaya St, Riyadh");
  const d = new Date(Date.now() + 3 * 3600e3 + 2 * 3600e3).toISOString().slice(0, 16); // 2 hours from now (Riyadh local) — inside the driver's check-in window
  await biz.getByLabel(/Start date/).fill(d);
  await biz.getByRole("button", { name: "Next", exact: true }).click();
  await expect(biz.getByLabel("Max parcels per driver")).toHaveValue("30"); // drivers follow from the parcels, not typed
  // Shipments step: every parcel has its own recipient — import a sheet (B2C consumers + a B2B branch)
  await biz.getByRole("button", { name: "Import CSV" }).first().click();
  await biz.getByLabel("Paste CSV text").fill('name,phone,address,type,ref\nMona,0555555555,"King Fahd Rd 120, Riyadh",consumer,ORD-1\nAcme Branch,0555555556,Tahlia St 5 Riyadh,business,ORD-2\nLayla,0555555557,Malaz 10 Riyadh,consumer,ORD-3');
  await biz.getByRole("button", { name: "Preview" }).click();
  await biz.getByRole("button", { name: /Add 3 valid rows/ }).click();
  await biz.getByRole("button", { name: "Next", exact: true }).click();
  await expect(biz.getByText("SAR 24.00").first()).toBeVisible(); // 3 parcels × 8.00 — exactly the parcels, nothing else
  await expect(biz.getByText(/Provider cost|Margin/i)).toHaveCount(0);
  await expect(biz.getByRole("button", { name: "Publish & reserve funds" })).toBeDisabled();
  await biz.getByRole("checkbox").last().check();
  await biz.getByRole("button", { name: "Publish & reserve funds" }).click();
  await expect(biz).toHaveURL(/\/business\/requests\/[0-9a-f-]{36}/);
  await expect(biz.getByText("Open for drivers").first()).toBeVisible();
  const reqUrl = biz.url(); const reqId = reqUrl.split("/").pop()!;
  await biz.goto("/business/wallet");
  await expect(biz.getByText("SAR 24.00").first()).toBeVisible(); // reserved in escrow

  // driver accepts with terms
  // the driver's browser reports a position AT the warehouse (the demo warehouse is in central Riyadh): check-in is geofenced
  const drv = await (await browser.newContext({ geolocation: { latitude: 24.7136, longitude: 46.6753 }, permissions: ["geolocation"] })).newPage();
  await otpLogin(drv, DEMO.driver);
  await drv.goto("/driver/opportunities");
  await expect(drv.getByText("Delivery driver").first()).toBeVisible();
  await drv.getByRole("button", { name: "Accept", exact: true }).first().click();
  await expect(drv.getByRole("button", { name: "Accept job" })).toBeDisabled();
  await drv.getByRole("checkbox").check();
  await drv.getByRole("button", { name: "Accept job" }).click();
  await expect(drv).toHaveURL(/\/driver\/jobs\//);
  const jobUrl = drv.url();

  // the driver checks in at the warehouse (GPS within the radius of its pin), then the warehouse confirms the arrival
  await drv.goto(jobUrl);
  await drv.getByTestId("checkin").click();
  await biz.goto(reqUrl);
  await expect(biz.getByText("Omar Alqahtani", { exact: true }).first()).toBeVisible();
  await biz.getByRole("button", { name: "Confirm attendance" }).click();
  await expect(biz.getByText("Working").first()).toBeVisible();
  // E3: nothing for the warehouse to record — the driver scans the parcels onto the vehicle and the warehouse just watches the progress
  await expect(biz.getByRole("button", { name: "Record loaded quantity" })).toHaveCount(0);
  await expect(biz.getByTestId("loading-progress")).toHaveAttribute("data-scanned", "0");
  const list = (await (await biz.request.get(`/api/v1/requests/${reqId}/shipments?pageSize=200`)).json()).items as Array<{ code: string; seq: number; demoOtp: string; recipientPhone: string; recipientType: string }>;
  list.sort((a, b) => a.seq - b.seq);
  expect(list.map((x) => x.recipientType)).toEqual(["consumer", "business", "consumer"]);

  // driver: scan each parcel (typed here; the camera fills the same field), finish loading → review the planned route → approve it
  await drv.goto(jobUrl);
  for (const [i, p] of list.entries()) {
    await drv.getByTestId("scan-input").fill(p.code);
    await drv.getByTestId("scan-submit").click();
    await expect(drv.getByTestId("scan-progress")).toHaveAttribute("data-scanned", String(i + 1));
  }
  await drv.getByTestId("scan-finish").click();
  await drv.getByRole("button", { name: "Approve route" }).first().click();
  await expect(drv.getByText("Mona").first()).toBeVisible();
  await expect(drv.getByText("Layla")).toHaveCount(0); // a later stop: not revealed yet
  await expect(biz.getByTestId("loading-progress")).toBeVisible();

  // stop 1 (consumer): open the shipment, arrive — no countdown at the door any more — then parcel code + the recipient's one-time code
  await openNext(drv);
  await drv.getByRole("button", { name: "I've arrived" }).first().click();
  await expect(drv.getByText(/Wait at the address|wait .* min/i)).toHaveCount(0);
  await drv.getByLabel("Parcel code").fill(list[0].code);
  await drv.getByLabel("Delivery code").fill("0000" === list[0].demoOtp ? "1111" : "0000");
  await drv.getByRole("button", { name: "Confirm delivery" }).last().click();
  await expect(drv.getByText(/tries left/)).toBeVisible(); // wrong code refused and counted
  await drv.getByLabel("Delivery code").fill(list[0].demoOtp);
  await drv.getByRole("button", { name: "Confirm delivery" }).last().click();
  await expect(drv.getByText("Acme Branch").first()).toBeVisible(); // next stop is now current

  // stop 2 (business): the branch refuses — every reason is selectable at once, no arrival / wait / note rules — not delivered, to be returned
  await openNext(drv);
  await drv.getByTestId("stop-fail").click();
  await drv.getByTestId("fail-reason-refused").click();
  await drv.getByTestId("fail-continue").click();
  await drv.getByTestId("fail-confirm").click();
  await expect(drv.getByText("Layla").first()).toBeVisible();

  // stop 3 (consumer)
  await openNext(drv);
  await drv.getByRole("button", { name: "I've arrived" }).first().click();
  await drv.getByLabel("Parcel code").fill(list[2].seq.toString()); // just the manifest number is accepted
  await drv.getByLabel("Delivery code").fill(list[2].demoOtp);
  await drv.getByRole("button", { name: "Confirm delivery" }).last().click();
  await drv.getByRole("button", { name: "Finish route" }).first().click();
  await expect(drv.getByTestId("job-completed")).toBeVisible(); // confirmed and paid at once

  // warehouse: nothing to confirm or dispute — the job is already completed and paid; the refused parcel is received back separately
  await biz.goto(reqUrl);
  await expect(biz.getByRole("button", { name: "Confirm delivery" })).toHaveCount(0);
  await expect(biz.getByRole("button", { name: "Dispute delivery" })).toHaveCount(0);
  await expect(biz.getByText("Completed").first()).toBeVisible();
  await biz.getByRole("button", { name: "Receive returned parcels" }).click();
  await biz.getByRole("button", { name: "Select all" }).click();
  await biz.getByRole("button", { name: /Receive 1 parcel/ }).click();
  // the settlement bills the 2 delivered parcels and refunds the refused one — already paid, nothing stays reserved
  expect((await (await biz.request.get("/api/v1/wallet")).json()).reservedCents).toBe(reservedBefore);
  expect((await (await drv.request.get("/api/v1/wallet")).json()).availableCents).toBeGreaterThan(0);

  // the recipient tracks their parcel with the code + last 4 digits of their phone (no login, no address shown)
  const pub = await (await browser.newContext()).newPage();
  await gotoReady(pub, `/track/${list[0].code}?p=${list[0].recipientPhone.slice(-4)}`);
  await expect(pub.getByText("Delivered").first()).toBeVisible();
  await expect(pub.getByText("King Fahd")).toHaveCount(0);
  await gotoReady(pub, `/track/${list[0].code}?p=0000`);
  await expect(pub.getByText("We could not find this parcel")).toBeVisible();
});

test("staff: finance staff see finance but not settings editing; admin dashboard loads", async ({ page }) => {
  await staffLogin(page, "finance1@jrlogistics.demo", DEMO.staffPw);
  await expect(page.locator('a[href^="/admin/finance"]').first()).toBeVisible(); // the Finance group of the sidebar
  await expect(page.getByRole("link", { name: "Staff", exact: true })).toHaveCount(0);
  await page.goto("/admin/finance");
  await expect(page.getByRole("heading", { name: "Finance" })).toBeVisible();
  await expect(page.getByText(/Payments are recorded in an internal ledger/)).toBeVisible();
  const res = await page.request.get("/api/v1/admin/staff");
  expect(res.status()).toBe(403);
});

test("admin console: pricing, verification, ops pages render with data", async ({ page }) => {
  await staffLogin(page, "admin@jrlogistics.test", "E2e!Password2026");
  for (const [path, heading] of [["/admin/pricing", "Pricing"], ["/admin/verification", "Verification"], ["/admin/operations", "Operations"], ["/admin/requests", "Requests"], ["/admin/reports", "Overview"], ["/admin/audit", "Audit log"]] as const) {
    await page.goto(path);
    await expect(page.getByRole("heading", { name: heading, exact: true })).toBeVisible();
  }
  await page.goto("/admin/pricing");
  await expect(page.getByText("SAR 8.00").first()).toBeVisible();
  await expect(page.getByText("Rules resolve by specificity")).toBeVisible();
});
