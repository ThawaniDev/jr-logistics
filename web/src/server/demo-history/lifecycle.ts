import { WEBHOOK_EVENTS } from "@/server/events";
import { OFFER_DEAD } from "@/server/catalog";
import { maskPhone } from "@/server/data-capture";
import { DAY, HOUR, MIN, hourStart } from "./calendar";
import { acceptOffer, drawJobPlan, eligible, freeSlot, newOffer, noShowReason, releaseParcels, runWave, scoreOf } from "./dispatch";
import { LEDGER_PREFIX } from "./ids";
import { Life, type Offer, type Parcel, type ReqRow, type ShipRow } from "./life";
import { runDeliveryJob, runRentalJob } from "./job-sim";
import { BIZ_CANCEL_REASONS, DRIVER_CANCEL_REASONS, OPS_REPLACE_REASONS } from "./names";
import type { RequestPlan } from "./plan";
import type { Rng } from "./prng";
import { isOnline, officeAt } from "./schedule";
import { Tl } from "./timeline";
import type { Ctx, DriverSim } from "./types";

/**
 * Simulates one request from draft to its end (completed, cancelled, expired …) the way the real flows would drive it, then writes whatever has
 * happened by `asOf`. The order of work matters: offers and fates (cancel / no-show) first, then how the request closes, then each job's flow.
 */
const DEAD = new Set<string>(OFFER_DEAD);

