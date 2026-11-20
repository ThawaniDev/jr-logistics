import { DAY, HOUR, MIN } from "./calendar";
import { LEDGER_PREFIX, refOf } from "./ids";
import { distanceM, jitter } from "./geo";
import { CHAT_BIZ, CHAT_DRIVER, COMMENTS_BAD, COMMENTS_BIZ_BAD, COMMENTS_BIZ_GOOD, COMMENTS_GOOD, DEFER_NOTES, END_ROUTE_REASONS, FAIL_NOTES, saudiName } from "./names";
import { PLACEHOLDER_KEY, PLACEHOLDER_MIME } from "./placeholder";
import { clamp } from "./prng";
import { Tl } from "./timeline";
import { Life, type Offer, type Parcel, type SettlementRow } from "./life";

/** Executes one accepted job: arrival → attendance → loading → route → stops → report → settlement → returns, COD hand-over, rating, chat. */
const FAIL_WEIGHTS = [["unreachable", 28], ["refused", 14], ["wrong_address", 18], ["out_of_zone", 5], ["closed", 17], ["no_otp", 6], ["damaged", 2], ["gate_access", 5], ["other", 5]] as const;

function nearestOrder(start: { lat: number; lng: number }, ps: Parcel[]): Parcel[] {
  const left = ps.slice(), out: Parcel[] = [];
  let cur = start;
  while (left.length) {
    let bi = 0, bd = Infinity;
    for (let i = 0; i < left.length; i++) { const d = distanceM(cur, left[i].spec); if (d < bd) { bd = d; bi = i; } }
    const [p] = left.splice(bi, 1);
    out.push(p); cur = p.spec;
  }
  return out;
}

