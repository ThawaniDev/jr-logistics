"use client";
import { useI18n } from "@/i18n/provider";
import { BreakdownTable } from "../BreakdownTable";
import { DonutChart } from "../DonutChart";
import { FunnelChart } from "../FunnelChart";
import { Heatmap } from "../Heatmap";
import { HistogramChart } from "../HistogramChart";
import { InsightList } from "../InsightList";
import { RankedList } from "../RankedList";
import { StackedBarChart, TrendChart } from "../TrendChart";
import { fmtDur, fmtPercent, formatValue, seriesColor, STATUS_COLOR } from "../chartTheme";
import { PARCEL_SERIES, statusSeries } from "../overview-lib";
import type { Bucket } from "../types";
import { deferSlices, flowSeries, groupRows, histBuckets, proofSlices, reasonRows, reasonSlices, successSeries, worstRows } from "./fin-lib";
import { Block, DimSwitch, ReasonMatrix } from "./parts";
import type { CityName, DeliveriesData } from "./types";

const Stat = ({ items }: { items: Array<[string, string]> }) => (
  <p className="text-xs text-muted">{items.map(([k, v], i) => <span key={k}>{i > 0 && " · "}{k}: <b className="ltr-num text-ink">{v}</b></span>)}</p>
);

/** The chart sections of the Deliveries report (everything between the KPI groups). `part` picks which block of the page to render. */
export function DeliveriesCharts({ data, part, cityName }: { data: DeliveriesData; part: "trends" | "reasons" | "timing" | "when" | "groups" | "insights"; cityName: CityName }) {
  const { t, locale } = useI18n();
  const bucket = data.meta.bucket as Bucket;
  const { series: s } = data;
  const dur = (v: number | null) => (v != null ? fmtDur(v, locale) : "—");

  if (part === "trends") {
    const succ = successSeries(s.outcomes.points, s.outcomes.prev);
    return (
      <Block id="trends" title={t("rpd.sec_trends")}>
        <div className="grid gap-5 lg:grid-cols-2">
          <StackedBarChart testId="dlv-chart-outcomes" title={t("rpd.chart_outcomes")} description={t("rpd.chart_outcomes_hint")} data={s.outcomes.points} prev={s.outcomes.prev} bucket={bucket} series={statusSeries(PARCEL_SERIES, t)} />
          <TrendChart testId="dlv-chart-success" title={t("rpd.chart_success")} description={t("rpd.chart_success_hint")} data={succ.data} prev={succ.prev} bucket={bucket} format="percent" series={[{ key: "success", label: t("rpf.kpi_delivery_success"), kind: "bar", color: STATUS_COLOR.delivered }]} />
        </div>
        <div className="grid gap-5 lg:grid-cols-2">
          <TrendChart testId="dlv-chart-flow" title={t("rpd.chart_flow")} description={t("rpd.chart_flow_hint")} data={s.flow.points} prev={s.flow.prev} bucket={bucket} series={flowSeries(t)} />
          <FunnelChart testId="dlv-chart-funnel" title={t("rpd.chart_funnel")} description={t("rpd.chart_funnel_hint")} steps={data.funnel.map((x) => ({ key: x.key, label: t(`rpd.fn_${x.key}`), count: x.count }))} />
        </div>
      </Block>
    );
  }

  if (part === "reasons") {
    const r = data.reasons;
    const failures = r.all.reduce((n, x) => n + x.n, 0);
    const d = data.defer, ev = d.evidence, deferN = ev.both + ev.note + ev.photo + ev.none;
    return (
      <Block id="reasons" title={t("rpd.sec_reasons")}>
        <div className="grid gap-5 lg:grid-cols-2">
          <DonutChart testId="dlv-chart-reasons" title={t("rpd.chart_reasons")} description={t("rpd.chart_reasons_hint")} slices={reasonSlices(r.all, t)} centerLabel={t("rpd.failures")} />
          <RankedList testId="dlv-rank-reasons" title={t("rpd.chart_reasons_rank")} description={t("rpd.chart_reasons_rank_hint", { n: formatValue(failures, "number", locale) })} rows={reasonRows(r.all, t).map((x) => ({ ...x, share: failures > 0 ? x.value! / failures : null }))} good="lower" />
        </div>
        <div className="grid gap-5">
          <ReasonMatrix testId="dlv-matrix-city" title={t("rpd.mx_city")} description={t("rpd.mx_hint")} rows={r.byCity} top={r.top} nameOf={(x) => cityName(x.key) ?? t(`city.${x.key}`)} />
          <ReasonMatrix testId="dlv-matrix-company" title={t("rpd.mx_company")} description={t("rpd.mx_hint")} rows={r.byCompany} top={r.top} nameOf={(x) => x.name ?? `${x.key.slice(0, 8)}…`} />
        </div>
        <div className="grid gap-5 lg:grid-cols-2">
          <DonutChart testId="dlv-chart-defer" title={t("rpd.chart_defer")} description={t("rpd.chart_defer_hint")} slices={deferSlices(ev, t)} centerLabel={t("rpd.postponed")} />
          <div className="space-y-5">
            <HistogramChart testId="dlv-chart-attempts" title={t("rpd.chart_attempts")} description={t("rpd.chart_attempts_hint")} unit={t("rpf.unit_parcels")} buckets={histBuckets(data.attempts.hist, "attempts", t, locale)} height={190} />
            {deferN > 0 || d.delivered + d.failed > 0 ? <Stat items={[[t("rpd.defer_then_delivered"), formatValue(d.delivered, "number", locale)], [t("rpd.defer_then_failed"), formatValue(d.failed, "number", locale)]]} /> : null}
          </div>
        </div>
      </Block>
    );
  }

  if (part === "timing") {
    const p = data.timePercentiles, dist = data.distance, pr = data.proof;
    return (
      <Block id="timing" title={t("rpd.sec_timing")}>
        <div className="grid gap-5 lg:grid-cols-2">
          <HistogramChart testId="dlv-chart-time" title={t("rpd.chart_time")} description={t("rpd.chart_time_hint")} unit={t("rpf.unit_parcels")} buckets={histBuckets(data.time.hist, "duration", t, locale)}
            stats={data.time.n > 0 ? <Stat items={[[t("rpd.p50"), dur(p.p50)], [t("rpd.p90"), dur(p.p90)]]} /> : undefined} />
          <TrendChart testId="dlv-chart-speed" title={t("rpd.chart_speed")} description={t("rpd.chart_speed_hint")} data={s.speed.points} prev={s.speed.prev} bucket={bucket} format="duration"
            series={[{ key: "p50", label: t("rpd.p50"), kind: "bar", color: seriesColor(0) }, { key: "p90", label: t("rpd.p90"), kind: "bar", color: seriesColor(1) }]} />
        </div>
        <div className="grid gap-5 lg:grid-cols-2">
          <HistogramChart testId="dlv-chart-distance" title={t("rpd.chart_distance")} description={t("rpd.chart_distance_hint")} unit={t("rpf.unit_parcels")} buckets={histBuckets(dist.hist, "distance", t, locale)}
            stats={dist.n > 0 ? <Stat items={[[t("rpd.p50"), dist.p50 != null ? t("rpd.metres", { n: formatValue(Math.round(dist.p50), "number", locale) }) : "—"], [t("rpd.p90"), dist.p90 != null ? t("rpd.metres", { n: formatValue(Math.round(dist.p90), "number", locale) }) : "—"], [t("rpd.beyond_100"), fmtPercent(dist.far / dist.n, locale, 0)]]} /> : undefined} />
          <div className="space-y-3">
            <DonutChart testId="dlv-chart-proof" title={t("rpd.chart_proof")} description={t("rpd.chart_proof_hint")} slices={proofSlices(pr, t)} centerLabel={t("rpd.delivered")} />
            {pr.delivered > 0 && <Stat items={[[t("rpd.proof.signed"), `${formatValue(pr.signed, "number", locale)} (${fmtPercent(pr.signed / pr.delivered, locale, 0)})`]]} />}
          </div>
        </div>
      </Block>
    );
  }

  if (part === "when") {
    return (
      <Block id="when" title={t("rpd.sec_when")}>
        <div className="grid gap-5 xl:grid-cols-2">
          <Heatmap testId="dlv-heat-delivered" title={t("rpd.heat_delivered")} description={t("rpd.heat_delivered_hint")} cells={data.heatmap.delivered.cells} unit={t("rpf.unit_parcels")} />
          <Heatmap testId="dlv-heat-failed" title={t("rpd.heat_failed")} description={t("rpd.heat_failed_hint")} cells={data.heatmap.failures.cells} unit={t("rpf.unit_parcels")} />
        </div>
      </Block>
    );
  }

  if (part === "groups") {
    const dims = (["city", "service", "vehicle", "company", "office", "driver"] as const).map((k) => ({ key: k, label: t(`rpd.dim_${k}`) }));
    const worstDims = (["company", "driver", "office", "city"] as const).map((k) => ({ key: k, label: t(`rpd.dim_${k}`) }));
    return (
      <Block id="groups" title={t("rpd.sec_groups")}>
        <DimSwitch testId="dlv-groups" dims={dims} label={t("rpd.sec_groups")} render={(k) => (
          <BreakdownTable testId={`dlv-bd-${k}`} title={t(`rpd.bd_${k}`)} description={t("rpd.bd_hint")} rows={groupRows(data.breakdowns[k].slice(0, 15), t, locale, cityName)} />
        )} />
        <DimSwitch testId="dlv-worst" dims={worstDims} label={t("rpd.sec_worst")} render={(k) => (
          <RankedList testId={`dlv-worst-${k}`} title={t("rpd.sec_worst")} description={t("rpd.worst_hint", { n: data.minVolume })} format="percent" rows={worstRows(data.worst[k], t, locale, cityName)} />
        )} />
      </Block>
    );
  }

  return <InsightList testId="dlv-insights" title={t("rpd.sec_insights")} items={data.insights} />;
}
