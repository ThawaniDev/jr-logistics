import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { timingSafeEqual } from "node:crypto";
import { db } from "@/db";
import { notifications, partnerConnections, partnerEvents, partnerOrders, requests, shipments, users, type PartnerConnection, type PartnerOrder } from "@/db/schema";
import { err } from "@/lib/errors";
import { sha256 } from "@/lib/ids";
import { hit } from "../auth/ratelimit";
import { logEvent } from "../events";
import { notify } from "../notify";
import { cancelShipment } from "../stops";
import { ctxOf, kindFor, labelUrl, settingsOf, trackingUrl } from "./config";
import { liveParcel, upsertOrder } from "./orders-core";
import { recordEvent } from "./outbox";
import { getAdapter } from "./registry";
import { enqueueOrderEvent } from "./sync";
import type { Adapter, PartnerEvent, PartnerOrderInput, WebhookResult } from "./types";

const msg = (e: unknown) => (e instanceof Error ? e.message : "error").slice(0, 300);
const tokenOk = (given: string, hash: string) => { const a = Buffer.from(sha256(given)), b = Buffer.from(hash); return a.length === b.length && timingSafeEqual(a, b); };

/** Normalises the three shapes `parseWebhook` may return. */
export function asResult(v: WebhookResult | PartnerEvent | PartnerEvent[] | null): WebhookResult {
  if (!v) return {};
  if (Array.isArray(v)) return { events: v };
  if ("status" in v && "kind" in v) return { events: [v as PartnerEvent] };
  return v as WebhookResult;
}

/**
 * The partner's system calls JR. Auth = the connection's token in a header the adapter lists, or — for partners that cannot send headers
 * (Shipox, Fastcoo) — as the last path segment (decision I12). Same 401 for "no such connection" and "wrong token".
 */
export async function receiveWebhook(connectionId: string, headers: Headers, body: unknown, ip: string, urlToken?: string | null) {
  await hit(`partner-hook-ip:${ip}`, 600, 60);
  if (!/^[0-9a-f-]{36}$/i.test(connectionId)) throw err("NOT_FOUND"); // before the per-connection limiter: attacker-chosen ids must not create counters
  await hit(`partner-hook:${connectionId}`, 300, 60);
  const [c] = await db.select().from(partnerConnections).where(eq(partnerConnections.id, connectionId));
  if (!c || !c.inboundTokenHash) throw err("UNAUTHENTICATED", "Invalid token");
  const a = getAdapter(c.provider);
  if (!a) throw err("UNAUTHENTICATED", "Invalid token");
  const given = [urlToken, ...a.inboundTokenHeaders.map((h) => headers.get(h)?.replace(/^Bearer\s+/i, "").trim())].filter(Boolean) as string[];
  if (!given.some((g) => tokenOk(g, c.inboundTokenHash!))) throw err("UNAUTHENTICATED", "Invalid token");
  if (c.status !== "active") return { accepted: false, reason: "connection disabled" };
  if (!a.parseWebhook) throw err("VALIDATION", "This system does not send webhooks");
  const parsed = asResult(a.parseWebhook(body, ctxOf(c), headers));
  const orders = (parsed.orders ?? []).slice(0, 50), events = (parsed.events ?? []).slice(0, 50);
  await db.update(partnerConnections).set({ lastEventAt: new Date() }).where(eq(partnerConnections.id, c.id));
  if (!orders.length && !events.length) {
    await recordEvent(c, { direction: "in", kind: "unrecognised", outcome: a.capabilities.mode === "carrier" ? "error" : "ignored", summary: "Payload not recognised" });
    // A carrier partner believes it handed JR an order: answering 200 would silently lose it.
    if (a.capabilities.mode === "carrier") throw err("VALIDATION", "Payload not recognised (or not for this account)", { field: "body" });
    return { accepted: true, matched: 0, orders: [] };
  }
  const out: Array<{ reference: string; awb: string | null; trackingUrl: string | null; labelUrl: string | null; status: "created" | "updated" | "ignored" }> = [];
  // Status events first (they update what JR already knows), then new orders — an import must never pre-empt the event's own status.
  let matched = 0;
  for (const ev of events) matched += await applyInbound(c, a, ev);
  for (const o of orders) {
    const r = await importOrder(c, a, o, "webhook");
    if (r.rejected) throw err("VALIDATION", r.rejected, { field: "city", reference: o.externalRef });
    out.push({ reference: o.externalRef, awb: r.order?.awb ?? null, trackingUrl: r.order?.awb ? trackingUrl(r.order.awb) : null, labelUrl: r.order?.awb ? labelUrl(r.order.awb) : null, status: r.order ? (r.created ? "created" : "updated") : "ignored" });
  }
  return { accepted: true, matched, orders: out };
}

