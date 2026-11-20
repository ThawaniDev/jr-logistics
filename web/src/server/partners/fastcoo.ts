import { errorDetail, failFrom, num, obj, str } from "./http";
import { PartnerError, type Adapter, type Ctx, type HttpResult, type JrEvent, type PartnerEvent, type PartnerOrderInput, type StatusOption } from "./types";

/**
 * Fastcoo Partner programme (https://doc.fastcoo-tech.com/fastcooPartner) — JR acts as the 3PL / courier partner of Fastcoo merchants.
 * Mode: carrier. Verified against the published page (v .0.055, 10 July 2024) on 2026-11-19:
 *  Fastcoo → JR  "Order Receive Webhook": {app_id, merchent_id, reference_id, BookingMode (COD|CC), codValue, awb_no, sender_*, receiver_*,
 *                country_dial_code, description, pieces, weight, sku_details, national_address_id …}. Sent to JR's webhook URL
 *                (`…/integrations/hooks/<id>/<token>`; the page names the path `{base_url}/webhook/API/OrderRecieveLM`, which JR also
 *                accepts under the same prefix). Fastcoo documents no authentication for it, so the token rides in the URL and JR
 *                additionally checks `app_id` against the configured App ID (decision I12).
 *  JR → Fastcoo  POST {baseUrl}/Update3plDetails   {App_ID, ref_no, client_awb, label, tracking_url, order_type}     (after JR accepts)
 *                POST {baseUrl}/webhook/API/StatusUpdate  {reference_number, UniqueReference, FailDeliveryReason, StatusCode,
 *                     StatusDescription, UpdateDate "YYYY-MM-DD HH:MM:SS", App_ID, order_type}                       (every mapped event)
 *                Both: `Authorization: Bearer <access_token>`, answer {status:200, message}.
 *                POST {baseUrl}/oauth/token  (x-www-form-urlencoded grant_type=refresh_token, refresh_token, client_id, client_secret)
 *                → {access_token, expires_in, token_type, refresh_token} — JR stores the rotated tokens encrypted.
 *  Not documented (so not built): the "Order Get" URL, a cancel notification to the partner, and the time zone of UpdateDate (JR uses the
 *  configurable time zone, default Asia/Riyadh). The paths are configurable in case Fastcoo gives the partner different ones.
 */
export const DEFAULT_BASE = "https://api.fastcoo-tech.com";

/** The status codes listed on the Partner page (+ RTC / RTR from Fastcoo's merchant status list, for "returned to the merchant"). */
export const FASTCOO_STATUSES: StatusOption[] = [
  { value: "OP", label: "On Process" }, { value: "B", label: "Booked - Pickup Scheduled" }, { value: "PUC", label: "Pick Up Collected" },
  { value: "RI", label: "Received Inbound" }, { value: "SH", label: "Shelve" }, { value: "IT", label: "In Transit" },
  { value: "DSA", label: "Damage Shipment Arrival" }, { value: "RFDE", label: "Ready For Delivery" }, { value: "FDD", label: "Forward to Delivery Station" },
  { value: "OD", label: "Out for delivery" }, { value: "DOP", label: "Delivery On Process" }, { value: "FD", label: "Failed Delivery" },
  { value: "POD", label: "Delivered" }, { value: "ROP", label: "Return On Process" }, { value: "RTR", label: "Ready to return to Client", hint: "merchant status list" },
  { value: "RTC", label: "Return to Client", hint: "merchant status list" }, { value: "RP", label: "Booked - reverse pick" }, { value: "GU", label: "General Update" },
  { value: "CCR", label: "Cancelled as per Client request" }, { value: "MS", label: "Missing Shipments" }, { value: "DS", label: "Damage Shipments" },
];
const LABEL = Object.fromEntries(FASTCOO_STATUSES.map((s) => [s.value, s.label]));

/** JR event → Fastcoo code (decision I10). Editable per connection; "" = do not send. */
export const FASTCOO_DEFAULT_MAP: Partial<Record<JrEvent, string>> = {
  assigned: "B", picked_up: "PUC", out_for_delivery: "OD", arrived: "DOP", delivered: "POD", failed: "FD", returned: "ROP", missing: "MS",
  cancelled: "CCR", // the company cancelled it in JR / set the order aside ("Cancelled as per Client request"); Fastcoo's own cancels are never echoed
};

