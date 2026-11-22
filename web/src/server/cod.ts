import { and, count, desc, eq, ilike, inArray, or, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { db, type Exec } from "@/db";
import { businessProfiles, codRemittances, offers, officeProfiles, requests, shipments, users, type User } from "@/db/schema";
import { err } from "@/lib/errors";
import { contains } from "@/lib/sql";
import { can, requirePerm } from "./auth/permissions";
import { audit } from "./audit";
import { logEvent } from "./events";
import { notify } from "./notify";
import { nextRef } from "./counters";
import { lockOffer } from "./jobs";
import { officeRef, warehouseOf, type OfficeRef, type Warehouse } from "./cod-columns";

/**
 * Cash on delivery (decision E17). The driver collects `codCents` from the recipient at delivery; the platform only TRACKS who holds that
 * cash: outstanding(offer) = Σ cash collected on the offer's delivered parcels − Σ remittances recorded by the warehouse / ops.
 * It never touches the wallet ledger — it is the warehouse's money, handed over physically.
 */
export interface CodFigures { collectedCents: number; receivedCents: number; outstandingCents: number }

/** collected / received / outstanding for a set of offers (two grouped queries, no per-row lookups). */
export async function offerCodMap(x: Exec, offerIds: string[]): Promise<Map<string, CodFigures>> {
  const out = new Map<string, CodFigures>();
  if (!offerIds.length) return out;
  for (const id of offerIds) out.set(id, { collectedCents: 0, receivedCents: 0, outstandingCents: 0 });
  const col = await x.select({ o: shipments.offerId, n: sql<number>`coalesce(sum(${shipments.codCollectedCents}),0)::float8` }).from(shipments).where(and(inArray(shipments.offerId, offerIds), eq(shipments.status, "delivered"))).groupBy(shipments.offerId);
  const rec = await x.select({ o: codRemittances.offerId, n: sql<number>`coalesce(sum(${codRemittances.amountCents}),0)::float8` }).from(codRemittances).where(inArray(codRemittances.offerId, offerIds)).groupBy(codRemittances.offerId);
  for (const c of col) if (c.o) out.get(c.o)!.collectedCents = c.n;
  for (const r of rec) out.get(r.o)!.receivedCents = r.n;
  for (const f of out.values()) f.outstandingCents = Math.max(0, f.collectedCents - f.receivedCents);
  return out;
}

interface OrderRow extends OfficeRef { offerId: string; requestId: string; ref: string; businessId: string; businessName: string; driverId: string; driverName: string; driverPhone: string | null; parcels: number; lastCollectedAt: Date | null; warehouse: Warehouse }

/** Offers that have any cash collected, with who/what; optionally scoped. */
async function cashOrders(f: { businessId?: string; driverId?: string; offerId?: string; q?: string }): Promise<Array<OrderRow & CodFigures>> {
  const q = f.q?.trim() ? contains(f.q.trim()) : null;
  const bu = alias(users, "bu"), ou = alias(users, "ou"), op = alias(officeProfiles, "op");
  const rows = await db.select({
    offerId: offers.id, requestId: requests.id, ref: requests.ref, businessId: requests.businessId, businessName: sql<string>`coalesce(${businessProfiles.companyName}, ${bu.name})`,
    driverId: offers.driverId, driverName: users.name, driverPhone: users.phone,
    parcels: sql<number>`count(${shipments.id}) filter (where ${shipments.codCollectedCents} is not null)::int`, lastCollectedAt: sql<Date | null>`max(${shipments.codCollectedAt})`,
    // J6: the pickup warehouse of the order and the office the driver belonged to AT THE TIME OF THE JOB (the affiliation snapshot of the offer; null = independent)
    pickupAddress: requests.pickupAddress, pickupCity: requests.pickupCity, officeId: offers.officeId, officeName: sql<string | null>`coalesce(${op.officeName}, ${ou.name})`,
  }).from(shipments)
    .innerJoin(offers, eq(offers.id, shipments.offerId)).innerJoin(requests, eq(requests.id, shipments.requestId))
    .innerJoin(users, eq(users.id, offers.driverId)).innerJoin(bu, eq(bu.id, requests.businessId)).leftJoin(businessProfiles, eq(businessProfiles.userId, requests.businessId))
    .leftJoin(ou, eq(ou.id, offers.officeId)).leftJoin(op, eq(op.userId, offers.officeId))
    .where(and(eq(shipments.status, "delivered"), sql`${shipments.codCollectedCents} is not null`,
      f.businessId ? eq(requests.businessId, f.businessId) : undefined, f.driverId ? eq(offers.driverId, f.driverId) : undefined, f.offerId ? eq(offers.id, f.offerId) : undefined,
      q ? or(ilike(requests.ref, q), ilike(users.name, q), ilike(businessProfiles.companyName, q)) : undefined))
    .groupBy(offers.id, requests.id, users.id, businessProfiles.companyName, bu.name, ou.name, op.officeName).orderBy(desc(sql`max(${shipments.codCollectedAt})`));
  const figs = await offerCodMap(db, rows.map((r) => r.offerId));
  return rows.map(({ pickupAddress, pickupCity, officeId, officeName, ...r }) => ({ ...r, ...officeRef(officeId, officeName), warehouse: warehouseOf({ pickupAddress, pickupCity, companyName: r.businessName }), ...figs.get(r.offerId)! }));
}

const sum = (list: CodFigures[]): CodFigures => list.reduce((a, c) => ({ collectedCents: a.collectedCents + c.collectedCents, receivedCents: a.receivedCents + c.receivedCents, outstandingCents: a.outstandingCents + c.outstandingCents }), { collectedCents: 0, receivedCents: 0, outstandingCents: 0 });
const maskPhone = (p: string | null) => (p ? p.slice(0, 4) + "•••" + p.slice(-2) : null);

// ───────── Driver ─────────
export async function driverCash(driver: User) {
  const orders = await cashOrders({ driverId: driver.id });
  const totals = sum(orders);
  const recent = await db.select({ r: codRemittances, ref: requests.ref, by: users.name }).from(codRemittances)
    .innerJoin(requests, eq(requests.id, codRemittances.requestId)).innerJoin(users, eq(users.id, codRemittances.receivedBy))
    .where(eq(codRemittances.driverId, driver.id)).orderBy(desc(codRemittances.createdAt)).limit(20);
  return {
    ...totals,
    orders: orders.sort((a, b) => (b.outstandingCents > 0 ? 1 : 0) - (a.outstandingCents > 0 ? 1 : 0) || +(b.lastCollectedAt ?? 0) - +(a.lastCollectedAt ?? 0))
      .map((o) => ({ offerId: o.offerId, requestId: o.requestId, ref: o.ref, businessName: o.businessName, parcels: o.parcels, collectedCents: o.collectedCents, receivedCents: o.receivedCents, outstandingCents: o.outstandingCents, lastCollectedAt: o.lastCollectedAt })),
    recent: recent.map(({ r, ref, by }) => ({ id: r.id, ref, amountCents: r.amountCents, receivedByName: by, receivedByRole: r.receivedByRole, note: r.note, createdAt: r.createdAt })),
  };
}

/** Cash the driver holds in total (home-screen card). */
export async function driverCashOutstanding(driverId: string) {
  const orders = await cashOrders({ driverId });
  return { outstandingCents: orders.reduce((a, o) => a + o.outstandingCents, 0), orders: orders.filter((o) => o.outstandingCents > 0).length };
}

// ───────── Warehouse ─────────
/** One order row of `GET /business/cod`: the figures plus (J6) the pickup warehouse and the office of the driver at the time of the job. */
export interface BusinessCodOrder extends CodFigures, OfficeRef { offerId: string; requestId: string; ref: string; parcels: number; lastCollectedAt: string | null; warehouse: Warehouse }
/** Raw `max(timestamptz)` comes back from `pg` as text (`2026-11-19 16:18:23.29+03`): clients get ISO-8601. */
const isoOrNull = (v: Date | string | null) => { const d = v == null ? null : new Date(v); return d && !Number.isNaN(d.getTime()) ? d.toISOString() : null; };
export async function businessCod(business: User) {
  const orders = await cashOrders({ businessId: business.id });
  const totals = sum(orders);
  const byDriver = new Map<string, { driverId: string; driverName: string; phoneMasked: string | null; officeId: string | null; officeName: string | null; outstandingCents: number; orders: BusinessCodOrder[] }>();
  // `orders` come newest first, so a driver's office (header line) is the one of his latest order; every order row carries its own office (it can differ between jobs)
  for (const o of orders) {
    const d = byDriver.get(o.driverId) ?? { driverId: o.driverId, driverName: o.driverName, phoneMasked: maskPhone(o.driverPhone), officeId: o.officeId, officeName: o.officeName, outstandingCents: 0, orders: [] };
    d.orders.push({ offerId: o.offerId, requestId: o.requestId, ref: o.ref, collectedCents: o.collectedCents, receivedCents: o.receivedCents, outstandingCents: o.outstandingCents, parcels: o.parcels, lastCollectedAt: isoOrNull(o.lastCollectedAt), warehouse: o.warehouse, officeId: o.officeId, officeName: o.officeName });
    d.outstandingCents += o.outstandingCents;
    byDriver.set(o.driverId, d);
  }
  return { totals, drivers: [...byDriver.values()].sort((a, b) => b.outstandingCents - a.outstandingCents) };
}

/** Records cash received back from a driver. The warehouse that owns the order, or ops with `cod.manage`. Partial receipts allowed, never above what is outstanding. */
export async function receiveCash(actor: User, offerId: string, amountCents: number, note?: string | null) {
  if (!Number.isInteger(amountCents) || amountCents <= 0) throw err("VALIDATION", "Enter the amount received", { field: "amountCents" });
  return db.transaction(async (tx) => {
    const o = await lockOffer(tx, offerId);
    const [r] = await tx.select().from(requests).where(eq(requests.id, o.requestId));
    const owner = actor.role === "business" && actor.id === r.businessId;
    if (!owner) requirePerm(actor, "cod.manage");
    const fig = (await offerCodMap(tx, [offerId])).get(offerId)!;
    if (fig.collectedCents <= 0) throw err("NOTHING_TO_DO", "This driver collected no cash on this order");
    if (amountCents > fig.outstandingCents) throw err("VALIDATION", "The amount is more than the driver still holds for this order", { field: "amountCents", max: fig.outstandingCents });
    const [row] = await tx.insert(codRemittances).values({
      ref: await nextRef(tx, "COD"), requestId: r.id, offerId, driverId: o.driverId, businessId: r.businessId, amountCents,
      receivedBy: actor.id, receivedByRole: actor.role, note: note?.trim() || null,
    }).returning();
    await logEvent(tx, { requestId: r.id, offerId, actor: { id: actor.id, name: actor.name, role: actor.role }, type: "cod_received", payload: { amountCents, offerId, remittanceId: row.id, outstandingCents: fig.outstandingCents - amountCents } });
    await notify(o.driverId, "cod_received", { ref: r.ref, amountCents, amount: (amountCents / 100).toFixed(2) }, tx);
    if (!owner) await audit(actor, "cod.receive", "offer", offerId, { amountCents, ref: row.ref }, tx);
    return row;
  });
}

export async function listRemittances(f: { businessId?: string; driverId?: string; page?: number; pageSize?: number }) {
  const pageSize = Math.min(Math.max(f.pageSize ?? 25, 1), 100), page = Math.max(f.page ?? 1, 1);
  const where = and(f.businessId ? eq(codRemittances.businessId, f.businessId) : undefined, f.driverId ? eq(codRemittances.driverId, f.driverId) : undefined);
  const by = alias(users, "by_u"), biz = alias(users, "biz_u"), ou = alias(users, "ou"), op = alias(officeProfiles, "op");
  const [rows, [{ total }]] = await Promise.all([
    db.select({
      r: codRemittances, ref: requests.ref, driverName: users.name, byName: by.name, businessName: sql<string>`coalesce(${businessProfiles.companyName}, ${biz.name})`,
      pickupAddress: requests.pickupAddress, pickupCity: requests.pickupCity, officeId: offers.officeId, officeName: sql<string | null>`coalesce(${op.officeName}, ${ou.name})`,
    }).from(codRemittances)
      .innerJoin(requests, eq(requests.id, codRemittances.requestId)).innerJoin(users, eq(users.id, codRemittances.driverId)).innerJoin(offers, eq(offers.id, codRemittances.offerId))
      .innerJoin(by, eq(by.id, codRemittances.receivedBy)).innerJoin(biz, eq(biz.id, codRemittances.businessId)).leftJoin(businessProfiles, eq(businessProfiles.userId, codRemittances.businessId))
      .leftJoin(ou, eq(ou.id, offers.officeId)).leftJoin(op, eq(op.userId, offers.officeId))
      .where(where).orderBy(desc(codRemittances.createdAt)).limit(pageSize).offset((page - 1) * pageSize),
    db.select({ total: count() }).from(codRemittances).where(where),
  ]);
  return {
    items: rows.map(({ r, ref, driverName, byName, businessName, pickupAddress, pickupCity, officeId, officeName }) => ({
      id: r.id, ref: r.ref, orderRef: ref, requestId: r.requestId, offerId: r.offerId, driverId: r.driverId, driverName, businessId: r.businessId, businessName, amountCents: r.amountCents, note: r.note, receivedByName: byName, receivedByRole: r.receivedByRole, createdAt: r.createdAt,
      warehouse: warehouseOf({ pickupAddress, pickupCity, companyName: businessName }), ...officeRef(officeId, officeName),
    })),
    page, pageSize, total: Number(total),
  };
}

// ───────── Superadmin / ops ─────────
export async function adminCod(actor: User, f: { businessId?: string; driverId?: string; offerId?: string; q?: string; onlyOutstanding?: boolean; page?: number; pageSize?: number }) {
  if (!can(actor, "cod.manage") && !can(actor, "finance.view")) throw err("FORBIDDEN");
  const all = await cashOrders({ businessId: f.businessId, driverId: f.driverId, offerId: f.offerId, q: f.q });
  const list = f.onlyOutstanding ? all.filter((o) => o.outstandingCents > 0) : all;
  const totals = sum(list);
  const pageSize = Math.min(Math.max(f.pageSize ?? 25, 1), 100), page = Math.max(f.page ?? 1, 1);
  return {
    totals,
    items: list.slice((page - 1) * pageSize, page * pageSize).map((o) => ({ offerId: o.offerId, requestId: o.requestId, ref: o.ref, businessId: o.businessId, businessName: o.businessName, driverId: o.driverId, driverName: o.driverName, warehouse: o.warehouse, officeId: o.officeId, officeName: o.officeName, parcels: o.parcels, collectedCents: o.collectedCents, receivedCents: o.receivedCents, outstandingCents: o.outstandingCents, lastCollectedAt: o.lastCollectedAt })),
    page, pageSize, total: list.length,
  };
}
