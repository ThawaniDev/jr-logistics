"use client";
import { Suspense, useMemo, useState } from "react";
import { BarChart3, Ban, CheckCircle2, Download, Package, Percent, Repeat2, Truck, UserX } from "lucide-react";
import { Badge, Button, EmptyState, ErrorState, Input, Notice, PageHeader, PageLoading, ProgressBar, Section, Segmented, Stat, StatGrid, StatusBadge, Table, Td, Toolbar } from "@/components/ui";
import { useApi, useUrlState } from "@/components/ui/data";
import { PERIODS, isPeriod, periodInvalid, periodQuery, periodRange, type Period } from "./office-lib";
import { fmtDate, fmtMoney, fmtNum } from "@/lib/format";
import { cn } from "@/lib/cn";
import { useI18n } from "@/i18n/provider";

const csvCell = (v: string | number) => `"${String(v).replace(/"/g, '""')}"`;
interface Report {
  jobs: { total: number; completed: number; inProgress: number; cancelled: number; noShow: number; replaced: number }; shipmentsDelivered: number; completionRate: number | null;
  money: { paidCents: number; approvedCents: number; pendingCents: number; failedCents: number; rejectedCents: number }; byStatus: Array<{ status: string; n: number; units: number }>;
}

function Reports() {
  const { t, locale } = useI18n();
  const [periodRaw, setPeriod] = useUrlState("period", "all");
  const period: Period = isPeriod(periodRaw) ? periodRaw : "all";
  const [from, setFrom] = useState(""); const [to, setTo] = useState("");
  const range = useMemo(() => periodRange(period, new Date(), { from, to }), [period, from, to]);
  const invalid = periodInvalid(range);
  const qs = periodQuery(range);
  const { data, error, mutate, isLoading } = useApi<Report>(invalid ? null : `/office/reports${qs ? `?${qs}` : ""}`, { keepPreviousData: true });
  const rows = data?.byStatus ?? [];

  function exportCsv() {
    const lines = [[t("common.status"), t("office.col_jobs"), t("office.col_units")].map(csvCell).join(",")]
      .concat(rows.map((r) => [t(`jobstatus.${r.status}`), r.n, r.units].map(csvCell).join(",")));
    const url = URL.createObjectURL(new Blob(["﻿" + lines.join("\r\n")], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a"); a.href = url; a.download = `office-report${range.from ? `-${range.from}` : ""}${range.to ? `-${range.to}` : ""}.csv`; a.click();
    URL.revokeObjectURL(url);
  }
  const money = (c: number) => <span className="ltr-num">{fmtMoney(c, locale)}</span>;
  const share = (n: number) => (data && data.jobs.total ? t("rdo.rep_share", { n: Math.round((n / data.jobs.total) * 100) }) : undefined);
  const stale = isLoading && !!data;

  return (
    <>
      <PageHeader title={t("nav.reports")} subtitle={t("office.reports_sub")} actions={<Button variant="secondary" disabled={!rows.length} onClick={exportCsv} data-testid="office-report-export"><Download className="size-4" aria-hidden />{t("reports.export")}</Button>} />
      <Toolbar end={(range.from || range.to) && !invalid ? <span className="text-xs text-muted">{t("rdo.rep_range", { from: range.from ? fmtDate(`${range.from}T12:00:00+03:00`, locale) : "…", to: range.to ? fmtDate(`${range.to}T12:00:00+03:00`, locale) : "…" })}</span> : undefined}>
        <Segmented label={t("rdo.rep_period")} value={period} onChange={setPeriod} options={PERIODS.map((p) => ({ key: p, label: t(`rdo.rep_p_${p}`) }))} />
        {period === "custom" && (
          <div className="flex flex-wrap items-end gap-3">
            <div className="w-40"><Input label={t("reports.from")} type="date" ltr value={from} max={to || undefined} onChange={(e) => setFrom(e.target.value)} /></div>
            <div className="w-40"><Input label={t("reports.to")} type="date" ltr value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} /></div>
            {(from || to) && <Button variant="ghost" onClick={() => { setFrom(""); setTo(""); }}>{t("office.clear_period")}</Button>}
          </div>
        )}
      </Toolbar>
      {invalid ? <Notice tone="warn">{t("office.period_invalid")}</Notice> : error && !data ? <ErrorState error={error} retry={() => mutate()} /> : !data ? <PageLoading /> : (
        <div className={cn("space-y-5 transition-opacity", stale && "opacity-60")} aria-busy={stale} data-testid="office-report">
          <StatGrid cols={4}>
            <Stat label={t("office.kpi_completed")} value={fmtNum(data.jobs.completed, locale)} icon={<CheckCircle2 className="size-5" />} hint={`${t("office.kpi_total")}: ${fmtNum(data.jobs.total, locale)}`} href="/office/jobs?status=completed" />
            <Stat label={t("office.kpi_in_progress")} value={fmtNum(data.jobs.inProgress, locale)} icon={<Truck className="size-5" />} tone="cyan" hint={t("rdo.rep_inprogress_hint")} href="/office/jobs?status=active" />
            <Stat label={t("office.kpi_delivered")} value={fmtNum(data.shipmentsDelivered, locale)} icon={<Package className="size-5" />} hint={t("rdo.rep_delivered_hint")} />
            <Stat label={t("office.kpi_rate")} value={data.completionRate == null ? "—" : <span className="ltr-num">{fmtNum(data.completionRate, locale)}%</span>} icon={<Percent className="size-5" />} tone="gold" hint={t("office.kpi_rate_hint")} />
          </StatGrid>

          <section aria-labelledby="rep-rel">
            <h2 id="rep-rel" className="font-semibold">{t("rdo.rep_reliability")}</h2><p className="mb-3 text-xs text-muted">{t("rdo.rep_reliability_sub")}</p>
            <StatGrid cols={3}>
              <Stat label={t("office.kpi_cancelled")} value={fmtNum(data.jobs.cancelled, locale)} icon={<Ban className="size-5" />} tone={data.jobs.cancelled > 0 ? "danger" : "muted"} hint={share(data.jobs.cancelled)} />
              <Stat label={t("office.kpi_no_show")} value={fmtNum(data.jobs.noShow, locale)} icon={<UserX className="size-5" />} tone={data.jobs.noShow > 0 ? "danger" : "muted"} hint={share(data.jobs.noShow)} />
              <Stat label={t("office.kpi_replaced")} value={fmtNum(data.jobs.replaced, locale)} icon={<Repeat2 className="size-5" />} tone="muted" hint={share(data.jobs.replaced)} />
            </StatGrid>
          </section>

          <section aria-labelledby="rep-money">
            <h2 id="rep-money" className="font-semibold">{t("office.money_title")}</h2><p className="mb-3 text-xs text-muted">{t("rdo.rep_money_sub")}</p>
            <StatGrid cols={5}>
              <Stat label={t("office.money_paid")} value={money(data.money.paidCents)} href="/office/settlements?status=paid" />
              <Stat label={t("office.money_approved")} value={money(data.money.approvedCents)} tone="cyan" href="/office/settlements?status=approved" />
              <Stat label={t("office.money_pending")} value={money(data.money.pendingCents)} tone="gold" href="/office/settlements?status=pending_review" />
              <Stat label={t("office.money_failed")} value={money(data.money.failedCents)} tone={data.money.failedCents > 0 ? "danger" : "muted"} href="/office/settlements?status=failed" />
              <Stat label={t("office.money_rejected")} value={money(data.money.rejectedCents)} tone="muted" href="/office/settlements?status=rejected" />
            </StatGrid>
          </section>

          <Section title={t("office.by_status")} flush>
            {rows.length === 0 ? <div className="p-5"><EmptyState icon={<BarChart3 className="size-9" aria-hidden />} title={t("common.no_results")} hint={t("rdo.rep_empty_hint")} /></div> : (
              <Table bare stack label={t("office.by_status")} head={[t("common.status"), { label: t("office.col_jobs"), align: "end" }, t("rdo.rep_share_col"), { label: t("office.col_units"), align: "end" }]}>
                {rows.map((r) => (
                  <tr key={r.status} data-testid="office-report-row" data-status={r.status}>
                    <Td label={t("common.status")}><StatusBadge status={r.status} ns="jobstatus" /></Td>
                    <Td label={t("office.col_jobs")} num>{fmtNum(r.n, locale)}</Td>
                    <Td label={t("rdo.rep_share_col")}><div className="flex w-40 max-w-full items-center gap-2"><div className="flex-1"><ProgressBar value={r.n} max={data.jobs.total} label={t(`jobstatus.${r.status}`)} tone={["cancelled", "no_show"].includes(r.status) ? "danger" : "accent"} /></div><Badge className="ltr-num">{data.jobs.total ? Math.round((r.n / data.jobs.total) * 100) : 0}%</Badge></div></Td>
                    <Td label={t("office.col_units")} num>{fmtNum(r.units, locale)}</Td>
                  </tr>
                ))}
              </Table>
            )}
          </Section>
        </div>
      )}
    </>
  );
}
export function OfficeReports() { return <Suspense fallback={<PageLoading />}><Reports /></Suspense>; }