export function simulateRequest(ctx: Ctx, plan: RequestPlan, rng: Rng): void {
  const { rule } = plan, co = plan.company;
  const delivery = plan.service === "delivery_driver", driverless = plan.service === "car_without_driver";
  const totalUnits = delivery ? plan.parcels.length : plan.quantity * plan.durationDays;
  const expectedUnits = delivery ? plan.perDriver! : plan.durationDays;
  const total = rule.priceCents * totalUnits;
  const snap = {
    ruleId: rule.id, ruleVersion: rule.version, agreementRef: rule.agreementRef, currency: "SAR", unit: rule.unit, unitPriceCents: rule.priceCents, providerCostCents: rule.providerCostCents, quantity: plan.quantity,
    expectedUnits, totalCents: total, providerTotalCents: rule.providerCostCents * totalUnits, marginCents: total - rule.providerCostCents * totalUnits, effectiveAt: new Date(Math.min(rule.effectiveAt.getTime(), ctx.windowStart)).toISOString(), expiresAt: null, totalUnits,
  };
  const base: ReqRow = {
    id: plan.id, ref: plan.ref, businessId: co.id, service: plan.service, title: plan.title, quantity: plan.quantity, shipmentsPerDriver: plan.perDriver, vehicleType: plan.vehicleType, temperature: plan.temperature,
    pickupCity: plan.pickupCity, deliveryCity: plan.deliveryCity, pickupAddress: plan.pickupAddress, pickupLat: plan.pickupLat, pickupLng: plan.pickupLng, deliveryAddress: plan.deliveryAddress, deliveryLat: plan.deliveryLat, deliveryLng: plan.deliveryLng,
    recipientName: null, recipientPhone: null, contents: null, startsAt: new Date(plan.startsAt), durationDays: plan.durationDays, notes: plan.notes, preferredOfficeId: null, allowPartial: plan.allowPartial, status: "draft",
    pricingSnapshot: null, unitPriceCents: null, expectedUnits: null, totalCents: null, reservedCents: 0, slotsFilled: 0, officeWindowEndsAt: null, createdVia: plan.via, cancelReason: null, cancelledBy: null, publishedAt: null, completedAt: null, cancelledAt: null,
    version: 1, createdAt: new Date(plan.tc), updatedAt: new Date(plan.tc),
  };
  const R = new Life(ctx, rng, plan, base);
  co.requests++;
  const ops = ctx.w.staff.filter((s) => s.team === "ops");
  const opsActor = () => { const s = rng.pick(ops.length ? ops : [ctx.w.admin]); return { id: s.id, name: s.name, role: s.role }; };

  // parcels (the manifest)
  for (const spec of plan.parcels) {
    const id = ctx.ids.next("shipment");
    const row: ShipRow = {
      id, requestId: plan.id, offerId: null, seq: spec.seq, code: spec.code, externalRef: spec.externalRef, recipientType: spec.type, recipientName: spec.name, recipientPhone: spec.phone, address: spec.address, city: spec.city, lat: spec.lat, lng: spec.lng,
      contents: spec.contents, notes: spec.notes, status: "pending", stopOrder: null, deferCount: 0, attempts: 0, otpVersion: 1, otpAttempts: 0, otpSends: 0, detailsComplete: true, geoSource: "given", codCents: spec.codCents, createdAt: new Date(plan.tc), updatedAt: new Date(plan.tc),
    };
    const p: Parcel = { id, spec, tl: new Tl<ShipRow>(row), offer: null, t: { loaded: null, resolved: null, gone: null }, notified: false };
    R.parcels.push(p);
    R.pev(plan.tc + spec.seq, p, "created", R.biz, null, { seq: spec.seq, code: spec.code });
  }
  R.ev(plan.tc, "request_created", R.biz, { neu: "draft" });
  ctx.stats.requests = (ctx.stats.requests ?? 0) + 1;
  const dbg = (k: string) => { ctx.stats[`dbg:${k}`] = (ctx.stats[`dbg:${k}`] ?? 0) + 1; };
  dbg(`req:${plan.service === "delivery_driver" ? plan.vehicleType : plan.service}`);

  // a few drafts are never published
  if (!driverless && rng.chance(0.022) && plan.tc < ctx.asOf - 2 * DAY) { ctx.stats.draftsAbandoned = (ctx.stats.draftsAbandoned ?? 0) + 1; return emit(R, [], null); }

  // ── publish: terms, price snapshot, escrow ──
  const tp = plan.tp, status0 = driverless ? "confirmed" : "published";
  R.tl.at(tp, (s) => ({ status: status0, pricingSnapshot: snap as never, unitPriceCents: rule.priceCents, expectedUnits, totalCents: total, reservedCents: total, publishedAt: new Date(tp), version: (s.version ?? 1) + 1 }));
  R.ev(tp, "request_published", R.biz, { old: "draft", neu: status0, payload: { totalCents: total, ruleVersion: rule.version } });
  R.on(tp, () => {
    ctx.postings.push({ at: tp, accountId: co.walletId, kind: "reserve", available: -total, reserved: total, key: `${LEDGER_PREFIX}reserve:${plan.id}`, requestId: plan.id, actorId: co.id });
    ctx.sink.add("termsConsents", { id: ctx.ids.next("terms"), userId: co.id, role: "business", termsVersion: ctx.base.termsVersion, context: "publish", ip: null, acceptedAt: new Date(tp) });
  });

  // the business (or, rarely, operations) cancels before anyone has arrived
  let tCancel: number | null = null; let cancelBy: "business" | "staff" = "business";
  if (plan.startsAt - tp > 95 * MIN && (rng.chance(0.045) || rng.chance(0.008))) {
    cancelBy = rng.chance(0.15) ? "staff" : "business";
    tCancel = Math.round(rng.float(tp + 5 * MIN, plan.startsAt - 75 * MIN));
  }
  const tS0 = plan.startsAt;
  // Nothing can be accepted after the request has been closed by the maintenance tick: expired (nobody by the start), called off (all-or-nothing) or its open slots closed (+60 min).
  const tPart = tS0 + 60 * MIN + rng.int(0, 240) * 1000;
  const deadline = Math.min(tCancel ?? Infinity, tS0 + 3 * MIN);
  const replDeadline = Math.min(tCancel ?? Infinity, plan.allowPartial ? tPart - 1000 : tS0 + 3 * MIN);
  const live: Offer[] = [];
  const queueFates: Offer[] = [];
  const register = (O: Offer, tA: number, slotsLeft: number) => {
    acceptOffer(R, O, tA, slotsLeft);
    const jp = drawJobPlan(R, O, tA);
    jp.loadedCount = delivery ? O.parcels.length - (O.parcels.length > 1 && rng.chance(0.03) ? rng.int(1, Math.min(2, O.parcels.length - 1)) : 0) : 0;
    O.jobPlan = jp; live.push(O);
    if (jp.fate !== "ok" && jp.tFate < (tCancel ?? Infinity)) queueFates.push(O);
    else jp.fate = "ok";
  };

  if (!driverless) {
    // ── offers → acceptance ──
    const w = runWave(R, tp + 1000, plan.quantity, { replacement: false, replacesId: null, deadline });
    w.winners.forEach((x, i) => register(x.offer, x.at, plan.quantity - i));
    // still short of drivers close to the start: operations assign somebody by hand, or an idle driver applies
    if (w.winners.length < plan.quantity && plan.startsAt - tp > 100 * MIN && rng.chance(0.8)) {
      const tM = Math.max(tp + 30 * MIN, plan.startsAt - rng.int(25, 90) * MIN);
      if (tM < deadline) {
        const cand = ctx.w.drivers.filter((d) => eligible(R, d, tM) && isOnline(d, ctx.opts.seed, tM)).sort((a, b) => scoreOf(ctx, b, tM) - scoreOf(ctx, a, tM))[0];
        if (cand) {
          const manual = rng.chance(0.65);
          const O = newOffer(R, cand, tM, { source: manual ? "manual" : officeAt(cand, tM) ? "office" : "apply", replacement: false, replacesId: null });
          if (manual) {
            const a = opsActor();
            R.ev(tM, "driver_assigned", a, { offer: O, neu: "offered", payload: { source: "manual", reason: "No driver accepted in time" } });
            R.on(tM, () => ctx.sink.add("auditLogs", { id: ctx.ids.next("audit"), actorId: a.id, actorRole: a.role, action: "request.manual_assign", entity: "request", entityId: plan.id, diff: { driverId: cand.id, reason: "No driver accepted in time" } as never, ip: null, correlationId: null, createdAt: new Date(tM) }));
            R.notify(tM, cand.id, "offer_new", { requestId: plan.id, ref: plan.ref, offerId: O.id });
          }
          if (rng.chance(0.88)) { const tA = tM + (manual ? rng.int(2, 25) * MIN : 20_000); if (tA < deadline && tA < plan.startsAt) register(O, tA, 1); else O.tl.at(tM + 120 * MIN, { status: "expired" }); }
          else { O.tl.at(tM + rng.int(2, 30) * MIN, { status: "rejected" }); }
        }
      }
    }

    // ── fates: drivers who cancel, do not show up or are replaced; every one opens a slot and starts a replacement wave ──
    queueFates.sort((a, b) => a.jobPlan!.tFate - b.jobPlan!.tFate);
    while (queueFates.length) {
      const O = queueFates.shift()!;
      const jp = O.jobPlan!, tF = jp.tFate, d = O.driver, drv = R.driverActor(d);
      if (O.dead) continue;
      O.dead = true;
      let why = "driver_cancelled";
      if (jp.fate === "cancel") {
        const reason = rng.pick(DRIVER_CANCEL_REASONS);
        O.tl.at(tF, { status: "cancelled", cancelReason: reason, cancelledAt: new Date(tF) });
        releaseParcels(R, O, tF, "driver_cancelled");
        R.ev(tF, "driver_cancelled", drv, { offer: O, old: "accepted", neu: "cancelled", payload: { reason } });
        R.notify(tF, co.id, "driver_cancelled", { requestId: plan.id, ref: plan.ref });
        if (O.officeId) R.notify(tF, O.officeId, "office_driver_cancelled", { ref: plan.ref, driver: d.name });
        d.cancels.push(tF);
        strikes(R, d, tF);
      } else if (jp.fate === "noshow") {
        why = "no_show";
        const reason = noShowReason(R);
        O.tl.at(tF, { status: "no_show", cancelReason: reason, cancelledAt: new Date(tF) });
        releaseParcels(R, O, tF, "driver_no_show");
        R.ev(tF, "driver_no_show", R.biz, { offer: O, old: "accepted", neu: "no_show", payload: { reason } });
        R.notify(tF, d.id, "no_show_recorded", { offerId: O.id, ref: plan.ref });
        if (rng.chance(0.65)) ctx.ticketSeeds.push({ at: tF + rng.int(1, 30) * MIN, userId: co.id, role: "business", category: "driver_no_show", requestId: plan.id, offerId: O.id, priority: "urgent", lang: plan.lang });
        if (rng.chance(0.35)) ctx.complaintSeeds.push({ at: tF + rng.int(10, 240) * MIN, userId: co.id, role: "business", category: "no_show", requestId: plan.id, offerId: O.id, priority: "urgent", lang: plan.lang });
      } else {
        why = "ops_replace";
        const a = opsActor(), reason = rng.pick(OPS_REPLACE_REASONS);
        O.tl.at(tF, { status: "replaced", cancelReason: reason, cancelledAt: new Date(tF) });
        releaseParcels(R, O, tF, "driver_replaced");
        R.ev(tF, "driver_replaced", a, { offer: O, old: "accepted", neu: "replaced", payload: { reason } });
        R.on(tF, () => ctx.sink.add("auditLogs", { id: ctx.ids.next("audit"), actorId: a.id, actorRole: a.role, action: "offer.replace", entity: "offer", entityId: O.id, diff: { reason } as never, ip: null, correlationId: null, createdAt: new Date(tF) }));
        R.notify(tF, d.id, "replaced_by_ops", { offerId: O.id, ref: plan.ref });
      }
      if (O.job) O.job.end = tF;
      const r = freeSlot(R, O, tF, why, replDeadline);
      for (const x of r.winners) {
        if (x.at >= replDeadline) continue;
        register(x.offer, x.at, 1);
        if (x.offer.jobPlan!.fate !== "ok") { queueFates.push(x.offer); queueFates.sort((a, b) => a.jobPlan!.tFate - b.jobPlan!.tFate); }
      }
    }
  }

  // ── how the request ends ──
  const tS = plan.startsAt;
  const stateAt = (t: number) => R.tl.state(t);
  const parcelsLeft = () => R.parcels.filter((p) => !p.offer);
  const expireOffers = (t: number) => { for (const o of R.offers) o.tl.at(t, (s) => (s.status === "offered" ? { status: "expired" } : {})); };
  const releaseAll = (t: number, kind: string, key: string, actorId: string | null) => {
    const amount = Math.max(0, stateAt(t).reservedCents ?? 0);
    if (amount > 0) R.on(t, () => ctx.postings.push({ at: t, accountId: co.walletId, kind: "release_reserve", reserved: -amount, available: amount, key: `${LEDGER_PREFIX}${key}:${plan.id}`, requestId: plan.id, actorId }));
    R.tl.at(t, (s) => ({ reservedCents: (s.reservedCents ?? 0) - amount }));
    void kind;
    return amount;
  };
  const withdrawParcels = (t: number, reason: string, by: Record<string, unknown>) => {
    for (const p of parcelsLeft()) { p.tl.at(t, { status: "cancelled", failReason: reason === "request_cancelled" ? null : reason }); p.t.gone = t; R.pev(t, p, "cancelled", null, null, { reason, ...by }); }
  };

  if (tCancel != null) {
    // cancelled by the business / platform: everyone is released, parcels withdrawn, escrow returned
    const a = cancelBy === "staff" ? opsActor() : R.biz;
    const reason = rng.pick(BIZ_CANCEL_REASONS);
    R.cancelled = { at: tCancel, by: cancelBy };
    for (const o of R.offers) {
      o.tl.at(tCancel, (s) => (s.status === "offered" || s.status === "accepted" || s.status === "arrived" ? { status: "cancelled", cancelReason: "request_cancelled", cancelledAt: new Date(tCancel!) } : {}));
      if (o.job && !o.dead) { o.job.end = tCancel; o.dead = true; R.notify(tCancel, o.driver.id, "request_cancelled", { ref: plan.ref }); }
    }
    for (const p of parcelsLeft()) { p.tl.at(tCancel, { status: "cancelled", offerId: null }); p.t.gone = tCancel; R.pev(tCancel, p, "cancelled", a, null, { reason: "request_cancelled", cancelReason: reason }); }
    for (const p of R.parcels.filter((x) => x.offer && x.t.gone == null)) { p.tl.at(tCancel, { status: "cancelled", offerId: null, stopOrder: null }); p.t.gone = tCancel; R.pev(tCancel, p, "cancelled", a, p.offer, { reason: "request_cancelled", cancelReason: reason }); }
    releaseAll(tCancel, "release", "cancel-release", a.id);
    R.tl.at(tCancel + 1, (s) => ({ status: "cancelled", cancelReason: reason, cancelledBy: a.id, cancelledAt: new Date(tCancel!), version: (s.version ?? 1) + 1 }));
    R.ev(tCancel, "request_cancelled", a, { old: status0, neu: "cancelled", payload: { reason } });
    if (cancelBy === "staff") R.on(tCancel, () => ctx.sink.add("auditLogs", { id: ctx.ids.next("audit"), actorId: a.id, actorRole: a.role, action: "request.cancel", entity: "request", entityId: plan.id, diff: { reason } as never, ip: null, correlationId: null, createdAt: new Date(tCancel!) }));
    ctx.stats.cancelled = (ctx.stats.cancelled ?? 0) + 1;
    return emit(R, [], tCancel);
  }

  if (driverless) {
    // a rental without a driver: staff hand the vehicle over, the reserved amount becomes platform revenue
    const tF = Math.round(plan.startsAt + rng.int(5, 120) * MIN);
    const a = opsActor();
    R.on(tF, () => {
      ctx.postings.push({ at: tF, accountId: co.walletId, kind: "charge", reserved: -total, key: `${LEDGER_PREFIX}rental:${plan.id}:charge`, requestId: plan.id, actorId: a.id });
      ctx.postings.push({ at: tF, accountId: ctx.platformWalletId, kind: "platform_fee", available: total, key: `${LEDGER_PREFIX}rental:${plan.id}:fee`, requestId: plan.id, actorId: a.id });
      ctx.sink.add("auditLogs", { id: ctx.ids.next("audit"), actorId: a.id, actorRole: a.role, action: "rental.fulfil", entity: "request", entityId: plan.id, diff: { total } as never, ip: null, correlationId: null, createdAt: new Date(tF) });
    });
    R.tl.at(tF, (s) => ({ status: "completed", completedAt: new Date(tF), reservedCents: 0, version: (s.version ?? 1) + 1 }));
    R.ev(tF, "request_completed", a, { old: "confirmed", neu: "completed" });
    R.notify(tF, co.id, "request_completed", { requestId: plan.id, ref: plan.ref });
    return emit(R, [], tF);
  }

  const filledAtStart = stateAt(tS + 3 * MIN).slotsFilled ?? 0;
  const stillLive = live.filter((o) => !o.dead);
  if (filledAtStart === 0 || stillLive.length === 0) {
    // nobody took it (or everybody who did dropped out): the maintenance tick expires it just after the start / the last drop-out, refunds the escrow
    const lastDrop = Math.max(0, ...live.map((o) => (o.dead ? o.jobPlan!.tFate : 0)));
    const tX = Math.max(tS + rng.int(30, 240) * 1000, lastDrop + rng.int(60, 240) * 1000);
    expireOffers(tX);
    for (const o of live) if (o.job && o.job.end === Infinity) o.job.end = tX;
    withdrawParcels(tX, "unfulfilled", { by: "maintenance" });
    releaseAll(tX, "release", "expire-release", null);
    const old = stateAt(tX).status;
    R.tl.at(tX + 1, { status: "expired" });
    R.ev(tX, "request_expired", null, { old, neu: "expired" });
    R.notify(tX, co.id, "request_expired", { requestId: plan.id, ref: plan.ref });
    ctx.stats.expired = (ctx.stats.expired ?? 0) + 1;
    dbg(`exp:${plan.service === "delivery_driver" ? plan.vehicleType : plan.service}`); dbg(R.offers.length ? "exp:had-offers" : "exp:no-offers");
    return emit(R, [], tX);
  }
  if (!plan.allowPartial && filledAtStart < plan.quantity) {
    // all-or-nothing and not fully staffed: called off, escrow refunded
    const tX = tS + rng.int(60, 240) * 1000;
    for (const o of R.offers) {
      o.tl.at(tX, (s) => (s.status === "offered" || s.status === "accepted" ? { status: "cancelled", cancelReason: "not_fully_staffed", cancelledAt: new Date(tX) } : {}));
      if (o.job && o.job.end === Infinity) { o.job.end = tX; R.notify(tX, o.driver.id, "request_cancelled", { ref: plan.ref }); }
    }
    withdrawParcels(tX, "not_fully_staffed", { by: "maintenance" });
    for (const p of R.parcels.filter((x) => x.offer && x.t.gone == null)) { p.tl.at(tX, { status: "cancelled", failReason: "not_fully_staffed", offerId: null }); p.t.gone = tX; R.pev(tX, p, "cancelled", null, p.offer, { reason: "not_fully_staffed", by: "maintenance" }); }
    releaseAll(tX, "release", "allornothing-release", null);
    const old = stateAt(tX).status;
    R.tl.at(tX + 1, (s) => ({ status: "cancelled", cancelReason: "not_fully_staffed", cancelledAt: new Date(tX), version: (s.version ?? 1) + 1 }));
    R.ev(tX, "request_called_off", null, { old, neu: "cancelled", payload: { requested: plan.quantity, staffed: filledAtStart } });
    R.notify(tX, co.id, "request_called_off", { requestId: plan.id, ref: plan.ref, filled: filledAtStart, requested: plan.quantity });
    ctx.stats.calledOff = (ctx.stats.calledOff ?? 0) + 1;
    return emit(R, [], tX);
  }

  // ── jobs run ──
  const jobs = live.filter((o) => !o.dead);
  for (const O of jobs) (delivery ? runDeliveryJob : runRentalJob)(R, O);
  const tLast = Math.max(...jobs.map((o) => o.completedAt ?? 0));

  // partly staffed: after the grace period the open slots are closed so the job can finish and the escrow of the empty slots goes back
  let tClose: number | null = null;
  const filledPart = stateAt(tPart).slotsFilled ?? 0;
  if (plan.allowPartial && filledPart > 0 && filledPart < plan.quantity) {
    tClose = tPart;
    const st = stateAt(tPart);
    const unit = rule.priceCents;
    let held = 0;
    for (const o of R.offers) { const os = o.tl.state(tPart); if (!DEAD.has(os.status ?? "") && os.status !== "offered") held += unit * (os.expectedUnits ?? 0); }
    const amount = Math.max(0, (st.reservedCents ?? 0) - held);
    if (amount > 0) R.on(tPart, () => ctx.postings.push({ at: tPart, accountId: co.walletId, kind: "release_reserve", reserved: -amount, available: amount, key: `${LEDGER_PREFIX}partial-release:${plan.id}`, requestId: plan.id }));
    expireOffers(tPart);
    const started = R.offers.some((o) => ["attendance_confirmed", "delivered_reported", "pending_settlement"].includes(o.tl.state(tPart).status ?? ""));
    withdrawParcels(tPart, "unfulfilled", { by: "maintenance" });
    R.tl.at(tPart + 1, (s) => ({ reservedCents: (s.reservedCents ?? 0) - amount, quantity: filledPart, status: started ? "in_progress" : "assigned" }));
    R.ev(tPart, "unfilled_slots_closed", null, { old: st.status ?? null, neu: started ? "in_progress" : "assigned", payload: { requested: plan.quantity, staffed: filledPart } });
    R.notify(tPart, co.id, "request_partially_filled", { requestId: plan.id, ref: plan.ref, filled: filledPart, requested: plan.quantity });
    ctx.stats.partial = (ctx.stats.partial === undefined ? 0 : ctx.stats.partial) + 1;
  }

  // completion: automatic when the last driver is paid; if every job was already done before the slots were closed, the business closes the request
  const manual = tClose != null && tClose > tLast;
  const tDone = manual ? tClose! + rng.int(10, 150) * MIN : tLast + 200;
  const unpaidHold = jobs.filter((o) => o.held && (o.paidAt ?? 0) > tDone);
  const heldAmount = unpaidHold.reduce((a, o) => a + rule.priceCents * (o.tl.state(Infinity).expectedUnits ?? 0), 0);
  const unfulfilled = parcelsLeft().filter((p) => p.t.gone == null);
  for (const p of unfulfilled) { p.tl.at(tDone, { status: "cancelled", failReason: "unfulfilled" }); p.t.gone = tDone; R.pev(tDone, p, "cancelled", null, null, { reason: "unfulfilled" }); }
  const reservedAt = Math.max(0, (stateAt(tDone).reservedCents ?? 0));
  const rel = Math.max(0, reservedAt - heldAmount);
  if (rel > 0) R.on(tDone, () => ctx.postings.push({ at: tDone, accountId: co.walletId, kind: "release_reserve", reserved: -rel, available: rel, key: `${LEDGER_PREFIX}complete-release:${plan.id}`, requestId: plan.id }));
  expireOffers(tDone);
  const completer = manual ? R.biz : null;
  const oldStatus = stateAt(tDone).status;
  R.tl.at(tDone + 1, (s) => ({ reservedCents: (s.reservedCents ?? 0) - rel, status: "completed", completedAt: new Date(tDone), version: (s.version ?? 1) + 1 }));
  R.ev(tDone + 1, "request_completed", completer, { old: oldStatus ?? null, neu: "completed" });
  R.notify(tDone + 1, co.id, "request_completed", { requestId: plan.id, ref: plan.ref });
  ctx.stats.completed = (ctx.stats.completed ?? 0) + 1;
  return emit(R, jobs, tDone + 1);
}

