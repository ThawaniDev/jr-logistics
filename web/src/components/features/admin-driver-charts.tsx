"use client";
import { Badge } from "@/components/ui";
import { BreakdownTable, DonutChart, Heatmap, HistogramChart, TrendChart, seriesColor, formatValue, fmtDur } from "@/components/reports";
import { useI18n } from "@/i18n/provider";
import { useUser } from "@/components/layout/auth-context";
import { hasAny, useCityNames } from "./admin-common";
import { RESPONSE_LABELS } from "@/server/details-people-lib";

/** One point of the weekly / daily series the insight endpoints return. */
export type SeriesPoint = { t: string; delivered: number; failed: number; jobs: number; rate: number | null };
const share = (n: number, d: number) => (d > 0 ? n / d : null);

/** Deliveries over time (delivered / failed, with the previous period dashed), the success-rate trend and the jobs completed: shared by the driver and the office view. */
export function DeliveryCharts({ series, prev, bucket, testId }: { series: SeriesPoint[]; prev?: SeriesPoint[] | null; bucket: "hour" | "day" | "week" | "month"; testId: string }) {
  const { t } = useI18n();
  const rateOf = (p: SeriesPoint) => ({ ...p, rate: share(p.delivered, p.delivered + p.failed) });
  return (
    <>
      <div className="lg:col-span-2"><TrendChart testId={`${testId}-deliveries`} title={t("dv2.ch_deliveries")} description={t("dv2.ch_deliveries_sub", { b: t(`dv2.bucket_${bucket}`) })} data={series} prev={prev} bucket={bucket} stacked
        series={[{ key: "delivered", label: t("dv2.s_delivered"), kind: "bar", color: seriesColor(0) }, { key: "failed", label: t("dv2.s_failed"), kind: "bar", color: seriesColor(3) }]} /></div>
      <TrendChart testId={`${testId}-success`} title={t("dv2.ch_success")} description={t("dv2.ch_success_sub")} data={series.map(rateOf)} prev={prev?.map(rateOf)} bucket={bucket} format="percent"
        series={[{ key: "rate", label: t("dv2.s_success_rate"), kind: "bar", color: seriesColor(0) }]} />
      <TrendChart testId={`${testId}-jobs`} title={t("dv2.ch_jobs")} description={t("dv2.ch_jobs_sub")} data={series} prev={prev} bucket={bucket}
        series={[{ key: "jobs", label: t("dv2.s_jobs"), kind: "area", color: seriesColor(4) }]} />
    </>
  );
}

/** Failure reasons (donut), top cities and top companies served (bars) of one period. `companyHref` names the page a company opens. */
export function MixCharts({ failures, cities, companies, testId }: { failures: Array<{ reason: string; count: number }>; cities: Array<{ city: string; delivered: number; outcomes: number }>; companies: Array<{ id: string; name: string; jobs: number; delivered: number; outcomes: number }>; testId: string }) {
  const { t } = useI18n(); const me = useUser(); const city = useCityNames().name;
  const canCompany = hasAny(me, "users.view", "verification.manage", "offices.view");
  const reason = (r: string) => { const k = t(`stopfail.${r}`); return k === `stopfail.${r}` ? r : k; };
  return (
    <>
      <DonutChart testId={`${testId}-failures`} title={t("dv2.ch_failures")} description={t("dv2.ch_failures_sub")} slices={failures.map((f) => ({ key: f.reason, label: reason(f.reason), value: f.count }))} centerLabel={t("dv2.s_failed")} />
      <BreakdownTable testId={`${testId}-cities`} title={t("dv2.ch_cities")} description={t("dv2.ch_cities_sub")} rows={cities.map((c) => ({ key: c.city, label: city(c.city), sub: t("dv2.n_of_m_outcomes", { n: c.delivered, m: c.outcomes }), value: c.delivered }))} />
      <div className="lg:col-span-2"><BreakdownTable testId={`${testId}-companies`} title={t("dv2.ch_companies")} description={t("dv2.ch_companies_sub")}
        rows={companies.map((c) => ({ key: c.id, label: c.name, sub: t("dv2.n_jobs_parcels", { jobs: c.jobs, n: c.delivered }), value: c.delivered, href: canCompany ? `/admin/companies/${c.id}` : undefined }))} /></div>
    </>
  );
}

/** Driver-only distributions: ratings, response time to offers and the weekday × hour activity grid. */
export function DriverDistributions({ ratings, response, heatmap, testId }: {
  ratings: { distribution: Array<{ stars: number; count: number }>; count: number; avg: number | null };
  response: { buckets: Array<{ key: string; count: number }>; p50: number | null; p90: number | null; n: number }; heatmap: number[][]; testId: string;
}) {
  const { t, locale } = useI18n();
  return (
    <>
      <HistogramChart testId={`${testId}-ratings`} title={t("dv2.ch_ratings")} description={t("dv2.ch_ratings_sub")} unit={t("dv2.u_ratings")} height={200}
        buckets={ratings.distribution.map((d) => ({ label: `★ ${formatValue(d.stars, "number", locale)}`, count: d.count }))}
        stats={ratings.avg != null ? <Badge tone="info" className="ltr-num">★ {formatValue(ratings.avg, "rate", locale)} · {t("adm.ratings_n", { n: ratings.count })}</Badge> : undefined} />
      <HistogramChart testId={`${testId}-response`} title={t("dv2.ch_response")} description={t("dv2.ch_response_sub")} unit={t("dv2.u_offers")} height={220}
        buckets={response.buckets.map((b, i) => ({ label: t(RESPONSE_LABELS[i] ?? b.key), count: b.count }))}
        stats={response.p50 != null ? <Badge tone="info" className="ltr-num">{t("dv2.p50_p90", { p50: fmtDur(response.p50, locale), p90: response.p90 != null ? fmtDur(response.p90, locale) : "—" })}</Badge> : undefined} />
      <div className="lg:col-span-2"><Heatmap testId={`${testId}-heatmap`} title={t("dv2.ch_heatmap")} description={t("dv2.ch_heatmap_sub")} cells={heatmap} unit={t("dv2.u_parcels")} /></div>
    </>
  );
}
