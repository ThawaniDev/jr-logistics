"use client";
import { Children, type ReactNode } from "react";
import Link from "next/link";
import { Notice } from "@/components/ui";
import { useI18n } from "@/i18n/provider";
import { cn } from "@/lib/cn";
import { ChangePill } from "../Delta";
import { ChartCard } from "../ChartCard";
import { fmtPercent, formatValue, type ValueFormat } from "../chartTheme";
import { TrendChart } from "../TrendChart";
import { heat, monthLabel, paretoPoints, retention } from "./people-lib";

export interface ParetoRowIn { id: string; name: string; value: number; share: number | null; cumulative: number | null }

/** Top-10 concentration: one bar per company (largest first) and the running share of the total as a line on the right axis. The tooltip names the company. */
export function ParetoChart({ title, description, rows, format, valueLabel, testId }: { title: string; description?: string; rows: ParetoRowIn[]; format: ValueFormat; valueLabel: string; testId?: string }) {
  const { t } = useI18n();
  const name = (k: string, long: boolean) => (long ? `${k}. ${rows[Number(k) - 1]?.name ?? ""}` : k);
  return (
    <TrendChart testId={testId} title={title} description={description} data={paretoPoints(rows)} format={format} rightFormat="percent" labelOf={name}
      series={[{ key: "value", label: valueLabel, kind: "bar" }, { key: "cumulative", label: t("rpp.pareto_cumulative"), kind: "line", axis: "right", format: "percent" }]} />
  );
}

