import { test, expect, type APIRequestContext, type Browser, type Page } from "@playwright/test";
import { apiLogin, staffLogin, DEMO } from "./helpers";
import { setFieldModes, type FieldModes } from "./field-modes";
import { openNext, openShipment, shipCard } from "./driver-ui";

/**
 * Update J2 / J3 end to end: the platform's two switches (Settings › Field operations), the driver's shipment run sheet (one card per shipment: code, status chip,
 * name, address, COD, payment mode, call + WhatsApp, filters, search) with routing OFF (any order, nothing locked, no route screens) and ON (approval, one stop at a
 * time, the others locked), and the business manifest without / with the recipient-type choice. Every spec that needs routing switches it on for itself; this one
 * switches both modes explicitly through the same admin settings API a super admin uses.
 */
test.describe.configure({ mode: "serial" });
test.use({ actionTimeout: 20_000 });
const BASE = `http://localhost:${process.env.E2E_PORT ?? 3101}`; // not 3100: other projects on this machine use it
const WAREHOUSE = { latitude: 24.7136, longitude: 46.6753 };
let saved: FieldModes;
test.beforeAll(async ({ browser }) => { saved = await setFieldModes(browser, { routingEnabled: false, b2bShipmentsEnabled: false }); });
test.afterAll(async ({ browser }) => { await setFieldModes(browser, saved); });

async function api(ctx: APIRequestContext, method: "GET" | "POST" | "PUT" | "PATCH", path: string, data?: unknown) {
  const res = await ctx.fetch(`${BASE}/api/v1${path}`, { method, data, headers: { origin: BASE, "content-type": "application/json" } });
  return { status: res.status(), json: await res.json().catch(() => null) };
}
interface Parcel { id: string; code: string; seq: number; demoOtp: string; codCents: number }

/** A published request of `n` parcels, taken, loaded and acknowledged by one driver — ready for the shipment list (and, with `approve`, the route approved). */
async function makeJob(browser: Browser, o: { phone: string; vehicle: string; n: number; approve?: boolean }) {
  const biz = await apiLogin(browser, DEMO.business);
  const names = ["Mona Ali", "Faisal Harbi", "Sara Utaibi", "Yusuf Khan", "Noura Qahtani", "Omar Saeed", "Huda Mansour", "Tariq Aziz"];
  const shipments = Array.from({ length: o.n }, (_, i) => ({ recipientName: names[i % names.length], recipientPhone: `0540001${String(100 + i)}`, address: `${i + 1} Olaya St, Building ${i + 3}, Riyadh`, lat: 24.68 + i * 0.012, lng: 46.64 + i * 0.01,
    externalRef: `J2-${o.phone.slice(-2)}-${Date.now().toString(36)}-${i + 1}`, ...(i === 1 ? { codCents: 15_000 } : {}), ...(i === 3 ? { codCents: 4_050 } : {}) }));
  const pub = await api(biz.request, "POST", "/requests", { service: "delivery_driver", quantity: 1, shipmentsPerDriver: 20, vehicleType: o.vehicle, pickupCity: "riyadh", deliveryCity: "riyadh", pickupAddress: "Warehouse 4, Industrial Area", durationDays: 1, startsAt: new Date(Date.now() + 2 * 3600e3).toISOString(), publish: true, termsAccepted: true, shipments });
  expect(pub.status, JSON.stringify(pub.json)).toBe(201);
  const dctx = await apiLogin(browser, o.phone, { geolocation: WAREHOUSE, permissions: ["geolocation"] });
  const drv = await dctx.newPage();
  await api(drv.request, "PUT", "/driver/availability", { available: true });
  const applied = await api(drv.request, "POST", `/driver/requests/${pub.json.id}/apply`, { termsAccepted: true });
  expect(applied.status, JSON.stringify(applied.json)).toBeLessThan(300);
  const offerId = applied.json.id as string;
  expect((await api(drv.request, "POST", `/offers/${offerId}/checkin`, { lat: WAREHOUSE.latitude, lng: WAREHOUSE.longitude })).status).toBe(200);
  expect((await api(biz.request, "POST", `/offers/${offerId}/attendance`, { present: true })).status).toBe(200);
  const parcels = ((await api(biz.request, "GET", `/requests/${pub.json.id}/shipments?pageSize=200`)).json.items as Parcel[]).sort((a, b) => a.seq - b.seq);
  for (const p of parcels) expect((await api(drv.request, "POST", `/offers/${offerId}/loading/scan`, { code: p.code })).status).toBe(200);
  expect((await api(drv.request, "POST", `/offers/${offerId}/loading/finish`, {})).status).toBe(200);
  expect((await api(drv.request, "POST", `/offers/${offerId}/loading-ack`, { ok: true })).status).toBe(200);
  if (o.approve) expect((await api(drv.request, "POST", `/offers/${offerId}/route/approve`)).status).toBe(200);
  const job = () => api(drv.request, "GET", `/driver/jobs/${offerId}`).then((r) => r.json);
  return { biz, drv, dctx, offerId, parcels, jobUrl: `/driver/jobs/${offerId}`, job, ref: pub.json.ref as string };
}
type Job = Awaited<ReturnType<typeof makeJob>>;

