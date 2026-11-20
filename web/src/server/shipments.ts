import { and, asc, eq, inArray, isNull, or, sql } from "drizzle-orm";
import { createHmac, timingSafeEqual } from "node:crypto";
import { db, type Exec } from "@/db";
import { shipments, offers, requests, users, businessProfiles, type Shipment, type Offer, type Request, type User } from "@/db/schema";
import { err } from "@/lib/errors";
import { env } from "@/lib/env";
import { normalizePhone } from "@/lib/phone";
import { RECIPIENT_TYPES, MAX_SHIPMENTS_PER_REQUEST, type RecipientType } from "./catalog";
import { getSettings } from "./settings";
import { logEvent } from "./events";
import { signingSecret, activeSmsProvider, sendSms } from "./auth/otp";
import { logMessage, maskPhone as maskForLog } from "./data-capture"; // every SMS is recorded in the message log (masked recipient)
import { batchOf, recordShipmentEvents, type ShipEvt } from "./shipment-events";
import { can } from "./auth/permissions";

/**
 * Per-shipment domain core. Deliberately free of imports from requests/jobs/matching so every one of them can use it.
 * The driver-facing step-by-step flow lives in stops.ts.
 */

export interface ShipmentInput {
  recipientType?: RecipientType | null;
  /** Required unless the order was booked "details later" (`allowIncomplete`): then any of name / phone / address may be missing, but whatever IS given must be valid. */
  recipientName?: string | null; recipientPhone?: string | null; address?: string | null; city?: string | null;
  lat?: number | null; lng?: number | null; contents?: string | null; notes?: string | null; externalRef?: string | null;
  /** Cash the driver collects from the recipient on delivery, in halalas (0 / absent = prepaid). */
  codCents?: number | null;
  partnerId?: string | null; // the warehouse-system connection the order was imported from (verified against the owner before it is ever used)
}

export const MAX_COD_CENTS = 10_000_000; // SAR 100,000 per parcel
const clean = (v: string | null | undefined, max: number) => { const t = (v ?? "").trim().replace(/\s+/g, " "); return t ? t.slice(0, max) : null; };

/**
 * Validates a manifest and returns normalised rows. Every error names the row so a 500-line sheet is fixable.
 * `allowIncomplete` (the warehouse booked "details later"): name / phone / address may be left out — the parcel is stored as a placeholder
 * (`detailsComplete: false`) and must be completed before hand-over. A value that IS given is still fully validated, so a typo never silently becomes a placeholder.
 */
/**
 * J3 — what to do with `recipientType: "business"` while the platform has B2B shipments switched off (`b2bShipmentsEnabled = false`):
 * `reject` (default) → `422 B2B_DISABLED`; `coerce` → store it as a consumer parcel (partner / public-API imports: an import is never failed for this,
 * the count goes into `report.coerced`); `keep` → let it through (editing a parcel that already is a business parcel). With B2B on, nothing changes.
 */
