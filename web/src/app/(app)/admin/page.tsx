"use client";
import { AlertTriangle, Banknote, Building2, Coins, Factory, FileCheck2, Gavel, LifeBuoy, ListChecks, Plug, ShieldCheck, Truck, TrendingUp, Wallet } from "lucide-react";
import { ErrorState, PageHeader, Stat } from "@/components/ui";
import { useApi } from "@/components/ui/data";
import { fmtMoney } from "@/lib/format";
import { useI18n } from "@/i18n/provider";
import { useUser, hasPerm } from "@/components/layout/auth-context";
import { BroadcastCard } from "@/components/features/admin-broadcast";
import { hasAny } from "@/components/features/admin-common";
import { CriticalBanner, DashGroup, GroupLink, QuickActions, StatusBreakdown } from "@/components/features/admin-ops-dashboard";
import { alertCounts, sumCounts, LIVE_REQUEST_STATUSES, driverStats, type OpsAlert } from "@/components/features/admin-ops-lib";

/** The control center: what needs attention now, grouped by theme. Every tile opens the page that handles it, and only when the viewer may open that page. */
export default function AdminDashboard() {
  const { t, locale } = useI18n(); const me = useUser();
  const can = (...perms: string[]) => hasAny(me, ...perms);
  const canOps = hasPerm(me, "requests.view"); const canLive = hasPerm(me, "live_location.view");
  const stats = useApi("/admin/stats", { refreshInterval: 60000 });
  // The panels below are optional: a failure leaves their tiles at "—" and never blocks the page.
  const quiet = { shouldRetryOnError: false } as const;
  const alerts = useApi(canOps ? "/admin/ops/alerts" : null, { ...quiet, refreshInterval: 60000 });
  const partners = useApi(canOps ? "/admin/partners?problemsOnly=1&status=active&pageSize=1" : null, quiet);
  const live = useApi(canLive ? "/admin/ops/map" : null, quiet);
  const cod = useApi(can("cod.manage", "finance.view") ? "/admin/cod?pageSize=1" : null, quiet);
  if (stats.error) return <><PageHeader title={t("admin.title")} subtitle={t("admin.sub", { name: me.name })} /><ErrorState error={stats.error} retry={() => stats.mutate()} /></>;

  const d = stats.data; const loading = !d;
  const r = (d?.requests ?? {}) as Record<string, number>;
  const users = (d?.users ?? {}) as Record<string, number>;
  const pv = d?.pendingVerification ?? { business: 0, office: 0, drivers: 0 };
  const pvTotal = pv.business + pv.office + pv.drivers;
  const items: OpsAlert[] = alerts.data?.items ?? [];
  const ac = alertCounts(items); const critical = items.filter((a) => a.severity === "critical");
  const drivers = driverStats(live.data?.items);
  const money = (c: number | undefined) => (c === undefined ? undefined : <span className="ltr-num">{fmtMoney(c, locale)}</span>); // finance figures exist only for viewers with finance.view
  const link = (ok: boolean, href: string) => (ok ? href : undefined); // a tile links only where the viewer can open the destination
  const dash = "—";
  const verif = can("verification.manage", "documents.review", "offices.view");

  return (
    <>
      <PageHeader title={t("admin.title")} subtitle={t("admin.sub", { name: me.name })} />
      {canOps && <CriticalBanner items={critical} canQueue />}

      <DashGroup id="ops" title={t("nav.operations")} link={<GroupLink href="/admin/operations" allowed={canOps}>{t("rda.open_ops")}</GroupLink>}>
        <Stat loading={loading} label={t("admin.live_requests")} value={sumCounts(r, LIVE_REQUEST_STATUSES)} icon={<ListChecks className="size-5" />} tone="cyan" href={link(canOps, "/admin/requests")} hint={t("rda.live_hint", { n: (r.published ?? 0) + (r.filling ?? 0) })} />
        {canLive
          ? <Stat loading={!live.data && !live.error} label={t("rda.drivers_online")} value={live.error ? dash : drivers.total} icon={<Truck className="size-5" />} tone="accent" href="/admin/map" hint={live.data ? t("rda.drivers_online_hint", { a: drivers.available, j: drivers.onJob }) : undefined} />
          : <Stat loading={loading} label={t("nav.drivers")} value={users.driver ?? 0} icon={<Truck className="size-5" />} tone="accent" href={link(can("drivers.view"), "/admin/drivers")} hint={t("rda.drivers_registered")} />}
        {canOps && <Stat loading={!alerts.data && !alerts.error} label={t("rda.alerts_critical")} value={alerts.error ? dash : ac.critical} icon={<AlertTriangle className="size-5" />} tone={ac.critical ? "danger" : "muted"} href="/admin/operations" hint={alerts.data ? t("rda.alerts_hint", { w: ac.warning, i: ac.info }) : undefined} />}
        {canOps && <Stat loading={!partners.data && !partners.error} label={t("uxa.sync_problems")} value={partners.error ? dash : (partners.data?.total ?? 0)} icon={<Plug className="size-5" />} tone={partners.data?.total ? "danger" : "muted"} href="/admin/integrations?problems=1" hint={t("uxa.sync_problems_hint")} />}
      </DashGroup>

      <DashGroup id="partners" title={t("nav.group_partners")} link={<>
        <GroupLink href="/admin/drivers" allowed={can("drivers.view")}>{t("nav.drivers")} · {users.driver ?? dash}</GroupLink>
        <GroupLink href="/admin/users" allowed={can("users.view")}>{t("rda.all_accounts")} · {d ? Object.values(users).reduce((a, n) => a + n, 0) : dash}</GroupLink>
      </>}>
        <Stat loading={loading} label={t("admin.pending_verification")} value={pvTotal} icon={<ShieldCheck className="size-5" />} tone={pvTotal > 0 ? "gold" : "muted"} href={link(verif, "/admin/verification")} hint={t("admin.verif_breakdown", { b: pv.business, o: pv.office, d: pv.drivers })} />
        <Stat loading={loading} label={t("admin.docs_review")} value={d?.documentsToReview ?? 0} icon={<FileCheck2 className="size-5" />} tone={d?.documentsToReview ? "gold" : "muted"} href={link(verif, "/admin/verification")} />
        <Stat loading={loading} label={t("nav.companies")} value={users.business ?? 0} icon={<Factory className="size-5" />} tone="muted" href={link(can("users.view", "verification.manage", "offices.view"), "/admin/companies")} hint={pv.business > 0 ? t("rda.awaiting_verification", { n: pv.business }) : undefined} />
        <Stat loading={loading} label={t("nav.offices")} value={users.office ?? 0} icon={<Building2 className="size-5" />} tone="muted" href={link(can("offices.view", "offices.manage"), "/admin/offices")} hint={pv.office > 0 ? t("rda.awaiting_verification", { n: pv.office }) : undefined} />
      </DashGroup>

      <DashGroup id="money" title={t("nav.finance")} cols={cod.data && d?.gmvCents !== undefined ? 5 : 4}>
        <Stat loading={loading} label={t("rda.settlements_hold")} value={d?.pendingSettlements ?? 0} icon={<Banknote className="size-5" />} tone={d?.pendingSettlements ? "gold" : "muted"} href={link(can("finance.view", "settlements.review"), "/admin/finance/settlements")} hint={money(d?.pendingPayoutCents)} />
        <Stat loading={loading} label={t("admin.pending_withdrawals")} value={d?.pendingWithdrawals ?? 0} icon={<Wallet className="size-5" />} tone={d?.pendingWithdrawals ? "gold" : "muted"} href={link(can("finance.view", "withdrawals.manage"), "/admin/finance/withdrawals")} />
        {(loading || d.gmvCents !== undefined) && <>
          <Stat loading={loading} label={t("admin.gmv_total")} value={money(d?.gmvCents)} icon={<TrendingUp className="size-5" />} tone="accent" href={link(can("finance.view"), "/admin/finance")} hint={t("rda.paid_hint")} />
          <Stat loading={loading} label={t("admin.margin")} value={money(d?.marginCents)} icon={<Banknote className="size-5" />} tone="gold" href={link(can("finance.view"), "/admin/finance")} hint={t("rda.paid_hint")} />
        </>}
        {cod.data && <Stat label={t("rda.cod_outstanding")} value={money(cod.data.totals?.outstandingCents ?? 0)} icon={<Coins className="size-5" />} tone={cod.data.totals?.outstandingCents ? "gold" : "muted"} href="/admin/finance/cod" hint={t("rda.cod_outstanding_hint")} />}
      </DashGroup>

      <DashGroup id="support" title={t("nav.group_support")} cols={2}>
        <Stat loading={loading} label={t("admin.open_tickets")} value={d?.openTickets ?? 0} icon={<LifeBuoy className="size-5" />} tone={d?.openTickets ? "gold" : "muted"} href={link(can("tickets.view"), "/admin/cases")} />
        <Stat loading={loading} label={t("admin.open_complaints")} value={d?.openComplaints ?? 0} icon={<Gavel className="size-5" />} tone={d?.openComplaints ? "danger" : "muted"} href={link(can("complaints.manage"), "/admin/complaints")} />
      </DashGroup>

      <div className="mb-6 grid items-start gap-4 lg:grid-cols-5">
        <div className="lg:col-span-3"><StatusBreakdown counts={d?.requests} canOpen={canOps} /></div>
        <div className="lg:col-span-2"><QuickActions stats={d && { pendingVerification: pvTotal, pendingWithdrawals: d.pendingWithdrawals, pendingSettlements: d.pendingSettlements, openTickets: d.openTickets, openComplaints: d.openComplaints }} /></div>
      </div>
      {hasPerm(me, "broadcast.send") && <BroadcastCard />}
    </>
  );
}
