import { test, expect, type APIRequestContext, type Browser } from "@playwright/test";
import { otpLogin, staffLogin, gotoReady, DEMO } from "./helpers";

test.describe.configure({ mode: "serial" });

const BASE = "http://localhost:3100";
async function api(ctx: APIRequestContext, method: "GET" | "POST" | "PUT", path: string, data?: unknown) {
  const res = await ctx.fetch(`${BASE}/api/v1${path}`, { method, data, headers: { origin: BASE, "content-type": "application/json" } });
  return { status: res.status(), json: await res.json().catch(() => null) };
}
async function apiLogin(browser: Browser, phone: string) {
  const ctx = await browser.newContext();
  const s = await api(ctx.request, "POST", "/auth/otp/send", { phone });
  const v = await api(ctx.request, "POST", "/auth/otp/verify", { phone, code: s.json.demoCode });
  expect(v.status).toBe(200);
  return ctx;
}

test("settlement lifecycle through the UI: review → separation of duties → approve → pay → driver is paid", async ({ browser }) => {
  const biz = await apiLogin(browser, "0500000001");
  const drv = await apiLogin(browser, "0500000014"); // Nasser (van/cold) — different driver from other specs
  await api(drv.request, "PUT", "/driver/availability", { available: true });
  const start = new Date(Date.now() + 3 * 3600e3).toISOString();
  const pub = await api(biz.request, "POST", "/requests", { service: "delivery_driver", quantity: 1, shipmentsPerDriver: 10, vehicleType: "van", temperature: "cold", pickupCity: "riyadh", deliveryCity: "riyadh", pickupAddress: "A", deliveryAddress: "B", startsAt: start, durationDays: 1, publish: true, termsAccepted: true });
  expect(pub.status).toBe(201);
  const offers = await api(drv.request, "GET", "/driver/offers");
  const offer = offers.json.items.find((o: any) => o.requestId === pub.json.id);
  expect(offer).toBeTruthy();
  expect((await api(drv.request, "POST", `/offers/${offer.offerId}/accept`, { termsAccepted: true })).status).toBe(200);
  await api(biz.request, "POST", `/offers/${offer.offerId}/attendance`, { present: true });
  await api(biz.request, "POST", `/offers/${offer.offerId}/loading`, { units: 10 });
  await api(drv.request, "POST", `/offers/${offer.offerId}/loading-ack`, { ok: true });
  await api(drv.request, "POST", `/offers/${offer.offerId}/delivered`, { units: 10 });
  expect((await api(biz.request, "POST", `/offers/${offer.offerId}/delivery-decision`, { action: "confirm" })).status).toBe(200);

  // finance 1 reviews in the UI
  const page = await (await browser.newContext()).newPage();
  await staffLogin(page, "finance1@jrlogistics.demo", DEMO.staffPw);
  await page.goto("/admin/finance");
  const row = page.locator("tr", { hasText: "SAR" }).first();
  await expect(row).toBeVisible();
  await row.getByRole("button", { name: "Review", exact: true }).click();
  await page.getByRole("tab", { name: "Reviewed" }).click();
  const reviewed = page.locator("tr", { hasText: "SAR" }).first();
  await expect(reviewed).toBeVisible();
  // the reviewer cannot also approve (separation of duties) — server blocks it, UI shows the message
  await reviewed.getByRole("button", { name: "Approve", exact: true }).click();
  await expect(page.getByText("You don't have permission to do that.")).toBeVisible();

  // finance 2 approves and pays
  const p2 = await (await browser.newContext()).newPage();
  await staffLogin(p2, "finance2@jrlogistics.demo", DEMO.staffPw);
  await p2.goto("/admin/finance");
  await p2.getByRole("tab", { name: "Reviewed" }).click();
  await p2.locator("tr", { hasText: "SAR" }).first().getByRole("button", { name: "Approve", exact: true }).click();
  await p2.getByRole("tab", { name: "Approved" }).click();
  await p2.locator("tr", { hasText: "SAR" }).first().getByRole("button", { name: "Pay", exact: true }).click();
  await p2.getByRole("tab", { name: "Paid", exact: true }).click();
  await expect(p2.locator("tr", { hasText: "SAR" }).first()).toBeVisible();

  // driver sees the money, exactly provider cost × units (van cold 14.5 × 10 = 145.00? seeded: 9.00+1.50 = 10.50 → 105.00)
  const wallet = await api(drv.request, "GET", "/wallet");
  expect(wallet.json.availableCents).toBe(10500);
  const summary = await api(p2.context().request, "GET", "/admin/finance/summary");
  expect(summary.json.platformRevenueCents).toBeGreaterThan(0);
});

test("driver uploads documents in the UI; HR staff approve them; driver becomes verified", async ({ page, browser }) => {
  await gotoReady(page, "/login?role=driver");
  await page.getByLabel("Mobile number").fill("0522233344");
  await page.getByRole("button", { name: "Send code" }).click();
  await page.getByLabel("Verification code").fill((await page.locator(".ltr-num.text-lg").textContent())!.trim());
  await page.getByRole("button", { name: "Verify & continue" }).click();
  await page.waitForURL(/register/);
  await page.getByRole("radio", { name: /Driver/ }).click();
  await page.getByLabel(/Full name/).fill("Doc Test Driver");
  await page.getByLabel("City").selectOption("riyadh");
  await page.getByLabel("Vehicle type").selectOption("sedan");
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: "Create account" }).click();
  await page.waitForURL(/\/driver$/);

  await page.goto("/driver/documents");
  const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
  for (const label of ["National ID / Iqama", "Driving license", "Vehicle registration"]) {
    const card = page.locator("div.rounded-card", { hasText: label }).first();
    await card.locator('input[type="file"]').setInputFiles({ name: "doc.png", mimeType: "image/png", buffer: png });
    await expect(card.getByText("Submitted")).toBeVisible();
  }

  const staff = await (await browser.newContext()).newPage();
  await staffLogin(staff, "hr@jrlogistics.demo", "Demo#Pass2026");
  await staff.goto("/admin/verification");
  for (let i = 0; i < 3; i++) {
    const approve = staff.getByRole("button", { name: "Approve", exact: true }).first();
    await expect(approve).toBeVisible();
    await approve.click();
    await expect(staff.getByText("Saved").first()).toBeVisible();
    await staff.waitForTimeout(400);
  }
  await page.goto("/driver");
  await expect(page.getByText("Your documents are not verified yet")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Go online" })).toBeEnabled();
});