export function runDeliveryJob(R: Life, O: Offer): void {
  const { ctx, rng, plan } = R;
  const jp = O.jobPlan!, d = O.driver, co = plan.company;
  const drv = R.driverActor(d), biz = R.biz;
  const wh = { lat: plan.pickupLat, lng: plan.pickupLng };
  const requireOtp = co.ops?.requireDeliveryOtp !== false, requireSig = co.ops?.requireSignature === true;
  const ref = plan.ref;

  // ── arrival & attendance ──
  const arrPt = jitter(rng, wh.lat, wh.lng, 0.1);
  O.tl.at(jp.arrive, { status: "arrived", arrivedAt: new Date(jp.arrive), arrivedLat: arrPt.lat, arrivedLng: arrPt.lng });
  R.ev(jp.arrive, "driver_arrived", drv, { offer: O, old: "accepted", neu: "arrived", payload: { lat: arrPt.lat, lng: arrPt.lng, distanceM: rng.int(8, 160) } });
  R.notify(jp.arrive, biz.id, "driver_arrived", { requestId: plan.id, ref, driver: d.name });
  const by = jp.autoAttend ? null : biz;
  O.tl.at(jp.attend, { status: "attendance_confirmed", attendanceAt: new Date(jp.attend), attendanceBy: by?.id ?? null });
  R.tl.at(jp.attend, (s) => (s.status === "assigned" || s.status === "confirmed" ? { status: "in_progress" } : {}));
  R.ev(jp.attend, "attendance_confirmed", by, { offer: O, old: "arrived", neu: "attendance_confirmed", payload: jp.autoAttend ? { auto: true } : null });
  if (by) R.notify(jp.attend, d.id, "attendance_confirmed", { offerId: O.id, ref });

  // ── loading ──
  const loaded = O.parcels.slice(0, jp.loadedCount), left = O.parcels.slice(jp.loadedCount);
  let tLoad: number, tAck: number;
  if (jp.scanMode) {
    let t = jp.attend + rng.int(20, 60) * 1000;
    loaded.forEach((p, i) => {
      t += rng.int(7, 22) * 1000;
      p.tl.at(t, { status: "loaded", loadedAt: new Date(t), loadedVia: "driver_scan", stopOrder: i + 1 }); p.t.loaded = t;
      R.ev(t, "loading_scanned", drv, { offer: O, payload: { shipmentId: p.id, code: p.spec.code } });
    });
    tLoad = t + rng.int(4, 20) * 1000; tAck = tLoad;
    O.tl.at(tLoad, { loadedUnits: loaded.length, loadedAt: new Date(tLoad), loadedAckByDriver: true, expectedUnits: loaded.length, expectedEarningCents: plan.rule.providerCostCents * loaded.length });
    R.ev(tLoad, "loading_finished", drv, { offer: O, payload: { units: loaded.length, released: left.length } });
  } else {
    tLoad = jp.attend + rng.int(4, 18) * MIN; tAck = tLoad + rng.int(1, 4) * MIN;
    loaded.forEach((p, i) => {
      p.tl.at(tLoad, { status: "loaded", loadedAt: new Date(tLoad), loadedVia: "warehouse", stopOrder: i + 1 }); p.t.loaded = tLoad;
      R.pev(tLoad + i, p, "loaded", biz, O, { via: "warehouse", code: p.spec.code, stopOrder: i + 1 });
    });
    O.tl.at(tLoad, { loadedUnits: loaded.length, loadedAt: new Date(tLoad), loadedAckByDriver: null, expectedUnits: loaded.length, expectedEarningCents: plan.rule.providerCostCents * loaded.length });
    R.ev(tLoad, "loading_recorded", biz, { offer: O, payload: { units: loaded.length, released: left.length, manifest: true } });
    R.notify(tLoad, d.id, "loading_recorded", { offerId: O.id, ref, units: loaded.length });
    O.tl.at(tAck, { loadedAckByDriver: true });
    R.ev(tAck, "loading_confirmed", drv, { offer: O, payload: { units: loaded.length } });
  }
  for (const p of left) { p.tl.at(tLoad + 1, { offerId: null, stopOrder: null, status: "pending" }); p.offer = null; R.pev(tLoad + 1, p, "unassigned", scanActor(jp.scanMode, drv, biz), O, { why: "not_handed_over" }); }

  // ── route plan & approval ──
  const order = nearestOrder(wh, loaded);
  const tPlan = tAck + rng.int(10, 70) * 1000;
  let prev: { lat: number; lng: number } = wh, totD = 0, totS = 0;
  order.forEach((p, i) => {
    const dist = Math.round(distanceM(prev, p.spec) * 1.3), sec = Math.round((dist / 1000 / (dist > 40_000 ? clamp(rng.normal(92, 6), 75, 108) : clamp(rng.normal(27, 4), 15, 40))) * 3600);
    totD += dist; totS += sec; prev = p.spec;
    p.tl.at(tPlan, { stopOrder: i + 1, legDistanceM: dist, legDurationS: sec });
    R.pev(tPlan + i, p, "route_positioned", null, O, { code: p.spec.code, stopOrder: i + 1, legDistanceM: dist, legDurationS: sec, by: "system" });
  });
  const provider = rng.chance(0.9) ? "google" : "estimate";
  O.tl.at(tPlan, { routePlan: { sig: `${O.id.slice(-8)}-${loaded.length}`, provider, plannedAt: new Date(tPlan).toISOString(), by: "system", origin: { ...wh, source: "pickup" }, totalDistanceM: totD, totalDurationS: totS, chunks: Math.ceil(loaded.length / 25), googleCalls: provider === "google" ? Math.ceil(loaded.length / 25) : 0, fallbackChunks: provider === "google" ? 0 : 1, stops: loaded.length, unlocated: 0, approximate: 0, geocoded: 0, warnings: [] } });
  R.ev(tPlan, "route_planned", null, { offer: O, payload: { provider, stops: loaded.length, distanceM: totD, durationS: totS, chunks: Math.ceil(loaded.length / 25), fallbackChunks: provider === "google" ? 0 : 1, unlocated: 0, by: "system", afterApproval: false } });
  const tRoute = tPlan + rng.int(1, 6) * MIN;
  O.tl.at(tRoute, { routeApprovedAt: new Date(tRoute) });
  R.ev(tRoute, "route_approved", drv, { offer: O, payload: { stops: loaded.length } });

  // ── the stops ──
  const queue = order.slice();
  const deferredOnce = new Set<Parcel>();
  let t = tRoute, here: { lat: number; lng: number } = wh, maxOrder = order.length;
  const q = d.q;
  const pFail = clamp(0.035 + 0.15 * (1 - q) ** 1.6, 0.02, 0.22);
  const endEarlyAt = loaded.length >= 4 && rng.chance(0.013) ? rng.int(1, loaded.length - 2) : -1;
  let resolvedCount = 0;
  const failedHere: Parcel[] = [];
  while (queue.length) {
    const p = queue.shift()!;
    const sp = p.spec;
    // the recipient is texted when the stop becomes the current one
    if (!p.notified) {
      p.notified = true;
      let tn = t + rng.int(300, 2500);
      if (rng.chance(0.02)) { // the SMS provider timed out: the driver asks for the code to be sent again
        R.ev(tn, "recipient_notify_failed", null, { offer: O, payload: { shipmentId: p.id, code: sp.code, error: "SMS provider timeout" } });
        tn += rng.int(35, 90) * 1000;
        p.tl.at(tn, (s) => ({ otpVersion: (s.otpVersion ?? 1) + 1, otpSends: (s.otpSends ?? 0) + 1 }));
        R.ev(tn - 800, "stop_code_resent", drv, { offer: O, payload: { shipmentId: p.id, code: sp.code } });
        R.ev(tn, "recipient_notified", null, { offer: O, payload: { shipmentId: p.id, code: sp.code, forced: true } });
      } else R.ev(tn, "recipient_notified", null, { offer: O, payload: { shipmentId: p.id, code: sp.code, forced: false } });
      p.tl.at(tn, { notifiedAt: new Date(tn) });
    }
    const km = (distanceM(here, sp) / 1000) * 1.3;
    // the first leg of an inter-city order (Riyadh → Jeddah / Dammam) is a highway drive with rest stops; inside a city it is stop-and-go traffic
    const highway = km > 40;
    const speed = highway ? clamp(rng.normal(92, 8), 70, 110) : clamp(rng.normal(27, 5), 14, 42);
    const driveMin = (Math.max(1.5, (km / speed) * 60) + (highway ? Math.floor(km / 330) * rng.int(20, 40) : 0) + rng.float(0.5, 3.5)) * (highway ? 1 : 1 + (1 - q) * 0.4);
    const tArr = t + Math.round(driveMin * MIN);
    const near = jitter(rng, sp.lat, sp.lng, 0.04);
    p.tl.at(tArr, { arrivedAt: new Date(tArr) });
    R.ev(tArr, "stop_arrived", drv, { offer: O, payload: { shipmentId: p.id, code: sp.code, distanceM: rng.int(4, 120), lat: near.lat, lng: near.lng } });
    here = sp;
    const remaining = queue.length;
    // postponed once (needs a written reason and a photo, per the platform policy)
    if (!deferredOnce.has(p) && remaining > 0 && rng.chance(0.025)) {
      deferredOnce.add(p);
      const tD = tArr + rng.int(60, 240) * 1000;
      const note = rng.pick(DEFER_NOTES);
      const mediaId = ctx.ids.next("media");
      R.on(tD, () => ctx.sink.add("shipmentMedia", { id: mediaId, shipmentId: p.id, requestId: plan.id, offerId: O.id, kind: "defer", storageKey: PLACEHOLDER_KEY, mime: PLACEHOLDER_MIME, note, uploadedBy: d.id, usedAt: new Date(tD), createdAt: new Date(tD - 20_000) }));
      maxOrder += 1;
      p.tl.at(tD, { stopOrder: maxOrder, deferCount: 1, arrivedAt: null });
      R.ev(tD, "stop_deferred", drv, { offer: O, payload: { shipmentId: p.id, code: sp.code, note, mediaId } });
      R.notify(tD, biz.id, "shipment_deferred", { requestId: plan.id, ref, code: sp.code });
      queue.push(p); t = tD; continue;
    }
    // end of route: the driver cannot continue (breakdown, illness …)
    if (resolvedCount === endEarlyAt) {
      const reason = rng.pick(END_ROUTE_REASONS), tE = tArr + rng.int(30, 240) * 1000;
      const rest = [p, ...queue];
      for (const x of rest) {
        x.tl.at(tE, { status: "failed", failReason: "driver_unavailable", failedAt: new Date(tE) }); x.t.resolved = tE; failedHere.push(x);
        R.pev(tE, x, "failed", null, O, { reason: "driver_unavailable", system: true });
      }
      R.ev(tE + 1, "shipments_released", null, { offer: O, payload: { why: "driver_unavailable", toPool: 0, toReturn: rest.length } });
      R.ev(tE + 2, "route_ended_early", drv, { offer: O, old: "attendance_confirmed", neu: "delivered_reported", payload: { units: O.delivered, reason, note: null, toPool: 0, toReturn: rest.length } });
      R.notify(tE, biz.id, "route_ended_early", { requestId: plan.id, ref, driver: d.name, remaining: rest.length });
      if (O.officeId) R.notify(tE, O.officeId, "office_route_ended", { requestId: plan.id, ref, driver: d.name, remaining: rest.length });
      ctx.ticketSeeds.push({ at: tE + 3, userId: d.id, role: "driver", category: "urgent", requestId: plan.id, offerId: O.id, priority: "urgent", subject: `${ref}: route ended early (${reason})` });
      O.failedCount += rest.length; O.endedEarly = true; t = tE; queue.length = 0;
      break;
    }
    resolvedCount++;
    if (rng.chance(pFail)) {
      const reason = rng.weighted(FAIL_WEIGHTS.map(([r, w]) => [r, w] as const));
      const tF = tArr + Math.round(rng.float(reason === "unreachable" ? 4 : 2, reason === "unreachable" ? 14 : 9) * MIN);
      const note = rng.chance(reason === "wrong_address" || reason === "other" || reason === "damaged" ? 0.85 : 0.35) ? rng.pick(FAIL_NOTES[reason] ?? ["—"]) : null;
      let mediaId: string | undefined;
      if (rng.chance(0.35)) {
        mediaId = ctx.ids.next("media"); const mid = mediaId;
        R.on(tF, () => ctx.sink.add("shipmentMedia", { id: mid, shipmentId: p.id, requestId: plan.id, offerId: O.id, kind: "fail", storageKey: PLACEHOLDER_KEY, mime: PLACEHOLDER_MIME, note: null, uploadedBy: d.id, usedAt: new Date(tF), createdAt: new Date(tF - 30_000) }));
      }
      p.tl.at(tF, { status: "failed", failReason: reason, failNote: note, failedAt: new Date(tF), attempts: 1 }); p.t.resolved = tF;
      R.ev(tF, "shipment_failed", drv, { offer: O, payload: { shipmentId: p.id, code: sp.code, externalRef: sp.externalRef, reason, note, ...(mediaId ? { mediaId } : {}) } });
      R.notify(tF, biz.id, "shipment_failed", { requestId: plan.id, ref, code: sp.code, reason });
      O.failedCount++; failedHere.push(p); t = tF; continue;
    }
    // delivered: the recipient's code (consumers; businesses may use a signed receipt), cash collected when it is cash on delivery
    const proofType: "otp" | "receipt" | "scan" = requireOtp ? (sp.type === "business" && rng.chance(0.45) ? "receipt" : "otp") : "scan";
    let extra = 0;
    if (proofType === "otp" && rng.chance(0.06)) {
      const wrong = rng.int(1, 2);
      for (let k = 1; k <= wrong; k++) { const tw = tArr + k * 40_000; R.ev(tw, "stop_otp_failed", drv, { offer: O, payload: { shipmentId: p.id, code: sp.code, attempts: k } }); p.tl.at(tw, { otpAttempts: k }); extra += 40_000; }
      if (rng.chance(0.5)) {
        const tr = tArr + extra + 15_000;
        p.tl.at(tr, (s) => ({ otpVersion: (s.otpVersion ?? 1) + 1, otpAttempts: 0, otpSends: (s.otpSends ?? 0) + 1 }));
        R.ev(tr, "stop_code_resent", drv, { offer: O, payload: { shipmentId: p.id, code: sp.code } });
        R.ev(tr + 900, "recipient_notified", null, { offer: O, payload: { shipmentId: p.id, code: sp.code, forced: true } });
        extra += 30_000;
      }
    }
    let receiver: string | null = null;
    if (proofType === "receipt") {
      const tU = tArr + rng.int(20, 90) * 1000;
      receiver = saudiName(rng, "en");
      p.tl.at(tU, { proofKey: PLACEHOLDER_KEY });
      R.ev(tU, "stop_proof_uploaded", drv, { offer: O, payload: { shipmentId: p.id, code: sp.code } });
      extra += 60_000;
    }
    const tDel = tArr + extra + Math.round(rng.float(0.7, 5) * MIN);
    let sigId: string | undefined;
    if (requireSig) {
      sigId = ctx.ids.next("media"); const sid = sigId;
      R.on(tDel, () => ctx.sink.add("shipmentMedia", { id: sid, shipmentId: p.id, requestId: plan.id, offerId: O.id, kind: "signature", storageKey: PLACEHOLDER_KEY, mime: PLACEHOLDER_MIME, note: null, uploadedBy: d.id, usedAt: new Date(tDel), createdAt: new Date(tDel - 25_000) }));
    }
    const pin = jitter(rng, sp.lat, sp.lng, 0.03), dist = distanceM(pin, sp);
    p.tl.at(tDel, { status: "delivered", deliveredAt: new Date(tDel), deliveredLat: pin.lat, deliveredLng: pin.lng, deliveredDistanceM: dist, proofType, receiverName: receiver, attempts: 1, ...(sp.codCents > 0 ? { codCollectedCents: sp.codCents, codCollectedAt: new Date(tDel) } : {}) });
    p.t.resolved = tDel;
    R.ev(tDel, "shipment_delivered", drv, { offer: O, payload: { shipmentId: p.id, code: sp.code, externalRef: sp.externalRef, proofType, distanceM: dist, ...(sp.codCents > 0 ? { codCents: sp.codCents } : {}), ...(sigId ? { signatureMediaId: sigId } : {}) } });
    O.delivered++;
    if (sp.codCents > 0) { O.codCollected += sp.codCents; R.on(tDel, () => ctx.iv.cod.push({ at: tDel, cents: sp.codCents })); }
    t = tDel;
  }

  const tEnd = t;
  finishJob(R, O, loaded.length, tEnd, failedHere);
}

