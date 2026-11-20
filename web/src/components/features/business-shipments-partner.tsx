"use client";
import { toast } from "sonner";
import { Badge, type Tone } from "@/components/ui";
import { useApi } from "@/components/ui/data";
import { post } from "@/lib/api";
import { fmtDateTime } from "@/lib/format";
import { useI18n } from "@/i18n/provider";

/** Shared types and small helpers for warehouse-system integrations (business side). Contract: memory/INTEGRATIONS_API.md. */

/** Every JR parcel event a warehouse system can hear about (server: JR_EVENTS in server/partners/types.ts). */
export const JR_EVENTS = ["accepted", "assigned", "picked_up", "out_for_delivery", "arrived", "delivered", "failed", "postponed", "returned", "missing", "cancelled", "reshipped"] as const;
export type JrEvent = (typeof JR_EVENTS)[number];
/** @deprecated v1 name — every JrEvent can be written back now. */
export type PushAction = JrEvent;
export const EVENT_KINDS = ["status", "cancelled", "delivered", "returned", "failed"] as const;
export type EventKind = (typeof EVENT_KINDS)[number];
export type Mode = "carrier" | "merchant" | "custom";
export interface ProviderField { key: string; label: string; type: "text" | "url" | "password" | "boolean" | "select"; secret?: boolean; required?: boolean; placeholder?: string; help?: string; default?: string | boolean; options?: Array<{ value: string; label: string }>; advanced?: boolean }
export interface Capabilities { mode: Mode; lookup: boolean; webhookIn: boolean; webhookAuth: "header" | "url"; registerWebhook: boolean; importOrders: boolean; pollOrders: boolean; track: boolean; push: JrEvent[]; label: boolean; carrierApi: boolean }
export interface StatusOption { value: string; label: string; hint?: string }
export interface Provider {
  key: string; label: string; description: string; docsUrl: string | null; fields: ProviderField[]; capabilities: Capabilities; inboundTokenHeaders: string[];
  defaults: { sync: Partial<Record<JrEvent, boolean>>; statusOut: Partial<Record<JrEvent, string>>; importNew: boolean; pollMinutes: number };
  statusOut: StatusOption[]; statusIn: Array<StatusOption & { kind: EventKind }>; pollChoices: number[]; events: JrEvent[]; kinds: EventKind[];
}
export interface ConnectionSettings { autoCancel: boolean; importNew: boolean; pollMinutes: number; sync: Partial<Record<JrEvent, boolean>>; statusOut: Partial<Record<JrEvent, string>>; statusIn: Record<string, EventKind> }
export interface Connection {
  id: string; provider: string; providerLabel: string; name: string; status: "active" | "disabled"; mode: Mode | null; config: Record<string, string | boolean>; hasSecret: Record<string, boolean>;
  settings: ConnectionSettings; statusMap: Partial<Record<JrEvent, string | null>>;
  statusInOptions: Array<{ value: string; label: string; labelAr: string | null; kind: EventKind }>; statusOutOptions: StatusOption[];
  capabilities: Capabilities | null; webhookUrl: string | null; webhookAuth: "header" | "url" | null; webhookUrlTemplate: string | null; tokenPrefix: string | null;
  carrier: { baseUrl: string; clientId: string; authModes: string[] } | null;
  runtime: { webhookRegistered: boolean; webhookHost: string | null; webhookRegisteredAt: string | null; lastCarrierCallAt: string | null; authMode: string | null; lastOrderPollAt: string | null; statusCatalogAt: string | null };
  lastCheckedAt: string | null; lastOkAt: string | null; lastError: string | null; lastEventAt: string | null; lastPollAt: string | null; createdAt: string; updatedAt: string;
  orders?: { open: number; inJr: number };
  /** Staff views only. */ business?: string | null; businessId?: string; stuckUpdates?: number;
}
/** Returned once by create / rotate-token: the credentials the partner needs. */
export interface FreshCredentials { inboundToken: string | null; webhookUrl: string | null; carrier: { baseUrl: string; apiKey: string; clientId: string; clientSecret: string } | null }
export type OrderState = "open" | "in_jr" | "delivered" | "undelivered" | "cancelled";
export interface PartnerOrder {
  id: string; connectionId: string; connectionName: string | null; businessId: string; businessName: string | null; provider: string; providerLabel: string; mode: Mode | null;
  externalRef: string; externalId: string | null; invoice: string | null; awb: string | null; displayRef: string; state: OrderState; rawState: string;
  recipientName: string | null; recipientPhone: string | null; phoneValid: boolean; recipientEmail: string | null; address: string | null; city: string | null; cityRaw: string | null;
  lat: number | null; lng: number | null; codCents: number | null; currency: string | null; pieces: number | null; weightGrams: number | null; contents: string | null; notes: string | null;
  pickup: Record<string, unknown> | null; items: Array<{ sku: string | null; name: string | null; qty: number | null }> | null; slot: { from?: string | null; to?: string | null } | null;
  detailsComplete: boolean; partnerStatus: string | null; partnerStatusAt: string | null;
  parcel: { id: string; code: string; status: string; requestId: string; requestRef: string; requestStatus: string; deliveredAt: string | null; failedAt: string | null; failReason: string | null } | null;
  cancelledAt: string | null; cancelReason: string | null; cancelledBy: string | null; labelUrl: string | null; trackingUrl: string | null; createdAt: string; updatedAt: string;
}
export interface PartnerOrderDetail extends PartnerOrder {
  extra: Record<string, unknown> | null;
  events: Array<{ id: string; direction: string; kind: string; outcome: string; summary: string | null; createdAt: string }>;
  updates: Array<{ id: string; action: string; status: string; attempts: number; lastError: string | null; createdAt: string; sentAt: string | null }>;
}

