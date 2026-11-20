import { and, eq, sql } from "drizzle-orm";
import { timingSafeEqual } from "node:crypto";
import { db } from "@/db";
import { offers, partnerConnections, partnerOrders, shipments, type PartnerConnection, type PartnerOrder } from "@/db/schema";
import { AppError } from "@/lib/errors";
import { sha256 } from "@/lib/ids";
import { hit } from "../auth/ratelimit";
import { assertSafeWebhookUrl } from "../integrations";
import { getSettings } from "../settings";
import { matchCity } from "./cities";
import { labelUrl, statusFor, trackingUrl } from "./config";
import { issueAccessToken, readAccessToken } from "./crypto";
import { arr, joinParts, num, obj, str } from "./http";
import { cancelFromPartner, importOrder } from "./inbound";
import { liveParcel, orderAttempts } from "./orders-core";
import { recordEvent } from "./outbox";
import { omniful } from "./omniful";
import type { JrEvent, PartnerOrderInput } from "./types";

/**
 * JR's implementation of Omniful's "Shipping Partner Integration API" (decision I8). Base URL to give Omniful at onboarding:
 *   <APP_URL>/api/v1/carriers/omniful        (Omniful appends the fixed paths below; no version prefix)
 * Credentials per merchant account = one JR connection: api_key mode → the connection's key; access_token mode → client_id = connection id,
 * client_secret = the same key. Every answer uses Omniful's envelope; every call must finish well inside Omniful's 10-second timeout
 * (only database work happens here; anything that talks to other systems runs from the outbox).
 */
type Json = Record<string, unknown>;
const reply = (status: number, body: Json) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });
const ok = (data: Json) => reply(200, { success: true, data });
const fail = (status: number, code: string, message: string) => reply(status, { success: false, error: { code, message } });
class CarrierError extends Error { constructor(readonly status: number, readonly code: string, message: string) { super(message); } }
const bad = (m: string) => new CarrierError(400, "VALIDATION_ERROR", m);

const sameHash = (token: string, hash: string) => { const a = Buffer.from(sha256(token)), b = Buffer.from(hash); return a.length === b.length && timingSafeEqual(a, b); };

async function byKey(key: string): Promise<PartnerConnection | null> {
  if (!key || key.length > 200) return null;
  const [c] = await db.select().from(partnerConnections).where(and(eq(partnerConnections.inboundTokenHash, sha256(key)), eq(partnerConnections.provider, "omniful")));
  return c ?? null;
}
/** Bearer = the connection's key (api_key mode) or a JR access token (access_token mode). */
async function authed(req: Request, ip: string): Promise<PartnerConnection> {
  await hit(`carrier-omniful-ip:${ip}`, 12_000, 60); // coarse abuse guard only: Omniful calls for every merchant from shared addresses
  const token = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
  let c: PartnerConnection | null = null;
  if (token.startsWith("jrat_")) {
    const p = readAccessToken(token);
    if (p) { const [row] = await db.select().from(partnerConnections).where(eq(partnerConnections.id, p.connectionId)); c = row && row.provider === "omniful" && row.tokenVersion === p.version ? row : null; }
  } else c = await byKey(token);
  if (!c) throw new CarrierError(401, "AUTHENTICATION_ERROR", "Invalid or expired credentials");
  if (c.status !== "active") throw new CarrierError(401, "AUTHENTICATION_ERROR", "This JR connection is paused");
  await hit(`carrier-omniful:${c.id}`, 600, 60);
  await db.update(partnerConnections).set({ meta: sql`${partnerConnections.meta} || ${JSON.stringify({ lastCarrierCallAt: new Date().toISOString() })}::jsonb` }).where(eq(partnerConnections.id, c.id));
  return c;
}

async function guard(fn: () => Promise<Response>): Promise<Response> {
  try { return await fn(); }
  catch (e) {
    if (e instanceof CarrierError) return fail(e.status, e.code, e.message);
    if (e instanceof AppError) {
      if (e.code === "RATE_LIMITED") return fail(429, "RATE_LIMITED", e.message);
      if (e.code === "UNAUTHENTICATED") return fail(401, "AUTHENTICATION_ERROR", e.message);
      if (e.code === "NOT_FOUND") return fail(404, "NOT_FOUND", e.message);
      if (e.status < 500) return fail(400, "VALIDATION_ERROR", e.message);
    }
    return fail(500, "INTERNAL_ERROR", "JR could not process the request — please retry");
  }
}