export interface B2bOpts { b2b?: "reject" | "coerce" | "keep"; report?: { coerced: number } }
export async function prepareManifest(items: ShipmentInput[], deliveryCity: string, x: Exec = db, opts: { allowIncomplete?: boolean } & B2bOpts = {}) {
  if (!Array.isArray(items) || items.length === 0) throw err("VALIDATION", "Add at least one shipment", { field: "shipments" });
  if (items.length > MAX_SHIPMENTS_PER_REQUEST) throw err("VALIDATION", `A request can hold at most ${MAX_SHIPMENTS_PER_REQUEST} shipments`, { field: "shipments", max: MAX_SHIPMENTS_PER_REQUEST });
  const s = await getSettings(x);
  const later = !!opts.allowIncomplete;
  const seenRefs = new Map<string, number>();
  let coerced = 0;
  const out = items.map((it, i) => {
    const row = i + 1;
    // `shipments.<i>.<field>` is both the `field` detail and its own key, so clients can map either shape (zod issues use the key form).
    const bad = (field: string, message: string) => err("VALIDATION", `Shipment ${row}: ${message}`, { field: `shipments.${i}.${field}`, [`shipments.${i}.${field}`]: message, row });
    let type = (it.recipientType ?? "consumer") as RecipientType;
    if (!(RECIPIENT_TYPES as readonly string[]).includes(type)) throw bad("recipientType", "recipient type must be consumer or business");
    if (type === "business" && !s.b2bShipmentsEnabled && opts.b2b !== "keep") {
      if (opts.b2b === "coerce") { type = "consumer"; coerced++; }
      else throw err("B2B_DISABLED", `Shipment ${row}: business shipments are turned off — every parcel goes to a consumer`, { field: "recipientType", path: `shipments.${i}.recipientType`, [`shipments.${i}.recipientType`]: "business shipments are turned off", row });
    }
    const name = clean(it.recipientName, 120);
    if (!name) { if (!later) throw bad("recipientName", "recipient name is required"); }
    else if (name.length < 2) throw bad("recipientName", "recipient name is too short");
    const phoneRaw = (it.recipientPhone ?? "").trim();
    const phone = phoneRaw ? normalizePhone(phoneRaw) : null;
    if (!phoneRaw) { if (!later) throw bad("recipientPhone", "recipient phone is not a valid mobile number"); }
    else if (!phone) throw bad("recipientPhone", "recipient phone is not a valid mobile number");
    const address = clean(it.address, 300);
    if (!address) { if (!later) throw bad("address", "delivery address is required"); }
    else if (address.length < 5) throw bad("address", "delivery address is required");
    const city = it.city ? it.city : deliveryCity;
    if (!s.cities.find((c) => c.key === city && c.delivery)) throw bad("city", "city is not supported");
    // One request = one delivery city: a parcel for another city would break every other customer's time slot (decision C5).
    if (city !== deliveryCity) throw bad("city", "is outside this request's delivery city — create a separate request for it");
    if ((it.lat == null) !== (it.lng == null)) throw bad("lat", "give both latitude and longitude, or neither");
    if (it.lat != null && (it.lat < -90 || it.lat > 90 || it.lng! < -180 || it.lng! > 180)) throw bad("lat", "coordinates are out of range");
    const cod = it.codCents ?? 0;
    if (!Number.isInteger(cod) || cod < 0 || cod > MAX_COD_CENTS) throw bad("codCents", "cash on delivery must be between 0 and SAR 100,000");
    const externalRef = clean(it.externalRef, 80);
    if (externalRef) {
      const first = seenRefs.get(externalRef.toLowerCase());
      if (first) throw bad("externalRef", `order reference "${externalRef}" repeats row ${first}`);
      seenRefs.set(externalRef.toLowerCase(), row);
    }
    return {
      recipientType: type, recipientName: name ?? "", recipientPhone: phone ?? "", address: address ?? "", city, lat: it.lat ?? null, lng: it.lng ?? null,
      geoSource: it.lat != null ? "given" : null, detailsComplete: !!(name && phone && address),
      codCents: cod, contents: clean(it.contents, 300), notes: clean(it.notes, 500), externalRef, partnerId: externalRef && it.partnerId ? it.partnerId : null,
    };
  });
  if (opts.report) opts.report.coerced += coerced;
  return out;
}

export const shipmentCode = (ref: string, seq: number) => `${ref}-${String(seq).padStart(3, "0")}`;

