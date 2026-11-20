import { describe, it, expect, beforeEach, afterAll, beforeAll } from "vitest";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { jobEvents, offers, partnerConnections, partnerOrders, partnerOutbox, shipments, users, type User } from "@/db/schema";
import { resetDb, shutdown, mkAdmin, mkBusiness, mkDriver, mkRule, reqInput } from "../helpers/factories";
import * as jobs from "@/server/jobs";
import * as stops from "@/server/stops";
import { createDraft, publishRequest } from "@/server/requests";
import * as partners from "@/server/partners/service";
import { decryptSecrets, encryptSecrets } from "@/server/partners/crypto";
import { fastcooTime } from "@/server/partners/fastcoo";
import { _resetShipoxTokens } from "@/server/partners/shipox";
import { dispatch } from "@/server/api/router";
import "@/server/api/routes";
import { work } from "../helpers/work";

/** Regression tests for the independent server review (findings 1–15) — each pins one fix. */
beforeEach(resetDb);
afterAll(shutdown);

type Call = { method: string; path: string; query: URLSearchParams; headers: http.IncomingHttpHeaders; body: any; raw: string };
let server: http.Server, fake = "";
let calls: Call[] = [];
let respond: (c: Call) => { status: number; body?: unknown; raw?: string; type?: string } = () => ({ status: 200, body: {} });
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
      res.writeHead(r.status, { "content-type": r.type ?? "application/json" });
      res.end(r.raw ?? (r.body === undefined ? "" : JSON.stringify(r.body)));
    });
  });
  await new Promise<void>((ok) => server.listen(0, "127.0.0.1", ok));
  fake = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => new Promise<void>((ok) => server.close(() => ok())));
beforeEach(() => { calls = []; respond = () => ({ status: 200, body: {} }); _resetShipoxTokens(); });

async function setup() { const admin = await mkAdmin(); await mkRule(admin); const biz = await mkBusiness({ fundsCents: 10_000_00 }); return { admin, biz }; }
async function hit(method: string, path: string, o: { token?: string; body?: unknown } = {}) {
  const res = await dispatch(new Request(`http://localhost/api/v1${path}`, { method, headers: { "content-type": "application/json", ...(o.token ? { authorization: `Bearer ${o.token}` } : {}) }, body: o.body === undefined ? undefined : JSON.stringify(o.body) }));
  const text = await res.text(); let json: any = null; try { json = JSON.parse(text); } catch { json = text; }
  return { status: res.status, json };
}
async function dispatchOrders(biz: User, ids: string[], o: { publish?: boolean } = {}) {
  const m = await partners.ordersToManifest(biz, ids);
  const rows = m.rows.map((r: any) => ({ recipientType: r.recipientType, recipientName: r.recipientName, recipientPhone: r.recipientPhone, address: r.address, city: r.city, externalRef: r.externalRef, partnerId: r.partnerId, codCents: r.codCents }));
  await mkDriver();
  const d = await createDraft(biz, reqInput({ shipments: rows, shipmentsPerDriver: 30 }));
  if (o.publish === false) return { request: d, offer: null as any, driver: null as any };
  const r = await publishRequest(biz, d.id, { termsAccepted: true });
  const [off] = await db.select().from(offers).where(eq(offers.requestId, r.id));
  const [driver] = await db.select().from(users).where(eq(users.id, off.driverId));
  return { request: r, offer: off, driver };
}
const customOrders = (c: { id: string; inboundToken: string | null }, refs: string[]) => partners.receiveWebhook(c.id, new Headers({ authorization: `Bearer ${c.inboundToken}` }), { items: refs.map((ref, i) => ({ type: "order", reference: ref, recipient: { name: `Name ${ref}`, phone: `05550${String(10000 + i).slice(-5)}`, address: `${i} Olaya St`, city: "Riyadh" } })) }, "1.1.1.1");

