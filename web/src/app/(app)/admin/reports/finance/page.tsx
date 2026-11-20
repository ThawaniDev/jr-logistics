"use client";
import { CircleDollarSign } from "lucide-react";
import { useApi } from "@/components/ui/data";
import { useI18n } from "@/i18n/provider";
import { ReportShell, useReportFilters } from "@/components/reports";
import { FinanceBody } from "@/components/reports/fin/FinanceBody";
import type { FinanceData } from "@/components/reports/fin/types";

/** Reports › Revenue & finance (needs reports.view AND finance.view): revenue, margin, VAT, payouts, settlements, withdrawals, wallets, receivables, per-company profitability. */
export default function ReportsFinance() {
  const { t, locale } = useI18n();
  const filters = useReportFilters();
  const catalog = useApi<{ cities: Array<Record<string, string>> }>("/admin/analytics/options");
  const { data, error, mutate, isValidating } = useApi<FinanceData>(`/admin/analytics/finance?${filters.qs}`, { keepPreviousData: true });
  const cityName = (key: string) => catalog.data?.cities.find((c) => c.key === key)?.[locale];
  return (
    <ReportShell title={t("rpd.fin_title")} subtitle={t("rpd.fin_subtitle")} icon={<CircleDollarSign className="size-5" />} breadcrumbs={[{ label: t("nav.group_reports") }, { label: t("nav.rep_finance") }]}
      filters={filters} meta={data?.meta} loading={!data && !error} error={error} onRetry={() => mutate()} onRefresh={() => mutate()} refreshing={!!data && isValidating} empty={!!data?.meta.empty}
      exportHref={`/api/v1/admin/analytics/finance/table/companies?${filters.qs ? `${filters.qs}&` : ""}format=csv`}
      definitions={data?.kpis.map((k) => ({ label: k.label, definition: k.definition, numerator: k.numerator, denominator: k.denominator }))}>
      {data && <FinanceBody data={data} qs={filters.qs} cityName={cityName} />}
    </ReportShell>
  );
}
