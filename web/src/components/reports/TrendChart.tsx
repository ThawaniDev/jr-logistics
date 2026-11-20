"use client";
import { Area, Bar, CartesianGrid, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { useI18n } from "@/i18n/provider";
import { AXIS, bucketLabel, formatValue, seriesColor, type ValueFormat } from "./chartTheme";
import { ChartCard, type TableView } from "./ChartCard";
import type { Bucket } from "./types";

export interface TrendSeries { key: string; label: string; kind?: "line" | "area" | "bar"; color?: string; axis?: "left" | "right"; format?: ValueFormat }
export type TrendPoint = { t: string } & Record<string, number | string | null>;

/**
 * Time series: lines, areas and bars on one chart (`kind` per series), one or two value axes, an optional comparison overlay (`prev`: the previous period's points,
 * matched to `data` by POSITION, drawn dashed in the series' colour), `stacked` bars, tooltips and a "view as table" toggle. `bucket` formats the x labels in the user's
 * language and calendar; for a non-time x axis pass `labelOf`. Mirrors itself in right-to-left languages.
 */
export function TrendChart({ title, description, data, prev, series, bucket, format = "number", rightFormat, stacked, height = 260, loading, labelOf, actions, testId }: {
  title: string; description?: string; data: TrendPoint[]; prev?: TrendPoint[] | null; series: TrendSeries[]; bucket?: Bucket; format?: ValueFormat; rightFormat?: ValueFormat;
  stacked?: boolean; height?: number; loading?: boolean; labelOf?: (t: string, long: boolean) => string; actions?: React.ReactNode; testId?: string;
}) {
  const { t, locale, dir } = useI18n();
  const rtl = dir === "rtl";
  const label = (k: string, long = false) => (labelOf ? labelOf(k, long) : bucket ? bucketLabel(k, bucket, locale, long) : k);
  const fmtOf = (s: TrendSeries): ValueFormat => s.format ?? (s.axis === "right" ? rightFormat ?? format : format);
  const rows = data.map((p, i) => {
    const r: Record<string, number | string | null> = { ...p };
    const q = prev?.[i];
    if (q) { r.__prevT = q.t; for (const s of series) r[`${s.key}__prev`] = q[s.key] ?? null; if (stacked) r.__prevSum = series.reduce((n, s) => n + (Number(q[s.key]) || 0), 0); }
    return r;
  });
  const color = (i: number) => series[i].color ?? seriesColor(i);
  const hasRight = series.some((s) => s.axis === "right");
  const hasPrev = !!prev?.length;
  const empty = !loading && data.every((p) => series.every((s) => !Number(p[s.key])));
  const table: TableView = {
    columns: [{ key: "t", label: t("common.date"), render: (v) => label(String(v), true) }, ...series.map((s) => ({ key: s.key, label: s.label, end: true, render: (v: number) => <span className="ltr-num">{formatValue(v, fmtOf(s), locale)}</span> })),
      ...(hasPrev ? (stacked ? [{ key: "__prevSum", label: t("rpf.prev_total"), end: true, render: (v: number) => <span className="ltr-num">{formatValue(v, format, locale)}</span> }] : series.map((s) => ({ key: `${s.key}__prev`, label: `${s.label} · ${t("rpf.prev_period")}`, end: true, render: (v: number) => <span className="ltr-num">{formatValue(v, fmtOf(s), locale)}</span> }))) : [])],
    rows,
  };
  const legend = [...series.map((s, i) => ({ label: s.label, color: color(i) })), ...(hasPrev ? [{ label: t("rpf.prev_period"), color: "var(--jr-muted)", dashed: true }] : [])];
  return (
    <ChartCard title={title} description={description} height={height} loading={loading} empty={empty} table={table} legend={legend} actions={actions} testId={testId}
      name={`${title}. ${series.map((s) => s.label).join(", ")}`}>
      <ResponsiveContainer width="100%" height="100%" minWidth={0}>
        <ComposedChart data={rows} margin={{ top: 6, right: 6, bottom: 0, left: 0 }}>
          <CartesianGrid stroke={AXIS.stroke} strokeDasharray="3 3" vertical={false} />
          <XAxis dataKey="t" reversed={rtl} tickFormatter={(v: string) => label(v)} tick={AXIS.tick} tickLine={false} axisLine={{ stroke: AXIS.stroke }} minTickGap={28} interval="preserveStartEnd" />
          <YAxis yAxisId="l" orientation={rtl ? "right" : "left"} tickFormatter={(v: number) => formatValue(v, format, locale, true)} tick={AXIS.tick} tickLine={false} axisLine={false} width={46} allowDecimals={format === "percent" || format === "rate"} />
          {hasRight && <YAxis yAxisId="r" orientation={rtl ? "left" : "right"} tickFormatter={(v: number) => formatValue(v, rightFormat ?? format, locale, true)} tick={AXIS.tick} tickLine={false} axisLine={false} width={46} />}
          <Tooltip cursor={{ stroke: AXIS.stroke }} content={(p) => {
            const row = p.payload?.[0]?.payload as Record<string, number | string | null> | undefined;
            if (!p.active || !row) return null;
            return (
              <div className="min-w-40 rounded-xl border border-line bg-bg2 p-2.5 text-xs shadow-xl" dir={dir}>
                <p className="mb-1.5 font-semibold text-ink">{label(String(row.t), true)}</p>
                {series.map((s, i) => (
                  <div key={s.key} className="flex items-center justify-between gap-4 py-0.5">
                    <span className="inline-flex items-center gap-1.5 text-muted"><span className="size-2 rounded-sm" style={{ background: color(i) }} />{s.label}</span>
                    <span className="ltr-num font-medium tabular-nums text-ink">{formatValue(row[s.key] as number, fmtOf(s), locale)}</span>
                  </div>
                ))}
                {hasPrev && row.__prevT != null && (
                  <div className="mt-1.5 border-t border-line pt-1.5 text-muted">
                    <p className="mb-0.5">{t("rpf.prev_period")} · {label(String(row.__prevT), true)}</p>
                    {stacked ? <div className="flex justify-between gap-4"><span>{t("rpf.prev_total")}</span><span className="ltr-num tabular-nums">{formatValue(row.__prevSum as number, format, locale)}</span></div>
                      : series.map((s) => <div key={s.key} className="flex justify-between gap-4"><span>{s.label}</span><span className="ltr-num tabular-nums">{formatValue(row[`${s.key}__prev`] as number, fmtOf(s), locale)}</span></div>)}
                  </div>
                )}
              </div>
            );
          }} />
          {series.map((s, i) => {
            const common = { yAxisId: s.axis === "right" ? "r" : "l", dataKey: s.key, isAnimationActive: false } as const;
            if (s.kind === "bar") return <Bar key={s.key} {...common} fill={color(i)} stackId={stacked ? "s" : undefined} maxBarSize={28} radius={stacked ? 0 : [3, 3, 0, 0]} />;
            if (s.kind === "area") return <Area key={s.key} {...common} type="linear" stroke={color(i)} fill={color(i)} fillOpacity={0.14} strokeWidth={2} dot={false} activeDot={{ r: 4 }} />;
            return <Line key={s.key} {...common} type="linear" stroke={color(i)} strokeWidth={2} dot={data.length <= 2} activeDot={{ r: 4 }} />;
          })}
          {hasPrev && stacked && <Line yAxisId="l" dataKey="__prevSum" type="linear" stroke="var(--jr-muted)" strokeWidth={1.5} strokeDasharray="5 4" dot={false} activeDot={false} isAnimationActive={false} legendType="none" />}
          {hasPrev && !stacked && series.map((s, i) => <Line key={`${s.key}__prev`} yAxisId={s.axis === "right" ? "r" : "l"} dataKey={`${s.key}__prev`} type="linear" stroke={color(i)} strokeOpacity={0.6} strokeWidth={1.5} strokeDasharray="5 4" dot={false} activeDot={false} isAnimationActive={false} legendType="none" />)}
        </ComposedChart>
      </ResponsiveContainer>
    </ChartCard>
  );
}

/** Stacked columns per bucket (requests by outcome, parcels by outcome …): a TrendChart with every series a stacked bar. */
export function StackedBarChart({ series, ...p }: Omit<Parameters<typeof TrendChart>[0], "stacked">) {
  return <TrendChart {...p} stacked series={series.map((s) => ({ ...s, kind: "bar" as const }))} />;
}
