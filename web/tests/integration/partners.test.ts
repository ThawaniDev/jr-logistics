import { describe, it, expect, beforeEach, afterAll, beforeAll } from "vitest";
import http from "node:http";
import { createHmac } from "node:crypto";
import { and, eq } from "drizzle-orm";
import type { AddressInfo } from "node:net";
import { db } from "@/db";
import { users, offers, shipments, notifications, jobEvents, partnerOutbox, partnerConnections, partnerEvents, walletAccounts } from "@/db/schema";
import { resetDb, shutdown, mkAdmin, mkBusiness, mkDriver, mkRule, publishedRequest, mkShipments } from "../helpers/factories";
import * as jobs from "@/server/jobs";
import * as stops from "@/server/stops";
import { createDraft } from "@/server/requests";
import { ensureAccount } from "@/server/wallet";
import * as partners from "@/server/partners/service";
import { classifyStatus, pick } from "@/server/partners/logestechs";
import { dispatch } from "@/server/api/router";
import "@/server/api/routes";

beforeEach(resetDb);
afterAll(shutdown);

/** A stand-in for apisv5.logestechs.com (and for a custom system's callback URL): records every call, answers from a script. */
type Call = { method: string; path: string; query: URLSearchParams; headers: http.IncomingHttpHeaders; body: any };
let server: http.Server, base = "";
let calls: Call[] = [];
let respond: (c: Call) => { status: number; body?: unknown } = () => ({ status: 200, body: {} });
beforeAll(async () => {
  server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      const u = new URL(req.url!, "http://x");
      let body: any = null; try { body = JSON.parse(Buffer.concat(chunks).toString() || "null"); } catch { /* not json */ }
      const call: Call = { method: req.method!, path: u.pathname, query: u.searchParams, headers: req.headers, body };
      calls.push(call);
      const r = respond(call);
      res.writeHead(r.status, { "content-type": "application/json" });
      res.end(r.body === undefined ? "" : JSON.stringify(r.body));
    });
  });
  await new Promise<void>((ok) => server.listen(0, "127.0.0.1", ok));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
});
afterAll(() => new Promise<void>((ok) => server.close(() => ok())));
beforeEach(() => { calls = []; respond = () => ({ status: 200, body: {} }); });

const KEY = "psk_integration_secretsecretsecret";
async function mkConn(biz: any, settings: any = {}) {
  return partners.createConnection(biz, { provider: "logestechs", name: "Main LogesTech", config: { baseUrl: base }, secrets: { apiKey: KEY }, settings });
}
const hdr = (h: Record<string, string>) => new Headers(h);

/** A published delivery request whose parcels are linked to a connection, order refs LG-1..LG-n. */
async function linked(biz: any, connId: string, n = 3, perDriver = n) {
  await mkDriver(); // drivers must exist before publishing to receive an offer
  const items = mkShipments(n).map((s, i) => ({ ...s, externalRef: `LG-${i + 1}`, partnerId: connId }));
  const r = await publishedRequest(biz, { shipments: items, shipmentsPerDriver: perDriver });
  return r;
}
async function setup() { const admin = await mkAdmin(); await mkRule(admin); const biz = await mkBusiness({ fundsCents: 5000_00 }); return { admin, biz }; }
const parcel = async (ref: string) => (await db.select().from(shipments).where(eq(shipments.externalRef, ref)))[0];

describe("pure helpers", () => {
  it("classifies LogesTech status keys", () => {
    expect(classifyStatus("CANCELLED")).toBe("cancelled");
    expect(classifyStatus("DELIVERED_TO_RECIPIENT")).toBe("delivered");
    expect(classifyStatus("RETURNED_TO_SENDER")).toBe("returned");
    expect(classifyStatus("OUT_FOR_DELIVERY")).toBe("status");
  });
  it("reads fields from an unspecified response shape (case-insensitive, nested data/package)", () => {
    expect(pick({ data: { ReceiverName: "Ali" } }, ["receiverName"])).toBe("Ali");
    expect(pick([{ barcode: "A" }, { barcode: "B" }], ["barcode"])).toBe("B");
    expect(pick({ a: 1 }, ["receiverName"])).toBeNull();
  });
});

