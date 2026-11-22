import { and, asc, desc, eq, gte, inArray, isNull, lte, ne, or, sql } from "drizzle-orm";
import { db, type Exec } from "@/db";
import { officeInvites, officeAgreements, driverProfiles, users, offers, requests, officeProfiles, settlements, businessProfiles, shipments, jobEvents, type User } from "@/db/schema";
import { offerShipmentStats } from "./shipments";
import { err } from "@/lib/errors";
import { normalizePhone } from "@/lib/phone";
import { OFFER_BUSY } from "./catalog";
import { notify } from "./notify";
import { audit } from "./audit";
import { readyOfficeIds, evaluateCandidatesMany, earningFor } from "./matching";
import { requirePerm, can } from "./auth/permissions";
import { ensureAccount } from "./wallet";
import { hit } from "./auth/ratelimit";

export async function officeReadiness(officeId: string) {
  const [p] = await db.select().from(officeProfiles).where(eq(officeProfiles.userId, officeId));
  const [ag] = await db.select().from(officeAgreements).where(eq(officeAgreements.officeId, officeId)).orderBy(desc(officeAgreements.createdAt)).limit(1);
  const ready = (await readyOfficeIds(db, [officeId])).has(officeId);
  return { verification: p?.verificationStatus ?? "pending", agreement: ag?.status ?? "none", ready };
}

export async function inviteDriver(office: User, phoneRaw: string) {
  const phone = normalizePhone(phoneRaw);
  if (!phone) throw err("VALIDATION", "Invalid phone", { field: "phone" });
  await hit(`invite:${office.id}`, 30, 3600); // invitations notify strangers: bound them (also limits phone-number probing)
  const [off] = await db.select().from(officeProfiles).where(eq(officeProfiles.userId, office.id));
  if (off?.verificationStatus !== "verified") throw err("VERIFICATION_REQUIRED", "Your office must be verified first");
  if (office.phone && normalizePhone(office.phone) === phone) throw err("VALIDATION", "You cannot invite your own number", { field: "phone" });
  const [anyUser] = await db.select({ id: users.id, role: users.role }).from(users).where(eq(users.phone, phone));
  if (anyUser && anyUser.role !== "driver") throw err("CONFLICT", "This number belongs to a non-driver account", { field: "phone" });
  const drv = anyUser;
  if (drv) {
    const [p] = await db.select().from(driverProfiles).where(eq(driverProfiles.userId, drv.id));
    if (p?.officeId === office.id) throw err("CONFLICT", "Driver is already linked to your office");
    if (p?.officeId) throw err("CONFLICT", "Driver is already linked to another office", { field: "phone" });
  }
  const dup = await db.select({ id: officeInvites.id }).from(officeInvites).where(and(eq(officeInvites.officeId, office.id), eq(officeInvites.phone, phone), eq(officeInvites.status, "pending")));
  if (dup.length) throw err("CONFLICT", "An invitation is already pending for this number");
  const [inv] = await db.insert(officeInvites).values({ officeId: office.id, phone, driverId: drv?.id ?? null }).returning();
  if (drv) await notify(drv.id, "office_invite", { office: off.officeName, inviteId: inv.id });
  return inv;
}

export async function myInvites(driver: User) {
  return db.select({ inv: officeInvites, office: officeProfiles.officeName }).from(officeInvites).innerJoin(officeProfiles, eq(officeProfiles.userId, officeInvites.officeId))
    .where(and(eq(officeInvites.status, "pending"), sql`(${officeInvites.driverId} = ${driver.id} or ${officeInvites.phone} = ${driver.phone})`));
}

/**
 * Offers carry an office snapshot (who gets paid, who sees the job). When a driver joins or leaves an office, offers
 * that were made under the old link would be settled to the wrong party — expire them; matching re-offers under the new link.
 */
async function dropStaleOffers(tx: Exec, driverId: string) {
  await tx.update(offers).set({ status: "expired", updatedAt: new Date() }).where(and(eq(offers.driverId, driverId), eq(offers.status, "offered")));
}

