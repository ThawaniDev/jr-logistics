"use client";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { useI18n } from "@/i18n/provider";
import { AXIS, formatValue, seriesColor } from "./chartTheme";
import { ChartCard } from "./ChartCard";

export interface HistogramBucket { label: string; count: number }

/** Distribution as columns (e.g. time to fill). Build the labels from your bucket edges; `unit` names what is counted ("requests"). */
export function HistogramChart({ title, description, buckets, unit, height = 220, loading, stats, testId }: { title: string; description?: string; buckets: HistogramBucket[]; unit: string; height?: number; loading?: boolean; stats?: React.ReactNode; testId?: string }) {
  const { t, locale, dir } = useI18n();
  const rtl = dir === "rtl";
  const total = buckets.reduce((s, b) => s + b.count, 0);
  const table = { columns: [{ key: "label", label: title }, { key: "count", label: unit, end: true, render: (v: number) => <span className="ltr-num">{formatValue(v, "number", locale)}</span> }, { key: "share", label: t("rpf.bd_share"), end: true, render: (v: number | null) => <span className="ltr-num">{v == null ? "—" : formatValue(v, "percent", locale)}</span> }],
    rows: buckets.map((b) => ({ ...b, share: total > 0 ? b.count / total : null })) };
  return (
    <ChartCard title={title} description={description} height={height} loading={loading} empty={!loading && total <= 0} table={table} name={`${title}. ${buckets.map((b) => `${b.label}: ${b.count}`).join(", ")}`} actions={stats} testId={testId}>
      <ResponsiveContainer width="100%" height="100%" minWidth={0}>
        <BarChart data={buckets} margin={{ top: 6, right: 6, bottom: 0, left: 0 }}>
          <CartesianGrid stroke={AXIS.stroke} strokeDasharray="3 3" vertical={false} />
          <XAxis dataKey="label" reversed={rtl} tick={AXIS.tick} tickLine={false} axisLine={{ stroke: AXIS.stroke }} interval={0} height={66} angle={-30} padding={{ left: 28, right: 28 }} textAnchor="end" />
          <YAxis orientation={rtl ? "right" : "left"} tick={AXIS.tick} tickLine={false} axisLine={false} width={34} allowDecimals={false} />
          <Tooltip cursor={{ fill: "var(--jr-line)", fillOpacity: 0.25 }} content={(p) => {
            const d = p.payload?.[0]?.payload as HistogramBucket | undefined;
            if (!p.active || !d) return null;
            return <div className="rounded-xl border border-line bg-bg2 p-2 text-xs shadow-xl"><p className="font-semibold">{d.label}</p><div className="mt-0.5 tabular-nums"><span className="ltr-num">{formatValue(d.count, "number", locale)}</span> {unit}{total > 0 && <> · <span className="ltr-num">{formatValue(d.count / total, "percent", locale)}</span></>}</div></div>;
          }} />
          <Bar dataKey="count" fill={seriesColor(4)} radius={[3, 3, 0, 0]} maxBarSize={44} isAnimationActive={false} />
        </BarChart>
      </ResponsiveContainer>
    </ChartCard>
  );
}
