import { describe, it, expect, beforeEach, afterAll, beforeAll } from "vitest";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { auditLogs, notifications, offers, partnerConnections, partnerOrders, partnerOutbox, shipments, users, type User } from "@/db/schema";
import { resetDb, shutdown, mkAdmin, mkBusiness, mkDriver, mkRule, mkStaff, reqInput } from "../helpers/factories";
import * as jobs from "@/server/jobs";
import * as stops from "@/server/stops";
import { createDraft, publishRequest } from "@/server/requests";
import * as partners from "@/server/partners/service";
import { _resetShipoxTokens } from "@/server/partners/shipox";
import { dispatch } from "@/server/api/router";
import "@/server/api/routes";
import { work } from "../helpers/work";

beforeEach(resetDb);
afterAll(shutdown);

/** One stand-in for every vendor: records each call, answers from a per-test script. */
type Call = { method: string; path: string; query: URLSearchParams; headers: http.IncomingHttpHeaders; body: any; raw: string };
let server: http.Server, fake = "";
let calls: Call[] = [];
let respond: (c: Call) => { status: number; body?: unknown } = () => ({ status: 200, body: {} });
beforeAll(async () => {
  server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      const u = new URL(req.url!, "http://x");
      const raw = Buffer.concat(chunks).toString();
      let body: any = null; try { body = JSON.parse(raw || "null"); } catch { body = raw; }
      const call: Call = { method: req.method!, path: u.pathname, query: u.searchParams, headers: req.headers, body, raw };
      calls.push(call);
      const r = respond(call);
      res.writeHead(r.status, { "content-type": "application/json" });
      res.end(r.body === undefined ? "" : JSON.stringify(r.body));
    });
  });
  await new Promise<void>((ok) => server.listen(0, "127.0.0.1", ok));
  fake = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => new Promise<void>((ok) => server.close(() => ok())));
beforeEach(() => { calls = []; respond = () => ({ status: 200, body: {} }); _resetShipoxTokens(); });

async function setup() { const admin = await mkAdmin(); await mkRule(admin); const biz = await mkBusiness({ fundsCents: 10_000_00 }); return { admin, biz }; }
/** Calls the real router like a partner would (no session). */
async function hit(method: string, path: string, o: { token?: string; body?: unknown; headers?: Record<string, string> } = {}) {
  const res = await dispatch(new Request(`http://localhost/api/v1${path}`, { method, headers: { "content-type": "application/json", ...(o.token ? { authorization: `Bearer ${o.token}` } : {}), ...(o.headers ?? {}) }, body: o.body === undefined ? undefined : JSON.stringify(o.body) }));
  const text = await res.text();
  let json: any = null; try { json = JSON.parse(text); } catch { json = text; }
  return { status: res.status, json, headers: res.headers };
}
/** Puts open incoming orders into a JR delivery order (as the business does from Incoming orders) and gets a driver to accept it. */
async function dispatchOrders(biz: User, ids: string[], o: { publish?: boolean } = {}) {
  const m = await partners.ordersToManifest(biz, ids);
  const rows = m.rows.map((r: any) => ({ recipientType: r.recipientType, recipientName: r.recipientName, recipientPhone: r.recipientPhone, address: r.address, city: r.city, lat: r.lat, lng: r.lng, contents: r.contents, notes: r.notes, externalRef: r.externalRef, partnerId: r.partnerId, codCents: r.codCents }));
  await mkDriver();
  const d = await createDraft(biz, reqInput({ shipments: rows, shipmentsPerDriver: 30 }));
  if (o.publish === false) return { request: d, offer: null, driver: null };
  const r = await publishRequest(biz, d.id, { termsAccepted: true });
  const [off] = await db.select().from(offers).where(eq(offers.requestId, r.id));
  const [driver] = await db.select().from(users).where(eq(users.id, off.driverId));
  return { request: r, offer: off, driver };
}

// ─────────────────────────── Omniful: JR is the carrier ───────────────────────────
const omnifulShipment = (o: Partial<Record<string, unknown>> = {}) => ({
  order_id: "B2C-4342026000421", reference: "SO-2026-000421", system_id: "6a477731c034d123fee4b20d",
  pickup_details: { name: "Riyadh Main Warehouse", phone: "+966501234567", location_code: "RUH-WH-01", address_line_1: "Building 12, Industrial Zone", system_city: "Riyadh", country_code: "SA", latitude: 24.7136, longitude: 46.6753 },
  drop_details: { name: "Fahad Ali", email: "fahad.ali@example.com", phone: "+966509876543", address_line_1: "Flat 21, Palm Residency", address_line_2: "Prince Sultan Street", building_number: "21", street: "Prince Sultan Street", area: "Al Olaya", system_city: "Riyadh", system_city_id: "7570", external_city: "Riyadh", latitude: 24.726, longitude: 46.675, country_code: "SA", postal_code: "12211", national_address_code: "RDAA7788" },
  payment_details: { is_cod: true, currency: "SAR", cod_amount: 245.75, total_paid: 0, total_order_value: 245.75 },
  packages: [{ weight: { value: 1.5, uom: "kg" }, length: 30, breadth: 20, height: 10, dimension_uom: "cm" }],
  weight: { value: 1.5, uom: "kg" }, number_of_boxes: 1, remarks: "Deliver during business hours if possible.",
  meta: { custom_fields: [{ key: "service_type", value: "same_day" }] },
  items: [{ sku_code: "TSHIRT-BLK-M", sku_name: "Black T-Shirt - Medium", ordered_quantity: 3, shipped_quantity: 1, unit_price: 199.0 }],
  delivery_slot: { start_date: "15-07-2026", end_date: "15-07-2026", start_time: "09:00:00", end_time: "18:00:00" },
  ...o,
});