describe("review #1 — large partner answers are refused, never truncated; the cursor only moves after a complete read", () => {
  it("imports a 150-order Shipox list (> 64 KB) completely; an unreadable answer is an error and keeps the cursor", async () => {
    const { biz } = await setup();
    const big = (n: number) => ({ id: 5000 + n, order_number: `BIG${n}`, status: "unassigned", note: "x".repeat(600), locations: [{ pickup: false, contact_name: `C ${n}`, phone: `9665550${String(10000 + n).slice(-5)}`, address: `${n} St`, address_city: "Riyadh" }], charge_items: [] });
    let broken = false;
    respond = (call) => {
      if (call.path.endsWith("/authenticate")) return { status: 200, body: { data: { id_token: "jwt" } } };
      if (call.path === "/api/v1/customer/orders") {
        if (broken) return { status: 200, raw: '{"data":{"list":[{"id":1', type: "application/json" };
        const page = Number(call.query.get("page"));
        const all = Array.from({ length: 150 }, (_, i) => big(i));
        return { status: 200, body: { data: { total: 150, list: all.slice(page * 100, page * 100 + 100) } } };
      }
      return { status: 404, body: {} };
    };
    const c = await partners.createConnection(biz, { provider: "shipox", name: "Shipox", config: { baseUrl: fake, username: "u" }, secrets: { password: "p" }, settings: { importNew: true, pollMinutes: 15 } });
    const r = await partners.pollNow(biz, c.id);
    expect(r).toMatchObject({ imported: 150 });
    const [row] = await db.select().from(partnerConnections).where(eq(partnerConnections.id, c.id));
    const cursor = (row.meta as any).lastOrderPollAt;
    expect(cursor).toBeTruthy();
    broken = true;
    const r2 = await partners.pollNow(biz, c.id);
    expect(r2).toMatchObject({ error: "unavailable" });
    expect(((await db.select().from(partnerConnections).where(eq(partnerConnections.id, c.id)))[0].meta as any).lastOrderPollAt).toBe(cursor);
  });
});

describe("review #2 — Omniful retries get the first AWB even if a setting changed in between", () => {
  it("returns the stored AWB for a repeated system_id before validating", async () => {
    const { biz } = await setup();
    const c = await partners.createConnection(biz, { provider: "omniful", name: "Omniful" });
    const body = { order_id: "O-1", system_id: "sys-1", drop_details: { name: "Ahmad Saleh", phone: "+966500000001", address_line_1: "Olaya", system_city: "Riyadh", country_code: "SA" }, payment_details: { is_cod: true, currency: "SAR", cod_amount: 10, total_paid: 0, total_order_value: 10 }, packages: [{ weight: { value: 1, uom: "kg" } }], weight: { value: 1, uom: "kg" }, number_of_boxes: 1 };
    const a = await hit("POST", "/carriers/omniful/shipments", { token: c.inboundToken!, body });
    await partners.updateConnection(biz, c.id, { config: { acceptCod: false } });
    const b = await hit("POST", "/carriers/omniful/shipments", { token: c.inboundToken!, body });
    expect(b).toMatchObject({ status: 200, json: { success: true, data: { awb_number: a.json.data.awb_number } } });
    expect((await hit("POST", "/carriers/omniful/shipments", { token: c.inboundToken!, body: { ...body, system_id: "sys-2" } })).status).toBe(400); // a NEW one is validated
  });
});

