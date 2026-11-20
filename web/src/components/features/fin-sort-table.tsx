"use client";
import type { ReactNode } from "react";
import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react";
import { cn } from "@/lib/cn";
import { useI18n } from "@/i18n/provider";

/**
 * A table whose headers sort (shared by Finance › Drivers and the company cash table). Same look and phone behaviour as `<Table>` from the UI kit (`stack` turns every row into a card; give
 * each `<Td>` a `label`), but a header with `sortable` is a button that reports `onSort(key)` and carries `aria-sort`. A `foot` row (totals) is rendered as the last row of the body's `<tfoot>`.
 */
export interface SortCol { key: string; label: string; align?: "start" | "end"; sortable?: boolean; className?: string; srOnly?: boolean }
export interface SortState { key: string; dir: "asc" | "desc" }
const ALIGN = { start: "text-start", end: "text-end" } as const;

export function SortTable({ cols, sort, onSort, children, foot, label, toolbar, footer, empty, stack = true, dense, testId }: {
  cols: SortCol[]; sort: SortState; onSort: (key: string) => void; children: ReactNode; foot?: ReactNode; label?: string; toolbar?: ReactNode; footer?: ReactNode; empty?: ReactNode; stack?: boolean; dense?: boolean; testId?: string;
}) {
  const { t } = useI18n();
  return (
    <div className={cn("overflow-hidden rounded-card border border-line bg-card", stack && "jr-stack", dense && "jr-dense sm:[&_td]:px-3 sm:[&_th]:px-3")} data-testid={testId}>
      {toolbar && <div className="flex flex-wrap items-center gap-2.5 border-b border-line px-4 py-3">{toolbar}</div>}
      <div className="overflow-x-auto" tabIndex={0} role="region" aria-label={label}>
        <table className="w-full min-w-[640px] text-sm">
          <thead className="bg-bg2/70 text-[11px] font-semibold uppercase tracking-wider text-muted">
            <tr>
              {cols.map((c) => {
                const on = sort.key === c.key;
                return (
                  <th key={c.key} scope="col" aria-sort={on ? (sort.dir === "asc" ? "ascending" : "descending") : c.sortable ? "none" : undefined} className={cn("px-4 py-2.5 align-bottom", ALIGN[c.align ?? "start"], c.className)}>
                    {c.srOnly ? <span className="sr-only">{c.label}</span> : c.sortable ? (
                      <button type="button" onClick={() => onSort(c.key)} data-testid={`sort-${c.key}`} title={t("fdr.sort_by", { col: c.label })}
                        className={cn("jr-tap rounded uppercase tracking-wider hover:text-ink focus-visible:text-ink", on && "text-ink", c.align === "end" ? "text-end" : "text-start")}>
                        {c.label}
                        {on ? (sort.dir === "asc" ? <ArrowUp className="ms-1 inline size-3.5 align-text-bottom" aria-hidden /> : <ArrowDown className="ms-1 inline size-3.5 align-text-bottom" aria-hidden />) : <ArrowUpDown className="ms-1 inline size-3.5 align-text-bottom opacity-40" aria-hidden />}
                      </button>
                    ) : c.label}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody className="divide-y divide-line/70 [&>tr]:transition-colors [&>tr:hover]:bg-bg2/50">{children}</tbody>
          {foot && <tfoot className="border-t-2 border-line bg-bg2/50 font-semibold max-sm:hidden">{foot}</tfoot>}
        </table>
      </div>
      {empty}
      {footer && <div className="border-t border-line px-4 py-3">{footer}</div>}
    </div>
  );
}

/** Pill switch (two or three views of the same data) with a test id per option — `<Segmented>` of the kit has none. */
export function ViewToggle({ options, value, onChange, label, testId }: { options: Array<{ key: string; label: string; icon?: ReactNode }>; value: string; onChange: (k: string) => void; label: string; testId?: string }) {
  return (
    <div role="group" aria-label={label} className="inline-flex max-w-full gap-1 overflow-x-auto rounded-xl border border-line bg-bg2 p-1" data-testid={testId}>
      {options.map((o) => (
        <button key={o.key} type="button" aria-pressed={value === o.key} onClick={() => onChange(o.key)} data-testid={testId ? `${testId}-${o.key}` : undefined}
          className={cn("jr-tap inline-flex items-center gap-1.5 whitespace-nowrap rounded-lg px-3 py-1.5 text-sm transition", value === o.key ? "bg-card font-semibold text-ink shadow-sm ring-1 ring-line" : "text-muted hover:text-ink")}>
          {o.icon}{o.label}
        </button>
      ))}
    </div>
  );
}