describe("Omniful Shipping Partner API (through the real router)", () => {
  it("authenticates both ways Omniful supports and refuses everything else with its error envelope", async () => {
    const { biz } = await setup();
    const c = await partners.createConnection(biz, { provider: "omniful", name: "Omniful KSA" });
    expect(c.carrier).toMatchObject({ baseUrl: expect.stringMatching(/\/api\/v1\/carriers\/omniful$/), apiKey: c.inboundToken, clientId: c.id, clientSecret: c.inboundToken });
    expect(await hit("POST", "/carriers/omniful/auth/validate", { body: { api_key: c.inboundToken } })).toMatchObject({ status: 200, json: { success: true, data: {} } });
    expect(await hit("POST", "/carriers/omniful/auth/validate", { body: { api_key: "jrh_wrong" } })).toMatchObject({ status: 401, json: { success: false, error: { code: "AUTHENTICATION_ERROR" } } });
    const tok = await hit("POST", "/carriers/omniful/auth/token", { body: { client_id: c.id, client_secret: c.inboundToken, grant_type: "client_credentials" } });
    expect(tok).toMatchObject({ status: 200, json: { success: true, data: { access_token: expect.stringMatching(/^jrat_/), expire_in: 3600 } } });
    expect(await hit("POST", "/carriers/omniful/auth/token", { body: { client_id: c.id, client_secret: "nope" } })).toMatchObject({ status: 401 });
    // Both credentials work as Bearer on the other endpoints; rotating them kills both at once (including issued access tokens).
    expect((await hit("POST", "/carriers/omniful/shipments", { token: tok.json.data.access_token, body: omnifulShipment() })).status).toBe(200);
    expect((await hit("GET", "/carriers/omniful/shipments/NOPE/tracking", { token: c.inboundToken! })).json).toMatchObject({ success: false, error: { code: "NOT_FOUND" } });
    const rotated = await partners.rotateInboundToken(biz, c.id);
    expect((await hit("GET", "/carriers/omniful/shipments/NOPE/tracking", { token: tok.json.data.access_token })).status).toBe(401);
    expect((await hit("GET", "/carriers/omniful/shipments/NOPE/tracking", { token: c.inboundToken! })).status).toBe(401);
    expect((await hit("GET", "/carriers/omniful/shipments/NOPE/tracking", { token: rotated.inboundToken })).status).toBe(404);
    // A paused connection refuses.
    await partners.updateConnection(biz, c.id, { status: "disabled" });
    expect((await hit("POST", "/carriers/omniful/shipments", { token: rotated.inboundToken, body: omnifulShipment({ system_id: "x2" }) })).status).toBe(401);
  });

  it("creates shipments idempotently by system_id and refuses what JR cannot deliver (as the contract asks)", async () => {
    const { biz } = await setup();
    const c = await partners.createConnection(biz, { provider: "omniful", name: "Omniful" });
    const t = c.inboundToken!;
    const a = await hit("POST", "/carriers/omniful/shipments", { token: t, body: omnifulShipment() });
    expect(a).toMatchObject({ status: 200, json: { success: true, data: { awb_number: expect.stringMatching(/^JR\d{11}$/), partner_system_id: expect.any(String), awb_label: expect.stringMatching(/\/label\.pdf$/), tracking_url: expect.stringContaining("/track/") } } });
    const again = await hit("POST", "/carriers/omniful/shipments", { token: t, body: omnifulShipment() });
    expect(again.json.data.awb_number).toBe(a.json.data.awb_number);
    expect(await db.select().from(partnerOrders)).toHaveLength(1);
    const [o] = await db.select().from(partnerOrders);
    expect(o).toMatchObject({ provider: "omniful", invoice: "B2C-4342026000421", externalId: "6a477731c034d123fee4b20d", awb: a.json.data.awb_number, recipientName: "Fahad Ali", recipientPhone: "+966509876543", city: "riyadh", codCents: 24575, pieces: 1, weightGrams: 1500, detailsComplete: true, state: "open" });
    expect(o.address).toContain("Flat 21, Palm Residency");
    expect(o.notes).toContain("National address RDAA7788");
    expect(o.extra).toMatchObject({ orderId: "B2C-4342026000421", reference: "SO-2026-000421", customFields: [{ key: "service_type", value: "same_day" }] });
    for (const [body, msg] of [
      [omnifulShipment({ system_id: "u1", payment_details: { is_cod: false, currency: "USD", cod_amount: 0, total_paid: 10, total_order_value: 10 } }), /SAR/],
      [omnifulShipment({ system_id: "u2", drop_details: { ...omnifulShipment().drop_details, country_code: "US", system_city: "Staten Island" } }), /Saudi Arabia/],
      [omnifulShipment({ system_id: "u3", drop_details: { ...omnifulShipment().drop_details, system_city: "", external_city: "Hail" } }), /does not deliver to "Hail"/],
      [{ ...omnifulShipment({ system_id: "u4" }), order_id: undefined }, /order_id/],
    ] as const) {
      const r = await hit("POST", "/carriers/omniful/shipments", { token: t, body });
      expect(r.status).toBe(400);
      expect(r.json).toMatchObject({ success: false, error: { code: "VALIDATION_ERROR" } });
      expect(r.json.error.message).toMatch(msg);
    }
    // The documented fallback: an empty system_city uses external_city.
    expect((await hit("POST", "/carriers/omniful/shipments", { token: t, body: omnifulShipment({ system_id: "u5", drop_details: { ...omnifulShipment().drop_details, system_city: "", external_city: "Jeddah" } }) })).status).toBe(200);
    await partners.updateConnection(biz, c.id, { config: { acceptCod: false } });
    expect((await hit("POST", "/carriers/omniful/shipments", { token: t, body: omnifulShipment({ system_id: "u6" }) })).json.error.message).toMatch(/cash-on-delivery/);
    expect((await hit("POST", "/carriers/omniful/shipments/returns", { token: t, body: {} })).json).toMatchObject({ success: false, error: { code: "VALIDATION_ERROR" } });
  });

  it("full journey: Omniful → JR order → driver delivers → Omniful hears dispatched, out_for_delivery, delivered in order; tracking and label agree", async () => {
    const { biz } = await setup();
    const c = await partners.createConnection(biz, { provider: "omniful", name: "Omniful" });
    const t = c.inboundToken!;
    expect(await hit("POST", "/carriers/omniful/webhooks/register", { token: t, body: { webhook_url: `${fake}/omniful/hook/acc-1` } })).toMatchObject({ status: 200, json: { success: true, data: { is_success: true } } });
    const awbs: string[] = [];
    for (const i of [1, 2]) awbs.push((await hit("POST", "/carriers/omniful/shipments", { token: t, body: omnifulShipment({ system_id: `sys-${i}`, order_id: `B2C-${i}`, drop_details: { ...omnifulShipment().drop_details, phone: `+96650987654${i}` } }) })).json.data.awb_number);
    expect((await hit("GET", `/carriers/omniful/shipments/${awbs[0]}/tracking`, { token: t })).json.data).toMatchObject({ status: "pending", number_of_attempts: 0 });
    const list = await partners.listOrders(biz, { state: "open" });
    expect(list.total).toBe(2);
    expect(list.items[0]).toMatchObject({ mode: "carrier", displayRef: expect.stringMatching(/^B2C-/), state: "open" });
    const { offer, driver, request } = await dispatchOrders(biz, list.items.map((x) => x.id));
    expect((await partners.listOrders(biz, { state: "in_jr" })).total).toBe(2);
    // The parcels carry JR's AWB (what is printed on JR's label), so the driver can scan it.
    const parcels = await db.select().from(shipments).where(eq(shipments.requestId, request.id));
    expect(parcels.map((p) => p.externalRef).sort()).toEqual([...awbs].sort());
    await jobs.acceptOffer(driver!, offer!.id, true); await jobs.confirmAttendance(biz, offer!.id, true);
    await work(biz, driver!, offer!.id, 1); // first stop delivered, second refused → returned to the warehouse
    respond = () => ({ status: 200, body: { success: true } });
    await partners.processPartnerOutbox();
    const posts = calls.filter((x) => x.path === "/omniful/hook/acc-1");
    const byAwb = (awb: string) => posts.filter((p) => p.body.awb_number === awb).map((p) => p.body.status);
    const delivered = parcels.find((p) => p.status === "pending")!; void delivered;
    const finalParcels = await db.select().from(shipments).where(eq(shipments.requestId, request.id));
    const okAwb = finalParcels.find((p) => p.status === "delivered")!.externalRef!, badAwb = finalParcels.find((p) => p.status === "returned")!.externalRef!;
    expect(byAwb(okAwb)).toEqual(["dispatched", "out_for_delivery", "delivered"]);
    expect(byAwb(badAwb)).toEqual(["dispatched", "out_for_delivery", "unable_to_deliver", "return_to_origin"]);
    const fail = posts.find((p) => p.body.awb_number === badAwb && p.body.status === "unable_to_deliver")!;
    expect(fail.body).toMatchObject({ number_of_attempts: 1, reason: expect.stringContaining("refused"), status_updated_at: expect.stringMatching(/Z$/) });
    expect(posts.every((p) => !p.headers.authorization)).toBe(true); // documented: no auth on Omniful's webhook
    // Polling agrees with what was pushed.
    expect((await hit("GET", `/carriers/omniful/shipments/${okAwb}/tracking`, { token: t })).json.data).toMatchObject({ status: "delivered", number_of_attempts: 1, first_delivery_attempt_at: expect.any(String) });
    expect((await hit("GET", `/carriers/omniful/shipments/${badAwb}/tracking`, { token: t })).json.data).toMatchObject({ status: "return_to_origin" });
    const label = await hit("GET", `/carriers/omniful/shipments/${okAwb}/label`, { token: t });
    const url = new URL(label.json.data.awb_label);
    const pdf = await dispatch(new Request(`http://localhost${url.pathname}`));
    expect(pdf.status).toBe(200);
    expect(pdf.headers.get("content-type")).toBe("application/pdf");
    expect((await pdf.text()).startsWith("%PDF-1.4")).toBe(true);
    expect((await dispatch(new Request(`http://localhost${url.pathname.replace(/\/[^/]+\/label\.pdf$/, "/forged-signature-xx/label.pdf")}`))).status).toBe(404);
    // Public tracking accepts JR's AWB with the last 4 digits of the recipient's phone.
    const ok = finalParcels.find((p) => p.status === "delivered")!;
    expect(await stops.trackShipment(okAwb, ok.recipientPhone.slice(-4), "9.9.9.9")).toMatchObject({ stage: "delivered" });
    // The order's own page shows the whole conversation.
    const detail = await partners.getOrder(biz, list.items.find((x) => x.awb === okAwb)!.id);
    expect(detail.state).toBe("delivered");
    expect(detail.updates.map((u) => [u.action, u.status])).toEqual([["picked_up", "sent"], ["out_for_delivery", "sent"], ["delivered", "sent"]]);
  });

  it("cancellation: an open order or a parcel waiting at the warehouse is cancelled; one with a driver is refused; twice → ALREADY_CANCELLED", async () => {
    const { biz } = await setup();
    const c = await partners.createConnection(biz, { provider: "omniful", name: "Omniful" });
    const t = c.inboundToken!;
    const mk = async (i: number) => (await hit("POST", "/carriers/omniful/shipments", { token: t, body: omnifulShipment({ system_id: `c-${i}`, order_id: `O-${i}`, drop_details: { ...omnifulShipment().drop_details, phone: `+96650987650${i}` } }) })).json.data.awb_number as string;
    const open = await mk(1), waiting = await mk(2), withDriver = await mk(3);
    expect(await hit("POST", "/carriers/omniful/shipments/cancel", { token: t, body: { awb_number: open, reason: "Customer requested cancellation" } })).toMatchObject({ status: 200, json: { success: true, data: { message: "Shipment cancelled" } } });
    expect(await hit("POST", "/carriers/omniful/shipments/cancel", { token: t, body: { awb_number: open, reason: "again" } })).toMatchObject({ status: 400, json: { error: { code: "ALREADY_CANCELLED" } } });
    const ids = (await db.select().from(partnerOrders).where(eq(partnerOrders.state, "open"))).filter((o) => [waiting, withDriver].includes(o.awb!)).map((o) => o.id);
    const { offer, driver } = await dispatchOrders(biz, ids);
    await jobs.acceptOffer(driver!, offer!.id, true); await jobs.confirmAttendance(biz, offer!.id, true);
    const p2 = (await db.select().from(shipments).where(eq(shipments.externalRef, withDriver)))[0];
    await jobs.recordLoading(biz, offer!.id, undefined, { codes: [p2.code] }); // only the third order is handed over
    const w = await hit("POST", "/carriers/omniful/shipments/cancel", { token: t, body: { awb_number: waiting, reason: "changed mind" } });
    expect(w.json).toMatchObject({ success: true, data: { message: expect.stringMatching(/removed from the JR delivery run/) } });
    expect((await db.select().from(shipments).where(eq(shipments.externalRef, waiting)))[0].status).toBe("cancelled");
    const d = await hit("POST", "/carriers/omniful/shipments/cancel", { token: t, body: { awb_number: withDriver, reason: "too late" } });
    expect(d).toMatchObject({ status: 400, json: { success: false, error: { code: "VALIDATION_ERROR", message: expect.stringMatching(/with a JR driver/) } } });
    expect((await db.select().from(partnerOrders).where(eq(partnerOrders.awb, withDriver)))[0].state).toBe("open"); // strict: nothing changed
    expect(await db.select().from(notifications).where(eq(notifications.type, "partner_cancel_conflict"))).toHaveLength(1);
    // JR never echoes Omniful's own cancellation back.
    expect(await db.select().from(partnerOutbox).where(eq(partnerOutbox.action, "cancelled"))).toHaveLength(0);
  });
});

