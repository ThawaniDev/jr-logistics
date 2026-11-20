import { TEMPERATURE_VEHICLES } from "@/server/catalog";
import { DAY, HOUR, MIN, ksa } from "./calendar";
import { isActiveAt, isFreeAt, isOnline, nextOnlineStart, officeAt } from "./schedule";
import { Life, type Offer, type OfferRow, type JobPlan } from "./life";
import { Tl } from "./timeline";
import { NO_SHOW_REASONS } from "./names";
import { clamp } from "./prng";
import type { DriverSim, Ctx } from "./types";

/**
 * Matching and acceptance, as the real code does it: eligible drivers are offered the order (online ones at once, the rest when they next go online),
 * respond after a while, the first N to accept fill the N slots, everybody else is expired; drivers may cancel or not show up, which opens a slot
 * and starts a replacement wave. Everything is decided with the driver's latent quality `q`.
 */
const seedOf = (ctx: Ctx) => ctx.opts.seed;

export function officeReady(ctx: Ctx, officeId: string, t: number): boolean {
  const o = ctx.w.offices.find((x) => x.id === officeId);
  if (!o || !o.agreementAt || o.agreementAt > t || o.status === "suspended" && t > o.agreementAt + 35 * DAY) return false;
  return o.verification === "verified" || (o.verification === "suspended" && t <= o.agreementAt + 35 * DAY);
}

export function eligible(R: Life, d: DriverSim, t: number): boolean {
  const p = R.plan, ctx = R.ctx;
  if (!d.services.includes(p.service) || d.vehicleType !== p.vehicleType || d.city !== p.pickupCity) return false;
  if (TEMPERATURE_VEHICLES.includes(p.vehicleType) && p.temperature && d.temperature !== p.temperature) return false;
  if (!isActiveAt(d, t) || R.offered.has(d.id) || !isFreeAt(d, t)) return false;
  const off = officeAt(d, t);
  return !off || officeReady(ctx, off, t);
}

const recentCancels = (d: DriverSim, t: number, days: number) => d.cancels.filter((c) => c <= t && c > t - days * DAY).length;
export function scoreOf(ctx: Ctx, d: DriverSim, t: number): number {
  const avg = d.ratingCount ? d.ratingSum / d.ratingCount : 0;
  return 50 + Math.min(Math.round(avg * 4), 20) + Math.min(d.jobsCompleted, 10) - Math.min(recentCancels(d, t, ctx.base.cancelWindowDays) * 3, 15);
}

interface Cand { d: DriverSim; created: number; kind: "accept" | "reject" | "ignore"; tResp: number; wave: "A" | "B"; score: number }

function expectedEarningSar(R: Life) {
  const p = R.plan; return (p.rule.providerCostCents * (p.service === "delivery_driver" ? p.perDriver ?? 1 : p.durationDays)) / 100;
}

function respond(R: Life, d: DriverSim, created: number, backfill: boolean): { kind: Cand["kind"]; tResp: number } {
  const rng = R.rng, ctx = R.ctx;
  const h = ksa(created).hour;
  const earn = expectedEarningSar(R);
  const pAcc = clamp(d.acceptBase * (h >= 23 || h < 6 ? 0.5 : 1) * (earn < 40 ? 0.82 : earn < 150 ? 1 : 1.12), 0.04, 0.95);
  const delayMin = Math.max(0.4, rng.logNormal(backfill ? 5 : d.respMedian, 0.85));
  const u = rng.next();
  let kind: Cand["kind"] = u < pAcc ? "accept" : rng.chance(0.5) ? "reject" : "ignore";
  if (delayMin * MIN > ctx.base.offerExpiryMin * MIN) kind = "ignore";
  return { kind, tResp: created + Math.round(delayMin * MIN) };
}

