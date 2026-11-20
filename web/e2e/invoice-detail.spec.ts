import { test, expect, type APIRequestContext, type Page } from "@playwright/test";
import { staffLogin, gotoReady, otpLogin, apiLogin, DEMO } from "./helpers";
import { setFieldModes, type FieldModes } from "./field-modes";

/**
 * Invoice detail views: the admin page `/admin/finance/invoices/[id]` (the tax invoice sheet, then money breakdown, settlement, ledger, price snapshot, activity)
 * and the company page `/business/wallet/invoices/[id]` (the same sheet, nothing about provider cost or margin), their APIs, print, a phone and Arabic.
 * The spec settles a job of its own through the APIs (specs share one database: everything is asserted against that one invoice, found by its order reference).
 */
test.describe.configure({ mode: "serial" });

let savedModes: FieldModes; // J2 / J3: routing and B2B shipments are OFF by default — this spec drives routes / "Approve route" / business parcels
test.beforeAll(async ({ browser }) => { savedModes = await setFieldModes(browser, { routingEnabled: true, b2bShipmentsEnabled: true }); });
test.afterAll(async ({ browser }) => { await setFieldModes(browser, savedModes); });

const BASE = `http://localhost:${process.env.E2E_PORT ?? 3101}`; // not 3100: other projects on this machine use it
const ADMIN = { email: "admin@jrlogistics.test", password: "E2e!Password2026" };
const UNKNOWN = "00000000-0000-4000-8000-000000000000";
const job: { id: string; number: string; requestId: string; ref: string; total: number } = { id: "", number: "", requestId: "", ref: "", total: 0 };

async function api(ctx: APIRequestContext, method: "GET" | "POST" | "PUT", path: string, data?: unknown) {
  const res = await ctx.fetch(`${BASE}/api/v1${path}`, { method, data, headers: { origin: BASE, "content-type": "application/json" } });
  const text = await res.text();
  let json: any = null; try { json = JSON.parse(text); } catch { /* not json */ }
  return { status: res.status(), json, text };
}
const admin = (page: Page) => staffLogin(page, ADMIN.email, ADMIN.password);
const noSideScroll = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
const money = (cents: number) => (cents / 100).toFixed(2);
const sum = (lines: Array<{ amountCents: number | null }>) => lines.reduce((a, l) => a + (l.amountCents ?? 0), 0);

