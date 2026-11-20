import { createHash } from "node:crypto";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { offers, requests, shipments, type Offer } from "@/db/schema";
import { err } from "@/lib/errors";
import { env } from "@/lib/env";
import { describeError } from "@/lib/log";
import { getSettings } from "./settings";
import { logEvent } from "./events";
import { hit } from "./auth/ratelimit";
import { sendRecipientCodes } from "./shipments";
import { lockOffer, expect as expectState, forDriver } from "./jobs";
import { estimateLeg, geocodeAddress, planStops, type LatLng, type RouteProvider, type Stop } from "./routing";
import { pickupPinOf } from "./warehouse";
import { assertRoutingOn, isRoutingOn } from "./routing-mode";
import type { User } from "@/db/schema";

/**
 * Best-route planning for ONE driver's parcels (decision C13, supersedes C3's "static route").
 *
 * The route is planned (a) automatically when the warehouse hands the parcels over, (b) whenever the driver asks ("Re-optimise", from where they stand),
 * and it never changes silently while a stop is in progress: after the route is approved only the stops NOT yet reached are re-ordered —
 * the stop the driver is standing at stays first. Google does the optimising (see routing.ts for the chunking that gets around its 25-waypoint limit);
 * stops typed without a map pin are geocoded first; anything that cannot be located is kept at the end in manifest order and flagged.
 */

export interface StoredPlan {
  sig: string; provider: RouteProvider | "manual"; plannedAt: string; by: "system" | "driver"; manual?: boolean;
  origin: { lat: number; lng: number; source: "pickup" | "driver" | "stop" | "first_stop" } | null;
  totalDistanceM: number; totalDurationS: number;
  chunks: number; googleCalls: number; fallbackChunks: number;
  stops: number; unlocated: number; approximate: number; geocoded: number;
  warnings: string[];
}

const round = (n: number, d: number) => Math.round(n * 10 ** d) / 10 ** d;
const validPoint = (p: LatLng | null | undefined): p is LatLng => !!p && Number.isFinite(p.lat) && Number.isFinite(p.lng) && Math.abs(p.lat) <= 90 && Math.abs(p.lng) <= 180;

async function pool<T>(items: T[], n: number, fn: (x: T) => Promise<void>) {
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => { while (next < items.length) await fn(items[next++]); }));
}

/** Where the driver most likely is when the app has no GPS fix: the stop they finished last. */
async function lastFinishedStop(offerId: string): Promise<LatLng | null> {
  const [s] = await db.select({ lat: shipments.lat, lng: shipments.lng }).from(shipments)
    .where(and(eq(shipments.offerId, offerId), sql`${shipments.status} <> 'loaded'`, sql`${shipments.lat} is not null`)).orderBy(sql`coalesce(${shipments.deliveredAt}, ${shipments.failedAt}, ${shipments.updatedAt}) desc`).limit(1);
  return s && s.lat != null && s.lng != null ? { lat: s.lat, lng: s.lng } : null;
}

export interface PlanRequest { offerId: string; actor?: User | null; origin?: LatLng | null; force?: boolean; fetcher?: typeof fetch }
export interface PlanOutcome { plan: StoredPlan | null; cached: boolean; changed: boolean; currentId: string | null }

/**
 * Plans (or re-plans) the visiting order of the parcels the driver has on board. With `actor` it is the driver asking: they must own the job,
 * and the number of paid provider calls per job is capped. Without it, it is the system planning after hand-over.
 */
