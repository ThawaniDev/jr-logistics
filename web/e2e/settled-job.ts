import { expect, type APIRequestContext, type Browser } from "@playwright/test";
import { apiLogin, DEMO, staffLogin } from "./helpers";
import { setFieldModes } from "./field-modes";

/**
 * Makes sure the database holds at least one PAID settlement (a job that was delivered and paid out), for specs that read the settlements list
 * ("the newest settlement") and used to pass only because an earlier spec of the same run had created one — alone they timed out.
 * Does nothing when a settlement already exists. The job is driven through the public APIs with the demo accounts (routing is switched on for the
 * length of the job, like `invoice-detail.spec.ts` does, and put back).
 */
const BASE = `http://localhost:${process.env.E2E_PORT ?? 3101}`; // not 3100: other projects on this machine use it
const ADMIN = { email: "admin@jrlogistics.test", password: "E2e!Password2026" };

async function api(ctx: APIRequestContext, method: "GET" | "POST" | "PUT", path: string, data?: unknown) {
  const res = await ctx.fetch(`${BASE}/api/v1${path}`, { method, data, headers: { origin: BASE, "content-type": "application/json" } });
  const text = await res.text();
  let json: any = null; try { json = JSON.parse(text); } catch { /* not json */ }
  return { status: res.status(), json, text };
}

export async function ensureSettlement(browser: Browser): Promise<void> {
  const adminCtx = await browser.newContext();
  try {
    const page = await adminCtx.newPage();
    await staffLogin(page, ADMIN.email, ADMIN.password);
    const have = await api(adminCtx.request, "GET", "/admin/finance/settlements?pageSize=1");
    if (have.status === 200 && (have.json?.total ?? have.json?.items?.length ?? 0) > 0) return;
  } finally { await adminCtx.close(); }

  const saved = await setFieldModes(browser, { routingEnabled: true });
  const biz = await apiLogin(browser, DEMO.business);
  const drv = await apiLogin(browser, DEMO.driver);
  try {
    await api(drv.request, "PUT", "/driver/availability", { available: true });
    const pub = await api(biz.request, "POST", "/requests", {
      service: "delivery_driver", quantity: 1, shipmentsPerDriver: 10, vehicleType: "sedan", pickupCity: "riyadh", deliveryCity: "riyadh", pickupAddress: "Warehouse 4, Industrial Area", durationDays: 1,
      startsAt: new Date(Date.now() + 3 * 3600e3).toISOString(), publish: true, termsAccepted: true,
      shipments: [{ recipientName: "Settlement Customer", recipientPhone: "0530000099", address: "1 Olaya St, Riyadh" }],
    });
    expect(pub.status, pub.text).toBe(201);
    const offer = (await api(drv.request, "GET", "/driver/offers")).json.items.find((o: any) => o.requestId === pub.json.id);
    expect(offer, "the driver is offered the job").toBeTruthy();
    expect((await api(drv.request, "POST", `/offers/${offer.offerId}/accept`, { termsAccepted: true })).status).toBe(200);
    expect((await api(drv.request, "POST", `/offers/${offer.offerId}/checkin`, { lat: 24.7136, lng: 46.6753 })).status).toBe(200);
    await api(biz.request, "POST", `/offers/${offer.offerId}/attendance`, { present: true });
    const list = (await api(biz.request, "GET", `/requests/${pub.json.id}/shipments?pageSize=200`)).json.items as Array<{ id: string; code: string; demoOtp: string }>;
    for (const sp of list) expect((await api(drv.request, "POST", `/offers/${offer.offerId}/loading/scan`, { code: sp.code })).status).toBe(200);
    expect((await api(drv.request, "POST", `/offers/${offer.offerId}/loading/finish`, {})).status).toBe(200);
    expect((await api(drv.request, "POST", `/offers/${offer.offerId}/route/approve`)).status).toBe(200);
    for (const sp of list) {
      expect((await api(drv.request, "POST", `/offers/${offer.offerId}/stops/${sp.id}/arrive`, {})).status).toBe(200);
      expect((await api(drv.request, "POST", `/offers/${offer.offerId}/stops/${sp.id}/deliver`, { code: sp.code, otp: sp.demoOtp })).status).toBe(200);
    }
    expect((await api(drv.request, "POST", `/offers/${offer.offerId}/delivered`, {})).json.status).toBe("completed");
  } finally {
    await biz.close(); await drv.close();
    await setFieldModes(browser, saved);
  }
}
