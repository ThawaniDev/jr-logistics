"use client";
import { Star } from "lucide-react";
import { useI18n } from "@/i18n/provider";
import { type BarRow } from "../BarRows";
import { ChangePill } from "../Delta";
import { ChartCard } from "../ChartCard";
import { InsightList } from "../InsightList";
import { RankedList } from "../RankedList";
import { formatValue, type ValueFormat } from "../chartTheme";
import { dimLabel } from "../overview-lib";
import type { OverviewData } from "../types";
import Link from "next/link";

type Mover = NonNullable<OverviewData["movers"]>["companies"]["up"][number];

function MoverList({ items, format, label, href }: { items: Mover[]; format: ValueFormat; label: (m: Mover) => string; href?: (m: Mover) => string }) {
  const { t, locale } = useI18n();
  if (!items.length) return <p className="text-sm text-muted">{t("rpf.mv_none")}</p>;
  return (
    <ol className="space-y-2.5">
      {items.map((m) => (
        <li key={m.id} className="flex items-center gap-3 text-sm">
          <span className="min-w-0 flex-1 truncate font-medium">{href ? <Link href={href(m)} className="text-accent hover:underline">{label(m)}</Link> : label(m)}</span>
          <span className="ltr-num shrink-0 text-xs tabular-nums text-muted">{formatValue(m.prev, format, locale, true)} → <span className="font-semibold text-ink">{formatValue(m.cur, format, locale, true)}</span></span>
          <ChangePill value={m.cur} prev={m.prev} />
        </li>
      ))}
    </ol>
  );
}

/** Rankings (top companies, top drivers), the biggest movers and the generated insights of the Overview. */
export function OverviewPeople({ data, cityName }: { data: OverviewData; cityName: (key: string) => string | undefined }) {
  const { t } = useI18n();
  const { rankings: rk, movers } = data;
  const byGmv = rk.companies.by === "gmv";
  const companyRows: BarRow[] = rk.companies.rows.map((c) => ({ key: c.id, label: c.name, value: c.value, prev: c.prev, href: `/admin/companies/${c.id}`, sub: c.orders != null ? t("rpf.rk_orders", { n: c.orders }) : undefined }));
  const driverRows: BarRow[] = rk.drivers.map((d) => ({ key: d.id, label: d.name, value: d.deliveries, prev: d.prev, href: `/admin/drivers/${d.id}`, tone: "cyan", sub: d.rating != null ? <span className="inline-flex items-center gap-1"><Star className="size-3 text-gold" aria-hidden /><span className="ltr-num">{d.rating}</span></span> : undefined }));
  const mformat: ValueFormat = movers?.by === "gmv" ? "money" : "number";
  return (
    <>
      <div className="grid gap-5 lg:grid-cols-2">
        <RankedList testId="rk-companies" title={t("rpf.sec_top_companies")} description={t(byGmv ? "rpf.rk_by_gmv" : "rpf.rk_by_requests")} rows={companyRows} format={byGmv ? "money" : "number"} />
        <RankedList testId="rk-drivers" title={t("rpf.sec_top_drivers")} description={t("rpf.rk_by_deliveries")} rows={driverRows} />
      </div>
      <div className="grid gap-5 lg:grid-cols-2">
        <InsightList testId="insights" title={t("rpf.sec_insights")} description={t("rpf.sec_insights_hint")} items={data.insights} />
        <ChartCard testId="movers" title={t("rpf.sec_movers")} description={movers ? t(movers.by === "gmv" ? "rpf.mv_by_gmv" : "rpf.mv_by_requests") : undefined} height="auto" name={t("rpf.sec_movers")}>
          {!movers ? <p className="text-sm text-muted">{t("rpf.mv_need_compare")}</p> : (
            <div className="space-y-5">
              {(["companies", "cities"] as const).map((g) => (
                <div key={g}>
                  <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted">{t(`rpf.mv_${g}`)}</h3>
                  <div className="grid gap-4 sm:grid-cols-2">
                    {(["up", "down"] as const).map((dir) => (
                      <div key={dir}><p className="mb-1.5 text-xs text-muted">{t(`rpf.mv_${dir}`)}</p>
                        <MoverList items={movers[g][dir]} format={mformat} label={(m) => (g === "cities" ? dimLabel("city", m.name, t, cityName) : m.name)} href={g === "companies" ? (m) => `/admin/companies/${m.id}` : undefined} />
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </ChartCard>
      </div>
    </>
  );
}