const scanActor = (scan: boolean, drv: ReturnType<Life["driverActor"]>, biz: Life["biz"]) => (scan ? drv : biz);

/** Report → confirmation → settlement → completion → returns, COD hand-over, rating, chat. Shared by delivery and rental jobs. */
function finishJob(R: Life, O: Offer, expected: number, tEnd: number, failedParcels: Parcel[]): void {
  const { ctx, rng, plan } = R;
  const d = O.driver, drv = R.driverActor(d), biz = R.biz;
  const tRep = tEnd + rng.int(20, 90) * 1000;
  const delivered = plan.service === "delivery_driver" ? O.delivered : (O.delivered || expected);
  O.tl.at(tRep, { status: "delivered_reported", deliveredUnits: delivered, deliveredAt: new Date(tRep) });
  R.ev(tRep, "delivery_reported", drv, { offer: O, old: "attendance_confirmed", neu: "delivered_reported", payload: { units: delivered } });
  R.notify(tRep, biz.id, "delivery_reported", { requestId: plan.id, ref: plan.ref, units: delivered });
  const final = Math.min(delivered, expected);
  const tConf = tRep + 1500;
  O.tl.at(tConf, { status: "pending_settlement", finalUnits: final, finalAt: new Date(tConf) });
  R.ev(tConf, "delivery_confirmed", null, { offer: O, old: "delivered_reported", neu: "pending_settlement", payload: { units: final, auto: true } });
  O.tDone = tConf + 800;
  settle(R, O, O.tDone, expected, final);
  O.completedAt = O.tDone + 450; // after the (immediate) payout at +400 ms; a held payout happens later but the job itself is closed now
  O.tl.at(O.completedAt, { status: "completed" });
  if (O.job) O.job.end = O.completedAt;
  R.notify(O.completedAt, d.id, "job_completed", { offerId: O.id, ref: plan.ref });

  // parcels that could not be delivered are received back by the warehouse
  if (failedParcels.length && rng.chance(0.92)) {
    const tRet = O.tDone + Math.round(rng.logNormal(5, 1.0) * HOUR);
    for (const [i, p] of failedParcels.entries()) {
      p.tl.at(tRet, { status: "returned", returnedAt: new Date(tRet) });
      R.pev(tRet + i, p, "returned", biz, O, { code: p.spec.code, failReason: p.tl.state(Infinity).failReason });
    }
    R.ev(tRet, "shipments_returned", biz, { offer: O, payload: { count: failedParcels.length, codes: failedParcels.map((p) => p.spec.code) } });
  }
  codHandover(R, O, tEnd);
  rateAndChat(R, O, tEnd);
  ctx.jobRefs.push({ t: O.tDone, requestId: plan.id, offerId: O.id, businessId: plan.company.id, driverId: d.id, officeId: O.officeId, ref: plan.ref, failed: O.failedCount, total: expected, driverName: d.name, parcelId: (failedParcels[0] ?? O.parcels[0])?.id ?? null });
}

