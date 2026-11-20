"use client";
import { useState } from "react";
import { ArrowDownWideNarrow, ArrowUpNarrowWide, Link2Off } from "lucide-react";
import { Badge, Button, CellPair, ErrorState, Section, SearchBox, Segmented, Select, StatusBadge, Table, Td } from "@/components/ui";
import { useApi } from "@/components/ui/data";
import { Sparkline } from "@/components/reports";
import { fmtDate } from "@/lib/format";
import { fmtPercent } from "@/components/reports/chartTheme";
import { useI18n } from "@/i18n/provider";
import { hasPerm, useUser } from "@/components/layout/auth-context";
import { hasAny, qs, useDebounced, useTx } from "./admin-common";
import { UnlinkOfficeModal } from "./admin-drivers-actions";
import { ListEmpty, LoadingRows, Money, pagerFooter } from "./admin-offices-common";
import { DRIVER_STATES, apiFilter, driverSuspension, ratingText, type DriverState } from "./admin-offices-lib";
import { Ago, PeriodBar, secondsSince, usePeriod } from "./admin-driver-common";

const SIZE = 10;
const SORTS = ["jobs", "parcels", "success", "on_time", "acceptance", "rating", "no_shows", "earnings", "last_active", "name"] as const;
const pct = (v: number | null, l: "ar" | "en" | "ur") => (v == null ? "—" : fmtPercent(v, l, 0));

/**
 * Scorecard of an office's affiliated drivers: what each did for the office in the period (jobs, parcels, success, punctuality, acceptance, rating, no-shows, earnings),
 * an 8-week delivery trend, risk flags and the unlink action (`POST /admin/drivers/:id/unlink-office`, needs `offices.manage`). Sortable; the period lives in the URL.
 */