/**
 * One order from the partner. Carrier mode: always imported, JR issues its AWB and says "accepted" (an unserved city is refused, as the
 * carrier contracts require). Merchant mode: imported when the connection imports new orders, else only orders JR already has are updated.
 */
export async function importOrder(c: PartnerConnection, a: Adapter, input: PartnerOrderInput, source: "webhook" | "poll" | "lookup" | "push") {
  const carrier = a.capabilities.mode === "carrier";
  const s = settingsOf(c, a);
  if (!carrier) {
    const [known] = await db.select({ id: partnerOrders.id }).from(partnerOrders).where(and(eq(partnerOrders.connectionId, c.id), sql`lower(${partnerOrders.externalRef}) = ${input.externalRef.trim().toLowerCase()}`));
    if (!known && !s.importNew && source !== "lookup") return { order: null, created: false, rejected: null as string | null };
    // A known order's status belongs to the status events (with their timing rules); an import only enriches its details.
    if (known && source !== "lookup") input = { ...input, status: null, statusAt: null };
    // A webhook announces a package without its recipient: enrich it from the partner before the business sees it.
    if (!known && a.lookup && !input.recipient.name && !input.recipient.phone) {
      try {
        const p = await a.lookup(ctxOf(c), input.externalRef);
        if (p.found) input = { ...input, externalId: input.externalId ?? p.externalId, invoice: input.invoice ?? p.invoice, recipient: { name: p.recipientName, phone: p.recipientPhone, address: p.address, city: p.city, lat: p.lat ?? null, lng: p.lng ?? null }, codAmount: input.codAmount ?? p.codAmount, pieces: p.pieces ?? null, notes: p.notes ?? null, extra: { ...(p.extra ?? {}), ...(input.extra ?? {}) } };
      } catch { /* the business completes what is missing */ }
    }
  }
  const r = await upsertOrder(db, c, a, input, { issueAwb: carrier });
  if (carrier && r.created && !r.cityMatched) {
    await db.delete(partnerOrders).where(eq(partnerOrders.id, r.order.id));
    await recordEvent(c, { direction: "in", kind: "order", outcome: "error", summary: `Refused order ${input.externalRef}: JR does not deliver to "${input.recipient.city ?? "(no city)"}"`, externalId: input.externalRef });
    return { order: null, created: false, rejected: `JR does not deliver to "${input.recipient.city ?? "(no city given)"}"` };
  }
  await recordEvent(c, {
    direction: "in", kind: "order", summary: `${a.label}: order ${input.externalRef} ${r.created ? "received" : "updated"}${r.order.awb ? ` (JR ${r.order.awb})` : ""}${r.order.detailsComplete ? "" : " — details to complete"}`,
    externalId: input.externalRef, partnerOrderId: r.order.id, dedupeKey: r.created ? `order:${r.order.id}` : null,
  });
  if (carrier && r.created) await enqueueOrderEvent(db, c, r.order.id, "accepted");
  if (r.created && source !== "lookup") await notifyNewOrders(c, a, r.order.createdAt); // a lookup is the company's own action
  return { order: r.order, created: r.created, rejected: null as string | null };
}