/** A complaint filed while the job ends can hold its settlement until staff resolve it (the platform pays it as soon as the hold is lifted). */
function holdFor(R: Life, O: Offer, tDone: number): { filedAt: number; releaseAt: number; category: string } | null {
  const { rng } = R;
  const failShare = O.parcels.length ? O.failedCount / O.parcels.length : 0;
  const recent = tDone > R.ctx.asOf - 4 * DAY; // fresh jobs still waiting on a complaint: the finance "payouts on hold" list is never empty
  if (!rng.chance((recent ? 0.045 : 0.014) + failShare * 0.08)) return null;
  const category = rng.weighted([["damage", 30], ["delay", 25], ["service_quality", 25], ["payment", 10], ["other", 10]] as const);
  return { filedAt: tDone - rng.int(1, 20) * MIN, releaseAt: tDone + Math.max(3 * HOUR, Math.round(rng.logNormal(2.2, 0.7) * DAY)), category };
}

/** createSettlement + payoutTx, with the same arithmetic and postings as `settlement.ts` (reserve release → charge → payee payout → platform fee). */
function settle(R: Life, O: Offer, tDone: number, expected: number, final: number): void {
  const { ctx, plan } = R;
  const rule = plan.rule;
  const reserved = rule.priceCents * expected, customer = rule.priceCents * final, provider = rule.providerCostCents * final, margin = customer - provider;
  const vat = Math.round((customer * ctx.vatPct) / (100 + ctx.vatPct));
  const id = ctx.ids.next("settlement"); O.settlementId = id;
  const snap = (R.tl.base.pricingSnapshot ?? null) as Record<string, unknown> | null;
  const tl = new Tl<SettlementRow>({
    id, requestId: plan.id, offerId: O.id, driverId: O.driver.id, officeId: O.officeId, businessId: plan.company.id, finalUnits: final, reservedCents: reserved, customerCents: customer, providerCents: provider, marginCents: margin,
    vatCents: vat, refundCents: reserved - customer, adjustmentCents: 0, status: "approved", approvedAt: new Date(tDone), pricingSnapshot: snap as never, createdAt: new Date(tDone), updatedAt: new Date(tDone),
  });
  // held by an open complaint? payment waits for its resolution (the maintenance tick pays it then)
  const hold = holdFor(R, O, tDone);
  const tPaid = hold ? hold.releaseAt : tDone + 400;
  O.held = !!hold; O.paidAt = tPaid;
  if (hold) {
    ctx.complaintSeeds.push({ at: hold.filedAt, userId: plan.company.id, role: "business", category: hold.category, requestId: plan.id, offerId: O.id, priority: hold.category === "damage" ? "urgent" : "normal", holdsSettlement: true, resolveAt: hold.releaseAt - 1_000, lang: plan.lang });
    R.on(tDone, () => ctx.iv.settlementsPending.push({ from: tDone, to: tPaid, cents: provider }));
  }
  tl.at(tPaid, { status: "paid", paidAt: new Date(tPaid) });
  R.settlements.push({ tl, t: tDone, paidAt: tPaid });
  const payeeId = O.officeId ?? O.driver.id;
  const payeeWallet = O.officeId ? ctx.w.offices.find((o) => o.id === O.officeId)!.walletId : O.driver.walletId;
  const k = (n: string) => `${LEDGER_PREFIX}settle:${id}:${n}`;
  R.on(tPaid, () => {
    const p = ctx.postings, base = { requestId: plan.id, settlementId: id };
    p.push({ at: tPaid, accountId: plan.company.walletId, kind: "release_reserve", reserved: -reserved, available: reserved, key: k("release"), ...base });
    p.push({ at: tPaid, accountId: plan.company.walletId, kind: "charge", available: -customer, key: k("charge"), ...base });
    p.push({ at: tPaid, accountId: payeeWallet, kind: "payout", available: provider, key: k("payout"), offerId: O.id, ...base });
    p.push({ at: tPaid, accountId: ctx.platformWalletId, kind: "platform_fee", available: margin, key: k("fee"), ...base });
    ctx.sink.add("invoices", { id: ctx.ids.next("invoice"), number: refOf("invoice", ctx.ids.seq("invoice")), requestId: plan.id, settlementId: id, businessId: plan.company.id, subtotalCents: customer - vat, vatCents: vat, totalCents: customer, vatPct: ctx.vatPct, createdAt: new Date(tPaid) });
    ctx.sink.add("auditLogs", { id: ctx.ids.next("audit"), actorId: null, actorRole: "system", action: "settlement.pay", entity: "settlement", entityId: id, diff: { provider, margin } as never, ip: null, correlationId: null, createdAt: new Date(tPaid) });
    O.driver.fin.jobsCompleted++;
    ctx.stats.settlementsPaid = (ctx.stats.settlementsPaid ?? 0) + 1;
  });
  R.tl.at(tPaid, (s) => ({ reservedCents: (s.reservedCents ?? 0) - reserved }));
  R.ev(tPaid + 1, "payout_paid", null, { offer: O, payload: { settlementId: id } });
  R.notify(tPaid, payeeId, "payout_paid", { amountCents: provider });
  O.driver.jobsCompleted++;
}

