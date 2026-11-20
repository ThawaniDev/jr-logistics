"use client";
import { useI18n } from "@/i18n/provider";
import type { OperationsData } from "@/server/analytics/ops-report";
import { fmtDur, seriesColor } from "../chartTheme";
import { DonutChart } from "../DonutChart";
import { DrillTable } from "../DrillTable";
import { Heatmap } from "../Heatmap";
import { HistogramChart } from "../HistogramChart";
import { KpiGrid } from "../KpiGrid";
import { StackedBarChart, TrendChart } from "../TrendChart";
import type { Bucket } from "../types";
import type { OpsSectionProps } from "./OpsDemand";
import { CardFailed, SectionHead, StatTable, type StatLine } from "./OpsParts";
import { durationBuckets, execPoints, kpisOf, lateBuckets } from "./ops-lib";

const stat = (label: string, cur: number | null, prev: number | null | undefined, format: StatLine["format"], sub?: string): StatLine => ({ key: `${label}${sub ?? ""}`, label, sub, cur, prev, format, good: "lower" });

/** Execution: start punctuality, lateness, no-shows, check-in distance, loading, route approval, job duration, parcels per job, stops per hour, completion and when pressure peaks. */
export function OpsExecution({ data, retry, qs }: OpsSectionProps) {
  const { t, locale } = useI18n();
  const bucket = data.meta.bucket as Bucket, comparing = data.meta.compare !== "none";
  const ex: OperationsData["execution"] = data.execution;
  const pts = data.series.execution ? execPoints(data.series.execution) : null;
  const pv = (p: { prev: number | null }) => (comparing ? p.prev : undefined);
  const range = (h: { p50: { cur: number | null }; p90: { cur: number | null } }) => <p className="text-xs text-muted">{t("rpf.fill_median")}: <b className="ltr-num text-ink">{h.p50.cur != null ? fmtDur(h.p50.cur, locale) : "—"}</b> · {t("rpo.p90")}: <b className="ltr-num text-ink">{h.p90.cur != null ? fmtDur(h.p90.cur, locale) : "—"}</b></p>;
  const scan = ex?.scan ? ex.scan.scan.cur ?? 0 : 0, wh = ex?.scan ? ex.scan.warehouse.cur ?? 0 : 0;
  const lines: StatLine[] = ex ? [
    stat(t("rpo.m_loading"), ex.loading.p50.cur, pv(ex.loading.p50), "duration", t("rpo.median")), stat(t("rpo.m_loading"), ex.loading.p90.cur, pv(ex.loading.p90), "duration", t("rpo.p90")),
    stat(t("rpo.m_approval"), ex.approval.p50.cur, pv(ex.approval.p50), "duration", t("rpo.median")), stat(t("rpo.m_approval"), ex.approval.p90.cur, pv(ex.approval.p90), "duration", t("rpo.p90")),
    stat(t("rpo.m_distance"), ex.distance.p50.cur, pv(ex.distance.p50), "number", t("rpo.median")), stat(t("rpo.m_distance"), ex.distance.p90.cur, pv(ex.distance.p90), "number", t("rpo.p90")),
    { key: "stops", label: t("rpo.m_stops_n"), cur: ex.stops ? (ex.stops.stops.cur ?? 0) : null, prev: ex.stops && comparing ? ex.stops.stops.prev : undefined, format: "number", good: "higher" },
  ] : [];
  return (
    <>
      <SectionHead id="ops-execution" title={t("rpo.s_execution")} hint={t("rpo.s_execution_hint", { n: data.meta.grace })} />
      <KpiGrid kpis={kpisOf(data.kpis, "execution")} comparing={comparing} cols={4} />
      <div className="grid gap-5 lg:grid-cols-2">
        {pts ? <StackedBarChart testId="chart-punctuality" title={t("rpo.c_punctuality")} description={t("rpo.c_punctuality_hint", { n: data.meta.grace })} data={pts.data} prev={pts.prev} bucket={bucket}
          series={[{ key: "on_time", label: t("rpo.s_on_time"), color: seriesColor(0) }, { key: "late", label: t("rpo.s_late"), color: seriesColor(1) }, { key: "no_show", label: t("rpo.s_no_show"), color: seriesColor(3) }]} />
          : <CardFailed title={t("rpo.c_punctuality")} onRetry={retry} testId="chart-punctuality" />}
        {pts ? <TrendChart testId="chart-ontime-rate" title={t("rpo.c_ontime_rate")} description={t("rpo.c_ontime_rate_hint")} data={pts.data} prev={pts.prev} bucket={bucket} format="percent"
          series={[{ key: "on_time_rate", label: t("rpo.s_on_time_rate"), kind: "line", color: seriesColor(0) }]} />
          : <CardFailed title={t("rpo.c_ontime_rate")} onRetry={retry} testId="chart-ontime-rate" />}
      </div>
      <div className="grid gap-5 lg:grid-cols-2">
        {ex ? <HistogramChart testId="chart-lateness" title={t("rpo.c_lateness")} description={t("rpo.c_lateness_hint")} unit={t("rpo.unit_jobs")} buckets={lateBuckets(ex.delay.histogram, t, locale)} stats={range(ex.delay)} /> : <CardFailed title={t("rpo.c_lateness")} onRetry={retry} testId="chart-lateness" />}
        {ex ? <HistogramChart testId="chart-job-duration" title={t("rpo.c_job_duration")} description={t("rpo.c_job_duration_hint")} unit={t("rpo.unit_jobs")} buckets={durationBuckets(ex.job.histogram, t, locale)} stats={range(ex.job)} /> : <CardFailed title={t("rpo.c_job_duration")} onRetry={retry} testId="chart-job-duration" />}
      </div>
      <div className="grid gap-5 lg:grid-cols-2">
        {ex ? <StatTable testId="stat-field" title={t("rpo.c_field")} description={t("rpo.c_field_hint")} lines={lines} /> : <CardFailed title={t("rpo.c_field")} onRetry={retry} testId="stat-field" />}
        {ex?.scan ? <DonutChart testId="chart-loading-via" title={t("rpo.c_loading_via")} description={t("rpo.c_loading_via_hint")} centerLabel={t("rpo.unit_parcels")}
          slices={[{ key: "scan", label: t("rpo.via_scan"), value: scan, color: seriesColor(0) }, { key: "warehouse", label: t("rpo.via_warehouse"), value: wh, color: seriesColor(4) }]} />
          : <CardFailed title={t("rpo.c_loading_via")} onRetry={retry} testId="chart-loading-via" />}
      </div>
      <div className="grid gap-5 lg:grid-cols-2">
        {data.pressure ? <Heatmap testId="heat-unfilled" title={t("rpo.c_heat_unfilled")} description={t("rpo.c_heat_unfilled_hint")} cells={data.pressure.unfilled.cells} unit={t("rpo.unit_slots")} /> : <CardFailed title={t("rpo.c_heat_unfilled")} onRetry={retry} testId="heat-unfilled" />}
        {data.pressure ? <Heatmap testId="heat-late" title={t("rpo.c_heat_late")} description={t("rpo.c_heat_late_hint")} cells={data.pressure.late.cells} unit={t("rpo.unit_jobs")} /> : <CardFailed title={t("rpo.c_heat_late")} onRetry={retry} testId="heat-late" />}
      </div>
      <DrillTable testId="drill-late" report="operations" name="late-jobs" qs={qs} />
      <DrillTable testId="drill-slow-loads" report="operations" name="slow-loads" qs={qs} />
    </>
  );
}