// ───────── auth ─────────
export const omnifulValidate = (body: unknown, ip: string) => guard(async () => {
  await hit(`carrier-omniful-auth:${ip}`, 3000, 60);
  const key = str(obj(body)?.api_key);
  if (key) await hit(`carrier-omniful-auth-key:${sha256(key).slice(0, 24)}`, 60, 60); // guessing is limited per key, not per shared IP
  const c = key ? await byKey(key) : null;
  if (!c || c.status !== "active") throw new CarrierError(401, "AUTHENTICATION_ERROR", "Invalid API key");
  await recordEvent(c, { direction: "in", kind: "auth", summary: "Omniful validated its JR API key" });
  await db.update(partnerConnections).set({ meta: sql`${partnerConnections.meta} || ${JSON.stringify({ lastCarrierCallAt: new Date().toISOString(), authMode: "api_key" })}::jsonb` }).where(eq(partnerConnections.id, c.id));
  return ok({});
});

export const omnifulToken = (body: unknown, ip: string) => guard(async () => {
  await hit(`carrier-omniful-auth:${ip}`, 3000, 60);
  const b = obj(body);
  const id = str(b?.client_id), secret = str(b?.client_secret);
  if (!id || !secret || !/^[0-9a-f-]{36}$/i.test(id)) throw new CarrierError(401, "AUTHENTICATION_ERROR", "Invalid client credentials");
  await hit(`carrier-omniful-auth-client:${id}`, 120, 60); // Omniful refreshes on every 401: generous, but per client
  const [c] = await db.select().from(partnerConnections).where(and(eq(partnerConnections.id, id), eq(partnerConnections.provider, "omniful")));
  if (!c || !c.inboundTokenHash || !sameHash(secret, c.inboundTokenHash) || c.status !== "active") throw new CarrierError(401, "AUTHENTICATION_ERROR", "Invalid client credentials");
  const t = issueAccessToken(c.id, c.tokenVersion);
  await db.update(partnerConnections).set({ meta: sql`${partnerConnections.meta} || ${JSON.stringify({ lastCarrierCallAt: new Date().toISOString(), authMode: "access_token" })}::jsonb` }).where(eq(partnerConnections.id, c.id));
  return ok({ access_token: t.token, expire_in: t.expiresIn });
});