/** Replace a DRAFT's manifest. */
export async function saveManifest(tx: Exec, r: Pick<Request, "id" | "ref" | "deliveryCity">, items: ShipmentInput[], opts: { allowIncomplete?: boolean; actor?: ShipEvt["actor"] } & B2bOpts = {}) {
  const rows = await prepareManifest(items, r.deliveryCity, tx, opts);
  // A parcel may only be linked to a warehouse-system connection of the request's own company (never another company's).
  const linkIds = [...new Set(rows.map((row) => row.partnerId).filter((v): v is string => !!v))];
  if (linkIds.length) {
    const owned = new Set(((await tx.execute(sql`select pc.id from partner_connections pc join requests q on q.business_id = pc.business_id where q.id = ${r.id} and pc.id in (${sql.join(linkIds.map((i) => sql`${i}::uuid`), sql`, `)})`)).rows as Array<{ id: string }>).map((x) => x.id));
    for (const row of rows) if (row.partnerId && !owned.has(row.partnerId)) row.partnerId = null;
  }
  await tx.delete(shipments).where(eq(shipments.requestId, r.id));
  const CHUNK = 500;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const made = await tx.insert(shipments).values(rows.slice(i, i + CHUNK).map((row, j) => ({ ...row, requestId: r.id, seq: i + j + 1, code: shipmentCode(r.ref, i + j + 1) }))).returning({ id: shipments.id, seq: shipments.seq, code: shipments.code, detailsComplete: shipments.detailsComplete });
    await recordShipmentEvents(tx, made.map((m) => ({ shipmentId: m.id, requestId: r.id, type: "created" as const, actor: opts.actor ?? null, payload: { seq: m.seq, code: m.code, ...(m.detailsComplete ? {} : { incomplete: true }) } })));
  }
  return rows.length;
}

export async function manifestCount(x: Exec, requestId: string) {
  const [r] = await x.select({ n: sql<number>`count(*)::int` }).from(shipments).where(eq(shipments.requestId, requestId));
  return r?.n ?? 0;
}
/** Parcels whose recipient details are still to come (booked by count only). */
export async function incompleteCount(x: Exec, requestId: string) {
  const [r] = await x.select({ n: sql<number>`count(*)::int` }).from(shipments).where(and(eq(shipments.requestId, requestId), eq(shipments.detailsComplete, false), inArray(shipments.status, ["pending", "loaded"])));
  return r?.n ?? 0;
}
/** Parcels nobody carries yet. */
export async function poolSize(x: Exec, requestId: string) {
  const [r] = await x.select({ n: sql<number>`count(*)::int` }).from(shipments).where(and(eq(shipments.requestId, requestId), isNull(shipments.offerId), eq(shipments.status, "pending")));
  return r?.n ?? 0;
}
/** A request with a manifest runs the per-shipment flow; older bulk requests (no rows) keep the count-based flow. */
export const isManifestJob = async (x: Exec, requestId: string) => (await manifestCount(x, requestId)) > 0;

/** Slot shape for N parcels with at most `perDriver` each; balanced so no driver is left with a token load. */
export function slotShape(n: number, perDriver: number) {
  const per = Math.max(1, Math.floor(perDriver));
  const quantity = Math.max(1, Math.ceil(n / per));
  return { quantity, shipmentsPerDriver: Math.ceil(n / quantity) };
}

// ───────── Allocation ─────────
/** Keep an offer's booked units equal to the parcels it really carries — escrow, earnings and refunds all derive from this. */
export async function syncOfferUnits(tx: Exec, offerId: string, providerCostCents: number) {
  const [{ n }] = await tx.select({ n: sql<number>`count(*)::int` }).from(shipments).where(eq(shipments.offerId, offerId));
  await tx.update(offers).set({ expectedUnits: n, expectedEarningCents: providerCostCents * n, updatedAt: new Date() }).where(eq(offers.id, offerId));
  return n;
}

/**
 * Called when a driver wins a slot: hand them their share of the pool. Share = pool ÷ remaining slots (rounded up),
 * so drivers always receive balanced, contiguous blocks of the manifest, and a replacement receives exactly what is left.
 * `slotsLeft` includes the slot being filled.
 */
