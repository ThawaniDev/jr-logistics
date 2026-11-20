"use client";
import { PackageCheck, Star } from "lucide-react";
import { useI18n } from "@/i18n/provider";
import { BreakdownTable, ChartCard, DonutChart, Heatmap, HistogramChart, RankedList, StackedBarChart } from "@/components/reports";
import { fmtDur, fmtPercent, formatValue } from "../../chartTheme";
import { PARCEL_SERIES, statusSeries } from "../../overview-lib";
import type { Bucket } from "../../types";
import type { BarRow } from "../../BarRows";
import { Guarded } from "../Guarded";
import { KpiSections } from "../KpiSections";
import { PortalDrillTable } from "../PortalDrillTable";
import { PortalInsights } from "../PortalInsights";
import { PortalReport, PortalSuspense, type PortalView } from "../PortalReport";
import type { BusinessDeliveriesData } from "../types";
import { cityFailureRows, durationBuckets, proofSlices, reasonRows, reasonSlices, smsSlices } from "../lib";

/** Reports › Deliveries of the company portal: why parcels fail, how long they take, proof and SMS/code problems, the worst cities, the drivers who served the company and the returns still waiting. */
export function BusinessDeliveries() {
  const { t } = useI18n();
  return (
    <PortalSuspense>
      <PortalReport<BusinessDeliveriesData> role="business" report="deliveries" title={t("rpr.title_deliveries")} subtitle={t("rpr.biz_deliveries_sub")} icon={<PackageCheck className="size-5" />} crumb="nav.rep_deliveries" csvTable="parcels" legendKey="rpr.legend_business">
        {(data, view) => <BusinessDeliveriesBody data={data} view={view} />}
      </PortalReport>
    </PortalSuspense>
  );
}

function StatRows({ title, testId, rows }: { title: string; testId: string; rows: Array<{ key: string; label: string; value: string; hint?: string }> }) {
  return (
    <ChartCard testId={testId} title={title} height="auto" name={title}>
      <dl className="space-y-2.5 text-sm">
        {rows.map((r) => (
          <div key={r.key} className="flex items-baseline justify-between gap-3" data-testid={`${testId}-${r.key}`}>
            <dt className="min-w-0 text-muted">{r.label}{r.hint && <span className="block text-xs">{r.hint}</span>}</dt>
            <dd className="ltr-num shrink-0 font-semibold tabular-nums">{r.value}</dd>
          </div>
        ))}
      </dl>
    </ChartCard>
  );
}

