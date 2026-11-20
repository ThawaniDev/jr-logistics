"use client";
import { useI18n } from "@/i18n/provider";
import { BreakdownTable } from "../BreakdownTable";
import { DonutChart } from "../DonutChart";
import { FunnelChart } from "../FunnelChart";
import { Heatmap } from "../Heatmap";
import { HistogramChart } from "../HistogramChart";
import { StackedBarChart, TrendChart } from "../TrendChart";
import { STATUS_COLOR, fmtDur } from "../chartTheme";
import { breakdownRows, breakdownSlices, fillBuckets, funnelSteps, PARCEL_SERIES, REQUEST_SERIES, statusSeries, type Dim } from "../overview-lib";
import type { Bucket, OverviewData } from "../types";

/** The chart sections of the Overview: money, requests and parcels over time, funnel, breakdowns, delivery heatmap and time to fill. */
export function OverviewCharts({ data, cityName }: { data: OverviewData; cityName: (key: string) => string | undefined }) {
  const { t, locale } = useI18n();
  const bucket = data.meta.bucket as Bucket;
  const { series, breakdowns: bd, fill } = data;
  const money = !data.meta.moneyHidden;
  const rows = (dim: Dim) => breakdownRows(bd[dim], dim, t, locale, cityName);
  const slices = (dim: Dim) => breakdownSlices(bd[dim], dim, t, "requests", cityName);
  return (
    <>
      {series.money && (
        <TrendChart testId="chart-money" title={t("rpf.sec_money")} description={t("rpf.sec_money_hint")} data={series.money.points} prev={series.money.prev} bucket={bucket} format="money"
          series={[{ key: "gmv", label: t("rpf.s_gmv"), kind: "area", color: STATUS_COLOR.gmv }, { key: "revenue", label: t("rpf.s_revenue"), kind: "line", color: STATUS_COLOR.revenue }]} />
      )}
      <div className="grid gap-5 lg:grid-cols-2">
        <StackedBarChart testId="chart-requests" title={t("rpf.sec_requests")} description={t("rpf.sec_requests_hint")} data={series.requests.points} prev={series.requests.prev} bucket={bucket} series={statusSeries(REQUEST_SERIES, t)} />
        <StackedBarChart testId="chart-parcels" title={t("rpf.sec_parcels")} description={t("rpf.sec_parcels_hint")} data={series.parcels.points} prev={series.parcels.prev} bucket={bucket} series={statusSeries(PARCEL_SERIES, t)} />
      </div>
      <div className="grid gap-5 lg:grid-cols-2">
        <FunnelChart testId="chart-funnel" title={t("rpf.sec_funnel")} description={t("rpf.sec_funnel_hint")} steps={funnelSteps(data.funnel, t)} />
        <BreakdownTable testId="bd-city" title={t("rpf.sec_city")} description={t("rpf.sec_city_hint")} rows={rows("city")} />
      </div>
      <div className="grid gap-5 lg:grid-cols-2">
        <DonutChart testId="bd-service" title={t("rpf.sec_service")} slices={slices("service")} centerLabel={t("rpf.bd_requests")} />
        <DonutChart testId="bd-channel" title={t("rpf.sec_channel")} slices={slices("channel")} centerLabel={t("rpf.bd_requests")} />
      </div>
      <div className="grid gap-5 lg:grid-cols-2">
        <BreakdownTable testId="bd-vehicle" title={t("rpf.sec_vehicle")} rows={rows("vehicle")} />
        {money ? <DonutChart testId="bd-service-gmv" title={t("rpf.sec_service_gmv")} slices={breakdownSlices(bd.service, "service", t, "gmv")} format="money" centerLabel={t("rpf.s_gmv")} /> : <Heatmap testId="chart-heatmap" title={t("rpf.sec_heat")} description={t("rpf.sec_heat_hint")} cells={data.heatmap.cells} unit={t("rpf.unit_parcels")} />}
      </div>
      <div className="grid gap-5 lg:grid-cols-2">
        {money && <Heatmap testId="chart-heatmap" title={t("rpf.sec_heat")} description={t("rpf.sec_heat_hint")} cells={data.heatmap.cells} unit={t("rpf.unit_parcels")} />}
        <div className={money ? "min-w-0" : "min-w-0 lg:col-span-2"}>
          <HistogramChart testId="chart-fill" title={t("rpf.sec_fill")} description={t("rpf.sec_fill_hint")} unit={t("rpf.unit_requests")} buckets={fillBuckets(fill.histogram, t, locale)}
            stats={fill.n > 0 ? <p className="text-xs text-muted">{t("rpf.fill_median")}: <b className="ltr-num text-ink">{fill.p50 != null ? fmtDur(fill.p50, locale) : "—"}</b> · {t("rpf.fill_p90")}: <b className="ltr-num text-ink">{fill.p90 != null ? fmtDur(fill.p90, locale) : "—"}</b></p> : undefined} />
        </div>
      </div>
    </>
  );
}
