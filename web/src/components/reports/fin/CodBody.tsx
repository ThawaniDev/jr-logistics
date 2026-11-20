"use client";
import { useI18n } from "@/i18n/provider";
import { fmtDur, formatValue, seriesColor } from "../chartTheme";
import { BreakdownTable } from "../BreakdownTable";
import { DonutChart } from "../DonutChart";
import { DrillTable } from "../DrillTable";
import { HistogramChart } from "../HistogramChart";
import { InsightList } from "../InsightList";
import { RankedList } from "../RankedList";
import { StackedBarChart, TrendChart } from "../TrendChart";
import type { Bucket } from "../types";
import { ageRows, histBuckets, holderRows, kpiPick, wrapSub } from "./fin-lib";
import { Block, DimSwitch, FailedNotice, KpiGroup, SectionNav } from "./parts";
import type { CodData } from "./types";

/** The whole cash-on-delivery page below the filter bar. Viewers without finance access get the parcel and order counts only (no amounts, holders or alert list). */
export function CodBody({ data, qs }: { data: CodData; qs: string }) {
  const { t, locale } = useI18n();
  const money = !data.meta.moneyHidden;
  const comparing = data.meta.compare !== "none";
  const bucket = data.meta.bucket as Bucket;
  const g = data.kpiGroups, cash = data.series.cash, lag = data.lag;
  const holderDims = (["driver", "office", "company"] as const).map((k) => ({ key: k, label: t(`rpd.holder_${k}`) }));
  const base = { driver: "/admin/drivers/", office: "/admin/offices/", company: "/admin/companies/" } as const;
  const received = [{ key: "business", label: t("rpd.recv_business"), value: data.received.business.n }, { key: "staff", label: t("rpd.recv_staff"), value: data.received.staff.n }];
  return (
    <>
      <FailedNotice failed={data.meta.failed} />
      <SectionNav label={t("rpd.nav_label")} items={[
        ...(money ? [{ id: "cash", label: t("rpd.grp_cash") }] : []), { id: "cod-parcels", label: t("rpd.grp_cod_parcels") }, { id: "cod-trends", label: t("rpd.sec_trends") }, { id: "cod-aging", label: t("rpd.sec_aging") },
        ...(money ? [{ id: "cod-holders", label: t("rpd.sec_holders") }] : []), { id: "cod-remit", label: t("rpd.sec_remit") }, ...(money ? [{ id: "tables", label: t("rpd.sec_tables") }] : []),
      ]} />
      <KpiGroup id="cash" title={t("rpd.grp_cash")} hint={t("rpd.grp_cash_hint")} kpis={kpiPick(data.kpis, g.cash)} comparing={comparing} />
      <KpiGroup id="cod-parcels" title={t("rpd.grp_cod_parcels")} hint={t("rpd.grp_cod_parcels_hint")} kpis={kpiPick(data.kpis, g.parcels)} comparing={comparing} />
      <Block id="cod-trends" title={t("rpd.sec_trends")}>
        <div className="grid gap-5 lg:grid-cols-2">
          {cash && (
            <TrendChart testId="cod-chart-cash" title={t("rpd.chart_cash")} description={t("rpd.chart_cash_hint")} data={cash.points} prev={cash.prev} bucket={bucket} format="money"
              series={[{ key: "collected", label: t("rpd.s_collected"), kind: "bar", color: seriesColor(0) }, { key: "remitted", label: t("rpd.s_remitted"), kind: "bar", color: seriesColor(4) }, { key: "outstanding", label: t("rpd.s_outstanding"), kind: "line", color: seriesColor(3) }]} />
          )}
          <StackedBarChart testId="cod-chart-mix" title={t("rpd.chart_mix")} description={t("rpd.chart_mix_hint")} data={data.series.mix.points} prev={data.series.mix.prev} bucket={bucket}
            series={[{ key: "cod", label: t("rpd.s_cod"), color: seriesColor(1) }, { key: "prepaid", label: t("rpd.s_prepaid"), color: seriesColor(0) }]} />
        </div>
      </Block>
      <Block id="cod-aging" title={t("rpd.sec_aging")}>
        <div className="grid gap-5 lg:grid-cols-2">
          <BreakdownTable testId="cod-chart-aging" title={t("rpd.chart_aging")} description={t("rpd.chart_aging_hint")} rows={ageRows(data.aging, t, locale)} good="lower" />
          {data.alerts && (
            <RankedList testId="cod-alerts" title={t("rpd.chart_alerts")} description={t("rpd.chart_alerts_hint")} format="money" good="lower"
              rows={data.alerts.map((a) => ({ key: a.offerId, label: a.ref, value: a.outstanding, href: `/admin/requests/${a.requestId}`, tone: "danger" as const, sub: wrapSub(t("rpd.alert_sub", { driver: a.driver ?? "—", company: a.company ?? "—", days: formatValue(Math.floor(a.ageDays), "number", locale) })) }))} />
          )}
        </div>
      </Block>
      {data.holders && (
        <Block id="cod-holders" title={t("rpd.sec_holders")}>
          <DimSwitch testId="cod-holders-switch" dims={holderDims} label={t("rpd.sec_holders")} render={(k) => (
            <RankedList testId={`cod-holders-${k}`} title={t(`rpd.holders_${k}`)} description={t("rpd.holders_hint")} format="money" good="lower" rows={holderRows(data.holders![k], base[k], locale, t)} />
          )} />
        </Block>
      )}
      <Block id="cod-remit" title={t("rpd.sec_remit")}>
        <div className="grid gap-5 lg:grid-cols-2">
          <HistogramChart testId="cod-chart-lag" title={t("rpd.chart_lag")} description={t("rpd.chart_lag_hint")} unit={t("rpd.unit_receipts")} buckets={histBuckets(lag.hist, "duration", t, locale)}
            stats={lag.histN > 0 ? <p className="text-xs text-muted">{t("rpd.p50")}: <b className="ltr-num text-ink">{lag.p50 != null ? fmtDur(lag.p50, locale) : "—"}</b> · {t("rpd.p90")}: <b className="ltr-num text-ink">{lag.p90 != null ? fmtDur(lag.p90, locale) : "—"}</b></p> : undefined} />
          <DonutChart testId="cod-chart-received" title={t("rpd.chart_received")} description={t("rpd.chart_received_hint")} slices={received} centerLabel={t("rpd.unit_receipts")} />
        </div>
        <RankedList testId="cod-slowest" title={t("rpd.chart_slowest")} description={t("rpd.chart_slowest_hint")} format="duration" good="lower"
          rows={data.slowest.map((s) => ({ key: s.id, label: s.name ?? `${s.id.slice(0, 8)}…`, value: s.avgSecs, href: `/admin/drivers/${s.id}`, sub: t("rpd.slowest_sub", { n: formatValue(s.remittances, "number", locale) }) }))} />
      </Block>
      <InsightList testId="cod-insights" title={t("rpd.sec_insights")} items={data.insights} />
      {money && (
        <section id="tables" aria-label={t("rpd.sec_tables")} className="scroll-mt-20 space-y-5">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-muted">{t("rpd.sec_tables")}</h2>
          <DrillTable testId="cod-drill-outstanding" report="cod" name="outstanding" qs={qs} />
          <DrillTable testId="cod-drill-remittances" report="cod" name="remittances" qs={qs} />
          <DrillTable testId="cod-drill-collected" report="cod" name="collected" qs={qs} />
        </section>
      )}
    </>
  );
}
