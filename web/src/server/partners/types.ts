/**
 * Warehouse-system adapters. A warehouse that runs its own order / warehouse system (LogesTech, Shipox, Fizzpa, Omniful, Fastcoo, a custom
 * WMS …) connects it to JR through ONE adapter that implements this interface. Everything provider-specific (URLs, headers, status names,
 * payload shapes) lives in the adapter; the service layer is generic, so adding a provider never touches the core.
 *
 * Two shapes of partner exist (decision I7):
 *  - **carrier**  — the partner treats JR as its shipping company: it PUSHES orders to JR (Omniful's Shipping-Partner API, Fastcoo's
 *                   Partner programme) and expects JR to report every status change back.
 *  - **merchant** — JR uses the warehouse's own customer API key to READ its orders and statuses and to cancel / return
 *                   (LogesTech, Shipox, Fizzpa). These APIs have no "set status" call, so JR's progress cannot be written into them.
 *  - **custom**   — any other system, through JR's documented signed webhook contract (both directions).
 */

export type FieldType = "text" | "url" | "password" | "boolean" | "select";
export interface AdapterField {
  key: string;
  label: string;           // English fallback; UI resolves `partners.field.<provider>.<key>` first
  type: FieldType;
  secret?: boolean;        // stored encrypted, never returned to a client
  required?: boolean;
  placeholder?: string;
  help?: string;
  default?: string | boolean;
  options?: Array<{ value: string; label: string }>;
  advanced?: boolean;      // shown under "Advanced" (paths, time zones …)
}

export type Mode = "carrier" | "merchant" | "custom";

/**
 * Everything that can happen to a parcel in JR that a warehouse system may want to hear about (decision I9).
 * Source of each: the parcel journey (`shipment_events`) plus the driver's route approval.
 */
export const JR_EVENTS = [
  "accepted",          // JR received the order (carrier mode: answered the partner with JR's tracking number)
  "assigned",          // a JR driver took the job that carries the parcel
  "picked_up",         // the driver loaded it at the warehouse (hand-over / scan)
  "out_for_delivery",  // the driver approved the route and is delivering
  "arrived",           // the driver is at the recipient
  "delivered",         // delivered with a valid proof
  "failed",            // a delivery attempt failed (reason + note)
  "postponed",         // the driver moved the stop to later in the route
  "returned",          // the undelivered parcel is back at the warehouse
  "missing",           // the parcel was declared missing
  "cancelled",         // the business cancelled this parcel in JR
  "reshipped",         // an undelivered parcel was put on a new JR delivery order
] as const;
export type JrEvent = (typeof JR_EVENTS)[number];
/** @deprecated kept for older imports — every JrEvent can be pushed now. */
export type PushAction = JrEvent;
export const PUSH_ACTIONS: readonly JrEvent[] = JR_EVENTS;

/** What JR understands a partner status as. Only `cancelled` changes anything in JR (decision I4); the rest is shown and logged. */
export const EVENT_KINDS = ["status", "cancelled", "delivered", "returned", "failed"] as const;
export type EventKind = (typeof EVENT_KINDS)[number];

export interface StatusOption { value: string; label: string; hint?: string }
export interface InboundStatusOption extends StatusOption { kind: EventKind }

export interface Capabilities {
  mode: Mode;
  lookup: boolean;                 // can fetch an order by barcode / order number
  webhookIn: boolean;              // the partner can call JR's webhook URL
  webhookAuth: "header" | "url";   // url = the partner cannot send headers, so the token travels in the URL path
  registerWebhook: boolean;        // JR can set its URL on the partner's side through their API
  importOrders: boolean;           // new partner orders can land in JR's Incoming orders
  pollOrders: boolean;             // JR can fetch new orders on a schedule
  track: boolean;                  // JR can fetch an order's current partner status (reconciliation)
  push: JrEvent[];                 // JR events that can be written back
  label: boolean;                  // can produce the partner's own label / AWB
  carrierApi: boolean;             // the partner calls JR's carrier API (JR issues the API key / client credentials)
}