export function BusinessDeliveriesBody({ data, view }: { data: BusinessDeliveriesData; view: PortalView }) {
  const { t, locale } = useI18n();
  const bucket = data.meta.bucket as Bucket;
  const num = (n: number) => formatValue(n, "number", locale);
  const share = (n: number, d: number) => (d > 0 ? fmtPercent(n / d, locale, 1) : "—");
  const cityName = view.cityName;
  const driverRows = (data.drivers ?? []).map((d): BarRow => ({
    key: d.key, label: d.firstName || "—", value: d.delivered, tone: "cyan",
    sub: <span className="inline-flex items-center gap-2">{d.rating != null && <span className="inline-flex items-center gap-1"><Star className="size-3 text-gold" aria-hidden /><span className="ltr-num">{d.rating}</span></span>}{d.failed > 0 && <span>{t("rpr.n_failed", { n: d.failed })}</span>}</span>,
  }));
  return (
    <>
      <KpiSections kpis={data.kpis} comparing={view.comparing} groups={[
        { id: "quality", title: t("rpr.grp_quality"), keys: ["parcels_delivered", "biz_parcels_failed", "biz_parcels_returned", "delivery_success", "first_attempt"] },
        { id: "experience", title: t("rpr.grp_experience"), keys: ["biz_deferred_rate", "biz_delivery_time", "biz_otp_issue_rate", "biz_sms_failure_rate", "biz_returns_outstanding"] },
      ]} />
      <div className="grid gap-5 lg:grid-cols-2">
        <Guarded data={data.series.parcels} title={t("rpf.sec_parcels")} testId="chart-parcels">
          {(s) => <StackedBarChart testId="chart-parcels" title={t("rpf.sec_parcels")} description={t("rpf.sec_parcels_hint")} data={s.points} prev={s.prev} bucket={bucket} series={statusSeries(PARCEL_SERIES, t)} />}
        </Guarded>
        <Guarded data={data.deliveryTime} title={t("rpr.sec_delivery_time")} testId="chart-delivery-time">
          {(d) => <HistogramChart testId="chart-delivery-time" title={t("rpr.sec_delivery_time")} description={t("rpr.sec_delivery_time_hint")} unit={t("rpf.unit_parcels")} buckets={durationBuckets(d.histogram, t, locale)}
            stats={d.n > 0 ? <p className="text-xs text-muted">{t("rpf.fill_median")}: <b className="ltr-num text-ink">{d.p50 != null ? fmtDur(d.p50, locale) : "—"}</b> · {t("rpf.fill_p90")}: <b className="ltr-num text-ink">{d.p90 != null ? fmtDur(d.p90, locale) : "—"}</b></p> : undefined} />}
        </Guarded>
      </div>
      <Guarded data={data.reasons} title={t("rpr.sec_reasons")} testId="chart-reasons">
        {(r) => (
          <div className="grid gap-5 lg:grid-cols-2">
            <DonutChart testId="chart-reasons" title={t("rpr.sec_reasons")} description={t("rpr.sec_reasons_hint")} slices={reasonSlices(r, t)} centerLabel={t("rpr.s_failed_parcels")} />
            <RankedList testId="rk-reasons" title={t("rpr.sec_reasons_table")} description={t("rpr.sec_reasons_table_hint")} rows={reasonRows(r, t)} good="lower" />
          </div>
        )}
      </Guarded>
      <div className="grid gap-5 lg:grid-cols-2">
        <Guarded data={data.heatmap} title={t("rpr.sec_heat_delivered")} testId="chart-heatmap">
          {(h) => <Heatmap testId="chart-heatmap" title={t("rpr.sec_heat_delivered")} description={t("rpf.sec_heat_hint")} cells={h.cells} unit={t("rpf.unit_parcels")} />}
        </Guarded>
        <Guarded data={data.proof} title={t("rpr.sec_proof")} testId="chart-proof">
          {(p) => <DonutChart testId="chart-proof" title={t("rpr.sec_proof")} description={t("rpr.sec_proof_hint")} slices={proofSlices(p, t)} centerLabel={t("rpf.unit_parcels")} />}
        </Guarded>
      </div>
      <div className="grid gap-5 lg:grid-cols-3">
        <Guarded data={data.sms} title={t("rpr.sec_sms")} testId="chart-sms">
          {(s) => <DonutChart testId="chart-sms" title={t("rpr.sec_sms")} description={t("rpr.sec_sms_hint")} slices={smsSlices(s, t)} centerLabel={t("rpr.s_messages")} />}
        </Guarded>
        <Guarded data={data.codes} title={t("rpr.sec_codes")} testId="stats-codes">
          {(c) => <StatRows testId="stats-codes" title={t("rpr.sec_codes")} rows={[
            { key: "wrong", label: t("rpr.codes_wrong"), value: `${num(c.wrongCode)} · ${share(c.wrongCode, c.resolved)}` },
            { key: "resent", label: t("rpr.codes_resent"), value: `${num(c.resent)} · ${share(c.resent, c.resolved)}` },
            { key: "none", label: t("rpr.codes_none"), value: `${num(c.noCode)} · ${share(c.noCode, c.resolved)}` },
            { key: "of", label: t("rpr.codes_of"), value: num(c.resolved) },
          ]} />}
        </Guarded>
        <Guarded data={data.defer} title={t("rpr.sec_defer")} testId="stats-defer">
          {(d) => <StatRows testId="stats-defer" title={t("rpr.sec_defer")} rows={[
            { key: "deferred", label: t("rpr.defer_total"), hint: t("rpr.defer_hint"), value: num(d.deferred) },
            { key: "delivered", label: t("rpr.defer_delivered"), value: `${num(d.deliveredAfter)} · ${share(d.deliveredAfter, d.deferred)}` },
            { key: "failed", label: t("rpr.defer_failed"), value: `${num(d.failedAfter)} · ${share(d.failedAfter, d.deferred)}` },
          ]} />}
        </Guarded>
      </div>
      <div className="grid gap-5 lg:grid-cols-2">
        <Guarded data={data.cities} title={t("rpr.sec_worst_cities")} testId="bd-city-fail">
          {(c) => <BreakdownTable testId="bd-city-fail" title={t("rpr.sec_worst_cities")} description={t("rpr.sec_city_failure_hint")} format="percent" good="lower" rows={cityFailureRows(c, t, cityName)} />}
        </Guarded>
        <Guarded data={data.drivers} title={t("rpr.sec_drivers_served")} testId="rk-drivers">
          {() => <RankedList testId="rk-drivers" title={t("rpr.sec_drivers_served")} description={t("rpr.sec_drivers_served_hint")} rows={driverRows} />}
        </Guarded>
      </div>
      <div className="grid gap-5 lg:grid-cols-2">
        <Guarded data={data.returns} title={t("rpr.sec_returns")} testId="stats-returns">
          {(r) => <StatRows testId="stats-returns" title={t("rpr.sec_returns")} rows={[
            { key: "total", label: t("rpr.returns_total"), hint: t("rpr.returns_hint"), value: num(r.n) },
            { key: "fresh", label: t("rpr.returns_fresh"), value: num(r.fresh) },
            { key: "mid", label: t("rpr.returns_mid"), value: num(r.mid) },
            { key: "old", label: t("rpr.returns_old"), value: num(r.old) },
          ]} />}
        </Guarded>
        <PortalInsights title={t("rpf.sec_insights")} description={t("rpf.sec_insights_hint")} items={data.insights} cityName={cityName} />
      </div>
      <PortalDrillTable testId="drill-returns" role="business" name="returns" qs={view.filters.qs} />
      <PortalDrillTable testId="drill-parcels" role="business" name="parcels" qs={view.filters.qs} />
    </>
  );
}
