"use client";
import type { ReactNode } from "react";
import { Notice, Section, Segmented, Table, Td } from "@/components/ui";
import { useI18n } from "@/i18n/provider";
import { BreakdownTable } from "../BreakdownTable";
import { KpiGrid } from "../KpiGrid";
import { RankedList } from "../RankedList";
import { formatValue } from "../chartTheme";
import type { BarRow } from "../BarRows";
import type { Kpi } from "../types";
import { matrixColumns, reasonLabel } from "./fin-lib";
import type { DeliveriesData } from "./types";
import { useState } from "react";

/** A group of KPI cards under a heading (the reports show their KPIs in groups, not as one long row). */
export function KpiGroup({ id, title, hint, kpis, comparing, partLabel }: { id: string; title: string; hint?: string; kpis: Kpi[]; comparing: boolean; partLabel?: (k: string) => string }) {
  if (!kpis.length) return null;
  return (
    <section id={id} aria-label={title} data-testid={`group-${id}`} className="space-y-3 scroll-mt-20">
      <div><h2 className="text-sm font-semibold uppercase tracking-wider text-muted">{title}</h2>{hint && <p className="mt-0.5 text-xs text-muted">{hint}</p>}</div>
      <KpiGrid kpis={kpis} comparing={comparing} partLabel={partLabel} />
    </section>
  );
}

/** The sections of a report that could not be computed (a timeout, a failing query) are shown empty and listed here; everything else on the page is correct. */
export function FailedNotice({ failed }: { failed?: string[] }) {
  const { t, locale } = useI18n();
  if (!failed?.length) return null;
  return <div data-testid="report-failed"><Notice tone="warn">{t("rpd.section_failed", { n: formatValue(failed.length, "number", locale) })}</Notice></div>;
}

/** Anchor links to the sections of a long report page (the page is long on purpose: every number has its place). */
export function SectionNav({ items, label }: { items: Array<{ id: string; label: string }>; label: string }) {
  return (
    <nav aria-label={label} data-testid="section-nav" className="-mt-1 flex max-w-full gap-1.5 overflow-x-auto pb-1 print:hidden">
      {items.map((i) => <a key={i.id} href={`#${i.id}`} className="whitespace-nowrap rounded-full border border-line bg-bg2 px-3 py-1 text-xs text-muted transition hover:border-accent/60 hover:text-ink">{i.label}</a>)}
    </nav>
  );
}
/** Wraps the blocks of one topic so the section nav can link to it. */
export function Block({ id, title, children }: { id: string; title?: string; children: ReactNode }) {
  return <section id={id} aria-label={title} className="scroll-mt-20 space-y-5">{title && <h2 className="text-sm font-semibold uppercase tracking-wider text-muted">{title}</h2>}{children}</section>;
}

/** Failure reasons (top reasons + others) per city or company as a table of counts; the darker the cell, the larger its share of the row. */
export function ReasonMatrix({ title, description, rows, top, nameOf, testId }: { title: string; description?: string; rows: DeliveriesData["reasons"]["byCity"]; top: string[]; nameOf: (r: DeliveriesData["reasons"]["byCity"][number]) => string; testId?: string }) {
  const { t, locale } = useI18n();
  const cols = matrixColumns(top, rows);
  return (
    <div data-testid={testId} className="min-w-0">
      <Section title={title} description={description} flush>
        {rows.length === 0 ? <p className="p-5 text-sm text-muted">{t("rpf.no_data_chart")}</p> : (
          <Table bare dense label={title} head={[t("rpd.mx_group"), ...cols.map((c) => ({ label: reasonLabel(c, t), align: "end" as const })), { label: t("rpd.mx_total"), align: "end" as const }]}>
            {rows.map((r) => (
              <tr key={r.key}>
                <Td className="max-w-[14rem] truncate text-xs font-medium">{nameOf(r)}</Td>
                {cols.map((c) => {
                  const n = r.by[c] ?? 0;
                  return <Td key={c} num className="text-xs" label={reasonLabel(c, t)}><span className="rounded px-1.5 py-0.5" style={n > 0 ? { background: `color-mix(in srgb, var(--jr-danger) ${Math.round(12 + (n / r.total) * 60)}%, transparent)` } : undefined}>{n > 0 ? formatValue(n, "number", locale) : "—"}</span></Td>;
                })}
                <Td num className="text-xs font-semibold" label={t("rpd.mx_total")}>{formatValue(r.total, "number", locale)}</Td>
              </tr>
            ))}
          </Table>
        )}
      </Section>
    </div>
  );
}

/** One breakdown at a time (a pill switch over the dimensions) so six tables never stack up on the page. */
export function DimSwitch<K extends string>({ dims, label, render, testId, initial }: { dims: Array<{ key: K; label: string }>; label: string; render: (k: K) => ReactNode; testId: string; initial?: K }) {
  const [dim, setDim] = useState<K>(initial ?? dims[0].key);
  return (
    <div className="min-w-0 space-y-3" data-testid={testId}>
      <Segmented label={label} options={dims.map((d) => ({ key: d.key, label: d.label }))} value={dim} onChange={(k) => setDim(k as K)} />
      {render(dim)}
    </div>
  );
}
export const barTable = (title: string, rows: BarRow[], opts: { description?: string; testId?: string; ranked?: boolean; format?: "number" | "percent" | "money" | "duration"; good?: "higher" | "lower" | "neutral" } = {}) =>
  opts.ranked ? <RankedList testId={opts.testId} title={title} description={opts.description} rows={rows} format={opts.format} good={opts.good} /> : <BreakdownTable testId={opts.testId} title={title} description={opts.description} rows={rows} format={opts.format} good={opts.good} />;
