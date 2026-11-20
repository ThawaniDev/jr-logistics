import { test, expect, type Browser, type Page } from "@playwright/test";
import { otpLogin, staffLogin, DEMO } from "./helpers";
import { STUB_PORT, type StubCall } from "./google-stub";
import { setFieldModes, type FieldModes } from "./field-modes";
import { openNext } from "./driver-ui";

/**
 * (1) An order booked by COUNT ("details later"), mixed with picked demo parcels: the wizard, the hand-over gate, completing the details.
 * (2) 80 demo parcels for ONE driver: the best route is planned through the Google stand-in in chunks (never more than 25 intermediates per call),
 *     the driver sees the plan, re-optimises from where they are, approves it and works the stops in the planned order.
 */
const STUB = `http://127.0.0.1:${STUB_PORT}`;
const DRIVER = { sedan: DEMO.driver /* Omar, sedan */, hiace: "0500000013" /* Yusuf, hiace */ };

test.describe.configure({ mode: "serial" });

let savedModes: FieldModes; // J2 / J3: routing and B2B shipments are OFF by default — this spec drives routes / "Approve route" / business parcels
test.beforeAll(async ({ browser }) => { savedModes = await setFieldModes(browser, { routingEnabled: true, b2bShipmentsEnabled: true }); });
test.afterAll(async ({ browser }) => { await setFieldModes(browser, savedModes); });

const startIn = (days: number) => new Date(Date.now() + days * 864e5 + 3 * 3600e3).toISOString().slice(0, 11) + "09:00";

/** Wizard steps 1–2 for a delivery order, ending on the Shipments step. */
async function toShipmentsStep(biz: Page, vehicle: string, days: number) {
  await biz.getByRole("link", { name: "New request" }).first().click();
  await biz.getByRole("button", { name: /Delivery driver/ }).click();
  await biz.getByLabel(/^Vehicle/).selectOption(vehicle);
  await biz.getByRole("button", { name: "Next", exact: true }).click();
  await biz.getByLabel(/Pickup address/).fill("GEO-OK Warehouse 4, Industrial Area, Riyadh"); // the Google stand-in locates only addresses with this marker
  await biz.getByLabel(/Start date/).fill(startIn(days));
  await biz.getByRole("button", { name: "Next", exact: true }).click();
  await expect(biz.getByLabel("Max parcels per driver")).toBeVisible();
}
async function publish(biz: Page) {
  await biz.getByRole("button", { name: "Next", exact: true }).last().click(); // the parcel list has its own (smaller) pagination "Next" above the wizard's
  await biz.getByRole("checkbox").last().check();
  await biz.getByRole("button", { name: "Publish & reserve funds" }).click();
  await expect(biz).toHaveURL(/\/business\/requests\/[0-9a-f-]{36}/);
  return biz.url();
}
/** POST from inside the page (same origin, session cookie) — the API refuses cross-origin writes, which is what Playwright's bare request context looks like. */
const apiPost = (page: Page, path: string, data: unknown, method: "POST" | "PATCH" = "POST") => page.evaluate(async ([p, d, m]) => {
  const r = await fetch(p as string, { method: m as string, headers: { "content-type": "application/json" }, body: JSON.stringify(d) });
  return { status: r.status, json: (await r.json().catch(() => null)) as Record<string, any> | null };
}, [path, data, method] as const);

/** The driver takes the job (terms accepted); returns the offer's job URL. */
async function driverAccepts(browser: Browser, phone: string, reqId: string, geo?: { latitude: number; longitude: number }) {
  const ctx = await browser.newContext(geo ? { geolocation: geo, permissions: ["geolocation"] } : {});
  const drv = await ctx.newPage();
  await otpLogin(drv, phone);
  const r = await apiPost(drv, `/api/v1/driver/requests/${reqId}/apply`, { termsAccepted: true });
  expect(r.status, JSON.stringify(r.json)).toBeLessThan(300);
  const offerId = r.json!.id as string;
  expect(offerId).toBeTruthy();
  return { drv, offerId, jobUrl: `/driver/jobs/${offerId}` };
}

