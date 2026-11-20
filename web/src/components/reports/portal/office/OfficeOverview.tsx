"use client";
import { BarChart3, Download, PieChart } from "lucide-react";
import { Badge, Button, EmptyState, ProgressBar, Section, Stat, StatGrid, StatusBadge, Table, Td } from "@/components/ui";
import { useI18n } from "@/i18n/provider";
import { fmtMoney, fmtNum } from "@/lib/format";
import { BreakdownTable, DonutChart, FunnelChart, Heatmap, RankedList, StackedBarChart, TrendChart } from "@/components/reports";
import { seriesColor, STATUS_COLOR } from "../../chartTheme";
import { PARCEL_SERIES, statusSeries } from "../../overview-lib";
import type { Bucket } from "../../types";
import { Guarded } from "../Guarded";
import { KpiSections } from "../KpiSections";
import { PortalDrillTable } from "../PortalDrillTable";
import { PortalInsights } from "../PortalInsights";
import { PortalReport, PortalSuspense, type PortalView } from "../PortalReport";
import type { OfficeOverviewData } from "../types";
import { funnelOf, groupRows, groupSlices, topRows } from "../lib";

/** Reports › Overview of the courier-office portal: fleet, jobs, parcels and earnings of the signed-in office, offers handled, the period's jobs by status and the all-time totals. */
export function OfficeOverview() {
  const { t } = useI18n();
  return (
    <PortalSuspense>
      <PortalReport<OfficeOverviewData> role="office" report="overview" title={t("nav.reports")} subtitle={t("rpr.off_overview_sub")} icon={<PieChart className="size-5" />} crumb="nav.rep_overview" csvTable="jobs" legendKey="rpr.legend_office">
        {(data, view) => <OfficeOverviewBody data={data} view={view} />}
      </PortalReport>
    </PortalSuspense>
  );
}

const csvCell = (v: string | number) => `"${String(v).replace(/"/g, '""')}"`;
const JOB_COLORS = { completed: STATUS_COLOR.completed, active: STATUS_COLOR.active, cancelled: STATUS_COLOR.cancelled, no_show: seriesColor(1), replaced: seriesColor(7) } as const;
const JOB_FIELDS = ["completed", "active", "cancelled", "no_show", "replaced"] as const;