export async function allocateToOffer(tx: Exec, r: Request, o: Offer, slotsLeft: number, actor?: ShipEvt["actor"]) {
  const pool = await tx.select({ id: shipments.id }).from(shipments)
    .where(and(eq(shipments.requestId, r.id), isNull(shipments.offerId), eq(shipments.status, "pending"))).orderBy(asc(shipments.seq)).for("update");
  if (!pool.length) throw err("SLOT_TAKEN", "All shipments of this request are already covered");
  // Balanced share, never more than the vehicle plan allows; anything beyond stays in the pool (re-shippable) rather than overloading a driver.
  const take = pool.slice(0, Math.min(Math.ceil(pool.length / Math.max(1, slotsLeft)), r.shipmentsPerDriver ?? pool.length)).map((p) => p.id);
  await tx.execute(sql`update shipments s set offer_id = ${o.id}, stop_order = x.rn, updated_at = now()
    from (select id, row_number() over (order by seq) rn from shipments where id in (${sql.join(take.map((id) => sql`${id}`), sql`, `)})) x where s.id = x.id`);
  const snap = r.pricingSnapshot as { providerCostCents: number } | null;
  await syncOfferUnits(tx, o.id, snap?.providerCostCents ?? 0);
  await recordShipmentEvents(tx, batchOf(take, r.id, "assigned", { offerId: o.id, actor, payload: { driverId: o.driverId } }));
  await logEvent(tx, { requestId: r.id, offerId: o.id, type: "shipments_allocated", payload: { count: take.length } });
  return take.length;
}

/** Normalises what a scanner or a keyboard produced. */
export const normalizeScan = (v: string) => (v ?? "").trim().replace(/\s+/g, "").toUpperCase();

/** A scan matches the parcel's own code, the warehouse's order reference, or just the manifest number ("7" / "007"). */
export function scanMatches(s: Pick<Shipment, "code" | "externalRef" | "seq">, raw: string) {
  const v = normalizeScan(raw);
  if (!v) return false;
  if (v === s.code.toUpperCase()) return true;
  if (s.externalRef && v === normalizeScan(s.externalRef)) return true;
  return /^\d{1,4}$/.test(v) && Number(v) === s.seq;
}

/**
 * The warehouse hands parcels to the driver: only the scanned/selected ones are loaded. Anything assigned but not handed over
 * goes back to the pool (so a replacement or a later slot can still take it) and stops counting against this driver.
 */
