"use client";
import { Truck } from "lucide-react";
import { useApi } from "@/components/ui/data";
import { useI18n } from "@/i18n/provider";
import { ReportShell, useReportFilters } from "@/components/reports";
import { KpiGroups } from "@/components/reports/fleet/KpiGroups";
import { DRIVER_GROUPS } from "@/components/reports/fleet/kpi-groups";
import { DriversView } from "@/components/reports/people/DriversView";
import type { DriversReport } from "@/server/analytics/drivers";

/** Reports › Drivers: fleet size and availability, acceptance, speed, reliability, earnings and utilisation, the supply funnel and the drivers to review. */
export default function DriversReportPage() {
  const { t } = useI18n();
  const filters = useReportFilters();
  const { data, error, mutate, isValidating } = useApi<DriversReport>(`/admin/analytics/drivers?${filters.qs}`, { keepPreviousData: true });
  return (
    <ReportShell title={t("nav.rep_drivers")} subtitle={t("rpp.drv_subtitle")} icon={<Truck className="size-5" />} breadcrumbs={[{ label: t("nav.group_reports") }, { label: t("nav.rep_drivers") }]}
      filters={filters} meta={data?.meta} loading={!data && !error} error={error} onRetry={() => mutate()} onRefresh={() => mutate()} refreshing={!!data && isValidating} empty={!!data?.meta.empty}
      exportHref={`/api/v1/admin/analytics/drivers/table/scorecards?${filters.qs ? `${filters.qs}&` : ""}format=csv`}
      definitions={data?.kpis.map((k) => ({ label: k.label, definition: k.definition, numerator: k.numerator, denominator: k.denominator }))}>
      {data && (
        <>
          <KpiGroups kpis={data.kpis} groups={DRIVER_GROUPS} comparing={data.meta.compare !== "none"} />
          <DriversView data={data} qs={filters.qs} />
        </>
      )}
    </ReportShell>
  );
}
