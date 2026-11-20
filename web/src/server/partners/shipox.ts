import { createHash } from "node:crypto";
import { arr, date, failFrom, joinParts, num, obj, str } from "./http";
import { PartnerError, type Adapter, type Ctx, type EventKind, type HttpOptions, type PartnerEvent, type PartnerOrderInput, type PartnerPackage } from "./types";

/**
 * Shipox (https://shipox.docs.apiary.io) — the merchant ("customer") API of a Shipox-powered delivery company.
 * Mode: merchant. Verified against the published API Blueprint (2026-11-19):
 *  ✔ sign in → JWT valid 24 h              POST /api/v1/customer/authenticate {username,password,remember_me} → data.id_token
 *  ✔ account (cheap credential check)       GET  /api/v1/customer/account
 *  ✔ list / search my orders                GET  /api/v1/customer/orders?page&size≤200&status=a,b&from_date_time&search
 *  ✔ order details (sender / recipient)     GET  /api/v1/customer/order/{id}/mobile
 *  ✔ status history                         GET  /api/v1/customer/order/{order_number}/history_items
 *  ✔ cancel                                 PUT  /api/v1/customer/order/{order_id}/status?status=cancelled
 *  ✔ AWB PDF link                           GET  /api/v1/customer/orders/airwaybill_mini?ids=…&order_numbers=… → {Data:{Value:url}}
 *  ✔ webhook — set BY HAND in the Shipox admin (Customers → Finance Settings → Company Endpoint). Body:
 *      {order_number, reference_id, status, note, date, customer_id, driver?}. Shipox documents NO authentication header, so JR's
 *      webhook URL carries the connection's secret in its path (decision I12).
 *  ✘ no "set status" call for a carrier: JR cannot write picked-up / delivered into Shipox. The full status vocabulary is not published
 *    (examples: unassigned "Order Received", assigned_to_courier, accepted; "cancelled" from the cancel call) — every other key is shown
 *    as-is and can be mapped by the business or a JR admin.
 */
export const DEFAULT_BASE = "https://prodapi.shipox.com";

const base = (c: Ctx) => String(c.config.baseUrl || DEFAULT_BASE).replace(/\/+$/, "");
const tokens = new Map<string, { token: string; exp: number }>();
export const _resetShipoxTokens = () => tokens.clear();
/** Cache key: connection + host + username + a hash of the password — new credentials or a new host never reuse an old JWT. */
const tokenKey = (c: Ctx) => `${c.connectionId}|${base(c)}|${String(c.config.username ?? "")}|${createHash("sha256").update(c.secrets.password ?? "").digest("hex").slice(0, 16)}`;

async function signIn(c: Ctx): Promise<string> {
  if (!c.config.username || !c.secrets.password) throw new PartnerError("config", "Shipox username and password are required");
  const r = await c.http("POST", `${base(c)}/api/v1/customer/authenticate`, { json: { username: String(c.config.username), password: c.secrets.password, remember_me: true } });
  if (!r.ok) failFrom(r, "Shipox sign-in");
  const token = str(obj(obj(r.body)?.data)?.id_token);
  if (!token) throw new PartnerError("auth", "Shipox sign-in: no token in the answer");
  tokens.set(tokenKey(c), { token, exp: Date.now() + 23 * 3600_000 }); // documented lifetime 24 h; renew an hour early
  return token;
}
/** Authenticated call: signs in when needed and once more if Shipox answers 401 (token expired early or revoked). */
async function call(c: Ctx, method: string, path: string, o: HttpOptions = {}) {
  const cached = tokens.get(tokenKey(c));
  let token = cached && cached.exp > Date.now() ? cached.token : await signIn(c);
  let r = await c.http(method, `${base(c)}${path}`, { ...o, headers: { ...(o.headers ?? {}), authorization: `Bearer ${token}` } });
  if (r.status === 401) {
    tokens.delete(tokenKey(c));
    token = await signIn(c);
    r = await c.http(method, `${base(c)}${path}`, { ...o, headers: { ...(o.headers ?? {}), authorization: `Bearer ${token}` } });
  }
  return r;
}

/** COD = the "cod" charge item (documented `charge_items[{charge_type:"cod", charge}]`). */
const codOf = (o: Record<string, unknown>) => { const c = arr(o.charge_items).map(obj).find((x) => x && str(x.charge_type) === "cod"); return c ? num(c.charge) : null; };

