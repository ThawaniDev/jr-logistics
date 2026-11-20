"use client";
import type { ReactNode } from "react";
import { Download, Printer, RefreshCw } from "lucide-react";
import { Button, EmptyState, ErrorState, Notice, PageHeader, Skeleton, StatGrid } from "@/components/ui";
import { hasPerm, useUser } from "@/components/layout/auth-context";
import { cn } from "@/lib/cn";
import { useI18n } from "@/i18n/provider";
import { fmtDateTime } from "@/lib/format";
import { ApiError } from "@/lib/api";
import type { MultiKey } from "@/server/analytics/keys";
import { chartVars } from "./chartTheme";
import { ReportFilters } from "./ReportFilters";
import type { ReportMeta } from "./types";
import type { ReportFilterState } from "./useReportFilters";

/** What the legend explains: i18n keys of a KPI (the same `label` / `definition` / `numerator` / `denominator` a `Kpi` object carries). */
export interface DefinitionItem { label: string; definition: string; numerator?: string; denominator?: string }

export function NoData({ onReset }: { onReset?: () => void }) {
  const { t } = useI18n();
  return <EmptyState title={t("rpf.no_data")} hint={t("rpf.no_data_hint")} action={onReset ? <Button variant="secondary" onClick={onReset}>{t("rpf.f_reset")}</Button> : undefined} />;
}
function ReportSkeleton() {
  return (
    <div className="space-y-5" aria-busy="true" role="status">
      <StatGrid cols={4}>{Array.from({ length: 8 }, (_, i) => <div key={i} className="rounded-card border border-line bg-card p-4"><Skeleton className="h-3 w-24" /><Skeleton className="mt-3 h-7 w-20" /><Skeleton className="mt-3 h-4 w-14" /></div>)}</StatGrid>
      <div className="grid gap-4 lg:grid-cols-2"><Skeleton className="h-72" /><Skeleton className="h-72" /></div>
    </div>
  );
}

/**
 * The frame of every report page: header (title, refresh, print, CSV), the filter bar, then — depending on the request — a skeleton, an error with retry, the
 * "No data for this selection" state or your `children`; below them "Updated at" and the definitions legend (G8). Wrap the page in <Suspense> (the filters read the URL).
 * Pass `meta` (the response's `meta`), `loading` (no response yet), `error`, `empty` (the response says there is nothing), `refreshing` (revalidating with the old data on screen).
 * `exportHref` is the CSV URL (shown only to staff with `reports.export`).
 */
export function ReportShell({ title, subtitle, icon, breadcrumbs, filters, filterKeys, compare, bucket, meta, loading, error, onRetry, onRefresh, refreshing, empty, exportHref, definitions, actions, optionsUrl, ownerExport, legendKey, children }: {
  title: string; subtitle?: string; icon?: ReactNode; breadcrumbs?: Array<{ label: string; href?: string }>; filters: ReportFilterState; filterKeys?: MultiKey[]; compare?: boolean; bucket?: boolean;
  meta?: ReportMeta | null; loading?: boolean; error?: unknown; onRetry?: () => void; onRefresh?: () => void; refreshing?: boolean; empty?: boolean; exportHref?: string; definitions?: DefinitionItem[]; actions?: ReactNode; children?: ReactNode;
  /** Portals: the owner's own filter options endpoint (default: the admin one). */
  optionsUrl?: string;
  /** Portals: the owner may export CSV of their own data (no staff permission needed). */
  ownerExport?: boolean;
  /** Portals: i18n key of the filter legend (default: the admin one). */
  legendKey?: string;
}) {
  const { t, locale } = useI18n();
  const me = useUser();
  const timeout = error instanceof ApiError && error.details?.reason === "timeout";
  return (
    <div style={chartVars} data-testid="report-shell" data-report={title}>
      <PageHeader title={title} subtitle={subtitle} icon={icon} breadcrumbs={breadcrumbs} actions={<>
        {actions}
        {onRefresh && <Button variant="secondary" size="sm" onClick={onRefresh} data-testid="report-refresh" className="print:hidden"><RefreshCw className={cn("size-4", refreshing && "animate-spin")} aria-hidden />{t("rpf.refresh")}</Button>}
        <Button variant="secondary" size="sm" onClick={() => window.print()} data-testid="report-print" className="print:hidden"><Printer className="size-4" aria-hidden />{t("rpf.print")}</Button>
        {exportHref && (ownerExport || hasPerm(me, "reports.export")) && <a href={exportHref} download data-testid="report-csv" className="inline-flex h-8 items-center justify-center gap-2 whitespace-nowrap rounded-xl border border-line bg-bg2 px-3 text-xs text-ink transition hover:border-accent/60 hover:bg-card pointer-coarse:h-10 print:hidden"><Download className="size-4" aria-hidden />{t("rpf.export_csv")}</a>}
      </>} />
      <ReportFilters filters={filters} keys={filterKeys} compare={compare} bucket={bucket} optionsUrl={optionsUrl} />
      {meta?.moneyHidden && <div className="mb-5"><Notice tone="info">{t("rpf.money_hidden")}</Notice></div>}
      {error ? <ErrorState error={error} retry={onRetry} /> : loading ? <ReportSkeleton /> : empty ? <NoData onReset={filters.dirty ? filters.reset : undefined} /> : <div className={cn("space-y-5 transition-opacity", refreshing && "opacity-60")} aria-busy={refreshing || undefined}>{children}</div>}
      {timeout && <p className="mt-3 text-sm text-muted">{t("rpf.timeout_hint")}</p>}
      {error instanceof ApiError && error.code === "VALIDATION" && <p className="mt-3 text-sm text-muted" data-testid="report-error-detail">{Object.values(error.details).map(String).join(" · ")}</p>}
      {meta?.generatedAt && !error && !loading && (
        <p className="mt-6 text-xs text-muted" data-testid="report-updated">{t("rpf.updated", { time: fmtDateTime(meta.generatedAt, locale) })}</p>
      )}
      {definitions && definitions.length > 0 && !error && !loading && (
        <details className="mt-3 rounded-card border border-line bg-card px-4 py-3 text-sm" data-testid="report-definitions">
          <summary className="cursor-pointer select-none font-medium">{t("rpf.definitions")}</summary>
          <p className="mt-3 text-xs text-muted">{t(legendKey ?? "rpf.legend_filters")}</p>
          <dl className="mt-3 grid gap-x-8 gap-y-3 sm:grid-cols-2">
            {definitions.map((d) => (
              <div key={d.label} className="min-w-0 text-xs"><dt className="font-semibold text-ink">{t(d.label)}</dt><dd className="mt-0.5 text-muted">{t(d.definition)}{d.numerator && <><br /><span className="text-ink/80">{t("rpf.numerator")}:</span> {t(d.numerator)}</>}{d.denominator && <><br /><span className="text-ink/80">{t("rpf.denominator")}:</span> {t(d.denominator)}</>}</dd></div>
            ))}
          </dl>
        </details>
      )}
    </div>
  );
}
