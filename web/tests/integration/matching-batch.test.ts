/**
 * A3 — candidate evaluation for a whole list of requests in a FIXED number of statements (driver opportunities, office opportunities, backfill on going online),
 * with exactly the results the per-request evaluation gives; and an idle maintenance tick that does not re-process drivers whose documents expired long ago.
 */
import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from "vitest";
import { and, eq, inArray, isNotNull, sql } from "drizzle-orm";
import { db, getPool } from "@/db";
import { driverProfiles, jobEvents, offers, requests, users, documents, type Request } from "@/db/schema";
import { shutdown, resetDb, mkAdmin, mkBusiness, mkDriver, mkOffice, mkRule, publishedRequest, mkShipments, tomorrow } from "../helpers/factories";
import { call } from "../helpers/api";
import { tok } from "../helpers/lifecycle-world";
import { activeJobs, backfillOffersForDriver, evaluateCandidates, evaluateCandidatesMany, readyOfficeIds, recentCancelCounts, type Candidate, type Reason } from "@/server/matching";
import { getSettings } from "@/server/settings";
import { SERVICE_MAP, TEMPERATURE_VEHICLES, type ServiceKey } from "@/server/catalog";
import { runMaintenance } from "@/server/maintenance";
import * as jobs from "@/server/jobs";

afterAll(shutdown);
beforeEach(resetDb);

/** Every statement that reaches Postgres while `fn` runs (drizzle sends non-transactional statements through the pool). */
async function statements<T>(fn: () => Promise<T>) {
  const pool = getPool(); const seen: string[] = [];
  const orig = pool.query.bind(pool) as (...a: unknown[]) => unknown;
  const spy = vi.spyOn(pool, "query").mockImplementation(((...a: unknown[]) => { seen.push(String((a[0] as { text?: string })?.text ?? a[0])); return orig(...a); }) as never);
  try { const result = await fn(); return { result, sqls: seen.slice() }; } finally { spy.mockRestore(); }
}
afterEach(() => vi.restoreAllMocks());

/** The ORIGINAL per-request algorithm (one full evaluation per request), kept here as the reference the batch must equal. */
async function reference(req: Request, opts: { driverIds?: string[]; onlyOfficeId?: string | null } = {}): Promise<Candidate[]> {
  const settings = await getSettings(db);
  const rows = await db.select({ u: users, p: driverProfiles }).from(users).innerJoin(driverProfiles, eq(driverProfiles.userId, users.id))
    .where(and(eq(users.role, "driver"), eq(users.status, "active"), opts.driverIds ? inArray(users.id, opts.driverIds) : sql`true`, opts.onlyOfficeId ? eq(driverProfiles.officeId, opts.onlyOfficeId) : sql`true`, sql`${req.service} = any(${driverProfiles.services})`));
  const ids = rows.map((r) => r.u.id);
  const busy = ids.length ? await db.select({ driverId: offers.driverId, startsAt: requests.startsAt, durationDays: requests.durationDays }).from(offers).innerJoin(requests, eq(requests.id, offers.requestId))
    .where(and(inArray(offers.driverId, ids), inArray(offers.status, ["accepted", "arrived", "attendance_confirmed", "delivered_reported", "qty_disputed", "pending_settlement"]))) : [];
  const existing = ids.length ? await db.select({ d: offers.driverId }).from(offers).where(and(eq(offers.requestId, req.id), isNotNull(offers.driverId), sql`${offers.status} <> 'expired'`)) : [];
  const offices = await readyOfficeIds(db, [...new Set(rows.map((r) => r.p.officeId).filter(Boolean) as string[])]);
  const offered = new Set(existing.map((e) => e.d));
  const active = settings.driverSingleActiveJob ? await activeJobs(db, ids) : new Map();
  const win = (r: { startsAt: Date; durationDays: number }) => ({ s: r.startsAt, e: new Date(r.startsAt.getTime() + Math.max(1, r.durationDays) * 864e5) });
  const w = win(req);
  const cancels = await recentCancelCounts(db, ids, settings.cancelWindowDays);
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
    if (offered.has(u.id)) reasons.push("already_offered");
    if (active.has(u.id)) reasons.push("busy");
    const mine = busy.filter((b) => b.driverId === u.id);
    if (settings.overlapPolicy === "single_active" ? mine.length > 0 : mine.some((b) => { const bw = win(b); return bw.s < w.e && w.s < bw.e; })) reasons.push("time_overlap");
    const factors: Record<string, number> = {};
    if (!reasons.length) { const avg = p.ratingCount ? p.ratingSum / p.ratingCount : 0; factors.base = 50; factors.rating = Math.min(Math.round(avg * 4), 20); factors.experience = Math.min(p.jobsCompleted, 10); factors.cancellations = -Math.min((cancels.get(u.id) ?? 0) * 3, 15); }
    const score = reasons.length ? 0 : Object.values(factors).reduce((a, b) => a + b, 0);
    return { driverId: u.id, name: u.name, city: u.city, vehicleType: p.vehicleType, score, reasons, factors, officeId: p.officeId };
  }).sort((a, b) => b.score - a.score || a.driverId.localeCompare(b.driverId));
}

