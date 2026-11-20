"use client";
import Link from "next/link";
import { UserX } from "lucide-react";
import { Badge } from "@/components/ui";
import { useI18n } from "@/i18n/provider";
import { BreakdownTable } from "../BreakdownTable";
import { ChartCard } from "../ChartCard";
import { DonutChart } from "../DonutChart";
import { Heatmap } from "../Heatmap";
import { HistogramChart } from "../HistogramChart";
import { StackedBarChart, TrendChart } from "../TrendChart";
import { fmtDur, seriesColor, STATUS_COLOR } from "../chartTheme";
import type { Bucket } from "../types";
import { ageText, agingBuckets, groupRows, groupSlices, resolutionBuckets, volumeSeries, type SupportData } from "./support-lib";

const SLA_TONE = { breached: "danger", at_risk: "warn", pending: "neutral", ok: "success" } as const;

/** The open tickets that have waited longest, with their SLA state: the alert list next to the backlog aging chart. */
function AlertList({ alerts }: { alerts: SupportData["aging"]["alerts"] }) {
  const { t, locale } = useI18n();
  return (
    <ChartCard testId="rpq-alerts" title={t("rpq.sec_alerts")} description={t("rpq.sec_alerts_hint")} height="auto" empty={alerts.length === 0}>
      <ul className="divide-y divide-line/70">
        {alerts.map((a) => (
          <li key={a.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2.5 first:pt-0 last:pb-0" data-testid="rpq-alert" data-state={a.state}>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium"><Link href={`/admin/cases/${a.id}`} className="text-accent hover:underline"><span className="ltr-num">{a.ref}</span></Link> <span className="text-muted">·</span> {a.subject}</p>
              <p className="truncate text-xs text-muted">{a.who} · {t(`ticket_cat.${a.category}`)}</p>
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              {a.priority === "urgent" && <Badge tone="danger">{t("rpq.pri.urgent")}</Badge>}
              {(a.state === "breached" || a.state === "at_risk") && <Badge tone={SLA_TONE[a.state]}>{t(`rpq.sla.${a.state}`)}</Badge>}
              {!a.assigned && <Badge tone="warn"><UserX className="size-3" aria-hidden />{t("rpq.unassigned")}</Badge>}
              <span className="ltr-num text-xs tabular-nums text-muted" title={t("rpq.age")}>{ageText(a.ageSec, locale)}</span>
            </div>
          </li>
        ))}
      </ul>
    </ChartCard>
  );
}

/** Charts of the Support report: ticket volume by category, opened / resolved flow, priority and requester role, backlog aging and alerts, resolution times, creation heatmap and the category rankings. */
export function SupportCharts({ data }: { data: SupportData }) {
  const { t, locale } = useI18n();
  const bucket = data.meta.bucket as Bucket;
  const { series, breakdowns: bd, aging, resolution } = data;
  const res = resolution.n > 0 ? <p className="text-xs text-muted">{t("rpq.res_median")}: <b className="ltr-num text-ink">{resolution.p50 != null ? fmtDur(resolution.p50, locale) : "—"}</b> · {t("rpq.res_p90")}: <b className="ltr-num text-ink">{resolution.p90 != null ? fmtDur(resolution.p90, locale) : "—"}</b></p> : undefined;
  return (
    <>
      <StackedBarChart testId="rpq-chart-volume" title={t("rpq.sec_volume")} description={t("rpq.sec_volume_hint")} data={series.volume.points} prev={series.volume.prev} bucket={bucket} series={volumeSeries(series.volume.categories, t)} />
      <div className="grid gap-5 lg:grid-cols-2">
        <TrendChart testId="rpq-chart-flow" title={t("rpq.sec_flow")} description={t("rpq.sec_flow_hint")} data={series.flow.points} prev={series.flow.prev} bucket={bucket}
          series={[{ key: "opened", label: t("rpq.s_opened"), kind: "bar", color: seriesColor(0) }, { key: "resolved", label: t("rpq.s_resolved"), kind: "line", color: STATUS_COLOR.revenue }, { key: "complaints", label: t("rpq.s_complaints"), kind: "line", color: seriesColor(1) }]} />
        <BreakdownTable testId="rpq-bd-category" title={t("rpq.sec_categories")} description={t("rpq.sec_categories_hint")} rows={groupRows(bd.category, "ticket_cat", t).slice(0, 8)} good="lower" />
      </div>
      <div className="grid gap-5 lg:grid-cols-2">
        <DonutChart testId="rpq-bd-priority" title={t("rpq.sec_priority")} slices={groupSlices(bd.priority, "rpq.pri", t)} centerLabel={t("rpq.s_opened")} />
        <DonutChart testId="rpq-bd-role" title={t("rpq.sec_role")} description={t("rpq.sec_role_hint")} slices={groupSlices(bd.role, "role", t)} centerLabel={t("rpq.s_opened")} />
      </div>
      <div className="grid gap-5 lg:grid-cols-2">
        <HistogramChart testId="rpq-chart-aging" title={t("rpq.sec_aging")} description={t("rpq.sec_aging_hint", { n: aging.openNow })} unit={t("rpq.unit_tickets")} buckets={agingBuckets(aging.buckets, t)} />
        <AlertList alerts={aging.alerts} />
      </div>
      <div className="grid gap-5 lg:grid-cols-2">
        <HistogramChart testId="rpq-chart-resolution" title={t("rpq.sec_resolution")} description={t("rpq.sec_resolution_hint")} unit={t("rpq.unit_tickets")} buckets={resolutionBuckets(resolution.histogram, t, locale)} stats={res} />
        <Heatmap testId="rpq-chart-heatmap" title={t("rpq.sec_heat")} description={t("rpq.sec_heat_hint")} cells={data.heatmap.cells} unit={t("rpq.unit_tickets")} />
      </div>
    </>
  );
}
