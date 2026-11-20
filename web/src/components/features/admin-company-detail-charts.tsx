"use client";
import { HeartPulse, Info } from "lucide-react";
import { Badge, Notice, ProgressBar, Section } from "@/components/ui";
import { BreakdownTable, DonutChart, InfoTip, TrendChart, STATUS_COLOR } from "@/components/reports";
import { fmtMoney, fmtNum } from "@/lib/format";
import { useI18n } from "@/i18n/provider";
import { useTx } from "./admin-common";
import { alertKey } from "./admin-company-detail-lib";
import type { CompanyStats } from "./admin-company-detail-kpis";
import { HEALTH_BANDS, HEALTH_CANCEL_ZERO_AT, HEALTH_FULL_ORDERS_PER_30D, HEALTH_RECENCY, HEALTH_WEIGHTS } from "@/server/details-pure";

/** What needs attention now: every alert is one plain rule over the numbers on this page (the rule is in the tooltip text), never raised from missing data. */
export function CompanyAlerts({ alerts }: { alerts: CompanyStats["alerts"] }) {
  const { t, locale } = useI18n();
  if (alerts.length === 0) return null;
  const vars = (a: CompanyStats["alerts"][number]) => Object.fromEntries(Object.entries(a.params).map(([k, v]) => [k, ["need", "have"].includes(k) && typeof v === "number" ? fmtMoney(v, locale) : typeof v === "number" ? fmtNum(v, locale) : v]));
  return (
    <section aria-label={t("dv3.alerts_title")} className="space-y-2" data-testid="dv3-alerts">
      {alerts.map((a) => (
        <Notice key={a.key} tone={a.tone === "danger" ? "danger" : "warn"} title={t(`${alertKey(a)}_t`)}>
          <span data-testid={`dv3-alert-${a.key}`}>{t(alertKey(a), vars(a))}</span>
        </Notice>
      ))}
    </section>
  );
}

const PART_VALUE: Record<string, (i: NonNullable<CompanyStats["healthInputs"]>, t: ReturnType<typeof useI18n>["t"], l: ReturnType<typeof useI18n>["locale"]) => string> = {
  recency: (i, t, l) => (i.daysSinceLastOrder == null ? "—" : t("dv3.hp_recency", { n: fmtNum(i.daysSinceLastOrder, l) })),
  frequency: (i, t, l) => (i.daysSinceLastOrder == null ? "—" : t("dv3.hp_frequency", { n: fmtNum(i.orders90, l) })),
  success: (i, t, l) => (i.successRate == null ? "—" : `${fmtNum(Math.round(i.successRate * 100), l)}%`),
  cancellations: (i, t, l) => (i.cancellationRate == null ? "—" : `${fmtNum(Math.round(i.cancellationRate * 100), l)}%`),
  support: (i, t, l) => (i.openSupport == null ? "—" : t("dv3.hp_support", { open: fmtNum(i.openSupport, l), complaints: fmtNum(i.complaints90 ?? 0, l) })),
};
const BAND_TONE = { healthy: "success", watch: "warn", risk: "danger" } as const;

/** The health score with its five parts and the formula, so nobody has to trust a number they cannot check. */
export function CompanyHealth({ stats }: { stats?: CompanyStats }) {
  const { t, locale } = useI18n();
  const h = stats?.health, inp = stats?.healthInputs;
  if (!stats || !h || !inp) return null;
  return (
    <Section title={<span className="inline-flex items-center gap-2"><HeartPulse className="size-4 text-accent" aria-hidden />{t("dv3.health_title")}</span>} description={t("dv3.health_sub")}
      actions={<InfoTip name={t("dv3.health_title")}><span className="block">{t("dv3.d_health")}</span><span className="mt-1.5 block text-muted">{t("dv3.health_formula", { r: HEALTH_WEIGHTS.recency, f: HEALTH_WEIGHTS.frequency, s: HEALTH_WEIGHTS.success, c: HEALTH_WEIGHTS.cancellations, p: HEALTH_WEIGHTS.support })}</span></InfoTip>}>
      <div data-testid="dv3-health" className="space-y-4">
        <div className="flex flex-wrap items-center gap-3">
          <span className="ltr-num text-4xl font-bold tabular-nums" data-testid="dv3-health-score">{h.score == null ? "—" : fmtNum(h.score, locale)}</span>
          {h.band ? <Badge tone={BAND_TONE[h.band]}>{t(`dv3.band_${h.band}`)}</Badge> : <Badge>{t("dv3.band_none")}</Badge>}
        </div>
        {h.score != null && <ProgressBar value={h.score} max={100} tone={h.band === "healthy" ? "accent" : h.band === "watch" ? "gold" : "danger"} label={t("dv3.health_title")} />}
        {h.score == null && <p className="text-sm text-muted">{t("dv3.health_nodata")}</p>}
        <ul aria-label={t("dv3.health_parts")} className="divide-y divide-line/60 text-sm">
          {h.parts.map((p) => (
            <li key={p.key} data-testid={`dv3-health-part-${p.key}`} className="py-2">
              <div className="flex items-baseline justify-between gap-3"><span className="min-w-0 font-medium">{t(`dv3.hpn_${p.key}`)}</span><span className="ltr-num shrink-0 tabular-nums"><span className="font-semibold">{p.score == null ? "—" : p.score}</span><span className="text-xs text-muted"> · {p.weight}%</span></span></div>
              <p className="mt-0.5 text-xs text-muted">{PART_VALUE[p.key](inp, t, locale)}</p>
            </li>
          ))}
        </ul>
        <p className="flex items-start gap-1.5 text-xs text-muted"><Info className="mt-0.5 size-3.5 shrink-0" aria-hidden />{t("dv3.health_rules", { full: HEALTH_RECENCY.fullUntilDays, zero: HEALTH_RECENCY.zeroAtDays, orders: HEALTH_FULL_ORDERS_PER_30D, cancel: Math.round(HEALTH_CANCEL_ZERO_AT * 100), healthy: HEALTH_BANDS.healthy, watch: HEALTH_BANDS.watch })}</p>
      </div>
    </Section>
  );
}