/**
 * "N new orders are waiting": one notification per connection per hour whose count keeps up while it is unread, so a busy partner
 * never floods the company and the number shown is the real one.
 */
async function notifyNewOrders(c: PartnerConnection, a: Adapter, firstAt: Date) {
  const [recent] = await db.select().from(notifications)
    .where(and(eq(notifications.userId, c.businessId), eq(notifications.type, "partner_orders_new"), sql`${notifications.data}->>'connectionId' = ${c.id}`, sql`${notifications.createdAt} > now() - interval '1 hour'`))
    .orderBy(desc(notifications.createdAt)).limit(1);
  if (recent?.readAt) return; // seen within the hour: the next one comes after it
  const prev = recent ? String((recent.data as { since?: string } | null)?.since ?? recent.createdAt.toISOString()) : firstAt.toISOString();
  const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(partnerOrders).where(and(eq(partnerOrders.connectionId, c.id), sql`${partnerOrders.createdAt} >= ${prev}::timestamptz`));
  const data = { provider: a.label, connection: c.name, connectionId: c.id, n: Math.max(1, Number(n)), since: prev };
  if (recent) await db.update(notifications).set({ data }).where(eq(notifications.id, recent.id));
  else await notify(c.businessId, "partner_orders_new", data);
}

/** Two reports of the same change (webhook + scheduled check, retries) within this window count once. */
const SAME_CHANGE_MS = 120_000;

/**
 * Applies one partner status event: mirror it on the order and the parcel, act on cancellations. Returns the number of parcels touched.
 * Identity of an event = (order, status, time to the second) — the same change reported by a webhook and by the history call, with
 * different fields filled in, is recognised. Effects are applied BEFORE the event is marked as seen, so a crash in between heals on the
 * partner's retry or the next scheduled check (every effect is idempotent).
 */
