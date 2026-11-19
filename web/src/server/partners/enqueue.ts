import { and, eq, inArray } from "drizzle-orm";
import type { Exec } from "@/db";
import { partnerConnections, partnerOutbox, requests, shipments, type PartnerConnection } from "@/db/schema";
import type { EventInput } from "../events";
import { getAdapter } from "./registry";
import { DEFAULT_SETTINGS, type PartnerSettings, type PushAction } from "./types";

// Kept apart from service.ts on purpose: events.ts imports this file, and service.ts imports stops.ts (which imports events.ts).
export const settingsOf = (c: Pick<PartnerConnection, "settings">): PartnerSettings => {
  const s = (c.settings ?? {}) as Partial<PartnerSettings>;
  return { sync: s.sync ?? {}, autoCancel: s.autoCancel ?? DEFAULT_SETTINGS.autoCancel };
};
const EVENT_ACTION: Record<string, PushAction> = { shipment_delivered: "delivered", shipment_failed: "failed", shipments_returned: "returned", shipment_cancelled: "cancelled" };

/** Called from logEvent inside the same transaction: parcel outcomes become outbox rows, so a rolled-back action never reaches the partner. */
export async function enqueuePartnerOutbox(x: Exec, e: EventInput) {
  const action = EVENT_ACTION[e.type];
  if (!action) return;
  const p = (e.payload ?? {}) as { shipmentId?: string; codes?: string[] };
  const rows = p.shipmentId
    ? await x.select().from(shipments).where(eq(shipments.id, p.shipmentId))
    : p.codes?.length ? await x.select().from(shipments).where(and(eq(shipments.requestId, e.requestId), inArray(shipments.code, p.codes))) : [];
  const linked = rows.filter((s) => s.partnerId && s.externalRef);
  if (!linked.length) return;
  const [r] = await x.select({ businessId: requests.businessId }).from(requests).where(eq(requests.id, e.requestId));
  if (!r) return;
  const conns = await x.select().from(partnerConnections).where(and(inArray(partnerConnections.id, [...new Set(linked.map((s) => s.partnerId!))]), eq(partnerConnections.businessId, r.businessId), eq(partnerConnections.status, "active")));
  for (const s of linked) {
    const c = conns.find((k) => k.id === s.partnerId);
    const a = c && getAdapter(c.provider);
    if (!c || !a || !a.capabilities.push.includes(action) || !settingsOf(c).sync[action]) continue;
    if (action === "cancelled" && /cancel/i.test(s.partnerStatus ?? "")) continue; // the partner told us — don't echo it back
    await x.insert(partnerOutbox).values({
      connectionId: c.id, businessId: r.businessId, shipmentId: s.id, requestId: s.requestId, action,
      payload: { id: s.id, code: s.code, externalRef: s.externalRef, failReason: s.failReason, failNote: s.failNote, deliveredAt: s.deliveredAt?.toISOString() ?? null, proofType: s.proofType },
    }).onConflictDoNothing();
  }
}

