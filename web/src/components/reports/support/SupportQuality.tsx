"use client";
import { useI18n } from "@/i18n/provider";
import { BreakdownTable } from "../BreakdownTable";
import { DonutChart } from "../DonutChart";
import { HistogramChart } from "../HistogramChart";
import { InsightList } from "../InsightList";
import { RankedList } from "../RankedList";
import { TrendChart } from "../TrendChart";
import { fmtDur, seriesColor, STATUS_COLOR } from "../chartTheme";
import type { Bucket } from "../types";
import { groupRows, groupSlices, ratingTrend, roleAvg, starBuckets, type SupportData } from "./support-lib";

type Lowest = SupportData["ratings"]["lowest"]["drivers"];

/** Complaints (categories, state of the ones filed), ratings (distribution, trend, lowest rated with comments), the quality-versus-volume chart and the generated observations. */
export function SupportQuality({ data }: { data: SupportData }) {
  const { t, locale } = useI18n();
  const bucket = data.meta.bucket as Bucket;
  const { ratings: rt, complaints: cp, series } = data;
  const low = (rows: Lowest, href: (id: string) => string) => rows.map((r) => ({
    key: r.id, label: r.name, href: href(r.id), value: r.avg, tone: r.avg <= 2.5 ? ("danger" as const) : ("gold" as const),
    sub: `${t("rpq.rated_sub", { n: r.n, low: r.low })}${r.comment ? ` — “${r.comment}”` : ""}`,
  }));
  const split = [["rpq.rating_drivers", rt.drivers], ["rpq.rating_companies", rt.companies]] as const;
  const speed = cp.frP50 != null || cp.resP50 != null ? <p className="text-xs text-muted" data-testid="rpq-complaint-speed">{t("rpq.complaint_speed", { response: cp.frP50 != null ? fmtDur(cp.frP50, locale) : "—", resolution: cp.resP50 != null ? fmtDur(cp.resP50, locale) : "—" })}</p> : undefined;
  return (
    <>
      <div className="grid gap-5 lg:grid-cols-2">
        <BreakdownTable testId="rpq-bd-complaint-category" title={t("rpq.sec_complaint_categories")} description={t("rpq.sec_complaint_categories_hint")} rows={groupRows(data.breakdowns.complaintCategory, "complaint_cat", t)} good="lower" />
        <DonutChart testId="rpq-bd-complaint-outcome" title={t("rpq.sec_complaint_outcome")} description={t("rpq.sec_complaint_outcome_hint")} slices={groupSlices(data.breakdowns.complaintOutcome, "status", t)} centerLabel={t("rpq.s_complaints")} />
      </div>
      {speed && <div>{speed}</div>}
      <div className="grid gap-5 lg:grid-cols-2">
        <HistogramChart testId="rpq-chart-stars" title={t("rpq.sec_stars")} description={t("rpq.sec_stars_hint")} unit={t("rpq.unit_ratings")} buckets={starBuckets(rt.distribution, t)}
          stats={<p className="text-xs text-muted" data-testid="rpq-rating-split">{split.map(([k, s], i) => <span key={k}>{i > 0 && " · "}{t(k)}: <b className="ltr-num text-ink">{roleAvg(s) ?? "—"}</b></span>)}</p>} />
        <TrendChart testId="rpq-chart-rating" title={t("rpq.sec_rating_trend")} description={t("rpq.sec_rating_trend_hint")} data={ratingTrend(series.rating.points)} prev={series.rating.prev ? ratingTrend(series.rating.prev) : null} bucket={bucket} format="rate"
          series={[{ key: "avg", label: t("rpq.s_avg_rating"), kind: "bar", color: seriesColor(1) }]} />
      </div>
      <div className="grid gap-5 lg:grid-cols-2">
        <RankedList testId="rpq-lowest-drivers" title={t("rpq.sec_lowest_drivers")} description={t("rpq.sec_lowest_hint", { n: rt.minRatings })} format="rate" good="higher" rows={low(rt.lowest.drivers, (id) => `/admin/drivers/${id}`)} />
        <RankedList testId="rpq-lowest-companies" title={t("rpq.sec_lowest_companies")} description={t("rpq.sec_lowest_hint", { n: rt.minRatings })} format="rate" good="higher" rows={low(rt.lowest.companies, (id) => `/admin/companies/${id}`)} />
      </div>
      <TrendChart testId="rpq-chart-quality" title={t("rpq.sec_quality")} description={t("rpq.sec_quality_hint")} data={series.quality} bucket={bucket} rightFormat="percent"
        series={[
          { key: "tickets", label: t("rpq.s_opened"), kind: "bar", color: seriesColor(0) },
          { key: "deliverySuccess", label: t("rpq.s_delivery_success"), kind: "line", axis: "right", color: STATUS_COLOR.delivered },
          { key: "cancellationRate", label: t("rpq.s_cancellation"), kind: "line", axis: "right", color: STATUS_COLOR.cancelled },
          { key: "onTime", label: t("rpq.s_on_time"), kind: "line", axis: "right", color: seriesColor(4) },
        ]} />
      <InsightList testId="rpq-insights" title={t("rpf.sec_insights")} description={t("rpf.sec_insights_hint")} items={data.insights} />
    </>
  );
}