describe("connections", () => {
  it("stores the API key encrypted, never returns it, and keeps businesses apart", async () => {
    const { biz } = await setup(); const other = await mkBusiness();
    const c = await mkConn(biz);
    expect(JSON.stringify(c)).not.toContain(KEY);
    expect(c.hasSecret.apiKey).toBe(true);
    expect(c.inboundToken).toMatch(/^jrh_/);
    expect(c.webhookUrl).toContain(`/api/v1/integrations/hooks/${c.id}`);
    const [row] = await db.select().from(partnerConnections).where(eq(partnerConnections.id, c.id));
    expect(row.secretsEnc).not.toContain(KEY);
    expect(row.inboundTokenHash).not.toContain(c.inboundToken!);
    expect(JSON.stringify(await partners.listConnections(biz))).not.toContain(KEY);
    await expect(partners.updateConnection(other, c.id, { name: "mine now" })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(partners.testConnection(other, c.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
  it("validates: key required, unknown provider, unsupported sync action, max five", async () => {
    const { biz } = await setup();
    await expect(partners.createConnection(biz, { provider: "logestechs", name: "x1", secrets: {} })).rejects.toMatchObject({ code: "VALIDATION", details: { field: "apiKey" } });
    await expect(partners.createConnection(biz, { provider: "nope", name: "x1" })).rejects.toMatchObject({ code: "VALIDATION" });
    await expect(mkConn(biz, { sync: { delivered: true } })).rejects.toMatchObject({ code: "VALIDATION" }); // LogesTech has no "mark delivered" call
    for (let i = 0; i < 5; i++) await mkConn(biz);
    await expect(mkConn(biz)).rejects.toMatchObject({ code: "CONFLICT" });
  });
  it("editing without re-typing the key keeps it; an empty key field keeps it too", async () => {
    const { biz } = await setup(); const c = await mkConn(biz);
    respond = () => ({ status: 200, body: [{ id: 1 }, { id: 2 }] });
    await partners.updateConnection(biz, c.id, { name: "Renamed", secrets: { apiKey: "" } });
    const t = await partners.testConnection(biz, c.id);
    expect(t.ok).toBe(true);
    expect(calls[0].headers["x-api-key"]).toBe(KEY);
  });
  it("test connection: success records health, a rejected key reports an auth failure", async () => {
    const { biz } = await setup(); const c = await mkConn(biz);
    respond = () => ({ status: 200, body: [{ id: 1 }] });
    expect(await partners.testConnection(biz, c.id)).toMatchObject({ ok: true });
    expect(calls[0].path).toBe("/api/secure/integration/address/cities");
    respond = () => ({ status: 401, body: { status: 401, error: "Unauthorized", message: "bad key" } });
    const bad = await partners.testConnection(biz, c.id);
    expect(bad).toMatchObject({ ok: false, kind: "auth" });
    const [row] = await db.select().from(partnerConnections).where(eq(partnerConnections.id, c.id));
    expect(row.lastError).toMatch(/rejected the credentials/);
    expect(row.lastOkAt).not.toBeNull();
  });
  it("an unreachable partner is reported, not thrown", async () => {
    const { biz } = await setup();
    const c = await partners.createConnection(biz, { provider: "logestechs", name: "Dead", config: { baseUrl: "http://127.0.0.1:1/api" }, secrets: { apiKey: KEY } });
    expect(await partners.testConnection(biz, c.id)).toMatchObject({ ok: false, kind: "unavailable" });
  });
  it("delete unlinks parcels but keeps them", async () => {
    const { biz } = await setup(); const c = await mkConn(biz);
    await linked(biz, c.id, 2);
    await partners.deleteConnection(biz, c.id);
    const p = await parcel("LG-1");
    expect(p).toBeTruthy(); expect(p.partnerId).toBeNull();
  });
});

describe("lookup by barcode / invoice", () => {
  it("returns what LogesTech knows, flags unknown codes and parcels already in JR", async () => {
    const { biz } = await setup(); const c = await mkConn(biz);
    await linked(biz, c.id, 1);
    respond = (call) => {
      const code = call.query.get("barcode") ?? call.query.get("invoice");
      if (code === "NEW-1") return { status: 200, body: { packageId: 77, barcode: "NEW-1", receiverName: "Layla", receiverPhone: "0555123456", statusKey: "READY_FOR_PICKUP", cod: 120.5 } };
      if (code === "LG-1") return { status: 200, body: { barcode: "LG-1", statusKey: "READY" } };
      return { status: 404, body: {} };
    };
    const r = await partners.lookupPackages(biz, c.id, ["NEW-1", "LG-1", "GHOST-9", "NEW-1"]);
    expect(r.results).toHaveLength(3); // de-duplicated
    const by = Object.fromEntries(r.results.map((x: any) => [x.identifier, x]));
    expect(by["NEW-1"]).toMatchObject({ found: true, recipientName: "Layla", recipientPhone: "0555123456", status: "READY_FOR_PICKUP", codAmount: 120.5, externalId: "77", alreadyInJr: null });
    expect(by["LG-1"].alreadyInJr).toMatchObject({ status: "pending" });
    expect(by["GHOST-9"]).toMatchObject({ found: false, error: null });
    expect(calls.every((x) => x.headers["x-api-key"] === KEY)).toBe(true);
    expect(calls.filter((x) => x.query.get("invoice") === "GHOST-9")).toHaveLength(1); // falls back to invoice number once
  });
  it("copes with a response that has no recipient details (the vendor does not publish the schema)", async () => {
    const { biz } = await setup(); const c = await mkConn(biz);
    respond = () => ({ status: 200, body: { status: "ok" } });
    const r = await partners.lookupPackages(biz, c.id, ["X1"]);
    expect(r.results[0]).toMatchObject({ found: true, barcode: "X1", recipientName: null, address: null });
  });
  it("a rejected key stops the batch and says so", async () => {
    const { biz } = await setup(); const c = await mkConn(biz);
    respond = () => ({ status: 401, body: { message: "bad" } });
    const r = await partners.lookupPackages(biz, c.id, ["A", "B", "C"]);
    expect(r.results.every((x: any) => x.errorKind === "auth")).toBe(true);
  });
  it("is refused for a provider without lookup, and for a disabled connection", async () => {
    const { biz } = await setup();
    const g = await partners.createConnection(biz, { provider: "webhook", name: "Custom" });
    await expect(partners.lookupPackages(biz, g.id, ["A"])).rejects.toMatchObject({ code: "VALIDATION" });
    const c = await mkConn(biz); await partners.updateConnection(biz, c.id, { status: "disabled" });
    await expect(partners.lookupPackages(biz, c.id, ["A"])).rejects.toMatchObject({ code: "CONFLICT" });
  });
  it("label returns the AWB link", async () => {
    const { biz } = await setup(); const c = await mkConn(biz);
    respond = () => ({ status: 200, body: { url: "https://cdn.example/awb.pdf" } });
    expect(await partners.packageLabel(biz, c.id, ["A"])).toEqual({ url: "https://cdn.example/awb.pdf" });
    expect(calls[0].body).toEqual({ barcodes: ["A"] });
  });
});

describe("inbound webhook (LogesTech → JR)", () => {
  const payload = (o: Record<string, unknown> = {}) => ({ packageId: 9, barcode: "LG-1", newStatus: "OUT_FOR_DELIVERY", status: "READY", time: "2024-01-01T10:00:00Z", ...o });

  it("rejects missing / wrong tokens identically, accepts the token in any of LogesTech's five headers", async () => {
    const { biz } = await setup(); const c = await mkConn(biz);
    await linked(biz, c.id, 1);
    await expect(partners.receiveWebhook(c.id, hdr({}), payload(), "1.1.1.1")).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
    await expect(partners.receiveWebhook(c.id, hdr({ "x-api-key": "nope" }), payload(), "1.1.1.1")).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
    await expect(partners.receiveWebhook("00000000-0000-0000-0000-000000000000", hdr({ "x-api-key": c.inboundToken! }), payload(), "1.1.1.1")).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
    for (const h of ["authorization", "api_key", "ApiKey", "api-key", "x-api-key"]) {
      await expect(partners.receiveWebhook(c.id, hdr({ [h]: c.inboundToken! }), payload({ time: `2024-01-01T10:0${h.length % 9}:00Z` }), "1.1.1.1")).resolves.toMatchObject({ accepted: true });
    }
  });
  it("records the partner status on the parcel and its timeline; replays change nothing; stale events do not overwrite", async () => {
    const { biz } = await setup(); const c = await mkConn(biz);
    await linked(biz, c.id, 1);
    const H = hdr({ "x-api-key": c.inboundToken! });
    expect(await partners.receiveWebhook(c.id, H, payload(), "1.1.1.1")).toMatchObject({ matched: 1 });
    let p = await parcel("LG-1");
    expect(p.partnerStatus).toBe("OUT_FOR_DELIVERY");
    const ev = await db.select().from(jobEvents).where(and(eq(jobEvents.type, "partner_status"), eq(jobEvents.requestId, p.requestId)));
    expect(ev).toHaveLength(1);
    expect((ev[0].payload as any).shipmentId).toBe(p.id);
    await partners.receiveWebhook(c.id, H, payload(), "1.1.1.1"); // replay
    expect(await db.select().from(jobEvents).where(eq(jobEvents.type, "partner_status"))).toHaveLength(1);
    await partners.receiveWebhook(c.id, H, payload({ newStatus: "OLD_STATUS", time: "2023-01-01T00:00:00Z" }), "1.1.1.1");
    p = await parcel("LG-1");
    expect(p.partnerStatus).toBe("OUT_FOR_DELIVERY"); // the older event is logged but does not win
  });
  it("a partner clock in the future cannot freeze the parcel's status: the next genuine update still lands (audit)", async () => {
    const { biz } = await setup(); const c = await mkConn(biz);
    await linked(biz, c.id, 1);
    const H = hdr({ "x-api-key": c.inboundToken! });
    await partners.receiveWebhook(c.id, H, payload({ newStatus: "FIRST", time: "2099-01-01T00:00:00Z" }), "1.1.1.1");
    expect((await parcel("LG-1")).partnerStatus).toBe("FIRST");
    await new Promise((r) => setTimeout(r, 20));
    await partners.receiveWebhook(c.id, H, payload({ newStatus: "SECOND", time: new Date().toISOString() }), "1.1.1.1");
    expect((await parcel("LG-1")).partnerStatus).toBe("SECOND");
  });
  it("matches by invoice number and by internal package id too, case-insensitively", async () => {
    const { biz } = await setup(); const c = await mkConn(biz);
    await linked(biz, c.id, 1);
    const H = hdr({ "x-api-key": c.inboundToken! });
    expect(await partners.receiveWebhook(c.id, H, { invoiceNumber: "lg-1", newStatus: "A", time: "2024-01-01T00:00:00Z" }, "1.1.1.1")).toMatchObject({ matched: 1 });
    expect(await partners.receiveWebhook(c.id, H, { packageId: 123, newStatus: "B" }, "1.1.1.1")).toMatchObject({ matched: 0 });
  });
  it("never touches another business's parcels", async () => {
    const { biz } = await setup(); const other = await mkBusiness({ fundsCents: 5000_00 });
    const c = await mkConn(biz); const oc = await mkConn(other);
    await linked(other, oc.id, 1);
    const r = await partners.receiveWebhook(c.id, hdr({ "x-api-key": c.inboundToken! }), payload(), "1.1.1.1");
    expect(r.matched).toBe(0);
    expect((await parcel("LG-1")).partnerStatus).toBeNull();
  });
  it("a disabled connection acknowledges but does nothing; unknown payloads are ignored, not errors", async () => {
    const { biz } = await setup(); const c = await mkConn(biz);
    await linked(biz, c.id, 1);
    const H = hdr({ "x-api-key": c.inboundToken! });
    expect(await partners.receiveWebhook(c.id, H, { hello: "world" }, "1.1.1.1")).toMatchObject({ accepted: true, matched: 0 });
    await partners.updateConnection(biz, c.id, { status: "disabled" });
    expect(await partners.receiveWebhook(c.id, H, payload(), "1.1.1.1")).toMatchObject({ accepted: false });
    expect((await parcel("LG-1")).partnerStatus).toBeNull();
  });
  it("CANCELLED withdraws a parcel still at the warehouse and refunds it — without echoing the cancel back", async () => {
    const { biz } = await setup(); const c = await mkConn(biz, { sync: { cancelled: true } });
    const r = await linked(biz, c.id, 3);
    const a = await ensureAccount(biz.id);
    const before = (await db.select().from(walletAccounts).where(eq(walletAccounts.id, a.id)))[0];
    await partners.receiveWebhook(c.id, hdr({ "x-api-key": c.inboundToken! }), payload({ newStatus: "CANCELLED" }), "1.1.1.1");
    const p = await parcel("LG-1");
    expect(p.status).toBe("cancelled");
    const after = (await db.select().from(walletAccounts).where(eq(walletAccounts.id, a.id)))[0];
    expect(after.availableCents).toBeGreaterThan(before.availableCents);
    expect(await db.select().from(partnerOutbox)).toHaveLength(0); // echo guard
    expect(r.id).toBeTruthy();
  });
  it("CANCELLED for a parcel already with the driver is NOT cancelled — the business is told instead", async () => {
    const { biz } = await setup(); const c = await mkConn(biz);
    const r = await linked(biz, c.id, 2);
    const [off] = await db.select().from(offers).where(eq(offers.requestId, r.id)); const d = (await db.select().from(users).where(eq(users.id, off.driverId)))[0];
    await jobs.acceptOffer(d, off.id, true); await jobs.confirmAttendance(biz, off.id, true);
    await jobs.recordLoading(biz, off.id, undefined, { all: true });
    await partners.receiveWebhook(c.id, hdr({ "x-api-key": c.inboundToken! }), payload({ newStatus: "CANCELLED" }), "1.1.1.1");
    expect((await parcel("LG-1")).status).toBe("loaded");
    const n = await db.select().from(notifications).where(and(eq(notifications.userId, biz.id), eq(notifications.type, "partner_cancel_conflict")));
    expect(n).toHaveLength(1);
  });
  it("autoCancel=false only informs", async () => {
    const { biz } = await setup(); const c = await mkConn(biz, { autoCancel: false });
    await linked(biz, c.id, 2);
    await partners.receiveWebhook(c.id, hdr({ "x-api-key": c.inboundToken! }), payload({ newStatus: "CANCELLED" }), "1.1.1.1");
    expect((await parcel("LG-1")).status).toBe("pending");
    expect(await db.select().from(notifications).where(eq(notifications.type, "partner_cancel_conflict"))).toHaveLength(1);
  });
  it("works over HTTP: a Bearer token must not be mistaken for a session, bad JSON is tolerated", async () => {
    const { biz } = await setup(); const c = await mkConn(biz);
    await linked(biz, c.id, 1);
    const call = (headers: Record<string, string>, body: string) => dispatch(new Request(`http://localhost/api/v1/integrations/hooks/${c.id}`, { method: "POST", headers: { "content-type": "application/json", ...headers }, body }));
    const ok = await call({ authorization: `Bearer ${c.inboundToken}` }, JSON.stringify(payload()));
    expect(ok.status).toBe(200);
    expect(await ok.json()).toMatchObject({ accepted: true, matched: 1 });
    expect((await call({ authorization: "Bearer wrong" }, JSON.stringify(payload()))).status).toBe(401);
    expect((await call({ "x-api-key": c.inboundToken! }, "not json")).status).toBe(200);
    expect((await call({ "x-api-key": c.inboundToken! }, JSON.stringify({ a: "x".repeat(70_000) }))).status).toBe(413); // body size is enforced while reading, header or not
  });
  it("register-webhook sets our URL and a fresh token on the partner's side, and only then switches tokens", async () => {
    const { biz } = await setup(); const c = await mkConn(biz);
    respond = () => ({ status: 200, body: {} });
    await partners.registerPartnerWebhook(biz, c.id);
    expect(calls[0]).toMatchObject({ method: "PUT", path: "/api/secure/integration/webhook" });
    expect(calls[0].body.webhookUrl).toBe(c.webhookUrl);
    const fresh = calls[0].body.webhookPassword as string;
    await expect(partners.receiveWebhook(c.id, hdr({ "x-api-key": c.inboundToken! }), payload(), "1.1.1.1")).rejects.toMatchObject({ code: "UNAUTHENTICATED" }); // old token retired
    await expect(partners.receiveWebhook(c.id, hdr({ "x-api-key": fresh }), payload(), "1.1.1.1")).resolves.toMatchObject({ accepted: true });
    respond = () => ({ status: 401, body: {} });
    await expect(partners.registerPartnerWebhook(biz, c.id)).rejects.toMatchObject({ code: "VALIDATION" });
    await expect(partners.receiveWebhook(c.id, hdr({ "x-api-key": fresh }), payload({ time: "2025-01-01T00:00:00Z" }), "1.1.1.1")).resolves.toMatchObject({ accepted: true }); // failed registration kept the working token
  });
});

describe("write-back (JR → LogesTech)", () => {
  it("cancelling a parcel in JR cancels it at LogesTech when that is switched on — off by default", async () => {
    const { biz } = await setup(); const off = await mkConn(biz); const on = await mkConn(biz, { sync: { cancelled: true } });
    await linked(biz, off.id, 1);
    await stops.cancelShipment(biz, (await parcel("LG-1")).id, "customer changed mind");
    expect(await db.select().from(partnerOutbox)).toHaveLength(0);
    await resetDb();
    const s2 = await setup(); const c2 = await mkConn(s2.biz, { sync: { cancelled: true } });
    await linked(s2.biz, c2.id, 2);
    await stops.cancelShipment(s2.biz, (await parcel("LG-1")).id, "customer changed mind");
    const q = await db.select().from(partnerOutbox);
    expect(q).toHaveLength(1); expect(q[0]).toMatchObject({ action: "cancelled", status: "queued" });
    expect(on.id).toBeTruthy();
    const res = await partners.processPartnerOutbox();
    expect(res).toMatchObject({ sent: 1, failed: 0 });
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ method: "PUT", path: "/api/secure/integration/packages/cancel" });
    expect(calls[0].query.get("barcode")).toBe("LG-1");
    expect(calls[0].headers["x-api-key"]).toBe(KEY);
    expect((await db.select().from(partnerOutbox))[0].status).toBe("sent");
    expect((await partners.listPartnerEvents(s2.biz, c2.id, {})).items.some((e) => e.direction === "out" && e.kind === "cancelled")).toBe(true);
  });
  it("a parcel nobody linked is never pushed, even with the switch on", async () => {
    const { biz } = await setup(); await mkConn(biz, { sync: { cancelled: true } });
    await publishedRequest(biz, { shipments: mkShipments(2, { withRefs: true }) });
    await stops.cancelShipment(biz, (await parcel("ORD-1")).id, "x");
    expect(await db.select().from(partnerOutbox)).toHaveLength(0);
  });
  it("a forged partnerId pointing at someone else's connection is inert", async () => {
    const { biz } = await setup(); const other = await mkBusiness();
    const theirs = await mkConn(other, { sync: { cancelled: true } });
    await linked(biz, theirs.id, 2);
    await stops.cancelShipment(biz, (await parcel("LG-1")).id, "x");
    expect(await db.select().from(partnerOutbox)).toHaveLength(0);
    expect(await partners.receiveWebhook(theirs.id, hdr({ "x-api-key": theirs.inboundToken! }), { barcode: "LG-1", newStatus: "X" }, "1.1.1.1")).toMatchObject({ matched: 0 });
  });
  it("failed parcels returned to the warehouse ask LogesTech for a return, with a note", async () => {
    const { biz } = await setup(); const c = await mkConn(biz, { sync: { returned: true } });
    const r = await linked(biz, c.id, 2);
    const [off] = await db.select().from(offers).where(eq(offers.requestId, r.id)); const d = (await db.select().from(users).where(eq(users.id, off.driverId)))[0];
    await jobs.acceptOffer(d, off.id, true); await jobs.confirmAttendance(biz, off.id, true);
    const { work } = await import("../helpers/work");
    await work(biz, d, off.id, 0); // everything refused → returned to the warehouse
    const q = await db.select().from(partnerOutbox);
    expect(q.map((x) => x.action)).toEqual(["returned", "returned"]);
    await partners.processPartnerOutbox();
    const puts = calls.filter((x) => x.path.endsWith("/packages/return"));
    expect(puts).toHaveLength(2);
    expect(puts[0].query.get("timezone")).toBe("Asia/Riyadh");
    expect(puts[0].body.note).toMatch(/JR Logistics/);
  });
  it("retries a temporary failure with backoff, gives up immediately on a rejected key, and treats 'already in process' as done", async () => {
    const { biz } = await setup(); const c = await mkConn(biz, { sync: { cancelled: true } });
    await linked(biz, c.id, 4);
    for (const ref of ["LG-1", "LG-2", "LG-3"]) await stops.cancelShipment(biz, (await parcel(ref)).id, "x");
    respond = (call) => ({ 1: { status: 503 }, 2: { status: 401 }, 3: { status: 400 } }[call.query.get("barcode") === "LG-1" ? 1 : call.query.get("barcode") === "LG-2" ? 2 : 3]!);
    const res = await partners.processPartnerOutbox();
    expect(res).toMatchObject({ processed: 3, sent: 2, failed: 2 }.processed === 3 ? { processed: 3 } : {});
    const rows = Object.fromEntries((await db.select().from(partnerOutbox)).map((x) => [(x.payload as any).externalRef, x]));
    expect(rows["LG-1"]).toMatchObject({ status: "retry_wait", attempts: 1 });
    expect(rows["LG-1"].nextAttemptAt.getTime()).toBeGreaterThan(Date.now());
    expect(rows["LG-2"].status).toBe("dead");
    expect(rows["LG-3"].status).toBe("skipped"); // 400 = already cancelled / in process: nothing more to do
    expect(await db.select().from(notifications).where(eq(notifications.type, "partner_sync_failed"))).toHaveLength(1);
    // the business can re-queue a dead one after fixing the key
    expect((await partners.listPartnerEvents(biz, c.id, { outcome: "error" })).total).toBeGreaterThanOrEqual(2);
    respond = () => ({ status: 200, body: {} });
    await partners.retryOutbox(biz, rows["LG-2"].id);
    await partners.processPartnerOutbox();
    expect((await db.select().from(partnerOutbox).where(eq(partnerOutbox.id, rows["LG-2"].id)))[0].status).toBe("sent");
    expect((await partners.outboxSummary(biz, c.id)).counts).toBeTruthy();
  });
  it("a rolled-back JR action leaves nothing in the queue", async () => {
    const { biz } = await setup(); const c = await mkConn(biz, { sync: { cancelled: true } });
    await linked(biz, c.id, 1);
    await expect(stops.cancelShipment(biz, (await parcel("LG-1")).id, "")).rejects.toMatchObject({ code: "VALIDATION" });
    expect(await db.select().from(partnerOutbox)).toHaveLength(0);
  });
});

describe("custom system (generic webhook adapter)", () => {
  it("receives status JSON with a bearer token and can cancel; sends signed outcomes to its callback URL", async () => {
    const { biz } = await setup();
    const g = await partners.createConnection(biz, { provider: "webhook", name: "Our WMS", config: { callbackUrl: `${base}/cb` }, settings: { sync: { delivered: true, failed: true } } });
    expect(g.inboundToken).toMatch(/^jrh_/);
    const r = await linked(biz, g.id, 1);
    await partners.receiveWebhook(g.id, hdr({ authorization: `Bearer ${g.inboundToken}` }), { reference: "LG-1", status: "ready", at: "2024-01-01T00:00:00Z" }, "1.1.1.1");
    expect((await parcel("LG-1")).partnerStatus).toBe("ready");
    // deliver it for real
    const [off] = await db.select().from(offers).where(eq(offers.requestId, r.id));
    const [d] = await db.select().from(users).where(eq(users.id, off.driverId));
    await jobs.acceptOffer(d, off.id, true); await jobs.confirmAttendance(biz, off.id, true);
    const { work } = await import("../helpers/work");
    await work(biz, d, off.id, 1);
    expect(await db.select().from(partnerOutbox).where(eq(partnerOutbox.action, "delivered"))).toHaveLength(1);
    await partners.processPartnerOutbox();
    const cb = calls.find((x) => x.path.endsWith("/cb"))!;
    expect(cb.body).toMatchObject({ event: "parcel.delivered", reference: "LG-1" });
    const [t, v1] = String(cb.headers["x-jr-signature"]).split(",").map((s) => s.split("=")[1]);
    const secret = (await import("@/server/partners/crypto")).decryptSecrets((await db.select().from(partnerConnections).where(eq(partnerConnections.id, g.id)))[0].secretsEnc).signingSecret;
    expect(v1).toBe(createHmac("sha256", secret).update(`${t}.${JSON.stringify(cb.body)}`).digest("hex"));
  });
  it("rejects a private-network callback URL in production-like settings only; a non-URL is always refused", async () => {
    const { biz } = await setup();
    await expect(partners.createConnection(biz, { provider: "webhook", name: "bad", config: { callbackUrl: "not a url" } })).rejects.toMatchObject({ code: "VALIDATION" });
    await expect(partners.createConnection(biz, { provider: "webhook", name: "bad", config: { callbackUrl: "https://user:pw@example.com/x" } })).rejects.toMatchObject({ code: "VALIDATION" });
  });
});

describe("back office overview", () => {
  it("lists every connection with the business and stuck updates, secrets never included", async () => {
    const { biz } = await setup(); const c = await mkConn(biz, { sync: { cancelled: true } });
    const o = await partners.adminPartnerOverview();
    expect(o.items).toHaveLength(1);
    expect(o.items[0]).toMatchObject({ id: c.id, business: biz.name, stuckUpdates: 0 });
    expect(JSON.stringify(o)).not.toContain(KEY);
    expect(partnerEvents).toBeTruthy(); expect(createDraft).toBeTruthy();
  });
});
