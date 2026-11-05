import { and, eq, inArray, isNotNull, isNull, lt, or, sql } from "drizzle-orm";
import { db, type Exec } from "@/db";
import {
  driverProfiles, users, offers, requests, officeProfiles, officeAgreements, jobEvents,
  type Request,
} from "@/db/schema";
import { OFFER_BUSY, TEMPERATURE_VEHICLES, SERVICE_MAP, type ServiceKey } from "./catalog";
import { getSettings, type Settings } from "./settings";
import { notifyMany } from "./notify";
import { logEvent } from "./events";

export type Reason =
  | "not_verified" | "unavailable" | "suspended" | "service_mismatch" | "vehicle_mismatch" | "temp_mismatch"
  | "city_mismatch" | "office_ineligible" | "different_office" | "already_offered" | "time_overlap" | "busy";

export interface Candidate {
  driverId: string; name: string; city: string | null; vehicleType: string | null;
  score: number; reasons: Reason[]; factors: Record<string, number>; officeId: string | null;
}

const windowOf = (r: Pick<Request, "startsAt" | "durationDays">) => ({
  start: r.startsAt, end: new Date(r.startsAt.getTime() + Math.max(1, r.durationDays) * 864e5),
});

/** Offices whose drivers may work: verified account + accepted, unexpired agreement. */
export async function readyOfficeIds(x: Exec, ids: string[]): Promise<Set<string>> {
  if (!ids.length) return new Set();
  const rows = await x.select({ id: officeProfiles.userId }).from(officeProfiles)
    .innerJoin(users, eq(users.id, officeProfiles.userId))
    .where(and(inArray(officeProfiles.userId, ids), eq(officeProfiles.verificationStatus, "verified"), eq(users.status, "active"),
      sql`exists (select 1 from ${officeAgreements} a where a.office_id = ${officeProfiles.userId} and a.status = 'accepted' and (a.expires_at is null or a.expires_at > now()))`));
  return new Set(rows.map((r) => r.id));
}

/** Busy intervals of a set of drivers. */
async function busyWindows(x: Exec, driverIds: string[]) {
  if (!driverIds.length) return [];
  return x.select({ driverId: offers.driverId, startsAt: requests.startsAt, durationDays: requests.durationDays })
    .from(offers).innerJoin(requests, eq(requests.id, offers.requestId))
    .where(and(inArray(offers.driverId, driverIds), inArray(offers.status, OFFER_BUSY)));
}

export async function driverHasConflict(x: Exec, driverId: string, req: Pick<Request, "startsAt" | "durationDays">, policy: Settings["overlapPolicy"]) {
  const busy = await busyWindows(x, [driverId]);
  if (policy === "single_active") return busy.length > 0;
  const w = windowOf(req);
  return busy.some((b) => { const bw = windowOf(b); return bw.start < w.end && w.start < bw.end; });
}

/** Hard eligibility guards + explainable score. Score never overrides a guard. */
export async function evaluateCandidates(x: Exec, req: Request, opts: { driverIds?: string[]; onlyOfficeId?: string | null } = {}): Promise<Candidate[]> {
  const settings = await getSettings(x);
  const rows = await x.select({ u: users, p: driverProfiles }).from(users)
    .innerJoin(driverProfiles, eq(driverProfiles.userId, users.id))
    .where(and(eq(users.role, "driver"), eq(users.status, "active"),
      opts.driverIds ? inArray(users.id, opts.driverIds) : sql`true`,
      opts.onlyOfficeId ? eq(driverProfiles.officeId, opts.onlyOfficeId) : sql`true`,
      sql`${req.service} = any(${driverProfiles.services})`));
  const ids = rows.map((r) => r.u.id);
  // Sequential on purpose: `x` may be a single transaction connection (no concurrent queries).
  const busy = await busyWindows(x, ids);
  const existing = ids.length ? await x.select({ d: offers.driverId }).from(offers).where(and(eq(offers.requestId, req.id), isNotNull(offers.driverId), sql`${offers.status} <> 'expired'`)) : [];
  const offices = await readyOfficeIds(x, [...new Set(rows.map((r) => r.p.officeId).filter(Boolean) as string[])]);
  const offered = new Set(existing.map((e) => e.d));
  const w = windowOf(req);
  const recentCancels = await recentCancelCounts(x, ids, settings.cancelWindowDays);
  const needsTemp = req.vehicleType ? TEMPERATURE_VEHICLES.includes(req.vehicleType) : false;
  const now = new Date();
  return rows.map(({ u, p }) => {
    const reasons: Reason[] = [];
    if (settings.requireDriverVerification && p.verificationStatus !== "verified") reasons.push("not_verified");
    if (p.availability !== "available") reasons.push("unavailable");
    if (p.suspendedUntil && p.suspendedUntil > now) reasons.push("suspended");
    if (req.vehicleType && p.vehicleType !== req.vehicleType && SERVICE_MAP[req.service as ServiceKey]?.needsVehicle) reasons.push("vehicle_mismatch");
    if (needsTemp && req.temperature && p.vehicleTemperature !== req.temperature) reasons.push("temp_mismatch");
    if (u.city && req.pickupCity && u.city !== req.pickupCity) reasons.push("city_mismatch");
    if (p.officeId && !offices.has(p.officeId)) reasons.push("office_ineligible");
    if (req.preferredOfficeId && p.officeId !== req.preferredOfficeId && opts.onlyOfficeId === undefined) { /* office window handled by caller */ }
    if (offered.has(u.id)) reasons.push("already_offered");
    const mine = busy.filter((b) => b.driverId === u.id);
    if (settings.overlapPolicy === "single_active" ? mine.length > 0 : mine.some((b) => { const bw = windowOf(b); return bw.start < w.end && w.start < bw.end; })) reasons.push("time_overlap");
    const factors: Record<string, number> = {};
    if (!reasons.length) {
      const avg = p.ratingCount ? p.ratingSum / p.ratingCount : 0;
      factors.base = 50;
      factors.rating = Math.min(Math.round(avg * 4), 20);
      factors.experience = Math.min(p.jobsCompleted, 10);
      factors.cancellations = -Math.min((recentCancels.get(u.id) ?? 0) * 3, 15);
    }
    const score = reasons.length ? 0 : Object.values(factors).reduce((a, b) => a + b, 0);
    return { driverId: u.id, name: u.name, city: u.city, vehicleType: p.vehicleType, score, reasons, factors, officeId: p.officeId };
  }).sort((a, b) => b.score - a.score || a.driverId.localeCompare(b.driverId));
}