export async function respondInvite(driver: User, inviteId: string, accept: boolean) {
  return db.transaction(async (tx) => {
    const [inv] = await tx.select().from(officeInvites).where(eq(officeInvites.id, inviteId)).for("update");
    if (!inv || inv.status !== "pending" || (inv.driverId !== driver.id && inv.phone !== driver.phone)) throw err("NOT_FOUND");
    if (accept) {
      const [cur] = await tx.select({ officeId: driverProfiles.officeId }).from(driverProfiles).where(eq(driverProfiles.userId, driver.id));
      if (cur?.officeId && cur.officeId !== inv.officeId) throw err("CONFLICT", "You are linked to another office. Ask them to unlink you first.");
      const busy = await tx.select({ id: offers.id }).from(offers).where(and(eq(offers.driverId, driver.id), inArray(offers.status, OFFER_BUSY))).limit(1);
      if (busy.length) throw err("INVALID_TRANSITION", "Finish your active jobs before joining an office");
      await tx.update(driverProfiles).set({ officeId: inv.officeId, officeLinkStatus: "linked" }).where(eq(driverProfiles.userId, driver.id));
      await dropStaleOffers(tx, driver.id);
    }
    const [u] = await tx.update(officeInvites).set({ status: accept ? "accepted" : "declined", driverId: driver.id, respondedAt: new Date() }).where(eq(officeInvites.id, inviteId)).returning();
    await notify(inv.officeId, accept ? "invite_accepted" : "invite_declined", { driver: driver.name }, tx);
    return u;
  });
}

export async function unlinkDriver(actor: User, driverId: string) {
  const [p] = await db.select().from(driverProfiles).where(eq(driverProfiles.userId, driverId));
  if (!p?.officeId) throw err("NOT_FOUND");
  if (actor.role === "office" ? p.officeId !== actor.id : !can(actor, "offices.manage")) throw err("NOT_FOUND");
  const busy = await db.select({ id: offers.id }).from(offers).where(and(eq(offers.driverId, driverId), inArray(offers.status, OFFER_BUSY))).limit(1);
  if (busy.length) throw err("INVALID_TRANSITION", "Driver has an active job");
  await db.transaction(async (tx) => {
    await tx.update(driverProfiles).set({ officeId: null, officeLinkStatus: "direct" }).where(eq(driverProfiles.userId, driverId));
    await dropStaleOffers(tx, driverId);
    await notify(driverId, "office_unlinked", undefined, tx);
    await audit(actor, "office.unlink_driver", "user", driverId, null, tx);
  });
}

/** Pending invitations this office sent (so it can see and withdraw them). */
export async function pendingInvites(officeId: string) {
  return db.select({ id: officeInvites.id, phone: officeInvites.phone, createdAt: officeInvites.createdAt }).from(officeInvites)
    .where(and(eq(officeInvites.officeId, officeId), eq(officeInvites.status, "pending"))).orderBy(desc(officeInvites.createdAt));
}
export async function revokeInvite(office: User, id: string) {
  const [u] = await db.update(officeInvites).set({ status: "cancelled", respondedAt: new Date() }).where(and(eq(officeInvites.id, id), eq(officeInvites.officeId, office.id), eq(officeInvites.status, "pending"))).returning({ id: officeInvites.id });
  if (!u) throw err("NOT_FOUND");
}

export async function officeDrivers(officeId: string) {
  const rows = await db.select({ u: users, p: driverProfiles }).from(driverProfiles).innerJoin(users, eq(users.id, driverProfiles.userId)).where(eq(driverProfiles.officeId, officeId));
  const busy = await db.select({ d: offers.driverId }).from(offers).where(and(eq(offers.officeId, officeId), inArray(offers.status, OFFER_BUSY)));
  const busySet = new Set(busy.map((b) => b.d));
  // The job each driver is on right now (newest busy offer) and how far along its parcels are.
  const active = await db.select({ id: offers.id, d: offers.driverId }).from(offers).where(and(eq(offers.officeId, officeId), inArray(offers.status, OFFER_BUSY))).orderBy(desc(offers.updatedAt));
  const activeBy = new Map<string, string>();
  for (const a of active) if (!activeBy.has(a.d)) activeBy.set(a.d, a.id);
  const stats = await offerShipmentStats(db, [...activeBy.values()]);
  return rows.map(({ u, p }) => ({
    activeOfferId: activeBy.get(u.id) ?? null, parcels: activeBy.has(u.id) ? parcelProgress(stats.get(activeBy.get(u.id)!)) : null,
    id: u.id, name: u.name, phone: u.phone, city: u.city, vehicleType: p.vehicleType, vehicleTemperature: p.vehicleTemperature,
    verificationStatus: p.verificationStatus, availability: p.availability, onJob: busySet.has(u.id), jobsCompleted: p.jobsCompleted,
    rating: p.ratingCount ? Math.round((p.ratingSum / p.ratingCount) * 10) / 10 : null,
  }));
}

