"use client";
import { ArrowDown } from "lucide-react";
import { useI18n } from "@/i18n/provider";
import { formatValue, fmtPercent } from "./chartTheme";
import { ChartCard } from "./ChartCard";

export interface FunnelStep { key: string; label: string; count: number }

/** Conversion funnel: one bar per step (width = share of the first step) with the share kept from the previous step and how many were lost. */
export function FunnelChart({ title, description, steps, loading, testId }: { title: string; description?: string; steps: FunnelStep[]; loading?: boolean; testId?: string }) {
  const { t, locale } = useI18n();
  const top = steps[0]?.count ?? 0;
  const table = { columns: [{ key: "label", label: title }, { key: "count", label: t("rpf.bd_requests"), end: true, render: (v: number) => <span className="ltr-num">{formatValue(v, "number", locale)}</span> }, { key: "ofFirst", label: t("rpf.fn_of_first"), end: true, render: (v: number | null) => <span className="ltr-num">{v == null ? "—" : fmtPercent(v, locale)}</span> }],
    rows: steps.map((s) => ({ ...s, ofFirst: top > 0 ? s.count / top : null })) };
  return (
    <ChartCard title={title} description={description} height="auto" loading={loading} empty={!loading && top <= 0} table={table} name={`${title}. ${steps.map((s) => `${s.label} ${s.count}`).join(", ")}`} testId={testId}>
      <ol className="space-y-1">
        {steps.map((s, i) => {
          const prev = i > 0 ? steps[i - 1].count : null;
          const keep = prev ? s.count / prev : null;
          return (
            <li key={s.key}>
              {prev != null && (
                <p className="my-1 flex items-center gap-1.5 ps-1 text-[11px] text-muted"><ArrowDown className="size-3" aria-hidden />
                  {keep == null ? "—" : t("rpf.fn_step", { n: fmtPercent(keep, locale, 0) })}{prev - s.count > 0 && <> · {t("rpf.fn_drop", { n: formatValue(prev - s.count, "number", locale) })}</>}</p>
              )}
              <div className="flex items-center gap-3">
                <div className="h-9 min-w-0 flex-1 overflow-hidden rounded-lg bg-bg2">
                  <div className="flex h-full items-center rounded-lg px-3 text-sm font-medium text-accent-ink" style={{ width: `${top > 0 ? Math.max(6, (s.count / top) * 100) : 6}%`, background: `color-mix(in srgb, var(--jr-accent) ${Math.round(100 - i * 14)}%, var(--jr-cyan))` }}>
                    <span className="truncate">{s.label}</span>
                  </div>
                </div>
                <div className="w-20 shrink-0 text-end"><div className="ltr-num text-sm font-semibold tabular-nums">{formatValue(s.count, "number", locale)}</div>{top > 0 && <div className="ltr-num text-[11px] tabular-nums text-muted">{fmtPercent(s.count / top, locale, 0)}</div>}</div>
              </div>
            </li>
          );
        })}
      </ol>
    </ChartCard>
  );
}
