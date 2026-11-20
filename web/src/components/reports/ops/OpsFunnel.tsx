"use client";
import { ArrowDown } from "lucide-react";
import { useI18n } from "@/i18n/provider";
import { ChartCard } from "../ChartCard";
import { fmtPercent, formatValue } from "../chartTheme";

/** Which outcomes explain the loss between a step and the next one (offered → accepted: declined / expired; accepted → arrived: cancelled, no-show, replaced, request ended). */
const LOSS: Record<number, readonly string[]> = { 1: ["rejected", "expired"], 2: ["cancelled", "no_show", "replaced", "request_ended"] };

/**
 * The offers funnel: offered → accepted → arrived → loaded → completed. Each bar is the share of the offers sent; between two bars the share that continued, how many were lost
 * and — where the data says why — the reasons (declined, expired, cancelled, no-show, replaced, request ended).
 */
export function OpsFunnel({ title, description, steps, outcomes, testId }: { title: string; description?: string; steps: Array<{ key: string; count: number }>; outcomes: Array<{ key: string; count: number }>; testId?: string }) {
  const { t, locale } = useI18n();
  const top = steps[0]?.count ?? 0;
  const reason = (k: string) => outcomes.find((o) => o.key === k)?.count ?? 0;
  const table = { columns: [{ key: "label", label: title }, { key: "count", label: t("rpo.unit_offers"), end: true, render: (v: number) => <span className="ltr-num">{formatValue(v, "number", locale)}</span> },
    { key: "ofFirst", label: t("rpo.fn_of_first"), end: true, render: (v: number | null) => <span className="ltr-num">{v == null ? "—" : fmtPercent(v, locale)}</span> }, { key: "lost", label: t("rpo.fn_lost"), end: true, render: (v: number | null) => <span className="ltr-num">{v == null ? "—" : formatValue(v, "number", locale)}</span> }],
    rows: steps.map((s, i) => ({ label: t(`rpo.fn_${s.key}`), count: s.count, ofFirst: top > 0 ? s.count / top : null, lost: i > 0 ? steps[i - 1].count - s.count : null })) };
  return (
    <ChartCard title={title} description={description} height="auto" empty={top <= 0} table={table} testId={testId} name={`${title}. ${steps.map((s) => `${t(`rpo.fn_${s.key}`)} ${s.count}`).join(", ")}`}>
      <ol className="space-y-1">
        {steps.map((s, i) => {
          const prev = i > 0 ? steps[i - 1].count : null;
          const keep = prev ? s.count / prev : null;
          const why = (LOSS[i] ?? []).map((k) => [k, reason(k)] as const).filter(([, n]) => n > 0);
          return (
            <li key={s.key}>
              {prev != null && (
                <div className="my-1 ps-1 text-[11px] text-muted">
                  <p className="flex items-center gap-1.5"><ArrowDown className="size-3" aria-hidden />{keep == null ? "—" : t("rpf.fn_step", { n: fmtPercent(keep, locale, 0) })}{prev - s.count > 0 && <> · {t("rpf.fn_drop", { n: formatValue(prev - s.count, "number", locale) })}</>}</p>
                  {why.length > 0 && <ul className="mt-1 flex flex-wrap gap-1.5 ps-4.5">{why.map(([k, n]) => <li key={k} className="rounded-full bg-line/50 px-2 py-0.5" data-testid={`fn-why-${k}`}>{t(`rpo.out_${k}`)} <span className="ltr-num font-semibold text-ink">{formatValue(n, "number", locale)}</span></li>)}</ul>}
                </div>
              )}
              <div className="flex items-center gap-3">
                <div className="h-9 min-w-0 flex-1 overflow-hidden rounded-lg bg-bg2">
                  <div className="flex h-full items-center rounded-lg px-3 text-sm font-medium text-accent-ink" style={{ width: `${top > 0 ? Math.max(6, (s.count / top) * 100) : 6}%`, background: `color-mix(in srgb, var(--jr-accent) ${Math.round(100 - i * 14)}%, var(--jr-cyan))` }}>
                    <span className="truncate">{t(`rpo.fn_${s.key}`)}</span>
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