export async function planOfferRoute(q: PlanRequest): Promise<PlanOutcome> {
  await assertRoutingOn(); // J2: routing off → no planning, no Google call, `409 ROUTING_DISABLED`
  const [offer] = await db.select().from(offers).where(eq(offers.id, q.offerId));
  if (!offer) throw err("NOT_FOUND", "Offer not found");
  if (q.actor) forDriver(q.actor, offer);
  expectState(offer, "attendance_confirmed");
  if (offer.loadedUnits == null) throw err("INVALID_TRANSITION", "Nothing has been handed over yet");
  const [r] = await db.select().from(requests).where(eq(requests.id, offer.requestId));
  const rows = await db.select().from(shipments).where(and(eq(shipments.offerId, offer.id), eq(shipments.status, "loaded"))).orderBy(asc(shipments.stopOrder), asc(shipments.seq));
  const stored = (offer.routePlan ?? null) as StoredPlan | null;
  if (rows.length === 0) return { plan: stored, cached: true, changed: false, currentId: null };

  const approved = !!offer.routeApprovedAt;
  const oldCurrentId = approved ? rows[0].id : null;
  // The stop the driver is standing at is not moved: re-planning must never take them away from a recipient they are already serving.
  const pinned = approved && rows[0].arrivedAt ? rows[0] : null;
  const movable = pinned ? rows.slice(1) : rows;
  const settings = await getSettings();
  const city = settings.cities.find((c) => c.key === r.deliveryCity);
  const center = city ? { lat: city.lat, lng: city.lng } : null;
  const fetcher = q.fetcher ?? fetch;

  // ── origin ──
  let origin: (LatLng & { source: NonNullable<StoredPlan["origin"]>["source"] }) | null = null;
  let pickupFound: LatLng | null = null;
  let lastDone: LatLng | null = null;
  if (pinned && pinned.lat != null && pinned.lng != null) origin = { lat: pinned.lat, lng: pinned.lng, source: "stop" };
  else if (validPoint(q.origin)) origin = { ...q.origin, source: "driver" };
  else if (approved && (lastDone = await lastFinishedStop(offer.id))) origin = { ...lastDone, source: "stop" }; // mid-route without GPS: roughly where the last stop was
  else if (r.pickupLat != null && r.pickupLng != null) origin = { lat: r.pickupLat, lng: r.pickupLng, source: "pickup" };
  else if (r.pickupAddress && env.googleKey) {
    const pc = settings.cities.find((c) => c.key === r.pickupCity);
    try { const g = await geocodeAddress(r.pickupAddress, pc?.en ?? r.pickupCity, pc ? { lat: pc.lat, lng: pc.lng } : { lat: 24.7136, lng: 46.6753 }, { fetcher }); if (g) { pickupFound = { lat: g.lat, lng: g.lng }; origin = { ...pickupFound, source: "pickup" }; } } catch { /* falls through to NO_ORIGIN */ }
  }

  // ── locate stops that were typed without a pin ──
  const missing = movable.filter((s) => (s.lat == null || s.lng == null) && s.geoSource !== "unresolved"); // Google already said it cannot find these — not asked again until the address changes
  const found = new Map<string, { lat: number; lng: number; approximate: boolean }>();
  const unresolved: string[] = [];
  let geocodeFailed = 0;
  if (missing.length && env.googleKey && center) {
    await pool(missing.slice(0, 120), 5, async (s) => {
      try { const g = await geocodeAddress(s.address, city?.en ?? r.deliveryCity, center, { fetcher }); if (g) found.set(s.id, g); else unresolved.push(s.id); } catch { geocodeFailed++; }
    });
  }
  const withPin = movable.map((s) => { const f = found.get(s.id); return f ? { ...s, lat: f.lat, lng: f.lng } : s; });
  const located = withPin.filter((s) => s.lat != null && s.lng != null);
  const unlocated = withPin.filter((s) => s.lat == null || s.lng == null);
  if (!origin && located.length) origin = { lat: located[0].lat!, lng: located[0].lng!, source: "first_stop" };

  // ── same inputs as the last plan → nothing to pay for ──
  const sig = createHash("sha1").update(JSON.stringify({
    o: origin ? [round(origin.lat, 3), round(origin.lng, 3)] : null, // ~110 m: pressing the button twice in the same place is free p: pinned?.id ?? null, c: env.routeChunkSize, g: !!env.googleKey,
    s: located.map((s) => [s.id, round(s.lat!, 5), round(s.lng!, 5)]).sort((a, b) => String(a[0]).localeCompare(String(b[0]))), u: unlocated.map((s) => s.id).sort(),
  })).digest("hex");
  const planned = rows.every((s) => s.legDurationS != null || s.id === pinned?.id || unlocated.some((u) => u.id === s.id));
  if (!q.force && stored?.sig === sig && planned) return { plan: stored, cached: true, changed: false, currentId: rows[0].id };

  if (q.actor) await hit(`route:plan:${offer.id}`, 12, 3600); // paid provider calls: a driver can re-plan a handful of times an hour, not in a loop

  // ── plan (network; no DB transaction is held open) ──
  const result = origin && located.length
    ? await planStops(origin, located.map((s): Stop => ({ id: s.id, lat: s.lat!, lng: s.lng! })), { fetcher })
    : null;
  const warnings = [...(result?.warnings ?? [])];
  if (!origin) warnings.push("ROUTE_NO_ORIGIN");
  if (unlocated.length) warnings.push(`ROUTE_UNLOCATED_STOPS:${unlocated.length}`);
  const approximate = [...found.values()].filter((f) => f.approximate).length;
  if (approximate) warnings.push(`ROUTE_APPROXIMATE_LOCATIONS:${approximate}`);
  if (geocodeFailed) warnings.push("ROUTE_GEOCODING_FAILED");
  const order = [...(pinned ? [pinned.id] : []), ...(result?.order ?? located.map((s) => s.id)), ...unlocated.map((s) => s.id)];
  const plan: StoredPlan = {
    sig, provider: result?.provider ?? "local_heuristic", plannedAt: new Date().toISOString(), by: q.actor ? "driver" : "system",
    origin: origin ? { lat: origin.lat, lng: origin.lng, source: origin.source } : null,
    totalDistanceM: result?.totalDistanceM ?? 0, totalDurationS: result?.totalDurationS ?? 0,
    chunks: result?.chunks ?? 0, googleCalls: result?.googleCalls ?? 0, fallbackChunks: result?.fallbackChunks ?? 0,
    stops: rows.length, unlocated: unlocated.length, approximate, geocoded: found.size, warnings,
  };

  // ── persist ──
  let newCurrentId: string | null = null;
  const changed = await db.transaction(async (tx) => {
    const o = await lockOffer(tx, offer.id);
    if (o.status !== "attendance_confirmed" || !!o.routeApprovedAt !== approved) throw err("CONFLICT", "The job changed while the route was being planned — try again");
    const now = await tx.select({ id: shipments.id }).from(shipments).where(and(eq(shipments.offerId, o.id), eq(shipments.status, "loaded"))).for("update");
    const same = now.length === rows.length && now.every((s) => rows.some((x) => x.id === s.id));
    if (!same) throw err("CONFLICT", "The parcels on board changed while the route was being planned — try again");
    const [{ base }] = await tx.select({ base: sql<number>`coalesce(max(${shipments.stopOrder}), 0)::int` }).from(shipments).where(and(eq(shipments.offerId, o.id), sql`${shipments.status} <> 'loaded'`));
    const rowsSql = order.map((id, i) => {
      const leg = result?.legs[id];
      return sql`(${id}::uuid, ${base + i + 1}::int, ${id === pinned?.id ? null : leg?.distanceM ?? null}::int, ${id === pinned?.id ? null : leg?.durationS ?? null}::int, ${id === pinned?.id ? null : leg?.polyline ?? null}::text, ${id === pinned?.id}::boolean)`;
    });
    await tx.execute(sql`update shipments s set stop_order = v.ord,
        leg_distance_m = case when v.keep then s.leg_distance_m else v.dist end, leg_duration_s = case when v.keep then s.leg_duration_s else v.dur end,
        leg_polyline = case when v.keep then s.leg_polyline else v.poly end, updated_at = now()
      from (values ${sql.join(rowsSql, sql`, `)}) as v(id, ord, dist, dur, poly, keep) where s.id = v.id`);
    for (const [id, g] of found) await tx.update(shipments).set({ lat: g.lat, lng: g.lng, geoSource: g.approximate ? "geocoded_approx" : "geocoded" }).where(eq(shipments.id, id));
    if (unresolved.length) await tx.update(shipments).set({ geoSource: "unresolved" }).where(inArray(shipments.id, unresolved));
    if (pickupFound && r.pickupLat == null) await tx.update(requests).set({ pickupLat: pickupFound.lat, pickupLng: pickupFound.lng }).where(eq(requests.id, r.id));
    await tx.update(offers).set({ routePlan: plan as never, updatedAt: new Date() }).where(eq(offers.id, o.id));
    await logEvent(tx, {
      requestId: r.id, offerId: o.id, actor: q.actor ? { id: q.actor.id, name: q.actor.name, role: q.actor.role } : null, type: "route_planned",
      payload: { provider: plan.provider, stops: plan.stops, distanceM: plan.totalDistanceM, durationS: plan.totalDurationS, chunks: plan.chunks, fallbackChunks: plan.fallbackChunks, unlocated: plan.unlocated, by: plan.by, afterApproval: approved },
    });
    newCurrentId = approved ? order[0] ?? null : null;
    return order.some((id, i) => id !== rows[i]?.id);
  });
  // The recipient who is up next now gets their delivery code (a no-op if they were already texted).
  if (approved && newCurrentId && newCurrentId !== oldCurrentId) await sendRecipientCodes([newCurrentId]);
  return { plan, cached: false, changed, currentId: approved ? newCurrentId : order[0] ?? null };
}

