"use client";
import Link from "next/link";
import { History } from "lucide-react";
import { Badge, EmptyState, Section, StatusBadge } from "@/components/ui";
import { fmtDur, formatValue } from "@/components/reports";
import { fmtDate, fmtDateTime, fmtNum } from "@/lib/format";
import { useI18n } from "@/i18n/provider";
import type { HistoryItem } from "@/server/details-pure";

export interface Milestones { createdAt: string; firstResponseAt: string | null; firstResponseBy: { id: string; name: string | null } | null; resolvedAt: string | null; reopenCount?: number; assignee?: { id: string; name: string | null } | null; handler?: { id: string; name: string | null } | null }
export interface Outcomes { total: number; resolved: number; open: number; avgFirstResponseSec: number | null; avgResolutionSec: number | null; firstResponseLateRate: number | null; holdRate?: number | null }
type Entry = { id: string; at: string; text: string; note?: string | null; actor?: string | null; tone?: "danger" | "accent" };

/**
 * One timeline of how a case was handled: when it was opened, who first answered it, every status / priority / assignment change (from the audit trail, with who did it) and
 * when it was resolved or reopened. Entries come from `GET /admin/{tickets|complaints}/:id/context`; no IP or request detail is shown here.
 */
export function HandlingHistory({ history, ms, kind }: { history: HistoryItem[]; ms: Milestones; kind: "ticket" | "complaint" }) {
  const { t, locale } = useI18n();
  const st = (s: string | null) => (s ? t(`status.${s}`) : "—");
  const pr = (s: string | null) => (s === "urgent" ? t("support.urgent") : s ? t("foa.case_priority_normal") : "—");
  const entries: Entry[] = [{ id: "opened", at: ms.createdAt, text: t("dv3.h_opened") }];
  if (ms.firstResponseAt) entries.push({ id: "first", at: ms.firstResponseAt, text: ms.firstResponseBy?.name ? t("dv3.h_first_by", { name: ms.firstResponseBy.name }) : t("dv3.h_first") });
  for (const h of history) {
    const actor = h.actor.name;
    const text = h.kind === "status" ? (h.from ? t("dv3.h_status", { from: st(h.from), to: st(h.to) }) : t("dv3.h_status_to", { to: st(h.to) }))
      : h.kind === "priority" ? t("dv3.h_priority", { from: pr(h.from), to: pr(h.to) })
      : h.kind === "assign" ? (h.to ? (h.from ? t("dv3.h_assign", { from: h.from, to: h.to }) : t("dv3.h_assign_to", { to: h.to })) : t("dv3.h_unassign"))
      : h.kind === "resolve" ? t("dv3.h_resolved") : h.kind === "reopen" ? t("dv3.h_reopened") : h.kind === "resolution" ? t("dv3.h_resolution") : t(h.to === "on" ? "dv3.h_hold_on" : "dv3.h_hold_off");
    entries.push({ id: h.id, at: h.at, text, note: h.kind === "status" || h.kind === "resolution" ? h.note : null, actor, tone: h.kind === "reopen" ? "danger" : h.kind === "resolve" ? "accent" : undefined });
  }
  if (ms.resolvedAt && !history.some((h) => h.kind === "resolve" || (h.kind === "status" && h.to === "resolved"))) entries.push({ id: "resolved", at: ms.resolvedAt, text: t("dv3.h_resolved"), tone: "accent" });
  entries.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
  return (
    <Section title={<span className="inline-flex items-center gap-2"><History className="size-4 text-muted" aria-hidden />{t("dv3.h_title")}</span>} description={t(kind === "ticket" ? "dv3.h_sub_ticket" : "dv3.h_sub_complaint", { n: ms.reopenCount ?? 0 })}>
      <ol className="relative space-y-3 border-s border-line ps-5" data-testid="dv3-history">
        {entries.map((e) => (
          <li key={e.id} className="relative" data-testid="dv3-history-item">
            <span className={`absolute -start-[1.6rem] top-1.5 size-2.5 rounded-full ring-4 ring-card ${e.tone === "danger" ? "bg-danger" : e.tone === "accent" ? "bg-accent" : "bg-muted/60"}`} aria-hidden />
            <p className="text-sm font-medium">{e.text}</p>
            {e.note && <p dir="auto" className="mt-0.5 whitespace-pre-wrap break-words text-sm text-muted">{e.note}</p>}
            <p className="mt-0.5 text-[11px] text-muted"><span>{fmtDateTime(e.at, locale)}</span>{e.actor ? ` · ${e.actor}` : ""}</p>
          </li>))}
      </ol>
    </Section>
  );
}