// ─────────────────────────── Fastcoo: JR is the 3PL partner ───────────────────────────
const fastcooOrder = (o: Record<string, unknown> = {}) => ({
  app_id: "APP-1", merchent_id: "5f8m", reference_id: "78647", BookingMode: "COD", codValue: "117.00", awb_no: "FSL2500001",
  sender_city: "Riyadh", sender_name: "fastcoo test", sender_address: "Olaya", sender_phone: "0500000000", sender_email: "s@test", sender_zip: "54000",
  receiver_city: "Riyadh", receiver_name: "Noura", receiver_address: "Al Malqa, 7th st", receiver_phone: "0555000111", receiver_email: "n@test",
  country_dial_code: "+966", description: "Perfume", pieces: "2", weight: "1.2", sku_details: "VD0001", national_address_id: "RRRR1234", ...o,
});
async function fastcooConn(biz: User, extra: Record<string, unknown> = {}) {
  return partners.createConnection(biz, { provider: "fastcoo", name: "Fastcoo", config: { appId: "APP-1", clientId: "10001", baseUrl: fake, ...extra }, secrets: { clientSecret: "sec", refreshToken: "rt-1" } });
}
const fastcooOk = (c: Call) => c.path === "/oauth/token" ? { status: 200, body: { access_token: `at-${calls.filter((x) => x.path === "/oauth/token").length}`, expires_in: 3600, token_type: "Bearer", scope: null, refresh_token: `rt-${calls.filter((x) => x.path === "/oauth/token").length + 1}` } } : { status: 200, body: { status: 200, message: "OK" } };

