import { test, expect, type APIRequestContext } from "@playwright/test";
import { staffLogin, gotoReady, DEMO, apiLogin } from "./helpers";
import { setFieldModes, type FieldModes } from "./field-modes";

test.describe.configure({ mode: "serial" });

let savedModes: FieldModes; // J2 / J3: routing and B2B shipments are OFF by default — this spec drives routes / "Approve route" / business parcels
test.beforeAll(async ({ browser }) => { savedModes = await setFieldModes(browser, { routingEnabled: true, b2bShipmentsEnabled: true }); });
test.afterAll(async ({ browser }) => { await setFieldModes(browser, savedModes); });

const BASE = `http://localhost:${process.env.E2E_PORT ?? 3101}`; // not 3100: other projects on this machine use it
async function api(ctx: APIRequestContext, method: "GET" | "POST" | "PUT", path: string, data?: unknown) {
  const res = await ctx.fetch(`${BASE}/api/v1${path}`, { method, data, headers: { origin: BASE, "content-type": "application/json" } });
  return { status: res.status(), json: await res.json().catch(() => null) };
}

test("a finished job is paid at once: no review / approval / payout steps — the console shows the paid history and the driver has the money", async ({ browser }) => {
  const biz = await apiLogin(browser, "0500000001");
  const drv = await apiLogin(browser, "0500000014"); // Nasser (van/cold) — different driver from other specs
  await api(drv.request, "PUT", "/driver/availability", { available: true });
  const start = new Date(Date.now() + 3 * 3600e3).toISOString();
  const pub = await api(biz.request, "POST", "/requests", { service: "delivery_driver", quantity: 1, shipmentsPerDriver: 10, vehicleType: "van", temperature: "cold", pickupCity: "riyadh", deliveryCity: "riyadh", pickupAddress: "Warehouse 4, Industrial Area", durationDays: 1, startsAt: start, publish: true, termsAccepted: true,
    shipments: Array.from({ length: 10 }, (_, i) => ({ recipientName: `Customer ${i + 1}`, recipientPhone: `05100000${String(i + 10)}`, address: `${i + 1} Olaya St, Riyadh` })) });
  expect(pub.status).toBe(201);
  const offers = await api(drv.request, "GET", "/driver/offers");
  const offer = offers.json.items.find((o: any) => o.requestId === pub.json.id);
  expect(offer).toBeTruthy();
  expect((await api(drv.request, "POST", `/offers/${offer.offerId}/accept`, { termsAccepted: true })).status).toBe(200);
  // the one-active-job rule: while this job is open the driver sees no other offers
  expect((await api(drv.request, "GET", "/driver/offers")).json).toMatchObject({ items: [], hidden: true });
  // a driver too far from the warehouse cannot check in; one standing at it can (demo warehouse: central Riyadh)
  expect((await api(drv.request, "POST", `/offers/${offer.offerId}/checkin`, { lat: 24.9, lng: 46.9 })).json.error.code).toBe("TOO_FAR_FROM_WAREHOUSE");
  expect((await api(drv.request, "POST", `/offers/${offer.offerId}/checkin`, { lat: 24.7136, lng: 46.6753 })).status).toBe(200);
  await api(biz.request, "POST", `/offers/${offer.offerId}/attendance`, { present: true });
  // the driver scans the parcels onto the vehicle (nothing for the warehouse to record), finishes loading, approves the route and works the stops
  const list = (await api(biz.request, "GET", `/requests/${pub.json.id}/shipments?pageSize=200`)).json.items as Array<{ id: string; code: string; seq: number; demoOtp: string }>;
  expect(list).toHaveLength(10);
  for (const sp of list) expect((await api(drv.request, "POST", `/offers/${offer.offerId}/loading/scan`, { code: sp.code })).status).toBe(200);
  const fin = await api(drv.request, "POST", `/offers/${offer.offerId}/loading/finish`, {});
  expect(fin.status).toBe(200); expect(fin.json.loaded).toBe(10);
  expect((await api(drv.request, "POST", `/offers/${offer.offerId}/route/approve`)).status).toBe(200);
  const job = (await api(drv.request, "GET", `/driver/jobs/${offer.offerId}`)).json;
  const order = (job.stops as Array<{ id: string }>).map((s) => list.find((x) => x.id === s.id)!);
  expect((await api(drv.request, "POST", `/offers/${offer.offerId}/stops/${order[1].id}/arrive`, {})).status).toBe(409); // not the current stop: refused (never bulk)
  for (const sp of order) {
    expect((await api(drv.request, "POST", `/offers/${offer.offerId}/stops/${sp.id}/arrive`, {})).status).toBe(200);
    if (sp === order[0]) expect((await api(drv.request, "POST", `/offers/${offer.offerId}/stops/${sp.id}/deliver`, { code: sp.code })).status).toBe(422); // no recipient code → refused
    expect((await api(drv.request, "POST", `/offers/${offer.offerId}/stops/${sp.id}/deliver`, { code: sp.code, otp: sp.demoOtp })).status).toBe(200);
  }
  const done = await api(drv.request, "POST", `/offers/${offer.offerId}/delivered`, {});
  expect(done.status).toBe(200); expect(done.json.status).toBe("completed"); // E16/E18: confirmed and settled by the system
  // …so the money is already in the driver's wallet — provider cost × units (van cold: 9.00 + 1.50 = 10.50 × 10 = 105.00)
  expect((await api(drv.request, "GET", "/wallet")).json.availableCents).toBe(10500);
  expect((await api(drv.request, "GET", "/driver/offers")).json.hidden).toBe(false); // free again

  // finance sees it in the history as PAID, with no action buttons at all
  const page = await (await browser.newContext()).newPage();
  await staffLogin(page, "finance1@jrlogistics.demo", DEMO.staffPw);
  await gotoReady(page, "/admin/finance");
  await expect(page.getByTestId("foa-fin-auto-notice")).toBeVisible();
  await expect(page.getByTestId("foa-fin-on-hold")).toBeVisible();
  await gotoReady(page, "/admin/finance/settlements"); // the history is its own page of the Finance group now
  const row = page.locator("tr", { hasText: "SAR" }).first();
  await expect(row).toBeVisible();
  await expect(page.getByTestId("foa-settle-status-paid").first()).toBeVisible();
  for (const name of ["Review", "Approve", "Pay", "Reject", "Retry"]) await expect(page.getByRole("button", { name, exact: true })).toHaveCount(0);
  const summary = await api(page.context().request, "GET", "/admin/finance/summary");
  expect(summary.json.platformRevenueCents).toBeGreaterThan(0); expect(summary.json.pendingSettlements).toBe(0);
});