export async function recentCancelCounts(x: Exec, driverIds: string[], days: number) {
  const map = new Map<string, number>();
  if (!driverIds.length) return map;
  const rows = await x.select({ d: jobEvents.actorId, c: sql<number>`count(*)::int` }).from(jobEvents)
    .where(and(eq(jobEvents.type, "driver_cancelled"), inArray(jobEvents.actorId, driverIds),
      sql`${jobEvents.createdAt} > now() - make_interval(days => ${days})`)).groupBy(jobEvents.actorId);
  for (const r of rows) if (r.d) map.set(r.d, r.c);
  return map;
}

export const earningFor = (providerCostCents: number, units: number) => providerCostCents * units;

/**
 * Create offers for the best eligible candidates for open slots.
 * Returns the number of offers created. Safe to call repeatedly (already_offered guard + unique index).
 */
export async function dispatchOffers(x: Exec, req: Request, opts: { replacement?: boolean; replacesOfferId?: string | null; max?: number; onlyOfficeId?: string | null } = {}) {
  if (SERVICE_MAP[req.service as ServiceKey]?.driverless) return 0;
  const snap = req.pricingSnapshot as { providerCostCents: number; expectedUnits: number } | null;
  if (!snap) return 0;
  const open = Math.max(0, req.quantity - req.slotsFilled);
  if (open === 0) return 0;
  const cands = (await evaluateCandidates(x, req, { onlyOfficeId: opts.onlyOfficeId })).filter((c) => !c.reasons.length);
  const take = cands.slice(0, opts.max ?? Math.min(open * 5, 30));
  if (!take.length) return 0;
  const created = await x.insert(offers).values(take.map((c) => ({
    requestId: req.id, driverId: c.driverId, officeId: c.officeId, status: "offered", source: opts.replacement ? "replacement" : "system",
    isReplacement: !!opts.replacement, replacesOfferId: opts.replacesOfferId ?? null,
    expectedUnits: snap.expectedUnits, expectedEarningCents: earningFor(snap.providerCostCents, snap.expectedUnits),
  }))).onConflictDoNothing().returning({ id: offers.id, driverId: offers.driverId });
  await notifyMany(created.map((c) => c.driverId), opts.replacement ? "offer_replacement" : "offer_new", { requestId: req.id, ref: req.ref }, x);
  await logEvent(x, { requestId: req.id, type: "offers_dispatched", payload: { count: created.length, replacement: !!opts.replacement } });
  return created.length;
}

export { db };

/**
 * When a driver comes online, offer them open requests they qualify for. Without this, a request published while
 * no matching driver was online could never reach someone who goes online a minute later.
 */
export async function backfillOffersForDriver(driverId: string, max = 10, x: Exec = db) {
  const open = await x.select().from(requests).where(and(
    inArray(requests.status, ["published", "filling"]), sql`${requests.slotsFilled} < ${requests.quantity}`, sql`${requests.service} <> 'car_without_driver'`,
    sql`${requests.startsAt} > now()`, or(isNull(requests.officeWindowEndsAt), lt(requests.officeWindowEndsAt, new Date())),
  )).orderBy(requests.startsAt).limit(50);
  let created = 0;
  for (const r of open) {
    if (created >= max) break;
    const snap = r.pricingSnapshot as { providerCostCents: number; expectedUnits: number } | null;
    if (!snap) continue;
    const [c] = await evaluateCandidates(x, r, { driverIds: [driverId] });
    if (!c || c.reasons.length) continue;
    const ins = await x.insert(offers).values({
      requestId: r.id, driverId, officeId: c.officeId, status: "offered", source: "system", expectedUnits: snap.expectedUnits,
      expectedEarningCents: earningFor(snap.providerCostCents, snap.expectedUnits),
    }).onConflictDoNothing().returning({ id: offers.id });
    if (ins.length) { created++; await notifyMany([driverId], "offer_new", { requestId: r.id, ref: r.ref }, x); }
  }
  return created;
}
