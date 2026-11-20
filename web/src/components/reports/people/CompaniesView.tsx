"use client";
import { useI18n } from "@/i18n/provider";
import type { CompaniesReport } from "@/server/analytics/companies";
import { BreakdownTable } from "../BreakdownTable";
import { DonutChart } from "../DonutChart";
import { HistogramChart } from "../HistogramChart";
import { InsightList } from "../InsightList";
import { formatValue } from "../chartTheme";
import { TrendChart } from "../TrendChart";
import { DrillTable } from "../DrillTable";
import { CohortTable, MoverCard, NoteCard, ParetoChart, PartialNotice, Row } from "./PeopleParts";
import { intBuckets, slicesOf, walletBuckets } from "./people-lib";
import type { Bucket } from "../types";

const SEG_COLOR: Record<string, string> = { small: "var(--rpf-c3)", medium: "var(--rpf-c1)", large: "var(--rpf-c2)" };

/** The chart and table sections of Reports › Companies (the KPI grid and the shell are on the page). */
export function CompaniesView({ data, qs }: { data: CompaniesReport; qs: string }) {
  const { t, locale } = useI18n();
  const th = data.thresholds, hs = data.health;
  const segVars = { n: th.segments.medium, from: th.segments.medium, to: th.segments.large, big: th.segments.large };
  const segLabel = (k: string) => t(`rpp.seg_${k}`, k === "small" ? { n: segVars.n } : k === "medium" ? { from: segVars.from, to: segVars.to } : { n: segVars.big });
  const pct = (w: number) => `${w}%`;
  return (
    <>
      <PartialNotice keys={data.partial} />
      <TrendChart testId="chart-activity" title={t("rpp.cmp_activity")} description={t("rpp.cmp_activity_hint")} data={data.series.points} prev={data.series.prev} bucket={data.meta.bucket as Bucket}
        series={[{ key: "active", label: t("rpp.s_active"), kind: "area" }, { key: "firsts", label: t("rpp.s_firsts"), kind: "bar" }, { key: "signups", label: t("rpp.s_signups"), kind: "line" }]} />
      <Row>
        <ParetoChart testId="chart-pareto-parcels" title={t("rpp.cmp_pareto_parcels")} description={t("rpp.cmp_pareto_hint", { n: formatValue(data.concentration.parcels.top10Share, "percent", locale) })} rows={data.concentration.parcels.rows} format="number" valueLabel={t("rpp.unit_parcels")} />
        {data.concentration.gmv && <ParetoChart testId="chart-pareto-gmv" title={t("rpp.cmp_pareto_gmv")} description={t("rpp.cmp_pareto_hint", { n: formatValue(data.concentration.gmv.top10Share, "percent", locale) })} rows={data.concentration.gmv.rows} format="money" valueLabel={t("rpf.s_gmv")} />}
      </Row>
      <CohortTable testId="chart-cohorts" title={t("rpp.cmp_cohorts")} description={t("rpp.cmp_cohorts_hint")} cohorts={data.cohorts} />
      <Row>
        <DonutChart testId="bd-segments" title={t("rpp.cmp_segments")} description={t("rpp.cmp_segments_hint")} centerLabel={t("rpp.unit_companies")}
          slices={slicesOf(data.segments.map((s) => ({ key: s.key, value: s.companies })), segLabel, SEG_COLOR)} />
        <BreakdownTable testId="bd-segment-parcels" title={t("rpp.cmp_segment_parcels")} description={t("rpp.cmp_segment_parcels_hint")}
          rows={data.segments.map((s) => ({ key: s.key, label: segLabel(s.key), value: s.parcels, tone: s.key === "large" ? "gold" : s.key === "small" ? "cyan" : "accent", sub: [t("rpp.n_companies", { n: s.companies }), s.gmv != null ? formatValue(s.gmv, "money", locale) : null].filter(Boolean).join(" · ") }))} />
      </Row>
      <Row>
        <HistogramChart testId="chart-health" title={t("rpp.cmp_health")} description={t("rpp.cmp_health_hint", { d: hs.silentDays })} unit={t("rpp.unit_companies")} buckets={intBuckets(hs.buckets)}
          stats={hs.avg != null ? <p className="text-xs text-muted">{t("rpp.hs_avg")}: <b className="ltr-num text-ink">{hs.avg}</b></p> : undefined} />
        <NoteCard testId="health-formula" title={t("rpp.hs_title")} description={t("rpp.hs_hint")}>
          <ul className="space-y-1.5 text-sm">
            <li>{t("rpp.hs_recency", { w: pct(hs.weights.recency), d: hs.silentDays })}</li>
            <li>{t("rpp.hs_frequency", { w: pct(hs.weights.frequency), n: hs.ordersPer30d })}</li>
            <li>{t("rpp.hs_success", { w: pct(hs.weights.success) })}</li>
            <li>{t("rpp.hs_cancel", { w: pct(hs.weights.cancel) })}</li>
            <li>{t("rpp.hs_support", { w: pct(hs.weights.support) })}</li>
          </ul>
          <p className="mt-3 text-xs text-muted">{t("rpp.hs_missing")}</p>
          <p className="mt-2 text-xs text-muted">{t("rpp.hs_bands", { good: th.healthy, watch: th.watch })}</p>
        </NoteCard>
      </Row>
      <Row>
        <DonutChart testId="bd-channels" title={t("rpp.cmp_channels")} description={t("rpp.cmp_channels_hint")} centerLabel={t("rpf.bd_requests")} slices={slicesOf(data.channels.map((c) => ({ key: c.key, value: c.requests })), (k) => t(`rpf.ch_${k}`))} />
        {data.wallets && <HistogramChart testId="chart-wallets" title={t("rpp.cmp_wallets")} description={t("rpp.cmp_wallets_hint")} unit={t("rpp.unit_companies")} buckets={walletBuckets(data.wallets.histogram, locale, t)}
          stats={<p className="text-xs text-muted">{t("rpp.wal_total")}: <b className="ltr-num text-ink">{formatValue(data.wallets.total, "money", locale)}</b></p>} />}
      </Row>
      <Row>
        <MoverCard testId="movers" title={t("rpp.cmp_movers")} description={data.movers ? t(data.movers.by === "gmv" ? "rpf.mv_by_gmv" : "rpf.mv_by_requests") : undefined} movers={data.movers} format={data.movers?.by === "gmv" ? "money" : "number"} href={(m) => `/admin/companies/${m.id}`} />
        <InsightList testId="insights" title={t("rpf.sec_insights")} description={t("rpf.sec_insights_hint")} items={data.insights} />
      </Row>
      <DrillTable testId="drill-leaderboard" report="companies" name="leaderboard" qs={qs} />
      <DrillTable testId="drill-at-risk" report="companies" name="at-risk" qs={qs} />
      <DrillTable testId="drill-new" report="companies" name="new" qs={qs} />
    </>
  );
}
