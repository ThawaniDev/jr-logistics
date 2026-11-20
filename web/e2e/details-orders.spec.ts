import { test, expect, type APIRequestContext, type Browser, type Page } from "@playwright/test";
import { staffLogin, gotoReady, DEMO, apiLogin } from "./helpers";

/**
 * Order (request) and parcel detail views (decisions G6–G7): the order layout with its route sections (overview, drivers & offers, parcels, money,
 * communication, activity), the parcel view, the permission / 404 rules of their APIs, a phone and Arabic.
 * The spec creates its own published request with three parcels (one with cash on delivery) through the business API and cancels it at the end.
 */
test.describe.configure({ mode: "serial" });
const BASE = `http://localhost:${process.env.E2E_PORT ?? 3101}`; // not 3100: other projects on this machine use it
const ADMIN = { email: "admin@jrlogistics.test", password: "E2e!Password2026" };
const UNKNOWN = "00000000-0000-4000-8000-000000000000";
const req: { id: string; ref: string; parcelId: string; parcelCode: string } = { id: "", ref: "", parcelId: "", parcelCode: "" };

async function api(ctx: APIRequestContext, method: "GET" | "POST", path: string, data?: unknown) {
  const res = await ctx.fetch(`${BASE}/api/v1${path}`, { method, data, headers: { origin: BASE, "content-type": "application/json" } });
  const text = await res.text();
  let json: any = null; try { json = JSON.parse(text); } catch { /* csv */ }
  return { status: res.status(), json, text, headers: res.headers() };
}
const businessApi = (browser: Browser) => apiLogin(browser, DEMO.business); // the shared helper reuses the session of an earlier sign-in (the OTP endpoint is rate-limited per IP)
const admin = (page: Page) => staffLogin(page, ADMIN.email, ADMIN.password);
const tab = (page: Page, name: RegExp) => page.getByRole("navigation", { name: req.ref }).getByRole("link", { name });
const noSideScroll = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);

test("a published request with three parcels for the views below", async ({ browser }) => {
  const biz = await businessApi(browser);
  const shipments = [1, 2, 3].map((n) => ({ recipientName: `Detail Customer ${n}`, recipientPhone: `05600000${String(n + 10)}`, address: `${n} Olaya St, Riyadh`, externalRef: `DET-${n}`, contents: "Books", ...(n === 1 ? { codCents: 7500 } : {}) }));
  const pub = await api(biz.request, "POST", "/requests", { service: "delivery_driver", quantity: 1, shipmentsPerDriver: 10, vehicleType: "dokker", pickupCity: "riyadh", deliveryCity: "riyadh", pickupAddress: "Warehouse 4, Industrial Area", durationDays: 1, startsAt: new Date(Date.now() + 6 * 864e5).toISOString(), publish: true, termsAccepted: true, shipments });
  expect(pub.status, JSON.stringify(pub.json)).toBe(201);
  req.id = pub.json.id; req.ref = pub.json.ref;
  await biz.close();
});

test("the order APIs answer for staff, refuse a business, and 404 an unknown order or parcel", async ({ page, browser }) => {
  await admin(page);
  const o = await api(page.request, "GET", `/admin/requests/${req.id}/overview`);
  expect(o.status, o.text).toBe(200);
  expect(o.json.request.ref).toBe(req.ref);
  expect(o.json.kpis.parcels).toMatchObject({ total: 3, delivered: 0, pending: 3 });
  expect(o.json.kpis.cod.dueCents).toBe(7500);
  expect(o.json.flags).toMatchObject({ manifest: true, allOrNothing: false, createdVia: expect.stringMatching(/web|api|mobile/) });
  expect(o.json.milestones.map((m: any) => m.key)).toContain("published");
  const parcels = await api(page.request, "GET", `/admin/requests/${req.id}/parcels?pageSize=2`);
  expect(parcels.json).toMatchObject({ total: 3, pageSize: 2 }); expect(parcels.json.items).toHaveLength(2);
  req.parcelId = parcels.json.items[0].id; req.parcelCode = parcels.json.items[0].code;
  expect((await api(page.request, "GET", `/admin/requests/${req.id}/parcels?cod=1`)).json.total).toBe(1);
  expect((await api(page.request, "GET", `/admin/requests/${req.id}/parcels?q=DET-2`)).json.total).toBe(1);
  expect((await api(page.request, "GET", `/admin/requests/${req.id}/offers`)).status).toBe(200);
  expect((await api(page.request, "GET", `/admin/requests/${req.id}/money`)).json.pricing.snapshot.totalUnits).toBe(3);
  expect((await api(page.request, "GET", `/admin/requests/${req.id}/communication`)).json.chat.threads).toEqual([]);
  const d = await api(page.request, "GET", `/admin/shipments/${req.parcelId}/detail`);
  expect(d.status, d.text).toBe(200); expect(d.json.parcel.code).toBe(req.parcelCode); expect(d.json.journey.map((e: any) => e.type)).toContain("created");
  const csv = await api(page.request, "GET", `/admin/requests/${req.id}/parcels?format=csv`);
  expect(csv.status).toBe(200); expect(csv.headers["content-type"]).toContain("text/csv"); expect(csv.text.split("\n")).toHaveLength(4);
  for (const path of [`/admin/requests/${UNKNOWN}/overview`, `/admin/requests/not-a-uuid/parcels`, `/admin/shipments/${UNKNOWN}/detail`]) expect((await api(page.request, "GET", path)).status, path).toBe(404);
  const biz = await businessApi(browser);
  for (const path of [`/admin/requests/${req.id}/overview`, `/admin/requests/${req.id}/money`, `/admin/shipments/${req.parcelId}/detail`]) expect((await api(biz.request, "GET", path)).status, path).toBe(403);
  await biz.close();
});

