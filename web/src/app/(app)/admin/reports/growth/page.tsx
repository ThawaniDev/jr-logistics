"use client";
import { TrendingUp } from "lucide-react";
import { useApi } from "@/components/ui/data";
import { useI18n } from "@/i18n/provider";
import { KpiGrid, ReportShell, useReportFilters } from "@/components/reports";
import { GrowthView } from "@/components/reports/people/GrowthView";
import type { GrowthReport } from "@/server/analytics/growth";

/** Reports › Growth & onboarding: signups, verification funnel and speed, document rejections, activation, sign-in activity, the verification backlog and stalled onboardings. Only the city filter narrows it. */
export default function GrowthReportPage() {
  const { t } = useI18n();
  const filters = useReportFilters();
  const { data, error, mutate, isValidating } = useApi<GrowthReport>(`/admin/analytics/growth?${filters.qs}`, { keepPreviousData: true });
  return (
    <ReportShell title={t("nav.rep_growth")} subtitle={t("rpp.gro_subtitle")} icon={<TrendingUp className="size-5" />} breadcrumbs={[{ label: t("nav.group_reports") }, { label: t("nav.rep_growth") }]}
      filters={filters} filterKeys={["city"]} meta={data?.meta} loading={!data && !error} error={error} onRetry={() => mutate()} onRefresh={() => mutate()} refreshing={!!data && isValidating} empty={!!data?.meta.empty}
      exportHref={`/api/v1/admin/analytics/growth/table/signups?${filters.qs ? `${filters.qs}&` : ""}format=csv`}
      definitions={data?.kpis.map((k) => ({ label: k.label, definition: k.definition, numerator: k.numerator, denominator: k.denominator }))}>
      {data && (
        <>
          <KpiGrid kpis={data.kpis} comparing={data.meta.compare !== "none"} partLabel={(k) => t(`rpp.part_${k}`)} cols={4} count={12} />
          <GrowthView data={data} qs={filters.qs} />
        </>
      )}
    </ReportShell>
  );
}
