"use client";
import type { ReactNode } from "react";
import Link from "next/link";
import { Skeleton, ProgressBar, Segmented } from "@/components/ui";
import { DeltaPill, InfoTip } from "@/components/reports";
import { cn } from "@/lib/cn";
import { fmtDate, fmtMoney, fmtNum } from "@/lib/format";
import { useI18n } from "@/i18n/provider";
import { companyTabHref } from "./admin-companies-lib";
import { COMPANY_PERIODS, KPI_GROUPS, KPI_TAB, kpiDelta, kpiKeys, kpiText } from "./admin-company-detail-lib";
import type { CompanyKpi, CompanyKpiKey } from "@/server/details-companies";
import type { CompanyPeriod } from "@/server/details-pure";

export interface CompanyStats {
  period: { key: CompanyPeriod; from: string; to: string; days: number; bucket: "day" | "week" | "month"; prevFrom: string | null; prevTo: string | null };
  kpis: CompanyKpi[]; hidden: string[]; moneyHidden: boolean;
  facts: { lastOrderAt: string | null; firstOrderAt: string | null; daysSinceLastOrder: number | null; ordersAll: number; openNow: number } | null;
  wallet: { availableCents: number; reservedCents: number; heldCents: number; creditLimitCents: number; creditUse: number | null } | null;
  health: { score: number | null; band: "healthy" | "watch" | "risk" | null; parts: Array<{ key: string; weight: number; score: number | null }> } | null;
  healthInputs: { daysSinceLastOrder: number | null; orders90: number; successRate: number | null; cancellationRate: number | null; openSupport: number | null; complaints90: number | null } | null;
  alerts: Array<{ key: string; tone: "danger" | "warn"; params: Record<string, string | number> }>;
  charts: { orders: Array<{ t: string; orders: number; cancelled: number; parcels: number; delivered: number; failed: number }>; failureReasons: Array<{ key: string; value: number }>; cities: Array<{ key: string; value: number }>; spendByService: Array<{ key: string; value: number }> | null } | null;
  generatedAt: string;
}