/** Cancellation policy (decision B3): warning at 2 cancellations within the window, automatic suspension at 4. */
function strikes(R: Life, d: DriverSim, t: number) {
  const ctx = R.ctx;
  const { cancelPolicyEnabled, cancelWindowDays, cancelWarnAt, cancelSuspendAt, cancelSuspendDays } = ctx.base;
  if (!cancelPolicyEnabled) return;
  const n = d.cancels.filter((c) => c <= t && c > t - cancelWindowDays * DAY).length;
  if (n >= cancelSuspendAt) {
    d.strikeSuspensions.push({ from: t, to: t + cancelSuspendDays * DAY });
    ctx.suspensions.push({ driverId: d.id, from: t, to: t + cancelSuspendDays * DAY, cancellations: n });
    R.notify(t, d.id, "cancel_suspended", { days: cancelSuspendDays });
    d.cancels = d.cancels.filter((c) => c <= t - cancelWindowDays * DAY); // the strikes were used up
  } else if (n >= cancelWarnAt) R.notify(t, d.id, "cancel_warning", { count: n });
}

/** Writes what has happened by `asOf`. */
function emit(R: Life, jobs: Offer[], tEnd: number | null): void {
  const { ctx, plan } = R, asOf = ctx.asOf, sink = ctx.sink, co = plan.company;
  // late-bound event payloads (the request status at that moment)
  for (const e of R.events) if (e.late) e.payload = { ...(e.payload ?? {}), requestStatus: R.tl.state(e.t).status };
  const evs = R.events.filter((e) => e.t <= asOf).sort((a, b) => a.t - b.t);
  const ms = R.milestones(asOf);
  const firstOfferAt = Math.min(...[ms.firstOffer, ...R.offers.map((o) => o.createdAt)].filter((x): x is number => x != null && x <= asOf), Infinity);
  const st = R.tl.state(asOf);
  const row: ReqRow = { ...st, firstOfferAt: Number.isFinite(firstOfferAt) ? new Date(firstOfferAt) : null, firstAcceptedAt: ms.firstAccepted ? new Date(ms.firstAccepted) : null, filledAt: ms.filled ? new Date(ms.filled) : null, startedAt: ms.started ? new Date(ms.started) : null, lastActivityAt: ms.last ? new Date(ms.last) : null };
  sink.add("requests", row);
  const stateById = new Map<string, ShipRow>();
  for (const o of R.offers) if (o.createdAt <= asOf) sink.add("offers", o.tl.state(asOf));
  for (const p of R.parcels) { const s = p.tl.state(asOf); stateById.set(p.id, s); sink.add("shipments", s); ctx.stats.parcels = (ctx.stats.parcels ?? 0) + 1; }
  // job events + parcel journey
  const wh = co.webhookUrl;
  const sms = co.ops?.requireDeliveryOtp === false ? "recipient_track" : "recipient_code";
  const pe: Array<ReturnType<Life["mirrored"]>[number]> = [];
  let lastT = -Infinity;
  for (const e of evs) {
    const id = ctx.ids.next("jobEvent");
    const at = Math.max(e.t, lastT + 1); lastT = at; // one request's events never share a millisecond, so their order is stable wherever they are read
    sink.add("jobEvents", { id, requestId: plan.id, offerId: e.offerId ?? null, actorId: e.actor?.id ?? null, actorName: e.actor?.name ?? null, actorRole: e.actor?.role ?? "system", type: e.type, oldStatus: e.old ?? null, newStatus: e.neu ?? null, payload: (e.payload ?? null) as never, createdAt: new Date(at) });
    pe.push(...R.mirrored(e));
    if (e.type === "recipient_notified" || e.type === "recipient_notify_failed") {
      const sid = String((e.payload ?? {}).shipmentId ?? ""), parcel = R.parcels.find((p) => p.id === sid);
      const ok = e.type === "recipient_notified";
      sink.add("messageLog", { id: ctx.ids.next("msgLog"), channel: "sms", direction: "out", recipient: maskPhone(parcel?.spec.phone ?? null), type: sms, userId: null, requestId: plan.id, shipmentId: sid || null, status: ok ? "sent" : "failed", providerRef: ok ? `demo-${ctx.ids.seq("sms").toString(16)}` : null, error: ok ? null : "SMS provider timeout", attempts: 1, sentAt: new Date(e.t), meta: { provider: "demo", chars: 150 + (parcel?.spec.codCents ? 70 : 0) } as never, createdAt: new Date(e.t) });
    }
    if (wh && WEBHOOK_EVENTS.has(e.type)) {
      const wid = ctx.ids.next("webhook"), delivered = R.rng.chance(0.965), pending = e.t > asOf - 20 * MIN;
      const status = pending ? "queued" : delivered ? "delivered" : R.rng.chance(0.5) ? "dead_letter" : "delivered";
      sink.add("webhookDeliveries", { id: wid, businessId: co.id, requestId: plan.id, eventId: ctx.ids.next("webhook"), event: e.type, url: wh, payload: { event: e.type, request: { id: plan.id, ref: plan.ref, status: R.tl.state(e.t).status }, offerId: e.offerId ?? null, status: e.neu ?? null } as never, status, attempts: status === "dead_letter" ? 6 : status === "delivered" ? (R.rng.chance(0.08) ? 2 : 1) : 0, nextAttemptAt: new Date(e.t), lastStatusCode: status === "delivered" ? 200 : status === "dead_letter" ? 503 : null, lastError: status === "dead_letter" ? "HTTP 503 from the receiver" : null, deliveredAt: status === "delivered" ? new Date(e.t + 900) : null, createdAt: new Date(e.t) });
      sink.add("messageLog", { id: ctx.ids.next("msgLog"), channel: "webhook", direction: "out", recipient: new URL(wh).host, type: e.type, userId: co.id, requestId: plan.id, shipmentId: null, status: status === "delivered" ? "delivered" : status === "dead_letter" ? "failed" : "queued", providerRef: wid, error: status === "dead_letter" ? "HTTP 503 from the receiver" : null, attempts: status === "dead_letter" ? 6 : 1, sentAt: status === "queued" ? null : new Date(e.t + 900), meta: { event: e.type } as never, createdAt: new Date(e.t) });
    }
  }
  pe.push(...R.pevents.filter((x) => x.t <= asOf));
  const lastOf = new Map<string, number>();
  for (const m of pe.sort((a, b) => a.t - b.t)) {
    const at = Math.max(m.t, (lastOf.get(m.shipmentId) ?? -Infinity) + 1); lastOf.set(m.shipmentId, at);
    emitParcelEvent(R, { ...m, t: at });
  }
  for (const s of R.settlements) if (s.t <= asOf) sink.add("settlements", s.tl.state(asOf));
  for (const n of R.notifs) {
    if (n.t > asOf) continue;
    const age = asOf - n.t, readP = age > 3 * DAY ? 0.93 : 0.55;
    const read = R.rng.chance(readP) ? Math.min(asOf, n.t + Math.round(R.rng.logNormal(90, 1.2) * MIN)) : null;
    sink.add("notifications", { id: ctx.ids.next("notification"), userId: n.userId, type: n.type, title: n.type, body: null, data: n.data as never, readAt: read ? new Date(read) : null, createdAt: new Date(n.t) });
  }
  for (const f of R.fx.slice().sort((a, b) => a.t - b.t || a.i - b.i)) if (f.t <= asOf) f.run();
  // driver positions for recent jobs (sparse sampled path)
  if (jobs.length) for (const O of jobs) sampleLocations(R, O);
  sampleHourly(R, tEnd);
}