/** Cash collected on the doorstep is handed over to the warehouse later — in one go, in parts, or (rarely) not at all. */
function codHandover(R: Life, O: Offer, tEnd: number) {
  const { ctx, rng, plan } = R;
  const total = O.codCollected;
  if (total <= 0) return;
  const q = O.driver.q;
  const lag = rng.weighted<number>([
    [Math.round(rng.float(20, 240) * MIN), 50], [Math.round(DAY * rng.float(0.5, 1.5)), 26], [Math.round(DAY * rng.float(2, 7)), 13],
    [Math.round(DAY * rng.float(8, 30)), 1.5 + (1 - q) * 9], [-1, 0.6 + (1 - q) * 7],
  ]);
  if (lag < 0) return; // the driver still holds it
  const scheme = rng.weighted([["full", 80], ["two", 12], ["part", 8]] as const);
  const parts = scheme === "full" ? [total] : scheme === "two" ? (() => { const a = Math.round((total * rng.float(0.4, 0.7)) / 100) * 100; return [a, total - a]; })() : [Math.round((total * rng.float(0.4, 0.9)) / 100) * 100];
  const opsReceives = rng.chance(0.2);
  parts.forEach((amount, i) => {
    if (amount <= 0) return;
    const at = tEnd + lag + i * Math.round(DAY * rng.float(0.5, 3));
    const staff = opsReceives ? rng.pick(ctx.w.staff.filter((s) => s.team === "ops" || s.team === "finance")) : null;
    const actor = staff ? { id: staff.id, name: staff.name, role: staff.role } : R.biz;
    const rid = ctx.ids.next("remittance"), ref = refOf("remittance", ctx.ids.seq("remittance"));
    R.on(at, () => {
      ctx.sink.add("codRemittances", { id: rid, ref, requestId: plan.id, offerId: O.id, driverId: O.driver.id, businessId: plan.company.id, amountCents: amount, receivedBy: actor.id, receivedByRole: actor.role, note: rng.chance(0.15) ? "Cash handed over at the warehouse" : null, createdAt: new Date(at) });
      ctx.iv.remit.push({ at, cents: amount });
      if (staff) ctx.sink.add("auditLogs", { id: ctx.ids.next("audit"), actorId: staff.id, actorRole: staff.role, action: "cod.receive", entity: "offer", entityId: O.id, diff: { amountCents: amount, ref } as never, ip: null, correlationId: null, createdAt: new Date(at) });
    });
    R.ev(at, "cod_received", actor, { offer: O, payload: { amountCents: amount, offerId: O.id, remittanceId: rid, outstandingCents: Math.max(0, total - parts.slice(0, i + 1).reduce((a, b) => a + b, 0)) } });
    R.notify(at, O.driver.id, "cod_received", { ref: plan.ref, amountCents: amount, amount: (amount / 100).toFixed(2) });
  });
}

