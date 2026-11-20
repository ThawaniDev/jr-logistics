"use client";
import Link from "next/link";
import { AlertTriangle, Clock3, MessageSquare, WalletCards } from "lucide-react";
import { Badge, EmptyState, Notice, Section, StatusBadge } from "@/components/ui";
import { fmtDateTime, fmtMoney, fmtNum } from "@/lib/format";
import { useI18n } from "@/i18n/provider";
import { useUser } from "@/components/layout/auth-context";
import { hasAny, useTx } from "./admin-common";
import { RoleBadge } from "./admin-system-common";
import { usePersonLink } from "./admin-ticket-cards";
import { settlementKind } from "./admin-fieldops-lib";

export interface Respondents { items: Array<{ id: string; name: string; role: string; href: string }>; basis: "offer" | "request" | "none" }
export interface Evidence {
  startsAt: string | null; timeline: Array<{ key: string; at: string }>; offerStatus: string | null; lateMinutes: number | null;
  units: { expected: number; delivered: number | null; final: number | null; loaded: number | null } | null;
  parcels: { byStatus: Record<string, number>; failureReasons: Array<{ key: string; value: number }> };
  chat: Array<{ id: string; at: string; name: string; role: string; body: string | null }>; ratings: Array<{ stars: number; comment: string | null; rater: string; raterId: string }>; custody: Array<{ type: string; status: string; qty: number }>;
}
export interface SettlementInfo {
  holds: boolean; active: boolean; moneyHidden: boolean; otherHolds: Array<{ id: string; ref: string; status: string }>;
  items: Array<{ id: string; status: string; requestId: string; ref: string; finalUnits: number; createdAt: string; paidAt: string | null; customerCents?: number; providerCents?: number; marginCents?: number; vatCents?: number; refundCents?: number; adjustmentCents?: number }>;
}

/** The other side of the complaint, as far as the data says (the job's driver / office for a business, the business for a driver or office). */
export function RespondentsView({ r }: { r: Respondents | null }) {
  const { t } = useI18n(); const open = usePersonLink();
  if (!r) return null;
  return (
    <Section title={t("dv3.cp_respondent")} description={t(r.basis === "none" ? "dv3.cp_resp_none_sub" : r.basis === "offer" ? "dv3.cp_resp_offer" : "dv3.cp_resp_request")}>
      {r.items.length === 0 ? <p className="text-sm text-muted" data-testid="dv3-respondents">{t("dv3.cp_resp_none")}</p> : (
        <ul className="space-y-2" data-testid="dv3-respondents">
          {r.items.map((p) => (
            <li key={p.id} className="flex items-center justify-between gap-2 text-sm">
              {open(p.role) ? <Link href={p.href} className="min-w-0 truncate text-accent hover:underline">{p.name}</Link> : <span className="min-w-0 truncate">{p.name}</span>}
              <RoleBadge role={p.role} />
            </li>))}
        </ul>)}
    </Section>
  );
}

const STEP_ORDER = ["starts", "accepted", "arrived", "attendance", "loaded", "delivered", "final", "cancelled"];
/** What the job's own records say: the timeline against the start time, how late the driver arrived, parcels by outcome, ratings, custody and the last chat messages. */
export function EvidenceView({ e, hidden }: { e: Evidence | null; hidden: boolean }) {
  const { t, locale } = useI18n(); const tx = useTx();
  if (hidden) return <Section title={t("dv3.cp_evidence")}><p className="text-sm text-muted">{t("dv3.cp_evidence_hidden")}</p></Section>;
  if (!e) return <Section title={t("dv3.cp_evidence")} description={t("dv3.cp_evidence_sub")}><EmptyState title={t("dv3.cp_evidence_none")} hint={t("dv3.cp_evidence_none_hint")} /></Section>;
  const steps = [...(e.startsAt ? [{ key: "starts", at: e.startsAt }] : []), ...e.timeline].sort((a, b) => STEP_ORDER.indexOf(a.key) - STEP_ORDER.indexOf(b.key));
  const late = e.lateMinutes;
  return (
    <Section title={t("dv3.cp_evidence")} description={t("dv3.cp_evidence_sub")}>
      <div className="space-y-5" data-testid="dv3-evidence">
        {steps.length > 0 && (
          <div>
            <p className="mb-2 flex flex-wrap items-center gap-2 text-xs font-medium text-muted"><Clock3 className="size-3.5" aria-hidden />{t("dv3.cp_timeline")}
              {e.offerStatus && <StatusBadge status={e.offerStatus} />}
              {late != null && <Badge tone={late > 0 ? "warn" : "success"}><span data-testid="dv3-late">{late > 0 ? t("dv3.cp_late_by", { n: fmtNum(late, locale) }) : t("dv3.cp_on_time")}</span></Badge>}</p>
            <ol className="space-y-1.5 text-sm" data-testid="dv3-evidence-timeline">
              {steps.map((s) => <li key={s.key} className="flex items-center justify-between gap-3"><span className="text-muted">{t(`dv3.cp_step_${s.key}`)}</span><span className="tabular-nums">{fmtDateTime(s.at, locale)}</span></li>)}
            </ol>
          </div>)}
        {e.units && <p className="text-sm"><span className="text-muted">{t("dv3.rel_units")}: </span><span className="ltr-num">{t("dv3.rel_units_v", { expected: e.units.expected, delivered: e.units.delivered ?? "—", final: e.units.final ?? "—" })}</span></p>}
        {Object.keys(e.parcels.byStatus).length > 0 && (
          <div>
            <p className="mb-1.5 text-xs font-medium text-muted">{t("dv3.cp_parcels")}</p>
            <div className="flex flex-wrap gap-1.5">{Object.entries(e.parcels.byStatus).map(([k, n]) => <Badge key={k} tone={k === "delivered" ? "success" : k === "failed" || k === "missing" ? "danger" : "neutral"}>{t(`shipstatus.${k}`)} <span className="ltr-num font-semibold">{n}</span></Badge>)}</div>
            {e.parcels.failureReasons.length > 0 && <p className="mt-1.5 text-xs text-muted">{e.parcels.failureReasons.map((r) => `${tx(`stopfail.${r.key}`, r.key)} ×${r.value}`).join(" · ")}</p>}
          </div>)}
        {e.custody.length > 0 && <p className="text-sm"><span className="text-muted">{t("dv3.cp_custody")}: </span>{e.custody.map((c) => `${tx(`custody.${c.type}`, c.type)} ×${c.qty} (${t(`status.${c.status}`)})`).join(" · ")}</p>}
        {e.ratings.length > 0 && <ul className="space-y-1 text-sm">{e.ratings.map((r, i) => <li key={i}><span className="text-gold">{"★".repeat(r.stars)}</span><span className="text-muted">{"★".repeat(5 - r.stars)}</span> <span className="text-muted">{r.rater}</span>{r.comment && <span dir="auto" className="ms-1">— {r.comment}</span>}</li>)}</ul>}
        {e.chat.length > 0 && (
          <div>
            <p className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-muted"><MessageSquare className="size-3.5" aria-hidden />{t("dv3.cp_chat")}</p>
            <ul className="space-y-2" data-testid="dv3-chat">
              {e.chat.map((m) => <li key={m.id} className="rounded-xl bg-bg2 p-2.5 text-sm"><p className="mb-0.5 flex flex-wrap items-center gap-x-2 text-[11px] text-muted"><span className="font-semibold text-ink">{m.name}</span><RoleBadge role={m.role} /><span>{fmtDateTime(m.at, locale)}</span></p><p dir="auto" className="whitespace-pre-wrap break-words">{m.body}</p></li>)}
            </ul>
          </div>)}
      </div>
    </Section>
  );
}