/** Orders and parcels over time, why parcels fail, where the money goes, and the busiest cities — all for the selected period. */
export function CompanyCharts({ stats, loading }: { stats?: CompanyStats; loading: boolean }) {
  const { t } = useI18n(); const tx = useTx();
  const c = stats?.charts, bucket = stats?.period.bucket ?? "day";
  if (!loading && !c) return null;
  const total = (xs: Array<{ value: number }>) => xs.reduce((a, x) => a + x.value, 0);
  const orders = c?.orders ?? [];
  return (
    <div className="grid gap-5 lg:grid-cols-2" data-testid="dv3-charts">
      <TrendChart testId="dv3-chart-orders" title={t("dv3.ch_orders")} description={t("dv3.ch_orders_hint")} data={orders} bucket={bucket} loading={loading} height={240}
        series={[{ key: "orders", label: t("dv3.s_orders"), kind: "bar" }, { key: "cancelled", label: t("dv3.s_cancelled"), kind: "line", color: STATUS_COLOR.cancelled }]} />
      <TrendChart testId="dv3-chart-parcels" title={t("dv3.ch_parcels")} description={t("dv3.ch_parcels_hint")} data={orders} bucket={bucket} loading={loading} height={240}
        series={[{ key: "parcels", label: t("dv3.s_parcels"), kind: "area" }, { key: "delivered", label: t("dv3.s_delivered"), kind: "line", color: STATUS_COLOR.delivered }, { key: "failed", label: t("dv3.s_failed"), kind: "line", color: STATUS_COLOR.failed }]} />
      <DonutChart testId="dv3-chart-reasons" title={t("dv3.ch_reasons")} description={t("dv3.ch_reasons_hint")} loading={loading} centerLabel={t("dv3.s_failed")}
        slices={(c?.failureReasons ?? []).map((r) => ({ key: r.key, label: tx(`stopfail.${r.key}`, r.key), value: r.value }))} />
      {(c?.spendByService || loading) && !stats?.moneyHidden
        ? <BreakdownTable testId="dv3-chart-spend" title={t("dv3.ch_spend")} description={t("dv3.ch_spend_hint")} format="money" loading={loading}
            rows={(c?.spendByService ?? []).map((r) => ({ key: r.key, label: tx(`svc.${r.key}`, r.key), value: r.value, share: total(c?.spendByService ?? []) > 0 ? r.value / total(c?.spendByService ?? []) : null }))} />
        : <BreakdownTable testId="dv3-chart-cities" title={t("dv3.ch_cities")} description={t("dv3.ch_cities_hint")} loading={loading} rows={(c?.cities ?? []).map((r) => ({ key: r.key, label: tx(`city.${r.key}`, r.key), value: r.value, share: total(c?.cities ?? []) > 0 ? r.value / total(c?.cities ?? []) : null }))} />}
      {(c?.spendByService || loading) && !stats?.moneyHidden && (
        <BreakdownTable testId="dv3-chart-cities" title={t("dv3.ch_cities")} description={t("dv3.ch_cities_hint")} loading={loading}
          rows={(c?.cities ?? []).map((r) => ({ key: r.key, label: tx(`city.${r.key}`, r.key), value: r.value, share: total(c?.cities ?? []) > 0 ? r.value / total(c?.cities ?? []) : null }))} />)}
    </div>
  );
}