export function DriverScorecard({ id }: { id: string }) {
  const { t, locale } = useI18n(); const me = useUser(); const tx = useTx();
  const [period, setPeriod] = usePeriod("30d"); const [state, setState] = useState<DriverState>("all"); const [q, setQ] = useState(""); const dq = useDebounced(q.trim());
  const [sort, setSort] = useState<(typeof SORTS)[number]>("jobs"); const [dir, setDir] = useState<"asc" | "desc">("desc"); const [page, setPage] = useState(1);
  const [unlink, setUnlink] = useState<{ id: string; name: string } | null>(null);
  const office = useApi(`/admin/offices/${id}`);
  const { data, error, mutate } = useApi(`/admin/offices/${id}/scorecard${qs({ period, q: dq, state: apiFilter(state), sort, dir, page, pageSize: SIZE })}`, { keepPreviousData: true });
  const canOpen = hasAny(me, "drivers.view", "users.view"), canUnlink = hasPerm(me, "offices.manage");
  const rows: any[] = data?.items ?? []; const loading = !data && !error; const money = rows.some((r) => r.earningsCents !== undefined);
  const head = [t("adm.col_driver"), t("common.status"), { label: t("driver.completed"), align: "end" as const }, { label: t("dv2.col_parcels_delivered"), align: "end" as const }, { label: t("dv2.col_success"), align: "end" as const }, { label: t("dv2.col_on_time"), align: "end" as const },
    { label: t("dv2.col_acceptance"), align: "end" as const }, t("driver.rating"), { label: t("dv2.col_no_shows"), align: "end" as const }, ...(money ? [{ label: t("dv2.col_earning"), align: "end" as const }] : []), t("dv2.col_trend"), ...(canUnlink ? [{ label: t("adm.unlink_office"), srOnly: true }] : [])];
  const labels: Record<DriverState, string> = { all: t("common.all"), available: t("map.available"), pending: t("rdq.f_pending_verification"), suspended: t("status.suspended") };
  const filtered = state !== "all" || !!dq;
  if (error && !data) return <ErrorState error={error} retry={() => mutate()} />;
  const reload = () => { mutate(); office.mutate(); };
  return (
    <Section title={t("req.drivers")} description={t("dv2.scorecard_sub")} flush id="dv2-scorecard">
      <div className="space-y-1.5 border-b border-line px-4 py-3"><PeriodBar value={period} onChange={(p) => { setPeriod(p); setPage(1); }} />{data && <p className="text-xs text-muted">{t("dv2.scorecard_period", { from: fmtDate(`${data.period.from}T12:00:00+03:00`, locale), to: fmtDate(`${data.period.to}T12:00:00+03:00`, locale) })}</p>}</div>
      <Table stack bare dense label={t("req.drivers")} head={head}
        toolbar={<>
          <SearchBox value={q} onChange={(v) => { setQ(v); setPage(1); }} placeholder={t("rdq.search_drivers")} label={t("rdq.search_drivers")} />
          <Segmented label={t("common.status")} value={state} onChange={(k) => { setState(k as DriverState); setPage(1); }} options={DRIVER_STATES.map((k) => ({ key: k, label: labels[k] }))} />
          <div className="flex items-center gap-1.5">
            <div className="w-44"><Select aria-label={t("dv2.sort_by")} value={sort} onChange={(e) => { setSort(e.target.value as (typeof SORTS)[number]); setPage(1); }} options={SORTS.filter((s) => s !== "earnings" || money).map((s) => ({ value: s, label: t(`dv2.sort_${s}`) }))} /></div>
            <Button size="sm" variant="secondary" onClick={() => setDir((d) => (d === "desc" ? "asc" : "desc"))} aria-label={dir === "desc" ? t("dv2.sort_desc") : t("dv2.sort_asc")} data-testid="dv2-sort-dir">{dir === "desc" ? <ArrowDownWideNarrow className="size-4" aria-hidden /> : <ArrowUpNarrowWide className="size-4" aria-hidden />}</Button>
          </div>
        </>}
        empty={!loading && rows.length === 0 ? <ListEmpty filtered={filtered} onClear={() => { setQ(""); setState("all"); }} title={t("office.no_drivers")} hint={t("rdq.office_drivers_none_hint")} /> : undefined}
        footer={data ? pagerFooter(page, data.total, SIZE, setPage) : undefined}>
        {loading ? <LoadingRows cols={head.length} rows={4} /> : rows.map((d) => {
          const sus = driverSuspension({ suspendedUntil: d.suspendedUntil, status: d.status });
          return (
            <tr key={d.id} data-testid={`rdq-office-driver-${d.id}`}>
              <Td><CellPair title={d.name} href={canOpen ? `/admin/drivers/${d.id}` : undefined} sub={<span className="ltr-num">{d.phone ?? "—"}</span>} />
                <span className="mt-0.5 block text-xs text-muted">{d.vehicleType ? t(`vehicle.${d.vehicleType}`) : "—"} · {tx(`city.${d.city}`, d.city)} · <Ago seconds={secondsSince(d.lastSeenAt)} /></span>
                {d.flags.length > 0 && <span className="mt-1 flex flex-wrap gap-1" data-testid={`dv2-flags-${d.id}`}>{d.flags.map((f: string) => <Badge key={f} tone={f === "high_no_show" || f === "active_strikes" ? "danger" : "warn"}>{t(`dv2.flag_${f}`)}</Badge>)}</span>}</Td>
              <Td label={t("common.status")}><span className="inline-flex flex-wrap items-center gap-1">
                {d.onJob ? <Badge tone="info">{t("office.on_job")}</Badge> : <Badge tone={d.availability === "available" ? "success" : "neutral"}>{d.availability === "available" ? t("map.available") : t("adm.unavailable")}</Badge>}
                <StatusBadge status={d.verificationStatus} />{sus.active && <Badge tone="danger" className="whitespace-nowrap">{sus.until ? `${t("driver.suspended")} · ${fmtDate(sus.until, locale)}` : t("status.suspended")}</Badge>}</span></Td>
              <Td label={t("driver.completed")} num>{d.jobs}</Td><Td label={t("dv2.col_parcels_delivered")} num>{d.parcels}</Td>
              <Td label={t("dv2.col_success")} num>{pct(d.success, locale)}</Td><Td label={t("dv2.col_on_time")} num>{pct(d.onTime, locale)}</Td><Td label={t("dv2.col_acceptance")} num>{pct(d.acceptance, locale)}</Td>
              <Td label={t("driver.rating")}>{d.rating != null ? <span title={t("adm.ratings_n", { n: d.ratingCount })}>{ratingText(Math.round(d.rating * 10) / 10)}</span> : <span className="text-muted" title={t("dv2.rating_lifetime")}>{ratingText(d.ratingLifetime)}</span>}</Td>
              <Td label={t("dv2.col_no_shows")} num><span className={d.noShows ? "font-semibold text-danger" : undefined}>{d.noShows}</span></Td>
              {money && <Td label={t("dv2.col_earning")} align="end"><Money cents={d.earningsCents ?? 0} /></Td>}
              <Td label={t("dv2.col_trend")}><div className="w-24 text-accent/80" data-testid={`dv2-spark-${d.id}`}><Sparkline values={d.spark} /></div></Td>
              {canUnlink && <Td align="end"><Button size="sm" variant="ghost" data-testid={`rdq-office-unlink-${d.id}`} onClick={() => setUnlink({ id: d.id, name: d.name })}><Link2Off className="size-4" aria-hidden />{t("office.unlink")}</Button></Td>}
            </tr>
          );
        })}
      </Table>
      <UnlinkOfficeModal driver={unlink} office={office.data?.officeName ?? ""} onClose={() => setUnlink(null)} onDone={reload} />
    </Section>
  );
}