describe("review #3 — one refused order does not stop reconciliation, and every order gets its turn", () => {
  it("LogesTech 403 for one package is skipped; 60 open orders are all checked across two runs", async () => {
    const { biz } = await setup();
    respond = (call) => call.path.endsWith("/status/history") ? (call.query.get("barcode") === "P0" || call.query.get("id") === "1000" ? { status: 403, body: { message: "different customer" } } : { status: 200, body: [{ createdDate: "2026-11-18T10:00:00Z", statusKey: "SCANNED" }] }) : { status: 404, body: {} };
    const c = await partners.createConnection(biz, { provider: "logestechs", name: "LT", config: { baseUrl: `${fake}/api` }, secrets: { apiKey: "k" } });
    const [conn] = await db.select().from(partnerConnections).where(eq(partnerConnections.id, c.id));
    await db.insert(partnerOrders).values(Array.from({ length: 60 }, (_, i) => ({ connectionId: c.id, businessId: biz.id, provider: "logestechs", externalRef: `P${i}`, externalId: String(1000 + i), createdAt: new Date(Date.now() - (60 - i) * 1000) })));
    void conn;
    const r1 = await partners.pollNow(biz, c.id);
    expect(r1).toMatchObject({ tracked: 50, changed: 49 }); // 50 asked; the one LogesTech refuses (403) is "nothing to reconcile", not a key failure
    expect(r1).not.toHaveProperty("error");
    const r2 = await partners.pollNow(biz, c.id);
    expect(r2.tracked).toBeGreaterThanOrEqual(10); // the 10 never checked come first
    const unchecked = (await db.select().from(partnerOrders).where(eq(partnerOrders.connectionId, c.id))).filter((o) => !o.lastTrackedAt);
    expect(unchecked).toHaveLength(0);
    expect((await db.select().from(partnerConnections).where(eq(partnerConnections.id, c.id)))[0].lastError ?? "").not.toMatch(/credentials/);
  });
});

describe("review #4 — the same change reported twice counts once; an untimed report never overrides a timed one", () => {
  it("webhook + history of the same LogesTech change → one timeline entry; Fastcoo time comes from updated_date in the zone", async () => {
    const { biz } = await setup();
    respond = (call) => call.path.endsWith("/status/history") ? { status: 200, body: [{ packageId: 77, createdDate: "2026-11-18T10:00:00.400Z", statusKey: "OUT_FOR_DELIVERY" }] }
      : call.path.endsWith("/packages/status") ? { status: 200, body: { barcode: "PS1", receiverName: "Huda Salem", receiverPhone: "0555222333", destinationCity: "Riyadh", destinationAddressLine1: "Malqa 7" } } : { status: 404, body: {} };
    const c = await partners.createConnection(biz, { provider: "logestechs", name: "LT", config: { baseUrl: `${fake}/api` }, secrets: { apiKey: "k" }, settings: { importNew: true } });
    const H = new Headers({ "x-api-key": c.inboundToken! });
    await partners.receiveWebhook(c.id, H, { packageId: 77, barcode: "PS1", invoiceNumber: "INV1", newStatus: "READY", time: "2026-11-18T09:00:00Z" }, "1.1.1.1");
    const [o] = await db.select().from(partnerOrders);
    const { request } = await dispatchOrders(biz, [o.id], { publish: false });
    await partners.receiveWebhook(c.id, H, { packageId: 77, barcode: "PS1", invoiceNumber: "INV1", newStatus: "OUT_FOR_DELIVERY", time: "2026-11-18T10:00:00Z" }, "1.1.1.1");
    await partners.refreshOrder(biz, o.id); // the history call reports the same change (different fields, 0.4 s later)
    expect(await db.select().from(jobEvents).where(and(eq(jobEvents.type, "partner_status"), eq(jobEvents.requestId, request.id)))).toHaveLength(1);
    // Untimed (custom contract without "at") never overrides a timed status.
    const g = await partners.createConnection(biz, { provider: "webhook", name: "WMS" });
    await customOrders(g, ["U-1"]);
    const send = (b: unknown) => partners.receiveWebhook(g.id, new Headers({ authorization: `Bearer ${g.inboundToken}` }), b, "1.1.1.1");
    await send({ reference: "U-1", status: "packed", at: new Date().toISOString() });
    await send({ reference: "U-1", status: "older-untimed" });
    expect((await db.select().from(partnerOrders).where(eq(partnerOrders.externalRef, "U-1")))[0].partnerStatus).toBe("packed");
    expect(fastcooTime("2021-11-16 11:34:21", "11:34:21", "Asia/Riyadh")!.toISOString()).toBe("2021-11-16T08:34:21.000Z");
    expect(fastcooTime("2021-11-16", "11:34:21", "UTC")!.toISOString()).toBe("2021-11-16T11:34:21.000Z");
    expect(fastcooTime(null, null, "UTC")).toBeNull();
  });
});

