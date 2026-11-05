import { and, desc, eq, inArray, ne, sql } from "drizzle-orm";
import { db } from "@/db";
import { officeInvites, officeAgreements, driverProfiles, users, offers, requests, officeProfiles, settlements, type User } from "@/db/schema";
import { err } from "@/lib/errors";
import { normalizePhone } from "@/lib/phone";
import { OFFER_BUSY } from "./catalog";
import { notify } from "./notify";
import { audit } from "./audit";
import { readyOfficeIds, evaluateCandidates } from "./matching";
import { requirePerm, can } from "./auth/permissions";
import { ensureAccount } from "./wallet";

export async function officeReadiness(officeId: string) {
  const [p] = await db.select().from(officeProfiles).where(eq(officeProfiles.userId, officeId));
  const [ag] = await db.select().from(officeAgreements).where(eq(officeAgreements.officeId, officeId)).orderBy(desc(officeAgreements.createdAt)).limit(1);
  const ready = (await readyOfficeIds(db, [officeId])).has(officeId);
  return { verification: p?.verificationStatus ?? "pending", agreement: ag?.status ?? "none", ready };
}

export async function inviteDriver(office: User, phoneRaw: string) {
  const phone = normalizePhone(phoneRaw);
  if (!phone) throw err("VALIDATION", "Invalid phone", { field: "phone" });
  const [off] = await db.select().from(officeProfiles).where(eq(officeProfiles.userId, office.id));
  if (off?.verificationStatus !== "verified") throw err("VERIFICATION_REQUIRED", "Your office must be verified first");
  const [drv] = await db.select().from(users).where(and(eq(users.phone, phone), eq(users.role, "driver")));
  if (drv) {
    const [p] = await db.select().from(driverProfiles).where(eq(driverProfiles.userId, drv.id));
    if (p?.officeId === office.id) throw err("CONFLICT", "Driver is already linked to your office");
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

export async function respondInvite(driver: User, inviteId: string, accept: boolean) {
  return db.transaction(async (tx) => {
    const [inv] = await tx.select().from(officeInvites).where(eq(officeInvites.id, inviteId)).for("update");
    if (!inv || inv.status !== "pending" || (inv.driverId !== driver.id && inv.phone !== driver.phone)) throw err("NOT_FOUND");
    if (accept) {
      const busy = await tx.select({ id: offers.id }).from(offers).where(and(eq(offers.driverId, driver.id), inArray(offers.status, OFFER_BUSY))).limit(1);
      if (busy.length) throw err("INVALID_TRANSITION", "Finish your active jobs before joining an office");
      await tx.update(driverProfiles).set({ officeId: inv.officeId, officeLinkStatus: "linked" }).where(eq(driverProfiles.userId, driver.id));
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
  await db.update(driverProfiles).set({ officeId: null, officeLinkStatus: "direct" }).where(eq(driverProfiles.userId, driverId));
  await notify(driverId, "office_unlinked");
  await audit(actor, "office.unlink_driver", "user", driverId);
}

export async function officeDrivers(officeId: string) {
  const rows = await db.select({ u: users, p: driverProfiles }).from(driverProfiles).innerJoin(users, eq(users.id, driverProfiles.userId)).where(eq(driverProfiles.officeId, officeId));
  const busy = await db.select({ d: offers.driverId }).from(offers).where(and(eq(offers.officeId, officeId), inArray(offers.status, OFFER_BUSY)));
  const busySet = new Set(busy.map((b) => b.d));
  return rows.map(({ u, p }) => ({
    id: u.id, name: u.name, phone: u.phone, city: u.city, vehicleType: p.vehicleType, vehicleTemperature: p.vehicleTemperature,
    verificationStatus: p.verificationStatus, availability: p.availability, onJob: busySet.has(u.id), jobsCompleted: p.jobsCompleted,
    rating: p.ratingCount ? Math.round((p.ratingSum / p.ratingCount) * 10) / 10 : null,
  }));
}

/** Requests the office can staff: preferred-to-office within the window, or open requests its drivers could take. */
export async function officeOpportunities(officeId: string) {
  const open = await db.select().from(requests).where(and(inArray(requests.status, ["published", "filling"]), sql`${requests.slotsFilled} < ${requests.quantity}`)).orderBy(requests.startsAt).limit(50);
  const out = [];
  for (const r of open) {
    if (r.preferredOfficeId && r.preferredOfficeId !== officeId) continue;
    const cands = (await evaluateCandidates(db, r, { onlyOfficeId: officeId })).filter((c) => !c.reasons.length);
    out.push({
      id: r.id, ref: r.ref, service: r.service, quantity: r.quantity, slotsFilled: r.slotsFilled, vehicleType: r.vehicleType, temperature: r.temperature,
      pickupCity: r.pickupCity, deliveryCity: r.deliveryCity, startsAt: r.startsAt, durationDays: r.durationDays, preferred: r.preferredOfficeId === officeId,
      windowEndsAt: r.officeWindowEndsAt, eligibleDrivers: cands.map((c) => ({ id: c.driverId, name: c.name, score: c.score })),
    });
  }
  return out;
}

export async function officeJobs(officeId: string) {
  const rows = await db.select({ o: offers, r: requests, d: users.name }).from(offers).innerJoin(requests, eq(requests.id, offers.requestId)).innerJoin(users, eq(users.id, offers.driverId))
    .where(and(eq(offers.officeId, officeId), ne(offers.status, "rejected"))).orderBy(desc(offers.createdAt)).limit(100);
  return rows.map(({ o, r, d }) => ({ offerId: o.id, requestId: r.id, ref: r.ref, status: o.status, driver: d, driverId: o.driverId, startsAt: r.startsAt, pickupCity: r.pickupCity, deliveryCity: r.deliveryCity, expectedUnits: o.expectedUnits, finalUnits: o.finalUnits }));
}

export async function officeDashboard(office: User) {
  const drivers = await officeDrivers(office.id);
  const jobs = await officeJobs(office.id);
  const acct = await ensureAccount(office.id);
  const [pend] = await db.select({ s: sql<number>`coalesce(sum(${settlements.providerCents}),0)::int` }).from(settlements).where(and(eq(settlements.officeId, office.id), inArray(settlements.status, ["pending_review", "reviewed", "approved", "failed"])));
  return {
    readiness: await officeReadiness(office.id),
    drivers: { total: drivers.length, available: drivers.filter((d) => d.availability === "available" && d.verificationStatus === "verified" && !d.onJob).length, onJob: drivers.filter((d) => d.onJob).length },
    activeJobs: jobs.filter((j) => (OFFER_BUSY as string[]).includes(j.status)).length,
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