/** Ratings (both directions where the app allows) and a little chat on some jobs. */
function rateAndChat(R: Life, O: Offer, tEnd: number) {
  const { ctx, rng, plan } = R;
  const d = O.driver, co = plan.company;
  const done = O.tDone ?? tEnd;
  const failShare = O.parcels.length ? O.failedCount / O.parcels.length : 0;
  if (rng.chance(0.55)) {
    const mu = 2.9 + 2.0 * d.q - failShare * 2; // a driver's mean rating runs from ≈ 3.2 (unreliable) to ≈ 4.9
    const stars = clamp(Math.round(rng.normal(mu, 0.75)), 1, 5);
    const at = done + Math.round(rng.logNormal(5, 1.1) * HOUR);
    d.ratingSum += stars; d.ratingCount++;
    R.on(at, () => {
      ctx.sink.add("ratings", { id: ctx.ids.next("rating"), offerId: O.id, raterId: co.id, rateeId: d.id, stars, comment: rng.chance(0.22) ? rng.pick(stars >= 4 ? COMMENTS_GOOD : COMMENTS_BAD) : null, createdAt: new Date(at) });
      d.fin.ratingSum += stars; d.fin.ratingCount++;
    });
  }
  if (rng.chance(0.2)) {
    const stars = clamp(Math.round(rng.normal(4.3, 0.8)), 1, 5);
    const at = done + Math.round(rng.logNormal(8, 1.0) * HOUR);
    R.on(at, () => {
      ctx.sink.add("ratings", { id: ctx.ids.next("rating"), offerId: O.id, raterId: d.id, rateeId: co.id, stars, comment: rng.chance(0.15) ? rng.pick(stars >= 4 ? COMMENTS_BIZ_GOOD : COMMENTS_BIZ_BAD) : null, createdAt: new Date(at) });
      co.fin.ratingSum += stars; co.fin.ratingCount++;
    });
  }
  if (rng.chance(0.1)) {
    const n = rng.int(2, 6), t0 = (O.jobPlan?.arrive ?? done) - rng.int(5, 40) * MIN;
    let t = t0;
    for (let i = 0; i < n; i++) {
      t += rng.int(2, 30) * MIN;
      if (t > done + HOUR) break;
      const fromBiz = i % 2 === 0 ? rng.chance(0.4) : rng.chance(0.2);
      const sender = fromBiz ? co.id : d.id, role = fromBiz ? "business" : "driver", body = rng.pick(fromBiz ? CHAT_BIZ : CHAT_DRIVER), tt = t;
      R.on(tt, () => ctx.sink.add("messages", { id: ctx.ids.next("message"), requestId: plan.id, offerId: O.id, senderId: sender, senderRole: role, body, createdAt: new Date(tt) }));
      R.notify(tt, fromBiz ? d.id : co.id, "chat_message", { ref: plan.ref, offerId: O.id });
    }
  }
}

