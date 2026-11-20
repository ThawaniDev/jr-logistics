"use client";
import Link from "next/link";
import { Skeleton, StatGrid } from "@/components/ui";
import { cn } from "@/lib/cn";
import { useI18n } from "@/i18n/provider";
import { verdict } from "@/server/analytics/kpi";
import { fmtMoneyCompact, fmtSignedPct, fmtSignedPp, formatValue } from "./chartTheme";
import { DeltaPill } from "./Delta";
import { InfoTip } from "./InfoTip";
import type { Kpi } from "./types";

/** A tiny trend line (one number per bucket; nulls are gaps). Decorative: the numbers are in the chart below and the table view. Mirrors in right-to-left languages. */
export function Sparkline({ values, className }: { values: Array<number | null>; className?: string }) {
  const nums = values.filter((v): v is number => v != null);
  if (nums.length < 2) return null;
  const lo = Math.min(...nums), hi = Math.max(...nums), span = hi - lo || 1;
  const W = 100, H = 28, step = W / (values.length - 1);
  let d = ""; let pen = false;
  values.forEach((v, i) => { if (v == null) { pen = false; return; } d += `${pen ? "L" : "M"}${(i * step).toFixed(2)} ${(H - 3 - ((v - lo) / span) * (H - 6)).toFixed(2)} `; pen = true; });
  return <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" aria-hidden className={cn("h-7 w-full rtl:-scale-x-100", className)}><path d={d} fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" /></svg>;
}

/**
 * One KPI: label with a definition tooltip, the value, the change against the comparison period (green = good, red = bad for THIS KPI, always with a sign), the previous value,
 * a sparkline and the filters that cannot narrow it. `null` values show "—" (no data), never 0. `comparing`: a comparison period is active.
 */
export function KpiCard({ kpi, comparing, partLabel }: { kpi: Kpi; comparing?: boolean; partLabel?: (key: string) => string }) {
  const { t, locale } = useI18n();
  const label = t(kpi.label);
  const v = kpi.value;
  const full = formatValue(v, kpi.unit, locale);
  const text = kpi.unit === "money" && v != null && Math.abs(v) >= 1_000_000 ? fmtMoneyCompact(v, locale) : full;
  const tone = verdict(kpi);
  const dir = kpi.delta == null || kpi.delta === 0 ? "flat" : kpi.delta > 0 ? "up" : "down";
  const pill = kpi.delta == null ? (comparing ? <span title={t("rpf.no_prev")}><DeltaPill tone="flat" dir="flat">—</DeltaPill></span> : null)
    : <DeltaPill tone={tone === "good" ? "good" : tone === "bad" ? "bad" : "flat"} dir={dir}>{kpi.unit === "percent" ? `${fmtSignedPp(kpi.delta, locale)} ${t("rpf.pp_unit")}` : kpi.deltaPct != null ? fmtSignedPct(kpi.deltaPct, locale) : dir === "flat" ? "0%" : t("rpf.new")}</DeltaPill>;
  return (
    <div className="@container flex min-w-0 flex-col rounded-card border border-line bg-card p-3 sm:p-4" data-testid={`kpi-${kpi.key}`} data-value={v ?? ""}>
      <div className="flex items-start justify-between gap-1">
        <p className="min-w-0 text-xs font-medium text-muted sm:text-[13px]">{kpi.href ? <Link href={kpi.href} className="hover:text-ink hover:underline">{label}</Link> : label}</p>
        <InfoTip name={label}>
          <span className="block">{t(kpi.definition)}</span>
          {kpi.numerator && <span className="mt-1.5 block text-muted"><span className="font-semibold text-ink">{t("rpf.numerator")}:</span> {t(kpi.numerator)}</span>}
          {kpi.denominator && <span className="mt-1 block text-muted"><span className="font-semibold text-ink">{t("rpf.denominator")}:</span> {t(kpi.denominator)}</span>}
        </InfoTip>
      </div>
      <p className="mt-1 text-xl font-bold leading-tight tabular-nums @[11rem]:text-2xl" title={full}><span className="ltr-num">{text}</span></p>
      <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted">
        {pill}
        {comparing && kpi.prev != null && <span>{t("rpf.vs_prev", { value: kpi.unit === "money" && Math.abs(kpi.prev) >= 1_000_000 ? fmtMoneyCompact(kpi.prev, locale) : formatValue(kpi.prev, kpi.unit, locale) })}</span>}
      </div>
      {kpi.parts && kpi.parts.length > 0 && <p className="mt-1.5 text-xs text-muted">{kpi.parts.map((p) => `${partLabel ? partLabel(p.key) : p.key} ${formatValue(p.value, "number", locale)}`).join(" · ")}</p>}
      {kpi.unfiltered && kpi.unfiltered.length > 0 && <p className="mt-1.5 text-[11px] leading-snug text-gold">{t("rpf.not_filtered_by", { filters: kpi.unfiltered.map((k) => t(`rpf.f_${k}`)).join(", ") })}</p>}
      {kpi.spark && <div className={cn("mt-2 text-accent/70", tone === "bad" && "text-danger/70")}><Sparkline values={kpi.spark} /></div>}
    </div>
  );
}

/** The KPI row of a report: 2 columns on phones, 4 on desktop. Pass `loading` for skeletons while the first response is on its way. */
export function KpiGrid({ kpis, comparing, loading, count = 8, partLabel, cols = 4 }: { kpis?: Kpi[]; comparing?: boolean; loading?: boolean; count?: number; partLabel?: (key: string) => string; cols?: 3 | 4 | 5 | 6 }) {
  const { t } = useI18n();
  return (
    <section aria-label={t("rpf.sec_kpis")} data-testid="kpi-grid">
      <StatGrid cols={cols}>
        {loading || !kpis ? Array.from({ length: count }, (_, i) => <div key={i} className="rounded-card border border-line bg-card p-4"><Skeleton className="h-3 w-24" /><Skeleton className="mt-3 h-7 w-20" /><Skeleton className="mt-3 h-4 w-14" /></div>)
          : kpis.map((k) => <KpiCard key={k.key} kpi={k} comparing={comparing} partLabel={partLabel} />)}
      </StatGrid>
    </section>
  );
}