export async function applyInbound(c: PartnerConnection, a: Adapter, ev0: PartnerEvent): Promise<number> {
  // A partner clock (or payload) in the future would make every later, genuine update look "stale" and freeze the status.
  const ev: PartnerEvent = ev0.at.getTime() > Date.now() + 5 * 60_000 ? { ...ev0, at: new Date() } : ev0;
  const timed = ev.timeKnown !== false;
  const kind = kindFor(c, a, ev.status, ev.kind);
  const refs = [...new Set([ev.barcode, ev.invoice, ev.externalId].filter((v): v is string => !!v).map((v) => v.toLowerCase()))];
  if (!refs.length) return 0;
  const list = sql.join(refs.map((r) => sql`${r}`), sql`, `);
  const upper = sql.join(refs.map((r) => sql`${r.toUpperCase()}`), sql`, `);
  let [order] = await db.select().from(partnerOrders).where(and(eq(partnerOrders.connectionId, c.id), sql`(lower(${partnerOrders.externalRef}) in (${list}) or ${partnerOrders.awb} in (${upper}) or lower(${partnerOrders.externalId}) in (${list}))`)).limit(1);
  const parcelRefs = [...new Set([...refs, ...(order ? [order.externalRef, order.awb].filter((v): v is string => !!v).map((v) => v.toLowerCase()) : [])])];
  const rows = await db.select({ s: shipments, r: requests }).from(shipments).innerJoin(requests, eq(requests.id, shipments.requestId))
    .where(and(eq(requests.businessId, c.businessId), inArray(sql`lower(${shipments.externalRef})`, parcelRefs), sql`(${shipments.partnerId} is null or ${shipments.partnerId} = ${c.id})`))
    .orderBy(desc(shipments.createdAt));
  const label = `${a.label}: ${ev.status}`;
  const refShown = ev.barcode ?? ev.invoice ?? ev.externalId;
  const identity = order?.id ?? refs.sort()[0];
  const key = sha256([c.id, identity, ev.status.toLowerCase(), timed ? Math.floor(ev0.at.getTime() / 1000) : "untimed"].join("|"));
  if (!rows.length && !order) { await recordEvent(c, { direction: "in", kind, outcome: "ignored", summary: `${label} — no order or parcel with reference ${refShown}`, externalId: refShown, payload: ev.summary ?? { status: ev.status }, dedupeKey: key }); return 0; }
  // A parcel linked before v2 has no order row: give it one, so the cancellation path and the echo guard below are the same for all.
  if (!order && rows.length) order = (await upsertOrder(db, c, a, { externalId: ev.externalId, externalRef: rows[0].s.externalRef!, invoice: ev.invoice, recipient: {} })).order;
  // Already seen: the exact key, or the same status reported again shortly before/after (webhook + poll), or an untimed repeat.
  const [seen] = await db.select({ id: partnerEvents.id }).from(partnerEvents).where(and(eq(partnerEvents.connectionId, c.id), eq(partnerEvents.dedupeKey, key))).limit(1);
  const sameAsShown = !!order?.partnerStatus && order.partnerStatus.toLowerCase() === ev.status.toLowerCase()
    && (!timed || !order.partnerStatusAt || Math.abs(order.partnerStatusAt.getTime() - ev.at.getTime()) <= SAME_CHANGE_MS);
  const duplicate = !!seen || sameAsShown;
  // Newer than what JR shows? An untimed event never overrides a timed status; it only fills an empty one.
  const newer = (at: Date | null) => (timed ? !at || at <= ev.at : !at);
  if (!duplicate) {
    if (order && newer(order.partnerStatusAt)) await db.update(partnerOrders).set({ partnerStatus: ev.status, partnerStatusAt: timed ? ev.at : order.partnerStatusAt ?? ev.at, updatedAt: new Date() }).where(eq(partnerOrders.id, order.id));
    for (const { s, r } of rows) {
      await db.transaction(async (tx) => {
        if (newer(s.partnerStatusAt)) await tx.update(shipments).set({ partnerId: c.id, partnerStatus: ev.status, partnerStatusAt: timed ? ev.at : s.partnerStatusAt ?? ev.at }).where(eq(shipments.id, s.id));
        await logEvent(tx, { requestId: r.id, offerId: s.offerId, type: "partner_status", payload: { shipmentId: s.id, code: s.code, externalRef: s.externalRef, provider: a.key, providerLabel: a.label, status: ev.status, kind, note: ev.note } });
      });
    }
  }
  // A cancellation acts unless a NEWER status already superseded it; re-running it is harmless (it checks the order's state), so a
  // replay heals a cancellation that crashed half-way.
  if (kind === "cancelled" && order && order.state !== "cancelled" && (!timed || !order.partnerStatusAt || order.partnerStatusAt <= ev.at || order.partnerStatus?.toLowerCase() === ev.status.toLowerCase())) {
    await cancelFromPartner(c, a, order, ev.note ?? `Cancelled in ${a.label}`, "lenient");
  }
  if (!duplicate) await recordEvent(c, { direction: "in", kind, summary: label + (ev.note ? ` — ${ev.note}` : ""), externalId: refShown, shipmentId: rows[0]?.s.id ?? null, requestId: rows[0]?.r.id ?? null, partnerOrderId: order?.id ?? null, payload: ev.summary ?? { status: ev.status }, dedupeKey: key });
  return rows.length;
}

export type CancelOutcome = "cancelled" | "withdrawn" | "already" | "conflict";
/**
 * The partner cancelled an order. Not in JR yet → it leaves Incoming orders. Waiting at the warehouse in a live JR order → the parcel is
 * withdrawn (and refunded) when auto-cancel is on (carrier APIs: always, the merchant asked explicitly). Already with a driver, or in a
 * draft → a human decides: `strict` (carrier API) refuses and changes nothing; `lenient` (webhook) records it and notifies the business.
 * Order of writes: mark the order "being cancelled by the partner" (the journey hook sees it and never echoes the cancel back), cancel
 * the JR parcel, then mark the order cancelled. A crash in between leaves a state the partner's retry completes.
 */
