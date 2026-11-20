import { arr, date, failFrom, joinParts, num, obj, str } from "./http";
import { PartnerError, type Adapter, type Ctx, type PartnerEvent, type PartnerPackage } from "./types";

/**
 * Fizzpa (https://fizzpa.docs.apiary.io) — the agent (merchant) API of a Fizzpa-powered shipping company.
 * Mode: merchant. Verified against the published API Blueprint (2026-11-19). Every call carries `Authorization: <your key>` (the key
 * itself, no "Bearer") and `Referer: <URL>`.
 *  ✔ who am I (credential check)    GET    /Auth/me                    → {success, userData{FullName, CompanyName_En …}}
 *  ✔ one order (all details)        GET    /orders/{orderid}           → {OrderId, OrderRef, Recipient*, OrderStatus_En, IsDelivered …}
 *  ✔ tracking history               GET    /Tracking/{orderid}         → [{TrackingStatus, WhereIN, Note, TrackingDate}]
 *  ✔ delete (cancel) before pickup  DELETE /orders/{orderid}           → {success, Message}
 *  ✘ no webhooks, no order list, no "set status" call, and lookups are by Fizzpa's numeric OrderId only (OrderRef is not searchable).
 *    So JR imports orders by their OrderId, polls the order for status changes, and can cancel before pickup — nothing more.
 *  ✘ the label endpoint (GET /orders/label/{id}/{ar|en}/{A4|A6}) documents no response body, so JR does not offer it.
 *  COD: the only documented pairing is CollectionTypeId 1 = "Without Collection" (COD 0). For any other collection type the amount to
 *  collect is not documented, so JR leaves COD for the business to confirm instead of guessing.
 */
export const DEFAULT_BASE = "https://rest.fizzpa.net/api";

const base = (c: Ctx) => String(c.config.baseUrl || DEFAULT_BASE).replace(/\/+$/, "");
function headers(c: Ctx) {
  if (!c.secrets.apiKey) throw new PartnerError("config", "Fizzpa API key is missing");
  return { authorization: c.secrets.apiKey, referer: String(c.config.referer || c.appUrl) };
}
const idOf = (s: string) => { const v = s.trim(); if (!/^\d{1,18}$/.test(v)) return null; return v; };

/** A GET /orders/{id} body → a lookup result. */
export function fizzpaPackage(b: Record<string, unknown>, asked: string): PartnerPackage {
  const phone = str(b.Phone1) ? `${str(b.Phonecode1) ?? ""}${str(b.Phone1)}` : null;
  const collection = num(b.CollectionTypeId);
  return {
    found: true, externalId: str(b.OrderId), barcode: str(b.OrderId) ?? asked, invoice: str(b.OrderRef), status: str(b.OrderStatus_En) ?? str(b.OrderStatusId),
    recipientName: str(b.RecipientName), recipientPhone: phone, address: joinParts(b.RecipientAddress, b.RecipientNeighborhood) ?? str(b.RecipientAddressLine),
    city: str(b.RecipientCityName_En) ?? str(b.RecipientCity) ?? str(b.RecipientCityName_Ar), lat: num(b.RecipientLatitude), lng: num(b.RecipientLongitude),
    codAmount: collection === 1 ? 0 : null, pieces: num(b.PieceCount), notes: str(b.OrderNote) ?? str(b.Notes),
    extra: { collectionType: str(b.CollectionType_En), collectionTypeId: collection, agentTotal: num(b.AgentTotal), isDelivered: b.IsDelivered === true, cityId: num(b.CityId) },
  };
}

