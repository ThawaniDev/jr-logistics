import { failFrom, errorDetail } from "./http";
import { PartnerError, type Adapter, type JrEvent, type StatusOption } from "./types";

/**
 * Omniful (https://docs.omniful.tech → "Shipping Partner") — Omniful's standard contract for third-party carriers. JR is the carrier:
 * Omniful CALLS JR's API (implemented in carrier-omniful.ts, base URL `<APP_URL>/api/v1/carriers/omniful`) and JR posts status changes to
 * the per-account `webhook_url` Omniful registered through `POST /webhooks/register`.
 * Mode: carrier. Verified against the published Postman collection (2026-11-19):
 *  Omniful → JR:  POST /auth/token (access_token mode) | POST /auth/validate (api_key mode), POST /shipments, POST /shipments/cancel,
 *                 GET /shipments/{awb}/tracking, GET /shipments/{awb}/label, POST /webhooks/register,
 *                 return-shipment endpoints (JR answers "not supported": JR does not collect parcels from customers — decision I15).
 *  JR → Omniful:  POST <webhook_url> {awb_number, status, status_updated_at, description, reason, number_of_attempts, …}, no auth.
 *  Envelope:      {success:true,data:{…}} | {success:false,error:{code,message}}; 10-second timeout on every call to JR.
 *  Status values (track + webhook): dispatched, in_transit, out_for_delivery, delivered, unable_to_deliver, lost, partially_delivered,
 *                 return_in_progress, return_to_origin. "Other values may not update shipments."
 */
export const OMNIFUL_STATUSES: StatusOption[] = [
  { value: "dispatched", label: "Dispatched" },
  { value: "in_transit", label: "In transit" },
  { value: "out_for_delivery", label: "Out for delivery" },
  { value: "delivered", label: "Delivered" },
  { value: "unable_to_deliver", label: "Unable to deliver" },
  { value: "lost", label: "Lost" },
  { value: "partially_delivered", label: "Partially delivered" },
  { value: "return_in_progress", label: "Return in progress" },
  { value: "return_to_origin", label: "Returned to origin" },
];
const LABEL = Object.fromEntries(OMNIFUL_STATUSES.map((s) => [s.value, s.label]));

/** JR event → Omniful status (decision I10). Editable per connection; "" = do not send. */
export const OMNIFUL_DEFAULT_MAP: Partial<Record<JrEvent, string>> = {
  picked_up: "dispatched", out_for_delivery: "out_for_delivery", delivered: "delivered", failed: "unable_to_deliver", returned: "return_to_origin", missing: "lost",
  // The company cancelled the parcel in JR / set the order aside: Omniful has no "cancelled by carrier" value, the nearest documented one
  // with the reason, so the merchant knows JR will not deliver it (Omniful's own cancellations are never echoed).
  cancelled: "unable_to_deliver",
};

export const omniful: Adapter = {
  key: "omniful",
  label: "Omniful",
  description: "JR appears in Omniful as a shipping partner: Omniful sends shipments to JR and every JR status change flows back to Omniful.",
  docsUrl: "https://docs.omniful.tech/#66865a26-649e-4d85-8302-febff8568103",
  fields: [
    { key: "acceptCod", label: "Accept cash-on-delivery shipments", type: "boolean", default: true, help: "When off, Omniful shipments with COD are refused at creation." },
  ],
  capabilities: {
    mode: "carrier", lookup: false, webhookIn: false, webhookAuth: "header", registerWebhook: false, importOrders: true, pollOrders: false, track: false,
    push: ["assigned", "picked_up", "out_for_delivery", "arrived", "delivered", "failed", "postponed", "returned", "missing", "cancelled", "reshipped"], label: false, carrierApi: true,
  },
  inboundTokenHeaders: ["authorization"],
  defaults: { importNew: true, statusOut: OMNIFUL_DEFAULT_MAP, sync: { picked_up: true, out_for_delivery: true, delivered: true, failed: true, returned: true, missing: true, cancelled: true } },
  statusOut: OMNIFUL_STATUSES,
  statusOutStrict: true, // "Allowed values: dispatched … return_to_origin"

  async test(c) {
    const url = typeof c.meta.webhookUrl === "string" ? c.meta.webhookUrl : null;
    const seen = typeof c.meta.lastCarrierCallAt === "string" ? c.meta.lastCarrierCallAt : null;
    if (!url && !seen) return { message: "Ready. Enter JR's API address and your JR key in Omniful (Shipping partners → JR); Omniful has not called JR yet." };
    return { message: `Omniful is connected${seen ? ` (last call ${seen.slice(0, 16).replace("T", " ")} UTC)` : ""}${url ? "; status updates go to the webhook Omniful registered" : "; Omniful has not registered a webhook yet, so it will poll JR for status"}.` };
  },

  async push(c, job) {
    const url = typeof c.meta.webhookUrl === "string" ? c.meta.webhookUrl : null;
    if (!url) return { ok: true, skipped: "Omniful has not registered its webhook URL yet (it can still poll JR's tracking endpoint)" };
    if (!job.status) return { ok: true, skipped: `no Omniful status is mapped to "${job.action}"` };
    if (!job.order?.awb) return { ok: true, skipped: "parcel has no JR tracking number for Omniful" };
    const s = job.shipment;
    const body: Record<string, unknown> = {
      awb_number: job.order.awb, status: job.status, status_updated_at: job.at, description: LABEL[job.status] ?? job.status,
      number_of_attempts: job.attempts ?? s?.attempts ?? 0,
    };
    const reason = job.action === "failed" ? [s?.failReason, s?.failNote].filter(Boolean).join(" — ") : job.action === "cancelled" ? job.note ?? "Cancelled by the warehouse in JR" : job.note;
    if (reason) body.reason = reason.slice(0, 250);
    const r = await c.http("POST", url, { json: body });
    if (!r.ok) failFrom(r, "Omniful webhook");
    const b = r.body as { success?: unknown } | null;
    if (b && typeof b === "object" && b.success === false) throw new PartnerError("rejected", `Omniful refused the update: ${errorDetail(r)}`);
    return { ok: true };
  },
};