/** The rest of a route straight through the API (the same calls the UI makes), so a spec can finish a job it only partly drove. */
async function deliverRest(j: Job) {
  for (;;) {
    const cur = ((await j.job()).stops as Array<{ id: string; code: string; status: string }>).find((s) => s.status === "loaded");
    if (!cur) break;
    const p = j.parcels.find((x) => x.code === cur.code)!;
    expect((await api(j.drv.request, "POST", `/offers/${j.offerId}/stops/${cur.id}/arrive`, {})).status).toBe(200);
    const body = { code: p.code, otp: p.demoOtp, ...(p.codCents > 0 ? { cashCollectedCents: p.codCents } : {}) };
    expect((await api(j.drv.request, "POST", `/offers/${j.offerId}/stops/${cur.id}/deliver`, body)).status).toBe(200);
  }
}

/** Arrive + deliver the shipment whose sheet is open (parcel code, then the recipient's one-time code, and the cash it carries). */
async function deliverInSheet(page: Page, p: Parcel) {
  await page.getByTestId("stop-arrive").click();
  await page.getByLabel("Parcel code").fill(p.code);
  await page.getByLabel("Delivery code").fill(p.demoOtp);
  if (p.codCents > 0) await page.getByTestId("cod-collect-confirm").check();
  await page.getByRole("button", { name: "Confirm delivery" }).last().click();
}

test("settings: the two switches sit at the top of Settings › Field operations and are saved like every other setting", async ({ browser }) => {
  const page = await (await browser.newContext()).newPage();
  await staffLogin(page, "admin@jrlogistics.test", "E2e!Password2026");
  await page.goto("/admin/settings/field-operations");
  await expect(page.getByTestId("jf2-switches")).toBeVisible();
  const routing = page.getByTestId("set-routing-enabled"); const b2b = page.getByTestId("set-b2b-enabled");
  await expect(routing).not.toBeChecked(); await expect(b2b).not.toBeChecked(); // both default to OFF
  await expect(page.getByTestId("set-routing-enabled-card")).toContainText(/immediately for new actions/i);
  await expect(page.getByTestId("set-routing-enabled-state")).toHaveAttribute("data-on", "0");
  await routing.check();
  await expect(page.getByTestId("set-routing-enabled-state")).toHaveAttribute("data-on", "1");
  await page.getByTestId("foa-settings-save").click();
  await expect.poll(async () => (await api(page.request, "GET", "/admin/settings")).json.routingEnabled).toBe(true);
  expect((await api(page.request, "GET", "/admin/settings")).json.b2bShipmentsEnabled).toBe(false); // only what changed was sent
  expect(((await api(page.request, "GET", "/catalog")).json.policy as Record<string, unknown>)).toMatchObject({ routingEnabled: true, b2bShipmentsEnabled: false });
  await routing.uncheck(); await b2b.check();
  await page.getByTestId("foa-settings-save").click();
  await expect.poll(async () => (await api(page.request, "GET", "/admin/settings")).json.b2bShipmentsEnabled).toBe(true);
  expect((await api(page.request, "GET", "/admin/settings")).json.routingEnabled).toBe(false);
  await b2b.uncheck(); await page.getByTestId("foa-settings-save").click(); // back to the defaults of this spec
  await expect.poll(async () => (await api(page.request, "GET", "/admin/settings")).json.b2bShipmentsEnabled).toBe(false);
  // a staff member without settings.edit would see them disabled: the switches carry the permission through `disabled`
  await expect(routing).toBeEnabled();
});

