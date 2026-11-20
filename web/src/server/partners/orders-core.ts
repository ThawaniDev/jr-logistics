import { and, eq, sql } from "drizzle-orm";
import { db, type Exec } from "@/db";
import { partnerOrders, type PartnerConnection, type PartnerOrder } from "@/db/schema";
import { normalizePhone } from "@/lib/phone";
import { getSettings } from "../settings";
import { matchCity } from "./cities";
import { newAwb } from "./crypto";
import type { Adapter, PartnerOrderInput } from "./types";

// No imports of stops / requests / events here: the parcel-journey hook (sync.ts) uses this file inside domain transactions.

const clean = (v: string | null | undefined, max: number) => { const t = (v ?? "").replace(/\s+/g, " ").trim(); return t ? t.slice(0, max) : null; };
/** Partners send "0551234567", "966551234567", "+9665…", "9711…" — JR stores E.164 when it can, the raw value otherwise (then details are incomplete). */
export function partnerPhone(raw: string | null | undefined): { phone: string | null; valid: boolean } {
  const v = clean(raw, 40);
  if (!v) return { phone: null, valid: false };
  const n = normalizePhone(v) ?? (/^\d{11,15}$/.test(v.replace(/[\s-]/g, "")) ? normalizePhone(`+${v.replace(/[\s-]/g, "")}`) : null);
  return n ? { phone: n, valid: true } : { phone: v, valid: false };
}

/** Live JR parcel of an order: the newest parcel of this connection that carries the order's reference (or JR AWB) and is not cancelled. */
export const LIVE_PARCEL_SQL = sql`left join lateral (
  select s.id as s_id, s.code as s_code, s.status as s_status, s.request_id as s_request_id, s.delivered_at as s_delivered_at, s.failed_at as s_failed_at,
         s.fail_reason as s_fail_reason, s.offer_id as s_offer_id, r.ref as r_ref, r.status as r_status
  from shipments s join requests r on r.id = s.request_id
  where s.partner_id = po.connection_id and r.business_id = po.business_id
    and lower(s.external_ref) in (lower(po.external_ref), lower(coalesce(po.awb, po.external_ref)))
    and s.status <> 'cancelled' and r.status not in ('cancelled', 'expired')
  order by s.created_at desc limit 1) cur on true`;

export interface UpsertResult { order: PartnerOrder; created: boolean; cityMatched: boolean }

/**
 * Creates or enriches an incoming order. Identity = (connection, externalRef). Values the partner did not send never erase what JR already
 * knows. Carrier-mode partners get a JR tracking number (AWB) the first time.
 */
export async function upsertOrder(x: Exec, c: Pick<PartnerConnection, "id" | "businessId" | "provider">, a: Adapter, input: PartnerOrderInput, o: { issueAwb?: boolean } = {}): Promise<UpsertResult> {
  const externalRef = clean(input.externalRef, 80);
  if (!externalRef) throw new Error("order without reference");
  const settings = await getSettings(x === db ? db : x);
  const cityKey = matchCity(input.recipient.city ?? null, settings.cities.filter((k) => k.delivery));
  const { phone } = partnerPhone(input.recipient.phone);
  const cod = input.codAmount == null ? null : Math.max(0, Math.round(Number(input.codAmount) * 100));
  const fields = {
    externalId: clean(input.externalId, 120), invoice: clean(input.invoice, 120),
    recipientName: clean(input.recipient.name, 120), recipientPhone: phone, recipientEmail: clean(input.recipient.email, 160),
    address: clean(input.recipient.address, 300), cityRaw: clean(input.recipient.city, 80), city: cityKey,
    lat: input.recipient.lat ?? null, lng: input.recipient.lng ?? null,
    codCents: cod != null && Number.isFinite(cod) ? cod : null, currency: clean(input.currency, 8), pieces: input.pieces != null && Number.isFinite(Number(input.pieces)) ? Math.max(0, Math.round(Number(input.pieces))) : null,
    weightGrams: input.weightKg != null && Number.isFinite(Number(input.weightKg)) ? Math.round(Number(input.weightKg) * 1000) : null,
    contents: clean(input.contents, 300), notes: clean(input.notes, 500),
    pickup: input.pickup && Object.values(input.pickup).some((v) => v != null && v !== "") ? input.pickup : null,
    items: input.items?.length ? input.items.slice(0, 100) : null, slot: input.slot ?? null,
    // No partner timestamp = unknown time (null), never "now": a later real update from the partner must not look stale.
    partnerStatus: clean(input.status, 80), partnerStatusAt: input.status ? input.statusAt ?? null : null,
  };
  const [existing] = await x.select().from(partnerOrders).where(and(eq(partnerOrders.connectionId, c.id), sql`lower(${partnerOrders.externalRef}) = ${externalRef.toLowerCase()}`));
  const lat = fields.lat, lng = fields.lng;
  const coords = lat != null && lng != null && Math.abs(lat) <= 90 && Math.abs(lng) <= 180 && !(lat === 0 && lng === 0);
  if (existing) {
    // Enrich only: keep everything the partner did not send this time.
    const patch: Partial<PartnerOrder> = {};
    for (const [k, v] of Object.entries(fields)) if (v != null) (patch as Record<string, unknown>)[k] = v;
    if (!coords) { delete patch.lat; delete patch.lng; }
    // A status without a time, or older than the one JR already shows, never replaces it.
    if (patch.partnerStatus && existing.partnerStatus && (!fields.partnerStatusAt || (existing.partnerStatusAt && fields.partnerStatusAt < existing.partnerStatusAt))) { delete patch.partnerStatus; delete patch.partnerStatusAt; }
    if (input.extra) patch.extra = { ...((existing.extra ?? {}) as object), ...input.extra };
    const merged = { ...existing, ...patch };
    patch.detailsComplete = !!(merged.recipientName && merged.recipientPhone && partnerPhone(merged.recipientPhone).valid && merged.address && merged.city);
    if (o.issueAwb && !existing.awb) patch.awb = await freeAwb(x);
    const [u] = await x.update(partnerOrders).set({ ...patch, updatedAt: new Date() }).where(eq(partnerOrders.id, existing.id)).returning();
    return { order: u, created: false, cityMatched: !!u.city };
  }
  const row = {
    connectionId: c.id, businessId: c.businessId, provider: c.provider, externalRef, ...fields,
    lat: coords ? lat : null, lng: coords ? lng : null, extra: input.extra ?? null,
    detailsComplete: !!(fields.recipientName && phone && partnerPhone(phone).valid && fields.address && cityKey),
  };
  for (let attempt = 0; attempt < 5; attempt++) {
    const awb = o.issueAwb ? newAwb() : null;
    const made = await x.insert(partnerOrders).values({ ...row, awb }).onConflictDoNothing().returning();
    if (made.length) return { order: made[0], created: true, cityMatched: !!cityKey };
    // Either the same order arrived concurrently (→ return it) or the random AWB collided (→ try another number).
    const [again] = await x.select().from(partnerOrders).where(and(eq(partnerOrders.connectionId, c.id), sql`lower(${partnerOrders.externalRef}) = ${externalRef.toLowerCase()}`));
    if (again) return { order: again, created: false, cityMatched: !!again.city };
  }
  throw new Error("could not allocate a tracking number");
}

