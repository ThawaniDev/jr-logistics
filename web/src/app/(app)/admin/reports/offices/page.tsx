"use client";
import { Building2 } from "lucide-react";
import { useApi } from "@/components/ui/data";
import { useI18n } from "@/i18n/provider";
import { ReportShell, useReportFilters } from "@/components/reports";
import { KpiGroups } from "@/components/reports/fleet/KpiGroups";
import { OFFICE_GROUPS } from "@/components/reports/fleet/kpi-groups";
import { OfficesView } from "@/components/reports/people/OfficesView";
import type { OfficesReport } from "@/server/analytics/offices";

/** Reports › Courier offices: fleets, work, quality, earnings and payouts, agreements, turnover, the best and worst offices and — with an office filter — its drivers. */
export default function OfficesReportPage() {
  const { t } = useI18n();
  const filters = useReportFilters();
  const { data, error, mutate, isValidating } = useApi<OfficesReport>(`/admin/analytics/offices?${filters.qs}`, { keepPreviousData: true });
  return (
    <ReportShell title={t("nav.rep_offices")} subtitle={t("rpp.off_subtitle")} icon={<Building2 className="size-5" />} breadcrumbs={[{ label: t("nav.group_reports") }, { label: t("nav.rep_offices") }]}
      filters={filters} meta={data?.meta} loading={!data && !error} error={error} onRetry={() => mutate()} onRefresh={() => mutate()} refreshing={!!data && isValidating} empty={!!data?.meta.empty}
      exportHref={`/api/v1/admin/analytics/offices/table/scorecards?${filters.qs ? `${filters.qs}&` : ""}format=csv`}
      definitions={data?.kpis.map((k) => ({ label: k.label, definition: k.definition, numerator: k.numerator, denominator: k.denominator }))}>
      {data && (
        <>
          <KpiGroups kpis={data.kpis} groups={OFFICE_GROUPS} comparing={data.meta.compare !== "none"} />
          <OfficesView data={data} qs={filters.qs} officeFilter={filters.values.office.length > 0} />
        </>
      )}
    </ReportShell>
  );
}