test("order view: header with flags and facts, key figures with definitions, tabs, milestones, funnel, mix and map", async ({ page }) => {
  await admin(page);
  await gotoReady(page, `/admin/requests/${req.id}`);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(req.ref);
  await expect(page.getByRole("navigation", { name: "Breadcrumb" }).getByRole("link", { name: "Requests" })).toHaveAttribute("href", "/admin/requests");
  await expect(page.getByTestId("dv1-flag-via")).toBeVisible();
  await expect(page.getByTestId("dv1-company-link").first()).toHaveAttribute("href", /^\/admin\/companies\/[0-9a-f-]{36}$/);
  for (const name of [/^Overview/, /^Drivers & offers/, /^Parcels/, /^Money/, /^Communication/, /^Activity & notes/]) await expect(tab(page, name), String(name)).toBeVisible();
  await expect(tab(page, /^Parcels/)).toContainText("3");
  // key figures: each card has a definition behind the (i)
  const kpis = page.getByTestId("dv1-kpis");
  for (const k of ["slots", "parcels", "success", "start", "execution", "price", "cod_due", "rating"]) await expect(kpis.getByTestId(`dv1-kpi-${k}`), k).toBeVisible();
  await expect(kpis.getByTestId("dv1-kpi-slots")).toContainText("0/1");
  await kpis.getByTestId("dv1-kpi-success").getByRole("button", { name: /What does .* mean\?/ }).focus();
  await expect(page.getByRole("tooltip")).toContainText("Delivered parcels");
  // overview sections
  await expect(page.getByTestId("dv1-milestones")).toBeVisible();
  await expect(page.locator('[data-milestone="created"]')).toHaveAttribute("data-reached", "1");
  await expect(page.locator('[data-milestone="published"]')).toHaveAttribute("data-reached", "1");
  await expect(page.locator('[data-milestone="closed"]')).toHaveAttribute("data-reached", "0");
  await expect(page.getByTestId("dv1-funnel")).toBeVisible(); await expect(page.getByTestId("dv1-mix")).toBeVisible(); await expect(page.getByTestId("dv1-delivery")).toBeVisible();
  await expect(page.getByTestId("dv1-alerts").or(page.getByTestId("dv1-alerts-clear"))).toBeVisible();
  await expect(page.getByTestId("admin-req-open-company")).toHaveAttribute("href", /\/admin\/companies\//);
  await expect(page.getByRole("heading", { name: "Request details", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Map", exact: true })).toBeVisible();
  await expect(page.getByText("Latest events")).toBeVisible();
  // the key figures collapse
  await page.getByRole("button", { name: "Key figures" }).click();
  await expect(kpis.getByTestId("dv1-kpi-slots")).toHaveCount(0);
  await page.getByRole("button", { name: "Key figures" }).click();
  await expect(kpis.getByTestId("dv1-kpi-slots")).toBeVisible();
});

test("drivers & offers tab: the empty state offers assignment; the other offers are listed compactly", async ({ page }) => {
  await admin(page);
  await gotoReady(page, `/admin/requests/${req.id}`);
  await tab(page, /^Drivers & offers/).click();
  await expect(page).toHaveURL(new RegExp(`/admin/requests/${req.id}/drivers$`));
  await expect(page.getByRole("heading", { name: "Drivers", exact: true })).toBeVisible();
  await expect(page.getByText("No drivers yet")).toBeVisible();
  await expect(page.getByTestId("admin-req-assign")).toBeVisible();
  await page.getByRole("button", { name: "Assign driver" }).first().click();
  const dlg = page.getByRole("dialog", { name: "Assign driver" });
  await expect(dlg).toBeVisible();
  await dlg.getByRole("button", { name: "Cancel" }).click();
  await expect(dlg).toBeHidden();
});

test("parcels tab: server-side filters in the URL, a deep link, the CSV export and the parcel view", async ({ page }) => {
  await admin(page);
  await gotoReady(page, `/admin/requests/${req.id}/parcels`);
  await expect(page.getByTestId("admin-parcel-row")).toHaveCount(3);
  await page.getByRole("textbox", { name: "Search", exact: true }).fill("Customer 2");
  await expect(page.getByTestId("admin-parcel-row")).toHaveCount(1);
  await expect(page.getByTestId("admin-parcel-row")).toContainText("DET-2");
  await page.getByTestId("dv1-parcels-clear").click();
  await expect(page.getByTestId("admin-parcel-row")).toHaveCount(3);
  await page.getByRole("checkbox", { name: /Cash on delivery/ }).click(); // URL-synced: it flips once the URL has changed
  await expect(page.getByRole("checkbox", { name: /Cash on delivery/ })).toBeChecked();
  await expect(page).toHaveURL(/cod=1/);
  await expect(page.getByTestId("admin-parcel-row")).toHaveCount(1);
  await expect(page.getByTestId("admin-parcel-cod")).toContainText("75.00");
  await page.getByTestId("dv1-parcels-clear").click();
  await expect(page.getByTestId("admin-parcel-row")).toHaveCount(3);
  await expect(page.getByTestId("admin-parcels-export")).toHaveAttribute("href", /\/api\/v1\/admin\/requests\/.+\/parcels\?format=csv/);
  // a pasted parcel code from the requests list lands here with the search filled in
  await gotoReady(page, `/admin/requests/${req.id}/parcels?q=${req.parcelCode}`);
  await expect(page.getByRole("textbox", { name: "Search", exact: true })).toHaveValue(req.parcelCode);
  await expect(page.getByTestId("admin-parcel-row")).toHaveCount(1);
  await page.getByTestId("dv1-parcel-link").click();
  await expect(page).toHaveURL(new RegExp(`/admin/parcels/${req.parcelId}$`));
});

test("parcel view: header links, key figures, journey, visits, evidence, recipient, codes, similar parcels, activity and notes", async ({ page }) => {
  await admin(page);
  await gotoReady(page, `/admin/parcels/${req.parcelId}`);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(req.parcelCode);
  await expect(page.getByTestId("dv1-parcel-order-link")).toHaveAttribute("href", `/admin/requests/${req.id}`);
  await expect(page.getByTestId("dv1-parcel-company-link")).toHaveAttribute("href", /\/admin\/companies\//);
  await expect(page.getByTestId("dv1-parcel-open-manifest")).toHaveAttribute("href", new RegExp(`/admin/requests/${req.id}/parcels\\?q=`));
  for (const name of ["Journey", "Visits to the door", "Evidence", "Recipient", "Delivery location", "Delivery code and messages", "Similar parcels"]) await expect(page.getByRole("heading", { name, exact: true }), name).toBeVisible();
  await expect(page.getByTestId("dv1-journey").locator('[data-type="created"]')).toBeVisible();
  await expect(page.getByText("No evidence recorded")).toBeVisible();
  await expect(page.getByText("The driver has not arrived at this stop yet.")).toBeVisible();
  await expect(page.getByTestId("dtk-log")).toBeVisible();
  await page.getByTestId("dtk-note-body").fill("Parcel note from the e2e");
  await page.getByTestId("dtk-note-add").click();
  await expect(page.getByTestId("dtk-note").filter({ hasText: "Parcel note from the e2e" })).toBeVisible();
  await page.getByTestId("dtk-raw-toggle").click();
  await expect(page.getByTestId("dtk-raw")).toContainText("JR-");
  // an unknown parcel is a clear "not found", not a crash
  await gotoReady(page, `/admin/parcels/${UNKNOWN}`);
  await expect(page.getByTestId("dv1-parcel-not-found")).toBeVisible();
});

test("money, communication and activity tabs", async ({ page }) => {
  await admin(page);
  await gotoReady(page, `/admin/requests/${req.id}/money`);
  await expect(page.getByTestId("dv1-money")).toBeVisible();
  await expect(page.getByTestId("dv1-price-build")).toContainText("SAR");
  await expect(page.getByRole("heading", { name: "How the price was built", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Reservation and release", exact: true })).toBeVisible();
  await expect(page.getByTestId("dv1-ledger-row").first()).toBeVisible();
  await expect(page.getByTestId("dv1-open-ledger")).toHaveAttribute("href", new RegExp(`/admin/finance/ledger\\?request=${req.id}`));
  await expect(page.getByTestId("dv1-cod-row")).toHaveCount(0); // nobody carries the cash yet
  await tab(page, /^Communication/).click();
  await expect(page.getByTestId("dv1-comms")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Driver chats", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "In-app notifications", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Messages sent", exact: true })).toBeVisible();
  await tab(page, /^Activity & notes/).click();
  await expect(page.getByTestId("dv1-activity")).toBeVisible();
  await expect(page.getByTestId("dtk-log")).toBeVisible();
  await expect(page.getByTestId("dtk-notes")).toBeVisible();
  await page.getByTestId("dtk-raw-toggle").click();
  await expect(page.getByTestId("dtk-raw")).toContainText(req.ref);
  await page.getByTestId("dtk-chip-parcel").click();
  await expect(page.getByTestId("dtk-item").first()).toHaveAttribute("data-kind", "parcel");
});

test("parcel search finds a parcel by its code and opens the parcel view (the activity log links to /admin/shipments?q=)", async ({ page }) => {
  await admin(page);
  await gotoReady(page, `/admin/parcels?q=${req.parcelCode}`);
  await expect(page.getByRole("heading", { level: 1, name: "Find a parcel" })).toBeVisible();
  await expect(page.getByTestId("dv1-search-row")).toHaveCount(1);
  await page.getByTestId("dv1-search-row").getByRole("link", { name: req.parcelCode }).click();
  await expect(page).toHaveURL(new RegExp(`/admin/parcels/${req.parcelId}$`));
  await gotoReady(page, `/admin/shipments?q=${req.parcelCode}`);
  await expect(page.getByTestId("dv1-search-row")).toHaveCount(1);
  await page.getByRole("textbox", { name: "Search", exact: true }).fill("ab");
  await expect(page.getByText("Type at least 3 characters.")).toBeVisible();
});

test("a phone shows every section without sideways scrolling, and Arabic switches to right-to-left", async ({ page }) => {
  await admin(page);
  await page.setViewportSize({ width: 390, height: 800 });
  for (const path of ["", "/drivers", "/parcels", "/money", "/communication", "/activity"]) {
    await gotoReady(page, `/admin/requests/${req.id}${path}`);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(req.ref);
    expect(await noSideScroll(page), `order ${path || "/"}`).toBe(true);
  }
  await gotoReady(page, `/admin/parcels/${req.parcelId}`);
  expect(await noSideScroll(page), "parcel").toBe(true);
  await page.context().addCookies([{ name: "jr_lang", value: "ar", url: BASE }]);
  await gotoReady(page, `/admin/requests/${req.id}`);
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  await expect(tab(page, /^الطرود/)).toBeVisible();
  await expect(page.getByTestId("dv1-kpi-slots")).toContainText("المناديب");
  expect(await noSideScroll(page), "order in Arabic").toBe(true);
  await gotoReady(page, `/admin/parcels/${req.parcelId}`);
  await expect(page.getByRole("heading", { name: "رحلة الطرد", exact: true })).toBeVisible();
  expect(await noSideScroll(page), "parcel in Arabic").toBe(true);
});

test("cancelling from the order view keeps the actions, then shows the reason and drops the cancel button", async ({ page }) => {
  await admin(page);
  await gotoReady(page, `/admin/requests/${req.id}`);
  await expect(page.getByTestId("admin-req-rematch")).toBeVisible();
  await page.getByTestId("admin-req-cancel").click();
  const cancel = page.getByRole("dialog", { name: "Cancel request" });
  await expect(cancel.getByTestId("admin-cancel-confirm")).toBeDisabled();
  await cancel.getByTestId("admin-cancel-reason").fill("E2E clean-up");
  await cancel.getByTestId("admin-cancel-confirm").click();
  await expect(page.getByTestId("admin-req-cancel")).toHaveCount(0);
  await expect(page.getByTestId("dv1-cancel-reason")).toContainText("E2E clean-up");
  await expect(page.locator('[data-milestone="closed"]')).toHaveAttribute("data-reached", "1");
  await expect(page.getByText("Cancelled", { exact: true }).first()).toBeVisible();
});
