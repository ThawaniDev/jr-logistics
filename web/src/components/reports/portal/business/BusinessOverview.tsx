"use client";
import { PieChart } from "lucide-react";
import { useI18n } from "@/i18n/provider";
import { BreakdownTable, DonutChart, FunnelChart, Heatmap, HistogramChart, StackedBarChart, TrendChart } from "@/components/reports";
import { fmtDur, formatValue, STATUS_COLOR, seriesColor } from "../../chartTheme";
import { PARCEL_SERIES, REQUEST_SERIES, statusSeries } from "../../overview-lib";
import type { Bucket } from "../../types";
import { Guarded } from "../Guarded";
import { KpiSections } from "../KpiSections";
import { PortalDrillTable } from "../PortalDrillTable";
import { PortalInsights } from "../PortalInsights";
import { PortalReport, PortalSuspense, type PortalView } from "../PortalReport";
import type { BusinessOverviewData } from "../types";
import { cityFailureRows, durationBuckets, funnelOf, groupRows, groupSlices } from "../lib";

/** Reports › Overview of the company portal: requests, parcels, delivery quality, spend and cash on delivery of the signed-in company, with the change against the comparison period. */
export function BusinessOverview() {
  const { t } = useI18n();
  return (
    <PortalSuspense>
      <PortalReport<BusinessOverviewData> role="business" report="overview" title={t("nav.reports")} subtitle={t("rpr.biz_overview_sub")} icon={<PieChart className="size-5" />} crumb="nav.rep_overview" csvTable="requests" legendKey="rpr.legend_business">
        {(data, view) => <BusinessOverviewBody data={data} view={view} />}
      </PortalReport>
    </PortalSuspense>
  );
}