test("routing OFF: the run sheet shows every shipment with name and phone, nothing is locked, no route screens, any order", async ({ browser }) => {
  test.setTimeout(240_000);
  const j = await makeJob(browser, { phone: "0500000012", vehicle: "dokker", n: 8 });
  const { drv } = j;
  await drv.goto(j.jobUrl);
  await expect(drv.getByTestId("ship-board")).toHaveAttribute("data-routing", "0");
  expect((await j.job()).policy).toMatchObject({ routingEnabled: false });

  // no route planning UI of any kind: no approval, summary, map tabs, route icon, optimise, re-order
  for (const id of ["approve-route", "route-review-title", "route-summary", "optimize-route", "list-view-tab", "map-view-tab", "job-route-toggle", "reorder-panel", "open-in-maps"]) await expect(drv.getByTestId(id), id).toHaveCount(0);

  // one card per shipment, every one actionable, with name + phone + address visible
  const cards = drv.getByTestId("ship-card");
  await expect(cards).toHaveCount(8);
  await expect(drv.locator('[data-testid="ship-card"][data-access="act"]')).toHaveCount(8);
  await expect(drv.locator('[data-testid="ship-card"][data-access="locked"]')).toHaveCount(0);
  const first = shipCard(drv, j.parcels[0].code); const last = shipCard(drv, j.parcels[7].code);
  await expect(first.getByTestId("ship-name")).toContainText("Mona Ali");
  await expect(last.getByTestId("ship-name")).toContainText("Tariq Aziz"); // name, phone and address of a shipment that is NOT the first
  await expect(last.getByTestId("ship-address")).toContainText("8 Olaya St");
  await expect(last.getByTestId("ship-call")).toHaveAttribute("href", /^tel:/);
  await expect(last.getByTestId("ship-status")).toHaveAttribute("data-chip", "out"); // "Out for delivery"
  await expect(last.getByTestId("ship-status")).toContainText("Out for delivery");

  // payment mode + COD highlight
  const cod = shipCard(drv, j.parcels[1].code);
  await expect(cod).toHaveAttribute("data-payment", "cod");
  await expect(cod.getByTestId("ship-cod")).toContainText("150.00");
  await expect(cod.getByTestId("ship-payment")).toContainText("COD");
  await expect(first).toHaveAttribute("data-payment", "prepaid");
  await expect(first.getByTestId("ship-payment")).toContainText("Prepaid");
  await expect(first.getByTestId("ship-pieces")).toContainText("1");

  // filter chips with counts, and the search (code, name, phone, address)
  await expect(drv.getByTestId("ship-filter-all")).toHaveAttribute("data-count", "8");
  await expect(drv.getByTestId("ship-filter-todo")).toHaveAttribute("data-count", "8");
  await expect(drv.getByTestId("ship-filter-delivered")).toHaveAttribute("data-count", "0");
  await expect(drv.getByTestId("ship-filter-failed")).toHaveAttribute("data-count", "0");
  await drv.getByTestId("ship-search").fill("Tariq");
  await expect(cards).toHaveCount(1);
  await drv.getByTestId("ship-search").fill(j.parcels[2].code.toLowerCase());
  await expect(cards).toHaveCount(1); await expect(cards.first()).toHaveAttribute("data-code", j.parcels[2].code);
  await drv.getByTestId("ship-search").fill("0540001103");
  await expect(cards).toHaveCount(1); await expect(cards.first()).toHaveAttribute("data-code", j.parcels[3].code);
  await drv.getByTestId("ship-search").fill("Building 5");
  await expect(cards).toHaveCount(1);
  await drv.getByTestId("ship-search").fill("nobody-matches-this");
  await expect(cards).toHaveCount(0);
  await drv.getByTestId("ship-search").fill("");
  await expect(cards).toHaveCount(8);

  // call (tel:) and WhatsApp work for a shipment that is NOT the first one (the server allows every own stop while routing is off)
  drv.context().on("page", (p) => { void p.close(); }); // WhatsApp opens in a new tab
  const [wa] = await Promise.all([
    drv.waitForResponse((r) => r.url().includes(`/driver/jobs/${j.offerId}/whatsapp`) && r.url().includes(`shipmentId=${j.parcels[5].id}`)),
    shipCard(drv, j.parcels[5].code).getByTestId("ship-whatsapp").click(),
  ]);
  expect(wa.status()).toBe(200);
  expect((await wa.json()).url).toMatch(/wa\.me\/|whatsapp/);

  // any order: deliver the LAST parcel first, from its card
  await openShipment(drv, j.parcels[7].code);
  await expect(drv.getByTestId("stop-next")).toBeVisible();
  await deliverInSheet(drv, j.parcels[7]);
  await expect(drv.getByTestId("ship-filter-delivered")).toHaveAttribute("data-count", "1");
  await expect(drv.getByTestId("ship-filter-todo")).toHaveAttribute("data-count", "7");
  await expect(last).toHaveAttribute("data-access", "done"); await expect(last).toHaveAttribute("data-status", "delivered");
  await expect(last.getByTestId("ship-status")).toHaveAttribute("data-chip", "delivered");
  await expect(cards.last()).toHaveAttribute("data-code", j.parcels[7].code); // finished cards go to the bottom, dimmed but visible

  // can't deliver another one out of order (no arrival needed): it moves to "Not delivered"
  await openShipment(drv, j.parcels[4].code);
  await drv.getByTestId("stop-fail").click();
  await drv.getByTestId("fail-reason-refused").click();
  await drv.getByTestId("fail-continue").click();
  await drv.getByTestId("fail-confirm").click();
  await expect(drv.getByTestId("ship-filter-failed")).toHaveAttribute("data-count", "1");
  await drv.getByTestId("ship-filter-failed").click();
  await expect(cards).toHaveCount(1); await expect(cards.first()).toHaveAttribute("data-code", j.parcels[4].code);
  await expect(cards.first().getByTestId("ship-status")).toHaveAttribute("data-chip", "failed");
  await drv.getByTestId("ship-filter-delivered").click();
  await expect(cards).toHaveCount(1); await expect(cards.first()).toHaveAttribute("data-code", j.parcels[7].code);
  await drv.getByTestId("ship-filter-todo").click();
  await expect(cards).toHaveCount(6);
  await drv.getByTestId("ship-filter-all").click();

  // the sticky bar opens the next shipment; the stat cards of the page agree with the chips
  await expect(drv.getByTestId("ship-next-bar")).toBeVisible();
  await expect(drv.getByTestId("stat-delivered")).toHaveAttribute("data-value", "1");
  await expect(drv.getByTestId("stat-not-delivered")).toHaveAttribute("data-value", "1");
  await openNext(drv);
  await drv.keyboard.press("Escape");

  // finish: the rest through the API, then the "Finish route" bar
  await deliverRest(j);
  await drv.goto(j.jobUrl);
  await drv.getByRole("button", { name: "Finish route" }).first().click();
  await expect(drv.getByTestId("job-completed")).toBeVisible();
});

