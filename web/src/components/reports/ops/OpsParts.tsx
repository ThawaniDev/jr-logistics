"use client";
import type { ReactNode } from "react";
import { AlertTriangle, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui";
import { useI18n } from "@/i18n/provider";
import { ChangePill } from "../Delta";
import { ChartCard } from "../ChartCard";
import { formatValue, type ValueFormat } from "../chartTheme";

/** The frame of one section of a long report page: an anchor target, a title with a one-line hint, and the section's cards. */
export function SectionHead({ id, title, hint, actions }: { id: string; title: string; hint?: string; actions?: ReactNode }) {
  return (
    <div id={id} data-testid={id} className="flex scroll-mt-24 flex-wrap items-end justify-between gap-2 border-b border-line pb-2 pt-4">
      <div className="min-w-0"><h2 className="text-lg font-semibold">{title}</h2>{hint && <p className="mt-0.5 max-w-3xl text-sm text-muted">{hint}</p>}</div>
      {actions && <div className="flex items-center gap-2 print:hidden">{actions}</div>}
    </div>
  );
}

/** What a card shows when the query behind it failed: the page keeps working, this card says so and offers a retry. */
export function CardFailed({ title, onRetry, testId }: { title: string; onRetry?: () => void; testId?: string }) {
  const { t } = useI18n();
  return (
    <section aria-label={title} data-testid={testId ? `${testId}-failed` : "card-failed"} role="alert" className="flex min-w-0 flex-col justify-center gap-2 rounded-card border border-danger/40 bg-card p-4 sm:p-5">
      <h2 className="font-semibold">{title}</h2>
      <p className="flex items-start gap-2 text-sm text-muted"><AlertTriangle className="mt-0.5 size-4 shrink-0 text-danger" aria-hidden />{t("rpo.section_failed")}</p>
      {onRetry && <div><Button variant="secondary" size="sm" onClick={onRetry}><RefreshCw className="size-4" aria-hidden />{t("rpo.retry")}</Button></div>}
    </section>
  );
}

export interface StatLine { key: string; label: string; cur: number | null; prev?: number | null; format: ValueFormat; good?: "higher" | "lower" | "neutral"; sub?: string }
/**
 * A card of figures (median, p90, counts …) with the previous value and the change against the comparison period: for the numbers that have no chart of their own.
 * A list, not a table, so it stays readable in a narrow column and on phones.
 */
export function StatTable({ title, description, lines, testId }: { title: string; description?: string; lines: StatLine[]; testId?: string }) {
  const { t, locale } = useI18n();
  return (
    <ChartCard title={title} description={description} height="auto" empty={lines.every((l) => l.cur == null)} testId={testId}>
      <ul aria-label={title} className="divide-y divide-line/70">
        {lines.map((l) => (
          <li key={l.key} className="flex items-start justify-between gap-3 py-2.5 first:pt-0 last:pb-0" data-testid="stat-line">
            <div className="min-w-0"><p className="text-sm font-medium">{l.label}</p>{l.sub && <p className="text-xs text-muted">{l.sub}</p>}</div>
            <div className="shrink-0 text-end">
              <p className="ltr-num text-sm font-semibold tabular-nums">{formatValue(l.cur, l.format, locale)}</p>
              {l.prev != null && <p className="mt-0.5 flex flex-wrap items-center justify-end gap-x-1.5 text-xs text-muted"><span className="ltr-num">{t("rpf.vs_prev", { value: formatValue(l.prev, l.format, locale) })}</span><ChangePill value={l.cur} prev={l.prev} good={l.good ?? "neutral"} /></p>}
            </div>
          </li>
        ))}
      </ul>
    </ChartCard>
  );
}
