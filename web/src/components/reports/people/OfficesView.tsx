"use client";
import { useI18n } from "@/i18n/provider";
import type { OfficesReport } from "@/server/analytics/offices";
import { DonutChart } from "../DonutChart";
import { DrillTable } from "../DrillTable";
import { InsightList } from "../InsightList";
import { RankedList } from "../RankedList";
import { STATUS_COLOR } from "../chartTheme";
import { TrendChart } from "../TrendChart";
import type { Bucket } from "../types";
import { PerfTables } from "../fleet/PerfTables";
import { NoteCard, PartialNotice, Row } from "./PeopleParts";
import { slicesOf, stars } from "./people-lib";

const AGR_COLOR: Record<string, string> = { accepted: "var(--rpf-c1)", pending_acceptance: "var(--rpf-c2)", expired: "var(--rpf-c4)", none: "var(--rpf-c8)" };

/** The chart and table sections of Reports › Courier offices (the KPI grid and the shell are on the page). */
export function OfficesView({ data, qs, officeFilter }: { data: OfficesReport; qs: string; officeFilter: boolean }) {
  const { t } = useI18n();
  const bucket = data.meta.bucket as Bucket, lead = data.leaders;
  const offices = (rows: typeof lead.byParcels, kind: "parcels" | "success") => rows.map((r) => ({ key: r.id, label: r.name, href: `/admin/offices/${r.id}`, value: kind === "parcels" ? r.parcels : r.success,
    sub: kind === "parcels" ? (r.success != null ? t("rpp.leader_sub", { n: r.resolved }) : undefined) : t("rpp.off_rank_parcels", { n: r.parcels }) }));
  return (
    <>
      <PartialNotice keys={data.partial} />
      <TrendChart testId="chart-activity" title={t("rpp.off_activity")} description={t("rpp.off_activity_hint")} data={data.series.activity.points} prev={data.series.activity.prev} bucket={bucket}
        series={[{ key: "jobs", label: t("rpp.s_off_jobs"), kind: "bar" }, { key: "delivered", label: t("rpp.s_off_delivered"), kind: "line", color: STATUS_COLOR.delivered }, { key: "offices", label: t("rpp.s_offices"), kind: "line" }]} />
      <Row>
        <TrendChart testId="chart-turnover" title={t("rpp.off_turnover")} description={t("rpp.off_turnover_hint")} data={data.series.activity.points} prev={data.series.activity.prev} bucket={bucket}
          series={[{ key: "links", label: t("rpp.s_links"), kind: "bar" }, { key: "unlinks", label: t("rpp.s_unlinks"), kind: "bar", color: STATUS_COLOR.cancelled }]} />
        {data.series.money && <TrendChart testId="chart-money" title={t("rpp.off_money")} description={t("rpp.off_money_hint")} data={data.series.money.points} prev={data.series.money.prev} bucket={bucket} format="money"
          series={[{ key: "earned", label: t("rpp.s_earned"), kind: "area", color: STATUS_COLOR.gmv }, { key: "paid", label: t("rpp.s_paid"), kind: "line", color: STATUS_COLOR.revenue }]} />}
      </Row>
      <Row>
        <RankedList testId="rk-parcels" title={t("rpp.off_top")} rows={offices(lead.byParcels, "parcels")} format="number" />
        <RankedList testId="rk-best" title={t("rpp.off_best")} description={t("rpp.off_rank_hint", { n: lead.minVolume })} rows={offices(lead.best, "success")} format="percent" />
      </Row>
      <Row>
        <RankedList testId="rk-worst" title={t("rpp.off_worst")} description={t("rpp.off_rank_hint", { n: lead.minVolume })} rows={offices(lead.worst, "success").map((r) => ({ ...r, tone: "danger" as const }))} format="percent" />
        <DonutChart testId="bd-agreements" title={t("rpp.off_agreements")} description={t("rpp.off_agreements_hint")} centerLabel={t("rpp.unit_offices")} slices={slicesOf(data.agreements, (k) => t(`rpp.agr.${k}`), AGR_COLOR)} />
      </Row>
      <Row>
        <NoteCard testId="fleet-card" title={t("rpp.off_fleet_card")}>
          <dl className="grid grid-cols-2 gap-3 text-sm">
            {([["off_fleet_offices", data.fleet.offices], ["off_fleet_drivers", data.fleet.total], ["off_fleet_verified", data.fleet.verified], ["off_fleet_available", data.fleet.available]] as const).map(([k, v]) => (
              <div key={k}><dt className="text-xs text-muted">{t(`rpp.${k}`)}</dt><dd className="ltr-num text-xl font-bold tabular-nums">{v}</dd></div>
            ))}
          </dl>
        </NoteCard>
        {officeFilter && data.drivers
          ? <RankedList testId="rk-office-drivers" title={t("rpp.off_drivers")} description={t("rpp.off_drivers_hint")} format="number"
              rows={data.drivers.map((d) => ({ key: d.id, label: d.name, value: d.parcels, href: `/admin/drivers/${d.id}`, tone: "cyan" as const, sub: [t("rpp.off_driver_sub", { jobs: d.jobs, parcels: d.parcels }), d.rating != null ? t("rpp.star_n", { n: stars(d.rating) }) : null].filter(Boolean).join(" · ") }))} />
          : <NoteCard testId="rk-office-drivers" title={t("rpp.off_drivers")}><p className="text-sm text-muted">{t("rpp.off_drivers_pick")}</p></NoteCard>}
      </Row>
      <InsightList testId="insights" title={t("rpf.sec_insights")} description={t("rpf.sec_insights_hint")} items={data.insights} />
      <DrillTable testId="drill-offices" report="offices" name="scorecards" qs={qs} />
      <DrillTable testId="drill-office-drivers" report="offices" name="drivers" qs={qs} />
      <PerfTables report="offices" qs={qs} days={data.meta.period.days} />
    </>
  );
}
