"use client";
import { PieChart } from "lucide-react";
import { useApi } from "@/components/ui/data";
import { useI18n } from "@/i18n/provider";
import { DrillTable, KpiGrid, ReportShell, useReportFilters } from "@/components/reports";
import { OverviewCharts } from "@/components/reports/overview/OverviewCharts";
import { OverviewPeople } from "@/components/reports/overview/OverviewPeople";
import type { OverviewData } from "@/components/reports";

/** Reports › Overview (decisions G2–G4): KPIs with change against the comparison period, trends, funnel, breakdowns, heatmap, rankings, movers, insights and the drill-down tables. */
export default function ReportsOverview() {
  const { t, locale } = useI18n();
  const filters = useReportFilters();
  const catalog = useApi<{ cities: Array<Record<string, string>> }>("/admin/analytics/options");
  const { data, error, mutate, isValidating } = useApi<OverviewData>(`/admin/analytics/overview?${filters.qs}`, { keepPreviousData: true });
  const cityName = (key: string) => catalog.data?.cities.find((c) => c.key === key)?.[locale];
  const stale = !!data && isValidating;
  return (
    <ReportShell title={t("rpf.title")} subtitle={t("rpf.subtitle")} icon={<PieChart className="size-5" />} breadcrumbs={[{ label: t("nav.group_reports") }, { label: t("nav.rep_overview") }]}
      filters={filters} meta={data?.meta} loading={!data && !error} error={error} onRetry={() => mutate()} onRefresh={() => mutate()} refreshing={stale} empty={!!data?.meta.empty}
      exportHref={`/api/v1/admin/analytics/overview/table/requests?${filters.qs ? `${filters.qs}&` : ""}format=csv`}
      definitions={data?.kpis.map((k) => ({ label: k.label, definition: k.definition, numerator: k.numerator, denominator: k.denominator }))}>
      {data && (
        <>
          <KpiGrid kpis={data.kpis} comparing={data.meta.compare !== "none"} partLabel={(k) => t(`rpf.part_${k}`)} />
          <OverviewCharts data={data} cityName={cityName} />
          <OverviewPeople data={data} cityName={cityName} />
          <DrillTable testId="drill-requests" report="overview" name="requests" qs={filters.qs} />
          {!data.meta.moneyHidden && <DrillTable testId="drill-settlements" report="overview" name="settlements" qs={filters.qs} />}
        </>
      )}
    </ReportShell>
  );
}