/** A list item (`locations[]`, `pickup:false` = drop-off) or a details object (`recipient_data`) → a normalised order. */
export function shipoxOrder(o: Record<string, unknown>): PartnerOrderInput | null {
  const number = str(o.order_number);
  if (!number) return null;
  const rd = obj(o.recipient_data), sd = obj(o.sender_data);
  const locs = arr(o.locations).map(obj).filter((x): x is Record<string, unknown> => !!x);
  const drop = locs.find((l) => l.pickup === false) ?? null, pick = locs.find((l) => l.pickup === true) ?? null;
  const party = (d: Record<string, unknown> | null, l: Record<string, unknown> | null) => d ? {
    name: str(d.name), phone: str(d.phone), email: str(d.email), address: str(d.address) ?? joinParts(d.street, d.building, d.apartment, d.landmark),
    city: str(obj(d.city)?.name) ?? str(d.city), lat: num(d.lat), lng: num(d.lon),
  } : l ? { name: str(l.contact_name), phone: str(l.phone), email: str(l.email), address: str(l.address), city: str(l.address_city) ?? str(l.city), lat: num(l.lat), lng: num(l.lon) } : {};
  return {
    externalId: str(o.id), externalRef: number, invoice: str(o.reference_id), recipient: party(rd, drop), pickup: party(sd, pick),
    codAmount: codOf(o), currency: str(obj(o.currency)?.code), pieces: num(o.piece_count), notes: str(o.note), status: str(o.status), statusAt: date(o.last_status_date),
    extra: { paymentType: str(o.payment_type), parcelValue: num(o.parcel_value) },
  };
}

const toPackage = (o: PartnerOrderInput | null, asked: string): PartnerPackage => o ? {
  found: true, externalId: o.externalId, barcode: o.externalRef, invoice: o.invoice ?? null, status: o.status ?? null,
  recipientName: o.recipient.name ?? null, recipientPhone: o.recipient.phone ?? null, address: o.recipient.address ?? null, city: o.recipient.city ?? null,
  codAmount: o.codAmount ?? null, lat: o.recipient.lat ?? null, lng: o.recipient.lng ?? null, pieces: o.pieces ?? null, notes: o.notes ?? null, extra: o.extra,
} : { found: false, externalId: null, barcode: asked, invoice: null, status: null, recipientName: null, recipientPhone: null, address: null, city: null, codAmount: null };

export const classifyShipox = (s: string): EventKind => (s.trim().toLowerCase() === "cancelled" ? "cancelled" : "status");

async function find(c: Ctx, identifier: string): Promise<Record<string, unknown> | null> {
  const r = await call(c, "GET", `/api/v1/customer/orders?page=0&size=20&search=${encodeURIComponent(identifier)}`);
  if (!r.ok) failFrom(r, "Shipox order search");
  const want = identifier.trim().toLowerCase();
  const list = arr(obj(obj(r.body)?.data)?.list).map(obj).filter((x): x is Record<string, unknown> => !!x);
  return list.find((o) => [o.order_number, o.reference_id, o.id].some((v) => str(v)?.toLowerCase() === want)) ?? null;
}

