"use client";
import { Coins } from "lucide-react";
import { useApi } from "@/components/ui/data";
import { useI18n } from "@/i18n/provider";
import { ReportShell, useReportFilters } from "@/components/reports";
import { CodBody } from "@/components/reports/fin/CodBody";
import type { CodData } from "@/components/reports/fin/types";

/** Reports › Cash on delivery: collected, received back, outstanding and aging, who holds the cash, how fast it comes back. Amounts need finance access; counts do not. */
export default function ReportsCod() {
  const { t } = useI18n();
  const filters = useReportFilters();
  const { data, error, mutate, isValidating } = useApi<CodData>(`/admin/analytics/cod?${filters.qs}`, { keepPreviousData: true });
  const canCsv = !!data && !data.meta.moneyHidden;
  return (
    <ReportShell title={t("rpd.cod_title")} subtitle={t("rpd.cod_subtitle")} icon={<Coins className="size-5" />} breadcrumbs={[{ label: t("nav.group_reports") }, { label: t("nav.rep_cod") }]}
      filters={filters} meta={data?.meta} loading={!data && !error} error={error} onRetry={() => mutate()} onRefresh={() => mutate()} refreshing={!!data && isValidating} empty={!!data?.meta.empty}
      exportHref={canCsv ? `/api/v1/admin/analytics/cod/table/outstanding?${filters.qs ? `${filters.qs}&` : ""}format=csv` : undefined}
      definitions={data?.kpis.map((k) => ({ label: k.label, definition: k.definition, numerator: k.numerator, denominator: k.denominator }))}>
      {data && <CodBody data={data} qs={filters.qs} />}
    </ReportShell>
  );
}
