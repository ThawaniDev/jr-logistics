import { test, expect, type APIRequestContext, type BrowserContext, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { apiLogin, DEMO } from "./helpers";
import { setFieldModes, type FieldModes } from "./field-modes";

/**
 * J6 — `/business/cash`: Warehouse and Office columns in the holders' orders tables and in the history, the office under every driver's name, and the Table / By driver toggle (one flat
 * table of all orders with column sorting, search and a CSV of what is shown). Two cash orders are made here through the API (the endpoints the apps call): one carried by Tariq, who
 * belongs to Al Wajiha Courier Office, and one by Omar, an independent driver. Each order has its own pickup address, so the rows are found by their warehouse text and offer id —
 * the specs share one database.
 */
test.describe.configure({ mode: "serial" });
test.use({ actionTimeout: 20_000 });
let saved: FieldModes; // routing is OFF by default (J2): this spec drives "Approve route"
test.beforeAll(async ({ browser }) => { saved = await setFieldModes(browser, { routingEnabled: true }); });
test.afterAll(async ({ browser }) => { await setFieldModes(browser, saved); });

const BASE = `http://localhost:${process.env.E2E_PORT ?? 3101}`; // not 3100: other projects on this machine use it
const WAREHOUSE = { lat: 24.7136, lng: 46.6753 };
const OFFICE_NAME = "Al Wajiha Courier Office";
const WH_OFFICE = "E2E Cash Depot North, Industrial Area", WH_SOLO = "E2E Cash Depot South, Olaya";
const ready = async (page: Page, url: string) => { await page.goto(url); await page.waitForSelector('html[data-hydrated="true"]'); };

async function api(ctx: APIRequestContext, method: "GET" | "POST" | "PUT", path: string, data?: unknown) {
  const res = await ctx.fetch(`${BASE}/api/v1${path}`, { method, data, headers: { origin: BASE, "content-type": "application/json" } });
  return { status: res.status(), json: await res.json().catch(() => null) };
}
/** One delivery order with one cash-on-delivery parcel, carried by `drv` from the first line of `pickup`: everything up to "delivered". */
async function cashOrder(biz: BrowserContext, drv: BrowserContext, tag: string, pickup: string, cod: number) {
  await api(drv.request, "PUT", "/driver/availability", { available: true });
  const shipments = [{ recipientName: `${tag} Customer`, recipientPhone: `0560000${String(Math.floor(Math.random() * 900) + 100)}`, address: "1 Tahlia St, Riyadh", externalRef: `${tag}-1`, codCents: cod }];
  const pub = await api(biz.request, "POST", "/requests", { service: "delivery_driver", quantity: 1, shipmentsPerDriver: 10, vehicleType: "sedan", pickupCity: "riyadh", deliveryCity: "riyadh", pickupAddress: `${pickup}\nGate 7, second line`, durationDays: 1, startsAt: new Date(Date.now() + 3600_000).toISOString(), shipments, publish: true, termsAccepted: true });
  expect(pub.status, JSON.stringify(pub.json)).toBe(201);
  const offer = (await api(drv.request, "GET", "/driver/offers")).json.items.find((o: any) => o.requestId === pub.json.id);
  expect(offer, `${tag}: an offer for the driver`).toBeTruthy();
  expect((await api(drv.request, "POST", `/offers/${offer.offerId}/accept`, { termsAccepted: true })).status).toBe(200);
  expect((await api(drv.request, "POST", `/offers/${offer.offerId}/checkin`, WAREHOUSE)).status).toBe(200);
  expect((await api(biz.request, "POST", `/offers/${offer.offerId}/attendance`, { present: true })).status).toBe(200);
  const list = (await api(biz.request, "GET", `/requests/${pub.json.id}/shipments?pageSize=50`)).json.items as Array<{ id: string; code: string; codCents: number; demoOtp: string }>;
  for (const s of list) expect((await api(drv.request, "POST", `/offers/${offer.offerId}/loading/scan`, { code: s.code })).status).toBe(200);
  expect((await api(drv.request, "POST", `/offers/${offer.offerId}/loading/finish`, {})).status).toBe(200);
  expect((await api(drv.request, "POST", `/offers/${offer.offerId}/route/approve`)).status).toBe(200);
  for (const s of list) {
    expect((await api(drv.request, "POST", `/offers/${offer.offerId}/stops/${s.id}/arrive`, {})).status).toBe(200);
    expect((await api(drv.request, "POST", `/offers/${offer.offerId}/stops/${s.id}/deliver`, { code: s.code, otp: s.demoOtp, cashCollectedCents: s.codCents })).status).toBe(200);
  }
  expect((await api(drv.request, "POST", `/offers/${offer.offerId}/delivered`, {})).json.status).toBe("completed");
  return { offerId: offer.offerId as string, requestId: pub.json.id as string, ref: pub.json.ref as string };
}

let office: Awaited<ReturnType<typeof cashOrder>>, solo: Awaited<ReturnType<typeof cashOrder>>;

test("by driver: every order row has its warehouse and office, and the office sits under the driver's name", async ({ browser }) => {
  test.setTimeout(240_000);
  const biz = await apiLogin(browser, DEMO.business);
  office = await cashOrder(biz, await apiLogin(browser, "0500000016"), "E2E-CC-OFF", WH_OFFICE, 10_000); // Tariq — Al Wajiha Courier Office
  solo = await cashOrder(biz, await apiLogin(browser, DEMO.driver), "E2E-CC-SOLO", WH_SOLO, 6_000); // Omar — independent
  // the API says the same as the page below
  const cod = (await api(biz.request, "GET", "/business/cod")).json;
  const find = (offerId: string) => { for (const d of cod.drivers) { const o = d.orders.find((x: any) => x.offerId === offerId); if (o) return { d, o }; } };
  expect(find(office.offerId)!.o).toMatchObject({ warehouse: { label: WH_OFFICE, city: "riyadh" }, officeName: OFFICE_NAME });
  expect(find(solo.offerId)!.o).toMatchObject({ warehouse: { label: WH_SOLO, city: "riyadh" }, officeId: null, officeName: null });
  expect(find(office.offerId)!.d.officeName).toBe(OFFICE_NAME);

  const page = await biz.newPage();
  await ready(page, "/business/cash");
  const row = (id: string) => page.locator(`[data-testid="cod-order"][data-offer="${id}"]`);
  await expect(row(office.offerId)).toBeVisible();
  await expect(row(office.offerId).getByTestId("cod-col-warehouse")).toContainText(WH_OFFICE);
  await expect(row(office.offerId).getByTestId("cod-col-warehouse")).not.toContainText("Gate 7"); // the first line only
  await expect(row(office.offerId).getByTestId("cod-col-warehouse")).toContainText("Riyadh");
  await expect(row(office.offerId).getByTestId("cod-col-office")).toContainText(OFFICE_NAME);
  await expect(row(solo.offerId).getByTestId("cod-col-warehouse")).toContainText(WH_SOLO);
  await expect(row(solo.offerId).getByTestId("cod-col-office")).toContainText("Independent driver");
  // under the driver's name in the section header
  const section = (id: string) => page.locator(`[data-testid="cod-driver"]:has([data-offer="${id}"])`);
  await expect(section(office.offerId).getByTestId("cod-driver-office")).toContainText(`Office: ${OFFICE_NAME}`);
  await expect(section(solo.offerId).getByTestId("cod-driver-office")).toContainText("Independent driver");
  // the existing test ids still work: receive part of the office order through the dialog
  await row(office.offerId).getByTestId("cod-order-receive").click();
  await page.getByTestId("cod-amount").fill("40.00");
  await page.getByTestId("cod-receive-submit").click();
  await expect(page.getByTestId("cod-history-row").first()).toContainText(WH_OFFICE);
  // the history has the same two columns
  const hist = page.getByTestId("cod-history-row").filter({ hasText: office.ref }).first();
  await expect(hist.getByTestId("cod-col-warehouse")).toContainText(WH_OFFICE);
  await expect(hist.getByTestId("cod-col-office")).toContainText(OFFICE_NAME);
  await page.screenshot({ path: "test-results/cash-by-driver.png", fullPage: false });
});

test("table view: all orders in one table, sortable columns, search, only outstanding, CSV of what is shown", async ({ browser }) => {
  const biz = await apiLogin(browser, DEMO.business);
  const page = await biz.newPage();
  await ready(page, "/business/cash");
  await expect(page.getByTestId("cod-view-driver")).toHaveAttribute("aria-pressed", "true");
  await page.getByTestId("cod-view-table").click();
  await expect(page).toHaveURL(/[?&]view=table/);
  await expect(page.getByTestId("cod-view-table")).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByTestId("cod-all-table")).toBeVisible();
  for (const h of ["Reference", "Warehouse", "Office", "Driver"]) await expect(page.getByTestId("cod-all-table").locator("th", { hasText: h }).first()).toBeVisible();
  const row = (id: string) => page.locator(`[data-testid="cod-all-row"][data-offer="${id}"]`);
  await page.getByTestId("cod-all-search").fill("E2E Cash Depot"); // narrows the shared database to this spec's two orders
  await expect(page.getByTestId("cod-all-row")).toHaveCount(2);
  await expect(row(office.offerId).getByTestId("cod-col-warehouse")).toContainText(WH_OFFICE);
  await expect(row(office.offerId).getByTestId("cod-col-office")).toContainText(OFFICE_NAME);
  await expect(row(office.offerId).getByTestId("cod-all-driver")).toContainText("Tariq");
  await expect(row(solo.offerId).getByTestId("cod-col-office")).toContainText("Independent driver");
  await expect(row(solo.offerId).getByTestId("cod-all-driver")).toContainText("Omar");
  // received amount of the office order (40.00) shows; outstanding = 100.00 − 40.00
  await expect(row(office.offerId)).toContainText("60.00");
  // column sorting: Office ascending puts the named office before "Independent driver" (blanks last), and the header says so
  await page.getByTestId("sort-office").click();
  await expect(page.locator('th[aria-sort="ascending"]')).toContainText("Office");
  const order = async () => (await page.getByTestId("cod-all-row").evaluateAll((rs) => rs.map((r) => r.getAttribute("data-offer"))));
  expect(await order()).toEqual([office.offerId, solo.offerId]);
  await page.getByTestId("sort-office").click(); // flips to descending: the named office is still before the blank one
  await expect(page.locator('th[aria-sort="descending"]')).toContainText("Office");
  expect(await order()).toEqual([office.offerId, solo.offerId]);
  await page.getByTestId("sort-collected").click(); // numbers start descending
  await expect(page.locator('th[aria-sort="descending"]')).toContainText(/Collected/);
  expect(await order()).toEqual([office.offerId, solo.offerId]); // 100.00 before 60.00
  await page.getByTestId("sort-collected").click();
  expect(await order()).toEqual([solo.offerId, office.offerId]);
  // search by office, by driver and by order number; a miss shows the empty state
  await page.getByTestId("cod-all-search").fill("Al Wajiha");
  await expect(page.getByTestId("cod-all-row").filter({ has: page.getByTestId("cod-col-office") })).not.toHaveCount(0);
  for (const r of await page.getByTestId("cod-all-row").all()) await expect(r.getByTestId("cod-col-office")).toContainText(OFFICE_NAME);
  await page.getByTestId("cod-all-search").fill(solo.ref);
  await expect(page.getByTestId("cod-all-row")).toHaveCount(1);
  await page.getByTestId("cod-all-search").fill("zzzz-no-such-order");
  await expect(page.getByTestId("cod-all-row")).toHaveCount(0);
  await expect(page.getByTestId("cod-all-table")).toContainText("No orders match");
  await page.getByTestId("cod-all-search").fill("E2E Cash Depot");
  await page.getByTestId("cod-all-only-outstanding").click();
  await expect(page.getByTestId("cod-all-only-outstanding")).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByTestId("cod-all-row")).toHaveCount(2); // both still hold cash
  // the receive button of a row opens the same dialog
  await row(solo.offerId).getByTestId("cod-order-receive").click();
  await expect(page.getByTestId("cod-receive-dialog")).toBeVisible();
  await page.keyboard.press("Escape");
  // CSV of the rows on screen: BOM, header, warehouse, city, office / independent, money in SAR
  const [dl] = await Promise.all([page.waitForEvent("download"), page.getByTestId("cod-all-export").click()]);
  expect(dl.suggestedFilename()).toBe("cash-on-delivery.csv");
  const csv = readFileSync((await dl.path())!, "utf8");
  expect(csv.charCodeAt(0)).toBe(0xfeff);
  const lines = csv.slice(1).trim().split("\n");
  expect(lines[0]).toBe("Reference,Warehouse,City,Office,Driver,Collected by drivers,Received by you,Still with drivers");
  expect(lines).toHaveLength(3);
  const officeLine = lines.find((l) => l.includes(office.ref))!, soloLine = lines.find((l) => l.includes(solo.ref))!;
  expect(officeLine).toBe(`${office.ref},"${WH_OFFICE}",Riyadh,${OFFICE_NAME},Tariq Mahmood,100.00,40.00,60.00`);
  expect(soloLine).toMatch(new RegExp(`^${solo.ref},"?${WH_SOLO}"?,Riyadh,Independent driver,Omar .*,60.00,0.00,60.00$`));
  // back to "by driver": the URL parameter goes, the holders show again
  await page.getByTestId("cod-view-driver").click();
  await expect(page).not.toHaveURL(/view=table/);
  await expect(page.getByTestId("cod-holders")).toBeVisible();
});