export function OfficeOverviewBody({ data, view }: { data: OfficeOverviewData; view: PortalView }) {
  const { t, locale } = useI18n();
  const bucket = data.meta.bucket as Bucket;
  const cityName = view.cityName;
  const money = (c: number) => <span className="ltr-num">{fmtMoney(c, locale)}</span>;
  const earnedSub = (r: { earned?: number }) => (r.earned ? t("rpr.earned_sub", { value: fmtMoney(r.earned, locale) }) : undefined);
  const byStatus = data.byStatus ?? [];
  const total = byStatus.reduce((s, r) => s + r.n, 0);

  function exportCsv() {
    const lines = [[t("common.status"), t("office.col_jobs"), t("office.col_units")].map(csvCell).join(",")].concat(byStatus.map((r) => [t(`jobstatus.${r.key}`), r.n, r.units].map(csvCell).join(",")));
    const url = URL.createObjectURL(new Blob(["﻿" + lines.join("\r\n")], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a"); a.href = url; a.download = `office-report-${data.meta.period.from}-${data.meta.period.to}.csv`; a.click();
    URL.revokeObjectURL(url);
  }
  return (
    <div className="space-y-5" data-testid="office-report">
      <KpiSections kpis={data.kpis} comparing={view.comparing} groups={[
        { id: "fleet", title: t("rpr.grp_fleet"), keys: ["off_drivers", "active_drivers", "off_utilisation", "off_rating"] },
        { id: "work", title: t("rpr.grp_work"), keys: ["off_jobs", "off_completion_rate", "parcels_delivered", "delivery_success", "on_time_start"] },
        { id: "money", title: t("rpr.grp_earnings"), keys: ["off_earnings", "off_paid", "off_pending"] },
      ]} />
      <div className="grid gap-5 lg:grid-cols-2">
        <Guarded data={data.series.jobs} title={t("rpr.sec_jobs")} testId="chart-jobs">
          {(s) => <StackedBarChart testId="chart-jobs" title={t("rpr.sec_jobs")} description={t("rpr.sec_jobs_hint")} data={s.points} prev={s.prev} bucket={bucket}
            series={JOB_FIELDS.map((k) => ({ key: k, label: k === "active" ? t("rpf.s_active") : t(`jobstatus.${k}`), color: JOB_COLORS[k] }))} />}
        </Guarded>
        <Guarded data={data.series.parcels} title={t("rpf.sec_parcels")} testId="chart-parcels">
          {(s) => <StackedBarChart testId="chart-parcels" title={t("rpf.sec_parcels")} description={t("rpf.sec_parcels_hint")} data={s.points} prev={s.prev} bucket={bucket} series={statusSeries(PARCEL_SERIES, t)} />}
        </Guarded>
      </div>
      <div className="grid gap-5 lg:grid-cols-2">
        <Guarded data={data.series.earnings} title={t("rpr.sec_earnings")} testId="chart-earnings">
          {(s) => <TrendChart testId="chart-earnings" title={t("rpr.sec_earnings")} description={t("rpr.sec_earnings_hint")} data={s.points} prev={s.prev} bucket={bucket} format="money"
            series={[{ key: "earned", label: t("rpr.s_earned"), kind: "area", color: STATUS_COLOR.gmv }, { key: "paid", label: t("rpr.s_paid"), kind: "line", color: seriesColor(1) }]} />}
        </Guarded>
        <Guarded data={data.funnel} title={t("rpr.sec_offers")} testId="chart-funnel">
          {(f) => <FunnelChart testId="chart-funnel" title={t("rpr.sec_offers")} description={t("rpr.sec_offers_hint")} steps={funnelOf(f, "rpr.of_", t)} />}
        </Guarded>
      </div>
      <Guarded data={data.breakdowns} title={t("rpf.sec_city")} testId="bd-city">
        {(b) => (
          <>
            <div className="grid gap-5 lg:grid-cols-2">
              <BreakdownTable testId="bd-city" title={t("rpf.sec_city")} description={t("rpr.sec_city_jobs_hint")} rows={groupRows(b.city, "city", "jobs", t, cityName, earnedSub)} />
              <DonutChart testId="bd-service" title={t("rpf.sec_service")} slices={groupSlices(b.service, "service", "jobs", t)} centerLabel={t("rpr.s_jobs")} />
            </div>
            <div className="grid gap-5 lg:grid-cols-2">
              <BreakdownTable testId="bd-vehicle" title={t("rpf.sec_vehicle")} rows={groupRows(b.vehicle, "vehicle", "jobs", t, cityName)} />
              <RankedList testId="rk-companies" title={t("rpr.sec_companies")} description={t("rpr.sec_companies_hint")} rows={topRows(groupRows(b.company, "company", "jobs", t, cityName, earnedSub))} />
            </div>
          </>
        )}
      </Guarded>
      <div className="grid gap-5 lg:grid-cols-2">
        <Guarded data={data.heatmap} title={t("rpf.sec_heat")} testId="chart-heatmap">
          {(h) => <Heatmap testId="chart-heatmap" title={t("rpf.sec_heat")} description={t("rpf.sec_heat_hint")} cells={h.cells} unit={t("rpf.unit_parcels")} />}
        </Guarded>
        <PortalInsights title={t("rpf.sec_insights")} description={t("rpf.sec_insights_hint")} items={data.insights} cityName={cityName} />
      </div>

      <section aria-labelledby="rep-rel" data-testid="money-status"><h2 id="rep-rel" className="font-semibold">{t("office.money_title")}</h2><p className="mb-3 text-xs text-muted">{t("rpr.money_period_hint")}</p>
        <Guarded data={data.money} title={t("office.money_title")} testId="money-status">
          {(m) => (
            <StatGrid cols={5}>
              {(["paid", "approved", "pending_review", "failed", "rejected"] as const).map((k) => {
                const cents = m.filter((x) => (k === "pending_review" ? ["pending_review", "reviewed"] : k === "approved" ? ["approved", "batch_ready"] : [k]).includes(x.key)).reduce((s, x) => s + x.cents, 0);
                return <Stat key={k} label={t(`office.money_${k === "pending_review" ? "pending" : k}`)} value={money(cents)} tone={k === "failed" ? (cents > 0 ? "danger" : "muted") : k === "rejected" ? "muted" : k === "approved" ? "cyan" : k === "pending_review" ? "gold" : "accent"} href={`/office/settlements?status=${k}`} />;
              })}
            </StatGrid>
          )}
        </Guarded>
      </section>

      <Section title={t("office.by_status")} description={t("rpr.by_status_hint")} flush actions={<Button variant="secondary" size="sm" disabled={!byStatus.length} onClick={exportCsv} data-testid="office-report-export"><Download className="size-4" aria-hidden />{t("reports.export")}</Button>}>
        {data.byStatus == null ? <div className="p-5 text-sm text-muted">{t("rpr.section_failed")}</div> : byStatus.length === 0 ? <div className="p-5"><EmptyState icon={<BarChart3 className="size-9" aria-hidden />} title={t("common.no_results")} hint={t("rdo.rep_empty_hint")} /></div> : (
          <Table bare stack label={t("office.by_status")} head={[t("common.status"), { label: t("office.col_jobs"), align: "end" }, t("rdo.rep_share_col"), { label: t("office.col_units"), align: "end" }]}>
            {byStatus.map((r) => (
              <tr key={r.key} data-testid="office-report-row" data-status={r.key}>
                <Td label={t("common.status")}><StatusBadge status={r.key} ns="jobstatus" /></Td>
                <Td label={t("office.col_jobs")} num>{fmtNum(r.n, locale)}</Td>
                <Td label={t("rdo.rep_share_col")}><div className="flex w-40 max-w-full items-center gap-2"><div className="flex-1"><ProgressBar value={r.n} max={total} label={t(`jobstatus.${r.key}`)} tone={["cancelled", "no_show"].includes(r.key) ? "danger" : "accent"} /></div><Badge className="ltr-num">{total ? Math.round((r.n / total) * 100) : 0}%</Badge></div></Td>
                <Td label={t("office.col_units")} num>{fmtNum(r.units, locale)}</Td>
              </tr>
            ))}
          </Table>
        )}
      </Section>

      <Guarded data={data.lifetime} title={t("rpr.sec_lifetime")} testId="lifetime">
        {(l) => (
          <section aria-labelledby="rep-life" data-testid="lifetime"><h2 id="rep-life" className="font-semibold">{t("rpr.sec_lifetime")}</h2><p className="mb-3 text-xs text-muted">{t("rpr.sec_lifetime_hint")}</p>
            <StatGrid cols={4}>
              <Stat label={t("office.kpi_total")} value={fmtNum(l.jobs.total, locale)} href="/office/jobs?status=all" />
              <Stat label={t("office.kpi_completed")} value={fmtNum(l.jobs.completed, locale)} href="/office/jobs?status=completed" />
              <Stat label={t("office.kpi_in_progress")} value={fmtNum(l.jobs.inProgress, locale)} tone="cyan" hint={t("rdo.rep_inprogress_hint")} href="/office/jobs?status=active" />
              <Stat label={t("office.kpi_delivered")} value={fmtNum(l.shipmentsDelivered, locale)} hint={t("rdo.rep_delivered_hint")} />
            </StatGrid>
            <div className="mt-3"><StatGrid cols={4}>
              <Stat label={t("office.kpi_rate")} value={l.completionRate == null ? "—" : <span className="ltr-num">{fmtNum(l.completionRate, locale)}%</span>} tone="gold" hint={t("office.kpi_rate_hint")} />
              <Stat label={t("office.kpi_cancelled")} value={fmtNum(l.jobs.cancelled, locale)} tone={l.jobs.cancelled > 0 ? "danger" : "muted"} />
              <Stat label={t("office.kpi_no_show")} value={fmtNum(l.jobs.noShow, locale)} tone={l.jobs.noShow > 0 ? "danger" : "muted"} />
              <Stat label={t("office.kpi_replaced")} value={fmtNum(l.jobs.replaced, locale)} tone="muted" />
            </StatGrid></div>
          </section>
        )}
      </Guarded>
      <PortalDrillTable testId="drill-jobs" role="office" name="jobs" qs={view.filters.qs} />
    </div>
  );
}
