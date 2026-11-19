"use client";
import { EmptyState, Section } from "@/components/ui";
import { cn } from "@/lib/cn";
import { fmtDateTime } from "@/lib/format";
import { useI18n } from "@/i18n/provider";
import { prettyStatus } from "./business-shipments-partner";
import { eventTone } from "./admin-ops-lib";

type TFn = (k: string, v?: Record<string, string | number>) => string;
export type TimelineEvent = { id?: string; type: string; actorName?: string | null; actorRole?: string | null; createdAt: string; payload?: any };

/** Translation when the key exists, otherwise the raw text (free-text reasons from the server stay readable). */
const tr = (t: TFn, key: string, raw: string) => { const s = t(key); return s === key ? raw : s; };
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);

/** `partner_status` events (payload: providerLabel, status, kind, note, code): "LogesTech: Ready for pickup", what JR understood from it, and the partner's note. */
export function partnerStatusText(payload: any, t: TFn): string[] {
  const p = payload ?? {};
  const out: string[] = [];
  const provider = typeof p.providerLabel === "string" && p.providerLabel ? p.providerLabel : t("intg.partner_generic");
  const status = typeof p.status === "string" && p.status ? prettyStatus(p.status) : null;
  out.push(status ? t("intg.ev_status", { provider, status }) : provider);
  if (typeof p.kind === "string" && ["cancelled", "delivered", "returned", "failed"].includes(p.kind)) out.push(t(`intg.ev_kind_${p.kind}`));
  if (typeof p.note === "string" && p.note) out.push(`“${p.note}”`);
  return out;
}

/**
 * The most useful bits of an event's payload as short lines: parcel code, reason, proof type, pin distance and parcel counts.
 * Delivery codes are never part of any payload, so nothing sensitive can surface here.
 */
export function eventDetails(e: TimelineEvent, t: TFn): string[] {
  const p = e.payload ?? {};
  const out: string[] = [];
  if (e.type === "partner_status") {
    if (typeof p.code === "string" && p.code) out.push(t("shipadm.ev_parcel", { code: p.code }));
    return [...out, ...partnerStatusText(p, t)];
  }
  if (typeof p.code === "string" && p.code) out.push(t("shipadm.ev_parcel", { code: p.code }));
  const reason = typeof p.reason === "string" && p.reason ? p.reason : null;
  if (reason) out.push(`“${tr(t, `stopfail.${reason}`, reason)}”`);
  if (typeof p.note === "string" && p.note) out.push(`“${p.note}”`);
  if (typeof p.why === "string" && p.why) out.push(t("shipadm.ev_why", { why: tr(t, `stopfail.${p.why}`, p.why.replace(/_/g, " ")) }));
  if (p.proofType === "otp" || p.proofType === "receipt") out.push(t(p.proofType === "otp" ? "shipadm.ev_proof_otp" : "shipadm.ev_proof_receipt"));
  if (p.proofType === "scan") out.push(t("fob.proof_scan"));
  const cod = num(p.codCents) ?? (e.type === "cod_received" ? num(p.amountCents) : null);
  if (cod != null && cod > 0) out.push(t(e.type === "cod_received" ? "fo.ev_cod_received" : "fo.ev_cod_collected", { amount: (cod / 100).toFixed(2) }));
  if (typeof p.mediaId === "string" && p.mediaId) out.push(t("fo.ev_photo"));
  if (typeof p.signatureMediaId === "string" && p.signatureMediaId) out.push(t("fo.ev_signature"));
  if (p.auto === true) out.push(t("fo.ev_auto"));
  const units = num(p.units);
  if (units != null && (e.type === "loading_finished" || e.type === "delivery_confirmed")) out.push(t("shipadm.ev_count", { n: units }));
  const d = num(p.distanceM);
  if (d != null) out.push(t("shipadm.ev_distance", { n: Math.round(d) }));
  const toPool = num(p.toPool), toReturn = num(p.toReturn);
  if (toPool != null || toReturn != null) out.push(t("shipadm.ev_released", { pool: toPool ?? 0, ret: toReturn ?? 0 }));
  const c = num(p.count);
  if (c != null) out.push(t("shipadm.ev_count", { n: c }));
  return out;
}

const DOT = { danger: "bg-danger", accent: "bg-accent", cyan: "bg-cyan", muted: "bg-muted" } as const;

export function Timeline({ events, bare }: { events: TimelineEvent[]; bare?: boolean }) {
  const { t, locale } = useI18n();
  const body = events.length === 0 ? <EmptyState title={t("timeline.empty")} /> : (
    <ol className="relative space-y-4 border-s border-line ps-5">
      {events.map((e, i) => {
        const details = eventDetails(e, t);
        return (
          <li key={e.id ?? `${e.type}-${i}`} className="relative">
            <span className={cn("absolute -start-[25px] top-1.5 size-2.5 rounded-full ring-4 ring-card", DOT[eventTone(e.type)])} aria-hidden />
            <p className="text-sm font-medium">{tr(t, `event.${e.type}`, e.type.replace(/_/g, " "))}</p>
            <p className="text-xs text-muted">{e.actorName ? `${e.actorName} · ` : ""}{e.actorRole ? `${tr(t, `role.${e.actorRole}`, e.actorRole)} · ` : ""}{fmtDateTime(e.createdAt, locale)}</p>
            {details.length > 0 && <p className="mt-1 text-xs text-muted">{details.join(" · ")}</p>}
          </li>
        );
      })}
    </ol>
  );
  if (bare) return body;
  return <Section title={t("timeline.title")} description={events.length > 0 ? t("rda.timeline_count", { n: events.length }) : undefined} id="timeline">{body}</Section>;
}