describe("Fastcoo partner", () => {
  it("receives orders on the URL with the token, answers with JR's AWB, reports 3PL details; refuses unserved cities and other App IDs", async () => {
    const { biz } = await setup();
    const c = await fastcooConn(biz);
    expect(c.webhookUrl).toMatch(new RegExp(`/integrations/hooks/${c.id}/jrh_`)); // shown once, with the token in the path
    respond = fastcooOk;
    const path = new URL(c.webhookUrl!).pathname.replace("/api/v1", "");
    const r = await hit("POST", path, { body: fastcooOrder() });
    expect(r).toMatchObject({ status: 200, json: { accepted: true, orders: [{ reference: "FSL2500001", awb: expect.stringMatching(/^JR\d{11}$/), status: "created" }] } });
    // The documented path suffix works too, and a replay does not duplicate the order.
    expect((await hit("POST", `${path}/webhook/API/OrderRecieveLM`, { body: fastcooOrder() })).json.orders[0].status).toBe("updated");
    const [o] = await db.select().from(partnerOrders);
    expect(o).toMatchObject({ externalRef: "FSL2500001", invoice: "78647", codCents: 11700, pieces: 2, weightGrams: 1200, recipientPhone: "+966555000111", city: "riyadh", detailsComplete: true });
    await partners.processPartnerOutbox();
    const tokenCall = calls.find((x) => x.path === "/oauth/token")!;
    expect(new URLSearchParams(tokenCall.raw)).toEqual(new URLSearchParams({ grant_type: "refresh_token", refresh_token: "rt-1", client_id: "10001", client_secret: "sec" }));
    expect(tokenCall.headers["content-type"]).toBe("application/x-www-form-urlencoded");
    const det = calls.find((x) => x.path === "/Update3plDetails")!;
    expect(det.headers.authorization).toBe("Bearer at-1");
    expect(det.body).toMatchObject({ App_ID: "APP-1", ref_no: "FSL2500001", client_awb: o.awb, order_type: "LM", label: expect.stringMatching(/label\.pdf$/), tracking_url: expect.stringContaining(`/track/${o.awb}`) });
    // The rotated refresh token was stored (encrypted) for next time.
    const [row] = await db.select().from(partnerConnections).where(eq(partnerConnections.id, c.id));
    expect((await import("@/server/partners/crypto")).decryptSecrets(row.secretsEnc)).toMatchObject({ accessToken: "at-1", refreshToken: "rt-2" });
    // Unserved city → refused (Fastcoo sees a failed webhook); another merchant account's App ID → not ours, ignored.
    expect((await hit("POST", path, { body: fastcooOrder({ awb_no: "FSL2", receiver_city: "Hail" }) })).status).toBe(422);
    expect((await hit("POST", path, { body: fastcooOrder({ awb_no: "FSL3", app_id: "OTHER" }) })).status).toBe(422); // not ours: refused loudly, never "accepted"
    expect((await hit("POST", path.replace(/jrh_[^/]+$/, "jrh_wrongtoken"), { body: fastcooOrder({ awb_no: "FSL4" }) })).status).toBe(401);
    expect(await db.select().from(partnerOrders)).toHaveLength(1);
  });

  it("reports JR's progress with Fastcoo's status codes, in order, refreshing an expired access token once", async () => {
    const { biz } = await setup();
    const c = await fastcooConn(biz, {});
    await partners.updateConnection(biz, c.id, { secrets: { accessToken: "stale" } });
    const path = new URL(c.webhookUrl!).pathname.replace("/api/v1", "");
    respond = (call) => call.headers.authorization === "Bearer stale" ? { status: 401, body: { status: 401, message: "Unauthorized" } } : fastcooOk(call);
    await hit("POST", path, { body: fastcooOrder() });
    const [o] = await db.select().from(partnerOrders);
    const { offer, driver } = await dispatchOrders(biz, [o.id]);
    await jobs.acceptOffer(driver!, offer!.id, true); await jobs.confirmAttendance(biz, offer!.id, true);
    await work(biz, driver!, offer!.id, 1);
    await partners.processPartnerOutbox();
    expect(calls.filter((x) => x.path === "/oauth/token")).toHaveLength(1); // one 401 → one refresh → everything after uses it
    const statuses = calls.filter((x) => x.path === "/webhook/API/StatusUpdate").map((x) => x.body);
    expect(statuses.map((s) => s.StatusCode)).toEqual(["PUC", "OD", "POD"]);
    expect(statuses[2]).toMatchObject({ reference_number: o.awb, UniqueReference: "FSL2500001", StatusDescription: "Delivered", App_ID: "APP-1", order_type: "LM", FailDeliveryReason: "", UpdateDate: expect.stringMatching(/^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d$/) });
    // A partner refusal inside a 200 answer is a failure, not a success.
    respond = () => ({ status: 200, body: { status: 400, message: "Invalid StatusCode" } });
    await partners.updateConnection(biz, c.id, { settings: { sync: { arrived: true }, statusOut: { arrived: "XX" } } });
    const [p] = await db.select().from(shipments).where(eq(shipments.offerId, offer!.id));
    await db.insert(partnerOutbox).values({ connectionId: c.id, businessId: biz.id, shipmentId: p.id, requestId: p.requestId, partnerOrderId: o.id, action: "arrived", dedupeKey: "arrived:manual", payload: { at: new Date().toISOString() } });
    await partners.processPartnerOutbox();
    expect((await db.select().from(partnerOutbox).where(eq(partnerOutbox.dedupeKey, "arrived:manual")))[0]).toMatchObject({ status: "dead", lastError: expect.stringMatching(/Invalid StatusCode/) });
  });

  it("a CCR status from Fastcoo withdraws the parcel while it waits at the warehouse", async () => {
    const { biz } = await setup();
    const c = await fastcooConn(biz);
    respond = fastcooOk;
    const path = new URL(c.webhookUrl!).pathname.replace("/api/v1", "");
    await hit("POST", path, { body: fastcooOrder() });
    const [o] = await db.select().from(partnerOrders);
    await dispatchOrders(biz, [o.id]);
    const r = await hit("POST", path, { body: { awb_no: "FSL2500001", code: "CCR", status: "Cancelled as per Client request" } });
    expect(r.json).toMatchObject({ accepted: true, matched: 1 });
    expect((await db.select().from(shipments))[0].status).toBe("cancelled");
    expect((await db.select().from(partnerOrders))[0]).toMatchObject({ state: "cancelled", cancelledBy: "partner" });
  });
});