test("a job of our own is delivered and paid, so there is an invoice to look at", async ({ browser }) => {
  const biz = await apiLogin(browser, DEMO.business);
  const drv = await apiLogin(browser, DEMO.driver); // Omar (sedan)
  await api(drv.request, "PUT", "/driver/availability", { available: true });
  const pub = await api(biz.request, "POST", "/requests", { service: "delivery_driver", quantity: 1, shipmentsPerDriver: 10, vehicleType: "sedan", pickupCity: "riyadh", deliveryCity: "riyadh", pickupAddress: "Warehouse 4, Industrial Area", durationDays: 1, startsAt: new Date(Date.now() + 3 * 3600e3).toISOString(), publish: true, termsAccepted: true,
    shipments: Array.from({ length: 3 }, (_, i) => ({ recipientName: `Invoice Customer ${i + 1}`, recipientPhone: `05300000${String(i + 10)}`, address: `${i + 1} Olaya St, Riyadh` })) });
  expect(pub.status, pub.text).toBe(201);
  const offer = (await api(drv.request, "GET", "/driver/offers")).json.items.find((o: any) => o.requestId === pub.json.id);
  expect(offer, "the driver is offered the job").toBeTruthy();
  expect((await api(drv.request, "POST", `/offers/${offer.offerId}/accept`, { termsAccepted: true })).status).toBe(200);
  expect((await api(drv.request, "POST", `/offers/${offer.offerId}/checkin`, { lat: 24.7136, lng: 46.6753 })).status).toBe(200);
  await api(biz.request, "POST", `/offers/${offer.offerId}/attendance`, { present: true });
  const list = (await api(biz.request, "GET", `/requests/${pub.json.id}/shipments?pageSize=200`)).json.items as Array<{ id: string; code: string; demoOtp: string }>;
  expect(list).toHaveLength(3);
  for (const sp of list) expect((await api(drv.request, "POST", `/offers/${offer.offerId}/loading/scan`, { code: sp.code })).status).toBe(200);
  expect((await api(drv.request, "POST", `/offers/${offer.offerId}/loading/finish`, {})).status).toBe(200);
  expect((await api(drv.request, "POST", `/offers/${offer.offerId}/route/approve`)).status).toBe(200);
  const stops = ((await api(drv.request, "GET", `/driver/jobs/${offer.offerId}`)).json.stops as Array<{ id: string }>).map((s) => list.find((x) => x.id === s.id)!);
  for (const sp of stops) {
    expect((await api(drv.request, "POST", `/offers/${offer.offerId}/stops/${sp.id}/arrive`, {})).status).toBe(200);
    expect((await api(drv.request, "POST", `/offers/${offer.offerId}/stops/${sp.id}/deliver`, { code: sp.code, otp: sp.demoOtp })).status).toBe(200);
  }
  expect((await api(drv.request, "POST", `/offers/${offer.offerId}/delivered`, {})).json.status).toBe("completed");
  const mine = (await api(biz.request, "GET", "/business/invoices?page=1")).json.items as Array<{ id: string; number: string; requestId: string; requestRef: string; totalCents: number }>;
  const inv = mine.find((i) => i.requestRef === pub.json.ref);
  expect(inv, "the settled job issued an invoice").toBeTruthy();
  Object.assign(job, { id: inv!.id, number: inv!.number, requestId: inv!.requestId, ref: pub.json.ref, total: inv!.totalCents });
  expect(job.total).toBeGreaterThan(0);
  await biz.close(); await drv.close();
});

test("the APIs: staff with finance.view get the whole invoice, a company only its own part, everybody else is refused, unknown ids are 404", async ({ page, browser }) => {
  await admin(page); const staff = page.context();
  const a = await api(staff.request, "GET", `/admin/finance/invoices/${job.id}`);
  expect(a.status, a.text).toBe(200);
  expect(a.json.invoice).toMatchObject({ id: job.id, number: job.number, totalCents: job.total });
  expect(a.json.invoice.subtotalCents + a.json.invoice.vatCents).toBe(a.json.invoice.totalCents);
  expect(sum(a.json.lines)).toBe(job.total); // the lines add up to the invoice total exactly
  expect(a.json.parcels).toMatchObject({ total: 3, delivered: 3 });
  expect(a.json.admin.settlement).toMatchObject({ status: "paid", customerCents: job.total });
  expect(a.json.admin.settlement.customerCents).toBe(a.json.admin.settlement.providerCents + a.json.admin.settlement.marginCents);
  expect(a.json.admin.ledger.length).toBeGreaterThanOrEqual(4);
  expect(a.json.admin.payee.id).toBeTruthy();
  expect((await api(staff.request, "GET", `/admin/finance/invoices/${UNKNOWN}`)).status).toBe(404);
  expect((await api(staff.request, "GET", "/admin/finance/invoices/not-a-uuid")).status).toBe(404);
  expect((await api(staff.request, "GET", "/admin/finance/invoices/totals")).status).toBe(200); // the totals route still comes first

  const biz = await apiLogin(browser, DEMO.business);
  const b = await api(biz.request, "GET", `/business/invoices/${job.id}`);
  expect(b.status, b.text).toBe(200);
  expect(b.json.lines).toEqual(a.json.lines); expect(b.json.invoice).toEqual(a.json.invoice);
  expect(b.json.admin).toBeUndefined();
  expect(b.text).not.toMatch(/provider|margin|payee|ledger|snapshot|settlementId/i);
  expect((await api(biz.request, "GET", `/business/invoices/${UNKNOWN}`)).status).toBe(404);
  expect((await api(biz.request, "GET", `/admin/finance/invoices/${job.id}`)).status).toBe(403); // a company never reaches the back office route
  const drv = await apiLogin(browser, DEMO.driver);
  expect((await api(drv.request, "GET", `/business/invoices/${job.id}`)).status).toBe(403);
  expect((await api(drv.request, "GET", `/admin/finance/invoices/${job.id}`)).status).toBe(403);
  const anon = await browser.newContext();
  expect((await api(anon.request, "GET", `/business/invoices/${job.id}`)).status).toBe(401);
  expect((await api(anon.request, "GET", `/admin/finance/invoices/${job.id}`)).status).toBe(401);
  const ops = await browser.newContext(); // the operations preset has no finance.view
  expect((await api(ops.request, "POST", "/auth/staff/login", { email: "ops@jrlogistics.demo", password: DEMO.staffPw })).status).toBe(200);
  expect((await api(ops.request, "GET", `/admin/finance/invoices/${job.id}`)).status).toBe(403);
  const fin = await browser.newContext(); // the finance preset has
  expect((await api(fin.request, "POST", "/auth/staff/login", { email: "finance1@jrlogistics.demo", password: DEMO.staffPw })).status).toBe(200);
  expect((await api(fin.request, "GET", `/admin/finance/invoices/${job.id}`)).status).toBe(200);
  await Promise.all([biz.close(), drv.close(), anon.close(), ops.close(), fin.close()]);
});