/** Requests the office can staff: preferred-to-office within the window, or open requests its drivers could take. */
export async function officeOpportunities(officeId: string) {
  // Filter in SQL BEFORE limiting, so other offices' reserved requests can never crowd this office's list.
  const open = await db.select({ r: requests, biz: businessProfiles.companyName, bizName: users.name }).from(requests)
    .innerJoin(users, eq(users.id, requests.businessId)).leftJoin(businessProfiles, eq(businessProfiles.userId, requests.businessId))
    .where(and(inArray(requests.status, ["published", "filling"]), sql`${requests.slotsFilled} < ${requests.quantity}`, sql`${requests.service} <> 'car_without_driver'`,
      or(isNull(requests.preferredOfficeId), eq(requests.preferredOfficeId, officeId))))
    .orderBy(requests.startsAt).limit(100);
  const out = [];
  const evals = await evaluateCandidatesMany(db, open.map((o) => o.r), { onlyOfficeId: officeId }); // one evaluation for the whole list, not one per open request
  for (const { r, biz, bizName } of open) {
    const snap = r.pricingSnapshot as { providerCostCents: number; expectedUnits: number } | null;
    const all = evals.get(r.id) ?? [];
    out.push({
      id: r.id, ref: r.ref, service: r.service, quantity: r.quantity, slotsFilled: r.slotsFilled, vehicleType: r.vehicleType, temperature: r.temperature,
      pickupCity: r.pickupCity, deliveryCity: r.deliveryCity, startsAt: r.startsAt, durationDays: r.durationDays, preferred: r.preferredOfficeId === officeId,
      business: biz ?? bizName, windowEndsAt: r.officeWindowEndsAt,
      // What the office's drivers are paid per driver slot (provider cost) — never the customer price or the margin.
      providerAmountCents: snap ? earningFor(snap.providerCostCents, snap.expectedUnits) : null,
      eligibleDrivers: all.filter((c) => !c.reasons.length).map((c) => ({ id: c.driverId, name: c.name, score: c.score })),
      ineligibleDrivers: all.filter((c) => c.reasons.length).map((c) => ({ id: c.driverId, name: c.name, reasons: c.reasons })),
    });
  }
  return out;
}

export async function officeJobs(officeId: string, o: { scope?: "active" | "all"; page?: number; pageSize?: number } = {}) {
  const pageSize = Math.min(o.pageSize ?? 50, 200), page = Math.max(o.page ?? 1, 1);
  const where = and(eq(offers.officeId, officeId), ne(offers.status, "rejected"), ...(o.scope === "active" ? [inArray(offers.status, [...OFFER_BUSY, "offered"] as never)] : []));
  const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(offers).where(where);
  const rows = await db.select({ o: offers, r: requests, d: users.name, biz: businessProfiles.companyName, last: sql<Date | null>`(select max(e.created_at) from job_events e where e.offer_id = ${offers.id})` }).from(offers).innerJoin(requests, eq(requests.id, offers.requestId)).innerJoin(users, eq(users.id, offers.driverId))
    .leftJoin(businessProfiles, eq(businessProfiles.userId, requests.businessId))
    .where(where).orderBy(desc(offers.createdAt)).limit(pageSize).offset((page - 1) * pageSize);
  const stats = await offerShipmentStats(db, rows.map(({ o: of }) => of.id));
  return {
    total: n, page, pageSize,
    items: rows.map(({ o: of, r, d, biz, last }) => ({ offerId: of.id, requestId: r.id, ref: r.ref, service: r.service, status: of.status, driver: d, driverId: of.driverId, business: biz, startsAt: r.startsAt, pickupCity: r.pickupCity, deliveryCity: r.deliveryCity, expectedUnits: of.expectedUnits, finalUnits: of.finalUnits,
      parcels: parcelProgress(stats.get(of.id)), lastActivityAt: last ?? of.updatedAt })),
  };
}

/** Per-parcel progress for a job: the same counters the business sees. `null` for legacy count-based jobs (no parcel rows). */
function parcelProgress(s?: { total: number; pending: number; loaded: number; delivered: number; failed: number; returned: number; missing: number }) {
  return s && s.total > 0 ? { total: s.total, delivered: s.delivered, failed: s.failed, returned: s.returned, pending: s.pending, loaded: s.loaded, missing: s.missing } : null;
}

