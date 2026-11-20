"use client";
import { CircleDollarSign } from "lucide-react";
import { Badge, ProgressBar } from "@/components/ui";
import { useI18n } from "@/i18n/provider";
import { BreakdownTable, ChartCard, DonutChart, TrendChart } from "@/components/reports";
import { fmtPercent, formatValue, seriesColor, STATUS_COLOR } from "../../chartTheme";
import type { BarRow } from "../../BarRows";
import type { Bucket } from "../../types";
import { Guarded } from "../Guarded";
import { KpiSections } from "../KpiSections";
import { PortalDrillTable } from "../PortalDrillTable";
import { SpendTrend } from "./SpendTrend";
import { PortalInsights } from "../PortalInsights";
import { PortalReport, PortalSuspense, type PortalView } from "../PortalReport";
import type { BusinessSpendingData } from "../types";
import { groupRows, groupSlices } from "../lib";

/** Reports › Spending of the company portal: what the company is charged, the invoices, wallet movements, cash on delivery, credit use and a labelled 30-day estimate. */
export function BusinessSpending() {
  const { t } = useI18n();
  return (
    <PortalSuspense>
      <PortalReport<BusinessSpendingData> role="business" report="spending" title={t("rpr.title_spending")} subtitle={t("rpr.biz_spending_sub")} icon={<CircleDollarSign className="size-5" />} crumb="nav.rep_spending" csvTable="invoices" legendKey="rpr.legend_business">
        {(data, view) => <BusinessSpendingBody data={data} view={view} />}
      </PortalReport>
    </PortalSuspense>
  );
}