describe("review #5 — another company can never take over an order", () => {
  it("a foreign partnerId in a manifest is dropped; the derived link is scoped to the company", async () => {
    const { biz } = await setup(); const intruder = await mkBusiness({ fundsCents: 5000_00 });
    const c = await partners.createConnection(biz, { provider: "webhook", name: "WMS" });
    await customOrders(c, ["A-1"]);
    await mkDriver();
    const d = await createDraft(intruder, reqInput({ shipmentsPerDriver: 30, shipments: [{ recipientType: "consumer", recipientName: "Mallory", recipientPhone: "0555999000", address: "Elsewhere 1", externalRef: "A-1", partnerId: c.id }] }));
    expect((await db.select().from(shipments).where(eq(shipments.requestId, d.id)))[0].partnerId).toBeNull();
    // Even a forged row in the database does not make it the order's parcel.
    await db.update(shipments).set({ partnerId: c.id }).where(eq(shipments.requestId, d.id));
    expect((await partners.listOrders(biz, {})).items[0]).toMatchObject({ externalRef: "A-1", state: "open", parcel: null });
  });
});

describe("review #6 — partner cancellations: stale ones are ignored, replays heal, re-ship skips them", () => {
  it("an old cancel does not undo a newer status; a cancelled order's parcel is not re-shipped", async () => {
    const { biz } = await setup();
    const c = await partners.createConnection(biz, { provider: "webhook", name: "WMS" });
    const send = (b: unknown) => partners.receiveWebhook(c.id, new Headers({ authorization: `Bearer ${c.inboundToken}` }), b, "1.1.1.1");
    await customOrders(c, ["S-1", "S-2"]);
    await send({ reference: "S-1", status: "dispatched", at: "2026-11-18T12:00:00Z" });
    await send({ reference: "S-1", status: "cancelled", at: "2026-11-18T11:00:00Z" }); // older than what JR shows
    expect((await db.select().from(partnerOrders).where(eq(partnerOrders.externalRef, "S-1")))[0].state).toBe("open");
    const ids = (await db.select().from(partnerOrders)).map((o) => o.id);
    const { offer, driver, request } = await dispatchOrders(biz, ids);
    await jobs.acceptOffer(driver, offer.id, true); await jobs.confirmAttendance(biz, offer.id, true);
    await work(biz, driver, offer.id, 0); // both refused → returned
    await send({ reference: "S-2", status: "cancelled", at: new Date().toISOString() }); // the merchant gives up on S-2
    const r = await stops.reshipFromRequest(biz, request.id);
    const reshipped = await db.select().from(shipments).where(eq(shipments.requestId, (r as { id: string }).id));
    expect(reshipped.map((s) => s.externalRef)).toEqual(["S-1"]);
  });
});

describe("review #7 — a manual retry never moves an order backwards", () => {
  it("refuses to re-send an old update once a newer one reached the partner", async () => {
    const { biz } = await setup();
    const c = await partners.createConnection(biz, { provider: "webhook", name: "WMS", config: { callbackUrl: `${fake}/cb` } });
    await customOrders(c, ["R-1"]);
    const [o] = await db.select().from(partnerOrders);
    const { offer, driver } = await dispatchOrders(biz, [o.id]);
    await jobs.acceptOffer(driver, offer.id, true); await jobs.confirmAttendance(biz, offer.id, true);
    respond = (call) => (call.body?.event === "parcel.picked_up" ? { status: 400, body: { message: "bad" } } : { status: 200, body: {} }); // 400 = dead at once
    await work(biz, driver, offer.id, 1);
    await partners.processPartnerOutbox();
    const rows = await db.select().from(partnerOutbox).orderBy(partnerOutbox.seq);
    expect(rows.map((x) => [x.action, x.status])).toEqual([["picked_up", "dead"], ["out_for_delivery", "sent"], ["delivered", "sent"]]);
    await expect(partners.retryOutbox(biz, rows[0].id)).rejects.toMatchObject({ code: "INVALID_TRANSITION", message: expect.stringMatching(/newer update/) });
  });
});

