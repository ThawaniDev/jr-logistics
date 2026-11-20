"use client";
import { Suspense, type ReactNode } from "react";
import { Notice, PageLoading } from "@/components/ui";
import { useApi } from "@/components/ui/data";
import { useI18n } from "@/i18n/provider";
import type { Kpi } from "@/server/analytics/kpi";
import type { MultiKey } from "@/server/analytics/keys";
import { ReportShell, useReportFilters, type ReportFilterState } from "@/components/reports";
import type { PortalMeta, PortalRole } from "./types";

/** What every section of a portal report gets: the filters, the city names of Settings (custom cities) and whether a comparison period is on. */
export interface PortalView { role: PortalRole; filters: ReportFilterState; cityName: (key: string) => string | undefined; comparing: boolean }

/** The filters each portal offers (the server drops every other ownership filter, see `analytics/portal-scope.ts`). */
export const PORTAL_FILTER_KEYS: Record<PortalRole, MultiKey[]> = { business: ["city", "service", "vehicle", "status", "channel"], office: ["city", "service", "vehicle", "driver"] };

export function PortalSuspense({ children }: { children: ReactNode }) { return <Suspense fallback={<PageLoading />}>{children}</Suspense>; }

/**
 * The frame of one portal report page: reads the shared filters from the URL, loads `GET /<role>/analytics/<report>` with them (keeping the previous data on screen while
 * a new selection loads), and renders the shared `ReportShell` pointed at the portal's own options endpoint and with CSV for the owner (`csvTable` = the drill-down table the
 * header button exports). `children(data, view)` draws the sections; a section the server could not compute arrives as `null` (see `Guarded`).
 */
export function PortalReport<T extends { meta: PortalMeta; kpis: Kpi[] }>({ role, report, title, subtitle, icon, crumb, csvTable, legendKey, children }: {
  role: PortalRole; report: string; title: string; subtitle: string; icon: ReactNode; crumb: string; csvTable: string; legendKey: string; children: (data: T, view: PortalView) => ReactNode;
}) {
  const { t, locale } = useI18n();
  const filters = useReportFilters();
  const optionsUrl = `/${role}/analytics/options`;
  const catalog = useApi<{ cities: Array<Record<string, string>> }>(optionsUrl);
  const { data, error, mutate, isValidating } = useApi<T>(`/${role}/analytics/${report}?${filters.qs}`, { keepPreviousData: true });
  const view: PortalView = { role, filters, comparing: !!data && data.meta.compare !== "none", cityName: (key) => catalog.data?.cities.find((c) => c.key === key)?.[locale] };
  return (
    <ReportShell title={title} subtitle={subtitle} icon={icon} breadcrumbs={[{ label: t("nav.group_reports") }, { label: t(crumb) }]} filters={filters} filterKeys={PORTAL_FILTER_KEYS[role]}
      meta={data?.meta} loading={!data && !error} error={error} onRetry={() => mutate()} onRefresh={() => mutate()} refreshing={!!data && isValidating} empty={!!data?.meta.empty}
      exportHref={`/api/v1/${role}/analytics/table/${csvTable}?${filters.qs ? `${filters.qs}&` : ""}format=csv`} optionsUrl={optionsUrl} ownerExport legendKey={legendKey}
      definitions={data?.kpis.map((k) => ({ label: k.label, definition: k.definition, numerator: k.numerator, denominator: k.denominator }))}>
      {data && (
        <>
          {(data.meta.ignored?.length ?? 0) > 0 && <Notice tone="info">{t("rpr.ignored_filters", { filters: data.meta.ignored!.map((k) => t(`rpf.f_${k}`)).join(", ") })}</Notice>}
          {(data.meta.failed?.length ?? 0) > 0 && <Notice tone="warn"><span data-testid="portal-partial">{t("rpr.partial_failed")}</span></Notice>}
          {children(data, view)}
        </>
      )}
    </ReportShell>
  );
}
