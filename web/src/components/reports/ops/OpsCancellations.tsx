"use client";
import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { useI18n } from "@/i18n/provider";
import { PARTIES } from "@/server/analytics/ops-kinds";
import { fmtDur } from "../chartTheme";
import { BreakdownTable } from "../BreakdownTable";
import type { BarRow } from "../BarRows";
import { DonutChart } from "../DonutChart";
import { DrillTable } from "../DrillTable";
import { HistogramChart } from "../HistogramChart";
import { KpiGrid } from "../KpiGrid";
import { RankedList } from "../RankedList";
import { StackedBarChart } from "../TrendChart";
import type { Bucket } from "../types";
import type { OpsSectionProps } from "./OpsDemand";
import { CardFailed, SectionHead, StatTable, type StatLine } from "./OpsParts";
import { PARTY_COLOR, kindSlices, kpisOf, leadBuckets, partySlices, reasonRows, stageSlices } from "./ops-lib";

/** Cancellations deep-dive: by party, stage, reason and lead time, strikes and refunds, repeat cancellers, and the raw list one click away. */
export function OpsCancellations({ data, retry, qs }: OpsSectionProps) {
  const { t, locale } = useI18n();
  const bucket = data.meta.bucket as Bucket, comparing = data.meta.compare !== "none";
  const c = data.cancellations, series = data.series.cancellations;
  const moneyHidden = data.meta.moneyHidden;
  const companies: BarRow[] = (c?.rankings?.companies ?? []).map((x) => ({ key: x.id, label: x.name, value: x.value, prev: x.prev, href: `/admin/companies/${x.id}`, tone: "danger", sub: x.of != null ? t("rpo.rk_of_requests", { n: x.of }) : undefined }));
  const drivers: BarRow[] = (c?.rankings?.drivers ?? []).map((x) => ({ key: x.id, label: x.name, value: x.value, prev: x.prev, href: `/admin/drivers/${x.id}`, tone: "danger", sub: x.noShows ? t("rpo.rk_no_shows", { n: x.noShows }) : undefined }));
  const kindTotal = (c?.kinds ?? []).reduce((n, k) => n + k.count, 0);
  const kinds: BarRow[] = kindSlices(c?.kinds ?? [], t).map((x) => ({ key: x.key, label: x.label, value: x.value, share: kindTotal > 0 ? x.value / kindTotal : null, tone: x.key === "driver_cancel" || x.key === "no_show" ? "danger" : x.key === "replaced" ? "gold" : "accent" }));
  const policy: StatLine[] = c?.strikes ? [
    { key: "warnings", label: t("rpo.m_warnings"), cur: c.strikes.warnings.cur ?? 0, prev: comparing ? c.strikes.warnings.prev : undefined, format: "number", good: "lower" },
    { key: "suspensions", label: t("rpo.m_suspensions"), cur: c.strikes.suspensions.cur ?? 0, prev: comparing ? c.strikes.suspensions.prev : undefined, format: "number", good: "lower" },
    ...(!moneyHidden && c.refunds ? [{ key: "refunds", label: t("rpo.m_refunds"), sub: t("rpo.m_refunds_hint"), cur: c.refunds.cur ?? 0, prev: comparing ? c.refunds.prev : undefined, format: "money" as const, good: "neutral" as const }] : []),
  ] : [];
  return (
    <>
      <SectionHead id="ops-cancellations" title={t("rpo.s_cancellations")} hint={t("rpo.s_cancellations_hint")}
        actions={<Link href="/admin/cancellations" data-testid="link-cancellations" className="inline-flex h-8 items-center gap-1.5 rounded-xl border border-line bg-bg2 px-3 text-xs text-ink hover:border-accent/60">{t("rpo.open_cancellations")}<ArrowUpRight className="size-4 rtl:-scale-x-100" aria-hidden /></Link>} />
      <KpiGrid kpis={kpisOf(data.kpis, "cancellations")} comparing={comparing} cols={3} />
      <div className="grid gap-5 lg:grid-cols-2">
        {series ? <StackedBarChart testId="chart-cancel-trend" title={t("rpo.c_cancel_trend")} description={t("rpo.c_cancel_trend_hint")} data={series.points} prev={series.prev} bucket={bucket}
          series={PARTIES.map((p) => ({ key: p, label: t(`rpo.party.${p}`), color: PARTY_COLOR[p] }))} /> : <CardFailed title={t("rpo.c_cancel_trend")} onRetry={retry} testId="chart-cancel-trend" />}
        {c ? <DonutChart testId="chart-cancel-party" title={t("rpo.c_cancel_party")} description={t("rpo.c_cancel_party_hint")} slices={partySlices(c.parties, t)} centerLabel={t("rpo.unit_events")} /> : <CardFailed title={t("rpo.c_cancel_party")} onRetry={retry} testId="chart-cancel-party" />}
      </div>
      <div className="grid gap-5 lg:grid-cols-2">
        {c ? <DonutChart testId="chart-cancel-stage" title={t("rpo.c_cancel_stage")} description={t("rpo.c_cancel_stage_hint")} slices={stageSlices(c.stages, t)} centerLabel={t("rpo.unit_events")} /> : <CardFailed title={t("rpo.c_cancel_stage")} onRetry={retry} testId="chart-cancel-stage" />}
        {c ? <HistogramChart testId="chart-cancel-lead" title={t("rpo.c_cancel_lead")} description={t("rpo.c_cancel_lead_hint")} unit={t("rpo.unit_events")} buckets={leadBuckets(c.lead.histogram, t, locale)}
          stats={c.lead.p50.cur != null ? <p className="text-xs text-muted">{t("rpf.fill_median")}: <b className="ltr-num text-ink">{c.lead.p50.cur < 0 ? t("rpo.lead_after") : fmtDur(c.lead.p50.cur, locale)}</b></p> : undefined} /> : <CardFailed title={t("rpo.c_cancel_lead")} onRetry={retry} testId="chart-cancel-lead" />}
      </div>
      <div className="grid gap-5 lg:grid-cols-2">
        {c ? <RankedList testId="rk-cancel-reasons" title={t("rpo.c_cancel_reasons")} description={t("rpo.c_cancel_reasons_hint")} rows={reasonRows(c.reasons.map((r) => ({ reason: r.reason, count: r.count })), t)} /> : <CardFailed title={t("rpo.c_cancel_reasons")} onRetry={retry} testId="rk-cancel-reasons" />}
        {c ? <BreakdownTable testId="bd-cancel-kind" title={t("rpo.c_cancel_kind")} rows={kinds} /> : <CardFailed title={t("rpo.c_cancel_kind")} onRetry={retry} testId="bd-cancel-kind" />}
      </div>
      <div className="grid gap-5 lg:grid-cols-2">
        {c?.rankings ? <RankedList testId="rk-cancel-companies" title={t("rpo.c_repeat_companies")} description={t("rpo.c_repeat_companies_hint")} rows={companies} good="lower" /> : <CardFailed title={t("rpo.c_repeat_companies")} onRetry={retry} testId="rk-cancel-companies" />}
        {c?.rankings ? <RankedList testId="rk-cancel-drivers" title={t("rpo.c_repeat_drivers")} description={t("rpo.c_repeat_drivers_hint")} rows={drivers} good="lower" /> : <CardFailed title={t("rpo.c_repeat_drivers")} onRetry={retry} testId="rk-cancel-drivers" />}
      </div>
      {c ? <StatTable testId="stat-policy" title={t("rpo.c_policy")} description={t("rpo.c_policy_hint")} lines={policy} /> : <CardFailed title={t("rpo.c_policy")} onRetry={retry} testId="stat-policy" />}
      <DrillTable testId="drill-cancellations" report="operations" name="cancellations" qs={qs} />
    </>
  );
}
