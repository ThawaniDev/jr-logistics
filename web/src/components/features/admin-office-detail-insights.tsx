"use client";
import { ErrorState } from "@/components/ui";
import { useApi } from "@/components/ui/data";
import { FunnelChart, TrendChart, seriesColor } from "@/components/reports";
import { useI18n } from "@/i18n/provider";
import { KpiStrip, PeriodBar, PeriodNote, usePeriod } from "./admin-driver-common";
import { DeliveryCharts, MixCharts } from "./admin-driver-charts";

const short = (s: string, n = 14) => (Array.from(s).length > n ? `${Array.from(s).slice(0, n - 1).join("")}…` : s);

/** The performance of a courier office in one period: KPI strip with definitions and changes, deliveries and success over time, who contributes (Pareto), the offers funnel and who the office served. */
export function OfficePerformance({ id }: { id: string }) {
  const { t } = useI18n(); const [period, setPeriod] = usePeriod("30d");
  const { data: x, error, mutate } = useApi(`/admin/offices/${id}/insights?period=${period}`, { keepPreviousData: true });
  const c = x?.contribution as { rows: Array<{ id: string; name: string; value: number; share: number; cumulative: number }>; others: { count: number; value: number; share: number } | null; total: number; drivers: number; top80: number | null } | undefined;
  const rows = c ? [...c.rows.map((r) => ({ t: r.id, value: r.value, cumulative: r.cumulative })), ...(c.others ? [{ t: "others", value: c.others.value, cumulative: 1 }] : [])] : [];
  const names = new Map((c?.rows ?? []).map((r) => [r.id, r.name]));
  return (
    <section className="space-y-5" aria-label={t("dv2.performance")} data-testid="dv2-office-performance">
      <div className="space-y-1.5"><PeriodBar value={period} onChange={setPeriod} />{x && <PeriodNote period={x.period} generatedAt={x.generatedAt} />}</div>
      {error && !x ? <ErrorState error={error} retry={() => mutate()} /> : (
        <>
          <KpiStrip label={t("dv2.performance")} kpis={x?.kpis} loading={!x} comparing={!!x?.period.prevFrom} cols={4} />
          {x?.moneyHidden && <p className="text-xs text-muted">{t("dv2.money_hidden")}</p>}
          {x?.utilisationTruncated && <p className="text-xs text-muted">{t("dv2.util_truncated")}</p>}
        </>
      )}
      {x && (
        <div className="grid gap-5 lg:grid-cols-2 [&>*]:min-w-0" data-testid="dv2-office-charts">
          <DeliveryCharts series={x.series} prev={x.prevSeries} bucket={x.period.bucket} testId="dv2-ofc" />
          <TrendChart testId="dv2-ofc-pareto" title={t("dv2.ch_pareto")} description={c?.top80 ? t("dv2.ch_pareto_sub", { n: c.top80, total: c.drivers }) : t("dv2.ch_pareto_none")} data={rows} format="number" rightFormat="percent"
            labelOf={(k) => (k === "others" ? t("dv2.others", { n: c?.others?.count ?? 0 }) : short(names.get(k) ?? k))}
            series={[{ key: "value", label: t("dv2.s_delivered"), kind: "bar", color: seriesColor(0) }, { key: "cumulative", label: t("dv2.s_cumulative"), kind: "line", axis: "right", color: seriesColor(1) }]} />
          <FunnelChart testId="dv2-ofc-funnel" title={t("dv2.ch_funnel")} description={t("dv2.ch_funnel_sub")} steps={x.funnel.map((f: { key: string; count: number }) => ({ key: f.key, label: t(`dv2.fn_${f.key}`), count: f.count }))} />
          <MixCharts failures={x.failures} cities={x.cities} companies={x.companies} testId="dv2-ofc" />
        </div>
      )}
    </section>
  );
}
