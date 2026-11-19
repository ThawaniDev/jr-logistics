/**
 * Warehouse-system adapters. A warehouse that runs its own order system (LogesTech, a WMS, a Shopify bridge …) connects it to JR through
 * ONE adapter that implements this interface. Everything provider-specific (URLs, headers, status names, payload shapes) lives in the
 * adapter; the service layer (service.ts) is generic, so adding a provider never touches the core.
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
}

/** A JR outcome that can be written back to the partner. */
export type PushAction = "delivered" | "failed" | "returned" | "cancelled";
export const PUSH_ACTIONS: PushAction[] = ["delivered", "failed", "returned", "cancelled"];

export interface Capabilities {
  lookup: boolean;                 // can fetch a package by barcode / invoice number
  webhookIn: boolean;              // partner can call our webhook URL
  registerWebhook: boolean;        // we can set our URL on the partner's side through their API
  push: PushAction[];              // JR outcomes we can write back
  label: boolean;                  // can produce the partner's shipping label / AWB
}

export interface PartnerSettings {
  /** Which JR outcomes are written back (only the ones the adapter supports are honoured). */
  sync: Partial<Record<PushAction, boolean>>;
  /** An inbound "cancelled" status withdraws the parcel while it is still at the warehouse (default on). */
  autoCancel: boolean;
}
export const DEFAULT_SETTINGS: PartnerSettings = { sync: {}, autoCancel: true };

/** What the adapter needs to talk to the partner. Secrets are already decrypted; never log this object. */
export interface Ctx {
  config: Record<string, string | boolean>;
  secrets: Record<string, string>;
  /** SSRF-safe HTTP (https only in production, private networks blocked, no redirects, capped response). */
  http: (method: string, url: string, o?: { headers?: Record<string, string>; json?: unknown; timeoutMs?: number }) => Promise<HttpResult>;
}
export interface HttpResult { status: number; ok: boolean; body: unknown; text: string }

/** A package as the partner describes it. Everything but the identifiers is best-effort: partners differ in what they expose. */
export interface PartnerPackage {
  found: boolean;
  externalId: string | null;     // the partner's internal id
  barcode: string | null;
  invoice: string | null;
  status: string | null;         // partner status key
  recipientName: string | null;
  recipientPhone: string | null;
  address: string | null;
  city: string | null;
  codAmount: number | null;      // informational only — JR never collects cash
  raw?: unknown;
}

export type EventKind = "cancelled" | "delivered" | "returned" | "failed" | "status";
/** A status change coming from the partner, normalised. */
export interface PartnerEvent {
  externalId: string | null;
  barcode: string | null;
  invoice: string | null;
  status: string;                // partner status key as sent
  kind: EventKind;               // what JR should understand it as
  at: Date;
  note: string | null;
  summary?: Record<string, unknown>;   // safe-to-store subset of the payload
}

export interface PushJob {
  action: PushAction;
  shipment: { id: string; code: string; externalRef: string | null; failReason: string | null; failNote: string | null; deliveredAt: string | null; proofType: string | null };
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
  /** Cheap authenticated call that proves the credentials work. */
  test(ctx: Ctx): Promise<{ message: string }>;
  lookup?(ctx: Ctx, identifier: string): Promise<PartnerPackage>;
  parseWebhook?(body: unknown): PartnerEvent | PartnerEvent[] | null;
  registerWebhook?(ctx: Ctx, url: string, token: string): Promise<void>;
  push?(ctx: Ctx, job: PushJob): Promise<PushResult>;
  makeLabel?(ctx: Ctx, identifiers: string[]): Promise<{ url: string }>;
}