/**
 * Best-effort planning right after hand-over: bounded, and never allowed to fail the hand-over — the driver can always re-plan by hand
 * and the parcels are in manifest order meanwhile.
 */
export async function autoPlanRoute(offerId: string, fetcher?: typeof fetch): Promise<void> {
  if (!(await isRoutingOn())) return; // J2: routing off → nothing is planned (and nothing is sent to Google)
  try {
    await Promise.race([
      planOfferRoute({ offerId, fetcher }),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error("route planning timed out")), 20_000).unref?.()),
    ]);
  } catch (e) {
    console.warn(JSON.stringify({ level: "warn", msg: "auto route plan failed", offerId, ...describeError(e) }));
  }
}

/** What the driver's clients show: the plan summary plus what is left of it. */
export function routeView(o: Pick<Offer, "status" | "loadedAckByDriver" | "routeApprovedAt" | "routePlan">, rows: Array<{ status: string; arrivedAt?: Date | null; legDistanceM: number | null; legDurationS: number | null }>, opts: { canReorder?: boolean } = {}) {
  const p = (o.routePlan ?? null) as StoredPlan | null;
  const left = rows.filter((s) => s.status === "loaded");
  // The leg INTO a stop the driver has already reached is behind them — it is not distance still to drive.
  const ahead = left.filter((s) => !s.arrivedAt);
  const active = o.status === "attendance_confirmed" && o.loadedAckByDriver === true;
  const movable = o.routeApprovedAt ? ahead.length : left.length; // after approval the stop being served is pinned
  return {
    planned: !!p, provider: p?.provider ?? null, plannedAt: p?.plannedAt ?? null, by: p?.by ?? null, manual: !!p?.manual,
    totalDistanceM: p?.totalDistanceM ?? 0, totalDurationS: p?.totalDurationS ?? 0,
    remainingDistanceM: ahead.reduce((a, s) => a + (s.legDistanceM ?? 0), 0), remainingDurationS: ahead.reduce((a, s) => a + (s.legDurationS ?? 0), 0),
    chunks: p?.chunks ?? 0, unlocated: p?.unlocated ?? 0, approximate: p?.approximate ?? 0, warnings: p?.warnings ?? [],
    googleConfigured: !!env.googleKey,
    canOptimize: active && left.length >= 2,
    canReorder: !!opts.canReorder && active && movable >= 2,
  };
}

