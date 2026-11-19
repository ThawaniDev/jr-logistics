import { failFrom } from "./http";
import { PartnerError, type Adapter, type Ctx, type EventKind, type PartnerEvent, type PartnerPackage } from "./types";

/**
 * LogesTech (https://docs.logestechs.com) — integration API, authenticated with one `X-API-Key: psk_integration_…` header per customer.
 *
 * What the public API gives us, and what it does not (so nobody expects more from this adapter than the vendor offers):
 *  ✔ look a package up by barcode / invoice number        GET  /secure/integration/packages/status
 *  ✔ receive status changes (webhook, no retries on their side)   → our /integrations/hooks/:id
 *  ✔ cancel a package that has not been picked up           PUT  /secure/integration/packages/cancel
 *  ✔ ask for a package to be returned to sender             PUT  /secure/integration/packages/return
 *  ✔ set our webhook URL + token on their side              PUT  /secure/integration/webhook
 *  ✔ print the AWB label                                    POST /secure/integration/packages/awb
 *  ✘ there is NO "list my packages" call and NO "set status delivered" call, so JR cannot pull a worklist or mark a package delivered
 *    in LogesTech. Parcels are therefore linked by barcode/invoice (typed, scanned or pasted), and "delivered/failed" is not written back.
 */
export const DEFAULT_BASE = "https://apisv5.logestechs.com/api";

const base = (c: Ctx) => String(c.config.baseUrl || DEFAULT_BASE).replace(/\/+$/, "");
const headers = (c: Ctx) => ({ "x-api-key": c.secrets.apiKey ?? "" });
const needKey = (c: Ctx) => { if (!c.secrets.apiKey) throw new PartnerError("config", "LogesTech API key is missing"); };

/** Reads the first present key (case-insensitive, also one level down in `data` / `package` / `result`) — the status response has no published schema. */
export function pick(obj: unknown, names: string[]): unknown {
  const layers: Record<string, unknown>[] = [];
  const add = (o: unknown) => { if (o && typeof o === "object" && !Array.isArray(o)) layers.push(o as Record<string, unknown>); };
  add(obj);
  if (Array.isArray(obj)) add(obj[obj.length - 1]);
  for (const l of [...layers]) for (const k of ["data", "package", "result", "content"]) { const v = l[k]; add(Array.isArray(v) ? v[0] : v); }
  for (const l of layers) {
    const lower = new Map(Object.keys(l).map((k) => [k.toLowerCase(), k]));
    for (const n of names) {
      const hit = lower.get(n.toLowerCase());
      if (hit && l[hit] != null && l[hit] !== "") return l[hit];
    }
  }
  return null;
}
const str = (v: unknown) => (v == null || typeof v === "object" ? null : String(v).trim() || null);
const num = (v: unknown) => { const n = Number(v); return v == null || v === "" || !Number.isFinite(n) ? null : n; };

/** Maps LogesTech status keys onto what JR understands. Unknown keys stay plain "status" (shown to the warehouse, never acted on). */
export function classifyStatus(key: string): EventKind {
  const k = key.toUpperCase();
  if (/CANCEL/.test(k)) return "cancelled";
  if (/^DELIVERED/.test(k) || /DELIVERED_TO_RECIPIENT/.test(k)) return "delivered";
  if (/RETURN/.test(k)) return "returned";
  if (/FAIL|UNSUCCESS|REJECT/.test(k)) return "failed";
  return "status";
}

function normalise(body: unknown, asked: string): PartnerPackage {
  return {
    found: true,
    externalId: str(pick(body, ["packageId", "id"])), barcode: str(pick(body, ["barcode"])) ?? asked, invoice: str(pick(body, ["invoiceNumber", "invoice"])),
    status: str(pick(body, ["statusKey", "newStatus", "status", "packageTrackingStatus"])),
    recipientName: str(pick(body, ["receiverName", "recipientName", "receiver_name"])),
    recipientPhone: str(pick(body, ["receiverPhone", "recipientPhone", "receiver_phone"])),
    address: str(pick(body, ["destinationAddressLine1", "addressLine1", "address", "destinationAddress", "receiverAddress"])),
    city: str(pick(body, ["destinationCity", "cityName", "city"])),
    codAmount: num(pick(body, ["cod", "codAmount"])), raw: undefined,
  };
}

