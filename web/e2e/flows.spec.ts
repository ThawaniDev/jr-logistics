import { test, expect } from "@playwright/test";
import { otpLogin, staffLogin, gotoReady, DEMO } from "./helpers";

test.describe.configure({ mode: "serial" });

test("landing renders, language switch flips direction, brand tokens applied", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Delivery capacity");
  await expect(page.locator("html")).toHaveAttribute("dir", "ltr");
  await page.getByLabel("Language").first().selectOption("ar");
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  await expect(page.locator("html")).toHaveAttribute("lang", "ar");
  await expect(page.getByRole("heading", { level: 1 })).toContainText("طاقة توصيل");
  const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  expect(bg).toBe("rgb(11, 19, 43)"); // #0B132B
  await page.getByLabel("Language").first().selectOption("ur");
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  await page.getByLabel("Language").first().selectOption("en");
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

test("new user registers as a driver through the UI and sees verification gating", async ({ page }) => {
  await gotoReady(page, "/login?role=driver");
  await page.getByLabel("Mobile number").fill("0511122233");
  await page.getByRole("button", { name: "Send code" }).click();
  await page.getByLabel("Verification code").fill((await page.locator(".ltr-num.text-lg").textContent())!.trim());
  await page.getByRole("button", { name: "Verify & continue" }).click();
  await expect(page).toHaveURL(/\/register/);
  await page.getByRole("radio", { name: /Driver/ }).click();
  await page.getByLabel(/Full name/).fill("Ahmed Test Driver");
  await page.getByLabel("City").selectOption("riyadh");
  await page.getByLabel("Vehicle type").selectOption("van");
  await page.getByLabel("Cargo temperature").selectOption("cold"); // appears only for van/dyna
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page).toHaveURL(/\/driver$/);
  await expect(page.getByText("Your documents are not verified yet")).toBeVisible();
  await expect(page.getByRole("button", { name: "Go online" })).toBeDisabled();
});

test("business publishes a request via the wizard; driver accepts; both see consistent state", async ({ browser }) => {
  const biz = await (await browser.newContext()).newPage();
  await otpLogin(biz, DEMO.business);
  await biz.getByRole("link", { name: "New request" }).first().click();
  await biz.getByRole("button", { name: /Delivery driver/ }).click();
  await biz.getByLabel(/^Vehicle/).selectOption("sedan");
  await biz.getByLabel(/Shipments per driver/).fill("20");
  // live price appears before the user finishes the wizard
  await expect(biz.getByText("SAR 8.00")).toBeVisible();
  await expect(biz.getByText("SAR 160.00")).toBeVisible(); // 20 shipments × 8.00
  await expect(biz.getByText(/Provider cost|Margin/i)).toHaveCount(0); // never leaked to the business
  await biz.getByRole("button", { name: "Next", exact: true }).click();
  await biz.getByLabel(/Pickup address/).fill("Olaya St, Riyadh");
  await biz.getByLabel(/Delivery address/).fill("King Fahd Rd 120, Riyadh");
  const d = new Date(Date.now() + 2 * 864e5 + 3 * 3600e3).toISOString().slice(0, 11) + "09:00";
  await biz.getByLabel(/Start date/).fill(d);
  await biz.getByLabel("Recipient name").fill("Mona");
  await biz.getByLabel("Recipient phone").fill("0555555555");
  await biz.getByRole("button", { name: "Next", exact: true }).click();
  await expect(biz.getByRole("button", { name: "Publish & reserve funds" })).toBeDisabled();
  await biz.getByRole("checkbox").check();
  await biz.getByRole("button", { name: "Publish & reserve funds" }).click();
  await expect(biz).toHaveURL(/\/business\/requests\/[0-9a-f-]{36}/);
  await expect(biz.getByText("Open for drivers").first()).toBeVisible();
  await expect(biz.getByText("SAR 160.00").first()).toBeVisible();
  const reqUrl = biz.url();
  await biz.goto("/business/wallet");
  await expect(biz.getByText("SAR 160.00").first()).toBeVisible(); // reserved in escrow

  // driver (seeded, verified, available) sees the offer, accepts with terms
  const drv = await (await browser.newContext()).newPage();
  await otpLogin(drv, DEMO.driver);
  await drv.goto("/driver/opportunities");
  await expect(drv.getByText("Delivery driver").first()).toBeVisible();
  await expect(drv.getByText(/Expected earning/).first()).toBeVisible();
  await drv.getByRole("button", { name: "Accept", exact: true }).first().click();
  await expect(drv.getByRole("button", { name: "Accept job" })).toBeDisabled(); // terms required
  await drv.getByRole("checkbox").check();
  await drv.getByRole("button", { name: "Accept job" }).click();
  await expect(drv).toHaveURL(/\/driver\/jobs\//);
  await expect(drv.getByText("Next step")).toBeVisible();
  await expect(drv.getByText("Mona")).toBeVisible(); // recipient revealed only after acceptance
  await expect(drv.getByRole("button", { name: /Contact|On my way|Problem/ }).first()).toBeVisible(); // WhatsApp hand-off buttons

  // business now sees the driver and can act
  await biz.goto(reqUrl);
  await expect(biz.getByText("Omar Alqahtani", { exact: true })).toBeVisible();
  await expect(biz.getByRole("button", { name: "Confirm attendance" })).toBeVisible();
  await biz.getByRole("button", { name: "Confirm attendance" }).click();
  await expect(biz.getByText("Working").first()).toBeVisible();
});

test("staff: finance staff see finance but not settings editing; admin dashboard loads", async ({ page }) => {
  await staffLogin(page, "finance1@jrlogistics.demo", DEMO.staffPw);
  await expect(page.getByRole("link", { name: "Finance" }).first()).toBeVisible();
  await expect(page.getByRole("link", { name: "Staff", exact: true })).toHaveCount(0);
  await page.goto("/admin/finance");
  await expect(page.getByRole("heading", { name: "Finance" })).toBeVisible();
  await expect(page.getByText(/Payments are recorded in an internal ledger/)).toBeVisible();
  const res = await page.request.get("/api/v1/admin/staff");
  expect(res.status()).toBe(403);
});

test("admin console: pricing, verification, ops pages render with data", async ({ page }) => {
  await staffLogin(page, "admin@jrlogistics.test", "E2e!Password2026");
  for (const [path, heading] of [["/admin/pricing", "Pricing"], ["/admin/verification", "Verification"], ["/admin/operations", "Operations"], ["/admin/requests", "Requests"], ["/admin/reports", "Reports"], ["/admin/audit", "Audit log"]] as const) {
    await page.goto(path);
    await expect(page.getByRole("heading", { name: heading, exact: true })).toBeVisible();
  }
  await page.goto("/admin/pricing");
  await expect(page.getByText("SAR 8.00").first()).toBeVisible();
  await expect(page.getByText("Rules resolve by specificity")).toBeVisible();
});
