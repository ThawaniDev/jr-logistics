import { and, eq, inArray, sql } from "drizzle-orm";
import type { Exec, Tx } from "@/db";
import { offers, partnerConnections, partnerOrders, partnerOutbox, requests, shipments, users, type PartnerConnection, type PartnerOrder } from "@/db/schema";
import { logError } from "@/lib/log";
import { syncOn } from "./config";
import { upsertOrder } from "./orders-core";
import { getAdapter } from "./registry";
import type { JrEvent } from "./types";

/**
 * "Everything that happens to a parcel in JR — by the warehouse, staff or the driver — is reflected in the warehouse system" (decision I9).
 * Source of truth: the parcel journey (shipment_events), which every domain action already writes inside its own transaction, plus the
 * driver's route approval. This hook turns those rows into ordered outbox entries for the partner the parcel belongs to.
 * It runs in a savepoint: a bug here is logged, never blocks a driver from delivering.
 */
type JourneyRow = { shipmentId: string; requestId: string; offerId?: string | null; type: string; payload?: Record<string, unknown>; at?: Date };

const JOURNEY: Record<string, JrEvent> = {
  assigned: "assigned", loaded: "picked_up", arrived: "arrived", deferred: "postponed", failed: "failed", delivered: "delivered",
  returned: "returned", missing: "missing", cancelled: "cancelled", reshipped: "reshipped",
};
/** JR-side withdrawals that are not a decision about the warehouse's order (no driver found, request called off …): the order simply goes back to Incoming orders. */
const WITHDRAWN = new Set(["request_cancelled", "unfulfilled", "not_fully_staffed"]);

let kick: ((delayMs?: number) => void) | null = null;
/** The outbox processor registers itself so a fresh event is sent within seconds instead of at the next scheduler tick. */
export const onOutboxQueued = (f: (delayMs?: number) => void) => { kick = f; };

const isTx = (x: Exec): x is Tx => typeof (x as { rollback?: unknown }).rollback === "function";
async function savepoint(x: Exec, label: string, fn: (t: Exec) => Promise<void>) {
  try {
    if (isTx(x)) await x.transaction((sp) => fn(sp));
    else await fn(x);
  } catch (e) { logError(e, { correlationId: `partner-sync:${label}` }); }
}

export async function partnerSyncJourney(x: Exec, rows: JourneyRow[]): Promise<void> {
  const relevant = rows.filter((r) => r.type === "created" || JOURNEY[r.type]);
  if (!relevant.length) return;
  await savepoint(x, "journey", async (t) => {
    const ids = [...new Set(relevant.map((r) => r.shipmentId))];
    const parcels = await t.select().from(shipments).where(and(inArray(shipments.id, ids)));
    const linked = parcels.filter((s) => s.partnerId && s.externalRef);
    if (!linked.length) return;
    const conns = await connectionsFor(t, linked);
    if (!conns.size) return;
    // One query for every order these parcels carry (by connection + reference / AWB), not one per parcel.
    const orders = await ordersFor(t, linked.filter((s) => conns.has(s.partnerId!)));
    const byParcel = new Map(linked.map((s) => [s.id, s]));
    const links: Array<{ orderId: string; shipmentId: string; requestId: string }> = [];
    let queued = 0;
    for (const r of relevant) {
      const s = byParcel.get(r.shipmentId);
      const c = s && conns.get(s.partnerId!);
      if (!s || !c) continue;
      const a = getAdapter(c.provider)!;
      let order = orders.get(`${c.id}|${s.externalRef!.toLowerCase()}`) ?? null;
      if (r.type === "created") {
        // Every partner-linked JR parcel has an order row (manifest typed by hand, imported by lookup, or from Incoming orders).
        if (!order) {
          order = (await upsertOrder(t, c, a, { externalId: null, externalRef: s.externalRef!, recipient: { name: s.recipientName || null, phone: s.recipientPhone || null, address: s.address || null, city: s.city }, codAmount: s.codCents / 100, contents: s.contents, notes: s.notes })).order;
          orders.set(`${c.id}|${s.externalRef!.toLowerCase()}`, order);
        }
        links.push({ orderId: order.id, shipmentId: s.id, requestId: s.requestId });
        continue;
      }
      const ev = JOURNEY[r.type];
      if (!ev || !syncOn(c, a, ev)) continue;
      if (ev === "cancelled") {
        if (WITHDRAWN.has(String(r.payload?.reason ?? "")) || r.payload?.by === "maintenance") continue;
        if (order?.cancelledBy === "partner") continue; // the partner told us (or is telling us right now) — never echo it back
      }
      queued += await enqueue(t, c, { ev, shipmentId: s.id, requestId: s.requestId, orderId: order?.id ?? null, offerId: r.offerId ?? s.offerId, occurrence: occurrence(ev, s, r), at: r.at, note: noteOf(r) });
    }
    // Cached pointer to the newest parcel (display / search only — the live link is always derived).
    for (let i = 0; i < links.length; i += 500) {
      const chunk = links.slice(i, i + 500);
      await t.execute(sql`update partner_orders po set shipment_id = v.sid::uuid, request_id = v.rid::uuid, updated_at = now()
        from (values ${sql.join(chunk.map((l) => sql`(${l.orderId}, ${l.shipmentId}, ${l.requestId})`), sql`, `)}) as v(oid, sid, rid) where po.id = v.oid::uuid`);
    }
    if (queued) kick?.();
  });
}

