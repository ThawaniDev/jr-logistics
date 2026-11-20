"use client";
import { useState } from "react";
import Link from "next/link";
import { Download, PackageSearch } from "lucide-react";
import { Button, CellPair, EmptyState, ErrorState, Input, Pagination, SearchBox, Segmented, Select, Table, Td, Toolbar, Badge } from "@/components/ui";
import { BreakdownTable, DonutChart, fmtDur, formatValue } from "@/components/reports";
import { useApi, useUrlState } from "@/components/ui/data";
import { fmtDateTime, fmtMoney, fmtNum } from "@/lib/format";
import { useI18n } from "@/i18n/provider";
import { hasPerm, useUser } from "@/components/layout/auth-context";
import { useDebounced, useTx } from "./admin-common";
import { useCompany, usePageFor } from "./admin-companies-ctx";
import { KpiTile } from "./admin-company-detail-kpis";
import { PARCEL_STATUSES, parcelQuery } from "./admin-company-detail-lib";

const PAGE = 25;
interface Parcel { id: string; code: string; externalRef: string | null; status: string; recipientName: string; recipientPhone: string | null; city: string; attempts: number; failReason: string | null; createdAt: string; deliveredAt: string | null;
  codCents: number | null; codCollectedCents: number | null; request: { id: string; ref: string }; driver: { id: string; name: string } | null }
interface Data { items: Parcel[]; page: number; pageSize: number; total: number; cities: string[]; moneyHidden: boolean;
  analytics: { total: number; byStatus: Record<string, number>; successRate: number | null; firstAttemptRate: number | null; avgAttempts: number | null; avgDeliverySecs: number | null;
    cod: { parcels: number; expectedCents: number; collectedCents: number } | null; failureReasons: Array<{ key: string; value: number }>; cities: Array<{ key: string; total: number; delivered: number; lost: number }> } }

const STATUS_BADGE: Record<string, "success" | "danger" | "warn" | "info" | "neutral"> = { delivered: "success", failed: "danger", returned: "warn", missing: "danger", loaded: "info", pending: "neutral", cancelled: "neutral" };

