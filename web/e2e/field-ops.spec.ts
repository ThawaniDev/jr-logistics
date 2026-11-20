import { test, expect, type APIRequestContext } from "@playwright/test";
import { otpLogin, staffLogin, gotoReady, DEMO, apiLogin } from "./helpers";
import { setFieldModes, type FieldModes } from "./field-modes";

/**
 * Field-operations overhaul, warehouse + superadmin screens (the driver screens are in driver-field-ops.spec.ts):
 *  1. the warehouse sets its map location; the superadmin changes platform settings and per-warehouse switches
 *  2. cash on delivery from parcel to wallet-less handover: the driver collects, the warehouse (and then the superadmin) receives it
 *  3. support tickets with attachments, handled in the console
 * The driver's side of each flow is driven through the API (the same endpoints the apps call).
 */
test.describe.configure({ mode: "serial" });

let savedModes: FieldModes; // J2 / J3: routing and B2B shipments are OFF by default — this spec drives routes / "Approve route" / business parcels
test.beforeAll(async ({ browser }) => { savedModes = await setFieldModes(browser, { routingEnabled: true, b2bShipmentsEnabled: true }); });
test.afterAll(async ({ browser }) => { await setFieldModes(browser, savedModes); });
const BASE = `http://localhost:${process.env.E2E_PORT ?? 3101}`; // not 3100: other projects on this machine use it
const WAREHOUSE = { lat: 24.7136, lng: 46.6753 };
const PNG = Buffer.from("89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c6360f8cfc00000030101004d1b7ea60000000049454e44ae426082", "hex");

async function api(ctx: APIRequestContext, method: "GET" | "POST" | "PUT" | "PATCH", path: string, data?: unknown) {
  const res = await ctx.fetch(`${BASE}/api/v1${path}`, { method, data, headers: { origin: BASE, "content-type": "application/json" } });
  return { status: res.status(), json: await res.json().catch(() => null) };
}

