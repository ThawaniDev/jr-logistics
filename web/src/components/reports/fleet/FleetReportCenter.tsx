"use client";
import { ErrorState, Notice } from "@/components/ui";
import { useApi, useUrlState } from "@/components/ui/data";
import { hasPerm, useUser } from "@/components/layout/auth-context";
import { cn } from "@/lib/cn";
import { useI18n } from "@/i18n/provider";
import type { Kpi } from "@/server/analytics/kpi";
import { chartVars } from "../chartTheme";
import { PartialNotice } from "../people/PeopleParts";
import { NoData } from "../ReportShell";
import type { ReportMeta } from "../types";
import { useReportFilters } from "../useReportFilters";
import { entityQs, isDailyView, kpiPath, MAX_DAILY_DAYS, pageSizeOf, resolveView, tableFor, tooLong, viewsFor, type FleetScope, type PeriodLike } from "./fleet-lib";
import { FleetNotes } from "./FleetNotes";
import { FleetTable } from "./FleetTable";
import { DRIVER_GROUPS, HIDE_FOR_ENTITY, OFFICE_GROUPS, PORTAL_GROUPS } from "./kpi-groups";
import { KpiGroups } from "./KpiGroups";
import { PeriodBar } from "./PeriodBar";
import { Pills } from "./Pills";
import { useDownload } from "./useDownload";
import { WorkbookButton } from "./WorkbookButton";

interface KpiResponse { meta: ReportMeta & { ignored?: string[]; failed?: string[] }; kpis: Kpi[]; partial?: string[] }
const GROUPS = { office: OFFICE_GROUPS, driver: DRIVER_GROUPS, portal: PORTAL_GROUPS } as const;

/**
 * The fleet report centre (decisions I7 / I8, memory/FLEET_REPORTS.md): for ONE courier office or driver (back office) or the signed-in office (portal) — a period bar with a
 * comparison, a KPI strip, a switch between the views (`?view=`: Daily, Drivers, Money, Money by day, Jobs, Earnings, Failures), every view being a registered drill-down table
 * with a Download menu, a "How to read this" disclosure, and the workbook of the whole entity. Money views need `finance.view` (the owner of the portal sees their own);
 * downloads need `reports.export` (the owner may always export their own data). Needs a <Suspense> boundary above it (the period and the view live in the URL).
 */
export function FleetReportCenter({ scope }: { scope: FleetScope }) {
  const { t } = useI18n();
  const me = useUser();
  const f = useReportFilters();
  const portal = scope.kind === "portal";
  const caps = { finance: portal || hasPerm(me, "finance.view") };
  const canExport = portal || hasPerm(me, "reports.export");
  const [rawView, setView] = useUrlState("view", "daily");
  const view = resolveView(rawView, scope.kind, caps);
  const period: PeriodLike = { preset: f.preset, from: f.from, to: f.to, compare: f.compare };
  const qs = entityQs(scope, period);
  const kpis = useApi<KpiResponse>(kpiPath(scope, qs), { keepPreviousData: true });
  const dl = useDownload();
  const tref = tableFor(scope.kind, view);
  const meta = kpis.data?.meta;
  const long = tooLong(f.days) && isDailyView(view);
  return (
    <div className="space-y-5" style={chartVars} data-testid="fr-center" data-kind={scope.kind} data-view={view}>
      <PeriodBar f={f} actions={<WorkbookButton scope={scope} period={period} canExport={canExport} dl={dl} />} />
      {meta?.moneyHidden && <Notice tone="info">{t("rpf.money_hidden")}</Notice>}
      {kpis.data?.partial && <PartialNotice keys={kpis.data.partial} />}
      {(meta?.failed?.length ?? 0) > 0 && <Notice tone="warn"><span data-testid="fr-partial">{t("rpr.partial_failed")}</span></Notice>}
      <div data-testid="fr-kpis" className={cn("transition-opacity", kpis.isValidating && kpis.data && "opacity-60")}>
        {kpis.error && !kpis.data ? <ErrorState error={kpis.error} retry={() => kpis.mutate()} />
          : meta?.empty ? <NoData onReset={f.dirty ? f.reset : undefined} />
          : <KpiGroups kpis={kpis.data?.kpis} groups={GROUPS[scope.kind]} hide={scope.kind === "portal" ? undefined : HIDE_FOR_ENTITY[scope.kind]} comparing={!!meta && meta.compare !== "none"} loading={!kpis.data} />}
      </div>
      <section aria-label={t("fr.views")} data-testid="fr-views" className="min-w-0 space-y-3">
        <Pills label={t("fr.views")} value={view} onChange={setView} testId="fr-view-switch" options={viewsFor(scope.kind, caps).map((v) => ({ key: v, label: t(`fr.view_${v}`), testId: `fr-view-${v}` }))} />
        <p className="text-xs text-muted" data-testid="fr-view-hint">{t(`fr.hint_${view}`)}</p>
        {long ? <Notice tone="warn"><span data-testid="fr-too-long">{t("fr.too_long", { n: MAX_DAILY_DAYS })}</span></Notice>
          : <FleetTable key={view} tref={tref} qs={qs} canExport={canExport} dl={dl} pageSize={pageSizeOf(view)} testId={`fr-table-${view}`} fileBase={`${scope.kind}-${view}`} />}
        {!long && <FleetNotes tref={tref} qs={qs} />}
      </section>
    </div>
  );
}
