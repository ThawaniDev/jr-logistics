"use client";
import { SERVICES } from "@/server/catalog";
import { useI18n } from "@/i18n/provider";
import { fmtDur, formatValue, seriesColor } from "../chartTheme";
import { BreakdownTable } from "../BreakdownTable";
import { DrillTable } from "../DrillTable";
import { HistogramChart } from "../HistogramChart";
import { InsightList } from "../InsightList";
import { RankedList } from "../RankedList";
import { StackedBarChart, TrendChart } from "../TrendChart";
import type { Bucket } from "../types";
import { BALANCE_SERIES, creditRows, histBuckets, kpiPick, marginPctSeries, marginRows, outlierRows, pipelineRows, refundRows, SERVICE_SERIES, topCompanyRows, waterfallBars, withdrawalRows } from "./fin-lib";
import { Block, DimSwitch, FailedNotice, KpiGroup, SectionNav } from "./parts";
import type { CityName, FinanceData } from "./types";
import { WaterfallChart } from "./Waterfall";

const SERVICE_KEYS = SERVICES.map((s) => s.key);

/** The whole finance page below the filter bar (the report needs `reports.view` and `finance.view`, so every number is visible to its viewer). */
export function FinanceBody({ data, qs, cityName }: { data: FinanceData; qs: string; cityName: CityName }) {
  const { t, locale } = useI18n();
  const comparing = data.meta.compare !== "none";
  const bucket = data.meta.bucket as Bucket;
  const { series: s, pipeline: pl, withdrawals: wd } = data;
  const g = data.kpiGroups;
  const pct = marginPctSeries(s.money.points, s.money.prev);
  const dims = (["service", "vehicle", "city"] as const).map((k) => ({ key: k, label: t(`rpd.dim_${k}`) }));
  const money = (key: string, label: string, kind: "area" | "line" | "bar", color: string) => ({ key, label, kind, color });
  const lat = pl.latency;
  // A line needs neighbours: with fewer than four daily snapshots in the period the balances are drawn as columns, so a single point is still visible.
  const sparse = s.balances.points.filter((p) => p.liability != null).length < 4;
  return (
    <>
      <FailedNotice failed={data.meta.failed} />
      <SectionNav label={t("rpd.nav_label")} items={[
        { id: "revenue", label: t("rpd.grp_revenue") }, { id: "fin-trends", label: t("rpd.sec_trends") }, { id: "fin-margin", label: t("rpd.sec_margin") }, { id: "payouts", label: t("rpd.grp_payouts") },
        { id: "fin-pipeline", label: t("rpd.sec_pipeline") }, { id: "wallets", label: t("rpd.grp_wallets") }, { id: "fin-balances", label: t("rpd.sec_balances") }, { id: "fin-companies", label: t("rpd.sec_companies") }, { id: "tables", label: t("rpd.sec_tables") },
      ]} />
      <KpiGroup id="revenue" title={t("rpd.grp_revenue")} hint={t("rpd.grp_revenue_hint")} kpis={kpiPick(data.kpis, g.revenue)} comparing={comparing} />
      <Block id="fin-trends" title={t("rpd.sec_trends")}>
        <div className="grid gap-5 lg:grid-cols-2">
          <TrendChart testId="fin-chart-money" title={t("rpd.chart_money")} description={t("rpd.chart_money_hint")} data={s.money.points} prev={s.money.prev} bucket={bucket} format="money"
            series={[money("billed", t("rpd.s_billed"), "area", seriesColor(0)), money("provider", t("rpd.s_provider"), "line", seriesColor(5)), money("margin", t("rpd.s_margin"), "line", seriesColor(4))]} />
          <TrendChart testId="fin-chart-margin-pct" title={t("rpd.chart_margin_pct")} description={t("rpd.chart_margin_pct_hint")} data={pct.data} prev={pct.prev} bucket={bucket} format="percent"
            series={[money("pct", t("rpf.kpi_margin_pct"), "line", seriesColor(4))]} />
        </div>
        <div className="grid gap-5 lg:grid-cols-2">
          <WaterfallChart testId="fin-chart-waterfall" title={t("rpd.chart_waterfall")} description={t("rpd.chart_waterfall_hint")} bars={waterfallBars(data.waterfall.cur, t)} />
          <StackedBarChart testId="fin-chart-services" title={t("rpd.chart_services")} description={t("rpd.chart_services_hint")} data={s.money.points} prev={null} bucket={bucket} format="money" series={SERVICE_SERIES(SERVICE_KEYS, t)} />
        </div>
      </Block>
      <Block id="fin-margin" title={t("rpd.sec_margin")}>
        <DimSwitch testId="fin-margin-switch" dims={dims} label={t("rpd.sec_margin")} render={(k) => (
          <BreakdownTable testId={`fin-margin-${k}`} title={t(`rpd.margin_by_${k}`)} description={t("rpd.margin_hint")} format="money" rows={marginRows(data.margins[k], t, locale, cityName)} />
        )} />
      </Block>
      <KpiGroup id="payouts" title={t("rpd.grp_payouts")} hint={t("rpd.grp_payouts_hint")} kpis={kpiPick(data.kpis, g.payouts)} comparing={comparing} />
      <Block id="fin-pipeline" title={t("rpd.sec_pipeline")}>
        <div className="grid gap-5 lg:grid-cols-2">
          <StackedBarChart testId="fin-chart-payouts" title={t("rpd.chart_payouts")} description={t("rpd.chart_payouts_hint")} data={s.money.points} prev={s.money.prev} bucket={bucket} format="money"
            series={[{ key: "office", label: t("rpd.s_office"), color: seriesColor(0) }, { key: "direct", label: t("rpd.s_direct"), color: seriesColor(1) }]} />
          <TrendChart testId="fin-chart-pipeline" title={t("rpd.chart_pipeline")} description={t("rpd.chart_pipeline_hint")} data={s.pipeline.points} prev={s.pipeline.prev} bucket={bucket}
            series={[money("created", t("rpd.s_pipe_created"), "bar", seriesColor(0)), money("paid", t("rpd.s_paid"), "line", seriesColor(4))]} />
        </div>
        <div className="grid gap-5 lg:grid-cols-2">
          <BreakdownTable testId="fin-chart-unpaid" title={t("rpd.chart_unpaid")} description={t("rpd.chart_unpaid_hint", { n: formatValue(pl.unpaid, "number", locale), held: formatValue(pl.held, "number", locale) })} rows={pipelineRows(pl.buckets, t, locale)} good="lower" />
          <HistogramChart testId="fin-chart-latency" title={t("rpd.chart_latency")} description={t("rpd.chart_latency_hint")} unit={t("rpd.unit_settlements")} buckets={histBuckets(lat.hist, "duration", t, locale)}
            stats={lat.n > 0 ? <p className="text-xs text-muted">{t("rpd.p50")}: <b className="ltr-num text-ink">{lat.p50 != null ? fmtDur(lat.p50, locale) : "—"}</b> · {t("rpd.p90")}: <b className="ltr-num text-ink">{lat.p90 != null ? fmtDur(lat.p90, locale) : "—"}</b></p> : undefined} />
        </div>
        <div className="grid gap-5 lg:grid-cols-2">
          <BreakdownTable testId="fin-chart-wd" title={t("rpd.chart_wd")} description={t("rpd.chart_wd_hint")} format="money" rows={withdrawalRows(wd.byStatus, t, locale)} />
          <HistogramChart testId="fin-chart-wd-turnaround" title={t("rpd.chart_wd_turnaround")} description={t("rpd.chart_wd_turnaround_hint")} unit={t("rpd.unit_withdrawals")} buckets={histBuckets(wd.hist, "duration", t, locale)}
            stats={wd.histN > 0 ? <p className="text-xs text-muted">{t("rpd.p50")}: <b className="ltr-num text-ink">{wd.p50 != null ? fmtDur(wd.p50, locale) : "—"}</b> · {t("rpd.p90")}: <b className="ltr-num text-ink">{wd.p90 != null ? fmtDur(wd.p90, locale) : "—"}</b></p> : undefined} />
        </div>
      </Block>
      <KpiGroup id="wallets" title={t("rpd.grp_wallets")} hint={t("rpd.grp_wallets_hint")} kpis={kpiPick(data.kpis, g.wallets)} comparing={comparing} />
      <Block id="fin-balances" title={t("rpd.sec_balances")}>
        <div className="grid gap-5 lg:grid-cols-2">
          <TrendChart testId="fin-chart-balances" title={t("rpd.chart_balances")} description={t("rpd.chart_balances_hint")} data={s.balances.points} prev={s.balances.prev} bucket={s.balances.bucket as Bucket} format="money"
            series={BALANCE_SERIES.map((k, i) => money(k, t(`rpd.s_${k}`), sparse ? "bar" : "line", seriesColor([0, 1, 3, 4][i])))} />
          <RankedList testId="fin-chart-refunds" title={t("rpd.chart_refunds")} description={t("rpd.chart_refunds_hint")} format="money" rows={refundRows(data.refunds, t)} />
        </div>
      </Block>
      <Block id="fin-companies" title={t("rpd.sec_companies")}>
        <div className="grid gap-5 lg:grid-cols-2">
          <RankedList testId="fin-rank-companies" title={t("rpd.rank_companies")} description={t("rpd.rank_companies_hint")} format="money" rows={topCompanyRows(data.companies.top, t, locale)} />
          <RankedList testId="fin-rank-credit" title={t("rpd.rank_credit")} description={t("rpd.rank_credit_hint", { n: formatValue(data.credit.facilities, "number", locale) })} format="percent" good="lower" rows={creditRows(data.credit.top, t, locale)} />
        </div>
        <div className="grid gap-5 lg:grid-cols-2">
          <RankedList testId="fin-outliers-low" title={t("rpd.rank_margin_low")} description={t("rpd.rank_margin_hint")} format="percent" rows={outlierRows(data.companies.outliers.low, t, locale)} />
          <RankedList testId="fin-outliers-high" title={t("rpd.rank_margin_high")} description={t("rpd.rank_margin_hint")} format="percent" rows={outlierRows(data.companies.outliers.high, t, locale)} />
        </div>
      </Block>
      <InsightList testId="fin-insights" title={t("rpd.sec_insights")} items={data.insights} />
      <section id="tables" aria-label={t("rpd.sec_tables")} className="scroll-mt-20 space-y-5">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-muted">{t("rpd.sec_tables")}</h2>
        <DrillTable testId="fin-drill-companies" report="finance" name="companies" qs={qs} />
        <DrillTable testId="fin-drill-settlements" report="finance" name="settlements" qs={qs} />
        <DrillTable testId="fin-drill-withdrawals" report="finance" name="withdrawals" qs={qs} />
        <DrillTable testId="fin-drill-ledger" report="finance" name="ledger" qs={qs} />
        <DrillTable testId="fin-drill-invoices" report="finance" name="invoices" qs={qs} />
      </section>
    </>
  );
}
