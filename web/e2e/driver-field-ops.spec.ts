import { test, expect, type APIRequestContext } from "@playwright/test";
import { staffLogin, DEMO, apiLogin } from "./helpers";

/**
 * The driver's web screens end to end (decisions E1–E14, E17): geofenced check-in, loading by scanning, the route re-ordered by hand,
 * the map view with its shipment popup, postponing with evidence, signature + cash on delivery, the stat cards, one active job at a time,
 * the cash page and the new-offer notification. The warehouse side is driven through the API.
 */
test.describe.configure({ mode: "serial" });
test.use({ actionTimeout: 20_000 }); // a missing control fails with its name instead of waiting for the whole test to time out
const BASE = "http://localhost:3100";
const WAREHOUSE = { latitude: 24.7136, longitude: 46.6753 };
const PNG = Buffer.from("89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c6360f8cfc00000030101004d1b7ea60000000049454e44ae426082", "hex");

async function api(ctx: APIRequestContext, method: "GET" | "POST" | "PUT" | "PATCH", path: string, data?: unknown) {
  const res = await ctx.fetch(`${BASE}/api/v1${path}`, { method, data, headers: { origin: BASE, "content-type": "application/json" } });
  return { status: res.status(), json: await res.json().catch(() => null) };
}

test("driver web: geofenced check-in → scan → re-order → map popup → evidence → signature + cash → stats → one active job → cash page", async ({ browser }) => {
  test.setTimeout(300_000);
  const biz = await apiLogin(browser, DEMO.business);
  const meId = ((await api(biz.request, "GET", "/auth/me")).json as any).user?.id;
  // this warehouse asks for the recipient's signature (a per-warehouse switch the superadmin sets)
  const adminPage = await (await browser.newContext()).newPage();
  await staffLogin(adminPage, "admin@jrlogistics.test", "E2e!Password2026");
  expect((await api(adminPage.request, "PATCH", `/admin/businesses/${meId}/warehouse`, { ops: { requireSignature: true } })).status).toBe(200);
  try {
    // ── an order of 6 parcels with map pins (two are cash on delivery) ──
    const pins = [[24.700, 46.640], [24.720, 46.700], [24.690, 46.670], [24.730, 46.650], [24.710, 46.690], [24.680, 46.720]];
    const shipments = pins.map(([lat, lng], i) => ({ recipientName: `Door Customer ${i + 1}`, recipientPhone: `05400000${String(i + 10)}`, address: `${i + 1} Olaya St, Riyadh`, lat, lng, externalRef: `DRV-E2E-${i + 1}`, ...(i === 1 ? { codCents: 15_000 } : {}), ...(i === 3 ? { codCents: 4_000 } : {}) }));
    const pub = await api(biz.request, "POST", "/requests", { service: "delivery_driver", quantity: 1, shipmentsPerDriver: 10, vehicleType: "dokker", pickupCity: "riyadh", deliveryCity: "riyadh", pickupAddress: "Warehouse 4, Industrial Area", durationDays: 1, startsAt: new Date(Date.now() + 2 * 3600e3).toISOString(), publish: true, termsAccepted: true, shipments });
    expect(pub.status, JSON.stringify(pub.json)).toBe(201);

    // ── the driver (Khalid, dokker) in his browser, positioned FAR from the warehouse ──
    const dctx = await apiLogin(browser, "0500000012", { geolocation: { latitude: 24.9, longitude: 46.9 }, permissions: ["geolocation"] });
    const drv = await dctx.newPage();
    await api(drv.request, "PUT", "/driver/availability", { available: true });
    const offer = (await api(drv.request, "GET", "/driver/offers")).json.items.find((o: any) => o.requestId === pub.json.id);
    expect(offer).toBeTruthy();
    // the offer was announced: an in-app notification with parcels, cities and earning
    const notif = ((await api(drv.request, "GET", "/notifications?unreadOnly=1")).json.items as any[]).find((n) => n.type === "offer_new" && n.data?.requestId === pub.json.id);
    expect(notif?.data).toMatchObject({ parcels: 6, pickupCity: "riyadh", deliveryCity: "riyadh" });
    expect((await api(drv.request, "POST", `/offers/${offer.offerId}/accept`, { termsAccepted: true })).status).toBe(200);
    const jobUrl = `/driver/jobs/${offer.offerId}`;

    // E11: one active job — no other offers are shown or offered
    expect((await api(drv.request, "GET", "/driver/offers")).json).toMatchObject({ items: [], hidden: true });
    await drv.goto("/driver");
    await expect(drv.getByTestId("active-job-card")).toBeVisible();
    await drv.goto("/driver/opportunities");
    await expect(drv.getByTestId("offers-hidden")).toBeVisible();

    // E1: check-in is refused far from the warehouse (with the distance), accepted at it
    await drv.goto(jobUrl);
    await expect(drv.getByTestId("geofence-hint")).toBeVisible();
    await drv.getByTestId("checkin").click();
    await expect(drv.getByText(/too far|within 200/i).first()).toBeVisible();
    await dctx.setGeolocation(WAREHOUSE);
    await drv.getByTestId("retry-location").click().catch(() => {});
    await drv.getByTestId("checkin").click();
    // E2: the (default) warehouse confirms the arrival
    expect((await api(biz.request, "POST", `/offers/${offer.offerId}/attendance`, { present: true })).status).toBe(200);

    // E3/E4: loading by scanning — a wrong code is refused, five of the six parcels are scanned, finishing asks about the unscanned one
    const list = (await api(biz.request, "GET", `/requests/${pub.json.id}/shipments?pageSize=200`)).json.items as Array<{ id: string; code: string; seq: number; demoOtp: string; codCents: number }>;
    list.sort((a, b) => a.seq - b.seq);
    await drv.goto(jobUrl);
    await expect(drv.getByTestId("loading-scan")).toBeVisible();
    await drv.getByTestId("scan-input").fill("NOT-THIS-ORDER");
    await drv.getByTestId("scan-submit").click();
    await expect(drv.getByTestId("scan-feedback")).toBeVisible();
    for (const [i, p] of list.slice(0, 5).entries()) {
      await drv.getByTestId("scan-input").fill(p.code);
      await drv.getByTestId("scan-submit").click();
      await expect(drv.getByTestId("scan-progress")).toHaveAttribute("data-scanned", String(i + 1));
    }
    await drv.getByTestId("scan-input").fill(list[0].code); // a second scan of the same parcel is harmless
    await drv.getByTestId("scan-submit").click();
    await expect(drv.getByTestId("scan-progress")).toHaveAttribute("data-scanned", "5");
    await drv.getByTestId("scan-finish").click();
    await drv.getByTestId("scan-finish-confirm").click(); // "1 parcel goes back to the warehouse"
    await expect(drv.getByTestId("route-review-title")).toBeVisible();
    expect((await api(biz.request, "GET", `/requests/${pub.json.id}`)).json.offers[0].loading).toMatchObject({ scanned: 5, finished: true });

    // E5: arrange the route by hand — move the last stop to the front — and save it
    const before = (await api(drv.request, "GET", `/driver/jobs/${offer.offerId}`)).json.stops as Array<{ id: string; code: string }>;
    expect(before).toHaveLength(5);
    await drv.locator(`[data-testid="reorder-make-next"][data-code="${before[4].code}"]`).click();
    await drv.getByTestId("reorder-save").click();
    await expect.poll(async () => (await api(drv.request, "GET", `/driver/jobs/${offer.offerId}`)).json.route.manual).toBe(true);
    const arranged = (await api(drv.request, "GET", `/driver/jobs/${offer.offerId}`)).json;
    expect(arranged.stops[0].id).toBe(before[4].id); expect(arranged.route).toMatchObject({ provider: "manual", canReorder: true });
    await drv.getByRole("button", { name: "Approve route" }).first().click();

    // stat cards on the order page: shipments · to deliver · delivered · not delivered · cash
    await expect(drv.getByTestId("job-stats")).toBeVisible();
    await expect(drv.getByTestId("stat-total")).toHaveAttribute("data-value", "5");
    await expect(drv.getByTestId("stat-to-deliver")).toHaveAttribute("data-value", "5");
    await expect(drv.getByTestId("stat-delivered")).toHaveAttribute("data-value", "0");

    // E6: the map view — markers, a list, and a popup for any shipment with its quick actions
    await drv.getByTestId("map-view-tab").click();
    await expect(drv.getByTestId("route-map")).toHaveAttribute("data-ready", "1", { timeout: 30_000 });
    await expect(drv.getByTestId("map-marker")).toHaveCount(5);
    await expect(drv.getByTestId("map-row")).toHaveCount(5);
    const geometry = (await api(drv.request, "GET", `/driver/jobs/${offer.offerId}/route-geometry`)).json;
    expect(geometry.legs).toHaveLength(5);
    const nextCode = arranged.stops[0].code as string, laterCode = arranged.stops[3].code as string;
    await drv.locator(`[data-testid="map-row-open"][data-code="${laterCode}"]`).click();
    await expect(drv.getByTestId("map-popup")).toHaveAttribute("data-code", laterCode);
    await expect(drv.getByTestId("map-popup-navigate")).toBeVisible();
    await expect(drv.getByTestId("map-popup-make-next")).toBeVisible(); // not the current stop: only navigate / make next
    await expect(drv.getByTestId("map-popup-deliver")).toHaveCount(0);
    await drv.keyboard.press("Escape"); // the popup is a dialog
    await expect(drv.getByTestId("map-popup")).toHaveCount(0);
    await drv.locator(`[data-testid="map-marker"][data-code="${nextCode}"]`).click();
    await expect(drv.getByTestId("map-popup")).toHaveAttribute("data-code", nextCode);
    await drv.getByTestId("map-popup-arrive").click(); // quick action straight from the popup
    await expect.poll(async () => ((await api(drv.request, "GET", `/driver/jobs/${offer.offerId}`)).json.stops[0].arrivedAt ?? null) !== null).toBe(true);
    await expect(drv.getByTestId("map-popup-deliver")).toBeVisible(); // arrived: the popup now offers Deliver
    await drv.keyboard.press("Escape");
    await drv.getByTestId("list-view-tab").click();

    // E7: postponing needs evidence (text AND photo) — refused without, accepted with
    await drv.getByTestId("stop-defer").click();
    await drv.getByTestId("defer-confirm").click();
    expect((await api(drv.request, "GET", `/driver/jobs/${offer.offerId}`)).json.stops[0].code).toBe(nextCode); // still the same stop
    await drv.getByTestId("defer-note").fill("Shop is closed until 5pm");
    await drv.getByTestId("defer-photo").setInputFiles({ name: "closed.png", mimeType: "image/png", buffer: PNG });
    await drv.getByTestId("defer-confirm").click();
    await expect.poll(async () => (await api(drv.request, "GET", `/driver/jobs/${offer.offerId}`)).json.stops[0].code).not.toBe(nextCode);
    const deferred = list.find((p) => p.code === nextCode)!;
    const media = (await api(biz.request, "GET", `/shipments/${deferred.id}/media`)).json.items as Array<{ kind: string }>;
    expect(media.map((m) => m.kind)).toEqual(["defer"]); // the warehouse can see the evidence
    expect(((await api(biz.request, "GET", `/shipments/${deferred.id}`)).json.events as any[]).find((e) => e.type === "stop_deferred").payload).toMatchObject({ note: "Shop is closed until 5pm" });

    // E10 + E17: deliver the cash-on-delivery parcel — signature pad, "I collected SAR 150.00", the recipient's code
    const cur = (await api(drv.request, "GET", `/driver/jobs/${offer.offerId}`)).json.stops[0] as { id: string; code: string };
    const row = list.find((p) => p.code === cur.code)!;
    await drv.getByRole("button", { name: "I've arrived" }).first().click();
    await drv.getByLabel("Parcel code").fill(row.code);
    await drv.getByLabel("Delivery code").fill(row.demoOtp);
    await drv.getByRole("button", { name: "Confirm delivery" }).last().click();
    await expect(drv.getByTestId("signature-error")).toBeVisible(); // the warehouse requires the signature
    const canvas = drv.getByTestId("signature-canvas");
    await canvas.scrollIntoViewIfNeeded();
    await drv.evaluate(() => window.scrollBy(0, -120)); // keep it clear of the sticky header
    const box = (await canvas.boundingBox())!;
    await drv.mouse.move(box.x + 20, box.y + 20); await drv.mouse.down(); await drv.mouse.move(box.x + 120, box.y + 60, { steps: 8 }); await drv.mouse.move(box.x + 60, box.y + 90, { steps: 8 }); await drv.mouse.up();
    if (row.codCents > 0) await drv.getByTestId("cod-collect-confirm").check();
    await drv.getByRole("button", { name: "Confirm delivery" }).last().click();
    await expect.poll(async () => (await api(drv.request, "GET", `/driver/jobs/${offer.offerId}`)).json.stopsSummary.delivered).toBe(1);
    expect(((await api(biz.request, "GET", `/shipments/${row.id}/media`)).json.items as Array<{ kind: string }>).map((m) => m.kind)).toContain("signature");
    await expect(drv.getByTestId("stat-delivered")).toHaveAttribute("data-value", "1");

    // can't deliver: every reason works right away, with an optional photo
    await drv.getByTestId("stop-fail").click();
    await drv.getByTestId("fail-reason-damaged").click(); // a reason that used to demand a note and an arrival
    await drv.getByTestId("fail-photo").setInputFiles({ name: "damaged.png", mimeType: "image/png", buffer: PNG });
    await drv.getByTestId("fail-continue").click();
    await drv.getByTestId("fail-confirm").click();
    await expect.poll(async () => (await api(drv.request, "GET", `/driver/jobs/${offer.offerId}`)).json.stopsSummary.failed).toBe(1);
    await expect(drv.getByTestId("stat-not-delivered")).toHaveAttribute("data-value", "1");

    // the rest of the route straight through the API (the same calls the UI makes), then finish in the UI
    for (;;) {
      const j = (await api(drv.request, "GET", `/driver/jobs/${offer.offerId}`)).json;
      const s = (j.stops as any[]).find((x) => x.current);
      if (!s) break;
      const p = list.find((x) => x.code === s.code)!;
      expect((await api(drv.request, "POST", `/offers/${offer.offerId}/stops/${s.id}/arrive`, {})).status).toBe(200);
      const sig = await drv.request.fetch(`${BASE}/api/v1/offers/${offer.offerId}/stops/${s.id}/media`, { method: "POST", headers: { origin: BASE }, multipart: { kind: "signature", file: { name: "s.png", mimeType: "image/png", buffer: PNG } } });
      expect(sig.status()).toBe(201);
      expect((await api(drv.request, "POST", `/offers/${offer.offerId}/stops/${s.id}/deliver`, { code: p.code, otp: p.demoOtp, signatureMediaId: (await sig.json()).id, ...(p.codCents > 0 ? { cashCollectedCents: p.codCents } : {}) })).status).toBe(200);
    }
    await drv.goto(jobUrl);
    await drv.getByRole("button", { name: "Finish route" }).first().click();
    await expect(drv.getByTestId("job-completed")).toBeVisible(); // confirmed + paid at once (E16/E18)

    // E17: the driver's cash — page + dashboard card — and the warehouse's receipt shrinks it
    const cash = (await api(drv.request, "GET", "/driver/cash")).json;
    const final = (await api(biz.request, "GET", `/requests/${pub.json.id}/shipments?pageSize=200`)).json.items as Array<{ status: string; codCents: number; codCollectedCents: number | null }>;
    const expectedCash = final.filter((x) => x.status === "delivered").reduce((a, x) => a + (x.codCollectedCents ?? 0), 0);
    expect(cash.collectedCents).toBe(expectedCash); expect(expectedCash).toBeGreaterThan(0); // only delivered parcels carry cash; a failed one holds none
    await drv.goto("/driver/cash");
    await expect(drv.getByTestId("cash-total-outstanding")).toHaveAttribute("data-value", String(cash.outstandingCents));
    await expect(drv.getByTestId("cash-orders")).toContainText(pub.json.ref);
    await drv.goto("/driver");
    await expect(drv.getByTestId("cash-card")).toHaveAttribute("data-value", String(cash.outstandingCents));

    // free again: offers are visible once more, and a NEW offer pops up as a toast within the poll interval (E12)
    expect((await api(drv.request, "GET", "/driver/offers")).json.hidden).toBe(false);
    const again = await api(biz.request, "POST", "/requests", { service: "delivery_driver", quantity: 1, shipmentsPerDriver: 10, vehicleType: "dokker", pickupCity: "riyadh", deliveryCity: "riyadh", pickupAddress: "Warehouse 4, Industrial Area", durationDays: 1, startsAt: new Date(Date.now() + 3 * 864e5).toISOString(), publish: true, termsAccepted: true,
      shipments: [{ recipientName: "Late One", recipientPhone: "0540000099", address: "9 Olaya St, Riyadh" }] });
    expect(again.status).toBe(201);
    await expect(drv.getByText(/New job offer|عرض مهمة جديد/).first()).toBeVisible({ timeout: 60_000 });
  } finally {
    await api(adminPage.request, "PATCH", `/admin/businesses/${meId}/warehouse`, { ops: { requireSignature: null } });
  }
});