export interface PartnerSettings {
  /** Which JR events are written back (only the ones the adapter supports are honoured). */
  sync: Partial<Record<JrEvent, boolean>>;
  /** Partner status sent for a JR event, when the adapter maps events to statuses. Absent = the adapter's documented default; "" = do not send. */
  statusOut: Partial<Record<JrEvent, string>>;
  /** How a partner status is understood, overriding the adapter's default classification (keys are compared case-insensitively). */
  statusIn: Record<string, EventKind>;
  /** An inbound "cancelled" withdraws the parcel while it is still at the warehouse (default on). */
  autoCancel: boolean;
  /** Orders JR has not seen before are added to Incoming orders (carrier mode: always). */
  importNew: boolean;
  /** Minutes between scheduled pulls (new orders / status reconciliation). 0 = off. */
  pollMinutes: number;
}
export const DEFAULT_SETTINGS: PartnerSettings = { sync: {}, statusOut: {}, statusIn: {}, autoCancel: true, importNew: false, pollMinutes: 0 };
export const POLL_CHOICES = [0, 5, 15, 30, 60, 180] as const;

/** What the adapter needs to talk to the partner. Secrets are already decrypted; never log this object. */
export interface Ctx {
  connectionId: string;
  config: Record<string, string | boolean>;
  secrets: Record<string, string>;
  /** JR-written runtime state (e.g. the webhook URL Omniful registered, a cached token expiry). */
  meta: Record<string, unknown>;
  /** SSRF-safe HTTP (https only in production, private networks blocked, no redirects, capped response). */
  http: (method: string, url: string, o?: HttpOptions) => Promise<HttpResult>;
  /** Persist rotated credentials (OAuth refresh) — merged into the stored encrypted secrets. */
  saveSecrets: (patch: Record<string, string>) => Promise<void>;
  saveMeta: (patch: Record<string, unknown>) => Promise<void>;
  /** Runs `fn` while holding this connection's lock (across instances) — e.g. so only one OAuth refresh spends a refresh token. */
  lock: <T>(fn: () => Promise<T>) => Promise<T>;
  /** The secrets as stored right now (another run may have rotated them). */
  reloadSecrets: () => Promise<Record<string, string>>;
  /** Public base URL of this JR deployment (labels, tracking links). */
  appUrl: string;
}
export interface HttpOptions { headers?: Record<string, string>; json?: unknown; form?: Record<string, string>; timeoutMs?: number }
export interface HttpResult { status: number; ok: boolean; body: unknown; text: string; contentType: string }

/** A delivery address / contact as partners describe it. */
export interface PartnerParty { name?: string | null; phone?: string | null; email?: string | null; address?: string | null; city?: string | null; code?: string | null; lat?: number | null; lng?: number | null }

/** An order as the partner describes it, normalised. Identifiers are reliable; everything else is best-effort (partners differ). */
export interface PartnerOrderInput {
  externalId: string | null;     // the partner's internal id
  externalRef: string;           // the reference the warehouse knows / prints
  invoice?: string | null;
  recipient: PartnerParty;
  pickup?: PartnerParty | null;
  codAmount?: number | null;     // major units (SAR); null = not stated by the partner
  currency?: string | null;
  pieces?: number | null;
  weightKg?: number | null;
  contents?: string | null;
  notes?: string | null;
  items?: Array<{ sku: string | null; name: string | null; qty: number | null }>;
  slot?: { from?: string | null; to?: string | null } | null;
  status?: string | null;
  statusAt?: Date | null;
  extra?: Record<string, unknown>; // provider identifiers needed later (never secrets)
}

/** A package as the partner describes it (lookup result). */
export interface PartnerPackage {
  found: boolean;
  externalId: string | null;
  barcode: string | null;
  invoice: string | null;
  status: string | null;
  recipientName: string | null;
  recipientPhone: string | null;
  address: string | null;
  city: string | null;
  codAmount: number | null;      // informational, the business confirms COD in the manifest
  lat?: number | null;
  lng?: number | null;
  pieces?: number | null;
  notes?: string | null;
  contents?: string | null;
  extra?: Record<string, unknown>;
  raw?: unknown;
}

