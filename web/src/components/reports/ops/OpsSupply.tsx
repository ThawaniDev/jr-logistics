"use client";
import { Table, Td } from "@/components/ui";
import { ChartCard } from "../ChartCard";
import { useI18n } from "@/i18n/provider";
import { fmtPercent, formatValue, seriesColor } from "../chartTheme";
import { KpiGrid } from "../KpiGrid";
import { TrendChart } from "../TrendChart";
import type { Bucket } from "../types";
import type { OpsSectionProps } from "./OpsDemand";
import { CardFailed, SectionHead } from "./OpsParts";
import { dimKey, kpisOf } from "./ops-lib";

/** Supply vs demand: drivers available and busy against open requests and unfilled slots (hourly snapshots), utilisation, and the same by city. */
export function OpsSupply({ data, retry, cityName }: OpsSectionProps) {
  const { t, locale } = useI18n();
  const bucket = data.meta.bucket as Bucket, comparing = data.meta.compare !== "none";
  const s = data.series.supply, cities = data.supply?.cities ?? null;
  const none = data.supply != null && (data.supply.hours?.cur ?? 0) === 0 && (cities?.length ?? 0) === 0;
  return (
    <>
      <SectionHead id="ops-supply" title={t("rpo.s_supply")} hint={t("rpo.s_supply_hint")} />
      <KpiGrid kpis={kpisOf(data.kpis, "supply")} comparing={comparing} cols={3} />
      {none && <p className="rounded-card border border-line bg-card p-4 text-sm text-muted" data-testid="supply-empty">{t("rpo.supply_no_snapshots")}</p>}
      <div className="space-y-5">
        {s ? <TrendChart testId="chart-supply" title={t("rpo.c_supply")} description={t("rpo.c_supply_hint")} data={s.points} prev={s.prev} bucket={bucket} format="rate"
          series={[{ key: "available", label: t("rpo.s_available"), kind: "line", color: seriesColor(0) }, { key: "busy", label: t("rpo.s_busy"), kind: "line", color: seriesColor(4) }, { key: "open", label: t("rpo.s_open_requests"), kind: "line", color: seriesColor(1) }, { key: "unfilled", label: t("rpo.s_unfilled"), kind: "area", color: seriesColor(3) }]} />
          : <CardFailed title={t("rpo.c_supply")} onRetry={retry} testId="chart-supply" />}
        {cities ? (
          <ChartCard testId="tbl-supply-city" title={t("rpo.c_supply_city")} description={t("rpo.c_supply_city_hint")} height="auto" empty={cities.length === 0}>
            <Table bare dense stack label={t("rpo.c_supply_city")} head={[t("rpo.col_city"), { label: t("rpo.s_available"), align: "end" }, { label: t("rpo.s_busy"), align: "end" }, { label: t("rpo.col_utilisation"), align: "end" }, { label: t("rpo.s_open_requests"), align: "end" }, { label: t("rpo.s_unfilled"), align: "end" }, { label: t("rpo.col_per_open"), align: "end", className: "max-sm:hidden" }]}>
              {cities.map((c) => (
                <tr key={c.city}>
                  <Td label={t("rpo.col_city")} className="font-medium">{dimKey("city", c.city, t, cityName)}</Td>
                  <Td num label={t("rpo.s_available")}>{formatValue(c.available, "rate", locale)}</Td>
                  <Td num label={t("rpo.s_busy")}>{formatValue(c.busy, "rate", locale)}</Td>
                  <Td num label={t("rpo.col_utilisation")}>{c.utilisation == null ? "—" : fmtPercent(c.utilisation, locale, 0)}</Td>
                  <Td num label={t("rpo.s_open_requests")}>{formatValue(c.open, "rate", locale)}</Td>
                  <Td num label={t("rpo.s_unfilled")}>{formatValue(c.unfilled, "rate", locale)}</Td>
                  <Td num label={t("rpo.col_per_open")} className="max-sm:hidden">{c.driversPerOpen == null ? "—" : formatValue(c.driversPerOpen, "rate", locale)}</Td>
                </tr>
              ))}
            </Table>
          </ChartCard>
        ) : <CardFailed title={t("rpo.c_supply_city")} onRetry={retry} testId="tbl-supply-city" />}
      </div>
    </>
  );
}
