import { createHmac } from "node:crypto";
import { failFrom } from "./http";
import { PartnerError, type Adapter, type PartnerEvent, type EventKind } from "./types";

/**
 * "Custom system" — for any warehouse system that can send a small JSON webhook (and, optionally, receive one).
 *
 * IN  (their system → JR):  POST <webhook URL>  with  Authorization: Bearer <token>
 *       { "reference": "ORD-1001", "status": "cancelled" | "ready" | "dispatched" | "<anything>", "note": "…", "at": "ISO date" }
 *       `reference` is the order number / barcode the warehouse put on the parcel (JR matches it to the parcel's order reference).
 * OUT (JR → their system): POST <callback URL>  signed like our other webhooks (x-jr-signature: t=<unix>,v1=<hmac-sha256(secret, "<t>.<body>")>)
 *       { "event": "parcel.delivered" | "parcel.failed" | "parcel.returned" | "parcel.cancelled", "reference", "code", "reason", "occurredAt" }
 */
const KINDS: Record<string, EventKind> = { cancelled: "cancelled", canceled: "cancelled", delivered: "delivered", returned: "returned", failed: "failed" };

export const generic: Adapter = {
  key: "webhook",
  label: "Custom system (webhook)",
  description: "Any other warehouse or order system: it posts status changes to JR, and JR can post parcel outcomes back to it.",
  fields: [
    { key: "callbackUrl", label: "Send JR outcomes to (optional)", type: "url", placeholder: "https://warehouse.example.com/jr-callback", help: "We POST delivered / failed / returned / cancelled events here, signed with your signing secret." },
    { key: "signingSecret", label: "Signing secret", type: "password", secret: true, help: "Used to sign what we send you. Leave empty to have one generated." },
  ],
  capabilities: { lookup: false, webhookIn: true, registerWebhook: false, push: ["delivered", "failed", "returned", "cancelled"], label: false },
  inboundTokenHeaders: ["authorization", "x-jr-token", "x-api-key"],

  async test(c) {
    const url = String(c.config.callbackUrl || "");
    if (!url) return { message: "Ready to receive. No callback URL set, so JR will not send anything to your system." };
    const body = JSON.stringify({ event: "ping", occurredAt: new Date().toISOString() });
    const ts = Math.floor(Date.now() / 1000);
    const r = await c.http("POST", url, { headers: sign(c.secrets.signingSecret, ts, body, "ping"), json: JSON.parse(body) });
    if (!r.ok) failFrom(r, "Your callback URL");
    return { message: `Your system answered ${r.status}` };
  },

  parseWebhook(body): PartnerEvent | null {
    if (!body || typeof body !== "object") return null;
    const b = body as Record<string, unknown>;
    const ref = String(b.reference ?? b.barcode ?? b.externalRef ?? b.orderId ?? "").trim();
    const status = String(b.status ?? "").trim();
    if (!ref || !status) return null;
    const at = b.at ? new Date(String(b.at)) : new Date();
    return { externalId: null, barcode: ref, invoice: null, status, kind: KINDS[status.toLowerCase()] ?? "status", at: Number.isNaN(at.getTime()) ? new Date() : at, note: b.note ? String(b.note).slice(0, 300) : null };
  },

  async push(c, job) {
    const url = String(c.config.callbackUrl || "");
    if (!url) return { ok: true, skipped: "no callback URL configured" };
    const payload = { event: `parcel.${job.action}`, reference: job.shipment.externalRef, code: job.shipment.code, reason: job.shipment.failReason, note: job.shipment.failNote, proof: job.shipment.proofType, occurredAt: new Date().toISOString() };
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
