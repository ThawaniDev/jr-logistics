import { createHmac } from "node:crypto";
import { arr, date, failFrom, num, obj, str } from "./http";
import { JR_EVENTS, PartnerError, type Adapter, type EventKind, type PartnerEvent, type PartnerOrderInput } from "./types";

/**
 * "Custom system" — JR's own documented contract for any warehouse / order system without a ready-made adapter (decision I17).
 *
 * IN  (their system → JR):  POST <webhook URL>  with  Authorization: Bearer <token>   (or the token in the URL path)
 *   status change:  { "reference": "ORD-1001", "status": "cancelled" | "<anything>", "note": "…", "at": "ISO date" }
 *   new order:      { "type": "order", "reference": "ORD-1001", "id": "<your id>", "recipient": { "name", "phone", "address", "city",
 *                     "lat", "lng", "email" }, "cod": 120.5, "pieces": 2, "weightKg": 1.2, "contents": "…", "notes": "…",
 *                     "items": [{ "sku", "name", "qty" }] }
 *   several at once: { "items": [ …any of the above… ] }  (≤ 50)
 * OUT (JR → their system):  POST <callback URL>, signed like JR's other webhooks:
 *   x-jr-signature: t=<unix>,v1=<hex hmac-sha256(signing secret, "<t>.<body>")>,  x-jr-event: parcel.<event>
 *   { "event": "parcel.picked_up" | "parcel.out_for_delivery" | "parcel.delivered" | …, "reference", "awb", "code", "status",
 *     "reason", "note", "proof", "attempts", "receiverName", "codCollected", "driver", "occurredAt" }
 */
const KINDS: Record<string, EventKind> = { cancelled: "cancelled", canceled: "cancelled", delivered: "delivered", returned: "returned", failed: "failed" };

function one(b: Record<string, unknown>): { order?: PartnerOrderInput; event?: PartnerEvent } | null {
  const ref = str(b.reference) ?? str(b.barcode) ?? str(b.externalRef) ?? str(b.orderId);
  if (!ref) return null;
  const type = str(b.type)?.toLowerCase() ?? (b.recipient ? "order" : null);
  if (type === "order") {
    const r = obj(b.recipient) ?? {};
    return { order: {
      externalId: str(b.id), externalRef: ref, invoice: str(b.invoice),
      recipient: { name: str(r.name), phone: str(r.phone), email: str(r.email), address: str(r.address), city: str(r.city), lat: num(r.lat), lng: num(r.lng) },
      codAmount: num(b.cod), currency: str(b.currency) ?? "SAR", pieces: num(b.pieces), weightKg: num(b.weightKg), contents: str(b.contents), notes: str(b.notes),
      items: arr(b.items).map(obj).filter(Boolean).map((i) => ({ sku: str(i!.sku), name: str(i!.name), qty: num(i!.qty) })),
    } };
  }
  const status = str(b.status);
  if (!status) return null;
  const at = date(b.at);
  return { event: { externalId: str(b.id), barcode: ref, invoice: null, status, kind: KINDS[status.toLowerCase()] ?? "status", at: at ?? new Date(), timeKnown: !!at, note: b.note ? String(b.note).slice(0, 300) : null } };
}

export const generic: Adapter = {
  key: "webhook",
  label: "Custom system (webhook)",
  description: "Any other warehouse or order system: it posts orders and status changes to JR, and JR posts every parcel event back to it.",
  fields: [
    { key: "callbackUrl", label: "Send JR events to (optional)", type: "url", placeholder: "https://warehouse.example.com/jr-callback", help: "JR POSTs every parcel event you switch on here, signed with your signing secret." },
    { key: "signingSecret", label: "Signing secret", type: "password", secret: true, help: "Used to sign what JR sends you. Leave empty to have one generated." },
  ],
  capabilities: { mode: "custom", lookup: false, webhookIn: true, webhookAuth: "header", registerWebhook: false, importOrders: true, pollOrders: false, track: false, push: JR_EVENTS.filter((e) => e !== "accepted"), label: false, carrierApi: false }, // "accepted" exists only for carrier-mode orders
  inboundTokenHeaders: ["authorization", "x-jr-token", "x-api-key"],
  defaults: { importNew: true, sync: { picked_up: true, out_for_delivery: true, delivered: true, failed: true, returned: true, missing: true, cancelled: true } },

  async test(c) {
    const url = String(c.config.callbackUrl || "");
    if (!url) return { message: "Ready to receive. No callback URL set, so JR will not send anything to your system." };
    const body = JSON.stringify({ event: "ping", occurredAt: new Date().toISOString() });
    const ts = Math.floor(Date.now() / 1000);
    const r = await c.http("POST", url, { headers: sign(c.secrets.signingSecret, ts, body, "ping"), json: JSON.parse(body) });
    if (!r.ok) failFrom(r, "Your callback URL");
    return { message: `Your system answered ${r.status}` };
  },

  parseWebhook(body) {
    const b = obj(body);
    if (!b) return null;
    const list = Array.isArray(b.items) && !b.reference ? arr(b.items).map(obj).filter((x): x is Record<string, unknown> => !!x).slice(0, 50) : [b];
    const events: PartnerEvent[] = [], orders: PartnerOrderInput[] = [];
    for (const x of list) { const r = one(x); if (r?.event) events.push(r.event); if (r?.order) orders.push(r.order); }
    return events.length || orders.length ? { events, orders } : null;
  },

  async push(c, job) {
    const url = String(c.config.callbackUrl || "");
    if (!url) return { ok: true, skipped: "no callback URL configured" };
    const s = job.shipment;
    const payload = {
      event: `parcel.${job.action}`, reference: job.order?.externalRef ?? s?.externalRef ?? null, awb: job.order?.awb ?? null, code: s?.code ?? null, status: job.status,
      reason: s?.failReason ?? null, note: s?.failNote ?? job.note ?? null, proof: s?.proofType ?? null, attempts: s?.attempts ?? 0, receiverName: s?.receiverName ?? null,
      codCollected: s?.codCollectedCents != null ? s.codCollectedCents / 100 : null, driver: job.driver?.name ?? null, occurredAt: job.at,
    };
    const body = JSON.stringify(payload);
    const ts = Math.floor(Date.now() / 1000);
    const r = await c.http("POST", url, { headers: sign(c.secrets.signingSecret, ts, body, payload.event), json: payload });
    if (!r.ok) failFrom(r, "Your callback URL");
    return { ok: true };
  },
};

function sign(secret: string | undefined, ts: number, body: string, event: string): Record<string, string> {
  if (!secret) throw new PartnerError("config", "Signing secret is missing");
  return { "x-jr-event": event, "x-jr-signature": `t=${ts},v1=${createHmac("sha256", secret).update(`${ts}.${body}`).digest("hex")}` };
}