async function freeAwb(x: Exec): Promise<string> {
  for (let i = 0; i < 5; i++) {
    const awb = newAwb();
    const [hit] = await x.select({ id: partnerOrders.id }).from(partnerOrders).where(eq(partnerOrders.awb, awb));
    if (!hit) return awb;
  }
  throw new Error("could not allocate a tracking number");
}

/** The order a JR parcel carries (by connection + reference, the reference being the partner's or JR's AWB). */
export async function orderForParcel(x: Exec, connectionId: string, externalRef: string): Promise<PartnerOrder | null> {
  const ref = externalRef.toLowerCase();
  const [o] = await x.select().from(partnerOrders).where(and(eq(partnerOrders.connectionId, connectionId), sql`(lower(${partnerOrders.externalRef}) = ${ref} or ${partnerOrders.awb} = ${ref.toUpperCase()})`)).limit(1);
  return o ?? null;
}

export async function orderByAwb(x: Exec, awb: string): Promise<PartnerOrder | null> {
  const [o] = await x.select().from(partnerOrders).where(eq(partnerOrders.awb, awb.trim().toUpperCase())).limit(1); // AWBs are issued upper-case
  return o ?? null;
}

/** Live parcel + request of one order (see LIVE_PARCEL_SQL). */
export interface LiveParcel { id: string; code: string; status: string; requestId: string; requestRef: string; requestStatus: string; deliveredAt: Date | null; failedAt: Date | null; failReason: string | null; offerId: string | null }
export async function liveParcel(x: Exec, orderId: string): Promise<LiveParcel | null> {
  const r = await x.execute(sql`select cur.* from partner_orders po ${LIVE_PARCEL_SQL} where po.id = ${orderId}`);
  const row = (r.rows?.[0] ?? null) as Record<string, unknown> | null;
  return row && row.s_id ? liveFrom(row) : null;
}
export const liveFrom = (row: Record<string, unknown>): LiveParcel => ({
  id: String(row.s_id), code: String(row.s_code), status: String(row.s_status), requestId: String(row.s_request_id), requestRef: String(row.r_ref), requestStatus: String(row.r_status),
  deliveredAt: row.s_delivered_at ? new Date(String(row.s_delivered_at)) : null, failedAt: row.s_failed_at ? new Date(String(row.s_failed_at)) : null,
  failReason: (row.s_fail_reason as string) ?? null, offerId: (row.s_offer_id as string) ?? null,
});

/** What the business sees an order as. */
export type OrderState = "open" | "in_jr" | "delivered" | "undelivered" | "cancelled";
export function orderState(o: Pick<PartnerOrder, "state">, live: Pick<LiveParcel, "status"> | null): OrderState {
  if (o.state === "cancelled") return "cancelled";
  if (!live) return "open";
  if (live.status === "delivered") return "delivered";
  if (["failed", "returned", "missing"].includes(live.status)) return "undelivered";
  return "in_jr";
}

/** Delivery attempts over every JR parcel that carried this order (a re-shipped order keeps counting), and the first attempt's time. */
export async function orderAttempts(connectionId: string, o: Pick<PartnerOrder, "externalRef" | "awb">, x: Exec = db) {
  const refs = [o.externalRef, o.awb].filter((v): v is string => !!v).map((v) => v.toLowerCase());
  const [r] = (await x.execute(sql`select coalesce(sum(attempts), 0)::int as total, min(least(coalesce(failed_at, delivered_at), coalesce(delivered_at, failed_at))) as first
    from shipments where partner_id = ${connectionId} and lower(external_ref) in (${sql.join(refs.map((x) => sql`${x}`), sql`, `)})`)).rows as Array<{ total: number; first: string | null }>;
  return { total: Number(r?.total ?? 0), first: r?.first ? new Date(r.first) : null };
}

