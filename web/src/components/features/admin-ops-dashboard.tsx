"use client";
import type { ReactNode } from "react";
import Link from "next/link";
import { AlertTriangle, ChevronRight, ListChecks, Map as MapIcon, Radar, ShieldCheck, Receipt, ArrowDownToLine, Coins, PieChart, ClipboardList, Megaphone } from "lucide-react";
import { EmptyState, Section, StatGrid } from "@/components/ui";
import { cn } from "@/lib/cn";
import { useI18n } from "@/i18n/provider";
import { useUser } from "@/components/layout/auth-context";
import { hasAny, LinkButton } from "./admin-common";
import { statusSegments, type OpsAlert } from "./admin-ops-lib";

/** A themed block of the dashboard: a small heading with an optional "see all" link, then its KPI row. */
export function DashGroup({ id, title, link, cols = 4, children }: { id: string; title: string; link?: ReactNode; cols?: 2 | 3 | 4 | 5; children: ReactNode }) {
  return (
    <section aria-labelledby={`dash-${id}`} data-testid={`admin-dash-${id}`} className="mb-6">
      <div className="mb-2.5 flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
        <h2 id={`dash-${id}`} className="text-xs font-semibold uppercase tracking-wider text-muted">{title}</h2>
        {link && <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">{link}</div>}
      </div>
      <StatGrid cols={cols}>{children}</StatGrid>
    </section>
  );
}
/** A small text link for a group heading ("All accounts · 15"). Rendered as plain text when the viewer cannot open the page. */
export function GroupLink({ href, children, allowed = true }: { href: string; children: ReactNode; allowed?: boolean }) {
  return allowed ? <Link href={href} className="inline-flex items-center gap-0.5 text-accent hover:underline">{children}<ChevronRight className="size-3.5 rtl:rotate-180" aria-hidden /></Link> : <span className="text-muted">{children}</span>;
}

/** Critical alerts: what they are (top three, each opening its request) and one button into the queue. */
export function CriticalBanner({ items, canQueue }: { items: OpsAlert[]; canQueue: boolean }) {
  const { t } = useI18n();
  if (items.length === 0) return null;
  const top = items.slice(0, 3);
  return (
    <section data-testid="admin-critical-banner" aria-label={t("admin.critical_alerts", { n: items.length })} className="mb-6 rounded-card border border-danger/50 bg-danger/5 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <span className="mt-0.5 flex size-10 shrink-0 items-center justify-center rounded-xl bg-danger/10 text-danger" aria-hidden><AlertTriangle className="size-5" /></span>
          <div className="min-w-0"><p className="font-semibold text-danger">{t("admin.critical_alerts", { n: items.length })}</p><p className="text-sm text-muted">{t("admin.critical_hint")}</p></div>
        </div>
        {canQueue && <LinkButton href="/admin/operations" variant="secondary" data-testid="admin-critical-open">{t("rda.open_queue")}<ChevronRight className="size-4 rtl:rotate-180" aria-hidden /></LinkButton>}
      </div>
      <ul className="mt-3 flex flex-wrap gap-2">
        {top.map((a, i) => {
          const body = <><span className="font-medium">{t(`alert.${a.type}`)}</span>{a.ref && <span className="ltr-num text-muted"> · {a.ref}</span>}</>;
          const cls = "inline-flex max-w-full items-center rounded-full border border-danger/30 bg-bg2 px-3 py-1 text-xs";
          return <li key={`${a.type}-${a.requestId ?? i}-${i}`} className="min-w-0">{a.requestId && canQueue ? <Link href={`/admin/requests/${a.requestId}`} className={cn(cls, "transition hover:border-danger/60")}>{body}</Link> : <span className={cls}>{body}</span>}</li>;
        })}
        {items.length > top.length && <li className="inline-flex items-center px-1 text-xs text-muted">{t("rda.alert_more", { n: items.length - top.length })}</li>}
      </ul>
    </section>
  );
}

const BAR: Record<string, string> = { published: "bg-cyan", filling: "bg-cyan/55", assigned: "bg-accent/50", confirmed: "bg-accent/75", in_progress: "bg-gold", completed: "bg-accent", cancelled: "bg-danger", expired: "bg-muted/60", draft: "bg-line" };
/** Requests by status as one proportional bar plus a legend; each status opens the request list filtered to it (drafts are private to the business, so they are not linked). */
export function StatusBreakdown({ counts, canOpen }: { counts: Record<string, number> | undefined; canOpen: boolean }) {
  const { t } = useI18n();
  const seg = statusSegments(counts);
  const total = seg.reduce((a, s) => a + s.n, 0);
  return (
    <Section title={t("admin.by_status")} description={total > 0 ? t("rda.requests_total", { n: total }) : undefined} id="requests-by-status">
      {total === 0 ? <EmptyState title={t("rda.breakdown_empty")} /> : (
        <div data-testid="admin-status-breakdown">
          <div className="flex h-3 w-full gap-0.5 overflow-hidden rounded-full" aria-hidden>
            {seg.map((s) => <div key={s.status} className={cn("h-full min-w-1 first:rounded-s-full last:rounded-e-full", BAR[s.status] ?? "bg-line")} style={{ width: `${s.pct}%` }} />)}
          </div>
          <ul className="mt-4 grid gap-x-6 gap-y-1 sm:grid-cols-2">
            {seg.map((s) => {
              const row = (
                <>
                  <span className="flex min-w-0 items-center gap-2"><span className={cn("size-2.5 shrink-0 rounded-full", BAR[s.status] ?? "bg-line")} aria-hidden /><span className="truncate">{t(`status.${s.status}`)}</span></span>
                  <span className="flex shrink-0 items-baseline gap-2"><b className="tabular-nums">{s.n}</b><span className="ltr-num w-12 text-end text-xs tabular-nums text-muted">{s.pct}%</span></span>
                </>
              );
              const cls = "flex items-center justify-between gap-3 rounded-lg px-2 py-1.5 text-sm";
              return <li key={s.status}>{canOpen && s.status !== "draft" ? <Link href={`/admin/requests?status=${s.status}`} data-testid={`admin-status-${s.status}`} className={cn(cls, "transition hover:bg-bg2")}>{row}</Link> : <div className={cls}>{row}</div>}</li>;
            })}
          </ul>
        </div>
      )}
    </Section>
  );
}

interface QuickStats { pendingVerification: number; pendingWithdrawals: number; pendingSettlements: number; openTickets: number; openComplaints: number }
/** Permission-gated shortcuts to the places work gets done; a count badge shows how much is waiting. */
export function QuickActions({ stats }: { stats: QuickStats | undefined }) {
  const { t } = useI18n(); const me = useUser();
  const items: Array<{ id: string; href: string; label: string; icon: ReactNode; ok: boolean; n?: number }> = [
    { id: "ops", href: "/admin/operations", label: t("nav.operations"), icon: <Radar className="size-4" />, ok: hasAny(me, "requests.view") },
    { id: "requests", href: "/admin/requests", label: t("nav.requests"), icon: <ListChecks className="size-4" />, ok: hasAny(me, "requests.view") },
    { id: "map", href: "/admin/map", label: t("nav.live_map"), icon: <MapIcon className="size-4" />, ok: hasAny(me, "live_location.view") },
    { id: "verification", href: "/admin/verification", label: t("nav.verification"), icon: <ShieldCheck className="size-4" />, ok: hasAny(me, "verification.manage", "documents.review", "offices.view"), n: stats?.pendingVerification },
    { id: "settlements", href: "/admin/finance/settlements", label: t("nav.settlements"), icon: <Receipt className="size-4" />, ok: hasAny(me, "finance.view", "settlements.review"), n: stats?.pendingSettlements },
    { id: "withdrawals", href: "/admin/finance/withdrawals", label: t("nav.fin_withdrawals"), icon: <ArrowDownToLine className="size-4" />, ok: hasAny(me, "finance.view", "withdrawals.manage"), n: stats?.pendingWithdrawals },
    { id: "cod", href: "/admin/finance/cod", label: t("nav.cod"), icon: <Coins className="size-4" />, ok: hasAny(me, "cod.manage", "finance.view") },
    { id: "cases", href: "/admin/cases", label: t("nav.cases"), icon: <ClipboardList className="size-4" />, ok: hasAny(me, "tickets.view"), n: stats?.openTickets },
    { id: "reports", href: "/admin/reports", label: t("nav.reports"), icon: <PieChart className="size-4" />, ok: hasAny(me, "reports.view") },
    { id: "broadcast", href: "#broadcast", label: t("adm.broadcast"), icon: <Megaphone className="size-4" />, ok: hasAny(me, "broadcast.send") },
  ].filter((x) => x.ok);
  if (items.length === 0) return null;
  return (
    <Section title={t("rda.quick_actions")} id="quick-actions">
      <ul className="grid gap-2 sm:grid-cols-2" data-testid="admin-quick-actions">
        {items.map((x) => (
          <li key={x.id} className="min-w-0">
            <Link href={x.href} data-testid={`admin-qa-${x.id}`} className="flex items-center gap-2.5 rounded-xl border border-line px-3 py-2.5 text-sm transition hover:border-accent/50 hover:bg-bg2/60">
              <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-bg2 text-muted" aria-hidden>{x.icon}</span>
              <span className="min-w-0 flex-1 truncate">{x.label}</span>
              {!!x.n && <span className="rounded-full bg-gold/15 px-2 py-0.5 text-xs font-semibold tabular-nums text-gold">{x.n}</span>}
            </Link>
          </li>
        ))}
      </ul>
    </Section>
  );
}