export async function markLoaded(tx: Exec, r: Request, o: Offer, sel: { codes?: string[]; all?: boolean }, actor?: ShipEvt["actor"]) {
  const cand = await tx.select().from(shipments).where(and(eq(shipments.requestId, r.id), or(eq(shipments.offerId, o.id), isNull(shipments.offerId)), inArray(shipments.status, ["pending", "loaded"]))).orderBy(asc(shipments.seq));
  const mine = cand.filter((s) => s.offerId === o.id);
  let chosen: Shipment[];
  if (sel.all) chosen = mine;
  else {
    const codes = [...new Set((sel.codes ?? []).map(normalizeScan).filter(Boolean))];
    if (!codes.length) throw err("VALIDATION", "Scan or select the shipments you are handing over", { field: "codes" });
    const unknown: string[] = [];
    const set = new Map<string, Shipment>();
    for (const c of codes) {
      const hit = cand.find((s) => scanMatches(s, c));
      if (hit) set.set(hit.id, hit); else unknown.push(c);
    }
    if (unknown.length) throw err("VALIDATION", "Some codes do not belong to this request", { field: "codes", unknown });
    chosen = [...set.values()].sort((a, b) => a.seq - b.seq);
  }
  if (!chosen.length) throw err("VALIDATION", "Select at least one shipment to hand over", { field: "codes" });
  // A parcel booked "details later" cannot leave the warehouse until its recipient, phone and address are filled in — the driver, the recipient's code and the route all need them.
  const incomplete = chosen.filter((c) => !c.detailsComplete);
  if (incomplete.length) throw err("DETAILS_INCOMPLETE", `${incomplete.length} parcel(s) still miss recipient details — complete them before hand-over`, { count: incomplete.length, codes: incomplete.slice(0, 50).map((c) => c.code) });
  const now = new Date();
  const chosenIds = chosen.map((c) => c.id);
  await tx.execute(sql`update shipments s set offer_id = ${o.id}, status = 'loaded', loaded_at = coalesce(s.loaded_at, now()), loaded_via = coalesce(s.loaded_via, 'warehouse'), stop_order = x.rn, updated_at = now()
    from (select id, row_number() over (order by seq) rn from shipments where id in (${sql.join(chosenIds.map((id) => sql`${id}`), sql`, `)})) x where s.id = x.id`);
  const rest = mine.filter((s) => !chosenIds.includes(s.id));
  if (rest.length) await tx.update(shipments).set({ offerId: null, stopOrder: null, status: "pending", updatedAt: now }).where(inArray(shipments.id, rest.map((s) => s.id)));
  const snap = r.pricingSnapshot as { providerCostCents: number } | null;
  await syncOfferUnits(tx, o.id, snap?.providerCostCents ?? 0);
  await recordShipmentEvents(tx, [
    ...chosen.map((c, i) => ({ shipmentId: c.id, requestId: r.id, offerId: o.id, type: "loaded" as const, actor, payload: { via: "warehouse", code: c.code, stopOrder: i + 1 } })),
    ...batchOf(rest.map((s) => s.id), r.id, "unassigned", { offerId: o.id, actor, payload: { why: "not_handed_over" } }),
  ]);
  return { loaded: chosen.length, released: rest.length };
}

/**
 * A job ends without the driver finishing it (cancel before loading, replacement, no-show). Parcels still at the warehouse
 * return to the pool; parcels already handed over come back as failed so they are accounted for, never silently lost.
 */
export async function releaseOfferShipments(tx: Exec, o: Pick<Offer, "id" | "requestId">, why: string, opts: { loadedToPool?: boolean } = {}) {
  const now = new Date();
  // `loadedToPool`: nothing was delivered yet, so the driver simply brings everything back and a replacement loads afresh.
  const back = await tx.update(shipments).set({ offerId: null, stopOrder: null, status: "pending", loadedAt: null, notifiedAt: null, updatedAt: now })
    .where(and(eq(shipments.offerId, o.id), inArray(shipments.status, opts.loadedToPool ? ["pending", "loaded"] : ["pending"]))).returning({ id: shipments.id });
  const out = await tx.update(shipments).set({ status: "failed", failReason: why, failedAt: now, updatedAt: now })
    .where(and(eq(shipments.offerId, o.id), eq(shipments.status, "loaded"))).returning({ id: shipments.id });
  await recordShipmentEvents(tx, [...batchOf(back.map((b) => b.id), o.requestId, "unassigned", { offerId: o.id, payload: { why } }), ...batchOf(out.map((b) => b.id), o.requestId, "failed", { offerId: o.id, payload: { reason: why, system: true } })]);
  if (back.length || out.length) await logEvent(tx, { requestId: o.requestId, offerId: o.id, type: "shipments_released", payload: { why, toPool: back.length, toReturn: out.length } });
  return { toPool: back.length, toReturn: out.length };
}

/** Counters used by every view / gate. */
export async function offerShipmentStats(x: Exec, offerIds: string[]) {
  const out = new Map<string, { total: number; pending: number; loaded: number; delivered: number; failed: number; returned: number; missing: number }>();
  if (!offerIds.length) return out;
  const rows = await x.select({ o: shipments.offerId, s: shipments.status, n: sql<number>`count(*)::int` }).from(shipments).where(inArray(shipments.offerId, offerIds)).groupBy(shipments.offerId, shipments.status);
  for (const id of offerIds) out.set(id, { total: 0, pending: 0, loaded: 0, delivered: 0, failed: 0, returned: 0, missing: 0 });
  for (const r of rows) {
    const e = out.get(r.o!)!;
    e.total += r.n;
    if (r.s in e) (e as unknown as Record<string, number>)[r.s] += r.n;
  }
  return out;
}