test("phone: both views stack into cards with labelled Warehouse / Office cells and nothing scrolls sideways; Arabic is right to left", async ({ browser }) => {
  const biz = await apiLogin(browser, DEMO.business, { viewport: { width: 390, height: 844 } });
  const page = await biz.newPage();
  const noSideScroll = async () => expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1)).toBe(true);
  await ready(page, "/business/cash");
  await noSideScroll();
  const card = page.locator(`[data-testid="cod-order"][data-offer="${office.offerId}"]`);
  await expect(card.locator('td[data-label="Warehouse"]')).toBeVisible();
  await expect(card.locator('td[data-label="Office"]')).toContainText(OFFICE_NAME);
  await page.getByTestId("cod-view-table").click();
  await page.getByTestId("cod-all-search").fill("E2E Cash Depot");
  const row = page.locator(`[data-testid="cod-all-row"][data-offer="${solo.offerId}"]`);
  await expect(row.locator('td[data-label="Warehouse"]')).toContainText(WH_SOLO);
  await expect(row.locator('td[data-label="Office"]')).toContainText("Independent driver");
  await expect(row.locator('td[data-label="Driver"]')).toContainText("Omar");
  await noSideScroll();
  await page.screenshot({ path: "test-results/cash-table-390.png" });
  // Arabic, right to left
  await page.context().addCookies([{ name: "jr_lang", value: "ar", url: BASE }]);
  await ready(page, "/business/cash?view=table");
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  await expect(page.getByTestId("cod-all-table")).toContainText("المستودع");
  await noSideScroll();
  await page.context().addCookies([{ name: "jr_lang", value: "en", url: BASE }]);
});