describe("review #8 — saving a connection never overwrites a token the system just rotated", () => {
  it("rename / settings save keeps the stored secrets; typing a new secret replaces only that one", async () => {
    const { biz } = await setup();
    const c = await partners.createConnection(biz, { provider: "fastcoo", name: "Fastcoo", config: { appId: "A", clientId: "1", baseUrl: fake }, secrets: { clientSecret: "s", refreshToken: "rt-1" } });
    // Meanwhile a refresh rotated the tokens.
    const [row] = await db.select().from(partnerConnections).where(eq(partnerConnections.id, c.id));
    await db.update(partnerConnections).set({ secretsEnc: encryptSecrets({ ...decryptSecrets(row.secretsEnc), refreshToken: "rt-2", accessToken: "at-2" }) }).where(eq(partnerConnections.id, c.id));
    await partners.updateConnection(biz, c.id, { name: "Fastcoo KSA", settings: { sync: { assigned: true } } });
    let s = decryptSecrets((await db.select().from(partnerConnections).where(eq(partnerConnections.id, c.id)))[0].secretsEnc);
    expect(s).toMatchObject({ refreshToken: "rt-2", accessToken: "at-2", clientSecret: "s" });
    await partners.updateConnection(biz, c.id, { secrets: { clientSecret: "s2" } });
    s = decryptSecrets((await db.select().from(partnerConnections).where(eq(partnerConnections.id, c.id)))[0].secretsEnc);
    expect(s).toMatchObject({ refreshToken: "rt-2", accessToken: "at-2", clientSecret: "s2" });
  });
});

describe("review #9 — Omniful only ever receives its documented statuses, and hears when JR will not deliver", () => {
  it("refuses undocumented codes; a set-aside order is reported unable_to_deliver with the reason; attempts survive a re-ship", async () => {
    const { biz } = await setup();
    const c = await partners.createConnection(biz, { provider: "omniful", name: "Omniful" });
    await expect(partners.updateConnection(biz, c.id, { settings: { statusOut: { delivered: "completed" } } })).rejects.toMatchObject({ code: "VALIDATION" });
    await hit("POST", "/carriers/omniful/webhooks/register", { token: c.inboundToken!, body: { webhook_url: `${fake}/omni` } });
    const body = (sys: string) => ({ order_id: sys, system_id: sys, drop_details: { name: "Ahmad Saleh", phone: "+966500000001", address_line_1: "Olaya", system_city: "Riyadh", country_code: "SA" }, payment_details: { is_cod: false, currency: "SAR", cod_amount: 0, total_paid: 0, total_order_value: 10 }, packages: [{ weight: { value: 1, uom: "kg" } }], weight: { value: 1, uom: "kg" }, number_of_boxes: 1 });
    const awb = (await hit("POST", "/carriers/omniful/shipments", { token: c.inboundToken!, body: body("s1") })).json.data.awb_number;
    const [o] = await db.select().from(partnerOrders).where(eq(partnerOrders.awb, awb));
    await partners.dismissOrders(biz, [o.id], "out of stock");
    respond = () => ({ status: 200, body: { success: true } });
    await partners.processPartnerOutbox();
    const post = calls.find((x) => x.path === "/omni")!;
    expect(post.body).toMatchObject({ awb_number: awb, status: "unable_to_deliver", reason: expect.stringContaining("out of stock") });
    // Attempts across a re-ship: fail once, re-ship, fail again → 2.
    const awb2 = (await hit("POST", "/carriers/omniful/shipments", { token: c.inboundToken!, body: body("s2") })).json.data.awb_number;
    const [o2] = await db.select().from(partnerOrders).where(eq(partnerOrders.awb, awb2));
    const first = await dispatchOrders(biz, [o2.id]);
    await jobs.acceptOffer(first.driver, first.offer.id, true); await jobs.confirmAttendance(biz, first.offer.id, true);
    await work(biz, first.driver, first.offer.id, 0);
    const re = await stops.reshipFromRequest(biz, first.request.id) as { id: string };
    await publishRequest(biz, re.id, { termsAccepted: true });
    const [off2] = await db.select().from(offers).where(eq(offers.requestId, re.id));
    const [d2] = await db.select().from(users).where(eq(users.id, off2.driverId));
    await jobs.acceptOffer(d2, off2.id, true); await jobs.confirmAttendance(biz, off2.id, true);
    await work(biz, d2, off2.id, 0);
    expect((await hit("GET", `/carriers/omniful/shipments/${awb2}/tracking`, { token: c.inboundToken! })).json.data).toMatchObject({ number_of_attempts: 2 });
  });
});

