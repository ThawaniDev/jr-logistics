"use client";
import { useI18n } from "@/i18n/provider";
import { fmtDur } from "../chartTheme";
import { DonutChart } from "../DonutChart";
import { HistogramChart } from "../HistogramChart";
import { KpiGrid } from "../KpiGrid";
import { RankedList } from "../RankedList";
import type { OpsSectionProps } from "./OpsDemand";
import { OpsFunnel } from "./OpsFunnel";
import { CardFailed, SectionHead } from "./OpsParts";
import { dimKey, durationBuckets, kpisOf, outcomeSlices } from "./ops-lib";

/** Offers funnel: what happens to the offers sent to drivers, how fast they answer, and the acceptance rate by city and vehicle. */
export function OpsOffers({ data, retry, cityName }: OpsSectionProps) {
  const { t, locale } = useI18n();
  const comparing = data.meta.compare !== "none";
  const resp = data.response;
  const bd = data.groups?.breakdowns;
  const rows = (dim: "city" | "vehicle") => (bd?.[dim] ?? []).filter((r) => r.offered > 0).sort((a, b) => (b.acceptRate ?? -1) - (a.acceptRate ?? -1) || b.offered - a.offered).map((r) => ({ key: r.key || "—", label: dimKey(dim, r.key, t, cityName), value: r.acceptRate, sub: t("rpo.accept_of", { n: r.accepted, total: r.offered }) }));
  return (
    <>
      <SectionHead id="ops-offers" title={t("rpo.s_offers")} hint={t("rpo.s_offers_hint")} />
      <KpiGrid kpis={kpisOf(data.kpis, "offers")} comparing={comparing} cols={4} />
      <div className="grid gap-5 lg:grid-cols-2">
        {data.funnel && data.outcomes ? <OpsFunnel testId="chart-offer-funnel" title={t("rpo.c_offer_funnel")} description={t("rpo.c_offer_funnel_hint")} steps={data.funnel} outcomes={data.outcomes} /> : <CardFailed title={t("rpo.c_offer_funnel")} onRetry={retry} testId="chart-offer-funnel" />}
        {data.outcomes ? <DonutChart testId="chart-offer-outcomes" title={t("rpo.c_offer_outcomes")} description={t("rpo.c_offer_outcomes_hint")} slices={outcomeSlices(data.outcomes, t)} centerLabel={t("rpo.unit_offers")} /> : <CardFailed title={t("rpo.c_offer_outcomes")} onRetry={retry} testId="chart-offer-outcomes" />}
      </div>
      <div className="grid gap-5 lg:grid-cols-3">
        {resp ? <div className="min-w-0 lg:col-span-1"><HistogramChart testId="chart-response" title={t("rpo.c_response")} description={t("rpo.c_response_hint")} unit={t("rpo.unit_offers")} buckets={durationBuckets(resp.histogram, t, locale)}
          stats={resp.n > 0 ? <p className="text-xs text-muted">{t("rpf.fill_median")}: <b className="ltr-num text-ink">{resp.p50.cur != null ? fmtDur(resp.p50.cur, locale) : "—"}</b> · {t("rpo.p90")}: <b className="ltr-num text-ink">{resp.p90.cur != null ? fmtDur(resp.p90.cur, locale) : "—"}</b></p> : undefined} /></div>
          : <CardFailed title={t("rpo.c_response")} onRetry={retry} testId="chart-response" />}
        {bd ? <RankedList testId="bd-accept-city" title={t("rpo.c_accept_city")} description={t("rpo.c_accept_hint")} rows={rows("city")} format="percent" /> : <CardFailed title={t("rpo.c_accept_city")} onRetry={retry} testId="bd-accept-city" />}
        {bd ? <RankedList testId="bd-accept-vehicle" title={t("rpo.c_accept_vehicle")} description={t("rpo.c_accept_hint")} rows={rows("vehicle")} format="percent" /> : <CardFailed title={t("rpo.c_accept_vehicle")} onRetry={retry} testId="bd-accept-vehicle" />}
      </div>
    </>
  );
}
