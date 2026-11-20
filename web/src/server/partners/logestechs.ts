import { arr, date, failFrom, num, obj, str } from "./http";
import { PartnerError, type Adapter, type Ctx, type EventKind, type PartnerEvent, type PartnerPackage } from "./types";

/**
 * LogesTech (https://docs.logestechs.com) — the customer "integration API", one `X-API-Key: psk_integration_…` per customer account.
 * Mode: merchant. Verified against the published OpenAPI pages (2026-11-19):
 *  ✔ current status of a package           GET  /secure/integration/packages/status?id|barcode|invoice  → object of strings (keys unpublished)
 *  ✔ full status history                   GET  /secure/integration/packages/status/history?…           → PackageStatusResponse[]
 *  ✔ the status catalogue (en/ar labels)   GET  /secure/integration/packages/statuses                    → [{key,englishValue,arabicValue}]
 *  ✔ cancel before pick-up                 PUT  /secure/integration/packages/cancel?…
 *  ✔ ask for a return (out for delivery)   PUT  /secure/integration/packages/return?…&timezone=  body NoteMessage {note}
 *  ✔ set JR's webhook URL + token          PUT  /secure/integration/webhook  {webhookUrl, webhookPassword}
 *  ✔ AWB PDF (≤100 identifiers)            POST /secure/integration/packages/awb  {ids|barcodes|invoicesNumbers}  → object of strings (a URL)
 *  ✔ status webhook (no retries)           → JR /integrations/hooks/:id, token in Authorization / api_key / ApiKey / api-key / x-api-key
 *  ✘ no "list my packages" and no "set status" call: JR cannot pull a worklist or write its own progress (picked up, delivered …) into
 *    LogesTech. Packages are linked by barcode (typed, scanned, imported) or arrive through the webhook; JR reconciles with the history call
 *    because LogesTech does not retry webhooks.
 */
export const DEFAULT_BASE = "https://apisv5.logestechs.com/api";

const base = (c: Ctx) => String(c.config.baseUrl || DEFAULT_BASE).replace(/\/+$/, "");
const headers = (c: Ctx) => ({ "x-api-key": c.secrets.apiKey ?? "" });
const needKey = (c: Ctx) => { if (!c.secrets.apiKey) throw new PartnerError("config", "LogesTech API key is missing"); };
/** `id` when we know LogesTech's numeric package id, otherwise the barcode (the docs: "provide exactly one of id, barcode, invoice"). */
const which = (r: { externalId: string | null; externalRef: string }) => (r.externalId && /^\d+$/.test(r.externalId) ? `id=${r.externalId}` : `barcode=${encodeURIComponent(r.externalRef)}`);

/** Reads the first present key (case-insensitive, also one level down in `data` / `package` / `result`) — the status response has no published keys. */
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

/** Default reading of LogesTech status keys (the catalogue is per company; the business can override any key in the mapping editor). */
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
    // Only the documented package id: an "id" key in this unpublished object could be a status-record id, and cancel / return use it.
    externalId: str(pick(body, ["packageId"])), barcode: str(pick(body, ["barcode"])) ?? asked, invoice: str(pick(body, ["invoiceNumber", "invoice"])),
    status: str(pick(body, ["statusKey", "newStatus", "status", "packageTrackingStatus"])),
    recipientName: str(pick(body, ["receiverName", "recipientName", "receiver_name"])),
    recipientPhone: str(pick(body, ["receiverPhone", "recipientPhone", "receiver_phone"])),
    address: str(pick(body, ["destinationAddressLine1", "addressLine1", "address", "destinationAddress", "receiverAddress"])),
    city: str(pick(body, ["destinationCity", "cityName", "city"])),
    codAmount: num(pick(body, ["cod", "codAmount"])), raw: undefined,
  };
}

/** Latest entry of a PackageStatusResponse[] (documented schema) as a status event. */
export function latestHistory(body: unknown, ref: string): PartnerEvent | null {
  const rows = arr(body).map(obj).filter((r): r is Record<string, unknown> => !!r);
  if (!rows.length) return null;
  const at = (r: Record<string, unknown>) => date(r.createdDate)?.getTime() ?? 0;
  const last = rows.reduce((a, b) => (at(b) >= at(a) ? b : a));
  const status = str(last.statusKey) ?? str(last.packageTrackingStatus);
  if (!status) return null;
  return {
    externalId: str(last.packageId), barcode: ref, invoice: null, status, kind: classifyStatus(status), at: date(last.createdDate) ?? new Date(),
    note: str(last.failedStatus), summary: { status, packageTrackingStatus: str(last.packageTrackingStatus), failedStatus: str(last.failedStatus), changedBy: str(last.changedBy) },
  };
}

