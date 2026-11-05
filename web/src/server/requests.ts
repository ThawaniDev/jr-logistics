import { and, desc, eq, inArray, sql, ilike, gte, lte, count } from "drizzle-orm";
import { db, type Exec, type Tx } from "@/db";
import { requests, offers, businessProfiles, users, termsConsents, type Request, type User } from "@/db/schema";
import { err } from "@/lib/errors";
import { SERVICE_MAP, TEMPERATURE_VEHICLES, VEHICLE_TYPES, REQUEST_TERMINAL, OFFER_DEAD, type ServiceKey } from "./catalog";
import { getSettings } from "./settings";
import { buildQuote, resolveRule, expectedUnitsFor, publicQuote } from "./pricing";
import { ensureAccount, post } from "./wallet";
import { nextRef } from "./counters";
import { logEvent } from "./events";
import { audit } from "./audit";
import { notify, notifyMany } from "./notify";
import { dispatchOffers } from "./matching";
import { can } from "./auth/permissions";
import { normalizePhone } from "@/lib/phone";

export interface RequestInput {
  service: ServiceKey; title?: string | null; quantity: number; shipmentsPerDriver?: number | null;
  vehicleType?: string | null; temperature?: string | null; pickupCity: string; deliveryCity: string;
  pickupAddress?: string | null; pickupLat?: number | null; pickupLng?: number | null;
  deliveryAddress?: string | null; deliveryLat?: number | null; deliveryLng?: number | null;
  recipientName?: string | null; recipientPhone?: string | null; contents?: string | null;
  startsAt: Date; durationDays: number; notes?: string | null; preferredOfficeId?: string | null;
}

async function validate(i: RequestInput, x: Exec) {
  const s = await getSettings(x);
  const def = SERVICE_MAP[i.service];
  if (!def) throw err("VALIDATION", "Unknown service", { field: "service" });
  if (!s.enabledServices.includes(i.service)) throw err("SERVICE_DISABLED", "Service is not enabled", { field: "service" });
  if (def.needsVehicle) {
    if (!i.vehicleType || !(VEHICLE_TYPES as readonly string[]).includes(i.vehicleType)) throw err("VALIDATION", "Valid vehicle type required", { field: "vehicleType" });
    if (TEMPERATURE_VEHICLES.includes(i.vehicleType) && !["dry", "cold"].includes(i.temperature ?? "")) throw err("VALIDATION", "Temperature (dry/cold) required for this vehicle", { field: "temperature" });
  }
  if (!Number.isInteger(i.quantity) || i.quantity < 1 || i.quantity > 500) throw err("VALIDATION", "Quantity must be 1–500", { field: "quantity" });
  if (def.hasShipments && (!Number.isInteger(i.shipmentsPerDriver) || (i.shipmentsPerDriver ?? 0) < 1)) throw err("VALIDATION", "Shipments per driver required", { field: "shipmentsPerDriver" });
  if (!Number.isInteger(i.durationDays) || i.durationDays < 1 || i.durationDays > 90) throw err("VALIDATION", "Duration must be 1–90 days", { field: "durationDays" });
  const pickup = s.cities.find((c) => c.key === i.pickupCity);
  const delivery = s.cities.find((c) => c.key === i.deliveryCity);
  if (!pickup?.pickup) throw err("VALIDATION", "Pickup city is not supported yet", { field: "pickupCity" });
  if (!delivery?.delivery) throw err("VALIDATION", "Delivery city is not supported", { field: "deliveryCity" });
  if (Number.isNaN(i.startsAt.getTime())) throw err("VALIDATION", "Invalid start", { field: "startsAt" });
  if (i.recipientPhone && !normalizePhone(i.recipientPhone)) throw err("VALIDATION", "Invalid recipient phone", { field: "recipientPhone" });
}

const mustBeInFuture = (d: Date) => { if (d.getTime() < Date.now() - 60_000) throw err("VALIDATION", "Start must be in the future", { field: "startsAt" }); };