/** One KPI: label with a definition tooltip, the value, the change against the previous period and a hint. The whole tile links to where the number is explored. */
export function KpiTile({ id, label, def, num, den, value, delta, hint, href, tone, loading, extra, plain }: {
  id: string; label: string; def: string; num?: string | null; den?: string | null; value: ReactNode; delta?: ReactNode; hint?: ReactNode; href?: string; tone?: "danger" | "gold" | "accent"; loading?: boolean; extra?: ReactNode; plain?: boolean;
}) {
  const { t } = useI18n();
  return (
    <div className="@container flex min-w-0 flex-col rounded-card border border-line bg-card p-3 sm:p-4" data-testid={`dv3-kpi-${id}`}>
      <div className="flex items-start justify-between gap-1">
        <p className="min-w-0 text-xs font-medium text-muted sm:text-[13px]">{href ? <Link href={href} className="hover:text-ink hover:underline">{label}</Link> : label}</p>
        <InfoTip name={label}>
          <span className="block">{def}</span>
          {num && <span className="mt-1.5 block text-muted"><span className="font-semibold text-ink">{t("rpf.numerator")}:</span> {num}</span>}
          {den && <span className="mt-1 block text-muted"><span className="font-semibold text-ink">{t("rpf.denominator")}:</span> {den}</span>}
        </InfoTip>
      </div>
      <div className={cn("mt-1 min-w-0 break-words text-xl font-bold leading-tight tabular-nums @[11rem]:text-2xl", tone === "danger" ? "text-danger" : tone === "gold" ? "text-gold" : "text-ink")}>{loading ? <Skeleton className="h-7 w-24" /> : <span className={plain ? undefined : "ltr-num"} data-testid={`dv3-kpi-${id}-value`}>{value}</span>}</div>
      {(delta || hint) && <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted">{delta}{hint && <span>{hint}</span>}</div>}
      {extra}
    </div>
  );
}

/** The period selector: 30 days / 90 days / 12 months / all time. Each value is a window the server resolves in Riyadh days. */
export function PeriodSelect({ value, onChange }: { value: CompanyPeriod; onChange: (p: CompanyPeriod) => void }) {
  const { t } = useI18n();
  return <Segmented label={t("dv3.period")} value={value} onChange={(k) => onChange(k as CompanyPeriod)} options={COMPANY_PERIODS.map((p) => ({ key: p, label: t(p === "all" ? "dv3.period_all" : `rpf.preset_${p}`) }))} />;
}

/** The KPI strip of the Overview: performance of the selected period (with the change against the period before it), money, and the state right now. */
export function CompanyKpiStrip({ id, data, loading, period, onPeriod }: { id: string; data?: CompanyStats; loading: boolean; period: CompanyPeriod; onPeriod: (p: CompanyPeriod) => void }) {
  const { t, locale } = useI18n();
  const byKey = new Map((data?.kpis ?? []).map((k) => [k.key, k]));
  const tab = (k: CompanyKpiKey) => { const x = KPI_TAB[k]; return x ? companyTabHref(id, x) : undefined; };
  const tile = (key: CompanyKpiKey) => {
    const k = byKey.get(key);
    if (!k && !loading) return null;
    const ks = kpiKeys(key), d = k ? kpiDelta(k, locale) : null;
    const delta = d ? <DeltaPill tone={d.tone} dir={d.dir}>{d.isNew ? t("rpf.new") : d.text}{k?.unit === "percent" && !d.isNew && d.dir !== "flat" ? ` ${t("rpf.pp_unit")}` : ""}</DeltaPill> : null;
    const hint = key === "orders" && k?.sub != null ? t("dv3.h_orders_all", { n: fmtNum(Number(k.sub), locale) })
      : key === "success" && k?.sub ? t("dv3.h_outcomes", { n: fmtNum(Number(k.sub), locale) }) : key === "on_time" && k?.sub ? t("dv3.h_due", { n: fmtNum(Number(k.sub), locale) })
      : key === "cancellation" && k?.sub != null ? t("dv3.h_cancelled", { n: fmtNum(Number(k.sub), locale) }) : key === "spend" && k?.sub != null ? t("dv3.h_settled", { n: fmtNum(Number(k.sub), locale) })
      : key === "frequency" ? t("dv3.h_per_30d") : key === "support" && typeof k?.sub === "string" ? t("rdp.ov_cases_hint", { t: k.sub.split("/")[0], c: k.sub.split("/")[1] }) : undefined;
    return <KpiTile key={key} id={key} label={t(ks.label)} def={t(ks.def)} num={ks.num && t(ks.num)} den={ks.den && t(ks.den)} loading={loading || !k} href={tab(key)}
      value={k ? kpiText(k, locale) : ""} delta={delta} hint={hint} tone={key === "support" && (k?.value ?? 0) > 0 ? "danger" : undefined} />;
  };
  const f = data?.facts, w = data?.wallet;
  const prev = data?.period.prevFrom ? t("dv3.vs_prev", { from: fmtDate(data.period.prevFrom, locale), to: fmtDate(data.period.prevTo, locale) }) : t("dv3.no_prev");
  const ago = f?.daysSinceLastOrder == null ? null : f.daysSinceLastOrder === 0 ? t("ubz.today") : t("dv3.days_ago", { n: fmtNum(f.daysSinceLastOrder, locale) });
  return (
    <section aria-label={t("dv3.kpi_title")} data-testid="dv3-kpis" className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div><h2 className="font-semibold">{t("dv3.kpi_title")}</h2>{data && <p className="text-xs text-muted" data-testid="dv3-period-range"><span>{fmtDate(data.period.from, locale)} – {fmtDate(data.period.to, locale)}</span> · {prev}</p>}</div>
        <PeriodSelect value={period} onChange={onPeriod} />
      </div>
      <div className="grid grid-cols-2 gap-2.5 sm:gap-3 lg:grid-cols-4">
        {KPI_GROUPS[0].keys.map(tile)}
        {KPI_GROUPS[1].keys.map(tile)}
        {(data?.wallet || loading) && <KpiTile id="wallet" label={t("dv3.k_wallet")} def={t("dv3.d_wallet")} loading={loading || !w} href={companyTabHref(id, "finance")}
          value={w ? fmtMoney(w.availableCents, locale) : ""} tone={(w?.availableCents ?? 0) < 0 ? "danger" : undefined} hint={w ? t("dv3.h_wallet", { reserved: fmtMoney(w.reservedCents, locale), held: fmtMoney(w.heldCents, locale) }) : undefined} />}
        {(w || loading) && <KpiTile id="credit" label={t("dv3.k_credit")} def={t("dv3.d_credit")} loading={loading || !w} href={companyTabHref(id, "finance")}
          value={w ? (w.creditLimitCents > 0 ? `${Math.round((w.creditUse ?? 0) * 100)}%` : t("dv3.no_credit")) : ""} tone={(w?.creditUse ?? 0) >= 0.8 ? "gold" : undefined}
          hint={w && w.creditLimitCents > 0 ? t("dv3.h_credit", { limit: fmtMoney(w.creditLimitCents, locale) }) : undefined}
          extra={w && w.creditLimitCents > 0 ? <div className="mt-2"><ProgressBar value={(w.creditUse ?? 0) * 100} max={100} tone={(w.creditUse ?? 0) >= 0.8 ? "gold" : "accent"} label={t("dv3.k_credit")} /></div> : undefined} />}
        {(f || loading) && <KpiTile id="active" label={t("rdp.ov_active")} def={t("dv3.d_active")} loading={loading || !f} href={companyTabHref(id, "orders")} value={f ? fmtNum(f.openNow, locale) : ""} hint={f ? t("rdp.ov_active_hint", { n: fmtNum(f.ordersAll, locale) }) : undefined} />}
        {(f || loading) && <KpiTile id="last_order" plain label={t("dv3.k_last_order")} def={t("dv3.d_last_order")} loading={loading || !f} value={f ? (f.lastOrderAt ? fmtDate(f.lastOrderAt, locale) : "—") : ""} hint={ago ?? (f ? t("dv3.never_ordered") : undefined)} />}
        {KPI_GROUPS[2].keys.map(tile)}
      </div>
      {data && data.hidden.length > 0 && <p className="text-xs text-muted" data-testid="dv3-kpi-hidden">{t("dv3.hidden_parts", { parts: data.hidden.map((h) => t(`dv3.hid_${h}`)).join(", ") })}</p>}
    </section>
  );
}