// ─────────────────────────── Shipox: merchant API ───────────────────────────
describe("Shipox", () => {
  const orderItem = (n: number, status = "unassigned") => ({
    id: 9000 + n, order_number: `SX${n}`, reference_id: `REF${n}`, status, last_status_date: "2026-11-18T10:00:00.000Z", piece_count: 1, currency: { code: "SAR" },
    locations: [{ pickup: true, contact_name: "WH", phone: "0500000000", address: "WH", city: "Riyadh" }, { pickup: false, contact_name: `Client ${n}`, phone: `96655500011${n}`, address: `${n} Tahlia St`, address_city: "Riyadh", lat: 24.7, lon: 46.7 }],
    charge_items: [{ charge_type: "cod", charge: 50 }],
  });
  const shipoxApi = (call: Call) => {
    if (call.path === "/api/v1/customer/authenticate") return { status: 200, body: { data: { id_token: `jwt-${calls.filter((x) => x.path.endsWith("authenticate")).length}` }, status: "success" } };
    if (call.headers.authorization === "Bearer jwt-1" && calls.some((x) => x.path === "/expire")) return { status: 401, body: { message: "Access Denied" } };
    if (call.path === "/api/v1/customer/account") return { status: 200, body: { data: { name: "Test customer" }, status: "success" } };
    if (call.path === "/api/v1/customer/orders") return { status: 200, body: { data: { total: 2, list: call.query.get("search") ? [orderItem(1)].filter((x) => x.order_number === call.query.get("search")) : [orderItem(1), orderItem(2)] }, status: "success" } };
    if (/\/order\/\d+\/mobile$/.test(call.path)) return { status: 200, body: { data: { recipient_data: { name: "Client 1", phone: "966555000111", city: { name: "Riyadh" }, address: "1 Tahlia St" } }, status: "success" } };
    if (/\/history_items$/.test(call.path)) return { status: 200, body: { data: { total: 2, list: [{ status: "assigned_to_courier", status_desc: "Assigned to courier", date: "2026-11-18T12:00:00.000Z" }, { status: "unassigned", status_desc: "Order Received", date: "2026-11-18T10:00:00.000Z" }] }, status: "success" } };
    if (call.path.endsWith("/airwaybill_mini")) return { status: 200, body: { Data: { Value: "https://s3.example.com/awb.pdf" }, status: "success" } };
    if (call.method === "PUT") return { status: 200, body: { status: "success" } };
    return { status: 404, body: {} };
  };
  it("signs in once, imports by schedule, follows status (webhook URL token + history), cancels by numeric id, prints labels", async () => {
    const { biz } = await setup();
    const c = await partners.createConnection(biz, { provider: "shipox", name: "Shipox", config: { baseUrl: fake, username: "api@co.test", importStatuses: "unassigned" }, secrets: { password: "pw" }, settings: { importNew: true, pollMinutes: 15 } });
    respond = shipoxApi;
    expect(await partners.testConnection(biz, c.id)).toMatchObject({ ok: true, message: "Connected to Shipox as Test customer" });
    expect(calls[0].body).toEqual({ username: "api@co.test", password: "pw", remember_me: true });
    const res = await partners.pollPartners(new Date());
    expect(res.results[0]).toMatchObject({ imported: 2 });
    const list = calls.find((x) => x.path === "/api/v1/customer/orders" && !x.query.get("search"))!;
    expect(list.query.get("status")).toBe("unassigned");
    expect(list.query.get("from_date_time")).toMatch(/Z$/);
    expect(list.headers.authorization).toMatch(/^Bearer jwt-/);
    const orders = await db.select().from(partnerOrders);
    expect(orders.find((o) => o.externalRef === "SX1")).toMatchObject({ externalId: "9001", invoice: "REF1", recipientName: "Client 1", recipientPhone: "+966555000111", codCents: 5000, city: "riyadh" });
    // A second poll right away is skipped (15-minute interval), a forced one is not.
    expect((await partners.pollPartners(new Date())).connections).toBe(0);
    // Webhook: Shipox sends no auth header — the token travels in the URL.
    expect(c.webhookUrl).toContain(`/hooks/${c.id}/jrh_`);
    const path = new URL(c.webhookUrl!).pathname.replace("/api/v1", "");
    expect((await hit("POST", `/integrations/hooks/${c.id}`, { body: { order_number: "SX1", status: "accepted", date: "2026-11-18T11:00:00.000Z" } })).status).toBe(401);
    // The poll above also reconciled from the history (newest entry wins: assigned_to_courier at 12:00).
    const statusOf = async () => (await db.select().from(partnerOrders).where(eq(partnerOrders.externalRef, "SX1")))[0].partnerStatus;
    expect(await statusOf()).toBe("assigned_to_courier");
    // An older event arriving late never overwrites a newer status; a newer one does.
    expect((await hit("POST", path, { body: { order_number: "SX1", status: "accepted", date: "2026-11-18T11:00:00.000Z", driver: { name: "D", phone: "+971" } } })).status).toBe(200);
    expect(await statusOf()).toBe("assigned_to_courier");
    expect((await hit("POST", path, { body: { order_number: "SX1", status: "accepted", date: "2026-11-18T13:00:00.000Z" } })).status).toBe(200);
    expect(await statusOf()).toBe("accepted");
    await partners.pollNow(biz, c.id); // history's newest (12:00) is older than 13:00 → unchanged
    expect(await statusOf()).toBe("accepted");
    // Cancel from JR (opt-in) uses Shipox's numeric order id.
    await partners.updateConnection(biz, c.id, { settings: { sync: { cancelled: true } } });
    const { request } = await dispatchOrders(biz, [orders.find((o) => o.externalRef === "SX1")!.id]);
    const [p] = await db.select().from(shipments).where(eq(shipments.requestId, request.id));
    await stops.cancelShipment(biz, p.id, "customer called");
    await partners.processPartnerOutbox();
    const put = calls.find((x) => x.method === "PUT")!;
    expect(put.path).toBe("/api/v1/customer/order/9001/status");
    expect(put.query.get("status")).toBe("cancelled");
    // Labels: Shipox ids when JR knows them.
    expect(await partners.packageLabel(biz, c.id, ["SX1", "SX-UNKNOWN"])).toEqual({ url: "https://s3.example.com/awb.pdf" });
    const awb = calls.find((x) => x.path.endsWith("/airwaybill_mini"))!;
    expect(awb.query.getAll("ids")).toEqual(["9001"]); expect(awb.query.getAll("order_numbers")).toEqual(["SX-UNKNOWN"]);
    // An expired JWT is renewed once and the call retried.
    calls.push({ method: "X", path: "/expire", query: new URLSearchParams(), headers: {}, body: null, raw: "" });
    const before = calls.filter((x) => x.path.endsWith("authenticate")).length;
    expect((await partners.lookupPackages(biz, c.id, ["SX1"])).results[0]).toMatchObject({ found: true, externalId: "9001", recipientName: "Client 1" });
    expect(calls.filter((x) => x.path.endsWith("authenticate")).length).toBe(before + 1);
  });
});