function rowFromInput(i: RequestInput) {
  const def = SERVICE_MAP[i.service];
  return {
    service: i.service, title: i.title ?? null, quantity: i.quantity,
    shipmentsPerDriver: def.hasShipments ? i.shipmentsPerDriver ?? null : null,
    vehicleType: i.vehicleType ?? null,
    temperature: i.vehicleType && TEMPERATURE_VEHICLES.includes(i.vehicleType) ? i.temperature ?? null : null,
    pickupCity: i.pickupCity, deliveryCity: i.deliveryCity,
    pickupAddress: i.pickupAddress ?? null, pickupLat: i.pickupLat ?? null, pickupLng: i.pickupLng ?? null,
    deliveryAddress: i.deliveryAddress ?? null, deliveryLat: i.deliveryLat ?? null, deliveryLng: i.deliveryLng ?? null,
    recipientName: i.recipientName ?? null, recipientPhone: i.recipientPhone ? normalizePhone(i.recipientPhone) : null, // stored in international form so wa.me / tel: links always work contents: i.contents ?? null,
    startsAt: i.startsAt, durationDays: i.durationDays, notes: i.notes ?? null, preferredOfficeId: i.preferredOfficeId ?? null,
  };
}

/** Live estimate for the wizard. Never exposes provider cost / margin. */
export async function estimate(business: User, i: RequestInput) {
  await validate(i, db);
  const rule = await resolveRule({ service: i.service, vehicleType: i.vehicleType, temperature: i.temperature, pickupCity: i.pickupCity, deliveryCity: i.deliveryCity, businessId: business.id });
  if (!rule) return { available: false as const, code: "NO_APPROVED_PRICE" };
  const q = buildQuote(rule, { service: i.service, quantity: i.quantity, shipmentsPerDriver: i.shipmentsPerDriver, durationDays: i.durationDays });
  const acct = await ensureAccount(business.id);
  return { available: true as const, quote: publicQuote(q), wallet: { availableCents: acct.availableCents }, sufficientFunds: acct.availableCents >= q.totalCents };
}

export async function createDraft(business: User, i: RequestInput, via: "web" | "api" | "mobile" = "web") {
  await validate(i, db);
  mustBeInFuture(i.startsAt);
  return db.transaction(async (tx) => {
    const ref = await nextRef(tx, "JR");
    const [r] = await tx.insert(requests).values({ ...rowFromInput(i), ref, businessId: business.id, status: "draft", createdVia: via }).returning();
    await logEvent(tx, { requestId: r.id, actor: business, type: "request_created", newStatus: "draft" });
    return r;
  });
}

export async function updateDraft(business: User, id: string, i: RequestInput) {
  await validate(i, db);
  mustBeInFuture(i.startsAt);
  return db.transaction(async (tx) => {
    const r = await lockRequest(tx, id);
    assertOwner(business, r);
    if (r.status !== "draft") throw err("INVALID_TRANSITION", "Only drafts can be edited");
    const [u] = await tx.update(requests).set({ ...rowFromInput(i), updatedAt: new Date(), version: r.version + 1 }).where(eq(requests.id, id)).returning();
    return u;
  });
}

export async function lockRequest(tx: Exec, id: string): Promise<Request> {
  const [r] = await tx.select().from(requests).where(eq(requests.id, id)).for("update");
  if (!r) throw err("NOT_FOUND", "Request not found");
  return r;
}
export function assertOwner(u: Pick<User, "id" | "role">, r: Pick<Request, "businessId">) {
  if (u.id !== r.businessId) throw err("NOT_FOUND", "Request not found"); // do not reveal existence
}

export interface PublishOpts { termsAccepted: boolean; via?: string }

/**
 * Publish: gates (verification, terms, price, funds) → immutable price snapshot → escrow reserve → dispatch.
 * Everything happens in one transaction; any failure leaves the draft untouched (no orphan reserves).
 */