function emitParcelEvent(R: Life, m: { t: number; shipmentId: string; offerId?: string | null; type: string; actor: { id: string; name: string; role: string } | null; payload?: Record<string, unknown> | null }) {
  const { ctx, plan } = R;
  if (m.t > ctx.asOf + 1000) return;
  ctx.sink.add("shipmentEvents", { id: ctx.ids.next("shipEvent"), shipmentId: m.shipmentId, requestId: plan.id, offerId: m.offerId ?? null, type: m.type, actorId: m.actor?.id ?? null, actorRole: m.actor?.role ?? "system", actorName: m.actor?.name ?? null, payload: (m.payload ?? null) as never, createdAt: new Date(m.t) });
}

/** A sampled GPS path (one point every few minutes) for jobs of the last ~10 days: warehouse → stops in order. */
function sampleLocations(R: Life, O: Offer) {
  const { ctx, plan, rng } = R;
  const from = ctx.asOf - 10 * DAY;
  if (!O.jobPlan || O.jobPlan.arrive < from) return;
  const pts: Array<{ t: number; lat: number; lng: number }> = [];
  const stops = O.parcels.map((p) => ({ p, s: p.tl.state(ctx.asOf) })).filter((x) => x.s.arrivedAt).sort((a, b) => +a.s.arrivedAt! - +b.s.arrivedAt!);
  let prev = { t: O.jobPlan.arrive, lat: plan.pickupLat, lng: plan.pickupLng };
  pts.push(prev);
  for (const { s } of stops) {
    const t1 = +s.arrivedAt!, dur = t1 - prev.t;
    if (dur > 0) for (let t = prev.t + rng.int(150, 270) * 1000; t < t1; t += rng.int(150, 330) * 1000) { const f = (t - prev.t) / dur; pts.push({ t, lat: prev.lat + (s.lat! - prev.lat) * f + (rng.next() - 0.5) * 0.0006, lng: prev.lng + (s.lng! - prev.lng) * f + (rng.next() - 0.5) * 0.0006 }); }
    pts.push({ t: t1, lat: s.lat!, lng: s.lng! });
    prev = { t: +(s.deliveredAt ?? s.failedAt ?? s.arrivedAt!), lat: s.lat!, lng: s.lng! };
    if (prev.t > t1) pts.push(prev);
  }
  let last = -Infinity;
  for (const pt of pts) {
    if (pt.t > ctx.asOf || pt.t - last < 60_000) continue;
    last = pt.t;
    ctx.sink.add("driverLocationHistory", { id: ctx.ids.next("location"), driverId: O.driver.id, lat: Math.round(pt.lat * 1e6) / 1e6, lng: Math.round(pt.lng * 1e6) / 1e6, accuracyM: Math.round(rng.float(4, 28) * 10) / 10, speedMps: Math.round(rng.float(0, 14) * 10) / 10, heading: Math.round(rng.float(0, 359)), offerId: O.id, recordedAt: new Date(pt.t) });
    O.driver.lastPing = { lat: pt.lat, lng: pt.lng, t: pt.t };
  }
}

