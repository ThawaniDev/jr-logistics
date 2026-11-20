"use client";
import { MapPinned, RefreshCw } from "lucide-react";
import { Button, Notice } from "@/components/ui";
import { useApi } from "@/components/ui/data";
import { useI18n } from "@/i18n/provider";
import type { GeographyData } from "@/server/analytics/geo-report";
import { InsightList, KpiGrid, ReportShell, useReportFilters } from "@/components/reports";
import { GeoCities } from "@/components/reports/ops/GeoCities";
import { GeoZones } from "@/components/reports/ops/GeoZones";
import { SectionHead } from "@/components/reports/ops/OpsParts";

/** Reports › Geography (decisions G2–G4): per-city deliveries, supply and demand, top routes, parcels by city over time, and delivery-point density on a map. */
export default function ReportsGeography() {
  const { t, locale } = useI18n();
  const filters = useReportFilters();
  const catalog = useApi<{ cities: Array<Record<string, string>> }>("/admin/analytics/options");
  const { data, error, mutate, isValidating } = useApi<GeographyData>(`/admin/analytics/geography?${filters.qs}`, { keepPreviousData: true });
  const cityName = (key: string) => catalog.data?.cities.find((c) => c.key === key)?.[locale];
  const retry = () => { void mutate(); };
  const failed = data?.meta.failed ?? [];
  return (
    <ReportShell title={t("rpo.geo_title")} subtitle={t("rpo.geo_subtitle")} icon={<MapPinned className="size-5" />} breadcrumbs={[{ label: t("nav.group_reports") }, { label: t("nav.rep_geography") }]}
      filters={filters} meta={data?.meta} loading={!data && !error} error={error} onRetry={retry} onRefresh={retry} refreshing={!!data && isValidating} empty={!!data?.meta.empty}
      exportHref={`/api/v1/admin/analytics/geography/table/cities?${filters.qs ? `${filters.qs}&` : ""}format=csv`}
      definitions={data?.kpis.map((k) => ({ label: k.label, definition: k.definition, numerator: k.numerator, denominator: k.denominator }))}>
      {data && (
        <>
          {failed.length > 0 && (
            <Notice tone="warn" title={t("rpo.partial_title")}>
              <span className="flex flex-wrap items-center gap-3" data-testid="geo-partial">
                <span>{t("rpo.partial_geo")}</span>
                <Button variant="secondary" size="sm" onClick={retry}><RefreshCw className="size-4" aria-hidden />{t("rpo.retry")}</Button>
              </span>
            </Notice>
          )}
          <KpiGrid kpis={data.kpis} comparing={data.meta.compare !== "none"} cols={4} />
          <InsightList testId="insights" title={t("rpf.sec_insights")} description={t("rpo.geo_insights_hint")} items={data.insights} />
          <SectionHead id="geo-sec-cities" title={t("rpo.s_geo_cities")} hint={t("rpo.s_geo_cities_hint")} />
          <GeoCities data={data} retry={retry} qs={filters.qs} cityName={cityName} />
          <SectionHead id="geo-sec-zones" title={t("rpo.s_geo_zones")} hint={t("rpo.s_geo_zones_hint")} />
          <GeoZones data={data} retry={retry} qs={filters.qs} cityName={cityName} />
        </>
      )}
    </ReportShell>
  );
}
