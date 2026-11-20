"use client";
import { CircleDollarSign } from "lucide-react";
import { useI18n } from "@/i18n/provider";
import { BreakdownTable, ChartCard, DonutChart, FunnelChart, HistogramChart, RankedList, TrendChart } from "@/components/reports";
import { formatValue, seriesColor, STATUS_COLOR } from "../../chartTheme";
import type { BarRow } from "../../BarRows";
import type { Bucket } from "../../types";
import { Guarded } from "../Guarded";
import { KpiSections } from "../KpiSections";
import { PortalDrillTable } from "../PortalDrillTable";
import { PortalInsights } from "../PortalInsights";
import { PortalReport, PortalSuspense, type PortalView } from "../PortalReport";
import type { OfficeEarningsData } from "../types";
import { durationBuckets, funnelOf, groupRows, groupSlices, topRows } from "../lib";

/** Reports › Earnings of the courier-office portal: what the office earned and was paid, by driver, (anonymous) company, city and service, the settlement pipeline and withdrawals. */
export function OfficeEarnings() {
  const { t } = useI18n();
  return (
    <PortalSuspense>
      <PortalReport<OfficeEarningsData> role="office" report="earnings" title={t("rpr.title_earnings")} subtitle={t("rpr.off_earnings_sub")} icon={<CircleDollarSign className="size-5" />} crumb="nav.rep_earnings" csvTable="settlements" legendKey="rpr.legend_office">
        {(data, view) => <OfficeEarningsBody data={data} view={view} />}
      </PortalReport>
    </PortalSuspense>
  );
}

