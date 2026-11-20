"use client";
import { Factory } from "lucide-react";
import { useApi } from "@/components/ui/data";
import { useI18n } from "@/i18n/provider";
import { KpiGrid, ReportShell, useReportFilters } from "@/components/reports";
import { CompaniesView } from "@/components/reports/people/CompaniesView";
import type { CompaniesReport } from "@/server/analytics/companies";

/** Reports › Companies: activity, retention, concentration, health and churn of the business accounts, with the leaderboard, at-risk and new-company tables. */
export default function CompaniesReportPage() {
  const { t } = useI18n();
  const filters = useReportFilters();
  const { data, error, mutate, isValidating } = useApi<CompaniesReport>(`/admin/analytics/companies?${filters.qs}`, { keepPreviousData: true });
  return (
    <ReportShell title={t("nav.rep_companies")} subtitle={t("rpp.cmp_subtitle")} icon={<Factory className="size-5" />} breadcrumbs={[{ label: t("nav.group_reports") }, { label: t("nav.rep_companies") }]}
      filters={filters} meta={data?.meta} loading={!data && !error} error={error} onRetry={() => mutate()} onRefresh={() => mutate()} refreshing={!!data && isValidating} empty={!!data?.meta.empty}
      exportHref={`/api/v1/admin/analytics/companies/table/leaderboard?${filters.qs ? `${filters.qs}&` : ""}format=csv`}
      definitions={data?.kpis.map((k) => ({ label: k.label, definition: k.definition, numerator: k.numerator, denominator: k.denominator }))}>
      {data && (
        <>
          <KpiGrid kpis={data.kpis} comparing={data.meta.compare !== "none"} partLabel={(k) => t(`rpp.part_${k}`)} />
          <CompaniesView data={data} qs={filters.qs} />
        </>
      )}
    </ReportShell>
  );
}