// ───────── Delivery code (OTP) ─────────
/** The 4-digit code is derived, never stored: HMAC(secret, shipment id + version). Bumping the version retires the old code. */
export function otpFor(s: Pick<Shipment, "id" | "otpVersion">) {
  const h = createHmac("sha256", signingSecret()).update(`dlv:${s.id}:${s.otpVersion}`).digest();
  return String(h.readUInt32BE(0) % 10000).padStart(4, "0");
}
export function otpMatches(s: Pick<Shipment, "id" | "otpVersion">, given: string) {
  const a = Buffer.from(otpFor(s)), b = Buffer.from((given ?? "").trim());
  return a.length === b.length && timingSafeEqual(a, b);
}
export const OTP_MAX_ATTEMPTS = 5;
export const OTP_MAX_RESENDS = 3;

/**
 * The recipient's tracking link. With the recipient's phone it carries only its LAST FOUR digits (`?p=`), so the page opens straight
 * on their parcel in one tap; the full number never appears in a URL, a log or an SMS.
 */
export const trackingUrl = (code: string, recipientPhone?: string | null) => {
  const last4 = (recipientPhone ?? "").replace(/\D/g, "").slice(-4);
  return `${env.appUrl.replace(/\/$/, "")}/track/${encodeURIComponent(code)}${/^\d{4}$/.test(last4) ? `?p=${last4}` : ""}`;
};

/**
 * SMS the recipient their one-time code and tracking link. Runs AFTER the transaction commits and never throws:
 * a provider outage must not block a delivery that is happening right now (the driver can resend, and ops can see the failure).
 */
export async function sendRecipientCodes(ids: string[], opts: { force?: boolean } = {}) {
  if (!ids.length) return 0;
  let sent = 0;
  const rows = await db.select({ s: shipments, r: requests, b: businessProfiles.companyName, bn: users.name }).from(shipments)
    .innerJoin(requests, eq(requests.id, shipments.requestId)).innerJoin(users, eq(users.id, requests.businessId))
    .leftJoin(businessProfiles, eq(businessProfiles.userId, requests.businessId)).where(inArray(shipments.id, ids));
  const provider = activeSmsProvider();
  const { effectiveOps } = await import("./warehouse");
  const opsOf = new Map<string, boolean>(); // businessId → delivery OTP required
  for (const { s, r, b, bn } of rows) {
    if (s.status !== "loaded" || (s.notifiedAt && !opts.force)) continue;
    try {
      if (!provider) { await logMessage({ channel: "sms", type: "recipient_code", recipient: maskForLog(s.recipientPhone), requestId: r.id, shipmentId: s.id, status: "failed", error: "SMS provider is not configured" }); throw new Error("SMS provider is not configured"); }
      const biz = b ?? bn;
      if (!opsOf.has(r.businessId)) opsOf.set(r.businessId, (await effectiveOps(r.businessId)).requireDeliveryOtp);
      const track = trackingUrl(s.code, s.recipientPhone);
      const cash = s.codCents > 0 ? ` | المبلغ المطلوب عند الاستلام ${(s.codCents / 100).toFixed(2)} ر.س / Cash due on delivery SAR ${(s.codCents / 100).toFixed(2)}` : "";
      const withCode = !!opsOf.get(r.businessId);
      await sendSms(provider, s.recipientPhone, withCode
        ? `${biz}: طلبك في الطريق. رمز الاستلام ${otpFor(s)} — أعطه للمندوب عند الاستلام فقط. | Your order is on its way. Delivery code ${otpFor(s)}. Track: ${track}${cash}`
        : `${biz}: طلبك في الطريق. تتبّع الطلب: ${track} | Your order is on its way. Track: ${track}${cash}`, { type: withCode ? "recipient_code" : "recipient_track", requestId: r.id, shipmentId: s.id });
      await db.update(shipments).set({ notifiedAt: new Date(), otpSends: opts.force ? sql`${shipments.otpSends} + 1` : shipments.otpSends }).where(eq(shipments.id, s.id));
      await logEvent(db, { requestId: r.id, offerId: s.offerId, type: "recipient_notified", payload: { shipmentId: s.id, code: s.code, forced: !!opts.force } });
      sent++;
    } catch (e) {
      await logEvent(db, { requestId: r.id, offerId: s.offerId, type: "recipient_notify_failed", payload: { shipmentId: s.id, code: s.code, error: e instanceof Error ? e.message.slice(0, 120) : "error" } }).catch(() => {});
    }
  }
  return sent;
}