export async function publishRequest(business: User, id: string, opts: PublishOpts) {
  return db.transaction(async (tx) => {
    const r = await lockRequest(tx, id);
    assertOwner(business, r);
    if (r.status !== "draft") throw err("INVALID_TRANSITION", "Request is not a draft");
    const s = await getSettings(tx);
    if (!opts.termsAccepted) throw err("TERMS_REQUIRED", "You must accept the terms to publish");
    if (!s.enabledServices.includes(r.service)) throw err("SERVICE_DISABLED");
    if (s.requireBusinessVerification) {
      const [bp] = await tx.select().from(businessProfiles).where(eq(businessProfiles.userId, business.id));
      if (bp?.verificationStatus !== "verified") throw err("VERIFICATION_REQUIRED", "Business account is awaiting verification");
    }
    mustBeInFuture(r.startsAt);
    if (r.preferredOfficeId) {
      const [o] = await tx.select({ id: users.id }).from(users).where(and(eq(users.id, r.preferredOfficeId), eq(users.role, "office"), eq(users.status, "active")));
      if (!o) throw err("VALIDATION", "Preferred office not available", { field: "preferredOfficeId" });
    }
    const rule = await resolveRule({ service: r.service as ServiceKey, vehicleType: r.vehicleType, temperature: r.temperature, pickupCity: r.pickupCity, deliveryCity: r.deliveryCity, businessId: business.id }, tx);
    if (!rule) throw err("NO_APPROVED_PRICE", "No approved price for this route — contact operations");
    const quote = buildQuote(rule, { service: r.service as ServiceKey, quantity: r.quantity, shipmentsPerDriver: r.shipmentsPerDriver, durationDays: r.durationDays });
    const acct = await ensureAccount(business.id, tx);
    await post(tx, { accountId: acct.id, kind: "reserve", available: -quote.totalCents, reserved: quote.totalCents, idempotencyKey: `reserve:${r.id}`, requestId: r.id, actorId: business.id });
    const driverless = SERVICE_MAP[r.service as ServiceKey].driverless;
    const now = new Date();
    const status = driverless ? "confirmed" : "published";
    const [u] = await tx.update(requests).set({
      status, pricingSnapshot: quote as never, unitPriceCents: quote.unitPriceCents, expectedUnits: quote.expectedUnits,
      totalCents: quote.totalCents, reservedCents: quote.totalCents, publishedAt: now, updatedAt: now, version: r.version + 1,
      officeWindowEndsAt: r.preferredOfficeId ? new Date(now.getTime() + s.officeWindowMin * 60_000) : null,
    }).where(eq(requests.id, id)).returning();
    await tx.insert(termsConsents).values({ userId: business.id, role: "business", termsVersion: s.termsVersion, context: "publish" });
    await logEvent(tx, { requestId: id, actor: business, type: "request_published", oldStatus: "draft", newStatus: status, payload: { totalCents: quote.totalCents, ruleVersion: quote.ruleVersion } });
    if (!driverless && !u.preferredOfficeId) await dispatchOffers(tx, u);
    if (u.preferredOfficeId) await notify(u.preferredOfficeId, "office_opportunity", { requestId: u.id, ref: u.ref }, tx);
    return u;
  });
}

/** Release unspent reserve back to the business wallet. */
export async function releaseReserve(tx: Exec, r: Request, amountCents: number, key: string, actorId?: string | null) {
  if (amountCents <= 0) return;
  const acct = await ensureAccount(r.businessId, tx);
  await post(tx, { accountId: acct.id, kind: "release_reserve", reserved: -amountCents, available: amountCents, idempotencyKey: key, requestId: r.id, actorId: actorId ?? null });
  await tx.update(requests).set({ reservedCents: sql`${requests.reservedCents} - ${amountCents}` }).where(eq(requests.id, r.id));
}

