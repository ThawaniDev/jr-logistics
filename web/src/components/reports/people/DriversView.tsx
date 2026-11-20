"use client";
import { useI18n } from "@/i18n/provider";
import type { DriversReport } from "@/server/analytics/drivers";
import { DonutChart } from "../DonutChart";
import { DrillTable } from "../DrillTable";
import { FunnelChart } from "../FunnelChart";
import { Heatmap } from "../Heatmap";
import { HistogramChart } from "../HistogramChart";
import { InsightList } from "../InsightList";
import { RankedList } from "../RankedList";
import { BreakdownTable } from "../BreakdownTable";
import { STATUS_COLOR } from "../chartTheme";
import { TrendChart } from "../TrendChart";
import type { Bucket } from "../types";
import { PerfTables } from "../fleet/PerfTables";
import { BandMatrix, NoteCard, PartialNotice, Row } from "./PeopleParts";
import { bandLabels, intBuckets, keyLabel, percentBuckets, slicesOf, stars as fmtStars } from "./people-lib";

const FLAG_ORDER = ["suspended", "high_cancel", "low_success", "low_ontime", "low_acceptance", "low_rating"] as const;

/** The chart and table sections of Reports › Drivers (the KPI grid and the shell are on the page). */
export function DriversView({ data, qs }: { data: DriversReport; qs: string }) {
  const { t, locale } = useI18n();
  const bucket = data.meta.bucket as Bucket, th = data.thresholds, d = data.distributions;
  const leaderRows = (rows: DriversReport["leaders"]["top"], tone: "accent" | "danger") => rows.map((r) => ({ key: r.id, label: r.name, value: r.value, href: `/admin/drivers/${r.id}`, tone, sub: `${t("rpp.leader_sub", { n: r.resolved })}${r.rating != null ? ` · ${t("rpp.star_n", { n: fmtStars(r.rating) })}` : ""}` }));
  const ruleVars: Record<string, Record<string, number>> = {
    high_cancel: { n: Math.round(th.cancel * 100), v: th.volume }, low_success: { n: Math.round(th.success * 100), v: th.successMin }, low_ontime: { n: Math.round(th.onTime * 100), v: th.volume },
    low_acceptance: { n: Math.round(th.acceptance * 100), v: th.volume }, low_rating: { n: th.rating, v: th.ratingMin },
  };
  const heatNote = data.heatmap.source === "snapshots" ? t("rpp.heat_src_snapshots") : data.heatmap.source === "log" ? t("rpp.heat_src_log") : "";
  const accLabels = bandLabels(th.acceptEdges, locale), compLabels = bandLabels(th.completeEdges, locale);
  const funnelSteps = data.funnel.steps.map((s) => ({ key: s.key, label: t(`rpp.fn_${s.key}`), count: s.count }));
  const times = data.funnel.times;
  return (
    <>
      <PartialNotice keys={data.partial} />
      <TrendChart testId="chart-volume" title={t("rpp.drv_volume")} description={t("rpp.drv_volume_hint")} data={data.series.volume.points} prev={data.series.volume.prev} bucket={bucket}
        series={[{ key: "active", label: t("rpp.s_active_drv"), kind: "area" }, { key: "jobs", label: t("rpp.s_jobs"), kind: "bar" }, { key: "delivered", label: t("rpp.s_delivered"), kind: "line", color: STATUS_COLOR.delivered }, { key: "signups", label: t("rpp.s_signups_drv"), kind: "line" }]} />
      <TrendChart testId="chart-quality" title={t("rpp.drv_quality")} description={t("rpp.drv_quality_hint")} data={data.series.quality.points} prev={data.series.quality.prev} bucket={bucket} format="percent"
        series={[{ key: "acceptance", label: t("rpp.s_acceptance"), kind: "line" }, { key: "success", label: t("rpp.s_success"), kind: "line", color: STATUS_COLOR.delivered }, { key: "cancel", label: t("rpp.s_cancel"), kind: "line", color: STATUS_COLOR.cancelled }]} />
      <Row>
        <HistogramChart testId="chart-jobs" title={t("rpp.drv_dist_jobs")} description={t("rpp.drv_dist_jobs_hint")} unit={t("rpp.unit_drivers")} buckets={intBuckets(d.jobs)} />
        <HistogramChart testId="chart-success" title={t("rpp.drv_dist_success")} description={t("rpp.drv_dist_success_hint")} unit={t("rpp.unit_drivers")} buckets={percentBuckets(d.success, locale)} />
      </Row>
      <Row>
        <HistogramChart testId="chart-ratings" title={t("rpp.drv_dist_rating")} description={t("rpp.drv_dist_rating_hint")} unit={t("rpp.unit_ratings")} buckets={d.stars.map((n, i) => ({ label: t("rpp.star_n", { n: i + 1 }), count: n }))}
          stats={d.ratingAvg != null ? <p className="text-xs text-muted">{t("rpp.rating_avg")}: <b className="ltr-num text-ink">{fmtStars(d.ratingAvg)}</b></p> : undefined} />
        <NoteCard testId="fleet-card" title={t("rpp.drv_fleet")} description={undefined}>
          <dl className="grid grid-cols-2 gap-3 text-sm">
            {([["fleet_total", data.fleet.total], ["fleet_verified", data.fleet.verified], ["fleet_available", data.fleet.available], ["fleet_suspended", data.fleet.suspended],
              ["fleet_churn", data.fleet.churned == null ? "—" : `${data.fleet.churned} / ${data.fleet.wasActive ?? "—"}`]] as const).map(([k, v]) => (
              <div key={k}><dt className="text-xs text-muted">{t(`rpp.${k}`)}</dt><dd className="ltr-num text-xl font-bold tabular-nums">{v}</dd></div>
            ))}
          </dl>
        </NoteCard>
      </Row>
      <Row>
        <RankedList testId="rk-top" title={t("rpp.drv_top")} description={t("rpp.drv_leaders_hint", { n: data.leaders.minVolume })} rows={leaderRows(data.leaders.top, "accent")} format="percent" />
        <RankedList testId="rk-bottom" title={t("rpp.drv_bottom")} description={t("rpp.drv_leaders_hint", { n: data.leaders.minVolume })} rows={leaderRows(data.leaders.bottom, "danger")} format="percent" good="higher" />
      </Row>
      <Row>
        <DonutChart testId="bd-vehicle" title={t("rpp.drv_mix_vehicle")} centerLabel={t("rpp.unit_drivers")} slices={slicesOf(data.mix.vehicle, (k) => keyLabel("vehicle", k, t))} />
        <DonutChart testId="bd-city" title={t("rpp.drv_mix_city")} centerLabel={t("rpp.unit_drivers")} slices={slicesOf(data.mix.city, (k) => keyLabel("city", k, t))} />
      </Row>
      <Row>
        <BandMatrix testId="chart-reliability" title={t("rpp.drv_reliability")} description={t("rpp.drv_reliability_hint")} cells={data.reliability.cells} rowLabels={accLabels} colLabels={compLabels}
          rowTitle={t("rpp.rel_acceptance")} colTitle={t("rpp.rel_completion")} unit={t("rpp.unit_drivers")} cellTitle={(n, r, c) => t("rpp.rel_cell", { n, a: r, c })} />
        <NoteCard testId="rules-card" title={t("rpp.drv_rules")} description={t("rpp.drv_rules_hint")}>
          <ul className="space-y-2 text-sm">
            {FLAG_ORDER.map((f) => <li key={f} className="flex flex-col items-start gap-1 sm:flex-row sm:gap-2"><span className="shrink-0 rounded-md bg-danger/10 px-1.5 py-0.5 text-xs font-semibold text-danger">{t(`rpp.flag.${f}`)}</span><span>{t(`rpp.rule_${f}`, ruleVars[f])}</span></li>)}
          </ul>
        </NoteCard>
      </Row>
      <Heatmap testId="chart-heatmap" title={t("rpp.drv_heat")} description={`${t("rpp.drv_heat_hint", { n: data.heatmap.windowDays })} ${heatNote}`.trim()} cells={data.heatmap.cells} unit={t("rpp.unit_available")} />
      <Row>
        <FunnelChart testId="chart-funnel" title={t("rpp.drv_funnel")} description={t("rpp.drv_funnel_hint")} steps={funnelSteps} />
        <BreakdownTable testId="funnel-times" title={t("rpp.drv_funnel_times")} format="duration"
          rows={[{ key: "docs", label: t("rpp.t_docs"), value: times.docs }, { key: "verify", label: t("rpp.t_verify"), value: times.verify }, { key: "job", label: t("rpp.t_job"), value: times.job }]} />
      </Row>
      <InsightList testId="insights" title={t("rpf.sec_insights")} description={t("rpf.sec_insights_hint")} items={data.insights} />
      <DrillTable testId="drill-scorecards" report="drivers" name="scorecards" qs={qs} />
      <DrillTable testId="drill-unreliable" report="drivers" name="unreliable" qs={qs} />
      <DrillTable testId="drill-inactive" report="drivers" name="inactive" qs={qs} />
      <PerfTables report="drivers" qs={qs} days={data.meta.period.days} />
    </>
  );
}