export function OfficeEarningsBody({ data, view }: { data: OfficeEarningsData; view: PortalView }) {
  const { t, locale } = useI18n();
  const bucket = data.meta.bucket as Bucket;
  const money = (n: number) => formatValue(n, "money", locale);
  const cityName = view.cityName;
  const jobsSub = (r: { jobs?: number }) => (r.jobs ? t("rpr.n_jobs", { n: r.jobs }) : undefined);
  const driverRows: BarRow[] = (data.byDriver ?? []).map((d) => ({ key: d.key, label: d.name, href: `/office/drivers/${d.key}`, value: d.earnings, tone: "cyan", sub: t("rpr.n_jobs", { n: d.jobs }) }));
  return (
    <>
      <KpiSections kpis={data.kpis} comparing={view.comparing} groups={[
        { id: "earnings", title: t("rpr.grp_earnings"), keys: ["off_earnings", "off_paid", "off_pending", "off_settlements"] },
        { id: "averages", title: t("rpr.grp_averages"), keys: ["off_avg_per_job", "off_avg_per_parcel", "off_time_to_pay"] },
        { id: "payouts", title: t("rpr.grp_payouts"), keys: ["off_withdrawn", "off_withdrawals_pending", "off_wallet"] },
      ]} />
      <div className="grid gap-5 lg:grid-cols-2">
        <Guarded data={data.series.earnings} title={t("rpr.sec_earnings")} testId="chart-earnings">
          {(s) => <TrendChart testId="chart-earnings" title={t("rpr.sec_earnings")} description={t("rpr.sec_earnings_hint")} data={s.points} prev={s.prev} bucket={bucket} format="money"
            series={[{ key: "earned", label: t("rpr.s_earned"), kind: "area", color: STATUS_COLOR.gmv }, { key: "paid", label: t("rpr.s_paid"), kind: "line", color: seriesColor(1) }]} />}
        </Guarded>
        <Guarded data={data.series.withdrawals} title={t("rpr.sec_withdrawals")} testId="chart-withdrawals">
          {(s) => <TrendChart testId="chart-withdrawals" title={t("rpr.sec_withdrawals")} description={t("rpr.sec_withdrawals_hint")} data={s.points} prev={s.prev} bucket={bucket} format="money"
            series={[{ key: "asked", label: t("rpr.s_asked"), kind: "bar", color: seriesColor(1) }, { key: "paid", label: t("rpr.s_paid_out"), kind: "line", color: STATUS_COLOR.gmv }]} />}
        </Guarded>
      </div>
      <div className="grid gap-5 lg:grid-cols-2">
        <Guarded data={data.byDriver} title={t("rpr.sec_by_driver")} testId="rk-drivers">
          {() => <RankedList testId="rk-drivers" title={t("rpr.sec_by_driver")} description={t("rpr.sec_by_driver_hint")} format="money" rows={driverRows} />}
        </Guarded>
        <Guarded data={data.breakdowns} title={t("rpr.sec_by_company")} testId="rk-companies">
          {(b) => <RankedList testId="rk-companies" title={t("rpr.sec_by_company")} description={t("rpr.sec_companies_hint")} format="money" rows={topRows(groupRows(b.company, "company", "earned", t, cityName, jobsSub))} />}
        </Guarded>
      </div>
      <Guarded data={data.breakdowns} title={t("rpr.sec_by_city")} testId="bd-city">
        {(b) => (
          <div className="grid gap-5 lg:grid-cols-2">
            <BreakdownTable testId="bd-city" title={t("rpr.sec_by_city")} format="money" rows={groupRows(b.city, "city", "earned", t, cityName, jobsSub)} />
            <DonutChart testId="bd-service" title={t("rpr.sec_by_service")} slices={groupSlices(b.service, "service", "earned", t)} format="money" centerLabel={t("rpr.s_earned")} />
          </div>
        )}
      </Guarded>
      <div className="grid gap-5 lg:grid-cols-2">
        <Guarded data={data.pipeline} title={t("rpr.sec_pipeline")} testId="chart-pipeline">
          {(p) => <FunnelChart testId="chart-pipeline" title={t("rpr.sec_pipeline")} description={t("rpr.sec_pipeline_hint")} steps={funnelOf(p.funnel, "rpr.pl_", t)} />}
        </Guarded>
        <Guarded data={data.pipeline} title={t("rpr.sec_settle_status")} testId="bd-settle-status">
          {(p) => <BreakdownTable testId="bd-settle-status" title={t("rpr.sec_settle_status")} description={t("rpr.sec_settle_status_hint")} format="money" rows={p.byStatus.map((x): BarRow => ({ key: x.key, label: t(`settle.${x.key}`), value: x.cents, sub: t("rpr.n_settlements", { n: x.n }), tone: ["failed", "rejected"].includes(x.key) ? "danger" : x.key === "paid" ? "accent" : "gold" }))} />}
        </Guarded>
      </div>
      <div className="grid gap-5 lg:grid-cols-2">
        <Guarded data={data.pipeline} title={t("rpr.sec_pay_time")} testId="chart-pay-time">
          {(p) => <HistogramChart testId="chart-pay-time" title={t("rpr.sec_pay_time")} description={t("rpr.sec_pay_time_hint")} unit={t("rpr.unit_settlements")} buckets={durationBuckets(p.payTime.histogram, t, locale)} />}
        </Guarded>
        <Guarded data={data.withdrawals} title={t("rpr.sec_withdrawals_status")} testId="bd-withdrawals">
          {(w) => <BreakdownTable testId="bd-withdrawals" title={t("rpr.sec_withdrawals_status")} format="money" rows={w.map((x): BarRow => ({ key: x.key, label: t(`status.${x.key}`), value: x.cents, sub: t("rpr.n_requests", { n: x.n }), tone: x.key === "rejected" ? "danger" : x.key === "paid" ? "accent" : "gold" }))} />}
        </Guarded>
      </div>
      <div className="grid gap-5 lg:grid-cols-2">
        <Guarded data={data.wallet} title={t("rpr.sec_wallet")} testId="card-wallet">
          {(w) => (
            <ChartCard testId="card-wallet" title={t("rpr.sec_wallet")} description={t("rpr.sec_wallet_hint")} height="auto" name={t("rpr.sec_wallet")}>
              <dl className="grid grid-cols-2 gap-3 text-sm">
                {([["available", w.available], ["held", w.held], ["pending", w.pending]] as const).map(([k, v]) => <div key={k}><dt className="text-xs text-muted">{t(`rpr.office_wallet_${k}`)}</dt><dd className="ltr-num font-semibold tabular-nums" data-testid={`wallet-${k}`}>{money(v)}</dd></div>)}
              </dl>
            </ChartCard>
          )}
        </Guarded>
        <PortalInsights title={t("rpf.sec_insights")} description={t("rpf.sec_insights_hint")} items={data.insights} cityName={cityName} />
      </div>
      <PortalDrillTable testId="drill-settlements" role="office" name="settlements" qs={view.filters.qs} />
      <PortalDrillTable testId="drill-payouts" role="office" name="payouts" qs={view.filters.qs} />
      <PortalDrillTable testId="drill-ledger" role="office" name="ledger" qs={view.filters.qs} />
    </>
  );
}
