"use client";
import { useI18n } from "@/i18n/provider";
import { cn } from "@/lib/cn";
import type { GrowthReport } from "@/server/analytics/growth";
import { BreakdownTable } from "../BreakdownTable";
import { DonutChart } from "../DonutChart";
import { DrillTable } from "../DrillTable";
import { FunnelChart } from "../FunnelChart";
import { HistogramChart } from "../HistogramChart";
import { InsightList } from "../InsightList";
import { RankedList } from "../RankedList";
import { fmtDur, fmtPercent, formatValue } from "../chartTheme";
import { StackedBarChart, TrendChart } from "../TrendChart";
import type { Bucket } from "../types";
import { MiniTable, PartialNotice, Row } from "./PeopleParts";
import { keyLabel, slicesOf } from "./people-lib";

const ROLES = ["business", "driver", "office"] as const;
const label = (ns: string, k: string, t: (key: string) => string) => { const key = `${ns}.${k}`, s = t(key); return s === key ? k : s; };

/** The chart and table sections of Reports › Growth & onboarding (the KPI grid and the shell are on the page). */
export function GrowthView({ data, qs }: { data: GrowthReport; qs: string }) {
  const { t, locale } = useI18n();
  const bucket = data.meta.bucket as Bucket, act = data.activation;
  const total = data.geography.cities.reduce((s, c) => s + c.value, 0);
  const stalledTotal = data.stalled.total;
  return (
    <>
      <PartialNotice keys={data.partial} />
      <StackedBarChart testId="chart-signups" title={t("rpp.gro_signups")} description={t("rpp.gro_signups_hint")} data={data.series.signups.points} prev={data.series.signups.prev} bucket={bucket}
        series={ROLES.map((r) => ({ key: r, label: t(`rpp.s_${r}`) }))} />
      <Row>
        <DonutChart testId="bd-sources" title={t("rpp.gro_sources")} description={t("rpp.gro_sources_hint")} centerLabel={t("rpp.unit_accounts")} slices={slicesOf(data.sources, (k) => label("rpp.src", k, t))} />
        <BreakdownTable testId="bd-geo" title={t("rpp.gro_geo")} description={`${t("rpp.gro_geo_hint", { n: data.geography.cities.length })}${data.geography.total > data.geography.cities.length ? ` ${t("rpp.gro_geo_more", { n: data.geography.total - data.geography.cities.length })}` : ""}`}
          rows={data.geography.cities.map((c) => ({ key: c.key || "—", label: keyLabel("city", c.key, t), value: c.value, share: total > 0 ? c.value / total : null }))} />
      </Row>
      <section aria-label={t("rpp.gro_funnels")} className="space-y-3" data-testid="chart-funnels">
        <div><h2 className="font-semibold">{t("rpp.gro_funnels")}</h2><p className="text-xs text-muted">{t("rpp.gro_funnels_hint")}</p></div>
        <div className="grid gap-5 lg:grid-cols-3">
          {data.funnels.map((f) => (
            <FunnelChart key={f.role} testId={`funnel-${f.role}`} title={t(`rpp.role.${f.role}`)} description={t("rpp.gro_branches", { rejected: f.branches.rejected, info: f.branches.info, pending: f.branches.pending })}
              steps={f.steps.map((s) => ({ key: s.key, label: t(`rpp.fn_${s.key}`), count: s.count }))} />
          ))}
        </div>
      </section>
      <Row>
        <RankedList testId="rk-ttv" title={t("rpp.gro_ttv")} description={t("rpp.gro_ttv_hint")} format="duration" good="lower"
          rows={data.verification.byRole.map((r) => ({ key: r.role, label: t(`rpp.role.${r.role}`), value: r.p50, tone: "cyan" as const, sub: t("rpp.gro_ttv_sub", { p90: r.p90 != null ? fmtDur(r.p90, locale) : "—", n: r.n }) }))} />
        <RankedList testId="rk-docs" title={t("rpp.gro_docs")} description={t("rpp.gro_docs_hint")} format="percent" good="lower"
          rows={data.documents.types.map((d) => ({ key: d.key, label: label("doc", d.key, t), value: d.rate, tone: "danger" as const, sub: t("rpp.gro_doc_sub", { submitted: d.submitted, approved: d.approved, rejected: d.rejected, info: d.info }) }))} />
      </Row>
      <Row>
        <RankedList testId="rk-reasons" title={t("rpp.gro_reasons")} description={t("rpp.gro_reasons_hint")} format="number" rows={data.documents.reasons.map((r) => ({ key: r.reason, label: r.reason, value: r.n, tone: "danger" as const }))} />
        <BreakdownTable testId="bd-stalled" title={t("rpp.gro_stalled")} description={t("rpp.gro_stalled_hint", { a: data.thresholds.activationDays, b: data.thresholds.blockedDays })}
          rows={data.stalled.reasons.map((r) => ({ key: r.key, label: t(`rpp.stall.${r.key}`), value: r.value, share: stalledTotal > 0 ? r.value / stalledTotal : null, tone: "gold" as const }))} />
      </Row>
      <Row>
        <FunnelChart testId="funnel-company" title={t("rpp.gro_activation")} description={t("rpp.gro_activation_hint")}
          steps={[{ key: "registered", label: t("rpp.act_registered"), count: act.company.registered ?? 0 }, { key: "ordered", label: t("rpp.act_ordered"), count: Math.min(act.company.ordered ?? 0, act.company.registered ?? 0) }, { key: "completed", label: t("rpp.act_completed"), count: Math.min(act.company.completed ?? 0, act.company.ordered ?? 0) }]} />
        <FunnelChart testId="funnel-driver" title={t("rpp.gro_driver_activation")} description={t("rpp.gro_driver_activation_hint")}
          steps={[{ key: "verified", label: t("rpp.act_verified"), count: act.driver.verified ?? 0 }, { key: "job", label: t("rpp.act_job"), count: Math.min(act.driver.activated ?? 0, act.driver.verified ?? 0) }]} />
      </Row>
      <BreakdownTable testId="activation-times" title={t("rpp.gro_act_times")} description={undefined} format="duration" good="lower"
        rows={[{ key: "first", label: t("rpp.act_t_first"), value: act.company.firstOrder }, { key: "complete", label: t("rpp.act_t_complete"), value: act.company.toComplete }, { key: "job", label: t("rpp.act_t_job"), value: act.driver.firstJob }]} />
      <Row>
        <DonutChart testId="bd-clients" title={t("rpp.gro_clients")} description={t("rpp.gro_clients_hint")} centerLabel={t("rpp.unit_signins")} slices={slicesOf(data.logins.clients, (k) => label("rpp.client", k || "unknown", t))} />
        <DonutChart testId="bd-methods" title={t("rpp.gro_methods")} description={t("rpp.gro_methods_hint")} centerLabel={t("rpp.unit_signins")} slices={slicesOf(data.logins.methods, (k) => label("rpp.method", k, t))} />
      </Row>
      <BreakdownTable testId="bd-failures" title={t("rpp.gro_failures")} description={t("rpp.gro_failures_hint")}
        rows={data.logins.failures.map((f) => ({ key: f.key, label: label("rpp.fail", f.key, t), value: f.value, share: data.logins.failed ? f.value / data.logins.failed : null, tone: "danger" as const }))} />
      <Row>
        <TrendChart testId="chart-logins" title={t("rpp.gro_active")} description={t("rpp.gro_active_hint")} data={data.series.logins.points} prev={data.series.logins.prev} bucket={bucket}
          series={ROLES.map((r) => ({ key: r, label: t(`rpp.s_${r}`), kind: "line" as const }))} />
        <MiniTable testId="active-roles" title={t("rpp.gro_active_now")} description={t("rpp.gro_active_now_hint")} head={[t("rpp.act_type"), t("rpp.act_dau"), t("rpp.act_wau"), t("rpp.act_mau"), t("rpp.act_stickiness")]}
          rows={ROLES.map((r) => { const a = data.active.roles[r]; return [t(`rpp.role.${r}`), formatValue(a.dau, "number", locale), formatValue(a.wau, "number", locale), formatValue(a.mau, "number", locale), a.mau && a.dau != null ? fmtPercent(a.dau / a.mau, locale, 0) : "—"]; })} />
      </Row>
      <HistogramChart testId="chart-backlog" title={t("rpp.gro_backlog")} description={t("rpp.gro_backlog_hint")} unit={t("rpp.unit_accounts")} buckets={data.backlog.buckets.map((b, i) => ({ label: t(`rpp.age_${i}`), count: b.count }))}
        stats={data.backlog.total > 0 ? <p className={cn("text-xs", data.backlog.oldestDays >= 7 ? "text-danger" : "text-muted")}>{t("rpp.gro_backlog_oldest", { d: Math.floor(data.backlog.oldestDays) })}</p> : undefined} />
      <InsightList testId="insights" title={t("rpf.sec_insights")} description={t("rpf.sec_insights_hint")} items={data.insights} />
      <DrillTable testId="drill-signups" report="growth" name="signups" qs={qs} />
      <DrillTable testId="drill-pending" report="growth" name="pending" qs={qs} />
      <DrillTable testId="drill-stalled" report="growth" name="stalled" qs={qs} />
    </>
  );
}