test("the list links every invoice to its page: the number and an Open action, with CSV and filters kept", async ({ page }) => {
  await admin(page);
  await gotoReady(page, "/admin/finance/invoices");
  await expect(page.getByTestId("fin-invoices-csv")).toBeVisible();
  await expect(page.getByTestId("fin-invoices-business")).toBeVisible();
  const open = page.getByRole("link", { name: `Open invoice ${job.number}` });
  await expect(open).toBeVisible();
  expect(await page.getByTestId("fin-invoice-open").count()).toBeGreaterThan(0);
  await expect(page.getByRole("link", { name: job.number, exact: true })).toHaveAttribute("href", `/admin/finance/invoices/${job.id}`);
  await open.click();
  await expect(page).toHaveURL(new RegExp(`/admin/finance/invoices/${job.id}$`));
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(job.number);
});

test("admin page: the tax invoice sheet, then the money, the settlement, the ledger, the price and the activity of the settlement", async ({ page }) => {
  await admin(page);
  const d = (await api(page.request, "GET", `/admin/finance/invoices/${job.id}`)).json;
  await gotoReady(page, `/admin/finance/invoices/${job.id}`);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(job.number);
  await expect(page.locator('nav[aria-label="Breadcrumb"]').last()).toContainText(job.number);
  await expect(page.locator('nav[aria-label="Breadcrumb"]').last().getByRole("link", { name: "Invoices" })).toHaveAttribute("href", "/admin/finance/invoices");
  const sheet = page.getByTestId("inv-sheet");
  await expect(sheet.getByTestId("inv-number")).toHaveText(job.number);
  await expect(sheet.getByTestId("inv-seller")).toContainText("JR Logistics");
  await expect(sheet.getByTestId("inv-buyer")).toContainText(d.buyer.name);
  await expect(sheet.getByTestId("inv-order-link")).toHaveText(job.ref);
  await expect(sheet.getByTestId("inv-paid")).toBeVisible(); // the "paid" stamp
  await expect(sheet.getByTestId("inv-line")).toHaveCount(d.lines.length);
  await expect(sheet.getByTestId("inv-line").first()).toContainText("3"); // 3 parcels delivered
  await expect(sheet.getByTestId("inv-subtotal")).toContainText(money(d.invoice.subtotalCents));
  await expect(sheet.getByTestId("inv-vat")).toContainText(money(d.invoice.vatCents));
  await expect(sheet.getByTestId("inv-total")).toContainText(money(job.total));
  await expect(sheet.getByTestId("inv-notes")).toContainText("include VAT");
  // staff-only blocks below the sheet
  await expect(page.getByTestId("inv-money")).toContainText("Provider cost");
  await expect(page.getByTestId("inv-money")).toContainText("Platform margin");
  await expect(page.getByTestId("inv-money")).toContainText(money(d.admin.settlement.providerCents));
  await expect(page.locator("#inv-settlement")).toContainText("Paid");
  await expect(page.getByTestId("inv-ledger-row")).toHaveCount(d.admin.ledger.length);
  await expect(page.getByTestId("inv-snapshot")).toContainText("Unit price");
  await expect(page.getByTestId("dtk-log")).toBeVisible(); // the settlement's activity log, notes and raw record
  await expect(page.getByTestId("dtk-notes")).toBeVisible();
  await page.getByTestId("inv-raw-toggle").click();
  await expect(page.getByTestId("inv-raw")).toBeVisible();
  // the links out
  await expect(page.getByTestId("inv-open-order")).toHaveAttribute("href", `/admin/requests/${job.requestId}`);
  await expect(page.getByTestId("inv-open-company")).toHaveAttribute("href", `/admin/companies/${d.buyer.id}`);
  await expect(page.getByTestId("inv-open-settlement")).toHaveAttribute("href", /\/admin\/finance\/settlements/);
  // actions: copy the number, print
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"], { origin: BASE });
  await page.getByTestId("inv-copy").click();
  await expect(page.getByText("Copied").first()).toBeVisible();
  await page.evaluate(() => { (window as any).__printed = 0; window.print = () => { (window as any).__printed++; }; });
  await page.getByTestId("inv-print").click();
  expect(await page.evaluate(() => (window as any).__printed)).toBe(1);
});