export const shipox: Adapter = {
  key: "shipox",
  label: "Shipox",
  description: "Pull your Shipox orders into JR, follow their status (webhook or schedule) and cancel them from JR.",
  docsUrl: "https://shipox.docs.apiary.io/#introduction",
  fields: [
    { key: "baseUrl", label: "API host", type: "url", required: true, default: DEFAULT_BASE, placeholder: DEFAULT_BASE, help: "The host_name your Shipox account manager gave you (test and live differ)." },
    { key: "username", label: "API username", type: "text", required: true, placeholder: "customer@company.com", help: "The merchant API account Shipox created for you." },
    { key: "password", label: "API password", type: "password", secret: true, required: true },
    { key: "importStatuses", label: "Statuses to import when polling", type: "text", placeholder: "unassigned", help: "Comma-separated Shipox statuses. Orders in these statuses are added to Incoming orders by the scheduled pull. Empty = any status.", advanced: true },
  ],
  capabilities: { mode: "merchant", lookup: true, webhookIn: true, webhookAuth: "url", registerWebhook: false, importOrders: true, pollOrders: true, track: true, push: ["cancelled"], label: true, carrierApi: false },
  inboundTokenHeaders: ["authorization", "x-jr-token"],
  defaults: { pollMinutes: 0, importNew: false },
  statusIn: [
    { value: "unassigned", label: "Order Received", kind: "status" },
    { value: "assigned_to_courier", label: "Assigned to courier", kind: "status" },
    { value: "accepted", label: "Accepted", kind: "status" },
    { value: "cancelled", label: "Cancelled", kind: "cancelled" },
  ],
  classify: classifyShipox,

  async test(c) {
    tokens.delete(tokenKey(c));
    const r = await call(c, "GET", "/api/v1/customer/account");
    if (!r.ok) failFrom(r, "Shipox");
    const d = obj(obj(r.body)?.data) ?? obj(r.body);
    const who = str(d?.name) ?? str(d?.email) ?? str(d?.company_name);
    return { message: `Connected to Shipox${who ? ` as ${who}` : ""}` };
  },

  async lookup(c, identifier) {
    const hit = await find(c, identifier);
    if (!hit) return toPackage(null, identifier);
    const id = str(hit.id);
    if (id) {
      const d = await call(c, "GET", `/api/v1/customer/order/${encodeURIComponent(id)}/mobile`);
      if (d.ok) { const det = obj(obj(d.body)?.data); if (det) return toPackage(shipoxOrder({ ...hit, ...det }), identifier); }
    }
    return toPackage(shipoxOrder(hit), identifier);
  },

  async pollOrders(c, since) {
    const statuses = String(c.config.importStatuses ?? "").split(",").map((s) => s.trim()).filter(Boolean);
    const out: PartnerOrderInput[] = [];
    const from = (since ?? new Date(Date.now() - 24 * 3600_000)).toISOString();
    const SIZE = 100, MAX_PAGES = 20; // ≤ 2000 orders per run; if more remain, JR keeps the cursor and continues next run
    for (let page = 0; page < MAX_PAGES; page++) {
      const q = new URLSearchParams({ page: String(page), size: String(SIZE), from_date_time: from });
      if (statuses.length) q.set("status", statuses.join(","));
      const r = await call(c, "GET", `/api/v1/customer/orders?${q}`);
      if (!r.ok) failFrom(r, "Shipox order list");
      const data = obj(obj(r.body)?.data);
      if (!data || !Array.isArray(data.list)) throw new PartnerError("unavailable", "Shipox order list: unexpected answer (no data.list)");
      const list = arr(data.list).map(obj).filter((x): x is Record<string, unknown> => !!x);
      for (const o of list) { const n = shipoxOrder(o); if (n) out.push(n); }
      const total = num(data.total);
      if (list.length < SIZE || (total != null && (page + 1) * SIZE >= total)) return { orders: out, complete: true };
    }
    return { orders: out, complete: false };
  },

  async track(c, ref) {
    const r = await call(c, "GET", `/api/v1/customer/order/${encodeURIComponent(ref.externalRef)}/history_items`);
    if (r.status === 404 || r.status === 403 || r.status === 400) return null; // not this account's order (403 = "doesn't have permission")
    if (!r.ok) failFrom(r, "Shipox tracking");
    const list = arr(obj(obj(r.body)?.data)?.list).map(obj).filter((x): x is Record<string, unknown> => !!x);
    if (!list.length) return null;
    const last = list.reduce((a, b) => ((date(b.date)?.getTime() ?? 0) >= (date(a.date)?.getTime() ?? 0) ? b : a));
    const status = str(last.status);
    if (!status) return null;
    return { externalId: ref.externalId, barcode: ref.externalRef, invoice: null, status, kind: classifyShipox(status), at: date(last.date) ?? new Date(), note: str(last.status_desc), summary: { status, description: str(last.status_desc) } };
  },

  parseWebhook(body) {
    const b = obj(body);
    const number = str(b?.order_number), status = str(b?.status);
    if (!b || !number || !status) return null;
    const at = date(b.date) ?? new Date();
    const driver = obj(b.driver);
    const event: PartnerEvent = { externalId: null, barcode: number, invoice: str(b.reference_id), status, kind: classifyShipox(status), at, note: str(b.note), summary: { status, driverName: str(driver?.name), customerId: str(b.customer_id) } };
    return { events: [event], orders: [{ externalId: null, externalRef: number, invoice: str(b.reference_id), recipient: {}, status, statusAt: at }] };
  },

  async push(c, job) {
    if (job.action !== "cancelled") return { ok: true, skipped: `Shipox has no API call for "${job.action}"` };
    const ref = job.order?.externalRef ?? job.shipment?.externalRef;
    if (!ref) return { ok: true, skipped: "parcel has no Shipox order number" };
    const id = job.order?.externalId ?? str((await find(c, ref))?.id);
    if (!id) return { ok: true, skipped: "Shipox: order not found" };
    const r = await call(c, "PUT", `/api/v1/customer/order/${encodeURIComponent(id)}/status?status=cancelled`);
    if (r.status === 404) return { ok: true, skipped: "Shipox: order not found" };
    if (r.status === 400) return { ok: true, skipped: `Shipox refused the cancellation (${str(obj(r.body)?.message) ?? "not cancellable"})` };
    if (!r.ok) failFrom(r, "Shipox cancel");
    return { ok: true };
  },

  async makeLabel(c, refs) {
    // `ids` is the documented required list; order numbers are sent too for orders whose Shipox id JR does not know yet.
    const q = new URLSearchParams();
    for (const r of refs.slice(0, 100)) {
      if (r.externalId) q.append("ids", r.externalId);
      else q.append("order_numbers", r.externalRef);
    }
    const r = await call(c, "GET", `/api/v1/customer/orders/airwaybill_mini?${q}`);
    if (!r.ok) failFrom(r, "Shipox label");
    const b = obj(r.body);
    const url = str(obj(b?.Data)?.Value) ?? str(obj(b?.data)?.value);
    if (!url || !/^https?:\/\//.test(url)) throw new PartnerError("rejected", "Shipox did not return a label link");
    return { url };
  },
};
