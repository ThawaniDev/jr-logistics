"use client";
import { useState, type ReactNode } from "react";
import { BarChart3, Table2 } from "lucide-react";
import { Button, EmptyState, Table, Td } from "@/components/ui";
import { cn } from "@/lib/cn";
import { useT } from "@/i18n/provider";
import { chartVars } from "./chartTheme";

export interface TableViewColumn { key: string; label: string; render?: (value: any, row: Record<string, any>) => ReactNode; end?: boolean }
export interface TableView { columns: TableViewColumn[]; rows: Array<Record<string, any>> }
export interface LegendItem { label: string; color: string; dashed?: boolean }

/** The row of coloured swatches under a chart. */
export function ChartLegend({ items }: { items: LegendItem[] }) {
  if (!items.length) return null;
  return (
    <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5 text-xs text-muted" aria-hidden>
      {items.map((i) => <li key={i.label} className="inline-flex items-center gap-1.5"><span className={cn("h-0 w-4 border-t-2", i.dashed ? "border-dashed" : "")} style={{ borderColor: i.color }} />{i.label}</li>)}
    </ul>
  );
}

/** A plain table of the numbers behind a chart (the accessible alternative of every chart). */
export function DataTable({ view, label }: { view: TableView; label: string }) {
  return (
    <div className="max-h-80 overflow-y-auto">
      <Table bare dense label={label} head={view.columns.map((c) => ({ label: c.label, align: c.end ? ("end" as const) : ("start" as const) }))}>
        {view.rows.map((r, i) => <tr key={i}>{view.columns.map((c) => <Td key={c.key} num={c.end} className="text-xs">{c.render ? c.render(r[c.key], r) : String(r[c.key] ?? "—")}</Td>)}</tr>)}
      </Table>
    </div>
  );
}

/**
 * The frame of every chart: title, optional description and actions, the "view as table" toggle (when `table` is given), loading skeleton and the
 * "No data for this selection" state. The chart itself is exposed to assistive technology as one image named by `name` (default: the title); the table view
 * is its accessible alternative. `height="auto"` lets the content size itself (donuts, lists).
 */
export function ChartCard({ title, description, actions, children, table, height = 260, loading, empty, name, legend, className, testId }: {
  title: string; description?: ReactNode; actions?: ReactNode; children: ReactNode; table?: TableView; height?: number | "auto"; loading?: boolean; empty?: boolean; name?: string; legend?: LegendItem[]; className?: string; testId?: string;
}) {
  const t = useT();
  const [asTable, setAsTable] = useState(false);
  const h = height === "auto" ? undefined : height;
  return (
    <section aria-label={title} data-testid={testId} style={chartVars} className={cn("min-w-0 rounded-card border border-line bg-card", className)}>
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-3 sm:px-5">
        <div className="min-w-0"><h2 className="font-semibold">{title}</h2>{description && <p className="mt-0.5 text-xs text-muted">{description}</p>}</div>
        <div className="flex items-center gap-1.5 print:hidden">
          {actions}
          {table && !empty && !loading && <Button variant="ghost" size="sm" aria-pressed={asTable} onClick={() => setAsTable((v) => !v)} data-testid={testId ? `${testId}-toggle` : undefined}>{asTable ? <BarChart3 className="size-4" aria-hidden /> : <Table2 className="size-4" aria-hidden />}{asTable ? t("rpf.view_chart") : t("rpf.view_table")}</Button>}
        </div>
      </div>
      <div className="p-4 sm:p-5">
        {loading ? <div className="w-full animate-pulse rounded-xl bg-line/50" style={{ height: h ?? 160 }} /> : empty ? <EmptyState title={t("rpf.no_data")} hint={t("rpf.no_data_chart")} /> : asTable && table ? <DataTable view={table} label={title} /> : (
          <>
            <div role="img" aria-label={name ?? title} style={h ? { height: h } : undefined} className="min-w-0">{children}</div>
            {legend && <ChartLegend items={legend} />}
          </>
        )}
      </div>
    </section>
  );
}
