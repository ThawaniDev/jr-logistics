"use client";
import { toast } from "sonner";
import { Badge, type Tone } from "@/components/ui";
import { useApi } from "@/components/ui/data";
import { post } from "@/lib/api";
import { fmtDateTime } from "@/lib/format";
import { useI18n } from "@/i18n/provider";

/** Shared types and small helpers for warehouse-system integrations (business side). Contract: memory/INTEGRATIONS_API.md. */

export type PushAction = "delivered" | "failed" | "returned" | "cancelled";
export interface ProviderField { key: string; label: string; type: "text" | "url" | "password" | "boolean" | "select"; secret?: boolean; required?: boolean; placeholder?: string; help?: string; default?: string | boolean; options?: Array<{ value: string; label: string }> }
export interface Capabilities { lookup: boolean; webhookIn: boolean; registerWebhook: boolean; push: PushAction[]; label: boolean }
export interface Provider { key: string; label: string; description: string; docsUrl: string | null; fields: ProviderField[]; capabilities: Capabilities; inboundTokenHeaders: string[] }
export interface Connection {
  id: string; provider: string; providerLabel: string; name: string; status: "active" | "disabled"; config: Record<string, string | boolean>; hasSecret: Record<string, boolean>;
  settings: { autoCancel: boolean; sync: Partial<Record<PushAction, boolean>> }; capabilities: Capabilities | null; webhookUrl: string | null; tokenPrefix: string | null;
  lastCheckedAt: string | null; lastOkAt: string | null; lastError: string | null; lastEventAt: string | null; createdAt: string;
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
