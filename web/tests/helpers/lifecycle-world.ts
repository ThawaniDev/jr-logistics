import { and, asc, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { offers, requests, shipments, type User } from "@/db/schema";
import * as jobs from "@/server/jobs";
import * as stops from "@/server/stops";
import { createSession } from "@/server/auth/session";
import { finishLoading, scanLoad } from "@/server/loading";
import { otpFor } from "@/server/shipments";
import { mkAdmin, mkBusiness, mkDriver, mkRule, publishedRequest, mkShipments, WAREHOUSE } from "./factories";
import { call } from "./api";

/**
 * Shared world builder for the lifecycle audit suites (A3): a published delivery request with one driver whose offer can be walked to
 * any state of the offer state machine through the REAL domain functions, plus snapshot helpers to prove a refused action changed nothing.
 */
export const tok = async (u: { id: string }) => (await createSession(u.id, "mobile")).token;
export const offerRow = async (id: string) => (await db.select().from(offers).where(eq(offers.id, id)))[0];
export const requestRow = async (id: string) => (await db.select().from(requests).where(eq(requests.id, id)))[0];
export const parcelsOf = async (offerId: string) => db.select().from(shipments).where(eq(shipments.offerId, offerId)).orderBy(asc(shipments.stopOrder), asc(shipments.seq));
export const allParcels = async (requestId: string) => db.select().from(shipments).where(eq(shipments.requestId, requestId)).orderBy(asc(shipments.seq));

export type OfferState =
  | "offered" | "accepted" | "arrived" | "att_empty" | "att_scanned" | "att_loaded" | "att_working" | "att_all_resolved"
  | "completed" | "cancelled" | "rejected" | "no_show" | "replaced" | "expired" | "request_cancelled";
export const OFFER_STATES: OfferState[] = ["offered", "accepted", "arrived", "att_empty", "att_scanned", "att_loaded", "att_working", "att_all_resolved", "completed", "cancelled", "rejected", "no_show", "replaced", "expired", "request_cancelled"];

export interface World { admin: User; biz: User; driver: User; other: User; requestId: string; offerId: string; ref: string; n: number }

/**
 * `state`: where the driver's offer is. `routing` = the platform switch (the caller sets it before building; the world only needs it to know whether an approve step exists).
 * The request holds `n` parcels for one driver (`shipmentsPerDriver = n`), so the driver carries all of them.
 */
export async function worldAt(state: OfferState, o: { n?: number; routing?: boolean; ops?: NonNullable<Parameters<typeof mkBusiness>[0]>["ops"] } = {}): Promise<World> {
  const n = o.n ?? 3;
  const admin = await mkAdmin(); await mkRule(admin);
  const biz = await mkBusiness({ fundsCents: 5000_00, ops: o.ops });
  const driver = await mkDriver(); const other = await mkDriver();
  const r = await publishedRequest(biz, { shipments: mkShipments(n, { withRefs: true }), shipmentsPerDriver: n });
  const offer = (await db.select().from(offers).where(and(eq(offers.requestId, r.id), eq(offers.driverId, driver.id))))[0];
  const w: World = { admin, biz, driver, other, requestId: r.id, offerId: offer.id, ref: r.ref, n };
  if (state === "offered") return w;
  if (state === "rejected") { await jobs.rejectOffer(driver, offer.id); return w; }
  if (state === "expired") { await db.update(offers).set({ status: "expired" }).where(eq(offers.id, offer.id)); return w; }
  await jobs.acceptOffer(driver, offer.id, true);
  if (state === "accepted") return w;
  if (state === "cancelled") { await jobs.driverCancel(driver, offer.id, "cannot make it"); return w; }
  if (state === "request_cancelled") { const { cancelRequest } = await import("@/server/requests"); await cancelRequest(biz, r.id, "business changed its mind"); return w; }
  // the job window opens: check in at the warehouse (the business confirms the arrival → attendance)
  await db.update(requests).set({ startsAt: new Date(Date.now() + 3600_000) }).where(eq(requests.id, r.id));
  await jobs.checkIn(driver, offer.id, WAREHOUSE);
  if (state === "arrived") return w;
  if (state === "no_show") { await db.update(requests).set({ startsAt: new Date(Date.now() - 60_000) }).where(eq(requests.id, r.id)); await jobs.confirmAttendance(biz, offer.id, false, "never showed"); return w; }
  await jobs.confirmAttendance(biz, offer.id, true);
  if (state === "att_empty") return w;
  if (state === "replaced") { await jobs.staffReplace(admin, offer.id, "ops replaced the driver"); return w; }
  const ps = await parcelsOf(offer.id);
  await scanLoad(driver, offer.id, ps[0].code);
  if (state === "att_scanned") return w;
  for (const p of ps.slice(1)) await scanLoad(driver, offer.id, p.code);
  await finishLoading(driver, offer.id);
  if (!(await offerRow(offer.id)).routeApprovedAt) { if (state === "att_loaded") return w; await stops.approveRoute(driver, offer.id); }
  else if (state === "att_loaded") return w; // routing off: loading already started the route — "loaded" and "working" coincide
  if (state === "att_working") return w;
  // every stop resolved: all delivered except the last, which is refused at the door
  const live = await parcelsOf(offer.id);
  for (let i = 0; i < live.length; i++) {
    const s = (await parcelsOf(offer.id)).find((x) => x.status === "loaded")!;
    await stops.arriveAtStop(driver, offer.id, s.id);
    if (i < live.length - 1) await stops.deliverStop(driver, offer.id, s.id, { code: s.code, otp: otpFor(s) });
    else await stops.failStop(driver, offer.id, s.id, { reason: "refused" });
  }
  if (state === "att_all_resolved") return w;
  await jobs.reportDelivered(driver, offer.id);
  return w; // completed
}

/** Everything a refused action must leave untouched. */
export async function snapshot(requestId: string) {
  const q = async (text: string) => (await db.execute(sql.raw(text))).rows;
  return JSON.stringify([
    await q(`select id, status, slots_filled, reserved_cents, total_cents, version from requests where id = '${requestId}'`),
    await q(`select id, status, loaded_units, delivered_units, final_units, route_approved_at, loaded_ack_by_driver, cancel_reason, updated_at from offers where request_id = '${requestId}' order by id`),
    await q(`select id, status, offer_id, stop_order, arrived_at, defer_count, otp_attempts, otp_version, otp_sends, cod_collected_cents, fail_reason, returned_at, updated_at from shipments where request_id = '${requestId}' order by id`),
    await q(`select count(*)::int n from ledger_entries`),
    await q(`select count(*)::int n from job_events where request_id = '${requestId}'`),
    await q(`select count(*)::int n from shipment_events where request_id = '${requestId}'`),
    await q(`select count(*)::int n from notifications`),
    await q(`select count(*)::int n from tickets`),
    await q(`select count(*)::int n from settlements`),
    await q(`select user_id, availability, suspended_until from driver_profiles order by user_id`),
  ]);
}

export { call, WAREHOUSE };
