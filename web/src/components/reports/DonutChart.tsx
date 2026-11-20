"use client";
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";
import { useI18n } from "@/i18n/provider";
import { formatValue, fmtMoneyCompact, fmtPercent, seriesColor, type ValueFormat } from "./chartTheme";
import { ChartCard } from "./ChartCard";

export interface Slice { key: string; label: string; value: number; color?: string }

/** Share of a total as a ring with its legend (label, value, share). `format` formats the values; zero slices are listed but not drawn. */
export function DonutChart({ title, description, slices, format = "number", centerLabel, loading, testId }: { title: string; description?: string; slices: Slice[]; format?: ValueFormat; centerLabel?: string; loading?: boolean; testId?: string }) {
  const { t, locale } = useI18n();
  const total = slices.reduce((s, x) => s + x.value, 0);
  const short = (v: number) => (format === "money" ? fmtMoneyCompact(v, locale) : formatValue(v, format, locale, true));
  const colored = slices.map((s, i) => ({ ...s, color: s.color ?? seriesColor(i) }));
  const drawn = colored.filter((s) => s.value > 0);
  const table = { columns: [{ key: "label", label: title }, { key: "value", label: t("rpf.bd_value"), end: true, render: (v: number) => <span className="ltr-num">{formatValue(v, format, locale)}</span> }, { key: "share", label: t("rpf.bd_share"), end: true, render: (v: number | null) => <span className="ltr-num">{v == null ? "—" : fmtPercent(v, locale)}</span> }],
    rows: colored.map((s) => ({ label: s.label, value: s.value, share: total > 0 ? s.value / total : null })) };
  return (
    <ChartCard title={title} description={description} height="auto" loading={loading} empty={!loading && total <= 0} table={table} name={`${title}. ${colored.map((s) => `${s.label} ${formatValue(s.value, format, locale)}`).join(", ")}`} testId={testId}>
      <div className="flex flex-col items-center gap-4 sm:flex-row">
        <div className="relative size-40 shrink-0">
          <ResponsiveContainer width="100%" height="100%" minWidth={0}>
            <PieChart>
              <Pie data={drawn} dataKey="value" nameKey="label" innerRadius="62%" outerRadius="92%" paddingAngle={drawn.length > 1 ? 2 : 0} stroke="none" isAnimationActive={false}>
                {drawn.map((s) => <Cell key={s.key} fill={s.color} />)}
              </Pie>
              <Tooltip content={(p) => {
                const d = p.payload?.[0]?.payload as (Slice & { color: string }) | undefined;
                if (!p.active || !d) return null;
                return <div className="rounded-xl border border-line bg-bg2 p-2 text-xs shadow-xl"><span className="inline-flex items-center gap-1.5"><span className="size-2 rounded-sm" style={{ background: d.color }} />{d.label}</span><div className="ltr-num mt-1 font-semibold tabular-nums">{formatValue(d.value, format, locale)} · {fmtPercent(d.value / total, locale)}</div></div>;
              }} />
            </PieChart>
          </ResponsiveContainer>
          <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center">
            <span className="ltr-num text-lg font-bold tabular-nums">{short(total)}</span>
            {centerLabel && <span className="text-[11px] text-muted">{centerLabel}</span>}
          </div>
        </div>
        <ul className="w-full min-w-0 flex-1 space-y-1.5 text-sm">
          {colored.map((s) => (
            <li key={s.key} className="flex items-center gap-2">
              <span className="size-2.5 shrink-0 rounded-sm" style={{ background: s.color }} aria-hidden />
              <span className="min-w-0 flex-1 truncate">{s.label}</span>
              <span className="ltr-num tabular-nums text-ink">{short(s.value)}</span>
              <span className="ltr-num w-12 text-end text-xs tabular-nums text-muted">{total > 0 ? fmtPercent(s.value / total, locale, 0) : "—"}</span>
            </li>
          ))}
        </ul>
      </div>
    </ChartCard>
  );
}