const base = (c: Ctx) => String(c.config.baseUrl || DEFAULT_BASE).replace(/\/+$/, "");
const path = (c: Ctx, key: string, dflt: string) => { const p = String(c.config[key] || dflt).trim(); return p.startsWith("/") ? p : `/${p}`; };
const orderType = (c: Ctx) => String(c.config.orderType || "LM");

/** "YYYY-MM-DD HH:MM:SS" in the configured time zone (the documented UpdateDate format). */
export function fastcooDate(iso: string, tz = "Asia/Riyadh"): string {
  const d = new Date(iso);
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" }).formatToParts(d).map((p) => [p.type, p.value]));
  return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}:${parts.second}`;
}

/** Fastcoo's documented `updated_date` ("2021-11-16 11:34:21" or a date) + `updated_time` ("11:34:21"), local to `tz` → an instant. */
export function fastcooTime(d: string | null, t: string | null, tz: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?/.exec(d ?? "");
  if (!m) return null;
  const tm = /^(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(t ?? "");
  const [hh, mi, ss] = m[4] ? [m[4], m[5], m[6] ?? "00"] : tm ? [tm[1], tm[2], tm[3] ?? "00"] : ["00", "00", "00"];
  const asUtc = Date.UTC(+m[1], +m[2] - 1, +m[3], +hh, +mi, +ss);
  // The zone's offset at that moment (no external library): format the UTC instant in the zone and compare.
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" }).formatToParts(new Date(asUtc)).map((x) => [x.type, x.value]));
  const shown = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
  return new Date(asUtc - (shown - asUtc));
}

/**
 * One refresh at a time per connection (the debounced sender, the scheduler tick and "Test" can overlap): under the connection's lock,
 * re-read the stored tokens — if someone else already replaced the one that failed, use theirs instead of spending the refresh token
 * a second time (a rotated refresh token is single-use).
 */
async function refresh(c: Ctx, failed: string | null): Promise<string> {
  return c.lock(async () => {
    const stored = await c.reloadSecrets();
    if (stored.accessToken && stored.accessToken !== failed) { c.secrets.accessToken = stored.accessToken; if (stored.refreshToken) c.secrets.refreshToken = stored.refreshToken; return stored.accessToken; }
    if (stored.refreshToken) c.secrets.refreshToken = stored.refreshToken;
    return doRefresh(c);
  });
}
async function doRefresh(c: Ctx): Promise<string> {
  const { refreshToken, clientSecret } = c.secrets;
  if (!refreshToken || !clientSecret || !c.config.clientId) throw new PartnerError("config", "Fastcoo client ID, client secret and refresh token are required");
  const r = await c.http("POST", `${base(c)}${path(c, "tokenPath", "/oauth/token")}`, { form: { grant_type: "refresh_token", refresh_token: refreshToken, client_id: String(c.config.clientId), client_secret: clientSecret } });
  if (!r.ok) failFrom(r, "Fastcoo token refresh");
  const b = obj(r.body);
  const access = str(b?.access_token);
  if (!access) throw new PartnerError("auth", "Fastcoo token refresh: no access token in the answer");
  const next: Record<string, string> = { accessToken: access };
  const rt = str(b?.refresh_token);
  if (rt) next.refreshToken = rt;
  await c.saveSecrets(next);
  c.secrets.accessToken = access; if (rt) c.secrets.refreshToken = rt;
  return access;
}

/** The body's own status: Fastcoo answers `{status:200, message}` (and documents 0 = authentication error, `false` on some errors). */
const bodyStatus = (r: HttpResult): number | boolean | null => { const v = obj(r.body)?.status; return typeof v === "boolean" ? v : num(v); };
const unauthorised = (r: HttpResult) => r.status === 401 || bodyStatus(r) === 401 || bodyStatus(r) === 0;
/** A non-success status inside an HTTP 200 is a failure too. */
function check(r: HttpResult, what: string, o: { alreadyIsOk?: boolean } = {}) {
  // The page's response codes: "400 Already Exist" — for a repeated 3PL-details call that means the earlier one arrived.
  const already = /already\s*exist/i.test(errorDetail(r));
  if (o.alreadyIsOk && already && (r.status === 400 || bodyStatus(r) === 400)) return;
  if (!r.ok) failFrom(r, what);
  const s = bodyStatus(r);
  if (s === false || (typeof s === "number" && s !== 200 && s !== 1)) {
    if (s === 401 || s === 0) throw new PartnerError("auth", `${what}: ${errorDetail(r) || "authentication error"}`, 401);
    throw new PartnerError("rejected", `${what}: ${errorDetail(r) || `status ${String(s)}`}`);
  }
}
async function call(c: Ctx, url: string, json: unknown, what: string, o: { alreadyIsOk?: boolean } = {}) {
  let token = c.secrets.accessToken || (await refresh(c, null));
  let r = await c.http("POST", url, { headers: { authorization: `Bearer ${token}` }, json });
  if (unauthorised(r)) { token = await refresh(c, token); r = await c.http("POST", url, { headers: { authorization: `Bearer ${token}` }, json }); }
  check(r, what, o);
}

/** The documented Order Receive payload → a normalised order (BookingMode "COD" = cash collect, "CC" = prepaid). */
export function fastcooOrder(b: Record<string, unknown>): PartnerOrderInput | null {
  const awb = str(b.awb_no);
  if (!awb) return null;
  const mode = (str(b.BookingMode) ?? "").toUpperCase();
  const dial = str(b.country_dial_code), phone = str(b.receiver_phone);
  return {
    externalId: awb, externalRef: awb, invoice: str(b.reference_id),
    recipient: { name: str(b.receiver_name), phone: phone && dial && !phone.startsWith("0") && !phone.startsWith("+") && !phone.startsWith(dial.replace("+", "")) ? `${dial}${phone}` : phone, email: str(b.receiver_email), address: str(b.receiver_address), city: str(b.receiver_city) },
    pickup: { name: str(b.sender_name), phone: str(b.sender_phone), email: str(b.sender_email), address: str(b.sender_address), city: str(b.sender_city), code: str(b.sender_zip) },
    codAmount: mode === "COD" ? num(b.codValue) ?? 0 : mode === "CC" ? 0 : null, currency: "SAR",
    pieces: num(b.pieces), weightKg: num(b.weight), contents: str(b.description), items: str(b.sku_details) ? [{ sku: str(b.sku_details), name: null, qty: null }] : [],
    extra: { merchantId: str(b.merchent_id), bookingMode: mode || null, nationalAddressId: str(b.national_address_id), senderNationalId: str(b.sender_national_id), orderType: str(b.order_type) },
  };
}

export const fastcoo: Adapter = {
  key: "fastcoo",
  label: "Fastcoo",
  description: "JR works as a Fastcoo partner courier: Fastcoo sends last-mile orders to JR, and JR reports its tracking number, label and every status back.",
  docsUrl: "https://doc.fastcoo-tech.com/fastcooPartner",
  fields: [
    { key: "appId", label: "App ID", type: "text", required: true, help: "The App_ID Fastcoo issued for your partner account. JR also uses it to verify incoming orders." },
    { key: "clientId", label: "Client ID", type: "text", required: true },
    { key: "clientSecret", label: "Client secret", type: "password", secret: true, required: true },
    { key: "refreshToken", label: "Refresh token", type: "password", secret: true, required: true, help: "From Fastcoo's auth details. JR keeps the rotated token automatically." },
    { key: "accessToken", label: "Access token (optional)", type: "password", secret: true, help: "Leave empty to let JR get one with the refresh token." },
    { key: "orderType", label: "Order type", type: "select", default: "LM", options: [{ value: "LM", label: "LM — last mile" }, { value: "FM", label: "FM — first mile" }] },
    { key: "baseUrl", label: "API address", type: "url", default: DEFAULT_BASE, placeholder: DEFAULT_BASE, advanced: true },
    { key: "statusPath", label: "Status update path", type: "text", default: "/webhook/API/StatusUpdate", advanced: true },
    { key: "detailsPath", label: "3PL details path", type: "text", default: "/Update3plDetails", advanced: true },
    { key: "tokenPath", label: "Token path", type: "text", default: "/oauth/token", advanced: true },
    { key: "timezone", label: "Time zone of UpdateDate", type: "text", default: "Asia/Riyadh", advanced: true },
  ],
  capabilities: {
    mode: "carrier", lookup: false, webhookIn: true, webhookAuth: "url", registerWebhook: false, importOrders: true, pollOrders: false, track: false,
    push: ["accepted", "assigned", "picked_up", "out_for_delivery", "arrived", "delivered", "failed", "postponed", "returned", "missing", "cancelled", "reshipped"], label: false, carrierApi: false,
  },
  inboundTokenHeaders: ["authorization", "x-jr-token"],
  defaults: { importNew: true, statusOut: FASTCOO_DEFAULT_MAP, sync: { accepted: true, picked_up: true, out_for_delivery: true, delivered: true, failed: true, returned: true, missing: true, cancelled: true } },
  statusOut: FASTCOO_STATUSES,
  statusIn: [
    { value: "CCR", label: "Cancelled as per Client request", kind: "cancelled" }, { value: "C", label: "Cancel", kind: "cancelled" },
    { value: "POD", label: "Delivered", kind: "delivered" }, { value: "RTC", label: "Return to Client", kind: "returned" },
  ],
  classify: (s) => (["CCR", "C"].includes(s.toUpperCase()) ? "cancelled" : s.toUpperCase() === "POD" ? "delivered" : s.toUpperCase() === "RTC" ? "returned" : "status"),

  async test(c) {
    if (!c.config.appId) throw new PartnerError("config", "Fastcoo App ID is missing");
    await c.lock(() => doRefresh(c)); // proves client id / secret / refresh token; the new tokens are stored
    return { message: "Connected to Fastcoo (a fresh access token was issued)" };
  },

  parseWebhook(body, c) {
    const b = obj(body);
    if (!b) return null;
    const appId = str(b.app_id) ?? str(b.App_ID);
    if (appId && c.config.appId && appId !== String(c.config.appId)) return null; // not for this partner account
    // Order Receive (has receiver data) → a new order. A status payload (awb_no + code, Fastcoo's webhook format) → an event.
    if (str(b.awb_no) && (str(b.receiver_name) || str(b.receiver_phone) || str(b.receiver_address))) {
      const o = fastcooOrder(b);
      return o ? { orders: [o] } : null;
    }
    const awb = str(b.awb_no) ?? str(b.UniqueReference), code = str(b.code) ?? str(b.StatusCode);
    if (!awb || !code) return null;
    const at = fastcooTime(str(b.updated_date), str(b.updated_time), String(c.config.timezone || "Asia/Riyadh"));
    const ev: PartnerEvent = {
      externalId: awb, barcode: awb, invoice: str(b.reference_id), status: code, kind: fastcoo.classify!(code),
      at: at ?? new Date(), timeKnown: !!at, note: str(b.comment) ?? str(b.status) ?? str(b.StatusDescription), summary: { code, status: str(b.status) ?? str(b.StatusDescription), deliveryAttempts: num(b.delivery_attempts) },
    };
    return { events: [ev] };
  },

  async push(c, job) {
    if (!c.config.appId) throw new PartnerError("config", "Fastcoo App ID is missing");
    const o = job.order;
    if (!o?.awb) return { ok: true, skipped: "order has no JR tracking number yet" };
    if (job.action === "accepted") {
      await call(c, `${base(c)}${path(c, "detailsPath", "/Update3plDetails")}`, {
        App_ID: String(c.config.appId), ref_no: o.externalRef, client_awb: o.awb, label: job.links.label ?? "", tracking_url: job.links.tracking ?? "", order_type: orderType(c),
      }, "Fastcoo 3PL details", { alreadyIsOk: true });
      return { ok: true };
    }
    if (!job.status) return { ok: true, skipped: `no Fastcoo status is mapped to "${job.action}"` };
    const s = job.shipment;
    await call(c, `${base(c)}${path(c, "statusPath", "/webhook/API/StatusUpdate")}`, {
      reference_number: o.awb, UniqueReference: o.externalRef,
      FailDeliveryReason: (job.action === "failed" ? [s?.failReason, s?.failNote].filter(Boolean).join(" — ") : job.action === "cancelled" ? job.note ?? "Cancelled by the warehouse in JR" : "").slice(0, 200),
      StatusCode: job.status, StatusDescription: LABEL[job.status] ?? job.status,
      UpdateDate: fastcooDate(job.at, String(c.config.timezone || "Asia/Riyadh")), App_ID: String(c.config.appId), order_type: orderType(c),
    }, "Fastcoo status update");
    return { ok: true };
  },
};