/** Parcels tab: analytics of every parcel the company registered (outcomes, rates, attempts, COD, failure reasons, cities) and the filtered list with a CSV export. */
export function CompanyParcels() {
  const { t, locale } = useI18n(); const tx = useTx(); const me = useUser(); const c = useCompany();
  const [status, setStatus] = useUrlState("status", "all"); const [city, setCity] = useUrlState("city"); const [from, setFrom] = useUrlState("from"); const [to, setTo] = useUrlState("to"); const [cod, setCod] = useUrlState("cod");
  const [q, setQ] = useState(""); const dq = useDebounced(q.trim());
  const [page, setPage] = usePageFor(`${dq}|${status}|${city}|${from}|${to}|${cod}`);
  const key = { status, city, q: dq, from, to, cod };
  const { data, error, mutate, isValidating } = useApi<Data>(`/admin/companies/${c.id}/parcels${parcelQuery({ ...key, page, pageSize: PAGE })}`, { keepPreviousData: true, shouldRetryOnError: false });
  const filtered = status !== "all" || !!dq || !!city || !!from || !!to || !!cod;
  const clear = () => { setQ(""); setStatus("all"); setCity(""); setFrom(""); setTo(""); setCod(""); };
  if (error && !data) return <ErrorState error={error} retry={() => mutate()} />;
  const a = data?.analytics, loading = !data;
  const by = a?.byStatus ?? {};
  const options = [{ key: "all", label: t("common.all"), count: a?.total }, ...PARCEL_STATUSES.filter((s) => (by[s] ?? 0) > 0 || s === status).map((s) => ({ key: s, label: t(`shipstatus.${s}`), count: by[s] ?? 0 }))];
  const lost = (by.failed ?? 0) + (by.returned ?? 0);
  const total = (xs: Array<{ total: number }>) => xs.reduce((n, x) => n + x.total, 0);
  return (
    <div className="space-y-5" data-testid="dv3-parcels">
      <div className="grid grid-cols-2 gap-2.5 sm:gap-3 lg:grid-cols-4">
        <KpiTile id="p-total" label={t("dv3.pk_total")} def={t("dv3.pd_total")} loading={loading} value={fmtNum(a?.total, locale)} hint={a ? t("dv3.pk_total_hint", { n: fmtNum(by.pending ?? 0, locale) }) : undefined} />
        <KpiTile id="p-success" label={t("dv3.k_success")} def={t("dv3.d_success")} num={t("dv3.dn_success")} den={t("dv3.dd_success")} loading={loading} value={formatValue(a?.successRate ?? null, "percent", locale)} hint={a ? t("dv3.h_outcomes", { n: fmtNum((by.delivered ?? 0) + lost, locale) }) : undefined} />
        <KpiTile id="p-first" label={t("dv3.pk_first")} def={t("dv3.pd_first")} loading={loading} value={formatValue(a?.firstAttemptRate ?? null, "percent", locale)} hint={a ? t("dv3.pk_first_hint", { n: fmtNum(by.delivered ?? 0, locale) }) : undefined} />
        <KpiTile id="p-attempts" label={t("dv3.pk_attempts")} def={t("dv3.pd_attempts")} loading={loading} value={a?.avgAttempts == null ? "—" : formatValue(a.avgAttempts, "rate", locale)} hint={a?.avgDeliverySecs != null ? t("dv3.pk_avg_time", { time: fmtDur(a.avgDeliverySecs, locale) }) : undefined} />
        {(a?.cod || loading) && !data?.moneyHidden && <>
          <KpiTile id="p-cod" label={t("dv3.pk_cod")} def={t("dv3.pd_cod")} loading={loading} value={fmtMoney(a?.cod?.expectedCents, locale)} hint={a?.cod ? t("dv3.pk_cod_hint", { n: fmtNum(a.cod.parcels, locale) }) : undefined} />
          <KpiTile id="p-cod-collected" label={t("dv3.pk_cod_collected")} def={t("dv3.pd_cod_collected")} loading={loading} value={fmtMoney(a?.cod?.collectedCents, locale)} />
        </>}
      </div>
      <div className="grid gap-5 lg:grid-cols-2">
        <DonutChart testId="dv3-parcels-reasons" title={t("dv3.ch_reasons")} description={t("dv3.ch_reasons_hint")} loading={loading} centerLabel={t("dv3.s_failed")} slices={(a?.failureReasons ?? []).map((r) => ({ key: r.key, label: tx(`stopfail.${r.key}`, r.key), value: r.value }))} />
        <BreakdownTable testId="dv3-parcels-cities" title={t("dv3.ch_parcel_cities")} description={t("dv3.ch_parcel_cities_hint")} loading={loading}
          rows={(a?.cities ?? []).map((r) => ({ key: r.key, label: tx(`city.${r.key}`, r.key), sub: t("dv3.city_split", { ok: fmtNum(r.delivered, locale), lost: fmtNum(r.lost, locale) }), value: r.total, share: total(a?.cities ?? []) ? r.total / total(a?.cities ?? []) : null, tone: r.lost > r.delivered ? "danger" : "accent" }))} />
      </div>
      <div>
        <Toolbar end={<>
          {data && <span className="text-sm text-muted" data-testid="dv3-parcels-count">{t("dv3.n_parcels", { n: fmtNum(data.total, locale) })}</span>}
          {hasPerm(me, "reports.export") && <a href={`/api/v1/admin/companies/${c.id}/parcels${parcelQuery({ ...key, format: "csv" })}`} data-testid="dv3-parcels-csv" download><Button variant="secondary" size="sm"><Download className="size-4" aria-hidden />{t("dv3.csv")}</Button></a>}
        </>}>
          <SearchBox value={q} onChange={setQ} placeholder={t("dv3.parcel_search")} label={t("dv3.parcel_search")} testId="dv3-parcels-search" />
          <Segmented label={t("common.status")} options={options} value={status} onChange={setStatus} />
        </Toolbar>
        <Toolbar>
          <div className="w-44"><Select aria-label={t("reg.city")} data-testid="dv3-parcels-city" placeholder={t("dv3.f_any_city")} value={city} onChange={(e) => setCity(e.target.value)} options={(data?.cities ?? []).map((x) => ({ value: x, label: tx(`city.${x}`, x) }))} /></div>
          <div className="w-44"><Select aria-label={t("dv3.pk_cod")} data-testid="dv3-parcels-cod" placeholder={t("dv3.f_any_cod")} value={cod} onChange={(e) => setCod(e.target.value)} options={[{ value: "yes", label: t("dv3.f_cod_yes") }, { value: "no", label: t("dv3.f_cod_no") }]} /></div>
          <div className="w-40"><Input aria-label={t("dv3.f_created_from")} type="date" ltr value={from} max={to || undefined} onChange={(e) => setFrom(e.target.value)} /></div>
          <div className="w-40"><Input aria-label={t("dv3.f_created_to")} type="date" ltr value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} /></div>
          {filtered && <Button variant="ghost" size="sm" onClick={clear}>{t("uxa.clear_filters")}</Button>}
        </Toolbar>
        {loading ? <div className="h-40 animate-pulse rounded-card bg-line/40" aria-busy="true" /> : data.items.length === 0 ? (
          filtered ? <EmptyState title={t("common.no_results")} hint={t("ubz.no_results_hint")} action={<Button variant="secondary" onClick={clear}>{t("uxa.clear_filters")}</Button>} />
            : <EmptyState title={t("dv3.no_parcels")} hint={t("dv3.no_parcels_hint")} icon={<PackageSearch className="size-9" aria-hidden />} />
        ) : (
          <div aria-busy={isValidating} className={isValidating ? "opacity-70 transition-opacity" : "transition-opacity"}>
            <Table stack label={t("dv3.tab_parcels")} head={[t("dv3.col_parcel"), t("dv3.col_recipient"), t("reg.city"), t("common.status"), { label: t("dv3.col_attempts"), align: "end" }, ...(data.moneyHidden ? [] : [{ label: t("dv3.pk_cod"), align: "end" as const }]), t("dv3.col_order"), t("adm.col_driver"), t("common.date")]}>
              {data.items.map((x) => (
                <tr key={x.id} data-testid="dv3-parcel-row">
                  <Td label={t("dv3.col_parcel")}><CellPair href={`/admin/parcels/${x.id}`} title={<span className="ltr-num font-semibold">{x.code}</span>} sub={x.externalRef ? <span className="ltr-num">{x.externalRef}</span> : undefined} /></Td>
                  <Td label={t("dv3.col_recipient")}><CellPair title={x.recipientName} sub={<span className="ltr-num">{x.recipientPhone}</span>} /></Td>
                  <Td label={t("reg.city")} className="text-muted">{tx(`city.${x.city}`, x.city)}</Td>
                  <Td label={t("common.status")}><div className="space-y-1"><Badge tone={STATUS_BADGE[x.status] ?? "neutral"}>{t(`shipstatus.${x.status}`)}</Badge>{x.failReason && <p className="text-xs text-muted">{tx(`stopfail.${x.failReason}`, x.failReason)}</p>}</div></Td>
                  <Td label={t("dv3.col_attempts")} num>{x.attempts}</Td>
                  {!data.moneyHidden && <Td label={t("dv3.pk_cod")} num>{x.codCents ? <span>{fmtMoney(x.codCents, locale)}{x.codCollectedCents != null && <span className="block text-xs text-muted">{t("dv3.collected", { amount: fmtMoney(x.codCollectedCents, locale) })}</span>}</span> : "—"}</Td>}
                  <Td label={t("dv3.col_order")} className="whitespace-nowrap"><Link href={`/admin/requests/${x.request.id}`} className="ltr-num text-accent hover:underline">{x.request.ref}</Link></Td>
                  <Td label={t("adm.col_driver")}>{x.driver ? (hasPerm(me, "drivers.view") ? <Link href={`/admin/drivers/${x.driver.id}`} className="text-accent hover:underline">{x.driver.name}</Link> : x.driver.name) : <span className="text-muted">—</span>}</Td>
                  <Td label={t("common.date")} className="whitespace-nowrap text-muted">{fmtDateTime(x.deliveredAt ?? x.createdAt, locale)}</Td>
                </tr>))}
            </Table>
            <Pagination page={data.page ?? page} total={data.total} pageSize={data.pageSize ?? PAGE} onPage={setPage} />
          </div>)}
      </div>
    </div>
  );
}