test("routing ON: approval, one stop at a time — the other cards are visible but locked, the route screens are back", async ({ browser }) => {
  test.setTimeout(240_000);
  await setFieldModes(browser, { routingEnabled: true });
  const j = await makeJob(browser, { phone: "0500000013", vehicle: "hiace", n: 4 });
  const { drv } = j;
  await drv.goto(j.jobUrl);
  await expect(drv.getByTestId("route-review-title")).toBeVisible(); // the approval step exists again
  await expect(drv.getByTestId("job-route-toggle")).toBeVisible();
  await drv.getByRole("button", { name: "Approve route" }).first().click();
  await expect(drv.getByTestId("ship-board")).toHaveAttribute("data-routing", "1");
  await expect(drv.getByTestId("ship-card")).toHaveCount(4);
  await expect(drv.locator('[data-testid="ship-card"][data-access="act"]')).toHaveCount(1);
  await expect(drv.locator('[data-testid="ship-card"][data-access="locked"]')).toHaveCount(3);
  await expect(drv.getByTestId("route-summary")).toBeVisible(); await expect(drv.getByTestId("list-view-tab")).toBeVisible(); await expect(drv.getByTestId("map-view-tab")).toBeVisible();
  const stops = (await j.job()).stops as Array<{ code: string; current: boolean }>;
  const cur = stops.find((s) => s.current)!; const other = stops.find((s) => !s.current)!;

  // the current stop: call link and actions; a locked one: no phone, read-only sheet with the explanation
  await expect(shipCard(drv, cur.code)).toHaveAttribute("data-current", "1");
  await expect(shipCard(drv, cur.code).getByTestId("ship-call")).toHaveAttribute("href", /^tel:/);
  const locked = shipCard(drv, other.code);
  await expect(locked).toHaveAttribute("data-access", "locked");
  await expect(locked.getByTestId("ship-call")).not.toHaveAttribute("href", /.*/);
  await expect(locked.getByTestId("ship-whatsapp")).toBeDisabled();
  await expect(locked.getByTestId("ship-name")).toContainText("Shown when this stop is next");
  await openShipment(drv, other.code);
  await expect(drv.getByTestId("stop-detail")).toContainText("current stop");
  await expect(drv.getByTestId("stop-arrive")).toHaveCount(0); await expect(drv.getByTestId("stop-fail")).toHaveCount(0);
  await drv.keyboard.press("Escape");

  // the server agrees: acting on a locked stop is refused
  const refused = await api(drv.request, "POST", `/offers/${j.offerId}/stops/${(await j.job()).stops.find((s: { code: string }) => s.code === other.code).id}/arrive`, {});
  expect(refused.status).toBe(409); expect(refused.json.error.code).toBe("STOP_LOCKED");

  // working the current stop opens the next one
  await openNext(drv);
  await expect(drv.getByTestId("current-stop")).toHaveAttribute("data-code", cur.code);
  await deliverInSheet(drv, j.parcels.find((p) => p.code === cur.code)!);
  await expect(drv.getByTestId("ship-filter-delivered")).toHaveAttribute("data-count", "1");
  await expect.poll(async () => ((await j.job()).stops as Array<{ current: boolean; code: string }>).find((s) => s.current)?.code).not.toBe(cur.code);
  await expect(drv.locator('[data-testid="ship-card"][data-access="act"]')).toHaveCount(1);
  await deliverRest(j);
  await drv.goto(j.jobUrl);
  await drv.getByRole("button", { name: "Finish route" }).first().click();
  await expect(drv.getByTestId("job-completed")).toBeVisible();
  await setFieldModes(browser, { routingEnabled: false });
});