/**
 * E5 — the driver arranges the remaining stops by hand. `order` = the ids of the not-yet-resolved stops that are free to move (the stop the
 * driver has arrived at is pinned first and is NOT part of `order`). Legs of the new order are estimated locally and their polylines cleared;
 * the plan is marked manual until the next optimisation.
 */
export async function reorderOfferRoute(driver: User, offerId: string, order: string[]) {
  const cfg = await getSettings();
  if (!cfg.routingEnabled) throw err("ROUTING_DISABLED", "Route planning is turned off by the platform"); // J2: no manual re-ordering either
  if (!cfg.driverCanReorderRoute) throw err("FEATURE_DISABLED", "Re-ordering the route is turned off by the platform");
  let oldFirst: string | null = null, newFirst: string | null = null, approved = false;
  const plan = await db.transaction(async (tx) => {
    const o = await lockOffer(tx, offerId);
    forDriver(driver, o);
    expectState(o, "attendance_confirmed");
    if (o.loadedAckByDriver !== true) throw err("INVALID_TRANSITION", "Finish loading before arranging the route");
    approved = !!o.routeApprovedAt;
    const rows = await tx.select().from(shipments).where(and(eq(shipments.offerId, o.id), eq(shipments.status, "loaded"))).orderBy(asc(shipments.stopOrder), asc(shipments.seq)).for("update");
    const pinned = approved && rows[0]?.arrivedAt ? rows[0] : null;
    const movable = pinned ? rows.slice(1) : rows;
    const ids = new Set(movable.map((m) => m.id));
    if (!Array.isArray(order) || order.length !== movable.length || new Set(order).size !== order.length || !order.every((id) => ids.has(id))) throw err("VALIDATION", "The order must list every remaining stop exactly once", { field: "order", expected: movable.length });
    oldFirst = rows[0]?.id ?? null;
    const byId = new Map(movable.map((m) => [m.id, m]));
    const sequence = [...(pinned ? [pinned] : []), ...order.map((id) => byId.get(id)!)];
    const stored = (o.routePlan ?? null) as StoredPlan | null;
    const [{ base }] = await tx.select({ base: sql<number>`coalesce(max(${shipments.stopOrder}), 0)::int` }).from(shipments).where(and(eq(shipments.offerId, o.id), sql`${shipments.status} <> 'loaded'`));
    let prev: LatLng | null = stored?.origin ? { lat: stored.origin.lat, lng: stored.origin.lng } : null;
    let totalD = 0, totalT = 0;
    for (let i = 0; i < sequence.length; i++) {
      const s = sequence[i];
      const here = s.lat != null && s.lng != null ? { lat: s.lat, lng: s.lng } : null;
      const keep = s.id === pinned?.id; // a stop already reached keeps its leg
      const leg = !keep && prev && here ? estimateLeg(prev, here) : null;
      if (!keep) { totalD += leg?.distanceM ?? 0; totalT += leg?.durationS ?? 0; }
      await tx.update(shipments).set({ stopOrder: base + i + 1, ...(keep ? {} : { legDistanceM: leg?.distanceM ?? null, legDurationS: leg?.durationS ?? null, legPolyline: null }), updatedAt: new Date() }).where(eq(shipments.id, s.id));
      if (here) prev = here;
    }
    const next: StoredPlan = {
      sig: `manual:${Date.now()}`, provider: "manual", plannedAt: new Date().toISOString(), by: "driver", manual: true,
      origin: stored?.origin ?? null, totalDistanceM: totalD, totalDurationS: totalT, chunks: 0, googleCalls: 0, fallbackChunks: 0,
      stops: sequence.length, unlocated: sequence.filter((s) => s.lat == null).length, approximate: stored?.approximate ?? 0, geocoded: stored?.geocoded ?? 0, warnings: [],
    };
    await tx.update(offers).set({ routePlan: next as never, updatedAt: new Date() }).where(eq(offers.id, o.id));
    await logEvent(tx, { requestId: o.requestId, offerId: o.id, actor: { id: driver.id, name: driver.name, role: driver.role }, type: "route_reordered", payload: { stops: sequence.length, afterApproval: approved } });
    newFirst = sequence[0]?.id ?? null;
    return next;
  });
  if (approved && newFirst && newFirst !== oldFirst) await sendRecipientCodes([newFirst]); // the recipient who is now up next gets their code
  return { plan, cached: false, changed: true, currentId: approved ? newFirst : null };
}