test("order by count + demo parcels: details later, the hand-over gate, completing the details", async ({ browser, request }) => {
  test.setTimeout(240_000);
  const biz = await (await browser.newContext()).newPage();
  await otpLogin(biz, DEMO.business);
  await toShipmentsStep(biz, "sedan", 3);

  // "I only know how many parcels": 6 parcels, 2 of them picked from the demo data → 2 detailed + 4 blank, total stays 6
  await biz.getByTestId("details-mode-later").click();
  await expect(biz.getByTestId("later-notice")).toBeVisible();
  await biz.getByTestId("shipment-count-input").fill("6");
  await expect(biz.getByTestId("parcel-count")).toHaveText("6");
  await expect(biz.getByTestId("blank-count")).toContainText("6");
  await biz.getByTestId("demo-open").click();
  await expect(biz.getByTestId("demo-label")).toBeVisible();
  await expect(biz.getByTestId("demo-item")).toHaveCount(80);
  await biz.getByTestId("demo-item").nth(0).getByRole("checkbox").check();
  await biz.getByTestId("demo-item").nth(1).getByRole("checkbox").check();
  await expect(biz.getByTestId("demo-selected-count")).toContainText("2");
  await biz.getByTestId("demo-add-selected").click();
  await expect(biz.getByTestId("parcel-count")).toHaveText("6"); // picked parcels use up blank slots
  await expect(biz.getByTestId("blank-count")).toContainText("4");
  await expect(biz.getByTestId("manifest-row")).toHaveCount(2); // blanks are never rendered as 4 forms
  await biz.getByTestId("demo-open").click(); // picking the same ones again adds nothing
  await biz.getByTestId("demo-item").nth(0).getByRole("checkbox").check();
  await expect(biz.getByTestId("demo-skip-note")).toBeVisible();
  await biz.getByTestId("demo-cancel").click();

  // review warns about the parcels without details, and the order still publishes (priced by count: 6 × SAR 8.00)
  await biz.getByRole("button", { name: "Next", exact: true }).click();
  await expect(biz.getByTestId("review-missing-warning")).toBeVisible();
  await expect(biz.getByText("SAR 48.00").first()).toBeVisible();
  await biz.getByRole("checkbox").last().check();
  await biz.getByRole("button", { name: "Publish & reserve funds" }).click();
  await expect(biz).toHaveURL(/\/business\/requests\/[0-9a-f-]{36}/);
  const reqUrl = biz.url(); const reqId = reqUrl.split("/").pop()!;
  await expect(biz.getByTestId("incomplete-banner")).toBeVisible();
  expect((await (await biz.request.get(`/api/v1/requests/${reqId}`)).json()).incompleteParcels).toBe(4);

  // this warehouse records the hand-over itself (a per-warehouse switch the superadmin set) — so the hand-over gate is on screen
  const admin = await (await browser.newContext()).newPage();
  await staffLogin(admin, "admin@jrlogistics.test", "E2e!Password2026");
  const meId = ((await (await biz.request.get("/api/v1/auth/me")).json()) as any).user?.id ?? ((await (await biz.request.get("/api/v1/auth/me")).json()) as any).id;
  const setRecord = (v: boolean | null) => apiPost(admin, `/api/v1/admin/businesses/${meId}/warehouse`, { ops: { requireLoadingRecord: v } }, "PATCH");
  expect((await setRecord(true)).status).toBe(200);

  // the driver takes it; the warehouse confirms attendance and starts the hand-over: the 4 blank parcels cannot be handed over
  const { drv, offerId, jobUrl } = await driverAccepts(browser, DRIVER.sedan, reqId);
  await biz.goto(reqUrl);
  await biz.getByRole("button", { name: "Confirm attendance" }).click();
  await expect(biz.getByText("Working").first()).toBeVisible();
  await biz.getByRole("button", { name: "Record loaded quantity" }).click();
  await expect(biz.getByTestId("handover-incomplete")).toBeVisible();
  await expect(biz.locator('[data-testid="handover-item"][data-incomplete="1"]')).toHaveCount(4);
  const raw = await apiPost(biz, `/api/v1/offers/${offerId}/loading`, { all: true }); // the API refuses too, with a machine-readable reason
  expect(raw.status).toBe(422); expect(raw.json!.error).toMatchObject({ code: "DETAILS_INCOMPLETE", details: { count: 4 } });
  await biz.getByTestId("handover-only-complete").click();
  await expect(biz.getByRole("dialog")).toHaveCount(0);
  const after = (await (await biz.request.get(`/api/v1/requests/${reqId}/shipments?pageSize=200`)).json()) as { items: Array<{ status: string; detailsComplete: boolean }> };
  expect(after.items.filter((s) => s.status === "loaded")).toHaveLength(2);

  // complete the other four in one go (inline tab) → the banner disappears; the driver's job is untouched
  await biz.goto(reqUrl);
  await expect(biz.getByTestId("incomplete-banner")).toBeVisible();
  await biz.getByTestId("complete-details-btn").click();
  await expect(biz.getByTestId("complete-dialog")).toBeVisible();
  const rows = biz.getByTestId("complete-row");
  await expect(rows).toHaveCount(4);
  for (let i = 0; i < 4; i++) {
    await rows.nth(i).getByTestId("complete-name").fill(`Late Customer ${i + 1}`);
    await rows.nth(i).getByTestId("complete-phone").fill(`05551234${i}0`);
    await rows.nth(i).getByTestId("complete-address").fill(`${i + 1} King Fahd Rd, Riyadh`);
  }
  await biz.getByTestId("complete-save-all").click();
  await expect(biz.getByTestId("incomplete-banner")).toHaveCount(0);
  expect((await (await biz.request.get(`/api/v1/requests/${reqId}`)).json()).incompleteParcels).toBe(0);
  const done = (await (await biz.request.get(`/api/v1/requests/${reqId}/shipments?pageSize=200`)).json()) as { items: Array<{ detailsComplete: boolean; recipientName: string }> };
  expect(done.items.every((s) => s.detailsComplete)).toBe(true);
  expect(done.items.map((s) => s.recipientName)).toContain("Late Customer 3");

  // the job in the driver's hands continues normally (2 parcels on board)
  await drv.goto(jobUrl);
  await expect(drv.getByRole("button", { name: /Confirm 2 loaded/ })).toBeVisible();
  expect((await setRecord(null)).status).toBe(200); // back to the platform default (the driver scans)
  void request;
});