describe("review #10 — Fizzpa is only ever changed with an id Fizzpa itself gave", () => {
  it("a hand-typed numeric reference is never deleted or tracked as a Fizzpa OrderId", async () => {
    const { biz } = await setup();
    const c = await partners.createConnection(biz, { provider: "fizzpa", name: "Fizzpa", config: { baseUrl: fake, referer: "https://store.example.com" }, secrets: { apiKey: "k" }, settings: { sync: { cancelled: true } } });
    await mkDriver();
    const d = await createDraft(biz, reqInput({ shipmentsPerDriver: 30, shipments: [{ recipientType: "consumer", recipientName: "Typed", recipientPhone: "0555123000", address: "Olaya 1", externalRef: "123456", partnerId: c.id }] }));
    const r = await publishRequest(biz, d.id, { termsAccepted: true });
    const [p] = await db.select().from(shipments).where(eq(shipments.requestId, r.id));
    await stops.cancelShipment(biz, p.id, "x");
    await partners.processPartnerOutbox();
    await partners.pollNow(biz, c.id);
    expect(calls.filter((x) => x.method === "DELETE" || x.path.startsWith("/orders/") || x.path.startsWith("/Tracking/"))).toHaveLength(0);
    expect((await db.select().from(partnerOutbox))[0]).toMatchObject({ status: "skipped", lastError: expect.stringMatching(/never looked up/) });
  });
});

describe("review #11 — Fastcoo answers are read exactly", () => {
  it("status:false is a failure, status 0 refreshes the token, '400 Already Exist' on the 3PL details is success", async () => {
    const { biz } = await setup();
    const c = await partners.createConnection(biz, { provider: "fastcoo", name: "Fastcoo", config: { appId: "APP", clientId: "1", baseUrl: fake }, secrets: { clientSecret: "s", refreshToken: "rt", accessToken: "old" } });
    let n = 0;
    respond = (call) => {
      if (call.path === "/oauth/token") return { status: 200, body: { access_token: "new", refresh_token: "rt2" } };
      if (call.path === "/Update3plDetails") return call.headers.authorization === "Bearer old" ? { status: 200, body: { status: 0, message: "Authentication Error" } } : { status: 400, body: { status: 400, message: "Already Exist" } };
      n++; return { status: 200, body: { status: false, message: "Invalid AWB" } };
    };
    const path = new URL(c.webhookUrl!).pathname.replace("/api/v1", "");
    await hit("POST", path, { body: { app_id: "APP", awb_no: "F1", receiver_name: "N", receiver_phone: "0555000111", receiver_address: "Olaya", receiver_city: "Riyadh", BookingMode: "CC" } });
    await partners.processPartnerOutbox();
    expect(calls.filter((x) => x.path === "/oauth/token")).toHaveLength(1);
    expect((await db.select().from(partnerOutbox).where(eq(partnerOutbox.action, "accepted")))[0].status).toBe("sent");
    const [o] = await db.select().from(partnerOrders);
    await db.insert(partnerOutbox).values({ connectionId: c.id, businessId: biz.id, partnerOrderId: o.id, action: "delivered", dedupeKey: "d:1", payload: { at: new Date().toISOString() } });
    await partners.processPartnerOutbox();
    expect(n).toBe(1);
    expect((await db.select().from(partnerOutbox).where(eq(partnerOutbox.dedupeKey, "d:1")))[0]).toMatchObject({ status: "dead", lastError: expect.stringMatching(/Invalid AWB/) });
  });
});