const norm = (c: Candidate[]) => JSON.stringify(c);

describe("evaluateCandidatesMany = the per-request evaluation, request by request", () => {
  it("a mixed world: services, vehicles, cities, offices, suspensions, cancellations, active jobs, overlapping windows, existing offers", async () => {
    const admin = await mkAdmin(); await mkRule(admin);
    await mkRule(admin, { service: "car_with_driver", vehicleType: "sedan", pickupCity: "riyadh", deliveryCity: "riyadh", priceCents: 30000, providerCostCents: 20000 });
    const biz = await mkBusiness({ fundsCents: 20_000_00 });
    const okOffice = await mkOffice(), badOffice = await mkOffice({ verified: false });
    // first requests exist BEFORE the drivers (no offers yet), the next ones after (dispatch makes offers: "already_offered")
    const early = [await publishedRequest(biz, { shipments: mkShipments(2), shipmentsPerDriver: 2, startsAt: tomorrow(9) }), await publishedRequest(biz, { service: "car_with_driver", quantity: 1, vehicleType: "sedan", durationDays: 2, shipments: null, shipmentsPerDriver: null, startsAt: tomorrow(10) })];
    const drivers = [
      await mkDriver(), await mkDriver({ verified: false }), await mkDriver({ available: false }), await mkDriver({ vehicle: "hiace" }), await mkDriver({ city: "jeddah" }),
      await mkDriver({ services: ["car_with_driver"] }), await mkDriver({ officeId: okOffice.id }), await mkDriver({ officeId: badOffice.id }), await mkDriver(), await mkDriver(),
    ];
    await db.update(driverProfiles).set({ suspendedUntil: new Date(Date.now() + 864e5) }).where(eq(driverProfiles.userId, drivers[8].id));
    await db.insert(jobEvents).values({ requestId: early[0].id, type: "driver_cancelled", actorId: drivers[9].id, actorRole: "driver" });
    const late = [
      await publishedRequest(biz, { shipments: mkShipments(4), shipmentsPerDriver: 2, startsAt: tomorrow(9) }), // overlaps the first
      await publishedRequest(biz, { shipments: mkShipments(2), shipmentsPerDriver: 2, startsAt: new Date(Date.now() + 6 * 864e5) }),
      await publishedRequest(biz, { service: "car_with_driver", quantity: 2, vehicleType: "sedan", durationDays: 3, shipments: null, shipmentsPerDriver: null, startsAt: new Date(Date.now() + 8 * 864e5) }),
    ];
    // one driver is working an accepted job (busy / time_overlap for the others' windows)
    const o = (await db.select().from(offers).where(and(eq(offers.requestId, late[0].id), eq(offers.driverId, drivers[0].id))))[0];
    expect(o).toBeTruthy();
    await jobs.acceptOffer(drivers[0], o.id, true);
    const all = (await db.select().from(requests)).sort((a, b) => a.ref.localeCompare(b.ref));
    expect(all.length).toBe(5);
    const optionSets: Array<{ driverIds?: string[]; onlyOfficeId?: string | null }> = [{}, { driverIds: [drivers[0].id] }, { driverIds: [drivers[1].id, drivers[5].id, drivers[6].id] }, { onlyOfficeId: okOffice.id }];
    for (const opts of optionSets) {
      const many = await evaluateCandidatesMany(db, all, opts);
      for (const r of all) {
        expect(norm(many.get(r.id)!), `${r.ref} ${JSON.stringify(opts)}`).toBe(norm(await reference(r, opts)));
        expect(norm(await evaluateCandidates(db, r, opts))).toBe(norm(many.get(r.id)!));
      }
    }
    // the world really contains the variety the comparison is about
    const seen = new Set((await evaluateCandidatesMany(db, all)).get(all[0].id)!.flatMap((c) => c.reasons));
    for (const reason of ["not_verified", "unavailable", "vehicle_mismatch", "city_mismatch", "office_ineligible", "suspended"] as const) expect(seen.has(reason), reason).toBe(true);
  });
});

