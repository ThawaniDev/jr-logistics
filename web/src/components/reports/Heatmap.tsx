"use client";
import { useI18n } from "@/i18n/provider";
import { formatValue } from "./chartTheme";
import { ChartCard } from "./ChartCard";

/**
 * Weekday × hour intensity grid (Riyadh time, Sunday first). `cells[weekday][hour]` with weekday 0 = Sunday; intensity is relative to the largest cell.
 * Cells are labelled for assistive technology through the table view and the chart's summary.
 */
export function Heatmap({ title, description, cells, unit, loading, testId }: { title: string; description?: string; cells: number[][]; unit: string; loading?: boolean; testId?: string }) {
  const { t, locale, dir } = useI18n();
  const max = Math.max(0, ...cells.flat());
  const total = cells.flat().reduce((s, n) => s + n, 0);
  let peak = { d: 0, h: 0, n: -1 };
  cells.forEach((r, d) => r.forEach((n, h) => { if (n > peak.n) peak = { d, h, n }; }));
  const hh = (h: number) => `${String(h).padStart(2, "0")}:00`;
  const table = { columns: [{ key: "day", label: t("rpf.hm_day") }, { key: "total", label: unit, end: true, render: (v: number) => <span className="ltr-num">{formatValue(v, "number", locale)}</span> }, { key: "peak", label: t("rpf.hm_peak_hour"), end: true, render: (v: string) => <span className="ltr-num">{v}</span> }],
    rows: cells.map((r, d) => { const n = Math.max(...r); return { day: t(`rpf.wd_${d}`), total: r.reduce((s, x) => s + x, 0), peak: n > 0 ? hh(r.indexOf(n)) : "—" }; }) };
  return (
    <ChartCard title={title} description={description} height="auto" loading={loading} empty={!loading && total <= 0} table={table} testId={testId}
      name={`${title}. ${t("rpf.hm_busiest", { day: t(`rpf.wd_${peak.d}`), hour: hh(peak.h), n: peak.n })}`}>
      <div className="grid gap-y-[3px] text-[10px] text-muted" style={{ gridTemplateColumns: "2.25rem repeat(24, minmax(0, 1fr))", columnGap: 2 }}>
        <span aria-hidden />
        {Array.from({ length: 24 }, (_, h) => <span key={h} className="ltr-num text-center tabular-nums" aria-hidden>{h % 3 === 0 ? h : ""}</span>)}
        {cells.map((row, d) => (
          <div key={d} className="contents">
            <span className="flex items-center pe-1 text-[10px] leading-none" aria-hidden>{t(`rpf.wds_${d}`)}</span>
            {row.map((n, h) => (
              <span key={h} title={t("rpf.hm_cell", { day: t(`rpf.wd_${d}`), hour: hh(h), n: formatValue(n, "number", locale) })} className="h-4 rounded-[3px] sm:h-5"
                style={{ background: n > 0 && max > 0 ? `color-mix(in srgb, var(--jr-accent) ${Math.round(14 + (n / max) * 86)}%, transparent)` : "color-mix(in srgb, var(--jr-line) 45%, transparent)" }} />
            ))}
          </div>
        ))}
      </div>
      <div className="mt-3 flex items-center gap-2 text-[11px] text-muted" aria-hidden>
        <span>{t("rpf.hm_less")}</span>
        <span className="h-2 w-24 rounded-full" style={{ background: `linear-gradient(to ${dir === "rtl" ? "left" : "right"}, color-mix(in srgb, var(--jr-accent) 14%, transparent), var(--jr-accent))` }} />
        <span>{t("rpf.hm_more")}</span>
        {peak.n > 0 && <span className="ms-auto">{t("rpf.hm_busiest", { day: t(`rpf.wd_${peak.d}`), hour: hh(peak.h), n: formatValue(peak.n, "number", locale) })}</span>}
      </div>
    </ChartCard>
  );
}