export function BusinessOverviewBody({ data, view }: { data: BusinessOverviewData; view: PortalView }) {
  const { t, locale } = useI18n();
  const bucket = data.meta.bucket as Bucket;
  const { series, breakdowns: bd } = data;
  const cityName = view.cityName;
  const billed = (r: { spend?: number }) => (r.spend ? t("rpf.bd_billed", { value: formatValue(r.spend, "money", locale) }) : undefined);
  return (
    <>
      <KpiSections kpis={data.kpis} comparing={view.comparing} groups={[
        { id: "orders", title: t("rpr.grp_orders"), keys: ["biz_requests", "requests_completed", "cancellation_rate", "time_to_fill", "on_time_start"] },
        { id: "parcels", title: t("rpr.grp_parcels"), keys: ["biz_parcels_sent", "parcels_delivered", "biz_parcels_failed", "biz_parcels_returned", "delivery_success", "first_attempt"] },
        { id: "spend", title: t("rpr.grp_spend"), keys: ["biz_spend", "biz_avg_order", "biz_cost_per_parcel"] },
        { id: "cod", title: t("rpr.grp_cod"), keys: ["biz_cod_collected", "biz_cod_received", "biz_cod_outstanding"] },
      ]} />
      <div className="grid gap-5 lg:grid-cols-2">
        <Guarded data={series.requests} title={t("rpf.sec_requests")} testId="chart-requests">
          {(s) => <StackedBarChart testId="chart-requests" title={t("rpf.sec_requests")} description={t("rpf.sec_requests_hint")} data={s.points} prev={s.prev} bucket={bucket} series={statusSeries(REQUEST_SERIES, t)} />}
        </Guarded>
        <Guarded data={series.parcels} title={t("rpf.sec_parcels")} testId="chart-parcels">
          {(s) => <StackedBarChart testId="chart-parcels" title={t("rpf.sec_parcels")} description={t("rpf.sec_parcels_hint")} data={s.points} prev={s.prev} bucket={bucket} series={statusSeries(PARCEL_SERIES, t)} />}
        </Guarded>
      </div>
      <div className="grid gap-5 lg:grid-cols-2">
        <Guarded data={series.spend} title={t("rpr.sec_spend")} testId="chart-spend">
          {(s) => <TrendChart testId="chart-spend" title={t("rpr.sec_spend")} description={t("rpr.sec_spend_hint")} data={s.points} prev={s.prev} bucket={bucket} format="money" rightFormat="number"
            series={[{ key: "spend", label: t("rpr.s_spend"), kind: "area", color: STATUS_COLOR.gmv }, { key: "orders", label: t("rpr.s_orders"), kind: "line", axis: "right", color: seriesColor(1) }]} />}
        </Guarded>
        <Guarded data={series.cod} title={t("rpr.sec_cod")} testId="chart-cod">
          {(s) => <TrendChart testId="chart-cod" title={t("rpr.sec_cod")} description={t("rpr.sec_cod_hint")} data={s.points} prev={s.prev} bucket={bucket} format="money"
            series={[{ key: "collected", label: t("rpr.s_collected"), kind: "bar", color: seriesColor(1) }, { key: "received", label: t("rpr.s_received"), kind: "line", color: STATUS_COLOR.gmv }]} />}
        </Guarded>
      </div>
      <div className="grid gap-5 lg:grid-cols-2">
        <Guarded data={data.funnel} title={t("rpf.sec_funnel")} testId="chart-funnel">
          {(f) => <FunnelChart testId="chart-funnel" title={t("rpf.sec_funnel")} description={t("rpf.sec_funnel_hint")} steps={funnelOf(f, "rpf.fn_", t)} />}
        </Guarded>
        <Guarded data={bd} title={t("rpf.sec_city")} testId="bd-city">
          {(b) => <BreakdownTable testId="bd-city" title={t("rpf.sec_city")} description={t("rpf.sec_city_hint")} rows={groupRows(b.city, "city", "requests", t, cityName, billed)} />}
        </Guarded>
      </div>
      <Guarded data={bd} title={t("rpf.sec_service")} testId="bd-service">
        {(b) => (
          <>
            <div className="grid gap-5 lg:grid-cols-2">
              <DonutChart testId="bd-service" title={t("rpf.sec_service")} slices={groupSlices(b.service, "service", "requests", t)} centerLabel={t("rpf.bd_requests")} />
              <DonutChart testId="bd-service-spend" title={t("rpr.sec_service_spend")} slices={groupSlices(b.service, "service", "spend", t)} format="money" centerLabel={t("rpr.s_spend")} />
            </div>
            <div className="grid gap-5 lg:grid-cols-2">
              <BreakdownTable testId="bd-vehicle" title={t("rpf.sec_vehicle")} rows={groupRows(b.vehicle, "vehicle", "requests", t, cityName)} />
              <DonutChart testId="bd-channel" title={t("rpf.sec_channel")} slices={groupSlices(b.channel, "channel", "requests", t)} centerLabel={t("rpf.bd_requests")} />
            </div>
          </>
        )}
      </Guarded>
      <div className="grid gap-5 lg:grid-cols-2">
        <Guarded data={data.heatmap} title={t("rpf.sec_heat")} testId="chart-heatmap">
          {(h) => <Heatmap testId="chart-heatmap" title={t("rpf.sec_heat")} description={t("rpf.sec_heat_hint")} cells={h.cells} unit={t("rpf.unit_parcels")} />}
        </Guarded>
        <Guarded data={data.fill} title={t("rpf.sec_fill")} testId="chart-fill">
          {(f) => <HistogramChart testId="chart-fill" title={t("rpf.sec_fill")} description={t("rpf.sec_fill_hint")} unit={t("rpf.unit_requests")} buckets={durationBuckets(f.histogram, t, locale)}
            stats={f.n > 0 ? <p className="text-xs text-muted">{t("rpf.fill_median")}: <b className="ltr-num text-ink">{f.p50 != null ? fmtDur(f.p50, locale) : "—"}</b> · {t("rpf.fill_p90")}: <b className="ltr-num text-ink">{f.p90 != null ? fmtDur(f.p90, locale) : "—"}</b></p> : undefined} />}
        </Guarded>
      </div>
      <div className="grid gap-5 lg:grid-cols-2">
        <PortalInsights title={t("rpf.sec_insights")} description={t("rpf.sec_insights_hint")} items={data.insights} cityName={view.cityName} />
        <Guarded data={data.cities} title={t("rpr.sec_city_failure")} testId="bd-city-fail">
          {(c) => <BreakdownTable testId="bd-city-fail" title={t("rpr.sec_city_failure")} description={t("rpr.sec_city_failure_hint")} format="percent" good="lower" rows={cityFailureRows(c, t, cityName)} />}
        </Guarded>
      </div>
      <PortalDrillTable testId="drill-requests" role="business" name="requests" qs={view.filters.qs} />
    </>
  );
}