/** One of this office's own jobs, with a per-stop summary. Never any recipient name, phone or address. */
export async function officeJobDetail(officeId: string, offerId: string) {
  const [row] = await db.select({ o: offers, r: requests, d: users.name, biz: businessProfiles.companyName, bizName: sql<string>`(select name from users where id = ${requests.businessId})` }).from(offers)
    .innerJoin(requests, eq(requests.id, offers.requestId)).innerJoin(users, eq(users.id, offers.driverId)).leftJoin(businessProfiles, eq(businessProfiles.userId, requests.businessId))
    .where(and(eq(offers.id, offerId), eq(offers.officeId, officeId)));
  if (!row) throw err("NOT_FOUND");
  const { o, r } = row;
  const stops = await db.select({ seq: shipments.seq, stopOrder: shipments.stopOrder, code: shipments.code, status: shipments.status, failReason: shipments.failReason, deliveredAt: shipments.deliveredAt, failedAt: shipments.failedAt, returnedAt: shipments.returnedAt })
    .from(shipments).where(eq(shipments.offerId, offerId)).orderBy(asc(shipments.stopOrder), asc(shipments.seq));
  const stats = await offerShipmentStats(db, [offerId]);
  const [ev] = await db.select({ at: sql<Date | null>`max(${jobEvents.createdAt})` }).from(jobEvents).where(eq(jobEvents.offerId, offerId));
  return {
    offerId: o.id, requestId: r.id, ref: r.ref, service: r.service, status: o.status, requestStatus: r.status, driver: row.d, driverId: o.driverId, business: row.biz ?? row.bizName,
    startsAt: r.startsAt, durationDays: r.durationDays, pickupCity: r.pickupCity, deliveryCity: r.deliveryCity, vehicleType: r.vehicleType,
    expectedUnits: o.expectedUnits, loadedUnits: o.loadedUnits, deliveredUnits: o.deliveredUnits, finalUnits: o.finalUnits,
    acceptedAt: o.acceptedAt, arrivedAt: o.arrivedAt, routeApprovedAt: o.routeApprovedAt, cancelReason: o.cancelReason,
    manifest: stops.length > 0, parcels: parcelProgress(stats.get(offerId)), stops, lastActivityAt: ev?.at ? new Date(ev.at) : o.updatedAt,
  };
}

/** Settlements payable to this office, enriched so they can be reconciled (request ref, driver). Customer price and margin never leave the server. */
export async function officeSettlements(officeId: string, f: { status?: string; page?: number; pageSize?: number } = {}) {
  const pageSize = Math.min(f.pageSize ?? 50, 200), page = Math.max(f.page ?? 1, 1);
  const where = and(eq(settlements.officeId, officeId), ...(f.status ? [eq(settlements.status, f.status as never)] : []));
  const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(settlements).where(where);
  const rows = await db.select({ s: settlements, ref: requests.ref, driver: users.name }).from(settlements)
    .innerJoin(requests, eq(requests.id, settlements.requestId)).innerJoin(users, eq(users.id, settlements.driverId))
    .where(where).orderBy(desc(settlements.createdAt)).limit(pageSize).offset((page - 1) * pageSize);
  return { total: n, page, pageSize, items: rows.map(({ s, ref, driver }) => ({ id: s.id, requestId: s.requestId, ref, driverId: s.driverId, driver, finalUnits: s.finalUnits, amountCents: s.providerCents, status: s.status, createdAt: s.createdAt, paidAt: s.paidAt })) };
}

