"use client";
import { Headset } from "lucide-react";
import { useApi } from "@/components/ui/data";
import { useI18n } from "@/i18n/provider";
import { ReportShell, useReportFilters } from "@/components/reports";
import { SupportCharts } from "@/components/reports/support/SupportCharts";
import { SupportKpis } from "@/components/reports/support/SupportKpis";
import { SupportPeople } from "@/components/reports/support/SupportPeople";
import { SupportQuality } from "@/components/reports/support/SupportQuality";
import { SupportTables } from "@/components/reports/support/SupportTables";
import type { SupportData } from "@/components/reports/support/support-lib";

/** Reports › Support & quality: ticket and complaint volume, speed against the SLA targets, backlog aging, workload, repeat requesters, ratings and delivery quality beside support volume. */
export default function SupportReport() {
  const { t } = useI18n();
  const filters = useReportFilters();
  const { data, error, mutate, isValidating } = useApi<SupportData>(`/admin/analytics/support?${filters.qs}`, { keepPreviousData: true });
  return (
    <ReportShell title={t("rpq.title")} subtitle={t("rpq.subtitle")} icon={<Headset className="size-5" />} breadcrumbs={[{ label: t("nav.group_reports") }, { label: t("nav.rep_support") }]}
      filters={filters} meta={data?.meta} loading={!data && !error} error={error} onRetry={() => mutate()} onRefresh={() => mutate()} refreshing={!!data && isValidating} empty={!!data?.meta.empty}
      exportHref={`/api/v1/admin/analytics/support/table/tickets?${filters.qs ? `${filters.qs}&` : ""}format=csv`}
      definitions={data?.kpis.map((k) => ({ label: k.label, definition: k.definition, numerator: k.numerator, denominator: k.denominator }))}>
      {data && (
        <>
          <SupportKpis kpis={data.kpis} targets={data.targets} comparing={data.meta.compare !== "none"} />
          <SupportCharts data={data} />
          <SupportPeople data={data} />
          <SupportQuality data={data} />
          <SupportTables qs={filters.qs} />
        </>
      )}
    </ReportShell>
  );
}