test("phone width in Arabic (RTL): the run sheet has no sideways scroll and the buttons stay reachable", async ({ browser }) => {
  test.setTimeout(240_000);
  const j = await makeJob(browser, { phone: "0500000012", vehicle: "dokker", n: 3 });
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: "ar" });
  await ctx.addCookies((await j.dctx.cookies()).map((c) => ({ ...c })));
  await ctx.addCookies([{ name: "jr_lang", value: "ar", url: BASE }]);
  const page = await ctx.newPage();
  await page.goto(j.jobUrl);
  await expect(page.getByTestId("ship-board")).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  const card = shipCard(page, j.parcels[0].code);
  await expect(card.getByTestId("ship-whatsapp")).toBeVisible();
  const box = (await card.boundingBox())!;
  expect(box.x).toBeGreaterThanOrEqual(0); expect(box.x + box.width).toBeLessThanOrEqual(390.5);
  await deliverRest(j);
  await page.goto(j.jobUrl);
  await page.getByTestId("finish-route").click();
  await expect(page.getByTestId("job-completed")).toBeVisible();
});

/** Wizard steps 1–2 of a delivery order, ending on the shipments step (the same clicks the other specs use). */
async function toShipmentsStep(biz: Page) {
  await biz.goto("/business/requests/new");
  await biz.getByRole("button", { name: /Delivery driver/ }).click();
  await biz.getByLabel(/^Vehicle/).selectOption("sedan");
  await biz.getByRole("button", { name: "Next", exact: true }).click();
  await biz.getByLabel(/Pickup address/).fill("Warehouse 4, Industrial Area, Riyadh");
  await biz.getByLabel(/Start date/).fill(new Date(Date.now() + 3 * 864e5 + 3 * 3600e3).toISOString().slice(0, 11) + "09:00");
  await biz.getByRole("button", { name: "Next", exact: true }).click();
  await expect(biz.getByLabel("Max parcels per driver")).toBeVisible();
}