test("driver uploads documents in the UI; HR staff approve them; driver becomes verified", async ({ page, browser }) => {
  await gotoReady(page, "/register?role=driver");
  await page.getByRole("radio", { name: /Driver/ }).click();
  await page.getByTestId("reg-username").fill("doc.test.driver");
  await page.getByTestId("reg-password").fill("Doc#Driver2026");
  await page.getByTestId("reg-confirm").fill("Doc#Driver2026");
  await page.getByTestId("reg-phone").fill("0522233344");
  await page.getByLabel(/Full name/).fill("Doc Test Driver");
  await page.getByLabel("City").selectOption("riyadh");
  await page.getByLabel("Vehicle type").selectOption("sedan");
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: "Create account" }).click();
  await page.waitForURL(/\/driver$/);

  await page.goto("/driver/documents");
  const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
  for (const label of ["National ID / Iqama", "Driving license", "Vehicle registration"]) {
    const card = page.locator("section", { hasText: label }).first();
    await card.locator('input[type="file"]').setInputFiles({ name: "doc.png", mimeType: "image/png", buffer: png });
    await expect(card.getByText("Submitted")).toBeVisible();
  }

  const staff = await (await browser.newContext()).newPage();
  await staffLogin(staff, "hr@jrlogistics.demo", "Demo#Pass2026");
  await staff.goto("/admin/verification/documents"); // the documents queue is its own page of the verification workspace (it was the first tab)
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