test("the warehouse sets its location; the superadmin changes the platform rules and one warehouse's switches", async ({ browser }) => {
  test.setTimeout(150_000);
  // ── warehouse: profile → location (paste a Google Maps link) ──
  const bizCtx = await browser.newContext(); const biz = await bizCtx.newPage();
  await otpLogin(biz, DEMO.business);
  await gotoReady(biz, "/business/profile");
  await expect(biz.getByTestId("warehouse-card")).toBeVisible();
  await expect(biz.getByTestId("wh-saved")).toContainText("24.71");
  await expect(biz.getByTestId("wh-radius-note")).toContainText("200");
  await biz.getByTestId("wh-paste").fill("https://www.google.com/maps/@24.7200,46.6800,17z");
  await expect(biz.getByTestId("wh-recognised")).toBeVisible();
  await biz.getByTestId("wh-save").click();
  await expect(biz.getByTestId("wh-saved")).toContainText("24.72");
  expect((await api(biz.request, "GET", "/business/overview")).json.warehouse).toEqual({ lat: 24.72, lng: 46.68 });
  // the read-only card says how JR operates this warehouse (defaults: arrival confirmed by the warehouse, driver scans, OTP on, no signature)
  await expect(biz.getByTestId("ops-requireArrivalConfirmation")).toHaveAttribute("data-on", "1");
  await expect(biz.getByTestId("ops-requireLoadingRecord")).toHaveAttribute("data-on", "0");
  await expect(biz.getByTestId("ops-requireDeliveryOtp")).toHaveAttribute("data-on", "1");
  await expect(biz.getByTestId("ops-requireSignature")).toHaveAttribute("data-on", "0");
  // put the pin back for the other specs
  await biz.getByTestId("wh-paste").fill(`${WAREHOUSE.lat}, ${WAREHOUSE.lng}`);
  await biz.getByTestId("wh-save").click();
  await expect(biz.getByTestId("wh-saved")).toContainText("24.7136");

  // ── superadmin: platform rules ──
  const adminPage = await (await browser.newContext()).newPage();
  await staffLogin(adminPage, "admin@jrlogistics.test", "E2e!Password2026");
  await gotoReady(adminPage, "/admin/settings/field-operations"); // the field-operations sub-page of the settings workspace
  await expect(adminPage.getByTestId("foa-settings-card")).toBeVisible();
  await expect(adminPage.getByTestId("foa-set-arrivalRadiusM")).toHaveValue("200");
  await adminPage.getByTestId("foa-set-arrivalRadiusM").fill("10");
  await expect(adminPage.getByTestId("foa-settings-save")).toBeDisabled(); // below the 20 m floor
  await adminPage.getByTestId("foa-set-arrivalRadiusM").fill("350");
  await adminPage.getByTestId("foa-set-stopWaitMin").fill("5");
  await adminPage.getByTestId("foa-set-wh-requireSignature").check();
  await adminPage.getByTestId("foa-settings-save").click();
  await expect.poll(async () => (await api(adminPage.request, "GET", "/admin/settings")).json.arrivalRadiusM).toBe(350);
  const saved = (await api(adminPage.request, "GET", "/admin/settings")).json;
  expect(saved).toMatchObject({ arrivalRadiusM: 350, stopWaitMin: 5, warehouseDefaults: { requireSignature: true, requireDeliveryOtp: true } });
  // the warehouse sees the new radius and (inherited) signature switch
  await gotoReady(biz, "/business/profile");
  await expect(biz.getByTestId("wh-radius-note")).toContainText("350");
  await expect(biz.getByTestId("ops-requireSignature")).toHaveAttribute("data-on", "1");
  // restore the defaults
  await gotoReady(adminPage, "/admin/settings/field-operations"); // the field-operations sub-page of the settings workspace
  await adminPage.getByTestId("foa-set-arrivalRadiusM").fill("200");
  await adminPage.getByTestId("foa-set-stopWaitMin").fill("0");
  await adminPage.getByTestId("foa-set-wh-requireSignature").uncheck();
  await adminPage.getByTestId("foa-settings-save").click();
  await expect.poll(async () => (await api(adminPage.request, "GET", "/admin/settings")).json.arrivalRadiusM).toBe(200);
  expect((await api(adminPage.request, "GET", "/admin/settings")).json).toMatchObject({ stopWaitMin: 0, warehouseDefaults: { requireSignature: false } });

  // ── superadmin: one warehouse's switches (override), then back to inherit ──
  const me = (await api(biz.request, "GET", "/auth/me")).json.user ?? (await api(biz.request, "GET", "/auth/me")).json;
  await gotoReady(adminPage, `/admin/companies/${me.id}/warehouse`); // the warehouse is a tab of the company view now (it was a dialog on the users list)
  await expect(adminPage.getByTestId("foa-wh-panel")).toBeVisible();
  await adminPage.getByTestId("foa-wh-sw-requireDeliveryOtp").selectOption("off");
  await adminPage.getByTestId("foa-wh-save").click();
  await expect(adminPage.getByTestId("foa-wh-saved")).toBeVisible();
  expect((await api(adminPage.request, "GET", `/admin/businesses/${me.id}/warehouse`)).json).toMatchObject({ ops: { requireDeliveryOtp: false }, overrides: { requireDeliveryOtp: false, requireSignature: null } });
  await gotoReady(biz, "/business/profile");
  await expect(biz.getByTestId("ops-requireDeliveryOtp")).toHaveAttribute("data-on", "0");
  await adminPage.getByTestId("foa-wh-sw-requireDeliveryOtp").selectOption("inherit");
  await adminPage.getByTestId("foa-wh-save").click();
  await expect.poll(async () => (await api(adminPage.request, "GET", `/admin/businesses/${me.id}/warehouse`)).json.overrides.requireDeliveryOtp).toBeNull();
});