test("printing keeps only the sheet, on white paper in black ink", async ({ page }) => {
  await admin(page);
  await gotoReady(page, `/admin/finance/invoices/${job.id}`);
  await page.emulateMedia({ media: "print" });
  await expect(page.getByTestId("inv-sheet")).toBeVisible();
  await expect(page.getByTestId("inv-admin")).toBeHidden(); // the staff-only panels never print
  await expect(page.getByTestId("inv-print")).toBeHidden();
  await expect(page.locator("aside").first()).toBeHidden();
  const ink = await page.evaluate(() => { const s = document.querySelector('[data-testid="inv-sheet"]')!; const n = s.querySelector('[data-testid="inv-number"]')!; return { paper: getComputedStyle(document.body).backgroundColor, text: getComputedStyle(n).color, border: getComputedStyle(s).borderTopWidth }; });
  expect(ink).toEqual({ paper: "rgb(255, 255, 255)", text: "rgb(0, 0, 0)", border: "0px" });
  await page.emulateMedia({ media: "screen" });
  await expect(page.getByTestId("inv-admin")).toBeVisible();
});

test("admin: a company's neighbouring invoices, other invoices of the order, and the links from the order and company views", async ({ page }) => {
  await admin(page);
  // the order's Money tab links the invoice to its page
  await gotoReady(page, `/admin/requests/${job.requestId}/money`);
  await page.getByTestId("order-invoice-link").first().click();
  await expect(page).toHaveURL(new RegExp(`/admin/finance/invoices/${job.id}$`));
  // the company's Finance tab does too
  const buyer = await page.getByTestId("inv-open-company").getAttribute("href");
  await gotoReady(page, `${buyer}/finance`);
  await expect(page.getByTestId("companies-invoice-link").first()).toBeVisible();
  await page.getByTestId("companies-invoice-link").first().click();
  await expect(page).toHaveURL(/\/admin\/finance\/invoices\/[0-9a-f-]{36}$/);
  // not found, and no permission
  await gotoReady(page, `/admin/finance/invoices/${UNKNOWN}`);
  await expect(page.getByTestId("inv-not-found")).toBeVisible();
  await gotoReady(page, "/admin/finance/invoices/not-a-uuid");
  await expect(page.getByTestId("inv-not-found")).toBeVisible();
});