export const logestechs: Adapter = {
  key: "logestechs",
  label: "LogesTech",
  description: "Link LogesTech packages by barcode or invoice number, follow their status, and keep both systems in step.",
  docsUrl: "https://docs.logestechs.com/overview-2344856m0",
  fields: [
    { key: "apiKey", label: "Integration API key", type: "password", secret: true, required: true, placeholder: "psk_integration_…", help: "Created by your LogesTech company admin under Partners → API Integrations. Shown only once there." },
    { key: "baseUrl", label: "API address", type: "url", placeholder: "https://apisv5.logestechs.com/api", default: DEFAULT_BASE, help: "Only change this if LogesTech gave you a different (white-label or sandbox) address." },
  ],
  capabilities: { lookup: true, webhookIn: true, registerWebhook: true, push: ["returned", "cancelled"], label: true },
  inboundTokenHeaders: ["authorization", "api_key", "apikey", "api-key", "x-api-key"],

  async test(c) {
    needKey(c);
    // Cities need a valid key (the statuses reference does not), so a 200 here proves the key works.
    const r = await c.http("GET", `${base(c)}/secure/integration/address/cities`, { headers: headers(c) });
    if (!r.ok) failFrom(r, "LogesTech");
    const n = Array.isArray(r.body) ? r.body.length : null;
    return { message: n == null ? "Connected to LogesTech" : `Connected to LogesTech (${n} cities in the address book)` };
  },

  async lookup(c, identifier): Promise<PartnerPackage> {
    needKey(c);
    const id = identifier.trim();
    for (const param of ["barcode", "invoice"]) {
      const r = await c.http("GET", `${base(c)}/secure/integration/packages/status?${param}=${encodeURIComponent(id)}`, { headers: headers(c) });
      if (r.status === 404) continue;
      if (r.status === 400) continue;
      if (!r.ok) failFrom(r, "LogesTech lookup");
      const p = normalise(r.body, id);
      if (param === "invoice" && !p.invoice) p.invoice = id;
      return p;
    }
    return { found: false, externalId: null, barcode: id, invoice: null, status: null, recipientName: null, recipientPhone: null, address: null, city: null, codAmount: null };
  },

  parseWebhook(body): PartnerEvent | null {
    if (!body || typeof body !== "object") return null;
    const b = body as Record<string, unknown>;
    const status = str(b.newStatus) ?? str(b.status);
    const barcode = str(b.barcode), invoice = str(b.invoiceNumber), externalId = b.packageId != null ? str(b.packageId) : null;
    if (!status || (!barcode && !invoice && !externalId)) return null;
    const t = b.time ? new Date(String(b.time)) : new Date();
    // Only non-sensitive context is kept for the audit trail: no pin code, no signature link, no driver phone.
    return {
      externalId, barcode, invoice, status, kind: classifyStatus(status), at: Number.isNaN(t.getTime()) ? new Date() : t,
      note: str(b.reason) ?? str(b.notes),
      summary: { status, newStatus: str(b.newStatus), driverName: str(b.driverName), postponedDeliveryDate: str(b.postponedDeliveryDate), hasSignature: !!b.signatureUrl, attachments: Array.isArray(b.attachmentUrls) ? b.attachmentUrls.length : 0 },
    };
  },

  async registerWebhook(c, url, token) {
    needKey(c);
    const r = await c.http("PUT", `${base(c)}/secure/integration/webhook`, { headers: headers(c), json: { webhookUrl: url, webhookPassword: token } });
    if (!r.ok) failFrom(r, "LogesTech webhook registration");
  },

  async push(c, job) {
    needKey(c);
    const ref = job.shipment.externalRef;
    if (!ref) return { ok: true, skipped: "parcel has no order reference" };
    const q = `barcode=${encodeURIComponent(ref)}`;
    if (job.action === "cancelled") {
      const r = await c.http("PUT", `${base(c)}/secure/integration/packages/cancel?${q}`, { headers: headers(c) });
      if (r.status === 400) return { ok: true, skipped: "LogesTech: already cancelled or already in process" }; // not retryable
      if (r.status === 404) return { ok: true, skipped: "LogesTech: package not found" };
      if (!r.ok) failFrom(r, "LogesTech cancel");
      return { ok: true };
    }
    if (job.action === "returned") {
      const note = `JR Logistics: delivery not completed${job.shipment.failReason ? ` (${job.shipment.failReason})` : ""}${job.shipment.failNote ? ` — ${job.shipment.failNote}` : ""}`.slice(0, 240);
      const r = await c.http("PUT", `${base(c)}/secure/integration/packages/return?${q}&timezone=${encodeURIComponent("Asia/Riyadh")}`, { headers: headers(c), json: { note } });
      if (r.status === 404) return { ok: true, skipped: "LogesTech: package not found" };
      if (!r.ok) failFrom(r, "LogesTech return");
      return { ok: true };
    }
    return { ok: true, skipped: `LogesTech has no "${job.action}" call` };
  },

  async makeLabel(c, identifiers) {
    needKey(c);
    const r = await c.http("POST", `${base(c)}/secure/integration/packages/awb`, { headers: headers(c), json: { barcodes: identifiers.slice(0, 100) } });
    if (!r.ok) failFrom(r, "LogesTech label");
    const url = r.body && typeof r.body === "object" ? Object.values(r.body as Record<string, unknown>).find((v) => typeof v === "string" && /^https?:\/\//.test(v)) : null;
    if (typeof url !== "string") throw new PartnerError("rejected", "LogesTech did not return a label link");
    return { url };
  },
};
