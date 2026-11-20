"use client";
import Link from "next/link";
import { Star, Truck } from "lucide-react";
import { Badge } from "@/components/ui";
import { useI18n } from "@/i18n/provider";
import { ChartCard, Heatmap, HistogramChart, RankedList, StackedBarChart } from "@/components/reports";
import { FLAG_LIMITS, MIN_VOLUME, type Flag } from "@/server/analytics/portal-constants";
import { fmtPercent, formatValue, seriesColor, STATUS_COLOR } from "../../chartTheme";
import type { BarRow } from "../../BarRows";
import type { Bucket } from "../../types";
import { Guarded } from "../Guarded";
import { KpiSections } from "../KpiSections";
import { PortalDrillTable } from "../PortalDrillTable";
import { PortalInsights } from "../PortalInsights";
import { PortalReport, PortalSuspense, type PortalView } from "../PortalReport";
import type { OfficeDriversData } from "../types";
import { countBuckets, percentBuckets, ratingBuckets } from "../lib";

/** Reports › Drivers of the courier-office portal: scorecards, distributions, best and worst performers (minimum-volume guard), who to coach and when the fleet is active. */
export function OfficeDrivers() {
  const { t } = useI18n();
  return (
    <PortalSuspense>
      <PortalReport<OfficeDriversData> role="office" report="drivers" title={t("rpr.title_drivers")} subtitle={t("rpr.off_drivers_sub")} icon={<Truck className="size-5" />} crumb="nav.rep_drivers" csvTable="drivers" legendKey="rpr.legend_office">
        {(data, view) => <OfficeDriversBody data={data} view={view} />}
      </PortalReport>
    </PortalSuspense>
  );
}

const JOB_COLORS = { completed: STATUS_COLOR.completed, active: STATUS_COLOR.active, cancelled: STATUS_COLOR.cancelled, no_show: seriesColor(1), replaced: seriesColor(7) } as const;
const JOB_FIELDS = ["completed", "active", "cancelled", "no_show", "replaced"] as const;

/** The reason of a flag with its threshold ("Delivery success below 85%"). */
function useFlagText() {
  const { t, locale } = useI18n();
  const p = (n: number) => fmtPercent(n, locale, 0);
  return (f: Flag): string => {
    switch (f) {
      case "low_success": return t("rpr.flag_low_success", { limit: p(FLAG_LIMITS.success), n: MIN_VOLUME.parcels });
      case "late": return t("rpr.flag_late", { limit: p(FLAG_LIMITS.onTime) });
      case "no_shows": return t("rpr.flag_no_shows", { limit: p(FLAG_LIMITS.noShow) });
      case "cancellations": return t("rpr.flag_cancellations", { limit: p(FLAG_LIMITS.cancel) });
      case "low_rating": return t("rpr.flag_low_rating", { limit: formatValue(FLAG_LIMITS.rating, "rate", locale) });
      case "low_acceptance": return t("rpr.flag_low_acceptance", { limit: p(FLAG_LIMITS.acceptance) });
      case "idle": return t("rpr.flag_idle");
    }
  };
}