export interface CohortData { rows: Array<{ cohort: string; size: number; cells: Array<number | null> }>; maxK: number }
/** Retention matrix: signup month × months since signup; each cell is the share of that cohort that was still ordering. Colour strength follows the share, the number is always printed. */
export function CohortTable({ title, description, cohorts, testId }: { title: string; description?: string; cohorts: CohortData; testId?: string }) {
  const { t, locale } = useI18n();
  const empty = cohorts.rows.every((r) => r.size === 0);
  return (
    <ChartCard testId={testId} title={title} description={description} height="auto" empty={empty} name={title}>
      <div className="overflow-x-auto">
        <table className="w-full border-separate border-spacing-[3px] text-xs" aria-label={title}>
          <thead>
            <tr className="text-muted">
              <th scope="col" className="whitespace-nowrap pe-2 text-start font-medium">{t("rpp.cohort_month")}</th>
              <th scope="col" className="px-1 text-end font-medium">{t("rpp.cohort_size")}</th>
              {Array.from({ length: cohorts.maxK + 1 }, (_, k) => <th key={k} scope="col" className="ltr-num min-w-9 px-0.5 text-center font-medium tabular-nums" title={t("rpp.cohort_k", { n: k })}>{k}</th>)}
            </tr>
          </thead>
          <tbody>
            {cohorts.rows.map((r) => (
              <tr key={r.cohort}>
                <th scope="row" className="ltr-num whitespace-nowrap pe-2 text-start font-medium">{monthLabel(r.cohort, locale)}</th>
                <td className="ltr-num px-1 text-end tabular-nums text-muted">{formatValue(r.size, "number", locale)}</td>
                {r.cells.map((n, k) => {
                  const v = retention(n, r.size);
                  return (
                    <td key={k} title={v == null ? t("rpp.cohort_pending") : t("rpp.cohort_cell", { n: formatValue(n, "number", locale), size: formatValue(r.size, "number", locale), pct: fmtPercent(v, locale, 0) })}
                      className={cn("ltr-num rounded-md px-0.5 py-1 text-center tabular-nums", v == null && "text-muted/50")}
                      style={v == null ? { background: "color-mix(in srgb, var(--jr-line) 25%, transparent)" } : { background: `color-mix(in srgb, var(--jr-accent) calc(${Math.round(heat(v) * 70)}% * var(--jr-heat-cap)), transparent)` }}>
                      {v == null ? "·" : fmtPercent(v, locale, 0)}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-3 text-xs text-muted">{t("rpp.cohort_note")}</p>
    </ChartCard>
  );
}

export interface MoverIn { id: string; name: string; cur: number; prev: number }
function MoverList({ items, format, href, label }: { items: MoverIn[]; format: ValueFormat; href?: (m: MoverIn) => string; label?: (m: MoverIn) => ReactNode }) {
  const { t, locale } = useI18n();
  if (!items.length) return <p className="text-sm text-muted">{t("rpf.mv_none")}</p>;
  return (
    <ol className="space-y-2.5">
      {items.map((m) => (
        <li key={m.id} className="flex items-center gap-3 text-sm">
          <span className="min-w-0 flex-1 truncate font-medium">{href ? <Link href={href(m)} className="text-accent hover:underline">{label ? label(m) : m.name}</Link> : label ? label(m) : m.name}</span>
          <span className="ltr-num shrink-0 text-xs tabular-nums text-muted">{formatValue(m.prev, format, locale, true)} → <span className="font-semibold text-ink">{formatValue(m.cur, format, locale, true)}</span></span>
          <ChangePill value={m.cur} prev={m.prev} />
        </li>
      ))}
    </ol>
  );
}
/** The biggest increases and decreases between the period and its comparison (growth leaders and decliners). `movers` is null without a comparison. */
export function MoverCard({ title, description, movers, format, href, testId }: { title: string; description?: string; movers: { up: MoverIn[]; down: MoverIn[] } | null; format: ValueFormat; href?: (m: MoverIn) => string; testId?: string }) {
  const { t } = useI18n();
  return (
    <ChartCard testId={testId} title={title} description={description} height="auto" name={title}>
      {!movers ? <p className="text-sm text-muted">{t("rpf.mv_need_compare")}</p> : (
        <div className="grid gap-5 sm:grid-cols-2">
          {(["up", "down"] as const).map((dir) => (
            <div key={dir}><p className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted">{t(`rpf.mv_${dir}`)}</p><MoverList items={movers[dir]} format={format} href={href} /></div>
          ))}
        </div>
      )}
    </ChartCard>
  );
}

/** A card with free content (formulas, thresholds, notes) in the same frame as the charts. */
export function NoteCard({ title, description, children, testId }: { title: string; description?: string; children: ReactNode; testId?: string }) {
  return <ChartCard testId={testId} title={title} description={description} height="auto" name={title}>{children}</ChartCard>;
}

/** Two charts side by side on desktop; a single child (a section the viewer may not see is missing) takes the full width. Stacks on phones. */
export function Row({ children }: { children: ReactNode }) {
  const kids = Children.toArray(children).filter(Boolean);
  if (!kids.length) return null;
  return <div className={cn("grid gap-5", kids.length > 1 && "lg:grid-cols-2")}>{kids.map((k, i) => <div key={i} className="min-w-0">{k}</div>)}</div>;
}

/**
 * A banded matrix of counts (rows × columns, e.g. drivers by acceptance band × completion band). Cell colour strength follows the share of the largest cell; the count is always printed.
 * `rowLabels` / `colLabels` are the band names; `cellTitle` explains a cell for hover and assistive technology.
 */
export function BandMatrix({ title, description, cells, rowLabels, colLabels, rowTitle, colTitle, cellTitle, unit, testId }: {
  title: string; description?: string; cells: number[][]; rowLabels: string[]; colLabels: string[]; rowTitle: string; colTitle: string; cellTitle: (n: number, row: string, col: string) => string; unit: string; testId?: string;
}) {
  const { locale } = useI18n();
  const max = Math.max(0, ...cells.flat()), total = cells.flat().reduce((s, n) => s + n, 0);
  const table = { columns: [{ key: "row", label: rowTitle }, ...colLabels.map((c, i) => ({ key: `c${i}`, label: c, end: true, render: (v: number) => <span className="ltr-num">{formatValue(v, "number", locale)}</span> }))],
    rows: cells.map((r, i) => ({ row: rowLabels[i], ...Object.fromEntries(r.map((n, j) => [`c${j}`, n])) })) };
  return (
    <ChartCard testId={testId} title={title} description={description} height="auto" empty={total <= 0} table={table} name={`${title}. ${unit}`}>
      <div className="grid gap-1 text-xs" style={{ gridTemplateColumns: `minmax(3.25rem, auto) repeat(${colLabels.length}, minmax(0, 1fr))` }}>
        <span aria-hidden />
        <span className="text-center text-[11px] font-semibold uppercase tracking-wider text-muted" style={{ gridColumn: `span ${colLabels.length}` }}>{colTitle}</span>
        <span className="self-end text-[11px] font-semibold uppercase tracking-wider text-muted">{rowTitle}</span>
        {colLabels.map((c) => <span key={c} className="ltr-num self-end text-center text-[10px] font-medium leading-tight text-muted">{c}</span>)}
        {cells.map((row, i) => (
          <div key={i} className="contents">
            <span className="ltr-num self-center pe-1 text-[11px] font-medium leading-tight text-muted">{rowLabels[i]}</span>
            {row.map((n, j) => (
              <div key={j} title={cellTitle(n, rowLabels[i], colLabels[j])} className="flex h-11 items-center justify-center rounded-md font-semibold tabular-nums sm:h-14"
                style={{ background: n > 0 && max > 0 ? `color-mix(in srgb, var(--jr-accent) calc(${Math.round(12 + (n / max) * 70)}% * var(--jr-heat-cap)), transparent)` : "color-mix(in srgb, var(--jr-line) 35%, transparent)" }}>
                <span className="ltr-num">{n > 0 ? formatValue(n, "number", locale) : "·"}</span>
              </div>
            ))}
          </div>
        ))}
      </div>
    </ChartCard>
  );
}

/** A small label / value table inside a card (active accounts by type, fleet counts …). `rows` are `[label, ...values]` with the header in `head`. */
export function MiniTable({ title, description, head, rows, testId }: { title: string; description?: string; head: string[]; rows: Array<Array<ReactNode>>; testId?: string }) {
  return (
    <ChartCard testId={testId} title={title} description={description} height="auto" name={title}>
      <div className="overflow-x-auto">
        <table className="w-full text-sm" aria-label={title}>
          <thead><tr className="text-xs text-muted">{head.map((h, i) => <th key={i} scope="col" className={cn("pb-2 font-medium", i === 0 ? "text-start" : "text-end")}>{h}</th>)}</tr></thead>
          <tbody>{rows.map((r, i) => <tr key={i} className="border-t border-line">{r.map((c, j) => j === 0 ? <th key={j} scope="row" className="py-2 text-start font-medium">{c}</th> : <td key={j} className="ltr-num py-2 text-end tabular-nums">{c}</td>)}</tr>)}</tbody>
        </table>
      </div>
    </ChartCard>
  );
}

/** Says which sections of the report could not be computed right now (they are shown empty); nothing when everything worked. `keys` are the i18n keys of the section titles. */
export function PartialNotice({ keys }: { keys: string[] }) {
  const { t } = useI18n();
  if (!keys.length) return null;
  return <div data-testid="report-partial"><Notice tone="warn">{t("rpp.partial", { sections: [...new Set(keys)].map((k) => t(k)).join(" · ") })}</Notice></div>;
}