// ─────────────────────────── Fizzpa: merchant API ───────────────────────────
describe("Fizzpa", () => {
  it("sends the raw key and Referer, imports by OrderId, polls the order's status, cancels with DELETE", async () => {
    const { biz } = await setup();
    let delivered = false;
    respond = (call) => {
      if (call.path === "/Auth/me") return call.headers.authorization === "fz-key" ? { status: 200, body: { success: true, userData: { FullName: "Agent", CompanyName_En: "Alnour for shipping" } } } : { status: 200, body: { success: false, message: "bad key" } };
      if (call.path === "/orders/15202016" && call.method === "GET") return { status: 200, body: { OrderId: 15202016, OrderRef: "I-001", RecipientName: "Salem", Phonecode1: 966, Phone1: "555123456", RecipientCityName_En: "Riyadh", RecipientAddress: "Olaya", CollectionTypeId: 1, PieceCount: 2, OrderStatus_En: delivered ? "Delivered" : "New", IsDelivered: delivered } };
      if (call.path === "/Tracking/15202016") return { status: 200, body: [{ Trackid: 2, OrderId: 15202016, TrackingStatus: 2, WhereIN: "At Shop", Note: "Shipping company confirm shipping order", TrackingDate: "2026-11-18T09:00:00" }, { Trackid: 1, TrackingStatus: 1, Note: "Record Created", TrackingDate: "2026-11-18T08:00:00" }] };
      if (call.method === "DELETE") return { status: 200, body: { success: true, Message: "Deleted successfully" } };
      return { status: 404, body: {} };
    };
    const c = await partners.createConnection(biz, { provider: "fizzpa", name: "Fizzpa", config: { baseUrl: fake, referer: "https://store.example.com" }, secrets: { apiKey: "fz-key" }, settings: { sync: { cancelled: true } } });
    expect(c.capabilities).toMatchObject({ webhookIn: false, label: false, track: true });
    expect(c.webhookUrl).toBeNull();
    expect(await partners.testConnection(biz, c.id)).toMatchObject({ ok: true, message: expect.stringContaining("Alnour for shipping") });
    expect(calls[0].headers).toMatchObject({ authorization: "fz-key", referer: "https://store.example.com" });
    await partners.updateConnection(biz, c.id, { secrets: { apiKey: "wrong" } });
    expect(await partners.testConnection(biz, c.id)).toMatchObject({ ok: false, kind: "auth" });
    await partners.updateConnection(biz, c.id, { secrets: { apiKey: "fz-key" } });
    // Only numeric OrderIds can be found (Fizzpa does not search by OrderRef).
    const look = await partners.lookupPackages(biz, c.id, ["15202016", "I-001"]);
    expect(look.results.find((r: any) => r.identifier === "15202016")).toMatchObject({ found: true, invoice: "I-001", recipientPhone: "+966555123456", codAmount: 0 });
    expect(look.results.find((r: any) => r.identifier === "I-001")).toMatchObject({ found: false });
    const [o] = await db.select().from(partnerOrders);
    const { request } = await dispatchOrders(biz, [o.id]);
    // Polling (the only way to hear from Fizzpa) picks up the change.
    delivered = true;
    await partners.pollNow(biz, c.id);
    expect((await db.select().from(partnerOrders))[0].partnerStatus).toBe("Delivered");
    expect((await db.select().from(shipments))[0].partnerStatus).toBe("Delivered");
    const [p] = await db.select().from(shipments).where(eq(shipments.requestId, request.id));
    await stops.cancelShipment(biz, p.id, "x");
    await partners.processPartnerOutbox();
    expect(calls.find((x) => x.method === "DELETE")!.path).toBe("/orders/15202016");
  });
});

// ─────────────────────────── LogesTech v2 ───────────────────────────
describe("LogesTech", () => {
  it("stores the status catalogue on test, imports a new package from its webhook (enriched by lookup), reconciles from history", async () => {
    const { biz } = await setup();
    respond = (call) => {
      if (call.path.endsWith("/address/cities")) return { status: 200, body: [{ id: 1 }] };
      if (call.path.endsWith("/packages/statuses")) return { status: 200, body: [{ key: "PENDING_CUSTOMER_CARE_APPROVAL", englishValue: "Pending approval", arabicValue: "بانتظار الموافقة" }, { key: "CANCELLED", englishValue: "Cancelled", arabicValue: "ملغاة" }] };
      if (call.path.endsWith("/packages/status")) return { status: 200, body: { barcode: "PS1", receiverName: "Huda", receiverPhone: "0555222333", destinationCity: "Riyadh", destinationAddressLine1: "Malqa" } };
      if (call.path.endsWith("/status/history")) return { status: 200, body: [{ packageId: 77, createdDate: "2026-11-18T08:00:00Z", statusKey: "PENDING_CUSTOMER_CARE_APPROVAL" }, { packageId: 77, createdDate: "2026-11-18T09:00:00Z", statusKey: "ASSIGNED_TO_DRIVER" }] };
      return { status: 404, body: {} };
    };
    const c = await partners.createConnection(biz, { provider: "logestechs", name: "LT", config: { baseUrl: `${fake}/api` }, secrets: { apiKey: "psk_integration_x" }, settings: { importNew: true } });
    expect((await partners.testConnection(biz, c.id)).message).toMatch(/2 package statuses/);
    const view = await partners.getConnection(biz, c.id);
    expect(view.statusInOptions).toEqual(expect.arrayContaining([expect.objectContaining({ value: "CANCELLED", labelAr: "ملغاة", kind: "cancelled" })]));
    await partners.receiveWebhook(c.id, new Headers({ "x-api-key": c.inboundToken! }), { packageId: 77, barcode: "PS1", newStatus: "PENDING_CUSTOMER_CARE_APPROVAL", cod: 30, time: "2026-11-18T08:00:00Z" }, "1.1.1.1");
    const [o] = await db.select().from(partnerOrders);
    expect(o).toMatchObject({ externalRef: "PS1", externalId: "77", recipientName: "Huda", recipientPhone: "+966555222333", city: "riyadh", codCents: 3000, partnerStatus: "PENDING_CUSTOMER_CARE_APPROVAL", detailsComplete: true });
    await partners.pollNow(biz, c.id);
    const hist = calls.find((x) => x.path.endsWith("/status/history"))!;
    expect(hist.query.get("id")).toBe("77"); // the documented identifier when JR knows it
    expect((await db.select().from(partnerOrders))[0].partnerStatus).toBe("ASSIGNED_TO_DRIVER");
    // Without importNew, an unknown package is only logged.
    await partners.updateConnection(biz, c.id, { settings: { importNew: false } });
    await partners.receiveWebhook(c.id, new Headers({ "x-api-key": c.inboundToken! }), { packageId: 78, barcode: "PS2", newStatus: "X" }, "1.1.1.1");
    expect(await db.select().from(partnerOrders)).toHaveLength(1);
  });
});