test("cash on delivery: the driver collects it, the warehouse records the first handover, the superadmin the rest", async ({ browser }) => {
  test.setTimeout(240_000);
  const biz = await apiLogin(browser, DEMO.business);
  const drv = await apiLogin(browser, "0500000012"); // Khalid — dokker; another spec also has him collect cash, so start from a clean slate
  const leftovers = (await api(biz.request, "GET", "/business/cod")).json.drivers as Array<{ orders: Array<{ offerId: string; outstandingCents: number }> }>;
  for (const d of leftovers) for (const o of d.orders) if (o.outstandingCents > 0) expect((await api(biz.request, "POST", "/business/cod/receive", { offerId: o.offerId, amountCents: o.outstandingCents })).status).toBe(201);
  const bizCod = (await api(biz.request, "GET", "/business/cod")).json.totals as { outstandingCents: number; receivedCents: number };
  expect(bizCod.outstandingCents).toBe(0);
  const base = (await api(drv.request, "GET", "/driver/cash")).json as { collectedCents: number; receivedCents: number }; // lifetime figures: judge this journey against them
  await api(drv.request, "PUT", "/driver/availability", { available: true });
  const shipments = [{ n: 1, cod: 12_000 }, { n: 2, cod: 0 }, { n: 3, cod: 8_050 }].map(({ n, cod }) => ({ recipientName: `Cash Customer ${n}`, recipientPhone: `05300000${String(n + 10)}`, address: `${n} Tahlia St, Riyadh`, externalRef: `COD-E2E-${n}`, ...(cod ? { codCents: cod } : {}) }));
  const pub = await api(biz.request, "POST", "/requests", { service: "delivery_driver", quantity: 1, shipmentsPerDriver: 10, vehicleType: "dokker", pickupCity: "riyadh", deliveryCity: "riyadh", pickupAddress: "Warehouse 4, Industrial Area", durationDays: 1, startsAt: new Date(Date.now() + 3 * 3600e3).toISOString(), publish: true, termsAccepted: true, shipments });
  expect(pub.status, JSON.stringify(pub.json)).toBe(201);
  const offer = (await api(drv.request, "GET", "/driver/offers")).json.items.find((o: any) => o.requestId === pub.json.id);
  expect(offer).toBeTruthy();
  expect((await api(drv.request, "POST", `/offers/${offer.offerId}/accept`, { termsAccepted: true })).status).toBe(200);
  expect((await api(drv.request, "POST", `/offers/${offer.offerId}/checkin`, WAREHOUSE)).status).toBe(200);
  expect((await api(biz.request, "POST", `/offers/${offer.offerId}/attendance`, { present: true })).status).toBe(200);
  const list = (await api(biz.request, "GET", `/requests/${pub.json.id}/shipments?pageSize=200`)).json.items as Array<{ id: string; code: string; codCents: number; demoOtp: string }>;
  expect(list.map((s) => s.codCents).sort((a, b) => a - b)).toEqual([0, 8050, 12000]);
  for (const s of list) expect((await api(drv.request, "POST", `/offers/${offer.offerId}/loading/scan`, { code: s.code })).status).toBe(200);
  expect((await api(drv.request, "POST", `/offers/${offer.offerId}/loading/finish`, {})).status).toBe(200);
  expect((await api(drv.request, "POST", `/offers/${offer.offerId}/route/approve`)).status).toBe(200);
  const stops = (await api(drv.request, "GET", `/driver/jobs/${offer.offerId}`)).json.stops as Array<{ id: string }>;
  const ordered = stops.map((s) => list.find((x) => x.id === s.id)!);
  expect((await api(drv.request, "GET", `/driver/jobs/${offer.offerId}`)).json.cod).toMatchObject({ toCollectCents: 20_050, parcels: 2 });
  for (const s of ordered) {
    expect((await api(drv.request, "POST", `/offers/${offer.offerId}/stops/${s.id}/arrive`, {})).status).toBe(200);
    if (s.codCents > 0) expect((await api(drv.request, "POST", `/offers/${offer.offerId}/stops/${s.id}/deliver`, { code: s.code, otp: s.demoOtp })).json.error.code).toBe("CASH_MISMATCH");
    expect((await api(drv.request, "POST", `/offers/${offer.offerId}/stops/${s.id}/deliver`, { code: s.code, otp: s.demoOtp, ...(s.codCents > 0 ? { cashCollectedCents: s.codCents } : {}) })).status).toBe(200);
  }
  expect((await api(drv.request, "POST", `/offers/${offer.offerId}/delivered`, {})).json.status).toBe("completed");
  expect((await api(drv.request, "GET", "/driver/overview")).json.cash).toEqual({ outstandingCents: 20_050, orders: 1 });
  expect((await api(drv.request, "GET", "/driver/cash")).json).toMatchObject({ collectedCents: base.collectedCents + 20_050, outstandingCents: 20_050 });
  expect((await api(drv.request, "GET", "/driver/cash")).json.orders.find((o: any) => o.ref === pub.json.ref)).toMatchObject({ outstandingCents: 20_050 });

  // ── the warehouse's cash page ──
  const bp = await biz.newPage();
  await gotoReady(bp, "/business/cash");
  await expect(bp.getByTestId("cod-total-outstanding")).toContainText("200.50");
  await expect(bp.getByTestId("cod-holders")).toContainText("Khalid");
  await bp.locator(`[data-testid="cod-order"][data-offer="${offer.offerId}"]`).getByTestId("cod-order-receive").click();
  const dlg = bp.getByTestId("cod-receive-dialog");
  await expect(dlg).toBeVisible();
  await bp.getByTestId("cod-amount").fill("999"); // more than the driver holds
  await expect(bp.getByTestId("cod-receive-submit")).toBeDisabled(); // the form refuses it before it is sent
  expect((await api(drv.request, "GET", "/driver/cash")).json.receivedCents).toBe(base.receivedCents);
  expect((await api(biz.request, "POST", "/business/cod/receive", { offerId: offer.offerId, amountCents: 99_900 })).status).toBe(422); // …and so does the server
  await bp.getByTestId("cod-amount").fill("120.00");
  await bp.getByTestId("cod-note").fill("first handover at the gate");
  await bp.getByTestId("cod-receive-submit").click();
  await expect(dlg).toHaveCount(0);
  await expect(bp.getByTestId("cod-total-received")).toContainText(((bizCod.receivedCents + 12_000) / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })); // the page groups thousands (1,001.00)
  await expect(bp.getByTestId("cod-total-outstanding")).toContainText("80.50");
  await expect(bp.getByTestId("cod-history-row").first()).toContainText("first handover at the gate");
  expect((await api(drv.request, "GET", "/driver/cash")).json).toMatchObject({ receivedCents: base.receivedCents + 12_000, outstandingCents: 8_050 });
  expect((await api(drv.request, "GET", "/driver/cash")).json.recent.filter((r: any) => r.ref === pub.json.ref)).toMatchObject([{ amountCents: 12_000, receivedByRole: "business" }]);

  // ── the superadmin records the rest on the warehouse's behalf ──
  const ap = await (await browser.newContext()).newPage();
  await staffLogin(ap, "admin@jrlogistics.test", "E2e!Password2026");
  await gotoReady(ap, "/admin/cod"); // the old URL still works: it lands on the Cash on delivery page of the Finance group
  await expect(ap).toHaveURL(/\/admin\/finance\/cod$/);
  await expect(ap.getByTestId("foa-cod-total-outstanding")).toContainText("SAR"); // the KPI row
  await expect(ap.getByTestId(`foa-cod-row-${offer.offerId}`)).toBeVisible();
  await expect(ap.getByTestId(`foa-cod-row-${offer.offerId}`)).toContainText("80.50");
  await ap.getByTestId(`foa-cod-receive-${offer.offerId}`).click();
  await ap.getByTestId("foa-cod-amount").fill("80.50");
  await ap.getByTestId("foa-cod-note").fill("collected at the depot");
  await ap.getByTestId("foa-cod-submit").click();
  await expect.poll(async () => (await api(drv.request, "GET", "/driver/cash")).json.outstandingCents).toBe(0);
  expect((await api(drv.request, "GET", "/driver/cash")).json.recent.filter((r: any) => r.ref === pub.json.ref).map((r: any) => r.receivedByRole).sort()).toEqual(["admin", "business"]);
  await ap.getByRole("link", { name: /Remittances/ }).click(); // a second page of the same function (LinkTabs), not a tab inside one page
  await expect(ap).toHaveURL(/\/admin\/finance\/cod\/remittances$/);
  await expect(ap.getByTestId(/foa-cod-remittance-/).first()).toBeVisible();
  // the driver was told about both handovers
  const notes = (await api(drv.request, "GET", "/notifications")).json.items as Array<{ type: string; data?: { ref?: string } }>;
  expect(notes.filter((n) => n.type === "cod_received" && n.data?.ref === pub.json.ref)).toHaveLength(2);
});

