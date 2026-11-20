"use client";
import { useI18n } from "@/i18n/provider";
import { DrillTable } from "../DrillTable";
import { DeliveriesCharts } from "./DeliveriesCharts";
import { kpiPick } from "./fin-lib";
import { FailedNotice, KpiGroup, SectionNav } from "./parts";
import type { CityName, DeliveriesData } from "./types";

/** The whole Deliveries page below the filter bar: KPI groups, charts, breakdowns, insights and the four drill-down tables. */
export function DeliveriesBody({ data, qs, cityName }: { data: DeliveriesData; qs: string; cityName: CityName }) {
  const { t } = useI18n();
  const comparing = data.meta.compare !== "none";
  const g = data.kpiGroups;
  const c = { data, cityName };
  return (
    <>
      <FailedNotice failed={data.meta.failed} />
      <SectionNav label={t("rpd.nav_label")} items={[
        { id: "flow", label: t("rpd.grp_flow") }, { id: "trends", label: t("rpd.sec_trends") }, { id: "quality", label: t("rpd.grp_quality") }, { id: "reasons", label: t("rpd.sec_reasons") },
        { id: "speed", label: t("rpd.grp_speed") }, { id: "timing", label: t("rpd.sec_timing") }, { id: "when", label: t("rpd.sec_when") }, { id: "groups", label: t("rpd.sec_groups") }, { id: "tables", label: t("rpd.sec_tables") },
      ]} />
      <KpiGroup id="flow" title={t("rpd.grp_flow")} hint={t("rpd.grp_flow_hint")} kpis={kpiPick(data.kpis, g.flow)} comparing={comparing} />
      <DeliveriesCharts {...c} part="trends" />
      <KpiGroup id="quality" title={t("rpd.grp_quality")} hint={t("rpd.grp_quality_hint")} kpis={kpiPick(data.kpis, g.quality)} comparing={comparing} />
      <DeliveriesCharts {...c} part="reasons" />
      <KpiGroup id="speed" title={t("rpd.grp_speed")} hint={t("rpd.grp_speed_hint")} kpis={kpiPick(data.kpis, g.speed)} comparing={comparing} />
      <DeliveriesCharts {...c} part="timing" />
      <DeliveriesCharts {...c} part="when" />
      <DeliveriesCharts {...c} part="groups" />
      <DeliveriesCharts {...c} part="insights" />
      <section id="tables" aria-label={t("rpd.sec_tables")} className="scroll-mt-20 space-y-5">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-muted">{t("rpd.sec_tables")}</h2>
        <DrillTable testId="dlv-drill-parcels" report="deliveries" name="parcels" qs={qs} />
        <DrillTable testId="dlv-drill-failed" report="deliveries" name="failed" qs={qs} />
        <DrillTable testId="dlv-drill-slow" report="deliveries" name="slow" qs={qs} />
        <DrillTable testId="dlv-drill-returns" report="deliveries" name="returns-open" qs={qs} />
      </section>
    </>
  );
}