// ───────── Views ─────────
const maskPhone = (p: string | null) => (p ? p.slice(0, 4) + "•••" + p.slice(-2) : null);
const rad = (d: number) => (d * Math.PI) / 180;
/** Great-circle distance in metres. */
export function distanceM(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
  const dLat = rad(b.lat - a.lat), dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return Math.round(2 * 6371000 * Math.asin(Math.min(1, Math.sqrt(h))));
}

/** What the warehouse (and staff) see for a parcel. The recipient's code is never shown outside demo mode. */
export function businessShipmentView(s: Shipment, viewer: Pick<User, "role" | "permissions">, driverName?: string | null, media?: { count: number; signature: boolean }) {
  const staff = viewer.role !== "business";
  const sensitive = !staff || can(viewer as User, "drivers.sensitive");
  return {
    id: s.id, seq: s.seq, code: s.code, externalRef: s.externalRef, recipientType: s.recipientType,
    recipientName: s.recipientName, recipientPhone: sensitive ? s.recipientPhone : maskPhone(s.recipientPhone),
    address: s.address, city: s.city, lat: s.lat, lng: s.lng, contents: s.contents, notes: s.notes,
    status: s.status, offerId: s.offerId, driverName: driverName ?? null, stopOrder: s.stopOrder, attempts: s.attempts,
    loadedAt: s.loadedAt, arrivedAt: s.arrivedAt, deliveredAt: s.deliveredAt, deliveredDistanceM: s.deliveredDistanceM,
    proofType: s.proofType, receiverName: s.receiverName, hasProof: !!s.proofKey,
    failReason: s.failReason, failNote: s.failNote, failedAt: s.failedAt, returnedAt: s.returnedAt,
    detailsComplete: s.detailsComplete, geoSource: s.geoSource, legDistanceM: s.legDistanceM, legDurationS: s.legDurationS,
    codCents: s.codCents, codCollectedCents: s.codCollectedCents, codCollectedAt: s.codCollectedAt, loadedVia: s.loadedVia, mediaCount: media?.count ?? 0, hasSignature: media?.signature ?? false,
    partnerId: s.partnerId, partnerStatus: s.partnerStatus, partnerStatusAt: s.partnerStatusAt,
    ...(env.demoMode && viewer.role !== "staff" ? { demoOtp: otpFor(s) } : {}),
  };
}

/**
 * What the driver sees. Routing ON: name only for the stop in front of them (and finished ones), phone only for that stop; addresses so the route can be approved.
 * Routing OFF (`ctx.routing === false`, J2): the driver works any stop of his own job in any order, so name AND phone are shown for every stop that is not resolved yet
 * (finished stops keep showing the name), and `canDefer` / the door timer belong to every open stop, not only the "current" (first unresolved) one.
 * `started` = the route has started (approved, or — routing off — loading confirmed): before that no stop is current or actionable.
 */
