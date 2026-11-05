"use client";
import Link from "next/link";
import { AlertTriangle, Banknote, FileCheck2, LifeBuoy, Users, ShieldCheck, Gavel, ListChecks } from "lucide-react";
import { Card, ErrorState, PageHeader, PageLoading, Stat, Badge } from "@/components/ui";
import { useApi } from "@/components/ui/data";
import { fmtMoney } from "@/lib/format";
import { useI18n } from "@/i18n/provider";
import { useUser } from "@/components/layout/auth-context";

export default function AdminDashboard() {
  const { t, locale } = useI18n(); const me = useUser();
  const { data, error, mutate } = useApi("/admin/stats"); const alerts = useApi("/admin/ops/alerts", { shouldRetryOnError: false });
  if (error) return <ErrorState error={error} retry={() => mutate()} />;
  if (!data) return <PageLoading />;
  const r = data.requests as Record<string, number>;
  const live = (r.published ?? 0) + (r.filling ?? 0) + (r.assigned ?? 0) + (r.confirmed ?? 0) + (r.in_progress ?? 0);
  const pv = data.pendingVerification; const critical = alerts.data?.items?.filter((a: any) => a.severity === "critical") ?? [];
  const L = (href: string, el: React.ReactNode) => <Link href={href} className="block transition hover:-translate-y-0.5">{el}</Link>;
  return (
    <>
      <PageHeader title={t("admin.title")} subtitle={t("admin.sub", { name: me.name })} />
      {critical.length > 0 && <Link href="/admin/operations"><Card className="mb-6 flex items-center gap-3 border-danger/50 bg-danger/5"><AlertTriangle className="size-6 text-danger" /><div><p className="font-semibold text-danger">{t("admin.critical_alerts", { n: critical.length })}</p><p className="text-sm text-muted">{t("admin.critical_hint")}</p></div></Card></Link>}
      <div className="mb-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {L("/admin/requests", <Stat label={t("admin.live_requests")} value={live} icon={<ListChecks className="size-5" />} tone="cyan" />)}
        {L("/admin/verification", <Stat label={t("admin.pending_verification")} value={pv.business + pv.office + pv.drivers} icon={<ShieldCheck className="size-5" />} tone={pv.business + pv.office + pv.drivers > 0 ? "gold" : "muted"} hint={t("admin.verif_breakdown", { b: pv.business, o: pv.office, d: pv.drivers })} />)}
        {L("/admin/verification", <Stat label={t("admin.docs_review")} value={data.documentsToReview} icon={<FileCheck2 className="size-5" />} tone="gold" />)}
        {L("/admin/finance", <Stat label={t("admin.pending_settlements")} value={data.pendingSettlements} icon={<Banknote className="size-5" />} tone="gold" hint={fmtMoney(data.pendingPayoutCents, locale)} />)}
        {L("/admin/cases", <Stat label={t("admin.open_tickets")} value={data.openTickets} icon={<LifeBuoy className="size-5" />} tone={data.openTickets ? "gold" : "muted"} />)}
        {L("/admin/complaints", <Stat label={t("admin.open_complaints")} value={data.openComplaints} icon={<Gavel className="size-5" />} tone={data.openComplaints ? "danger" : "muted"} />)}
        {L("/admin/finance", <Stat label={t("admin.pending_withdrawals")} value={data.pendingWithdrawals} icon={<Banknote className="size-5" />} />)}
        <Stat label={t("admin.users")} value={Object.entries(data.users).reduce((a, [, n]) => a + (n as number), 0)} icon={<Users className="size-5" />} tone="muted" />
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card><h3 className="mb-3 font-semibold">{t("admin.gmv")}</h3><div className="grid grid-cols-2 gap-4"><div><p className="text-xs text-muted">{t("admin.gmv_total")}</p><p className="ltr-num text-2xl font-bold text-accent">{fmtMoney(data.gmvCents, locale)}</p></div><div><p className="text-xs text-muted">{t("admin.margin")}</p><p className="ltr-num text-2xl font-bold text-gold">{fmtMoney(data.marginCents, locale)}</p></div></div></Card>
        <Card><h3 className="mb-3 font-semibold">{t("admin.by_status")}</h3><div className="flex flex-wrap gap-2">{Object.entries(r).map(([k, n]) => <Badge key={k} tone="neutral">{t(`status.${k}`)}: <b className="ms-1 tabular-nums">{n}</b></Badge>)}</div></Card>
      </div>
    </>
  );
}