export function OfficeDriversBody({ data, view }: { data: OfficeDriversData; view: PortalView }) {
  const { t, locale } = useI18n();
  const bucket = data.meta.bucket as Bucket;
  const flagText = useFlagText();
  const brief = (d: NonNullable<OfficeDriversData["performers"]>["top"][number]): BarRow => ({
    key: d.id, label: d.name, href: `/office/drivers/${d.id}`, value: d.success, tone: "cyan",
    sub: <span className="inline-flex flex-wrap items-center gap-x-2">{t("rpr.n_parcels", { n: d.resolved })}{d.rating != null && <span className="inline-flex items-center gap-1"><Star className="size-3 text-gold" aria-hidden /><span className="ltr-num">{formatValue(d.rating, "rate", locale)}</span></span>}</span>,
  });
  return (
    <>
      <KpiSections kpis={data.kpis} comparing={view.comparing} groups={[
        { id: "fleet", title: t("rpr.grp_fleet"), keys: ["active_drivers", "off_avg_jobs", "off_rating", "off_coach"] },
        { id: "quality", title: t("rpr.grp_reliability"), keys: ["delivery_success", "on_time_start", "off_acceptance_rate", "off_no_show_rate", "off_cancel_rate"] },
      ]} />
      <Guarded data={data.series.jobs} title={t("rpr.sec_jobs")} testId="chart-jobs">
        {(s) => <StackedBarChart testId="chart-jobs" title={t("rpr.sec_jobs")} description={t("rpr.sec_jobs_hint")} data={s.points} prev={s.prev} bucket={bucket}
          series={JOB_FIELDS.map((k) => ({ key: k, label: k === "active" ? t("rpf.s_active") : t(`jobstatus.${k}`), color: JOB_COLORS[k] }))} />}
      </Guarded>
      <Guarded data={data.distributions} title={t("rpr.sec_distributions")} testId="chart-dist">
        {(d) => (
          <div className="grid gap-5 lg:grid-cols-3">
            <HistogramChart testId="chart-dist-jobs" title={t("rpr.dist_jobs")} description={t("rpr.dist_jobs_hint")} unit={t("rpr.unit_drivers")} buckets={countBuckets(d.jobs, t, locale)} />
            <HistogramChart testId="chart-dist-success" title={t("rpr.dist_success")} description={t("rpr.dist_success_hint", { n: MIN_VOLUME.parcels })} unit={t("rpr.unit_drivers")} buckets={percentBuckets(d.success, t, locale)} />
            <HistogramChart testId="chart-dist-rating" title={t("rpr.dist_rating")} description={t("rpr.dist_rating_hint", { n: MIN_VOLUME.ratings })} unit={t("rpr.unit_drivers")} buckets={ratingBuckets(d.rating, t, locale)} />
          </div>
        )}
      </Guarded>
      <Guarded data={data.performers} title={t("rpr.sec_performers")} testId="rk-performers">
        {(p) => (
          <div className="space-y-3">
            <p className="text-xs text-muted" data-testid="guard-note">{t("rpr.guard_note", { n: MIN_VOLUME.parcels, ranked: p.ranked, below: p.belowGuard })}</p>
            <div className="grid gap-5 lg:grid-cols-2">
              <RankedList testId="rk-top" title={t("rpr.sec_top")} description={t("rpr.sec_top_hint")} format="percent" rows={p.top.map(brief)} />
              <RankedList testId="rk-bottom" title={t("rpr.sec_bottom")} description={t("rpr.sec_bottom_hint")} format="percent" good="lower" rows={p.bottom.map((d) => ({ ...brief(d), tone: "danger" as const }))} />
            </div>
          </div>
        )}
      </Guarded>
      <div className="grid gap-5 lg:grid-cols-2">
        <Guarded data={data.coach} title={t("rpr.sec_coach")} testId="coach">
          {(list) => (
            <ChartCard testId="coach" title={t("rpr.sec_coach")} description={t("rpr.sec_coach_hint")} height="auto" name={t("rpr.sec_coach")}>
              {list.length === 0 ? <p className="text-sm text-muted" data-testid="coach-none">{t("rpr.coach_none")}</p> : <ul className="space-y-3">
                {list.map((d) => (
                  <li key={d.id} className="min-w-0 text-sm" data-testid="coach-item">
                    <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                      <Link href={`/office/drivers/${d.id}`} className="font-medium text-accent hover:underline">{d.name}</Link>
                      <span className="text-xs text-muted">{t("rpr.coach_stats", { jobs: d.jobs, success: d.success == null ? "—" : fmtPercent(d.success, locale, 0) })}</span>
                    </div>
                    <ul className="mt-1.5 flex flex-wrap gap-1.5">{d.flags.map((f) => <li key={f}><Badge tone="warn" className="whitespace-normal rounded-lg text-start leading-snug">{flagText(f as Flag)}</Badge></li>)}</ul>
                  </li>
                ))}
              </ul>}
            </ChartCard>
          )}
        </Guarded>
        <Guarded data={data.idle} title={t("rpr.sec_idle")} testId="idle">
          {(list) => (
            <ChartCard testId="idle" title={t("rpr.sec_idle")} description={t("rpr.sec_idle_hint")} height="auto" name={t("rpr.sec_idle")}>
              {list.length === 0 ? <p className="text-sm text-muted" data-testid="idle-none">{t("rpr.idle_none")}</p> : <ul className="flex flex-wrap gap-2">{list.map((d) => <li key={d.id}><Link href={`/office/drivers/${d.id}`} className="inline-block rounded-full border border-line bg-bg2 px-3 py-1 text-sm hover:border-accent/60">{d.name}</Link></li>)}</ul>}
            </ChartCard>
          )}
        </Guarded>
      </div>
      <Guarded data={data.grids} title={t("rpr.sec_activity")} testId="chart-grids">
        {(g) => (
          <div className="grid gap-5 lg:grid-cols-2">
            <Heatmap testId="chart-online" title={t("rpr.sec_online")} description={t("rpr.sec_online_hint")} cells={g.online.cells} unit={t("rpr.unit_online")} />
            <Heatmap testId="chart-arrivals" title={t("rpr.sec_arrivals")} description={t("rpr.sec_arrivals_hint")} cells={g.arrivals.cells} unit={t("rpr.unit_arrivals")} />
          </div>
        )}
      </Guarded>
      <PortalInsights title={t("rpf.sec_insights")} description={t("rpf.sec_insights_hint")} items={data.insights} cityName={view.cityName} />
      <PortalDrillTable testId="drill-drivers" role="office" name="drivers" qs={view.filters.qs} />
    </>
  );
}