/** Office report for a period: work done, reliability and money. */
export async function officeReport(officeId: string, from?: Date, to?: Date) {
  const range = [eq(offers.officeId, officeId), ...(from ? [gte(offers.createdAt, from)] : []), ...(to ? [lte(offers.createdAt, to)] : [])];
  const byStatus = await db.select({ status: offers.status, n: sql<number>`count(*)::int`, units: sql<number>`coalesce(sum(${offers.finalUnits}),0)::int` }).from(offers).where(and(...range)).groupBy(offers.status);
  const count = (...st: string[]) => byStatus.filter((r) => st.includes(r.status)).reduce((a, r) => a + r.n, 0);
  const money = await db.select({ status: settlements.status, n: sql<number>`count(*)::int`, cents: sql<number>`coalesce(sum(${settlements.providerCents}),0)::float8` }).from(settlements)
    .where(and(eq(settlements.officeId, officeId), ...(from ? [gte(settlements.createdAt, from)] : []), ...(to ? [lte(settlements.createdAt, to)] : []))).groupBy(settlements.status);
  const sum = (...st: string[]) => money.filter((r) => st.includes(r.status)).reduce((a, r) => a + r.cents, 0);
  const completed = count("completed");
  const lateOrBad = count("no_show", "cancelled", "replaced");
  return {
    jobs: { total: byStatus.reduce((a, r) => a + r.n, 0), completed, inProgress: count("accepted", "arrived", "attendance_confirmed", "delivered_reported", "qty_disputed", "pending_settlement"), cancelled: count("cancelled"), noShow: count("no_show"), replaced: count("replaced") },
    shipmentsDelivered: byStatus.filter((r) => r.status === "completed").reduce((a, r) => a + r.units, 0),
    completionRate: completed + lateOrBad ? Math.round((completed / (completed + lateOrBad)) * 100) : null,
    money: { paidCents: sum("paid"), approvedCents: sum("approved"), pendingCents: sum("pending_review", "reviewed"), failedCents: sum("failed"), rejectedCents: sum("rejected") },
    byStatus,
  };
}

export async function officeDashboard(office: User) {
  const drivers = await officeDrivers(office.id);
  const [{ n: activeJobs }] = await db.select({ n: sql<number>`count(*)::int` }).from(offers).where(and(eq(offers.officeId, office.id), inArray(offers.status, OFFER_BUSY)));
  const [paid] = await db.select({ s: sql<number>`coalesce(sum(${settlements.providerCents}),0)::float8` }).from(settlements).where(and(eq(settlements.officeId, office.id), eq(settlements.status, "paid")));
  const acct = await ensureAccount(office.id);
  const [pend] = await db.select({ s: sql<number>`coalesce(sum(${settlements.providerCents}),0)::float8` }).from(settlements).where(and(eq(settlements.officeId, office.id), inArray(settlements.status, ["pending_review", "reviewed", "approved", "failed"])));
  return {
    readiness: await officeReadiness(office.id),
    drivers: { total: drivers.length, available: drivers.filter((d) => d.availability === "available" && d.verificationStatus === "verified" && !d.onJob).length, onJob: drivers.filter((d) => d.onJob).length },
    activeJobs, paidCents: paid.s,
    wallet: { availableCents: acct.availableCents, heldCents: acct.heldCents }, pendingSettlementCents: pend.s,
  };
}

// ───────── Agreements ─────────
export async function createAgreement(staff: User, officeId: string, i: { terms?: string; expiresAt?: Date | null }) {
  requirePerm(staff, "offices.manage");
  const [o] = await db.select().from(officeProfiles).where(eq(officeProfiles.userId, officeId));
  if (!o) throw err("NOT_FOUND");
  return db.transaction(async (tx) => {
    const [last] = await tx.select().from(officeAgreements).where(eq(officeAgreements.officeId, officeId)).orderBy(desc(officeAgreements.version)).limit(1);
    await tx.update(officeAgreements).set({ status: "superseded" }).where(and(eq(officeAgreements.officeId, officeId), eq(officeAgreements.status, "pending_acceptance")));
    const [a] = await tx.insert(officeAgreements).values({ officeId, version: (last?.version ?? 0) + 1, terms: i.terms, expiresAt: i.expiresAt ?? null, createdBy: staff.id, effectiveAt: new Date() }).returning();
    await notify(officeId, "agreement_pending", { version: a.version }, tx);
    await audit(staff, "agreement.create", "office_agreement", a.id, null, tx);
    return a;
  });
}
export async function currentAgreements(officeId: string) {
  return db.select().from(officeAgreements).where(eq(officeAgreements.officeId, officeId)).orderBy(desc(officeAgreements.version)).limit(5);
}
export async function acceptAgreement(office: User, id: string) {
  return db.transaction(async (tx) => {
    const [a] = await tx.select().from(officeAgreements).where(and(eq(officeAgreements.id, id), eq(officeAgreements.officeId, office.id))).for("update");
    if (!a || a.status !== "pending_acceptance") throw err("NOT_FOUND");
    await tx.update(officeAgreements).set({ status: "superseded" }).where(and(eq(officeAgreements.officeId, office.id), eq(officeAgreements.status, "accepted")));
    const [u] = await tx.update(officeAgreements).set({ status: "accepted", acceptedAt: new Date() }).where(eq(officeAgreements.id, id)).returning();
    await audit(office, "agreement.accept", "office_agreement", id, null, tx);
    return u;
  });
}