function candidates(R: Life, t: number, open: number, deadline: number): Cand[] {
  const { ctx, plan } = R;
  const seed = seedOf(ctx);
  const out: Cand[] = [];
  const online: Array<{ d: DriverSim; score: number }> = [];
  const later: Array<{ d: DriverSim; at: number }> = [];
  for (const d of ctx.w.drivers) {
    if (!eligible(R, d, t)) continue;
    if (isOnline(d, seed, t)) online.push({ d, score: scoreOf(ctx, d, t) });
    else {
      const at = nextOnlineStart(d, seed, t, Math.min(plan.startsAt - 15 * MIN, deadline));
      if (at != null && isFreeAt(d, at) && !later.some((x) => x.d === d)) later.push({ d, at });
    }
  }
  online.sort((a, b) => b.score - a.score || a.d.id.localeCompare(b.d.id));
  const take = online.slice(0, Math.min(open * 5, 30));
  for (const x of take) { const created = t + R.rng.int(0, 20) * 1000; out.push({ d: x.d, created, ...respond(R, x.d, created, false), wave: "A", score: x.score }); }
  // Drivers who are offline now get the order when they come online (the platform's "backfill"): at most 10 each, never after the start.
  for (const x of later) { const created = x.at + R.rng.int(20, 240) * 1000; out.push({ d: x.d, created, ...respond(R, x.d, created, true), wave: "B", score: scoreOf(ctx, x.d, x.at) }); }
  return out;
}

export function newOffer(R: Life, d: DriverSim, created: number, o: { source: string; replacement: boolean; replacesId: string | null }): Offer {
  const { ctx, plan } = R;
  const id = ctx.ids.next("offer");
  const units = plan.service === "delivery_driver" ? plan.perDriver ?? 1 : plan.durationDays;
  const officeId = officeAt(d, created);
  const base = {
    id, requestId: plan.id, driverId: d.id, officeId, status: "offered", source: o.source, isReplacement: o.replacement, replacesOfferId: o.replacesId,
    expectedUnits: units, expectedEarningCents: plan.rule.providerCostCents * units, createdAt: new Date(created), updatedAt: new Date(created),
  };
  const O: Offer = { id, driver: d, tl: new Tl<OfferRow>(base), createdAt: created, source: o.source, replacement: o.replacement, replacesId: o.replacesId, parcels: [], jobPlan: null, dead: false,
    acceptedAt: null, completedAt: null, tDone: null, officeId, delivered: 0, failedCount: 0, codCollected: 0, settlementId: null, held: false, endedEarly: false, paidAt: null, job: null };
  R.offers.push(O);
  R.offered.add(d.id);
  return O;
}

/**
 * Offers one wave of drivers and works out who wins the open slots. `deadline`: nothing after it happens (the request was cancelled).
 * Returns the winning offers (not yet accepted: see `acceptOffer`) — non-winners are already expired / rejected here.
 */
export function runWave(R: Life, t: number, open: number, o: { replacement: boolean; replacesId: string | null; deadline: number; source?: string }): { winners: Array<{ offer: Offer; at: number }>; created: Offer[]; dispatched: number } {
  const { ctx } = R;
  const exp = ctx.base.offerExpiryMin * MIN;
  const cands = candidates(R, t, open, o.deadline);
  if (!o.replacement && cands.length === 0) {
    const p = R.plan, drv = ctx.w.drivers.filter((d) => d.services.includes(p.service) && d.vehicleType === p.vehicleType && d.city === p.pickupCity && (!p.temperature || d.temperature === p.temperature || !TEMPERATURE_VEHICLES.includes(p.vehicleType)));
    const act = drv.filter((d) => isActiveAt(d, t)), free = act.filter((d) => isFreeAt(d, t)), onl = free.filter((d) => isOnline(d, seedOf(ctx), t));
    const k = !drv.length ? "no-such-driver" : !act.length ? "none-active" : !free.length ? "all-busy" : !onl.length ? "all-offline" : "other";
    ctx.stats[`dbg:wave0:${k}`] = (ctx.stats[`dbg:wave0:${k}`] ?? 0) + 1;
  }
  const accepts = cands.filter((c) => c.kind === "accept").sort((a, b) => a.tResp - b.tResp);
  const winnersC: Cand[] = [];
  let fillT: number | null = null;
  for (const c of accepts) {
    if (c.tResp > o.deadline) break;
    if (!isFreeAt(c.d, c.tResp) || !isActiveAt(c.d, c.tResp)) { c.kind = "ignore"; continue; }
    winnersC.push(c);
    if (winnersC.length >= open) { fillT = c.tResp; break; }
  }
  if (!o.replacement && cands.length > 0 && winnersC.length === 0) { const k = accepts.length === 0 ? "dbg:wave0:no-accepts" : accepts.every((c) => c.tResp > o.deadline) ? "dbg:wave0:accepts-too-late" : "dbg:wave0:accept-conflict"; ctx.stats[k] = (ctx.stats[k] ?? 0) + 1; }
  const kept = cands.filter((c) => c.created <= o.deadline && (fillT == null || c.created <= fillT));
  const created: Offer[] = [], winners: Array<{ offer: Offer; at: number }> = [];
  for (const c of kept.sort((a, b) => a.created - b.created)) {
    const O = newOffer(R, c.d, c.created, { source: o.source ?? (o.replacement ? "replacement" : "system"), replacement: o.replacement, replacesId: o.replacesId });
    created.push(O);
    const earning = O.officeId ? null : R.plan.rule.providerCostCents * (R.plan.service === "delivery_driver" ? R.plan.perDriver ?? 1 : R.plan.durationDays);
    R.notify(c.created, c.d.id, o.replacement ? "offer_replacement" : "offer_new", { requestId: R.plan.id, ref: R.plan.ref, offerId: O.id, parcels: R.plan.service === "delivery_driver" ? R.plan.perDriver : R.plan.durationDays, pickupCity: R.plan.pickupCity, deliveryCity: R.plan.deliveryCity, earningCents: earning });
    if (winnersC.includes(c)) { winners.push({ offer: O, at: c.tResp }); continue; }
    if (c.kind === "reject" && c.tResp <= o.deadline && (fillT == null || c.tResp <= fillT) && c.tResp < c.created + exp) {
      O.tl.at(c.tResp, { status: "rejected" });
      R.ev(c.tResp, "offer_rejected", R.driverActor(c.d), { offer: O, old: "offered", neu: "rejected" });
      continue;
    }
    // never answered, or answered too late: it expires with the request filling up or after the offer window
    const te = Math.min(c.created + exp, fillT ?? Infinity);
    if (te <= o.deadline) O.tl.at(te, { status: "expired" });
  }
  const dispatched = created.filter((x) => cands.find((c) => c.d === x.driver)?.wave === "A").length;
  if (dispatched > 0) R.ev(t + 1, "offers_dispatched", null, { payload: { count: dispatched, replacement: o.replacement } });
  return { winners: winners.sort((a, b) => a.at - b.at), created, dispatched };
}