describe("bounded statement counts", () => {
  async function world(nRequests: number) {
    await resetDb();
    const admin = await mkAdmin(); await mkRule(admin);
    const biz = await mkBusiness({ fundsCents: 50_000_00 });
    const office = await mkOffice();
    const mine = await mkDriver({ available: false }); // no offers at publish time: every request is an opportunity for him afterwards
    const mates = [await mkDriver({ officeId: office.id, available: false }), await mkDriver({ officeId: office.id, available: false }), await mkDriver({ officeId: office.id, available: false })];
    for (let i = 0; i < nRequests; i++) await publishedRequest(biz, { shipments: mkShipments(2), shipmentsPerDriver: 2, startsAt: new Date(Date.now() + (i + 2) * 864e5) });
    await db.update(driverProfiles).set({ availability: "available" }).where(inArray(driverProfiles.userId, [mine.id, ...mates.map((m) => m.id)]));
    return { mine, office };
  }

  it("driver opportunities: the same number of statements for 3 and for 30 open requests, and the full list is returned", async () => {
    const small = await world(3); const ts = await tok(small.mine);
    const a = await statements(() => call("GET", "/driver/opportunities", { token: ts }));
    expect(a.result.status).toBe(200); expect(a.result.json.items).toHaveLength(3);
    const big = await world(30); const tb = await tok(big.mine);
    const b = await statements(() => call("GET", "/driver/opportunities", { token: tb }));
    expect(b.result.status).toBe(200); expect(b.result.json.items).toHaveLength(30);
    expect(b.sqls.length - a.sqls.length, `3 requests: ${a.sqls.length} statements, 30 requests: ${b.sqls.length}`).toBeLessThanOrEqual(2);
    expect(b.sqls.length).toBeLessThan(40);
  });

  it("office opportunities: bounded too (and every office driver is evaluated for every request)", async () => {
    const small = await world(3); const t3 = await tok(small.office);
    const x = await statements(() => call("GET", "/office/opportunities", { token: t3 }));
    expect(x.result.status).toBe(200); expect(x.result.json.items).toHaveLength(3);
    const big = await world(30); const t30 = await tok(big.office);
    const y = await statements(() => call("GET", "/office/opportunities", { token: t30 }));
    expect(y.result.json.items).toHaveLength(30);
    expect(y.result.json.items[0].eligibleDrivers).toHaveLength(3);
    expect(y.sqls.length - x.sqls.length, `3 requests: ${x.sqls.length}, 30 requests: ${y.sqls.length}`).toBeLessThanOrEqual(2);
    expect(y.sqls.length).toBeLessThan(40);
  });

  it("going online (backfill) offers the same requests as before and costs a fixed number of statements", async () => {
    const w = await world(25);
    const { sqls, result } = await statements(() => backfillOffersForDriver(w.mine.id, 10));
    expect(result).toBe(10); // capped by `max`, oldest start first
    expect(sqls.length, `${sqls.length} statements`).toBeLessThan(60); // 10 offers (insert + notification + milestone each) + a fixed read part — it was ~8 per open request on top
    const got = await db.select().from(offers).where(eq(offers.driverId, w.mine.id));
    expect(got).toHaveLength(10);
    const starts = (await db.select().from(requests).where(inArray(requests.id, got.map((g) => g.requestId)))).map((r) => r.startsAt.getTime()).sort((p, q) => p - q);
    const earliest = (await db.select().from(requests)).map((r) => r.startsAt.getTime()).sort((p, q) => p - q).slice(0, 10);
    expect(starts).toEqual(earliest);
  });
});