/** What this complaint does to the job's payment: whether it holds it, how much is held, the settlement, and what resolving or releasing the hold will do. */
export function SettlementPanel({ s, holds }: { s: SettlementInfo | null; holds: boolean }) {
  const { t, locale } = useI18n(); const me = useUser(); const tx = useTx();
  if (!s) return null;
  const m = (n?: number) => fmtMoney(n ?? 0, locale);
  const link = hasAny(me, "finance.view", "settlements.review");
  return (
    <Section title={<span className="inline-flex items-center gap-2"><WalletCards className="size-4 text-muted" aria-hidden />{t("dv3.cp_settlement")}</span>} description={t("dv3.cp_settlement_sub")}
      actions={link ? <Link href="/admin/finance/settlements" className="text-sm text-accent hover:underline" data-testid="dv3-settlement-link">{t("dv3.cp_open_settlements")}</Link> : undefined}>
      <div className="space-y-4" data-testid="dv3-settlement">
        <Notice tone={s.active ? "warn" : "info"}><span data-testid="dv3-hold-state">{s.active ? t("dv3.cp_hold_active") : holds ? t("dv3.cp_hold_ended") : t("dv3.cp_hold_off")}</span></Notice>
        <p className="flex items-start gap-1.5 text-xs text-muted"><AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden />{t("dv3.cp_release_effect")}</p>
        {s.items.length === 0 ? <p className="text-sm text-muted">{t("dv3.cp_no_settlement")}</p> : (
          <ul className="space-y-3" data-testid="dv3-settlement-items">
            {s.items.map((x) => (
              <li key={x.id} data-testid="dv3-settlement-row" className="rounded-xl border border-line p-3 text-sm">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <Link href={`/admin/requests/${x.requestId}`} className="ltr-num font-semibold text-accent hover:underline">{x.ref}</Link>
                  <Badge tone={settlementKind(x) === "paid" ? "success" : settlementKind(x) === "hold" ? "warn" : "neutral"}>{tx(`settle.${x.status}`, x.status)}</Badge>
                </div>
                {!s.moneyHidden && (
                  <dl className="mt-2 divide-y divide-line/50">
                    {([["dv3.cp_s_customer", x.customerCents, ""], ["dv3.cp_s_payout", x.providerCents, s.active ? "font-semibold text-gold" : ""], ["dv3.cp_s_margin", x.marginCents, "text-muted"]] as const).map(([k, v, cls]) => (
                      <div key={k} className="flex items-center justify-between gap-3 py-1"><dt className="text-muted">{t(k)}</dt><dd className={`ltr-num tabular-nums ${cls}`}>{m(v)}</dd></div>))}
                  </dl>)}
              </li>))}
          </ul>)}
        {s.moneyHidden && <p className="text-xs text-muted">{t("dv3.cp_money_hidden")}</p>}
        {s.otherHolds.length > 0 && (
          <div><p className="mb-1 text-xs font-medium text-muted">{t("dv3.cp_other_holds")}</p>
            <ul className="space-y-1 text-sm">{s.otherHolds.map((o) => <li key={o.id}><Link href={`/admin/complaints/${o.id}`} className="ltr-num text-accent hover:underline">{o.ref}</Link></li>)}</ul></div>)}
      </div>
    </Section>
  );
}
