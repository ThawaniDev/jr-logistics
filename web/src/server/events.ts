import { eq } from "drizzle-orm";
import { db, type Exec } from "@/db";
import { jobEvents, requests, businessProfiles, webhookDeliveries, type User } from "@/db/schema";
import { enqueuePartnerOutbox } from "./partners/enqueue";

/** Events that are pushed to business webhooks. Payloads are minimised (no PII). */
export const WEBHOOK_EVENTS = new Set([
  "request_published", "driver_accepted", "driver_arrived", "attendance_confirmed", "delivery_reported",
  "delivery_confirmed", "shipment_delivered", "shipment_failed", "request_completed", "request_cancelled", "driver_cancelled", "driver_replaced", "payout_paid",
]);

export interface EventInput {
  requestId: string;
  offerId?: string | null;
  actor?: Pick<User, "id" | "name" | "role"> | null;
  type: string;
  oldStatus?: string | null;
  newStatus?: string | null;
  payload?: Record<string, unknown>;
}

export async function logEvent(x: Exec, e: EventInput) {
  await x.insert(jobEvents).values({
    requestId: e.requestId, offerId: e.offerId ?? null, actorId: e.actor?.id ?? null,
    actorName: e.actor?.name ?? null, actorRole: e.actor?.role ?? "system", type: e.type,
    oldStatus: e.oldStatus ?? null, newStatus: e.newStatus ?? null, payload: (e.payload ?? null) as never,
  });
  if (WEBHOOK_EVENTS.has(e.type)) await enqueueWebhook(x, e);
  await enqueuePartnerOutbox(x, e); // warehouse-system write-back (no-op unless the parcel is linked to a connection that wants it)
}

async function enqueueWebhook(x: Exec, e: EventInput) {
  const [r] = await x.select({ businessId: requests.businessId, ref: requests.ref, status: requests.status })
    .from(requests).where(eq(requests.id, e.requestId));
  if (!r) return;
  const [bp] = await x.select({ url: businessProfiles.webhookUrl }).from(businessProfiles).where(eq(businessProfiles.userId, r.businessId));
  if (!bp?.url) return;
  await x.insert(webhookDeliveries).values({
    businessId: r.businessId, requestId: e.requestId, event: e.type, url: bp.url,
    payload: { event: e.type, request: { id: e.requestId, ref: r.ref, status: r.status }, offerId: e.offerId ?? null, status: e.newStatus ?? null,
      shipment: e.payload?.shipmentId ? { id: e.payload.shipmentId, code: e.payload.code ?? null, externalRef: e.payload.externalRef ?? null, reason: e.payload.reason ?? null } : undefined } as never,
  });
}

export { db };
