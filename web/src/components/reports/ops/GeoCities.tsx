"use client";
import { ArrowRight } from "lucide-react";
import { Table, Td } from "@/components/ui";
import { useI18n } from "@/i18n/provider";
import type { GeographyData } from "@/server/analytics/geo-report";
import { ChangePill } from "../Delta";
import { ChartCard } from "../ChartCard";
import { DonutChart } from "../DonutChart";
import { DrillTable } from "../DrillTable";
import { RankedList } from "../RankedList";
import { StackedBarChart } from "../TrendChart";
import { fmtDur, fmtPercent, formatValue } from "../chartTheme";
import type { Bucket } from "../types";
import { CardFailed } from "./OpsParts";
import { citySeriesDefs, crossSlices, failureRows, parcelSlices } from "./geo-lib";
import { dimKey } from "./ops-lib";

interface Props { data: GeographyData; retry: () => void; qs: string; cityName?: (key: string) => string | undefined }

/** Per-city deliveries and supply/demand, parcels by city over time, failure rate by city, cross-city share, the top routes and the city table with CSV. */
export function GeoCities({ data, retry, qs, cityName }: Props) {
  const { t, locale } = useI18n();
  const bucket = data.meta.bucket as Bucket, money = !data.meta.moneyHidden;
  const { cities, routes, series } = data;
  const city = (k: string) => dimKey("city", k, t, cityName);
  const n = (v: number) => <span className="ltr-num">{formatValue(v, "number", locale)}</span>;
  const pct = (v: number | null) => (v == null ? "—" : fmtPercent(v, locale, 0));
  return (
    <>
      <div className="grid gap-5 lg:grid-cols-2">
        {series ? <StackedBarChart testId="chart-city-series" title={t("rpo.c_city_series")} description={t("rpo.c_city_series_hint")} data={series.points} prev={series.prev} bucket={bucket} series={citySeriesDefs(series.cities, t, cityName)} />
          : <CardFailed title={t("rpo.c_city_series")} onRetry={retry} testId="chart-city-series" />}
        {cities ? <DonutChart testId="chart-city-share" title={t("rpo.c_city_share")} description={t("rpo.c_city_share_hint")} slices={parcelSlices(cities, t, cityName)} centerLabel={t("rpo.unit_parcels")} />
          : <CardFailed title={t("rpo.c_city_share")} onRetry={retry} testId="chart-city-share" />}
      </div>
      {cities ? (
        <ChartCard testId="tbl-city-deliveries" title={t("rpo.c_city_deliveries")} description={t("rpo.c_city_deliveries_hint")} height="auto" empty={cities.length === 0}>
          <Table bare dense stack label={t("rpo.c_city_deliveries")} head={[t("rpo.col_city"), { label: t("rpo.col_requests"), align: "end" }, { label: t("rpo.col_pickups"), align: "end", className: "max-sm:hidden" }, { label: t("rpo.col_parcels"), align: "end" }, { label: t("rpo.col_delivered"), align: "end", className: "max-sm:hidden" }, { label: t("rpo.col_success"), align: "end" }, { label: t("rpo.col_failure"), align: "end", className: "max-sm:hidden" }, { label: t("rpo.col_avg_delivery"), align: "end" }, ...(money ? [{ label: t("rpo.col_gmv"), align: "end" as const }] : [])]}>
            {cities.map((c) => (
              <tr key={c.key} data-testid="city-row" data-city={c.key}>
                <Td label={t("rpo.col_city")} className="font-medium">{city(c.key)}</Td>
                <Td num label={t("rpo.col_requests")}><span className="inline-flex flex-col items-end gap-0.5">{n(c.requests)}<ChangePill value={c.requests} prev={c.prevRequests} /></span></Td>
                <Td num label={t("rpo.col_pickups")} className="max-sm:hidden">{n(c.pickupRequests)}</Td>
                <Td num label={t("rpo.col_parcels")}><span className="inline-flex flex-col items-end gap-0.5">{n(c.parcels)}<ChangePill value={c.parcels} prev={c.prevParcels} /></span></Td>
                <Td num label={t("rpo.col_delivered")} className="max-sm:hidden">{n(c.delivered)}</Td>
                <Td num label={t("rpo.col_success")}><span className="inline-flex flex-col items-end gap-0.5">{pct(c.successRate)}<ChangePill value={c.successRate} prev={c.prevSuccessRate} /></span></Td>
                <Td num label={t("rpo.col_failure")} className="max-sm:hidden">{pct(c.failureRate)}</Td>
                <Td num label={t("rpo.col_avg_delivery")}>{c.avgDeliverySecs == null ? "—" : fmtDur(c.avgDeliverySecs, locale)}</Td>
                {money && <Td num label={t("rpo.col_gmv")}>{c.gmv == null ? "—" : formatValue(c.gmv, "money", locale)}</Td>}
              </tr>
            ))}
          </Table>
        </ChartCard>
      ) : <CardFailed title={t("rpo.c_city_deliveries")} onRetry={retry} testId="tbl-city-deliveries" />}
      {cities ? (
        <ChartCard testId="tbl-city-supply" title={t("rpo.c_city_supply")} description={t("rpo.c_city_supply_hint")} height="auto" empty={cities.length === 0}>
          <Table bare dense stack label={t("rpo.c_city_supply")} head={[t("rpo.col_city"), { label: t("rpo.col_slots"), align: "end" }, { label: t("rpo.col_unserved"), align: "end" }, { label: t("rpo.col_unserved_rate"), align: "end" }, { label: t("rpo.col_drivers"), align: "end" }, { label: t("rpo.col_per_slot"), align: "end" }, { label: t("rpo.col_active_drivers"), align: "end", className: "max-sm:hidden" }, { label: t("rpo.col_active_companies"), align: "end", className: "max-sm:hidden" }]}>
            {cities.map((c) => (
              <tr key={c.key} data-testid="city-supply-row" data-city={c.key}>
                <Td label={t("rpo.col_city")} className="font-medium">{city(c.key)}</Td>
                <Td num label={t("rpo.col_slots")}>{n(c.slots)}</Td>
                <Td num label={t("rpo.col_unserved")}>{n(c.unserved)}</Td>
                <Td num label={t("rpo.col_unserved_rate")}>{pct(c.unservedRate)}</Td>
                <Td num label={t("rpo.col_drivers")}>{n(c.drivers)}</Td>
                <Td num label={t("rpo.col_per_slot")}>{c.driversPerSlot == null ? "—" : formatValue(c.driversPerSlot, "rate", locale)}</Td>
                <Td num label={t("rpo.col_active_drivers")} className="max-sm:hidden">{n(c.activeDrivers)}</Td>
                <Td num label={t("rpo.col_active_companies")} className="max-sm:hidden">{n(c.activeCompanies)}</Td>
              </tr>
            ))}
          </Table>
        </ChartCard>
      ) : <CardFailed title={t("rpo.c_city_supply")} onRetry={retry} testId="tbl-city-supply" />}
      <div className="grid gap-5 lg:grid-cols-2">
        {cities ? <RankedList testId="rk-city-failure" title={t("rpo.c_city_failure")} description={t("rpo.c_city_failure_hint")} rows={failureRows(cities, t, cityName)} format="percent" good="lower" />
          : <CardFailed title={t("rpo.c_city_failure")} onRetry={retry} testId="rk-city-failure" />}
        {routes ? <DonutChart testId="chart-cross-city" title={t("rpo.c_cross_city")} description={t("rpo.c_cross_city_hint")} slices={crossSlices(routes, t)} centerLabel={t("rpo.unit_requests")} />
          : <CardFailed title={t("rpo.c_cross_city")} onRetry={retry} testId="chart-cross-city" />}
      </div>
      {routes ? (
        <ChartCard testId="tbl-routes" title={t("rpo.c_routes")} description={t("rpo.c_routes_hint")} height="auto" empty={routes.length === 0}>
          <Table bare dense stack label={t("rpo.c_routes")} head={[t("rpo.col_route"), { label: t("rpo.col_requests"), align: "end" }, { label: t("rpo.col_parcels"), align: "end" }, { label: t("rpo.col_success"), align: "end" }, { label: t("rpo.col_avg_delivery"), align: "end", className: "max-sm:hidden" }, ...(money ? [{ label: t("rpo.col_gmv"), align: "end" as const }] : [])]}>
            {routes.slice(0, 10).map((r) => (
              <tr key={r.id} data-testid="route-row">
                <Td label={t("rpo.col_route")} className="font-medium">{city(r.pickup)} <ArrowRight className="inline size-3.5 text-muted rtl:rotate-180" aria-hidden /> {city(r.delivery)}</Td>
                <Td num label={t("rpo.col_requests")}>{n(r.requests)}</Td>
                <Td num label={t("rpo.col_parcels")}>{n(r.parcels)}</Td>
                <Td num label={t("rpo.col_success")}>{pct(r.successRate)}</Td>
                <Td num label={t("rpo.col_avg_delivery")} className="max-sm:hidden">{r.avgDeliverySecs == null ? "—" : fmtDur(r.avgDeliverySecs, locale)}</Td>
                {money && <Td num label={t("rpo.col_gmv")}>{r.gmv == null ? "—" : formatValue(r.gmv, "money", locale)}</Td>}
              </tr>
            ))}
          </Table>
        </ChartCard>
      ) : <CardFailed title={t("rpo.c_routes")} onRetry={retry} testId="tbl-routes" />}
      <DrillTable testId="drill-cities" report="geography" name="cities" qs={qs} />
      <DrillTable testId="drill-routes" report="geography" name="routes" qs={qs} />
    </>
  );
}