test("staff without finance.view get a plain no-permission note, not a page of failed requests", async ({ browser }) => {
  const page = await (await browser.newContext()).newPage();
  const denied: string[] = [];
  page.on("response", (r) => { if (r.status() === 403 && /\/api\/v1\/admin\/finance\/invoices/.test(r.url())) denied.push(r.url()); });
  await staffLogin(page, "ops@jrlogistics.demo", DEMO.staffPw);
  await gotoReady(page, `/admin/finance/invoices/${job.id}`);
  await expect(page.getByText("You don't have permission to do that.")).toBeVisible();
  await expect(page.getByTestId("inv-sheet")).toHaveCount(0);
  expect(denied).toEqual([]);
});

test("company page: the same sheet from the wallet and the order, ready to print, with nothing about provider cost or margin", async ({ page }) => {
  await otpLogin(page, DEMO.business);
  await gotoReady(page, "/business/wallet");
  const link = page.locator("#invoices").getByTestId("wallet-invoice-link").filter({ hasText: job.number });
  await expect(link).toBeVisible();
  await link.click();
  await expect(page).toHaveURL(new RegExp(`/business/wallet/invoices/${job.id}$`));
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(job.number);
  await expect(page.locator('nav[aria-label="Breadcrumb"]').last().getByRole("link", { name: "Wallet" })).toBeVisible();
  const sheet = page.getByTestId("inv-sheet");
  await expect(sheet.getByTestId("inv-number")).toHaveText(job.number);
  await expect(sheet.getByTestId("inv-total")).toContainText(money(job.total));
  await expect(sheet.getByTestId("inv-paid")).toBeVisible();
  await expect(sheet.getByTestId("inv-line").first()).toContainText("3");
  await expect(page.getByTestId("inv-print")).toBeVisible();
  await expect(page.getByTestId("inv-admin")).toHaveCount(0);
  for (const word of ["Provider cost", "Platform margin", "Ledger entries", "Pricing snapshot", "Settlement and payee"]) await expect(page.getByText(word)).toHaveCount(0);
  await expect(page.getByTestId("inv-open-order")).toHaveAttribute("href", `/business/requests/${job.requestId}`);
  // the order's Money section links to the same page
  await gotoReady(page, `/business/requests/${job.requestId}/money`);
  await expect(page.getByTestId("order-invoice-link").first()).toHaveAttribute("href", `/business/wallet/invoices/${job.id}`);
  // another company's invoice is "not found" (the unknown id stands in for it)
  await gotoReady(page, `/business/wallet/invoices/${UNKNOWN}`);
  await expect(page.getByTestId("inv-not-found")).toBeVisible();
});

test("a phone shows both pages without sideways scrolling, and Arabic switches to right-to-left with real translations", async ({ page }) => {
  await admin(page);
  await page.setViewportSize({ width: 390, height: 800 });
  await gotoReady(page, `/admin/finance/invoices/${job.id}`);
  await expect(page.getByTestId("inv-sheet")).toBeVisible();
  expect(await noSideScroll(page), "admin invoice").toBe(true);
  await gotoReady(page, "/admin/finance/invoices");
  expect(await noSideScroll(page), "invoices list").toBe(true);
  await page.context().addCookies([{ name: "jr_lang", value: "ar", url: BASE }]);
  await gotoReady(page, `/admin/finance/invoices/${job.id}`);
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  await expect(page.getByTestId("inv-sheet")).toContainText("فاتورة ضريبية");
  await expect(page.getByTestId("inv-money")).toBeVisible();
  await expect(page.getByTestId("inv-number")).toHaveText(job.number); // numbers keep their order
  expect(await noSideScroll(page), "admin invoice in Arabic").toBe(true);
  await page.setViewportSize({ width: 1280, height: 900 });
  expect(await noSideScroll(page), "admin invoice in Arabic on desktop").toBe(true);
  const dirs = await page.evaluate(() => [...document.querySelectorAll('[data-testid="inv-total"],[data-testid="inv-number"]')].map((e) => getComputedStyle(e).direction));
  expect(dirs).toEqual(["ltr", "ltr"]);
});