test("support: a driver opens a ticket with a photo, the console assigns and resolves it, the driver reopens it", async ({ browser }) => {
  test.setTimeout(120_000);
  const drv = await apiLogin(browser, "0500000012");
  const up = await drv.request.fetch(`${BASE}/api/v1/uploads/ticket`, { method: "POST", headers: { origin: BASE }, multipart: { file: { name: "door.png", mimeType: "image/png", buffer: PNG } } });
  expect(up.status()).toBe(201);
  const file = await up.json();
  const made = await api(drv.request, "POST", "/tickets", { category: "cod_issue", subject: "Customer paid less than the COD amount", body: "Photo of the receipt attached", attachmentIds: [file.id] });
  expect(made.status, JSON.stringify(made.json)).toBe(201);
  const detail = (await api(drv.request, "GET", `/tickets/${made.json.id}`)).json;
  expect(detail.replies[0].attachments).toEqual([expect.objectContaining({ id: file.id, mime: "image/png", name: "door.png" })]);
  const raw = await drv.request.fetch(`${BASE}/api/v1/tickets/attachments/${file.id}`);
  expect(raw.status()).toBe(200); expect(raw.headers()["content-type"]).toBe("image/png");

  // console: find it, take it, answer, resolve
  const ap = await (await browser.newContext()).newPage();
  await staffLogin(ap, "support@jrlogistics.demo", DEMO.staffPw);
  await gotoReady(ap, "/admin/cases");
  await ap.getByTestId("foa-case-filter-q").locator("input").fill(made.json.ref); // the search box sits inside the test-id wrapper
  await ap.getByTestId(`foa-case-row-${made.json.id}`).click(); // the row opens the ticket as its own view
  await expect(ap).toHaveURL(new RegExp(`/admin/cases/${made.json.id}$`));
  await expect(ap.getByTestId("foa-case-thread")).toContainText("Photo of the receipt attached");
  await expect(ap.getByTestId(`foa-attach-${file.id}`).first()).toBeVisible(); // shown in the conversation and in the attachments gallery
  await ap.getByTestId("foa-case-assign-me").click();
  await ap.getByTestId("foa-case-reply").fill("We are checking with the warehouse.");
  await ap.getByTestId("foa-case-send").click();
  await ap.getByTestId("foa-case-resolve").click();
  await expect.poll(async () => (await api(drv.request, "GET", `/tickets/${made.json.id}`)).json.ticket.status).toBe("resolved");
  expect((await api(drv.request, "GET", "/notifications")).json.items.some((n: any) => n.type === "ticket_resolved")).toBe(true);
  // the driver is not allowed to just keep writing — he reopens with a message
  expect((await api(drv.request, "POST", `/tickets/${made.json.id}/replies`, { body: "one more thing" })).status).toBe(409);
  const re = await api(drv.request, "POST", `/tickets/${made.json.id}/reopen`, { body: "The customer still disputes it" });
  expect(re.status).toBe(200); expect(re.json.status).toBe("open");
});