export const logestechs: Adapter = {
  key: "logestechs",
  label: "LogesTech",
  description: "Link LogesTech packages by barcode or invoice number, follow every status change, and cancel or return them from JR.",
  docsUrl: "https://docs.logestechs.com/overview-2344856m0",
  fields: [
    { key: "apiKey", label: "Integration API key", type: "password", secret: true, required: true, placeholder: "psk_integration_…", help: "Created by your LogesTech company admin under Partners → API Integrations. Shown only once there." },
    { key: "baseUrl", label: "API address", type: "url", placeholder: DEFAULT_BASE, default: DEFAULT_BASE, help: "Only change this if LogesTech gave you a different (white-label or sandbox) address.", advanced: true },
    { key: "timezone", label: "Time zone for returns", type: "text", default: "Asia/Riyadh", placeholder: "Asia/Riyadh", help: "IANA time zone LogesTech stamps a return with.", advanced: true },
  ],
  capabilities: { mode: "merchant", lookup: true, webhookIn: true, webhookAuth: "header", registerWebhook: true, importOrders: true, pollOrders: false, track: true, push: ["cancelled", "returned"], label: true, carrierApi: false },
  inboundTokenHeaders: ["authorization", "api_key", "apikey", "api-key", "x-api-key"],
  // Webhooks are fire-and-forget on LogesTech's side, so linked packages are reconciled every 30 minutes by default.
  defaults: { pollMinutes: 30, importNew: false },
  classify: classifyStatus,

  async test(c) {
    needKey(c);
    // Cities need a valid key, so a 200 here proves the key works; the status catalogue is stored for the mapping editor.
    const r = await c.http("GET", `${base(c)}/secure/integration/address/cities`, { headers: headers(c) });
    if (!r.ok) failFrom(r, "LogesTech");
    const n = Array.isArray(r.body) ? r.body.length : null;
    const s = await c.http("GET", `${base(c)}/secure/integration/packages/statuses`, { headers: headers(c) });
    const catalog = s.ok ? arr(s.body).map(obj).filter(Boolean).map((x) => ({ value: str(x!.key) ?? "", label: str(x!.englishValue) ?? str(x!.key) ?? "", labelAr: str(x!.arabicValue) })).filter((x) => x.value) : [];
    if (catalog.length) await c.saveMeta({ statusCatalog: catalog, statusCatalogAt: new Date().toISOString() });
    return { message: `Connected to LogesTech${n == null ? "" : ` (${n} cities in the address book${catalog.length ? `, ${catalog.length} package statuses` : ""})`}` };
  },

  async lookup(c, identifier): Promise<PartnerPackage> {
    needKey(c);
    const id = identifier.trim();
    for (const param of ["barcode", "invoice"]) {
      const r = await c.http("GET", `${base(c)}/secure/integration/packages/status?${param}=${encodeURIComponent(id)}`, { headers: headers(c) });
      if (r.status === 404 || r.status === 400) continue;
      if (r.status === 403) throw new PartnerError("rejected", "LogesTech: this package belongs to a different customer", 403);
      if (!r.ok) failFrom(r, "LogesTech lookup");
      const p = normalise(r.body, id);
      if (param === "invoice" && !p.invoice) p.invoice = id;
      return p;
    }
    return { found: false, externalId: null, barcode: id, invoice: null, status: null, recipientName: null, recipientPhone: null, address: null, city: null, codAmount: null };
  },

  async track(c, ref) {
    needKey(c);
    const r = await c.http("GET", `${base(c)}/secure/integration/packages/status/history?${which(ref)}`, { headers: headers(c) });
    // 404 unknown, 403 "belongs to a different customer", 400 bad identifier: nothing to reconcile for this order (not a key problem).
    if (r.status === 404 || r.status === 403 || r.status === 400) return null;
    if (!r.ok) failFrom(r, "LogesTech status history");
    return latestHistory(r.body, ref.externalRef);
  },

  parseWebhook(body) {
    const b = obj(body);
    if (!b) return null;
    const status = str(b.newStatus) ?? str(b.status);
    const barcode = str(b.barcode), invoice = str(b.invoiceNumber), externalId = str(b.packageId);
    if (!status || (!barcode && !invoice && !externalId)) return null;
    const at = date(b.time) ?? new Date();
    // Only non-sensitive context is kept for the audit trail: no pin code, no signature link, no driver phone.
    const event: PartnerEvent = {
      externalId, barcode, invoice, status, kind: classifyStatus(status), at,
      note: str(b.reason) ?? str(b.notes),
      summary: { status, newStatus: str(b.newStatus), previous: str(b.status), driverName: str(b.driverName), postponedDeliveryDate: str(b.postponedDeliveryDate), hasSignature: !!b.signatureUrl, attachments: Array.isArray(b.attachmentUrls) ? b.attachmentUrls.length : 0, paymentMethod: str(b.paymentMethod) },
    };
    const ref = barcode ?? invoice ?? externalId!;
    // A package JR has not seen yet can be added to Incoming orders (setting "importNew"); the webhook carries no recipient, so JR
    // enriches it with a status lookup and the business completes the rest.
    return { events: [event], orders: [{ externalId, externalRef: ref, invoice, recipient: {}, codAmount: num(b.cod), status, statusAt: at, extra: { paymentMethod: str(b.paymentMethod) } }] };
  },

  async registerWebhook(c, url, token) {
    needKey(c);
    const r = await c.http("PUT", `${base(c)}/secure/integration/webhook`, { headers: headers(c), json: { webhookUrl: url, webhookPassword: token } });
    if (!r.ok) failFrom(r, "LogesTech webhook registration");
  },

  async push(c, job) {
    needKey(c);
    const ref = job.order ?? (job.shipment?.externalRef ? { externalId: null, externalRef: job.shipment.externalRef } : null);
    if (!ref) return { ok: true, skipped: "parcel has no LogesTech reference" };
    const q = which(ref);
    if (job.action === "cancelled") {
      const r = await c.http("PUT", `${base(c)}/secure/integration/packages/cancel?${q}`, { headers: headers(c) });
      if (r.status === 400) return { ok: true, skipped: "LogesTech: only packages still awaiting approval or assignment can be cancelled" }; // not retryable
      if (r.status === 404) return { ok: true, skipped: "LogesTech: package not found" };
      if (!r.ok) failFrom(r, "LogesTech cancel");
      return { ok: true };
    }
    if (job.action === "returned") {
      const s = job.shipment;
      const note = `JR Logistics: delivery not completed${s?.failReason ? ` (${s.failReason})` : ""}${s?.failNote ? ` — ${s.failNote}` : ""}`.slice(0, 240);
      const tz = String(c.config.timezone || "Asia/Riyadh");
      const r = await c.http("PUT", `${base(c)}/secure/integration/packages/return?${q}&timezone=${encodeURIComponent(tz)}`, { headers: headers(c), json: { note } });
      if (r.status === 404) return { ok: true, skipped: "LogesTech: package not found" };
      if (r.status === 400) return { ok: true, skipped: "LogesTech: a return can only be requested while the package is out for delivery" };
      if (!r.ok) failFrom(r, "LogesTech return");
      return { ok: true };
    }
    return { ok: true, skipped: `LogesTech has no API call for "${job.action}"` };
  },

  async makeLabel(c, refs) {
    needKey(c);
    // PackageIdentifiersWrapper: ids / barcodes / invoicesNumbers, ≤100 in total.
    const ids = refs.filter((r) => r.externalId && /^\d+$/.test(r.externalId)).map((r) => Number(r.externalId)).slice(0, 100);
    const barcodes = refs.filter((r) => !(r.externalId && /^\d+$/.test(r.externalId))).map((r) => r.externalRef).slice(0, 100 - ids.length);
    const r = await c.http("POST", `${base(c)}/secure/integration/packages/awb`, { headers: headers(c), json: { ...(ids.length ? { ids } : {}), ...(barcodes.length ? { barcodes } : {}) } });
    if (!r.ok) failFrom(r, "LogesTech label");
    const url = r.body && typeof r.body === "object" ? Object.values(r.body as Record<string, unknown>).find((v) => typeof v === "string" && /^https?:\/\//.test(v)) : null;
    if (typeof url !== "string") throw new PartnerError("rejected", "LogesTech did not return a label link");
    return { url };
  },
};