const NONE: Connection[] = [];
/** The business's connections. Shared SWR key, so every screen that needs them costs one request. */
export function usePartnerConnections(enabled = true) {
  const r = useApi<{ items: Connection[] }>(enabled ? "/integrations/connections" : null);
  return { ...r, items: r.data?.items ?? NONE };
}

/** Translation if the key exists, otherwise the fallback (the server's English text for providers added after this UI shipped). */
export const tx = (t: (k: string) => string, key: string, fallback: string) => { const s = t(key); return s === key ? fallback : s; };

/** Localised provider name (falls back to the server's English label for providers added after this UI shipped). */
export const providerName = (t: (k: string) => string, key: string, fallback: string) => tx(t, `intg.provider.${key}.label`, fallback);

/** "READY_FOR_PICKUP" → "Ready for pickup". Partner status keys are shown as the partner sends them, only tidied. */
export const prettyStatus = (s: string) => { const x = s.replace(/[_\-]+/g, " ").trim().toLowerCase(); return x.charAt(0).toUpperCase() + x.slice(1); };

export function statusTone(s: string): Tone {
  const k = s.toUpperCase();
  if (/CANCEL|FAIL|REJECT/.test(k)) return "danger";
  if (/^DELIVERED/.test(k)) return "success";
  if (/RETURN/.test(k)) return "warn";
  return "info";
}

/** What the partner last said about a parcel: "LogesTech · Ready for pickup" with the time underneath. */
export function PartnerStatusBadge({ status, at, provider }: { status?: string | null; at?: string | null; provider?: string | null }) {
  const { t, locale } = useI18n();
  if (!status) return null;
  return (
    <div className="mt-1" data-testid="partner-status">
      <Badge tone={statusTone(status)} className="max-w-full"><span className="shrink-0 font-semibold">{provider || t("intg.partner_generic")}</span><span aria-hidden>·</span><span dir="auto" className="truncate">{prettyStatus(status)}</span></Badge>
      {at && <span className="mt-0.5 block text-[11px] text-muted">{fmtDateTime(at, locale)}</span>}
    </div>
  );
}

/** Small "imported from X" tag on manifest rows. */
export function PartnerOriginBadge({ label }: { label?: string }) {
  const { t } = useI18n();
  return <Badge tone="info" className="max-w-[10rem]"><span className="truncate" data-testid="partner-origin">{t("intg.imported_from", { name: label || t("intg.partner_generic") })}</span></Badge>;
}

export const labelable = (c: Connection | undefined): c is Connection => !!c && c.status === "active" && !!c.capabilities?.label;

const httpUrl = (u: unknown): u is string => typeof u === "string" && /^https?:\/\//i.test(u);

/**
 * Print labels: parcels are grouped by connection, the partner returns a link per group and each opens in a new tab.
 * A blank tab is opened synchronously with the click (popup blockers allow that), then pointed at the first link;
 * any further links are offered as a toast action instead of being silently blocked.
 */
export async function printLabels(groups: Array<{ connectionId: string; identifiers: string[] }>, t: (k: string) => string) {
  const first = typeof window !== "undefined" ? window.open("about:blank", "_blank") : null;
  let used = false; let opened = 0;
  try {
    for (const g of groups) {
      const r = await post<{ url: string }>(`/integrations/connections/${g.connectionId}/label`, { identifiers: g.identifiers.slice(0, 100) });
      if (!httpUrl(r.url)) throw new Error("bad label url");
      if (first && !used) { first.location.href = r.url; used = true; opened++; }
      else { const w = window.open(r.url, "_blank", "noopener"); if (w) opened++; else toast(t("intg.label_ready"), { action: { label: t("intg.open"), onClick: () => window.open(r.url, "_blank", "noopener") } }); }
    }
  } catch (e) {
    if (first && !used) first.close();
    throw e;
  }
  if (first && !used) first.close();
  return opened;
}