/** Samples the request's state at every full hour of the last 30 days into the hourly snapshot accumulator. */
function sampleHourly(R: Life, tEnd: number | null) {
  const { ctx, plan } = R;
  const lo = Math.max(hourStart(ctx.asOf - 30 * DAY), hourStart(plan.tp) + HOUR), hi = Math.min(hourStart(ctx.asOf), hourStart(tEnd ?? ctx.asOf) + HOUR);
  const maxHours = 24 * 31;
  for (let h = lo, n = 0; h <= hi && n < maxHours; h += HOUR, n++) {
    if (h >= hourStart(ctx.asOf)) break;
    const s = R.tl.state(h);
    const st = s.status ?? "draft";
    const active = ["published", "filling", "assigned", "confirmed", "in_progress"].includes(st);
    if (!active) continue;
    const pc = plan.pickupCity;
    if (st === "published" || st === "filling") { ctx.acc.add(h, pc, "requests_open"); ctx.acc.add(h, pc, "slots_unfilled", Math.max(0, (s.quantity ?? 0) - (s.slotsFilled ?? 0))); for (const o of R.offers) if (o.createdAt <= h && o.tl.state(h).status === "offered") ctx.acc.add(h, pc, "offers_pending"); }
    else ctx.acc.add(h, pc, "requests_in_progress");
    for (const p of R.parcels) { const ps = p.tl.state(h).status; if (ps === "pending") ctx.acc.add(h, p.spec.city, "parcels_pending"); else if (ps === "loaded") ctx.acc.add(h, p.spec.city, "parcels_in_transit"); }
  }
}

export { HOUR };
