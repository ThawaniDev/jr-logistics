"use client";
import { useMemo } from "react";
import { useSearchParams } from "next/navigation";
import { Database } from "lucide-react";
import { useApi } from "@/components/ui/data";
import { useI18n } from "@/i18n/provider";
import { ReportShell, useReportFilters } from "@/components/reports";
import { ExportButton, SavedViews } from "@/components/reports/explorer/ExplorerActions";
import { ExplorerColumns } from "@/components/reports/explorer/ExplorerColumns";
import { ExplorerControls } from "@/components/reports/explorer/ExplorerControls";
import { ExplorerFilters } from "@/components/reports/explorer/ExplorerFilters";
import { ExplorerGroupPanel, ExplorerGroupResult } from "@/components/reports/explorer/ExplorerGroup";
import { ExplorerResults } from "@/components/reports/explorer/ExplorerResults";
import { parseState, type Catalog } from "@/components/reports/explorer/explorer-lib";

/** Reports › Data explorer: pick a dataset, filter it (the shared period and filters plus the dataset's own), choose columns, sort, group, export. Only registered datasets and columns exist (no SQL from the client). */
export default function DataExplorer() {
  const { t } = useI18n();
  const filters = useReportFilters();
  // the explorer lists rows, it never compares periods: the filter bar's summary must not claim a comparison
  const shell = useMemo(() => ({ ...filters, compare: "none" as const, prev: null }), [filters]);
  const sp = useSearchParams();
  const catalog = useApi<Catalog>("/admin/analytics/explorer/datasets");
  const state = useMemo(() => parseState(new URLSearchParams(sp.toString())), [sp]);
  const ds = catalog.data?.datasets.find((d) => d.key === state.ds) ?? catalog.data?.datasets[0];
  const known = ds && state.ds && state.ds !== ds.key;
  return (
    <ReportShell title={t("rpq.x_title")} subtitle={t("rpq.x_subtitle")} icon={<Database className="size-5" />} breadcrumbs={[{ label: t("nav.group_reports") }, { label: t("nav.rep_explorer") }]}
      filters={shell} filterKeys={ds ? [...ds.keys] : undefined} compare={false} bucket={false} loading={!catalog.data && !catalog.error} error={catalog.error} onRetry={() => catalog.mutate()}>
      {catalog.data && ds && (
        <>
          {known && <p className="text-sm text-muted" data-testid="rpq-x-unknown">{t("rpq.x_unknown_dataset")}</p>}
          <ExplorerControls catalog={catalog.data} ds={ds} state={state} />
          <div className="grid items-start gap-3 lg:grid-cols-2">
            <ExplorerFilters ds={ds} state={state} />
            <ExplorerColumns ds={ds} state={state} />
            <ExplorerGroupPanel ds={ds} state={state} />
            <SavedViews />
          </div>
          <ExportButton ds={ds} state={state} sharedQs={filters.qs} cap={catalog.data.limits.exportCap} />
          {state.group && ds.columns.some((c) => c.key === state.group.split("~")[0]) ? <ExplorerGroupResult ds={ds} state={state} sharedQs={filters.qs} /> : <ExplorerResults ds={ds} state={state} sharedQs={filters.qs} />}
        </>
      )}
    </ReportShell>
  );
}
