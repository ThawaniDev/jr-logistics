"use client";
import { useState } from "react";
import Link from "next/link";
import { CircleCheck, ShieldAlert, ShieldCheck, Truck } from "lucide-react";
import { Badge, CellPair, ErrorState, PageHeader, SearchBox, Segmented, Select, Stat, StatGrid, StatusBadge, Table, Td } from "@/components/ui";
import { useApi, useUrlState } from "@/components/ui/data";
import { fmtDate } from "@/lib/format";
import { useI18n } from "@/i18n/provider";
import { useUser } from "@/components/layout/auth-context";
import { hasAny, qs, useDebounced, useTx } from "./admin-common";
import { LiftSuspensionButton } from "./admin-drivers-actions";
import { ListEmpty, LoadingRows, RowLink, pagerFooter } from "./admin-offices-common";
import { DRIVER_STATES, apiFilter, driverSuspension, parseDriverLink, parseDriverState, ratingText } from "./admin-offices-lib";

const SIZE = 25;

/** `/admin/drivers`: KPI row, filters (state + affiliation, deep-linkable) and the directory. Phones are masked unless the API says otherwise (`drivers.sensitive`). */
export function DriversList() {
  const { t, locale } = useI18n(); const me = useUser(); const tx = useTx();
  const [stateRaw, setState] = useUrlState("state", "all"); const [linkRaw, setLink] = useUrlState("link");
  const state = parseDriverState(stateRaw), link = parseDriverLink(linkRaw);
  const [q, setQ] = useState(""); const dq = useDebounced(q.trim()); const [page, setPage] = useState(1);
  const sum = useApi("/admin/drivers-summary", { keepPreviousData: true });
  const list = useApi(`/admin/drivers-list${qs({ q: dq, state: apiFilter(state), link, page, pageSize: SIZE })}`, { keepPreviousData: true });
  const s = sum.data; const rows: any[] = list.data?.items ?? []; const loading = !list.data && !list.error;
  const canOffice = hasAny(me, "offices.view", "offices.manage");
  const filtered = state !== "all" || !!link || !!dq;
  const reset = () => { setQ(""); setState("all"); setLink(""); setPage(1); };
  const n = (v: number | undefined) => (sum.error ? "—" : v ?? 0); const sl = !s && !sum.error;
  const labels: Record<string, string> = { all: t("common.all"), available: t("map.available"), pending: t("rdq.f_pending_verification"), suspended: t("status.suspended") };
  const head = [t("adm.col_driver"), t("wizard.vehicle"), t("driver.rating"), t("role.office"), t("verify.title"), t("common.status"), t("adm.availability"), { label: t("rdq.col_actions"), srOnly: true }];
  return (
    <>
      <PageHeader title={t("nav.drivers")} subtitle={t("rdq.drivers_sub")} icon={<Truck className="size-5" />} />
      <section aria-label={t("rdq.kpis")} className="mb-5">
        <StatGrid cols={4}>
          <Stat label={t("rdq.kpi_drivers_total")} value={n(s?.total)} loading={sl} icon={<Truck className="size-5" />} href="/admin/drivers" tone="accent" hint={s ? t("rdq.drivers_split", { office: s.withOffice, direct: s.direct }) : undefined} />
          <Stat label={t("rdq.kpi_available")} value={n(s?.available)} loading={sl} icon={<CircleCheck className="size-5" />} href="/admin/drivers?state=available" tone="cyan" hint={t("rdq.kpi_available_hint")} />
          <Stat label={t("rdq.f_pending_verification")} value={n(s?.pending)} loading={sl} icon={<ShieldCheck className="size-5" />} href="/admin/drivers?state=pending" tone={s?.pending ? "gold" : "muted"} hint={t("rdq.kpi_pending_hint")} />
          <Stat label={t("status.suspended")} value={n(s?.suspended)} loading={sl} icon={<ShieldAlert className="size-5" />} href="/admin/drivers?state=suspended" tone={s?.suspended ? "danger" : "muted"} hint={t("rdq.kpi_suspended_drivers_hint")} />
        </StatGrid>
      </section>
      {list.error && !list.data ? <ErrorState error={list.error} retry={() => list.mutate()} /> : (
        <Table stack label={t("nav.drivers")} head={head}
          toolbar={<>
            <SearchBox value={q} onChange={(v) => { setQ(v); setPage(1); }} placeholder={t("rdq.search_drivers")} label={t("rdq.search_drivers")} />
            <Segmented label={t("common.status")} value={state} onChange={(k) => { setState(k); setPage(1); }} options={DRIVER_STATES.map((k) => ({ key: k, label: labels[k], count: k === "all" ? s?.total : s?.[k] }))} />
            <div className="w-48"><Select aria-label={t("role.office")} placeholder={t("rdq.link_any")} value={link} onChange={(e) => { setLink(e.target.value); setPage(1); }} options={[{ value: "office", label: t("rdq.link_office") }, { value: "direct", label: t("adm.direct") }]} /></div>
          </>}
          empty={!loading && rows.length === 0 ? <ListEmpty filtered={filtered} onClear={reset} title={t("rdq.drivers_none")} hint={t("rdq.drivers_none_hint")} /> : undefined}
          footer={list.data ? pagerFooter(page, list.data.total, SIZE, setPage) : undefined}>
          {loading ? <LoadingRows cols={head.length} /> : rows.map((d) => {
            const sus = driverSuspension(d);
            return (
              <tr key={d.id} data-testid={`rdq-driver-row-${d.id}`}>
                <Td><CellPair title={d.name} href={`/admin/drivers/${d.id}`} sub={<span className="ltr-num">{d.phone ?? "—"}</span>} /></Td>
                <Td label={t("wizard.vehicle")}><CellPair title={d.vehicleType ? t(`vehicle.${d.vehicleType}`) : "—"} sub={tx(`city.${d.city}`, d.city)} /></Td>
                <Td label={t("driver.rating")}><CellPair title={ratingText(d.rating)} sub={t("rdq.n_jobs", { n: d.jobsCompleted })} /></Td>
                <Td label={t("role.office")}>{d.officeId ? (canOffice ? <Link href={`/admin/offices/${d.officeId}`} className="text-accent hover:underline">{d.office ?? "—"}</Link> : d.office ?? "—") : <Badge>{t("adm.direct")}</Badge>}</Td>
                <Td label={t("verify.title")}><StatusBadge status={d.verificationStatus} /></Td>
                <Td label={t("common.status")}>{sus.active ? <div><Badge tone="danger">{t("status.suspended")}</Badge>{sus.until && <p className="mt-0.5 text-xs text-muted">{t("rdq.until", { d: fmtDate(sus.until, locale) })}</p>}</div> : <StatusBadge status={d.status} />}</Td>
                <Td label={t("adm.availability")}>{d.onJob ? <Badge tone="info">{t("office.on_job")}</Badge> : <Badge tone={d.availability === "available" ? "success" : "neutral"}>{d.availability === "available" ? t("map.available") : t("adm.unavailable")}</Badge>}</Td>
                <Td align="end"><div className="flex items-center justify-end gap-1">{sus.active && !sus.account && <LiftSuspensionButton driverId={d.id} name={d.name} onDone={() => { list.mutate(); sum.mutate(); }} />}<RowLink href={`/admin/drivers/${d.id}`} label={t("rdq.open_named", { name: d.name })} testid={`rdq-driver-open-${d.id}`} /></div></Td>
              </tr>
            );
          })}
        </Table>
      )}
    </>
  );
}