/** How cases of the same category ended over the last 90 days: how many, how many resolved, how fast the team answered and resolved them. */
export function OutcomeStats({ o, category }: { o: Outcomes; category: string }) {
  const { t, locale } = useI18n();
  if (o.total === 0) return <Section title={t("dv3.out_title")}><p className="text-sm text-muted" data-testid="dv3-outcomes">{t("dv3.out_none", { category })}</p></Section>;
  const rows: Array<[string, string]> = [
    [t("dv3.out_total"), fmtNum(o.total, locale)], [t("dv3.out_resolved"), `${fmtNum(o.resolved, locale)} (${formatValue(o.total ? o.resolved / o.total : null, "percent", locale, true)})`],
    [t("dv3.out_open"), fmtNum(o.open, locale)], [t("dv3.out_first"), o.avgFirstResponseSec == null ? "—" : fmtDur(o.avgFirstResponseSec, locale)],
    [t("dv3.out_res"), o.avgResolutionSec == null ? "—" : fmtDur(o.avgResolutionSec, locale)], [t("dv3.out_late"), formatValue(o.firstResponseLateRate, "percent", locale, true)],
    ...(o.holdRate != null ? [[t("dv3.out_hold"), formatValue(o.holdRate, "percent", locale, true)] as [string, string]] : []),
  ];
  return (
    <Section title={t("dv3.out_title")} description={t("dv3.out_sub", { category })}>
      <dl className="divide-y divide-line/50" data-testid="dv3-outcomes">{rows.map(([k, v]) => <div key={k} className="flex items-center justify-between gap-3 py-1.5 text-sm"><dt className="text-muted">{k}</dt><dd className="ltr-num font-medium tabular-nums">{v}</dd></div>)}</dl>
    </Section>
  );
}

/** Other cases of the same category (newest first): reference, status, who, when — and for complaints how they were resolved. */
export function SimilarCases({ items, kind }: { items: Array<{ id: string; ref: string; status: string; createdAt: string | null; subject?: string; opener?: string; filer?: string; resolution?: string | null; holdsSettlement?: boolean }>; kind: "ticket" | "complaint" }) {
  const { t, locale } = useI18n();
  return (
    <Section title={t("dv3.sim_title")} description={t(kind === "ticket" ? "dv3.sim_sub_ticket" : "dv3.sim_sub_complaint")}>
      {items.length === 0 ? <EmptyState title={t("dv3.sim_none")} /> : (
        <ul className="space-y-3" data-testid="dv3-similar">
          {items.map((x) => (
            <li key={x.id} className="text-sm">
              <div className="flex items-center justify-between gap-2">
                <Link href={`/admin/${kind === "ticket" ? "cases" : "complaints"}/${x.id}`} className="min-w-0 truncate text-accent hover:underline"><span className="ltr-num font-medium">{x.ref}</span>{x.subject && <span dir="auto" className="ms-1.5 text-muted">{x.subject}</span>}</Link>
                <span className="inline-flex shrink-0 items-center gap-1"><StatusBadge status={x.status} />{x.holdsSettlement && <Badge tone="warn">{t("complaints.holds_settlement")}</Badge>}</span>
              </div>
              <p className="text-[11px] text-muted">{x.opener ?? x.filer}{x.createdAt ? ` · ${fmtDate(x.createdAt, locale)}` : ""}</p>
              {x.resolution && <p dir="auto" className="mt-1 line-clamp-2 break-words rounded-lg bg-bg2 px-2.5 py-1.5 text-xs text-muted">{x.resolution}</p>}
            </li>))}
        </ul>)}
    </Section>
  );
}