/** A status change coming from the partner, normalised. */
export interface PartnerEvent {
  externalId: string | null;
  barcode: string | null;        // the order reference (barcode / order number / AWB) the event names
  invoice: string | null;
  status: string;                // partner status key as sent
  kind: EventKind;               // what JR should understand it as (before per-connection overrides)
  at: Date;
  /** false when the partner sent no time (JR used "now"): such an event is de-duplicated by content and never overrides a timed status. */
  timeKnown?: boolean;
  note: string | null;
  summary?: Record<string, unknown>;   // safe-to-store subset of the payload
}

/** What a webhook body meant: status changes and/or new orders. */
export interface WebhookResult { events?: PartnerEvent[]; orders?: PartnerOrderInput[] }

/** One JR event to write back. */
export interface PushJob {
  action: JrEvent;
  /** The partner status to send (resolved from the connection's mapping, then the adapter's default). null = the adapter decides. */
  status: string | null;
  at: string;                    // ISO time of the JR event
  order: { id: string; externalId: string | null; externalRef: string; awb: string | null; invoice: string | null; extra: Record<string, unknown> } | null;
  shipment: {
    id: string; code: string; externalRef: string | null; failReason: string | null; failNote: string | null; deliveredAt: string | null;
    proofType: string | null; attempts: number; codCollectedCents: number | null; receiverName: string | null;
  } | null;
  driver: { name: string } | null;
  links: { label: string | null; tracking: string | null };
  note: string | null;
  /** Delivery attempts over every JR parcel that carried this order (re-shipments included). */
  attempts?: number;
}
export interface PushResult { ok: boolean; skipped?: string; message?: string }

export class PartnerError extends Error {
  constructor(readonly kind: "auth" | "not_found" | "rejected" | "unavailable" | "config", message: string, readonly httpStatus?: number) { super(message); }
}

export interface Adapter {
  key: string;
  label: string;
  description: string;
  docsUrl?: string;
  fields: AdapterField[];
  capabilities: Capabilities;
  /** Headers the partner can carry our inbound token in (any one matching is accepted). */
  inboundTokenHeaders: string[];
  /** Per-provider defaults merged under the connection's own settings. */
  defaults?: Partial<Omit<PartnerSettings, "statusIn">>;
  /** The partner's documented outbound status vocabulary (for the mapping editor). */
  statusOut?: StatusOption[];
  /** The vendor accepts ONLY the documented outbound codes (Omniful: "Allowed values"), so custom codes are refused. */
  statusOutStrict?: boolean;
  /** The partner's documented inbound statuses and what JR understands them as. */
  statusIn?: InboundStatusOption[];
  /** Default understanding of an inbound status key (connection overrides win). */
  classify?(status: string): EventKind;
  /** Cheap authenticated call that proves the credentials work. */
  test(ctx: Ctx): Promise<{ message: string }>;
  lookup?(ctx: Ctx, identifier: string): Promise<PartnerPackage>;
  parseWebhook?(body: unknown, ctx: Ctx, headers: Headers): WebhookResult | PartnerEvent | PartnerEvent[] | null;
  registerWebhook?(ctx: Ctx, url: string, token: string): Promise<void>;
  push?(ctx: Ctx, job: PushJob): Promise<PushResult>;
  /** The partner's own label for these orders (JR passes the partner id when it knows it). */
  makeLabel?(ctx: Ctx, refs: Array<{ externalId: string | null; externalRef: string }>): Promise<{ url: string }>;
  /** New orders since the last successful poll (merchant mode). `complete:false` = more remain: JR keeps its cursor and reads again. */
  pollOrders?(ctx: Ctx, since: Date | null): Promise<{ orders: PartnerOrderInput[]; complete: boolean }>;
  /** Current partner status of one order (reconciliation). null = not found. */
  track?(ctx: Ctx, ref: { externalId: string | null; externalRef: string; invoice: string | null }): Promise<PartnerEvent | null>;
}