// ─────────────────────────── Incoming orders + management ───────────────────────────
describe("Incoming orders", () => {
  it("manifest → JR order links orders; a JR-side cancel sends the order back to open; dismiss / restore; other companies see nothing", async () => {
    const { biz } = await setup(); const other = await mkBusiness();
    const c = await partners.createConnection(biz, { provider: "webhook", name: "WMS" });
    const send = (body: unknown) => partners.receiveWebhook(c.id, new Headers({ authorization: `Bearer ${c.inboundToken}` }), body, "1.1.1.1");
    await send({ items: [
      { type: "order", reference: "W-1", recipient: { name: "Ali", phone: "0555000001", address: "Olaya 1", city: "Riyadh" }, cod: 10 },
      { type: "order", reference: "W-2", recipient: { name: "Omar", phone: "0555000002", address: "Olaya 2", city: "الرياض" } },
      { type: "order", reference: "W-3", recipient: { name: "Sara", phone: "bad", address: "x", city: "Hail" } },
    ] });
    const all = await partners.listOrders(biz, {});
    expect(all.counts).toMatchObject({ open: 3 });
    // The company hears about new orders once per hour per connection, not once per order.
    const notes = await db.select().from(notifications).where(eq(notifications.type, "partner_orders_new"));
    expect(notes).toHaveLength(1);
    expect(notes[0]).toMatchObject({ userId: biz.id, data: { connectionId: c.id, connection: "WMS", n: 3 } }); // the count follows the batch
    await send({ type: "order", reference: "W-9", recipient: { name: "Late", phone: "0555000099", address: "Olaya 9", city: "Riyadh" } });
    const again = await db.select().from(notifications).where(eq(notifications.type, "partner_orders_new"));
    expect(again).toHaveLength(1);
    expect(again[0].data).toMatchObject({ n: 4 });
    await partners.dismissOrders(biz, [(await partners.listOrders(biz, { q: "W-9" })).items[0].id]);
    expect((await partners.listOrders(other, {})).total).toBe(0);
    await expect(partners.getOrder(other, all.items[0].id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    const m = await partners.ordersToManifest(biz, all.items.map((x) => x.id));
    expect(m.problems.find((p) => p.ref === "W-3")).toMatchObject({ issue: "no_city" });
    expect(m.deliveryCity).toBe("riyadh");
    const ids = all.items.filter((x) => x.externalRef !== "W-3").map((x) => x.id);
    const { request } = await dispatchOrders(biz, ids);
    expect((await partners.listOrders(biz, { state: "in_jr" })).total).toBe(2);
    await expect(partners.dismissOrders(biz, [ids[0]])).rejects.toMatchObject({ code: "CONFLICT" });
    const [p] = await db.select().from(shipments).where(and(eq(shipments.requestId, request.id), eq(shipments.externalRef, "W-1")));
    await stops.cancelShipment(biz, p.id, "not today");
    expect((await partners.listOrders(biz, { state: "open" })).items.map((x) => x.externalRef).sort()).toEqual(["W-1", "W-3"]);
    const w3 = all.items.find((x) => x.externalRef === "W-3")!.id;
    expect(await partners.dismissOrders(biz, [w3], "wrong city")).toEqual({ dismissed: 1 });
    expect((await partners.getOrder(biz, w3))).toMatchObject({ state: "cancelled", cancelledBy: "business", cancelReason: "wrong city" });
    expect(await partners.restoreOrders(biz, [w3])).toEqual({ restored: 1 });
    // The partner's own cancellation cannot be undone from JR.
    await send({ reference: "W-3", status: "cancelled" });
    await expect(partners.restoreOrders(biz, [w3])).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("a draft re-saved without an order frees it again (the link is derived, never stale)", async () => {
    const { biz } = await setup();
    const c = await partners.createConnection(biz, { provider: "webhook", name: "WMS" });
    await partners.receiveWebhook(c.id, new Headers({ authorization: `Bearer ${c.inboundToken}` }), { items: [1, 2].map((i) => ({ type: "order", reference: `D-${i}`, recipient: { name: `Name ${i}`, phone: `055500000${i}`, address: "Olaya St 1", city: "Riyadh" } })) }, "1.1.1.1");
    const ids = (await partners.listOrders(biz, {})).items.map((x) => x.id);
    const { request } = await dispatchOrders(biz, ids, { publish: false });
    expect((await partners.listOrders(biz, { state: "in_jr" })).total).toBe(2);
    const { updateDraft } = await import("@/server/requests");
    const keep = (await db.select().from(shipments).where(and(eq(shipments.requestId, request.id), eq(shipments.externalRef, "D-1"))))[0];
    await updateDraft(biz, request.id, reqInput({ shipmentsPerDriver: 30, shipments: [{ recipientType: "consumer", recipientName: keep.recipientName, recipientPhone: keep.recipientPhone, address: keep.address, externalRef: "D-1", partnerId: c.id }] }));
    expect((await partners.listOrders(biz, { state: "open" })).items.map((x) => x.externalRef)).toEqual(["D-2"]);
  });
});

describe("staff management (superadmin / integrations.manage)", () => {
  it("staff create and edit a company's connection (audited, secrets write-only); others are refused; the company sees the result", async () => {
    const { admin, biz } = await setup();
    const c = await partners.createConnection(admin, { provider: "logestechs", name: "Set up by JR", businessId: biz.id, config: { baseUrl: `${fake}/api` }, secrets: { apiKey: "psk_integration_admin" } });
    expect(JSON.stringify(c)).not.toContain("psk_integration_admin");
    expect((await partners.listConnections(biz)).map((x) => x.id)).toEqual([c.id]);
    await partners.updateConnection(admin, c.id, { settings: { sync: { cancelled: true }, statusIn: { CUSTOM_X: "cancelled" } } });
    expect((await partners.getConnection(biz, c.id)).settings).toMatchObject({ sync: { cancelled: true }, statusIn: { custom_x: "cancelled" } });
    const logs = await db.select().from(auditLogs).where(eq(auditLogs.entityId, c.id));
    expect(logs.map((l) => l.action).sort()).toEqual(["partner.create", "partner.update"]);
    expect(JSON.stringify(logs)).not.toContain("psk_integration_admin");
    await expect(partners.createConnection(admin, { provider: "logestechs", name: "x", secrets: { apiKey: "k" } })).rejects.toMatchObject({ code: "VALIDATION" }); // businessId required
    // Through the router: staff without the permission cannot change anything; with it they can.
    const viewer = await mkStaff(["integrations.view"]); const manager = await mkStaff(["integrations.manage", "integrations.view"]);
    const { createSession } = await import("@/server/auth/session");
    const call = async (u: User, method: string, path: string, body?: unknown) => {
      const s = await createSession(u.id);
      const res = await dispatch(new Request(`http://localhost/api/v1${path}`, { method, headers: { authorization: `Bearer ${s.token}`, "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined }));
      return { status: res.status, json: await res.json().catch(() => null) };
    };
    expect((await call(viewer, "GET", `/admin/integrations/connections/${c.id}`)).status).toBe(200);
    expect((await call(viewer, "PATCH", `/admin/integrations/connections/${c.id}`, { name: "renamed" })).status).toBe(403);
    expect((await call(manager, "PATCH", `/admin/integrations/connections/${c.id}`, { name: "renamed" })).json).toMatchObject({ name: "renamed" });
    expect((await call(biz, "GET", `/admin/integrations/connections/${c.id}`)).status).toBe(403);
    expect((await call(manager, "GET", `/admin/integrations/orders?businessId=${biz.id}`)).json).toMatchObject({ total: 0 });
  });

  it("validates mapping edits against what the system supports", async () => {
    const { biz } = await setup();
    const c = await partners.createConnection(biz, { provider: "omniful", name: "Omniful" });
    await expect(partners.updateConnection(biz, c.id, { settings: { sync: { accepted: true } } })).rejects.toMatchObject({ code: "VALIDATION" }); // Omniful answers synchronously, no "accepted" push
    await expect(partners.updateConnection(biz, c.id, { settings: { statusOut: { delivered: "bad code!" } } })).rejects.toMatchObject({ code: "VALIDATION" });
    await expect(partners.updateConnection(biz, c.id, { settings: { pollMinutes: 15 } })).rejects.toMatchObject({ code: "VALIDATION" });
    const u = await partners.updateConnection(biz, c.id, { settings: { statusOut: { picked_up: "in_transit", arrived: "" } } });
    expect(u.statusMap).toMatchObject({ picked_up: "in_transit", arrived: null, delivered: "delivered" });
    const back = await partners.updateConnection(biz, c.id, { settings: { statusOut: { picked_up: null } } });
    expect(back.statusMap.picked_up).toBe("dispatched");
  });
});

describe("outbox ordering", () => {
  it("a later update waits while an earlier one of the same parcel is retrying, then follows it", async () => {
    const { biz } = await setup();
    const c = await partners.createConnection(biz, { provider: "webhook", name: "WMS", config: { callbackUrl: `${fake}/cb` } });
    await partners.receiveWebhook(c.id, new Headers({ authorization: `Bearer ${c.inboundToken}` }), { type: "order", reference: "Q-1", recipient: { name: "Nour", phone: "0555000009", address: "Olaya St 9", city: "Riyadh" } }, "1.1.1.1");
    const [o] = await db.select().from(partnerOrders);
    const { offer, driver } = await dispatchOrders(biz, [o.id]);
    await jobs.acceptOffer(driver!, offer!.id, true); await jobs.confirmAttendance(biz, offer!.id, true);
    let down = true;
    respond = (call) => (down && call.body?.event === "parcel.picked_up" ? { status: 503 } : { status: 200, body: {} });
    await work(biz, driver!, offer!.id, 1);
    await partners.processPartnerOutbox();
    expect(calls.filter((x) => x.path === "/cb").map((x) => x.body.event)).toEqual(["parcel.picked_up"]); // failed; nothing after it went out
    const q = await db.select().from(partnerOutbox).orderBy(partnerOutbox.seq);
    expect(q.map((x) => [x.action, x.status])).toEqual([["picked_up", "retry_wait"], ["out_for_delivery", "queued"], ["delivered", "queued"]]);
    down = false;
    await db.update(partnerOutbox).set({ nextAttemptAt: new Date(Date.now() - 1000) }).where(eq(partnerOutbox.action, "picked_up"));
    await partners.processPartnerOutbox();
    expect(calls.filter((x) => x.path === "/cb").map((x) => x.body.event)).toEqual(["parcel.picked_up", "parcel.picked_up", "parcel.out_for_delivery", "parcel.delivered"]);
  });
});

describe("volume", () => {
  it("300 incoming orders become one JR delivery order quickly, every one linked", async () => {
    const { biz } = await setup();
    const c = await partners.createConnection(biz, { provider: "webhook", name: "Bulk WMS" });
    for (let b = 0; b < 6; b++) {
      await partners.receiveWebhook(c.id, new Headers({ authorization: `Bearer ${c.inboundToken}` }), { items: Array.from({ length: 50 }, (_, i) => {
        const n = b * 50 + i;
        return { type: "order", reference: `BULK-${n}`, recipient: { name: `Customer ${n}`, phone: `05${String(30000000 + n)}`, address: `${n} Olaya St`, city: "Riyadh" }, cod: n % 3 ? 0 : 15 };
      }) }, "1.1.1.1");
    }
    const ids = (await partners.listOrders(biz, { state: "open", pageSize: 200 })).items.map((x) => x.id);
    const more = (await partners.listOrders(biz, { state: "open", pageSize: 200, page: 2 })).items.map((x) => x.id);
    expect(ids.length + more.length).toBe(300);
    const t0 = Date.now();
    const m = await partners.ordersToManifest(biz, [...ids, ...more]);
    expect(m.problems).toEqual([]);
    const d = await createDraft(biz, reqInput({ shipmentsPerDriver: 30, shipments: m.rows.map((r: any) => ({ recipientType: r.recipientType, recipientName: r.recipientName, recipientPhone: r.recipientPhone, address: r.address, city: r.city, externalRef: r.externalRef, partnerId: r.partnerId, codCents: r.codCents })) }));
    expect(Date.now() - t0).toBeLessThan(15_000);
    const counts = (await partners.listOrders(biz, {})).counts;
    expect(counts).toMatchObject({ open: 0, in_jr: 300 });
    const cached = await db.select().from(partnerOrders).where(eq(partnerOrders.requestId, d.id));
    expect(cached).toHaveLength(300);
  });
});

describe("retention", () => {
  it("prunes old partner traffic, keeps recent rows and failed updates until they are old", async () => {
    const { biz } = await setup();
    const c = await partners.createConnection(biz, { provider: "webhook", name: "WMS" });
    const old = new Date(Date.now() - 200 * 864e5), mid = new Date(Date.now() - 100 * 864e5);
    const { partnerEvents } = await import("@/db/schema");
    await db.insert(partnerEvents).values([{ connectionId: c.id, businessId: biz.id, direction: "in", kind: "x", createdAt: old }, { connectionId: c.id, businessId: biz.id, direction: "in", kind: "y" }]);
    await db.insert(partnerOutbox).values([
      { connectionId: c.id, businessId: biz.id, action: "delivered", dedupeKey: "a", payload: {}, status: "sent", createdAt: mid },
      { connectionId: c.id, businessId: biz.id, action: "delivered", dedupeKey: "b", payload: {}, status: "dead", createdAt: mid },
      { connectionId: c.id, businessId: biz.id, action: "delivered", dedupeKey: "c", payload: {}, status: "dead", createdAt: old },
    ]);
    expect(await partners.prunePartnerData()).toEqual({ events: 1, updates: 2 });
    expect((await db.select().from(partnerOutbox)).map((o) => o.dedupeKey)).toEqual(["b"]);
  });
});