/** Vehicle-with-driver rental: a driver for N days, no parcels; reported done at the end of the rental. */
export function runRentalJob(R: Life, O: Offer): void {
  const { ctx, rng, plan } = R;
  const jp = O.jobPlan!, d = O.driver, drv = R.driverActor(d), biz = R.biz, ref = plan.ref;
  const arrPt = jitter(rng, plan.pickupLat, plan.pickupLng, 0.1);
  O.tl.at(jp.arrive, { status: "arrived", arrivedAt: new Date(jp.arrive), arrivedLat: arrPt.lat, arrivedLng: arrPt.lng });
  R.ev(jp.arrive, "driver_arrived", drv, { offer: O, old: "accepted", neu: "arrived", payload: { lat: arrPt.lat, lng: arrPt.lng, distanceM: rng.int(8, 160) } });
  R.notify(jp.arrive, biz.id, "driver_arrived", { requestId: plan.id, ref, driver: d.name });
  const by = jp.autoAttend ? null : biz;
  O.tl.at(jp.attend, { status: "attendance_confirmed", attendanceAt: new Date(jp.attend), attendanceBy: by?.id ?? null });
  R.tl.at(jp.attend, (s) => (s.status === "assigned" || s.status === "confirmed" ? { status: "in_progress" } : {}));
  R.ev(jp.attend, "attendance_confirmed", by, { offer: O, old: "arrived", neu: "attendance_confirmed", payload: jp.autoAttend ? { auto: true } : null });
  if (by) R.notify(jp.attend, d.id, "attendance_confirmed", { offerId: O.id, ref });
  // custody (phone, charger …) handed to the driver on a quarter of the rentals
  if (rng.chance(0.25)) {
    const tH = jp.attend + rng.int(2, 15) * MIN;
    const items = rng.sample(["phone", "charger", "bag", "other"], rng.int(1, 2));
    const ids = items.map(() => ctx.ids.next("custody"));
    R.ev(tH, "custody_handover", biz, { offer: O, payload: { items: items.length } });
    R.notify(tH, d.id, "custody_handover", { ref });
    const tEndPlan = plan.startsAt + plan.durationDays * DAY;
    const outcome = rng.weighted([["returned", 90], ["not_returned", 6], ["damaged", 4]] as const);
    items.forEach((it, i) => {
      const tAck = tH + rng.int(3, 40) * MIN, tRet = tEndPlan + rng.int(5, 180) * MIN;
      R.on(tH, () => ctx.sink.add("custodyItems", { id: ids[i], requestId: plan.id, offerId: O.id, itemType: it, description: null, qty: 1, status: tRet <= ctx.asOf ? outcome : tAck <= ctx.asOf ? "acknowledged" : "handed_over", handedOverBy: biz.id, acknowledgedAt: tAck <= ctx.asOf ? new Date(tAck) : null, returnedAt: tRet <= ctx.asOf ? new Date(tRet) : null, returnNote: tRet <= ctx.asOf && outcome !== "returned" ? "Item not handed back after the rental" : null, createdAt: new Date(tH) }));
      if (i === 0) R.ev(tRet, `custody_${outcome}`, biz, { offer: O, payload: { itemId: ids[i] } });
    });
  }
  // rental period: the driver reports the days worked once it is over
  const days = plan.durationDays;
  const tEnd = Math.max(jp.attend + 30 * MIN, plan.startsAt + days * DAY - rng.int(0, 90) * MIN);
  O.delivered = Math.max(1, days - (rng.chance(0.06) ? 1 : 0));
  finishJob(R, O, days, tEnd, []);
}

export { Life };