export function BusinessSpendingBody({ data, view }: { data: BusinessSpendingData; view: PortalView }) {
  const { t, locale } = useI18n();
  const bucket = data.meta.bucket as Bucket;
  const money = (n: number) => formatValue(n, "money", locale);
  const cityName = view.cityName;
  const f = data.forecast, w = data.wallet;
  const forecastFailed = !!data.meta.failed?.includes("forecast");
  const requestsSub = (r: { requests?: number }) => (r.requests ? t("rpr.n_orders", { n: r.requests }) : undefined);
  const ledgerRows: BarRow[] = (data.ledger ?? []).map((x) => ({ key: x.kind, label: t(`ledger.${x.kind}`), value: x.amount, prev: x.prevAmount, sub: t("rpr.n_entries", { n: x.n }) }));
  return (
    <>
      <KpiSections kpis={data.kpis} comparing={view.comparing} groups={[
        { id: "spend", title: t("rpr.grp_spend"), keys: ["biz_spend", "biz_orders_billed", "biz_avg_order", "biz_cost_per_parcel"] },
        { id: "invoices", title: t("rpr.grp_invoices"), keys: ["biz_invoiced", "biz_vat", "biz_topups"] },
        { id: "wallet", title: t("rpr.grp_wallet"), keys: ["biz_wallet_balance", "biz_credit_usage", "biz_forecast"] },
        { id: "cod", title: t("rpr.grp_cod"), keys: ["biz_cod_collected", "biz_cod_received", "biz_cod_outstanding"] },
      ]} />
      <div className="grid gap-5 lg:grid-cols-2">
        <SpendTrend data={data} cityName={cityName} />
        <Guarded data={data.series.price} title={t("rpr.sec_price")} testId="chart-price">
          {(s) => <TrendChart testId="chart-price" title={t("rpr.sec_price")} description={t("rpr.sec_price_hint")} data={s.points} prev={s.prev} bucket={bucket} format="money"
            series={[{ key: "price", label: t("rpr.s_price"), kind: "bar", color: STATUS_COLOR.gmv }]} />}
        </Guarded>
      </div>
      <div className="grid gap-5 lg:grid-cols-2">
        <Guarded data={data.series.wallet} title={t("rpr.sec_wallet_moves")} testId="chart-wallet">
          {(s) => <TrendChart testId="chart-wallet" title={t("rpr.sec_wallet_moves")} description={t("rpr.sec_wallet_moves_hint")} data={s.points} prev={s.prev} bucket={bucket} format="money"
            series={[{ key: "topup", label: t("ledger.topup"), kind: "bar", color: STATUS_COLOR.gmv }, { key: "charge", label: t("ledger.charge"), kind: "bar", color: seriesColor(1) }, { key: "refund", label: t("ledger.refund"), kind: "line", color: seriesColor(4) }]} />}
        </Guarded>
        <Guarded data={data.series.cod} title={t("rpr.sec_cod")} testId="chart-cod">
          {(s) => <TrendChart testId="chart-cod" title={t("rpr.sec_cod")} description={t("rpr.sec_cod_hint")} data={s.points} prev={s.prev} bucket={bucket} format="money"
            series={[{ key: "collected", label: t("rpr.s_collected"), kind: "bar", color: seriesColor(1) }, { key: "received", label: t("rpr.s_received"), kind: "line", color: STATUS_COLOR.gmv }]} />}
        </Guarded>
      </div>
      <div className="grid gap-5 lg:grid-cols-2">
        <Guarded data={w} title={t("rpr.sec_credit")} testId="card-wallet">
          {(x) => (
            <ChartCard testId="card-wallet" title={t("rpr.sec_credit")} description={t("rpr.sec_credit_hint")} height="auto" name={t("rpr.sec_credit")}>
              <dl className="grid grid-cols-2 gap-3 text-sm">
                {([["available", x.available], ["reserved", x.reserved], ["held", x.held], ["limit", x.creditLimit]] as const).map(([k, v]) => (
                  <div key={k}><dt className="text-xs text-muted">{t(`rpr.wallet_${k}`)}</dt><dd className="ltr-num font-semibold tabular-nums" data-testid={`wallet-${k}`}>{money(v)}</dd></div>
                ))}
              </dl>
              <div className="mt-4">
                {x.creditLimit > 0
                  ? <><ProgressBar value={x.creditUsed} max={x.creditLimit} tone={x.creditUsed / x.creditLimit >= 0.8 ? "danger" : "accent"} label={t("rpr.credit_used")} /><p className="mt-1.5 text-xs text-muted">{t("rpr.credit_used_of", { used: money(x.creditUsed), limit: money(x.creditLimit), pct: fmtPercent(x.creditUsed / x.creditLimit, locale, 0) })}</p></>
                  : <p className="text-xs text-muted">{t("rpr.credit_none")}</p>}
              </div>
            </ChartCard>
          )}
        </Guarded>
        {forecastFailed ? <Guarded data={null} title={t("rpr.sec_forecast")} testId="card-forecast">{() => null}</Guarded> : (
          <ChartCard testId="card-forecast" title={t("rpr.sec_forecast")} description={t("rpr.sec_forecast_hint")} height="auto" name={t("rpr.sec_forecast")} actions={<Badge tone="warn">{t("rpr.estimate")}</Badge>}>
            {f ? (
              <>
                <p className="ltr-num text-3xl font-bold tabular-nums" data-testid="forecast-total">{money(f.total)}</p>
                <p className="mt-1 text-sm text-muted">{t("rpr.forecast_next", { days: f.horizon })}</p>
                <p className="mt-3 text-xs text-muted">{t("rpr.forecast_range", { low: money(f.low), high: money(f.high) })}</p>
                <p className="mt-1 text-xs text-muted">{t("rpr.forecast_basis", { days: f.basisDays, perDay: money(f.perDay) })}</p>
              </>
            ) : <p className="text-sm text-muted" data-testid="forecast-none">{t("rpr.forecast_none")}</p>}
          </ChartCard>
        )}
      </div>
      <Guarded data={data.breakdowns} title={t("rpr.sec_spend_by")} testId="bd-service">
        {(b) => (
          <>
            <div className="grid gap-5 lg:grid-cols-2">
              <DonutChart testId="bd-service" title={t("rpf.sec_service_gmv")} slices={groupSlices(b.service, "service", "spend", t)} format="money" centerLabel={t("rpr.s_spend")} />
              <BreakdownTable testId="bd-vehicle" title={t("rpr.sec_spend_vehicle")} format="money" rows={groupRows(b.vehicle, "vehicle", "spend", t, cityName, requestsSub)} />
            </div>
            <BreakdownTable testId="bd-city" title={t("rpr.sec_spend_city")} format="money" rows={groupRows(b.city, "city", "spend", t, cityName, requestsSub)} />
          </>
        )}
      </Guarded>
      <div className="grid gap-5 lg:grid-cols-2">
        <Guarded data={data.ledger} title={t("rpr.sec_ledger_kinds")} testId="bd-ledger">
          {() => <BreakdownTable testId="bd-ledger" title={t("rpr.sec_ledger_kinds")} description={t("rpr.sec_ledger_kinds_hint")} format="money" rows={ledgerRows} />}
        </Guarded>
        <PortalInsights title={t("rpf.sec_insights")} description={t("rpf.sec_insights_hint")} items={data.insights} cityName={cityName} />
      </div>
      <PortalDrillTable testId="drill-invoices" role="business" name="invoices" qs={view.filters.qs} />
      <PortalDrillTable testId="drill-ledger" role="business" name="ledger" qs={view.filters.qs} />
      <PortalDrillTable testId="drill-cod" role="business" name="cod" qs={view.filters.qs} />
    </>
  );
}