/** The balanced share of the manifest this driver carries: pool ÷ slots left (rounded up), never more than the vehicle plan. */
export function allocate(R: Life, O: Offer, t: number, slotsLeft: number) {
  if (R.plan.service !== "delivery_driver") return 0;
  const pool = R.parcels.filter((p) => !p.offer);
  if (!pool.length) return 0;
  const take = pool.slice(0, Math.min(Math.ceil(pool.length / Math.max(1, slotsLeft)), R.plan.perDriver ?? pool.length));
  take.forEach((p, i) => { p.offer = O; O.parcels.push(p); p.tl.at(t, { offerId: O.id, stopOrder: i + 1 }); R.pev(t, p, "assigned", R.driverActor(O.driver), O, { driverId: O.driver.id }); });
  O.tl.at(t, { expectedUnits: take.length, expectedEarningCents: R.plan.rule.providerCostCents * take.length });
  R.ev(t - 1, "shipments_allocated", null, { offer: O, payload: { count: take.length } });
  return take.length;
}

export function acceptOffer(R: Life, O: Offer, tA: number, slotsLeft: number) {
  const { ctx, plan } = R;
  const d = O.driver;
  allocate(R, O, tA, slotsLeft);
  O.acceptedAt = tA;
  O.job = { acc: tA, end: Infinity };
  d.jobs.push(O.job);
  R.tl.at(tA, (s) => { const filled = (s.slotsFilled ?? 0) + 1; return { slotsFilled: filled, status: filled >= (s.quantity ?? 1) ? "assigned" : "filling" }; });
  O.tl.at(tA, { status: "accepted", acceptedAt: new Date(tA) });
  R.ev(tA, "driver_accepted", R.driverActor(d), { offer: O, old: "offered", neu: "accepted" });
  R.events[R.events.length - 1].late = true; // payload.requestStatus is derived from the request's state at that moment, when the events are written
  R.notify(tA, plan.company.id, "driver_accepted", { requestId: plan.id, ref: plan.ref, driver: d.name });
  if (O.officeId) R.notify(tA, O.officeId, "office_driver_accepted", { ref: plan.ref, driver: d.name });
  R.on(tA, () => ctx.sink.add("termsConsents", { id: ctx.ids.next("terms"), userId: d.id, role: "driver", termsVersion: ctx.base.termsVersion, context: "offer_accept", ip: null, acceptedAt: new Date(tA) }));
}