test("B2B off: no recipient-type choice for the company, the API docs say so; on: the choice is back", async ({ browser }) => {
  test.setTimeout(180_000);
  const biz = await (await apiLogin(browser, DEMO.business)).newPage();
  expect(((await api(biz.request, "GET", "/catalog")).json.policy as Record<string, unknown>).b2bShipmentsEnabled).toBe(false);

  // the manifest: a parcel row without the Individual / Business radio group, the sheet template without a type column, the docs with the note
  await toShipmentsStep(biz);
  await biz.getByTestId("add-row").click();
  await expect(biz.getByTestId("manifest-row")).toHaveCount(1);
  await expect(biz.getByRole("radiogroup", { name: "Recipient type" })).toHaveCount(0);
  await biz.getByTestId("import-csv").click();
  await expect(biz.getByRole("dialog")).toContainText("Columns: name, phone, address, ref, contents, notes");
  await biz.getByLabel("Paste CSV text").fill("name,phone,address,type,ref,contents,notes\nMona Ali,0555555555,King Fahd Rd 120 Riyadh,business,ORD-1,Clothes,Gate 2");
  await biz.getByRole("button", { name: "Preview" }).click();
  await expect(biz.getByTestId("import-b2b-coerced")).toBeVisible(); // a "business" row is added as an individual
  await biz.keyboard.press("Escape");
  await biz.goto("/business/api");
  await expect(biz.getByTestId("api-b2b-off-doc")).toBeVisible();
  // the API itself refuses a business recipient while the switch is off
  const refused = await api(biz.request, "POST", "/requests", { service: "delivery_driver", quantity: 1, shipmentsPerDriver: 20, vehicleType: "sedan", pickupCity: "riyadh", deliveryCity: "riyadh", pickupAddress: "Warehouse 4, Industrial Area", durationDays: 1, startsAt: new Date(Date.now() + 3 * 864e5).toISOString(), termsAccepted: true,
    shipments: [{ recipientType: "business", recipientName: "Al Noor Pharmacy", recipientPhone: "0501234567", address: "Olaya St, Building 8, Riyadh" }] });
  expect(refused.status).toBe(422); expect(refused.json.error.code).toBe("B2B_DISABLED");

  // switched on: the radio group is back (existing behaviour), the docs note is gone
  await setFieldModes(browser, { b2bShipmentsEnabled: true });
  await toShipmentsStep(biz);
  await biz.getByTestId("add-row").click();
  const group = biz.getByRole("radiogroup", { name: "Recipient type" });
  await expect(group).toBeVisible();
  await group.getByRole("radio", { name: /Business/ }).click();
  await expect(group.getByRole("radio", { name: /Business/ })).toBeChecked();
  await biz.goto("/business/api");
  await expect(biz.getByTestId("api-cod-doc")).toBeVisible();
  await expect(biz.getByTestId("api-b2b-off-doc")).toHaveCount(0);
  await setFieldModes(browser, { b2bShipmentsEnabled: false });
});