export async function cancelRequest(actor: User, id: string, reason: string) {
  if (!reason?.trim()) throw err("VALIDATION", "Reason is required", { field: "reason" });
  return db.transaction(async (tx) => {
    const r = await lockRequest(tx, id);
    const staff = can(actor, "requests.edit");
    if (!staff) assertOwner(actor, r);
    if ((REQUEST_TERMINAL as string[]).includes(r.status)) throw err("INVALID_TRANSITION", "Request is already closed");
    const live = await tx.select().from(offers).where(eq(offers.requestId, id));
    const started = live.some((o) => ["arrived", "attendance_confirmed", "delivered_reported", "qty_disputed", "pending_settlement", "completed"].includes(o.status));
    if (started && !staff) throw err("INVALID_TRANSITION", "Work has already started — contact operations to cancel");
    const toCancel = live.filter((o) => !(OFFER_DEAD as string[]).includes(o.status) && o.status !== "completed");
    if (toCancel.length) {
      await tx.update(offers).set({ status: "cancelled", cancelReason: "request_cancelled", cancelledAt: new Date(), updatedAt: new Date() }).where(inArray(offers.id, toCancel.map((o) => o.id)));
      await notifyMany(toCancel.map((o) => o.driverId), "request_cancelled", { ref: r.ref }, tx);
    }
    // Funds still reserved (nothing has settled) go back to the business.
    const settledShare = live.filter((o) => o.status === "completed").reduce((a, o) => a + (r.unitPriceCents ?? 0) * o.expectedUnits, 0);
    await releaseReserve(tx, r, Math.max(0, r.reservedCents - settledShare), `cancel-release:${r.id}`, actor.id);
    const [u] = await tx.update(requests).set({ status: "cancelled", cancelReason: reason, cancelledBy: actor.id, cancelledAt: new Date(), updatedAt: new Date(), version: r.version + 1 }).where(eq(requests.id, id)).returning();
    await logEvent(tx, { requestId: id, actor, type: "request_cancelled", oldStatus: r.status, newStatus: "cancelled", payload: { reason } });
    await audit(actor, "request.cancel", "request", id, { reason }, tx);
    return u;
  });
}

// ───────── Queries ─────────
export interface ListFilter { status?: string; city?: string; from?: Date; to?: Date; q?: string; businessId?: string; page?: number; pageSize?: number }
export async function listRequests(f: ListFilter) {
  const pageSize = Math.min(Math.max(f.pageSize ?? 20, 1), 100);
  const page = Math.max(f.page ?? 1, 1);
  const where = and(
    f.businessId ? eq(requests.businessId, f.businessId) : undefined,
    f.status ? eq(requests.status, f.status) : undefined,
    f.city ? eq(requests.pickupCity, f.city) : undefined,
    f.from ? gte(requests.startsAt, f.from) : undefined,
    f.to ? lte(requests.startsAt, f.to) : undefined,
    f.q ? ilike(requests.ref, `%${f.q}%`) : undefined,
  );
  const [rows, [{ total }]] = await Promise.all([
    db.select().from(requests).where(where).orderBy(desc(requests.createdAt)).limit(pageSize).offset((page - 1) * pageSize),
    db.select({ total: count() }).from(requests).where(where),
  ]);
  return { items: rows, page, pageSize, total: Number(total) };
}

/** Strips internal pricing detail for non-privileged viewers. */
export function viewRequest(r: Request, viewer: Pick<User, "role" | "permissions">) {
  const privileged = viewer.role === "admin" || (viewer.role === "staff" && (viewer.permissions.includes("finance.view") || viewer.permissions.includes("pricing.view")));
  const snap = r.pricingSnapshot as Record<string, unknown> | null;
  const safeSnap = snap && !privileged ? { ruleVersion: snap.ruleVersion, currency: snap.currency, unit: snap.unit, unitPriceCents: snap.unitPriceCents, quantity: snap.quantity, expectedUnits: snap.expectedUnits, totalCents: snap.totalCents } : snap;
  return { ...r, pricingSnapshot: safeSnap };
}
export { expectedUnitsFor };
export type { Tx };