// ───────── forward shipments ─────────
/** Omniful's Create Shipment body → a JR incoming order. Throws VALIDATION_ERROR for anything JR cannot deliver (the contract asks us to). */
export async function omnifulOrderInput(b: Json, acceptCod: boolean): Promise<PartnerOrderInput> {
  const orderId = str(b.order_id), systemId = str(b.system_id);
  const drop = obj(b.drop_details), pay = obj(b.payment_details), pick = obj(b.pickup_details);
  if (!orderId) throw bad("order_id is required");
  if (!systemId) throw bad("system_id is required");
  if (!drop) throw bad("drop_details is required");
  if (!pay) throw bad("payment_details is required");
  const country = str(drop.country_code)?.toUpperCase();
  if (country && country !== "SA") throw bad(`JR delivers inside Saudi Arabia only (drop country ${country})`);
  const currency = str(pay.currency)?.toUpperCase();
  if (currency !== "SAR") throw bad(`JR only accepts shipments in SAR (got ${currency ?? "no currency"})`);
  const cod = num(pay.cod_amount) ?? 0;
  if (cod < 0) throw bad("cod_amount cannot be negative");
  if ((pay.is_cod === true || cod > 0) && !acceptCod) throw bad("This JR account does not accept cash-on-delivery shipments");
  const city = str(drop.system_city) ?? str(drop.external_city); // the documented fallback rule
  const settings = await getSettings();
  if (!matchCity(city, settings.cities.filter((k) => k.delivery))) throw bad(`JR does not deliver to "${city ?? "(no city given)"}"`);
  const items = arr(b.items).map(obj).filter((x): x is Json => !!x).map((i) => ({ sku: str(i.sku_code), name: str(i.sku_name), qty: num(i.shipped_quantity) ?? num(i.ordered_quantity) }));
  const slot = obj(b.delivery_slot);
  const slotText = slot && str(slot.start_date) ? `${str(slot.start_date)} ${str(slot.start_time) ?? ""}–${str(slot.end_date) ?? ""} ${str(slot.end_time) ?? ""}`.trim() : null;
  const nat = str(drop.national_address_code);
  const street = str(drop.street), l1 = str(drop.address_line_1);
  return {
    externalId: systemId, externalRef: systemId, invoice: orderId,
    recipient: {
      name: str(drop.name), phone: str(drop.phone), email: str(drop.email), city, lat: num(drop.latitude), lng: num(drop.longitude),
      address: joinParts(l1, drop.address_line_2, street && !(l1 ?? "").includes(street) ? street : null, drop.area, drop.building_number ? `Bldg ${str(drop.building_number)}` : null, drop.postal_code),
    },
    pickup: pick ? { name: str(pick.name), phone: str(pick.phone), email: str(pick.email), address: joinParts(pick.address_line_1, pick.address_line_2, pick.area), city: str(pick.system_city) ?? str(pick.external_city), code: str(pick.location_code), lat: num(pick.latitude), lng: num(pick.longitude) } : null,
    codAmount: pay.is_cod === true || cod > 0 ? cod : 0, currency: "SAR",
    pieces: num(b.number_of_boxes) ?? arr(b.packages).length ?? null, weightKg: num(obj(b.weight)?.value),
    contents: items.length ? items.slice(0, 5).map((i) => `${i.qty ?? 1}× ${i.name ?? i.sku}`).join(", ").slice(0, 300) : null,
    notes: [str(b.remarks), nat ? `National address ${nat}` : null, slotText ? `Delivery slot ${slotText}` : null].filter(Boolean).join(" · ") || null,
    items, slot: slotText ? { from: `${str(slot!.start_date)} ${str(slot!.start_time) ?? ""}`.trim(), to: `${str(slot!.end_date) ?? str(slot!.start_date)} ${str(slot!.end_time) ?? ""}`.trim() } : null,
    extra: { orderId, reference: str(b.reference), systemId, customFields: arr(obj(b.meta)?.custom_fields).slice(0, 30), locationCode: str(pick?.location_code), nationalAddress: nat, totalOrderValue: num(pay.total_order_value), totalPaid: num(pay.total_paid) },
  };
}

const created = (o: PartnerOrder) => ok({ awb_number: o.awb, partner_system_id: o.id, awb_label: labelUrl(o.awb!), tracking_url: trackingUrl(o.awb!) });

export const omnifulCreate = (req: Request, body: unknown, ip: string) => guard(async () => {
  const c = await authed(req, ip);
  const b = obj(body);
  if (!b) throw bad("Malformed JSON body");
  // system_id is Omniful's idempotency key: a retry (e.g. after Omniful's 10-second timeout) always gets the AWB of the first attempt —
  // checked BEFORE validation, so a setting changed in between can never refuse a shipment JR already holds.
  const systemId = str(b.system_id);
  if (systemId) {
    const [again] = await db.select().from(partnerOrders).where(and(eq(partnerOrders.connectionId, c.id), eq(partnerOrders.externalId, systemId)));
    if (again?.awb) return created(again);
  }
  const input = await omnifulOrderInput(b, (c.config as Json).acceptCod !== false);
  const r = await importOrder(c, omniful, input, "push");
  if (r.rejected) throw bad(r.rejected);
  return created(r.order!);
});

async function orderOf(c: PartnerConnection, awb: string | null): Promise<PartnerOrder> {
  if (!awb) throw bad("awb_number is required");
  const [o] = await db.select().from(partnerOrders).where(and(eq(partnerOrders.connectionId, c.id), eq(partnerOrders.awb, awb.trim().toUpperCase())));
  if (!o) throw new CarrierError(404, "NOT_FOUND", `No JR shipment with AWB ${awb}`);
  return o;
}

export const omnifulCancel = (req: Request, body: unknown, ip: string) => guard(async () => {
  const c = await authed(req, ip);
  const b = obj(body);
  const o = await orderOf(c, str(b?.awb_number));
  const reason = str(b?.reason) ?? "Cancelled in Omniful";
  const r = await cancelFromPartner(c, omniful, o, reason, "strict");
  if (r.outcome === "already") throw new CarrierError(400, "ALREADY_CANCELLED", "This shipment is already cancelled");
  if (r.outcome === "conflict") throw bad(r.message);
  return ok({ message: r.outcome === "withdrawn" ? "Shipment cancelled and removed from the JR delivery run" : "Shipment cancelled" });
});