/** E6 — the legs of the stops still to do, in route order, for drawing on a map. `polyline: null` = an estimate: draw a straight line from→to. */
export async function routeGeometry(driver: User, offerId: string) {
  await assertRoutingOn(); // J2: no map / polyline data while routing is off
  const [o] = await db.select().from(offers).where(eq(offers.id, offerId));
  if (!o) throw err("NOT_FOUND", "Offer not found");
  forDriver(driver, o);
  const [r] = await db.select().from(requests).where(eq(requests.id, o.requestId));
  const rows = await db.select().from(shipments).where(and(eq(shipments.offerId, o.id), eq(shipments.status, "loaded"))).orderBy(asc(shipments.stopOrder), asc(shipments.seq));
  const plan = (o.routePlan ?? null) as StoredPlan | null;
  const pin = await pickupPinOf(r);
  const origin = plan?.origin ? { lat: plan.origin.lat, lng: plan.origin.lng } : pin;
  let prev: LatLng | null = origin;
  const legs = rows.map((s, i) => {
    const to = s.lat != null && s.lng != null ? { lat: s.lat, lng: s.lng } : null;
    const leg = { stopId: s.id, order: i + 1, from: prev, to, polyline: s.legPolyline, distanceM: s.legDistanceM ?? 0, durationS: s.legDurationS ?? 0 };
    if (to) prev = to;
    return leg;
  });
  return { origin, provider: plan?.provider ?? null, legs };
}