export function driverStopView(s: Shipment, ctx: { currentId: string | null; stopWaitMin: number; routeApproved: boolean; remaining: number; needsOtp?: boolean; needsSignature?: boolean; routing?: boolean; started?: boolean }) {
  const routing = ctx.routing !== false;
  const started = ctx.started ?? ctx.routeApproved;
  const current = started && s.id === ctx.currentId;
  const resolved = ["delivered", "failed", "returned", "missing"].includes(s.status);
  const actionable = routing ? current : started && s.status === "loaded"; // routing off: any open stop may be worked
  const needsOtp = ctx.needsOtp ?? true;
  // The door timer exists only when the platform turned it on (stopWaitMin > 0); otherwise there is nothing to count down.
  const waitMs = s.arrivedAt && ctx.stopWaitMin > 0 ? Math.max(0, ctx.stopWaitMin * 60_000 - (Date.now() - s.arrivedAt.getTime())) : null;
  return {
    id: s.id, seq: s.seq, stopOrder: s.stopOrder, code: s.code, status: s.status, recipientType: s.recipientType,
    address: s.address, city: s.city, lat: s.lat, lng: s.lng, located: s.lat != null && s.lng != null, geoSource: s.geoSource,
    legDistanceM: s.legDistanceM, legDurationS: s.legDurationS, contents: s.contents, notes: s.notes,
    recipientName: !routing || current || resolved ? s.recipientName : null,
    recipientPhone: !routing ? (resolved ? null : s.recipientPhone) : current && ctx.routeApproved ? s.recipientPhone : null,
    current, attempts: s.attempts, deferCount: s.deferCount, canDefer: actionable && s.deferCount < 1 && ctx.remaining > 1,
    arrivedAt: s.arrivedAt, waitRemainingSec: actionable && waitMs != null ? Math.ceil(waitMs / 1000) : null,
    needsOtp, needsSignature: ctx.needsSignature ?? false, codCents: s.codCents, codCollectedCents: s.codCollectedCents,
    paymentMode: s.codCents > 0 ? "cod" as const : "prepaid" as const, createdAt: s.createdAt, pieces: 1, // J2: the platform has no pieces column — always 1 for now
    proofMode: !needsOtp ? "scan" : s.recipientType === "business" ? "code_or_receipt" : "code", hasProof: !!s.proofKey,
    otpAttemptsLeft: Math.max(0, OTP_MAX_ATTEMPTS - s.otpAttempts), canResend: needsOtp && s.otpSends < OTP_MAX_RESENDS,
    deliveredAt: s.deliveredAt, proofType: s.proofType, failReason: s.failReason, failNote: s.failNote,
  };
}

/** First unresolved stop in the driver's fixed order. */
export async function currentStopOf(x: Exec, offerId: string) {
  const [s] = await x.select().from(shipments).where(and(eq(shipments.offerId, offerId), eq(shipments.status, "loaded"))).orderBy(asc(shipments.stopOrder), asc(shipments.seq)).limit(1);
  return s ?? null;
}


/** The driver's route is over (all stops resolved, or ended early): the offer moves to "delivered reported" with the count taken from the parcels themselves. */
export async function markRouteFinished(tx: Exec, o: Offer, eventType: "delivery_reported" | "route_ended_early", actor: Pick<User, "id" | "name" | "role">, payload: Record<string, unknown> = {}) {
  const [{ n }] = await tx.select({ n: sql<number>`count(*)::int` }).from(shipments).where(and(eq(shipments.offerId, o.id), eq(shipments.status, "delivered")));
  const [u] = await tx.update(offers).set({ status: "delivered_reported", deliveredUnits: n, deliveredAt: new Date(), updatedAt: new Date() }).where(eq(offers.id, o.id)).returning();
  await logEvent(tx, { requestId: o.requestId, offerId: o.id, actor, type: eventType, oldStatus: o.status, newStatus: "delivered_reported", payload: { units: n, ...payload } });
  return { offer: u, delivered: n };
}