/** Route approval is an offer-level event: every parcel on board is now out for delivery. */
export async function partnerSyncJobEvent(x: Exec, e: { requestId: string; offerId?: string | null; type: string }): Promise<void> {
  if (e.type !== "route_approved" || !e.offerId) return;
  const offerId = e.offerId;
  await savepoint(x, "route", async (t) => {
    const parcels = (await t.select().from(shipments).where(and(eq(shipments.offerId, offerId), eq(shipments.status, "loaded")))).filter((s) => s.partnerId && s.externalRef);
    if (!parcels.length) return;
    const conns = await connectionsFor(t, parcels);
    const orders = await ordersFor(t, parcels.filter((s) => conns.has(s.partnerId!)));
    let queued = 0;
    for (const s of parcels) {
      const c = conns.get(s.partnerId!);
      if (!c) continue;
      const a = getAdapter(c.provider)!;
      if (!syncOn(c, a, "out_for_delivery")) continue;
      const order = orders.get(`${c.id}|${s.externalRef!.toLowerCase()}`) ?? null;
      queued += await enqueue(t, c, { ev: "out_for_delivery", shipmentId: s.id, requestId: s.requestId, orderId: order?.id ?? null, offerId, occurrence: `${s.id}:${offerId}`, note: null });
    }
    if (queued) kick?.();
  });
}

/** Order-level events that exist before a JR parcel does (carrier mode: "accepted" right after JR answered the partner). */
export async function enqueueOrderEvent(x: Exec, c: PartnerConnection, orderId: string, ev: JrEvent, note: string | null = null, occurrence = orderId): Promise<boolean> {
  const a = getAdapter(c.provider);
  if (!a || !syncOn(c, a, ev)) return false;
  const n = await enqueue(x, c, { ev, shipmentId: null, requestId: null, orderId, offerId: null, occurrence, note });
  if (n) kick?.();
  return n > 0;
}

// ───────── helpers ─────────
type ParcelRow = typeof shipments.$inferSelect;

/** Orders of these parcels keyed "<connectionId>|<lower(parcel externalRef)>" — a parcel's reference is the order's reference or JR's AWB. */
async function ordersFor(t: Exec, parcels: ParcelRow[]) {
  const out = new Map<string, PartnerOrder>();
  if (!parcels.length) return out;
  const pairs = [...new Set(parcels.map((s) => `${s.partnerId}|${s.externalRef!.toLowerCase()}`))];
  for (let i = 0; i < pairs.length; i += 500) {
    const chunk = pairs.slice(i, i + 500).map((p) => p.split("|") as [string, string]);
    const rows = await t.select().from(partnerOrders).where(sql`(${partnerOrders.connectionId}, lower(${partnerOrders.externalRef})) in (${sql.join(chunk.map(([c, r]) => sql`(${c}::uuid, ${r})`), sql`, `)})
      or (${partnerOrders.connectionId}, ${partnerOrders.awb}) in (${sql.join(chunk.map(([c, r]) => sql`(${c}::uuid, ${r.toUpperCase()})`), sql`, `)})`);
    for (const o of rows) { out.set(`${o.connectionId}|${o.externalRef.toLowerCase()}`, o); if (o.awb) out.set(`${o.connectionId}|${o.awb.toLowerCase()}`, o); }
  }
  return out;
}

/** Connections of these parcels that belong to the parcel's request owner and are active (a foreign partnerId is never honoured). */
async function connectionsFor(t: Exec, parcels: ParcelRow[]) {
  const reqIds = [...new Set(parcels.map((s) => s.requestId))];
  const owners = new Map((await t.select({ id: requests.id, b: requests.businessId }).from(requests).where(inArray(requests.id, reqIds))).map((r) => [r.id, r.b]));
  const rows = await t.select().from(partnerConnections).where(and(inArray(partnerConnections.id, [...new Set(parcels.map((s) => s.partnerId!))]), eq(partnerConnections.status, "active")));
  const out = new Map<string, PartnerConnection>();
  for (const c of rows) if (parcels.some((s) => s.partnerId === c.id && owners.get(s.requestId) === c.businessId) && getAdapter(c.provider)) out.set(c.id, c);
  return out;
}

/** One key per real-world occurrence: terminal events once per parcel, offer-scoped ones once per driver job, attempts once each. */
function occurrence(ev: JrEvent, s: ParcelRow, r: JourneyRow): string {
  const offer = r.offerId ?? s.offerId ?? "pool";
  switch (ev) {
    case "assigned": case "picked_up": return `${s.id}:${offer}`;
    case "failed": return `${s.id}:${s.attempts}`;
    case "postponed": return `${s.id}:${s.deferCount}`;
    case "arrived": return `${s.id}:${offer}:${s.attempts}:${s.deferCount}`;
    default: return s.id;
  }
}
const noteOf = (r: JourneyRow) => { const p = r.payload ?? {}; const v = p.note ?? p.reason ?? p.why ?? p.resolution ?? null; return typeof v === "string" ? v.slice(0, 300) : null; };

async function enqueue(t: Exec, c: PartnerConnection, j: { ev: JrEvent; shipmentId: string | null; requestId: string | null; orderId: string | null; offerId: string | null | undefined; occurrence: string; at?: Date; note: string | null }): Promise<number> {
  let driver: string | null = null;
  if (j.offerId) {
    const [d] = await t.select({ name: users.name }).from(offers).innerJoin(users, eq(users.id, offers.driverId)).where(eq(offers.id, j.offerId));
    driver = d?.name ?? null;
  }
  const made = await t.insert(partnerOutbox).values({
    connectionId: c.id, businessId: c.businessId, shipmentId: j.shipmentId, requestId: j.requestId, partnerOrderId: j.orderId, action: j.ev,
    dedupeKey: `${j.ev}:${j.occurrence}`, payload: { at: (j.at ?? new Date()).toISOString(), note: j.note, driver },
  }).onConflictDoNothing().returning({ id: partnerOutbox.id });
  return made.length;
}
