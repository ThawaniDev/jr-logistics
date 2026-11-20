"use client";
import { Activity, RefreshCw } from "lucide-react";
import { Button, Notice } from "@/components/ui";
import { useApi } from "@/components/ui/data";
import { useI18n } from "@/i18n/provider";
import type { OperationsData } from "@/server/analytics/ops-report";
import { OPS_GROUPS, OPS_HEADLINE } from "@/server/analytics/ops-kinds";
import { InsightList, KpiGrid, ReportShell, useReportFilters } from "@/components/reports";
import { OpsCancellations } from "@/components/reports/ops/OpsCancellations";
import { OpsDemand } from "@/components/reports/ops/OpsDemand";
import { OpsExecution } from "@/components/reports/ops/OpsExecution";
import { OpsGroups } from "@/components/reports/ops/OpsGroups";
import { OpsOffers } from "@/components/reports/ops/OpsOffers";
import { OpsSupply } from "@/components/reports/ops/OpsSupply";
import { pickKpis, sectionFailed } from "@/components/reports/ops/ops-lib";

const NAV = [...OPS_GROUPS, "groups"] as const;

/** Reports › Operations (decisions G2–G4): demand and fill, execution, offers funnel, supply vs demand, cancellations and performance by city / service / vehicle / company. */
export default function ReportsOperations() {
  const { t, locale } = useI18n();
  const filters = useReportFilters();
  const catalog = useApi<{ cities: Array<Record<string, string>> }>("/admin/analytics/options");
  const { data, error, mutate, isValidating } = useApi<OperationsData>(`/admin/analytics/operations?${filters.qs}`, { keepPreviousData: true });
  const cityName = (key: string) => catalog.data?.cities.find((c) => c.key === key)?.[locale];
  const stale = !!data && isValidating;
  const failedSections = data ? NAV.filter((s) => sectionFailed(data.meta.failed, s)) : [];
  const retry = () => { void mutate(); };
  const props = data ? { data, retry, qs: filters.qs, cityName } : null;
  return (
    <ReportShell title={t("rpo.title")} subtitle={t("rpo.subtitle")} icon={<Activity className="size-5" />} breadcrumbs={[{ label: t("nav.group_reports") }, { label: t("nav.rep_operations") }]}
      filters={filters} meta={data?.meta} loading={!data && !error} error={error} onRetry={retry} onRefresh={retry} refreshing={stale} empty={!!data?.meta.empty}
      exportHref={`/api/v1/admin/analytics/operations/table/late-jobs?${filters.qs ? `${filters.qs}&` : ""}format=csv`}
      definitions={data?.kpis.map((k) => ({ label: k.label, definition: k.definition, numerator: k.numerator, denominator: k.denominator }))}>
      {data && props && (
        <>
          {failedSections.length > 0 && (
            <Notice tone="warn" title={t("rpo.partial_title")}>
              <span className="flex flex-wrap items-center gap-3" data-testid="ops-partial">
                <span>{t("rpo.partial", { sections: failedSections.map((s) => t(`rpo.s_${s}`)).join(", ") })}</span>
                <Button variant="secondary" size="sm" onClick={retry}><RefreshCw className="size-4" aria-hidden />{t("rpo.retry")}</Button>
              </span>
            </Notice>
          )}
          <KpiGrid kpis={pickKpis(data.kpis, OPS_HEADLINE)} comparing={data.meta.compare !== "none"} cols={4} />
          <InsightList testId="insights" title={t("rpf.sec_insights")} description={t("rpo.insights_hint")} items={data.insights} />
          <nav aria-label={t("rpo.jump")} className="flex flex-wrap gap-2 print:hidden" data-testid="ops-nav">
            {NAV.map((s) => <a key={s} href={`#ops-${s}`} className="rounded-full border border-line bg-card px-3 py-1.5 text-xs font-medium text-muted transition hover:border-accent/60 hover:text-ink">{t(`rpo.s_${s}`)}</a>)}
          </nav>
          <OpsDemand {...props} />
          <OpsExecution {...props} />
          <OpsOffers {...props} />
          <OpsSupply {...props} />
          <OpsCancellations {...props} />
          <OpsGroups {...props} />
        </>
      )}
    </ReportShell>
  );
}
