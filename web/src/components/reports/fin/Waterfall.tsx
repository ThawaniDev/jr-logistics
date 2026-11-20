"use client";
import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { useI18n } from "@/i18n/provider";
import { AXIS, formatValue, seriesColor } from "../chartTheme";
import { ChartCard } from "../ChartCard";

export interface WaterfallBar { key: string; label: string; low: number; high: number; value: number; total: boolean }
const COLOR: Record<string, string> = { billed: seriesColor(0), vat: seriesColor(1), provider: seriesColor(5), net: seriesColor(4) };

/** A waterfall of money (halalas): totals start at zero, every other step floats between the running total before and after it. Built here because the framework has no waterfall. */
export function WaterfallChart({ title, description, bars, testId }: { title: string; description?: string; bars: WaterfallBar[]; testId?: string }) {
  const { t, locale, dir } = useI18n();
  const rtl = dir === "rtl";
  const rows = bars.map((b) => ({ ...b, base: b.low, span: b.high - b.low }));
  const table = { columns: [{ key: "label", label: title }, { key: "value", label: t("rpf.bd_value"), end: true, render: (v: number) => <span className="ltr-num">{formatValue(v, "money", locale)}</span> }], rows };
  return (
    <ChartCard title={title} description={description} height={260} empty={bars.every((b) => !b.value)} table={table} testId={testId} name={`${title}. ${bars.map((b) => `${b.label} ${formatValue(b.value, "money", locale)}`).join(", ")}`}>
      <ResponsiveContainer width="100%" height="100%" minWidth={0}>
        <BarChart data={rows} margin={{ top: 6, right: 6, bottom: 0, left: 0 }}>
          <CartesianGrid stroke={AXIS.stroke} strokeDasharray="3 3" vertical={false} />
          <XAxis dataKey="label" reversed={rtl} tick={AXIS.tick} tickLine={false} axisLine={{ stroke: AXIS.stroke }} interval={0} />
          <YAxis orientation={rtl ? "right" : "left"} tickFormatter={(v: number) => formatValue(v, "money", locale, true)} tick={AXIS.tick} tickLine={false} axisLine={false} width={46} />
          <Tooltip cursor={{ fill: "var(--jr-line)", fillOpacity: 0.25 }} content={(p) => {
            const d = p.payload?.[0]?.payload as (typeof rows)[number] | undefined;
            if (!p.active || !d) return null;
            return <div className="rounded-xl border border-line bg-bg2 p-2 text-xs shadow-xl"><p className="font-semibold">{d.label}</p><div className="ltr-num mt-0.5 tabular-nums">{formatValue(d.value, "money", locale)}</div></div>;
          }} />
          <Bar dataKey="base" stackId="w" fill="transparent" isAnimationActive={false} />
          <Bar dataKey="span" stackId="w" radius={[3, 3, 0, 0]} maxBarSize={56} isAnimationActive={false}>
            {rows.map((b) => <Cell key={b.key} fill={COLOR[b.key] ?? seriesColor(0)} />)}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </ChartCard>
  );
}