describe("review #12 — one failing partner does not hold up the others", () => {
  it("a partner that is down is skipped after 3 failures in a run; another company's updates still go out", async () => {
    const { biz } = await setup(); const other = await mkBusiness({ fundsCents: 5000_00 });
    const down = await partners.createConnection(biz, { provider: "webhook", name: "Down", config: { callbackUrl: `${fake}/down` } });
    const up = await partners.createConnection(other, { provider: "webhook", name: "Up", config: { callbackUrl: `${fake}/up` } });
    const rows = [];
    for (let i = 0; i < 6; i++) rows.push({ connectionId: down.id, businessId: biz.id, action: "delivered", dedupeKey: `x${i}`, payload: { at: new Date().toISOString() } });
    rows.push({ connectionId: up.id, businessId: other.id, action: "delivered", dedupeKey: "y", payload: { at: new Date().toISOString() } });
    await db.insert(partnerOutbox).values(rows);
    respond = (call) => (call.path === "/down" ? { status: 503 } : { status: 200, body: {} });
    await partners.processPartnerOutbox();
    expect(calls.filter((x) => x.path === "/down")).toHaveLength(3);
    expect(calls.filter((x) => x.path === "/up")).toHaveLength(1);
  });
});

describe("review #13 — credentials", () => {
  it("a new Shipox password signs in again instead of reusing the old account's token", async () => {
    const { biz } = await setup();
    respond = (call) => call.path.endsWith("/authenticate") ? { status: 200, body: { data: { id_token: `jwt-${call.body.password}` } } } : { status: 200, body: { data: { name: "x" } } };
    const c = await partners.createConnection(biz, { provider: "shipox", name: "Shipox", config: { baseUrl: fake, username: "u" }, secrets: { password: "one" } });
    await partners.lookupPackages(biz, c.id, ["Q"]);
    await partners.updateConnection(biz, c.id, { secrets: { password: "two" } });
    await partners.lookupPackages(biz, c.id, ["Q"]);
    const searches = calls.filter((x) => x.path === "/api/v1/customer/orders");
    expect(searches.map((x) => x.headers.authorization)).toEqual(["Bearer jwt-one", "Bearer jwt-two"]);
  });
});

describe("review #15 — changing a parcel's reference unlinks it from the partner order", () => {
  it("the old order shows open again and nothing is sent for the new reference", async () => {
    const { biz } = await setup();
    const c = await partners.createConnection(biz, { provider: "webhook", name: "WMS" });
    await customOrders(c, ["E-1"]);
    const [o] = await db.select().from(partnerOrders);
    const { request } = await dispatchOrders(biz, [o.id]);
    const [p] = await db.select().from(shipments).where(eq(shipments.requestId, request.id));
    await stops.updateShipment(biz, p.id, { externalRef: "MY-OWN-REF" });
    expect((await db.select().from(shipments).where(eq(shipments.id, p.id)))[0].partnerId).toBeNull();
    expect((await partners.listOrders(biz, {})).items[0].state).toBe("open");
  });
});