/** A slot opens (cancel / no-show / replacement): the request goes back to `filling` and a replacement wave starts. */
export function freeSlot(R: Life, O: Offer, t: number, why: string, deadline: number): { winners: Array<{ offer: Offer; at: number }> } {
  R.tl.at(t, (s) => ({ slotsFilled: Math.max((s.slotsFilled ?? 0) - 1, 0), status: ["in_progress", "assigned", "confirmed"].includes(s.status ?? "") ? "filling" : s.status }));
  if (O.job) O.job.end = t;
  const w = runWave(R, t + 2000, 1, { replacement: true, replacesId: O.id, deadline });
  R.ev(t + 3000, "replacement_requested", null, { offer: O, payload: { why, offers: w.dispatched } });
  if (w.dispatched === 0) R.notify(t + 3000, R.ctx.w.admin.id, "no_replacement_available", { ref: R.plan.ref });
  return { winners: w.winners };
}

/** Parcels of a job that did not happen go back to the pool; the warehouse / the next driver picks them up. */
export function releaseParcels(R: Life, O: Offer, t: number, why: string) {
  const back = O.parcels.filter((p) => p.offer === O);
  for (const p of back) {
    p.tl.at(t, { offerId: null, stopOrder: null, status: "pending", loadedAt: null, notifiedAt: null });
    R.pev(t, p, "unassigned", null, O, { why });
    p.offer = null;
  }
  O.parcels = [];
  if (back.length) R.ev(t + 1, "shipments_released", null, { offer: O, payload: { why, toPool: back.length, toReturn: 0 } });
  return back.length;
}

/** Everything about the job's timing, decided when the driver wins it (the request's closing logic needs arrival and attendance times). */
export function drawJobPlan(R: Life, O: Offer, tA: number): JobPlan {
  const { rng, plan, ctx } = R;
  const d = O.driver, s = plan.startsAt, q = d.q;
  const afterStart = tA > s - 10 * MIN;
  const co = plan.company;
  const autoAttend = co.ops?.requireArrivalConfirmation === false;
  const scanMode = co.ops?.requireLoadingRecord !== true;
  const pCancel = (afterStart ? 0.01 : 0.006 + 0.3 * (1 - q) ** 3 + (q < 0.3 ? 0.18 : 0)) * (s - tA < 30 * MIN ? 0.3 : 1); // the unreliable few cancel often enough to hit the strike policy
  const pNoShow = afterStart ? 0.004 : 0.003 + 0.14 * (1 - q) ** 3;
  const roll = rng.next();
  let fate: JobPlan["fate"] = "ok", tFate = 0;
  const maxLead = plan.service === "delivery_driver" ? 0 : 1;
  void maxLead;
  if (roll < pCancel && s - 15 * MIN > tA + 5 * MIN) { fate = "cancel"; tFate = Math.round(rng.float(tA + 5 * MIN, s - 15 * MIN)); }
  else if (roll < pCancel + pNoShow && plan.service !== "car_without_driver") { fate = "noshow"; tFate = Math.max(tA + 5 * MIN, s + rng.int(20, 50) * MIN); }
  else if (roll < pCancel + pNoShow + 0.004 && s > tA + 40 * MIN) { fate = "ops"; tFate = Math.round(rng.float(tA + 10 * MIN, s - 5 * MIN)); }
  const late = rng.chance(0.04 + 0.55 * (1 - q) ** 2);
  const early = rng.int(10, 70) * MIN;
  let arrive = afterStart ? tA + rng.int(15, 50) * MIN : s - early + (late ? rng.int(8, 55) * MIN : 0);
  arrive = Math.max(arrive, tA + 2 * MIN, s - ctx.base.checkinEarlyMin * MIN);
  const attend = arrive + (autoAttend ? rng.int(5, 40) * 1000 : rng.int(1, late ? 25 : 12) * MIN);
  const loadAt = attend + (scanMode ? rng.int(30, 120) * 1000 : rng.int(4, 18) * MIN);
  const ack = loadAt + (scanMode ? 0 : rng.int(1, 4) * MIN);
  const planAt = ack + rng.int(10, 70) * 1000;
  const routeAt = planAt + rng.int(1, 6) * MIN;
  return { fate, tFate, arrive, attend, loadAt, ack, planAt, routeAt, loadedCount: 0, late, autoAttend, scanMode };
}

export const noShowReason = (R: Life) => R.rng.pick(NO_SHOW_REASONS);
export { HOUR };
