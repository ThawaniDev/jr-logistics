"use client";
import { useState } from "react";
import Link from "next/link";
import { Segmented, Table, Td } from "@/components/ui";
import { useI18n } from "@/i18n/provider";
import { OPS_DIMS, type OpsDim } from "@/server/analytics/ops-kinds";
import { ChangePill } from "../Delta";
import { ChartCard } from "../ChartCard";
import { fmtDur, fmtPercent, formatValue } from "../chartTheme";
import { RankedList } from "../RankedList";
import type { OpsSectionProps } from "./OpsDemand";
import { CardFailed, SectionHead } from "./OpsParts";
import { dimKey } from "./ops-lib";

interface Line { key: string; name: string; href?: string; requests: number; prevRequests: number | null; fillRate: number | null; prevFillRate: number | null; slots: number; p50Fill: number | null; cancelled: number; expired: number; due: number | null; onTimeRate: number | null; acceptRate: number | null }

/** Performance by city, service, vehicle type or company: demand, fill rate, median time to fill, cancellations, punctuality and offer acceptance side by side, plus the slowest and latest. */
export function OpsGroups({ data, retry, cityName }: OpsSectionProps) {
  const { t, locale } = useI18n();
  const [dim, setDim] = useState<OpsDim>("city");
  const g = data.groups, bd = g?.breakdowns ?? null;
  const lines: Line[] | null = !g ? null : dim === "company"
    ? g.companies.map((c) => ({ key: c.id, name: c.name, href: `/admin/companies/${c.id}`, requests: c.requests, prevRequests: c.prevRequests, fillRate: c.fillRate, prevFillRate: c.prevFillRate, slots: c.slots, p50Fill: c.p50Fill, cancelled: c.cancelled, expired: c.expired, due: null, onTimeRate: null, acceptRate: null }))
    : bd ? bd[dim].map((r) => ({ key: r.key, name: dimKey(dim, r.key, t, cityName), requests: r.requests, prevRequests: r.prevRequests, fillRate: r.fillRate, prevFillRate: r.prevFillRate, slots: r.slots, p50Fill: r.p50Fill, cancelled: r.cancelled, expired: r.expired, due: r.due, onTimeRate: r.onTimeRate, acceptRate: r.acceptRate })) : null;
  const rk = g?.rankings;
  const slow = (rows: Array<{ key: string; name: string; value: number; n: number }>, kind: "company" | "city" | "driver") => rows.map((r) => ({
    key: r.key, label: kind === "city" ? dimKey("city", r.key, t, cityName) : r.name, value: r.value, tone: "gold" as const, sub: t(kind === "driver" ? "rpo.rk_jobs" : "rpo.rk_requests", { n: r.n }),
    href: kind === "company" ? `/admin/companies/${r.key}` : kind === "driver" ? `/admin/drivers/${r.key}` : undefined,
  }));
  const num = (n: number) => <span className="ltr-num">{formatValue(n, "number", locale)}</span>;
  return (
    <>
      <SectionHead id="ops-groups" title={t("rpo.s_groups")} hint={t("rpo.s_groups_hint")} />
      {lines ? (
        <ChartCard testId="tbl-groups" title={t("rpo.c_groups")} description={dim === "company" ? t("rpo.c_groups_company_hint") : t("rpo.c_groups_hint")} height="auto" empty={lines.length === 0}
          actions={<Segmented label={t("rpo.c_groups")} value={dim} onChange={(k) => setDim(k as OpsDim)} options={OPS_DIMS.map((d) => ({ key: d, label: t(`rpo.dim_${d}`) }))} />}>
          <Table bare dense stack label={t("rpo.c_groups")} head={[t(`rpo.dim_${dim}`), { label: t("rpo.col_requests"), align: "end" }, { label: t("rpo.col_fill"), align: "end" }, { label: t("rpo.col_median_fill"), align: "end" }, { label: t("rpo.col_unmet"), align: "end" },
            ...(dim === "company" ? [] : [{ label: t("rpo.col_on_time"), align: "end" as const }, { label: t("rpo.col_accept"), align: "end" as const }])]}>
            {lines.map((l) => (
              <tr key={l.key} data-testid="groups-row">
                <Td label={t(`rpo.dim_${dim}`)} className="font-medium">{l.href ? <Link href={l.href} className="text-accent hover:underline">{l.name}</Link> : l.name}</Td>
                <Td num label={t("rpo.col_requests")}><span className="inline-flex flex-col items-end gap-0.5">{num(l.requests)}<ChangePill value={l.requests} prev={l.prevRequests} /></span></Td>
                <Td num label={t("rpo.col_fill")}><span className="inline-flex flex-col items-end gap-0.5" title={t("rpo.fill_of_slots", { n: l.slots })}>{l.fillRate == null ? "—" : fmtPercent(l.fillRate, locale, 0)}<ChangePill value={l.fillRate} prev={l.prevFillRate} /></span></Td>
                <Td num label={t("rpo.col_median_fill")}>{l.p50Fill == null ? "—" : fmtDur(l.p50Fill, locale)}</Td>
                <Td num label={t("rpo.col_unmet")}>{num(l.cancelled + l.expired)}</Td>
                {dim !== "company" && <Td num label={t("rpo.col_on_time")}>{l.onTimeRate == null ? "—" : fmtPercent(l.onTimeRate, locale, 0)}</Td>}
                {dim !== "company" && <Td num label={t("rpo.col_accept")}>{l.acceptRate == null ? "—" : fmtPercent(l.acceptRate, locale, 0)}</Td>}
              </tr>
            ))}
          </Table>
        </ChartCard>
      ) : <CardFailed title={t("rpo.c_groups")} onRetry={retry} testId="tbl-groups" />}
      <div className="grid gap-5 lg:grid-cols-3">
        {rk ? <RankedList testId="rk-slow-companies" title={t("rpo.c_slow_companies")} description={t("rpo.c_slow_hint")} rows={slow(rk.slowCompanies, "company")} format="duration" good="lower" /> : <CardFailed title={t("rpo.c_slow_companies")} onRetry={retry} testId="rk-slow-companies" />}
        {rk ? <RankedList testId="rk-slow-cities" title={t("rpo.c_slow_cities")} description={t("rpo.c_slow_hint")} rows={slow(rk.slowCities, "city")} format="duration" good="lower" /> : <CardFailed title={t("rpo.c_slow_cities")} onRetry={retry} testId="rk-slow-cities" />}
        {rk ? <RankedList testId="rk-late-drivers" title={t("rpo.c_late_drivers")} description={t("rpo.c_late_drivers_hint")} rows={slow(rk.lateDrivers, "driver")} format="duration" good="lower" /> : <CardFailed title={t("rpo.c_late_drivers")} onRetry={retry} testId="rk-late-drivers" />}
      </div>
    </>
  );
}