describe("an idle maintenance tick does not re-process expired documents", () => {
  async function driverWithExpiredDoc(status: string, replacement: boolean) {
    const d = await mkDriver();
    await db.update(driverProfiles).set({ verificationStatus: status }).where(eq(driverProfiles.userId, d.id));
    const base = { ownerId: d.id, ownerKind: "driver", storageKey: "k", fileName: "f.png", mime: "image/png", size: 10, status: "approved" } as const;
    await db.insert(documents).values([{ ...base, type: "national_id" }, { ...base, type: "vehicle_registration" }, { ...base, type: "driving_license", expiresOn: "2020-01-01" }, ...(replacement ? [{ ...base, type: "driving_license", expiresOn: "2099-01-01" }] : [])]);
    return d;
  }
  const verificationWrites = (sqls: string[]) => sqls.filter((q) => /update "driver_profiles" set "verification_status"/.test(q));
  const documentReads = (sqls: string[]) => sqls.filter((q) => /from "documents"|from documents/.test(q));

  it("the first tick flips exactly the drivers whose status changes; the second tick writes nothing and reads documents once", async () => {
    const flip = [await driverWithExpiredDoc("verified", false), await driverWithExpiredDoc("verified", false), await driverWithExpiredDoc("pending", false)];
    const renewed = [await driverWithExpiredDoc("verified", true), await driverWithExpiredDoc("verified", true)]; // an expired old licence, a valid new one: nothing to do
    const already = [await driverWithExpiredDoc("expired", false), await driverWithExpiredDoc("expired", false)];
    const t1 = await statements(() => runMaintenance());
    expect(t1.result.driversRecomputed).toBe(3);
    expect(verificationWrites(t1.sqls)).toHaveLength(3);
    const status = async (id: string) => (await db.select().from(driverProfiles).where(eq(driverProfiles.userId, id)))[0].verificationStatus;
    for (const d of flip) expect(await status(d.id)).toBe("expired");
    for (const d of renewed) expect(await status(d.id)).toBe("verified");
    for (const d of already) expect(await status(d.id)).toBe("expired");
    const t2 = await statements(() => runMaintenance());
    expect(t2.result.driversRecomputed).toBe(0);
    expect(verificationWrites(t2.sqls)).toEqual([]);
    expect(documentReads(t2.sqls).length, documentReads(t2.sqls).join("\n")).toBe(1); // the one selection, no per-driver recompute
    expect(t2.result.errors).toEqual([]);
  });

  it("a driver whose replacement is approved later is verified again by the review, and the tick leaves him alone", async () => {
    const d = await driverWithExpiredDoc("verified", false);
    await runMaintenance();
    expect((await db.select().from(driverProfiles).where(eq(driverProfiles.userId, d.id)))[0].verificationStatus).toBe("expired");
    const { recomputeDriverVerification } = await import("@/server/accounts");
    await db.insert(documents).values({ ownerId: d.id, ownerKind: "driver", type: "driving_license", storageKey: "k2", fileName: "f.png", mime: "image/png", size: 10, status: "approved", expiresOn: "2099-01-01" });
    expect(await recomputeDriverVerification(d.id)).toBe("verified"); // what `reviewDocument` does on approval
    const t = await statements(() => runMaintenance());
    expect(t.result.driversRecomputed).toBe(0);
    expect(verificationWrites(t.sqls)).toEqual([]);
    expect((await db.select().from(driverProfiles).where(eq(driverProfiles.userId, d.id)))[0].verificationStatus).toBe("verified");
  });
});