/** JR's current progress of one order, in JR events, newest first, used to answer Omniful's polling. */
const FALLBACK: Partial<Record<JrEvent, JrEvent>> = { arrived: "out_for_delivery", postponed: "out_for_delivery", out_for_delivery: "picked_up", picked_up: "assigned", assigned: "accepted", reshipped: "assigned" };

export const omnifulTrack = (req: Request, awb: string, ip: string) => guard(async () => {
  const c = await authed(req, ip);
  const o = await orderOf(c, awb);
  if (o.state === "cancelled") return ok({ status: "cancelled", status_updated_at: (o.cancelledAt ?? o.updatedAt).toISOString(), description: "Cancelled", number_of_attempts: 0 });
  const live = await liveParcel(db, o.id);
  if (!live) return ok({ status: "pending", status_updated_at: o.createdAt.toISOString(), description: "Received by JR — not scheduled for delivery yet", number_of_attempts: 0 });
  const [s] = await db.select().from(shipments).where(eq(shipments.id, live.id));
  const attempts = await orderAttempts(c.id, o);
  const [off] = s.offerId ? await db.select({ approved: offers.routeApprovedAt }).from(offers).where(eq(offers.id, s.offerId)) : [];
  let ev: JrEvent; let at: Date | null;
  switch (s.status) {
    case "delivered": ev = "delivered"; at = s.deliveredAt; break;
    case "returned": ev = "returned"; at = s.returnedAt; break;
    case "missing": ev = "missing"; at = s.updatedAt; break;
    case "failed": ev = "failed"; at = s.failedAt; break;
    case "loaded": ev = s.arrivedAt ? "arrived" : off?.approved ? "out_for_delivery" : "picked_up"; at = s.arrivedAt ?? off?.approved ?? s.loadedAt; break;
    default: ev = s.offerId ? "assigned" : "accepted"; at = s.updatedAt;
  }
  let status = statusFor(c, omniful, ev), cur: JrEvent | undefined = ev;
  while (!status && cur && FALLBACK[cur]) { cur = FALLBACK[cur]; status = statusFor(c, omniful, cur!); }
  const data: Json = {
    status: status ?? "pending", status_updated_at: (at ?? s.updatedAt).toISOString(),
    description: status ? (omniful.statusOut!.find((x) => x.value === status)?.label ?? status) : "Received by JR — waiting for pickup",
    number_of_attempts: attempts.total,
  };
  if (ev === "failed") { const reason = [s.failReason, s.failNote].filter(Boolean).join(" — "); if (reason) data.reason = reason.slice(0, 250); }
  if (attempts.first) data.first_delivery_attempt_at = attempts.first.toISOString();
  return ok(data);
});

export const omnifulLabel = (req: Request, awb: string, ip: string) => guard(async () => {
  const c = await authed(req, ip);
  const o = await orderOf(c, awb);
  return ok({ awb_label: labelUrl(o.awb!) });
});

// ───────── returns (not offered) ─────────
export const omnifulReturns = (req: Request, ip: string) => guard(async () => {
  await authed(req, ip);
  throw bad("JR does not collect return shipments from customers — please use another shipping partner for returns");
});

// ───────── webhooks ─────────
export const omnifulRegisterWebhook = (req: Request, body: unknown, ip: string) => guard(async () => {
  const c = await authed(req, ip);
  const url = str(obj(body)?.webhook_url);
  if (!url) throw bad("webhook_url is required");
  try { await assertSafeWebhookUrl(url, false); } catch { throw bad("webhook_url must be a public https URL"); }
  await db.update(partnerConnections).set({ meta: sql`${partnerConnections.meta} || ${JSON.stringify({ webhookUrl: url, webhookRegisteredAt: new Date().toISOString() })}::jsonb`, updatedAt: new Date() }).where(eq(partnerConnections.id, c.id));
  await recordEvent(c, { direction: "in", kind: "register_webhook", summary: `Omniful registered its webhook (${new URL(url).host})` });
  return ok({ is_success: true });
});