export const fizzpa: Adapter = {
  key: "fizzpa",
  label: "Fizzpa",
  description: "Import Fizzpa orders by their order number, follow their status on a schedule, and cancel them before pickup.",
  docsUrl: "https://fizzpa.docs.apiary.io/#reference",
  fields: [
    { key: "apiKey", label: "API key", type: "password", secret: true, required: true, help: "The key Fizzpa issued for your agent account. It is sent as-is in the Authorization header." },
    { key: "referer", label: "Registered website address", type: "url", required: true, placeholder: "https://your-store.example.com", help: "Fizzpa requires a Referer header on every call — use the website address registered with your key." },
    { key: "baseUrl", label: "API address", type: "url", default: DEFAULT_BASE, placeholder: DEFAULT_BASE, advanced: true },
  ],
  capabilities: { mode: "merchant", lookup: true, webhookIn: false, webhookAuth: "header", registerWebhook: false, importOrders: true, pollOrders: false, track: true, push: ["cancelled"], label: false, carrierApi: false },
  inboundTokenHeaders: [],
  // Polling is the only way to hear about changes in Fizzpa.
  defaults: { pollMinutes: 30, importNew: false },
  classify: () => "status",

  async test(c) {
    const r = await c.http("GET", `${base(c)}/Auth/me`, { headers: headers(c) });
    if (!r.ok) failFrom(r, "Fizzpa");
    const b = obj(r.body);
    if (b?.success === false) throw new PartnerError("auth", `Fizzpa rejected the key${str(b.message) ? ` (${str(b.message)})` : ""}`);
    const u = obj(b?.userData);
    return { message: `Connected to Fizzpa${u ? ` as ${str(u.FullName) ?? str(u.UserId)}${str(u.CompanyName_En) ? ` (${str(u.CompanyName_En)})` : ""}` : ""}` };
  },

  async lookup(c, identifier) {
    const id = idOf(identifier);
    const miss: PartnerPackage = { found: false, externalId: null, barcode: identifier.trim(), invoice: null, status: null, recipientName: null, recipientPhone: null, address: null, city: null, codAmount: null };
    if (!id) return miss; // Fizzpa only finds orders by their numeric OrderId
    const r = await c.http("GET", `${base(c)}/orders/${id}`, { headers: headers(c) });
    if (r.status === 404) return miss;
    if (!r.ok) failFrom(r, "Fizzpa lookup");
    const b = obj(r.body);
    if (!b || !str(b.OrderId)) return miss;
    return fizzpaPackage(b, id);
  },

  async track(c, ref) {
    // Only Fizzpa's own OrderId (set when the order was looked up / imported): a numeric reference the company typed could be
    // another Fizzpa order of the same account.
    const id = ref.externalId ? idOf(ref.externalId) : null;
    if (!id) return null;
    const [o, t] = await Promise.all([
      c.http("GET", `${base(c)}/orders/${id}`, { headers: headers(c) }),
      c.http("GET", `${base(c)}/Tracking/${id}`, { headers: headers(c) }),
    ]);
    if (o.status === 404 || o.status === 403 || o.status === 400) return null;
    if (!o.ok) failFrom(o, "Fizzpa tracking");
    const b = obj(o.body);
    if (!b) return null;
    const rows = t.ok ? arr(t.body).map(obj).filter((x): x is Record<string, unknown> => !!x) : [];
    const last = rows.length ? rows.reduce((a, x) => ((date(x.TrackingDate)?.getTime() ?? 0) >= (date(a.TrackingDate)?.getTime() ?? 0) ? x : a)) : null;
    const delivered = b.IsDelivered === true;
    const status = delivered ? "Delivered" : str(b.OrderStatus_En) ?? str(b.OrderStatusId) ?? "unknown";
    const ev: PartnerEvent = {
      externalId: id, barcode: ref.externalRef, invoice: str(b.OrderRef), status, kind: delivered ? "delivered" : "status",
      at: date(last?.TrackingDate) ?? new Date(), timeKnown: !!date(last?.TrackingDate), note: str(last?.Note), summary: { status, whereIn: str(last?.WhereIN), trackingStatus: num(last?.TrackingStatus), isDelivered: delivered },
    };
    return ev;
  },

  async push(c, job) {
    if (job.action !== "cancelled") return { ok: true, skipped: `Fizzpa has no API call for "${job.action}"` };
    const id = job.order?.externalId ? idOf(job.order.externalId) : null;
    if (!id) return { ok: true, skipped: "this order was never looked up in Fizzpa (no Fizzpa OrderId) — nothing is deleted" };
    const r = await c.http("DELETE", `${base(c)}/orders/${id}`, { headers: headers(c) });
    if (r.status === 404) return { ok: true, skipped: "Fizzpa: order not found" };
    if (!r.ok) failFrom(r, "Fizzpa cancel");
    const b = obj(r.body);
    if (b?.success === false) return { ok: true, skipped: `Fizzpa refused (${str(b.Message) ?? str(b.message) ?? "already picked up?"})` };
    return { ok: true };
  },
};
