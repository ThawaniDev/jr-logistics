import { and, asc, eq } from "drizzle-orm";
import type { Exec } from "@/db";
import { shipmentEvents, shipments } from "@/db/schema";
import { capture, jsonSafe, milestonesFor, touchRequest } from "./data-capture";
import { partnerSyncJourney } from "./partners/sync";

/**
 * The per-parcel journey (decision G5). Most rows are derived from the job events the domain code already writes (`logEvent` with a
 * `shipmentId` in the payload); the bulk operations (allocate, hand-over, release, cancel …) call `recordShipmentEvents` directly.
 */
export const SHIPMENT_EVENT_TYPES = [
  "created", "edited", "details_completed", "assigned", "unassigned", "loaded", "unscanned", "route_positioned", "arrived", "otp_sent", "otp_failed", "otp_verified",
  "deferred", "failed", "delivered", "cod_collected", "returned", "missing", "cancelled", "reshipped", "notify_failed", "proof_uploaded", "partner_status",
] as const;
export type ShipmentEventType = (typeof SHIPMENT_EVENT_TYPES)[number];

export interface ShipEvt {
  shipmentId: string; requestId: string; offerId?: string | null; type: ShipmentEventType;
  actor?: { id: string; name: string; role: string } | null; payload?: Record<string, unknown>; at?: Date;
}

/** job-event type → parcel event type (for the events that carry `payload.shipmentId`). */
export const JOB_TO_PARCEL: Record<string, ShipmentEventType> = {
  stop_arrived: "arrived", stop_otp_failed: "otp_failed", shipment_delivered: "delivered", shipment_failed: "failed", stop_deferred: "deferred",
  stop_code_resent: "otp_sent", recipient_notified: "otp_sent", recipient_notify_failed: "notify_failed", loading_scanned: "loaded", loading_unscanned: "unscanned",
  shipment_updated: "edited", shipment_details_completed: "details_completed", shipment_cancelled: "cancelled", partner_status: "partner_status", stop_proof_uploaded: "proof_uploaded",
};
/** The job-event types that are mirrored into the parcel journey — the activity feed shows them once, from `shipment_events`. */
export const MIRRORED_JOB_EVENTS = Object.keys(JOB_TO_PARCEL);

interface JobEventLike { requestId: string; offerId?: string | null; actor?: ShipEvt["actor"]; type: string; payload?: Record<string, unknown> | null }

/** Pure: the parcel-journey rows one job event stands for (none when it has no `shipmentId` or is not a parcel-level event). */
export function parcelRowsFromJobEvent(e: JobEventLike): ShipEvt[] {
  const p = e.payload ?? {};
  const shipmentId = typeof p.shipmentId === "string" ? p.shipmentId : null;
  const type = JOB_TO_PARCEL[e.type];
  if (!shipmentId || !type) return [];
  const { shipmentId: _id, ...rest } = p; void _id;
  const base = { shipmentId, requestId: e.requestId, offerId: e.offerId ?? null, actor: e.actor ?? null };
  if (e.type === "shipment_delivered") {
    const out: ShipEvt[] = [];
    if (p.proofType === "otp") out.push({ ...base, type: "otp_verified", payload: { code: p.code } });
    out.push({ ...base, type: "delivered", payload: rest });
    if (Number(p.codCents) > 0) out.push({ ...base, type: "cod_collected", payload: { code: p.code, amountCents: p.codCents } });
    return out;
  }
  if (e.type === "loading_scanned") return [{ ...base, type, payload: { ...rest, via: "scan" } }];
  if (e.type === "recipient_notified") return [{ ...base, type, payload: { ...rest, channel: "sms" } }];
  return [{ ...base, type, payload: rest }];
}

const CHUNK = 500;
/** Appends rows to the parcel journey. Rows of the same parcel within one call get strictly increasing timestamps so their order is stable. */
export async function recordShipmentEvents(x: Exec, rows: ShipEvt[]): Promise<void> {
  if (!rows.length) return;
  const base = Date.now(), seen = new Map<string, number>();
  const values = rows.map((r) => {
    const k = seen.get(r.shipmentId) ?? 0; seen.set(r.shipmentId, k + 1);
    return {
      shipmentId: r.shipmentId, requestId: r.requestId, offerId: r.offerId ?? null, type: r.type, actorId: r.actor?.id ?? null, actorRole: r.actor?.role ?? "system", actorName: r.actor?.name ?? null,
      payload: jsonSafe(r.payload ?? null), createdAt: new Date((r.at?.getTime() ?? base) + k),
    };
  });
  await capture(x, "shipment_events", async (t) => { for (let i = 0; i < values.length; i += CHUNK) await t.insert(shipmentEvents).values(values.slice(i, i + CHUNK)); });
  // Warehouse-system write-back (decision I9): every parcel event a linked partner wants becomes an ordered outbox entry, same transaction.
  await partnerSyncJourney(x, rows.map((r, i) => ({ ...r, at: values[i].createdAt })));
}

/** A route was planned or re-ordered: every parcel still on board gets its (new) position in the driver's route. */
async function routePositions(x: Exec, e: JobEventLike): Promise<void> {
  if (!e.offerId || (e.type !== "route_planned" && e.type !== "route_reordered")) return;
  const offerId = e.offerId;
  await capture(x, "route_positioned", async (t) => {
    const rows = await t.select({ id: shipments.id, order: shipments.stopOrder, dist: shipments.legDistanceM, dur: shipments.legDurationS, code: shipments.code })
      .from(shipments).where(and(eq(shipments.offerId, offerId), eq(shipments.status, "loaded"))).orderBy(asc(shipments.stopOrder), asc(shipments.seq));
    await recordShipmentEvents(t, rows.map((s) => ({ shipmentId: s.id, requestId: e.requestId, offerId, type: "route_positioned" as const, actor: e.actor ?? null,
      payload: { code: s.code, stopOrder: s.order, legDistanceM: s.dist, legDurationS: s.dur, by: e.type === "route_reordered" ? "driver" : (e.payload?.by ?? "system") } })));
  });
}

/** Called by `logEvent` after the job event is stored: mirrors parcel-level events and stamps the request's activity / milestones. */
export async function captureFromJobEvent(x: Exec, e: JobEventLike): Promise<void> {
  const rows = parcelRowsFromJobEvent(e);
  if (rows.length) await recordShipmentEvents(x, rows);
  await routePositions(x, e);
  await touchRequest(x, e.requestId, milestonesFor(e.type, e.payload));
}

/** A parcel batch with one shared type/actor/payload (assigned, unassigned, loaded, returned …). */
export const batchOf = (ids: string[], requestId: string, type: ShipmentEventType, o: { offerId?: string | null; actor?: ShipEvt["actor"]; payload?: Record<string, unknown> } = {}): ShipEvt[] =>
  ids.map((shipmentId) => ({ shipmentId, requestId, type, offerId: o.offerId ?? null, actor: o.actor ?? null, payload: o.payload }));
