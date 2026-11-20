"use client";
import { useI18n } from "@/i18n/provider";
import type { OperationsData } from "@/server/analytics/ops-report";
import { SPEED_STEPS } from "@/server/analytics/ops-kinds";
import { fmtDur, STATUS_COLOR } from "../chartTheme";
import { DrillTable } from "../DrillTable";
import { HistogramChart } from "../HistogramChart";
import { KpiGrid } from "../KpiGrid";
import { StackedBarChart, TrendChart } from "../TrendChart";
import { REQUEST_SERIES, statusSeries } from "../overview-lib";
import type { Bucket } from "../types";
import { CardFailed, SectionHead, StatTable, type StatLine } from "./OpsParts";
import { demandPoints, durationBuckets, kpisOf } from "./ops-lib";

export interface OpsSectionProps { data: OperationsData; retry: () => void; qs: string; cityName?: (key: string) => string | undefined }

/** Demand and fill: requests and fill rate over time, outcomes, how fast requests get their drivers (p50 / p90) and the distributions behind it. */
export function OpsDemand({ data, retry, qs }: OpsSectionProps) {
  const { t, locale } = useI18n();
  const bucket = data.meta.bucket as Bucket, comparing = data.meta.compare !== "none";
  const pts = data.series.demand ? demandPoints(data.series.demand) : null;
  const sp = data.speed;
  const lines: StatLine[] = sp ? SPEED_STEPS.flatMap((step) => [
    { key: `${step}_p50`, label: t(`rpo.step_${step}`), sub: t("rpo.median"), cur: sp[step].p50.cur, prev: comparing ? sp[step].p50.prev : undefined, format: "duration" as const, good: "lower" as const },
    { key: `${step}_p90`, label: t(`rpo.step_${step}`), sub: t("rpo.p90"), cur: sp[step].p90.cur, prev: comparing ? sp[step].p90.prev : undefined, format: "duration" as const, good: "lower" as const },
  ]) : [];
  const stats = (step: "accept" | "fill") => sp && sp[step].n > 0 ? <p className="text-xs text-muted">{t("rpf.fill_median")}: <b className="ltr-num text-ink">{sp[step].p50.cur != null ? fmtDur(sp[step].p50.cur!, locale) : "—"}</b> · {t("rpo.p90")}: <b className="ltr-num text-ink">{sp[step].p90.cur != null ? fmtDur(sp[step].p90.cur!, locale) : "—"}</b></p> : undefined;
  return (
    <>
      <SectionHead id="ops-demand" title={t("rpo.s_demand")} hint={t("rpo.s_demand_hint")} />
      <KpiGrid kpis={kpisOf(data.kpis, "demand")} comparing={comparing} cols={4} />
      <div className="grid gap-5 lg:grid-cols-2">
        {pts ? (
          <TrendChart testId="chart-demand" title={t("rpo.c_demand")} description={t("rpo.c_demand_hint")} data={pts.data} prev={pts.prev} bucket={bucket} rightFormat="percent"
            series={[{ key: "created", label: t("rpo.s_requests"), kind: "bar" }, { key: "fill_rate", label: t("rpo.s_fill_rate"), kind: "line", axis: "right", format: "percent", color: STATUS_COLOR.revenue }]} />
        ) : <CardFailed title={t("rpo.c_demand")} onRetry={retry} testId="chart-demand" />}
        {data.series.demand ? (
          <StackedBarChart testId="chart-outcomes" title={t("rpo.c_outcomes")} description={t("rpo.c_outcomes_hint")} data={data.series.demand.points} prev={data.series.demand.prev} bucket={bucket} series={statusSeries(REQUEST_SERIES, t)} />
        ) : <CardFailed title={t("rpo.c_outcomes")} onRetry={retry} testId="chart-outcomes" />}
      </div>
      <div className="grid gap-5 lg:grid-cols-3">
        {sp ? <StatTable testId="speed-table" title={t("rpo.c_speed")} description={t("rpo.c_speed_hint")} lines={lines} /> : <CardFailed title={t("rpo.c_speed")} onRetry={retry} testId="speed-table" />}
        {sp ? <HistogramChart testId="chart-accept" title={t("rpo.c_accept_hist")} description={t("rpo.c_accept_hist_hint")} unit={t("rpf.unit_requests")} buckets={durationBuckets(sp.acceptHistogram, t, locale)} stats={stats("accept")} />
          : <CardFailed title={t("rpo.c_accept_hist")} onRetry={retry} testId="chart-accept" />}
        {sp ? <HistogramChart testId="chart-fill" title={t("rpo.c_fill_hist")} description={t("rpo.c_fill_hist_hint")} unit={t("rpf.unit_requests")} buckets={durationBuckets(sp.fillHistogram, t, locale)} stats={stats("fill")} />
          : <CardFailed title={t("rpo.c_fill_hist")} onRetry={retry} testId="chart-fill" />}
      </div>
      <DrillTable testId="drill-unfilled" report="operations" name="unfilled" qs={qs} />
      <DrillTable testId="drill-slow-fills" report="operations" name="slow-fills" qs={qs} />
    </>
  );
}