export async function cancelFromPartner(c: PartnerConnection, a: Adapter, order: PartnerOrder, reason: string, mode: "strict" | "lenient"): Promise<{ outcome: CancelOutcome; message: string }> {
  if (order.state === "cancelled") return { outcome: "already", message: "The order is already cancelled" };
  const live = await liveParcel(db, order.id);
  const why = reason.slice(0, 300);
  const marking = () => db.update(partnerOrders).set({ cancelledBy: "partner", cancelReason: why, updatedAt: new Date() }).where(eq(partnerOrders.id, order.id));
  const markCancelled = () => db.update(partnerOrders).set({ state: "cancelled", cancelledAt: new Date(), cancelReason: why, cancelledBy: "partner", updatedAt: new Date() }).where(eq(partnerOrders.id, order.id));
  const unmark = () => db.update(partnerOrders).set({ cancelledBy: null, cancelReason: null }).where(and(eq(partnerOrders.id, order.id), eq(partnerOrders.state, "open")));
  if (!live) { await markCancelled(); await recordEvent(c, { direction: "in", kind: "cancelled", summary: `${a.label}: order ${order.awb ?? order.externalRef} cancelled before JR scheduled it`, partnerOrderId: order.id, externalId: order.externalRef }); return { outcome: "cancelled", message: "Cancelled" }; }
  const [r] = await db.select().from(requests).where(eq(requests.id, live.requestId));
  const auto = mode === "strict" || settingsOf(c, a).autoCancel;
  if (live.status === "pending" && r && r.status !== "draft" && auto) {
    await marking();
    const [owner] = await db.select().from(users).where(eq(users.id, c.businessId));
    try {
      await cancelShipment(owner, live.id, `Cancelled in ${a.label}${reason ? `: ${reason}` : ""}`.slice(0, 300));
    } catch (e) {
      if (mode === "strict") await unmark();
      await recordEvent(c, { direction: "in", kind: "cancelled", outcome: "error", summary: `Could not withdraw ${live.code}: ${msg(e)}`, partnerOrderId: order.id, shipmentId: live.id, requestId: live.requestId });
      await notify(c.businessId, "partner_cancel_conflict", { requestId: live.requestId, ref: live.requestRef, code: live.code, provider: a.label });
      if (mode === "lenient") await markCancelled();
      return { outcome: "conflict", message: "The parcel could not be withdrawn" };
    }
    await markCancelled();
    await recordEvent(c, { direction: "in", kind: "cancelled", summary: `${a.label}: parcel ${live.code} withdrawn from ${live.requestRef} (refunded)`, partnerOrderId: order.id, shipmentId: live.id, requestId: live.requestId, externalId: order.externalRef });
    return { outcome: "withdrawn", message: "Withdrawn from the JR delivery order" };
  }
  if (mode === "lenient") await markCancelled();
  await recordEvent(c, { direction: "in", kind: "cancelled", outcome: "error", summary: `${a.label} cancelled ${order.awb ?? order.externalRef}, but JR parcel ${live.code} is ${live.status === "pending" ? "in a draft or auto-cancel is off" : `already ${live.status}`} — not withdrawn`, partnerOrderId: order.id, shipmentId: live.id, requestId: live.requestId });
  await notify(c.businessId, "partner_cancel_conflict", { requestId: live.requestId, ref: live.requestRef, code: live.code, provider: a.label });
  return { outcome: "conflict", message: live.status === "pending" ? "The parcel is in a draft JR order — remove it there" : `The parcel is already ${live.status === "loaded" ? "with a JR driver" : live.status} and can no longer be cancelled` };
}
