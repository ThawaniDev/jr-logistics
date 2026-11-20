"use client";
import { PackageCheck } from "lucide-react";
import { useApi } from "@/components/ui/data";
import { useI18n } from "@/i18n/provider";
import { ReportShell, useReportFilters } from "@/components/reports";
import { DeliveriesBody } from "@/components/reports/fin/DeliveriesBody";
import type { DeliveriesData } from "@/components/reports/fin/types";

/** Reports › Deliveries: the parcel-level truth — flow, success, failure reasons, proof, timing, distance, who and when, with drill-down tables. */
export default function ReportsDeliveries() {
  const { t, locale } = useI18n();
  const filters = useReportFilters();
  const catalog = useApi<{ cities: Array<Record<string, string>> }>("/admin/analytics/options");
  const { data, error, mutate, isValidating } = useApi<DeliveriesData>(`/admin/analytics/deliveries?${filters.qs}`, { keepPreviousData: true });
  const cityName = (key: string) => catalog.data?.cities.find((c) => c.key === key)?.[locale];
  return (
    <ReportShell title={t("rpd.dlv_title")} subtitle={t("rpd.dlv_subtitle")} icon={<PackageCheck className="size-5" />} breadcrumbs={[{ label: t("nav.group_reports") }, { label: t("nav.rep_deliveries") }]}
      filters={filters} meta={data?.meta} loading={!data && !error} error={error} onRetry={() => mutate()} onRefresh={() => mutate()} refreshing={!!data && isValidating} empty={!!data?.meta.empty}
      exportHref={`/api/v1/admin/analytics/deliveries/table/parcels?${filters.qs ? `${filters.qs}&` : ""}format=csv`}
      definitions={data?.kpis.map((k) => ({ label: k.label, definition: k.definition, numerator: k.numerator, denominator: k.denominator }))}>
      {data && <DeliveriesBody data={data} qs={filters.qs} cityName={cityName} />}
    </ReportShell>
  );
}