test("80 demo parcels for one driver: best route planned in chunks, re-optimised from the driver's position, approved and worked in that order", async ({ browser, request }) => {
  test.setTimeout(300_000);
  await request.get(`${STUB}/__reset`);
  const biz = await (await browser.newContext()).newPage();
  await otpLogin(biz, DEMO.business);
  await toShipmentsStep(biz, "hiace", 5);

  // pick ALL 80 demo parcels and give one driver the whole load
  await biz.getByLabel("Max parcels per driver").fill("80");
  await biz.getByTestId("demo-open").click();
  await biz.getByTestId("demo-select-all").click();
  await expect(biz.getByTestId("demo-selected-count")).toContainText("80");
  await biz.getByTestId("demo-add-selected").click();
  await expect(biz.getByTestId("parcel-count")).toHaveText("80");
  await expect(biz.getByTestId("driver-count")).toHaveText("1");
  const reqUrl = await publish(biz); const reqId = reqUrl.split("/").pop()!;

  const { drv, offerId, jobUrl } = await driverAccepts(browser, DRIVER.hiace, reqId, { latitude: 24.8, longitude: 46.7 });
  await biz.goto(reqUrl);
  await biz.getByRole("button", { name: "Confirm attendance" }).click();
  await expect(biz.getByText("Working").first()).toBeVisible();
  // E3: the driver scans all 80 parcels onto the vehicle (the app calls this same endpoint per scan), then finishes loading → the route is planned
  const codes = ((await (await biz.request.get(`/api/v1/requests/${reqId}/shipments?pageSize=200`)).json()).items as Array<{ code: string }>).map((x) => x.code);
  expect(codes).toHaveLength(80);
  await request.get(`${STUB}/__reset`);
  for (const code of codes) expect((await apiPost(drv, `/api/v1/offers/${offerId}/loading/scan`, { code })).status).toBe(200);
  const fin = await apiPost(drv, `/api/v1/offers/${offerId}/loading/finish`, {});
  expect(fin.status).toBe(200); expect(fin.json).toMatchObject({ loaded: 80, released: 0 });

  // hand-over planned the route: 80 stops → 4 balanced Google calls of 20 (19 optimised intermediates + the destination), none above Google's limit of 25
  const calls = async () => ((await (await request.get(`${STUB}/__calls`)).json()) as StubCall[]);
  const routes = (await calls()).filter((c) => c.kind === "routes");
  expect(routes).toHaveLength(4);
  for (const c of routes) { expect(c.intermediates).toBeLessThanOrEqual(24); expect(c.intermediates).toBe(19); expect(c.optimize).toBe(true); }

  // the driver reviews the proposed best route
  await drv.goto(jobUrl);
  await expect(drv.getByTestId("route-review-title")).toBeVisible(); // loading is already finished: straight to reviewing the planned route
  await expect(drv.getByTestId("route-summary")).toBeVisible();
  await expect(drv.getByTestId("route-provider")).toHaveAttribute("data-provider", "google_routes");
  await expect(drv.getByTestId("route-stops")).toContainText("80");
  await expect(drv.getByTestId("route-distance")).toBeVisible(); await expect(drv.getByTestId("route-duration")).toBeVisible();
  await expect(drv.getByTestId("route-warning")).toHaveCount(0);
  await expect(drv.getByTestId("stop-leg").first()).toBeVisible();

  // re-optimise from where the driver actually is (a different position than the warehouse → a fresh, paid plan: 4 more calls)
  await request.get(`${STUB}/__reset`);
  await drv.getByTestId("optimize-route").click();
  await expect.poll(async () => (await calls()).filter((c) => c.kind === "routes").length, { timeout: 30_000 }).toBe(4);
  expect((await calls()).filter((c) => c.kind === "routes").every((c) => (c.intermediates ?? 0) <= 24)).toBe(true);
  // pressing it again in the same place is free (same inputs → cached)
  await expect(drv.getByTestId("optimize-route")).toBeEnabled();
  await drv.getByTestId("optimize-route").click();
  await expect(drv.getByText(/already the best order/i).first()).toBeVisible();
  expect((await calls()).filter((c) => c.kind === "routes")).toHaveLength(4);

  // approve; the navigation link covers the next 9 stops (8 waypoints + destination)
  await drv.getByRole("button", { name: "Approve route" }).first().click();
  const link = await drv.getByTestId("open-in-maps").getAttribute("href");
  expect(link).toContain("https://www.google.com/maps/dir/"); expect(link).toContain("travelmode=driving");
  expect(new URL(link!).searchParams.get("waypoints")!.split("|")).toHaveLength(8);
  await expect(drv.getByTestId("open-in-maps-more")).toBeVisible();

  // the driver works the stops in the PLANNED order: stop 1 first, then stop 2
  const planned = async () => {
    const j = await (await drv.request.get(`/api/v1/driver/jobs/${offerId}`)).json() as { stops: Array<{ id: string; code: string; stopOrder: number; status: string; current: boolean; legDurationS: number | null; located: boolean }> };
    return j.stops;
  };
  const stops = await planned();
  expect(stops).toHaveLength(80); expect(stops.every((s) => s.located && s.legDurationS != null)).toBe(true);
  const order = [...stops].sort((a, b) => a.stopOrder - b.stopOrder);
  expect(order[0].current).toBe(true);
  const list = (await (await biz.request.get(`/api/v1/requests/${reqId}/shipments?pageSize=200`)).json()).items as Array<{ id: string; code: string; demoOtp: string }>;
  const otpOf = (id: string) => list.find((x) => x.id === id)!.demoOtp;
  for (const s of order.slice(0, 2)) {
    await drv.reload();
    await openNext(drv); // a card list: the sticky bar opens the stop to work on
    await drv.getByRole("button", { name: "I've arrived" }).first().click();
    await drv.getByLabel("Parcel code").fill(s.code);
    await drv.getByLabel("Delivery code").fill(otpOf(s.id));
    const cash = drv.getByTestId("cod-collect-confirm"); // a cash-on-delivery parcel: the driver confirms he collected the exact amount
    if (await cash.count()) await cash.check();
    await drv.getByRole("button", { name: "Confirm delivery" }).last().click();
    await expect.poll(async () => (await planned()).find((x) => x.id === s.id)!.status).toBe("delivered");
  }
  const now = await planned();
  expect(now.find((s) => s.current)!.id).toBe(order[2].id); // exactly the third stop of the plan is next

  // re-optimising mid-route never touches stops that are already delivered
  await request.get(`${STUB}/__reset`);
  await drv.reload();
  await drv.getByTestId("optimize-route").click();
  await expect.poll(async () => (await calls()).filter((c) => c.kind === "routes").length, { timeout: 30_000 }).toBeGreaterThan(0);
  const mid = await planned();
  expect(mid.filter((s) => s.status === "delivered").map((s) => s.id).sort()).toEqual([order[0].id, order[1].id].sort());
  expect(mid.filter((s) => s.status === "loaded")).toHaveLength(78);
});
