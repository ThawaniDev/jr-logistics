"use client";
import { Suspense, useMemo, useState } from "react";
import Link from "next/link";
import { CheckCircle2, MailPlus, ShieldAlert, Truck, UserPlus, Users } from "lucide-react";
import { Badge, Button, CellPair, EmptyState, ErrorState, PageHeader, PageLoading, Pagination, SearchBox, Segmented, Stat, StatGrid, StatusBadge, Table, Td } from "@/components/ui";
import { useApi, useUrlState } from "@/components/ui/data";
import { fmtNum } from "@/lib/format";
import { useI18n } from "@/i18n/provider";
import { InviteDriverModal, InvitesTable, UnlinkDriverModal, type Invite } from "./office-invite";
import { NotReadyNotice, ParcelBar, linkBtn } from "./office-shared";
import { DRIVER_STATES, driverCounts, driverMatches, isDriverState, matchesQuery, paginate, type DriverState, type OfficeDriver, type OfficeJob } from "./office-lib";

const PAGE = 25;
const live = { refreshInterval: 30_000, revalidateOnFocus: true };

/** What the driver is doing right now, as one badge: on a job (a link to follow it), online or offline. */
export function DriverStatus({ d, jobRef }: { d: Pick<OfficeDriver, "onJob" | "availability" | "activeOfferId">; jobRef?: string }) {
  const { t } = useI18n();
  if (d.onJob) {
    const badge = <Badge tone="warn">{t("office.on_job")}{jobRef && <> · <span className="ltr-num">{jobRef}</span></>}</Badge>;
    return d.activeOfferId ? <Link href={`/office/jobs/${d.activeOfferId}`} className="inline-flex min-h-9 items-center">{badge}</Link> : badge;
  }
  return d.availability === "available" ? <Badge tone="success">{t("rdo.st_online")}</Badge> : <Badge>{t("rdo.st_offline")}</Badge>;
}

function Drivers() {
  const { t, locale } = useI18n();
  const [stateRaw, setState] = useUrlState("state", "all"); const [invite, setInvite] = useUrlState("invite", "");
  const state: DriverState = isDriverState(stateRaw) ? stateRaw : "all";
  const [q, setQ] = useState(""); const [page, setPage] = useState(1);
  const [unlink, setUnlink] = useState<null | { id: string; name: string }>(null);
  const drivers = useApi<{ items: OfficeDriver[] }>("/office/drivers", live);
  const active = useApi<{ items: OfficeJob[] }>("/office/jobs?scope=active", live); // the reference of the job each busy driver is on
  const invites = useApi<{ items: Invite[] }>("/office/invites");
  const dash = useApi("/office/dashboard");

  const items = drivers.data?.items;
  const inv = invites.data?.items;
  const counts = useMemo(() => driverCounts(items ?? [], inv?.length ?? 0), [items, inv]);
  const refOf = useMemo(() => new Map((active.data?.items ?? []).map((j) => [j.offerId, j.ref])), [active.data]);
  const rows = useMemo(() => (items ?? []).filter((d) => driverMatches(d, state) && matchesQuery(q, d.name, d.phone, d.city, d.vehicleType)), [items, state, q]);
  const inviteRows = useMemo(() => (inv ?? []).filter((i) => matchesQuery(q, i.phone)), [inv, q]);

  if (drivers.error && !items) return <ErrorState error={drivers.error} retry={() => drivers.mutate()} />;
  if (!items) return <PageLoading />;
  const refresh = () => { void drivers.mutate(); void invites.mutate(); };
  const href = (s: DriverState) => (s === "all" ? "/office/drivers" : `/office/drivers?state=${s}`);
  const pick = (s: string) => { setState(s); setPage(1); };
  const pageNo = Math.min(page, Math.max(1, Math.ceil(rows.length / PAGE)));
  const filtered = !!q || state !== "all";
  const toolbar = (
    <>
      <SearchBox value={q} onChange={(v) => { setQ(v); setPage(1); }} placeholder={t("rdo.drv_search")} label={t("rdo.drv_search")} />
      <Segmented label={t("common.status")} value={state} onChange={pick} options={DRIVER_STATES.map((s) => ({ key: s, label: t(`rdo.drv_s_${s}`), count: counts[s] }))} />
    </>
  );
  const inviteBtn = <Button onClick={() => setInvite("1")} data-testid="office-invite"><UserPlus className="size-4" aria-hidden />{t("office.invite_driver")}</Button>;

  return (
    <>
      <PageHeader title={t("nav.drivers")} subtitle={t("office.drivers_sub")} actions={inviteBtn} />
      {dash.data && dash.data.readiness.verification !== "verified" && <div className="mb-5"><NotReadyNotice verification={dash.data.readiness.verification} /></div>}
      <StatGrid cols={5} className="mb-5">
        <Stat label={t("office.drivers_total")} value={fmtNum(counts.all, locale)} icon={<Users className="size-5" />} hint={t("rdo.kpi_all_hint")} href={href("all")} />
        <Stat label={t("office.drivers_free")} value={fmtNum(counts.available, locale)} icon={<CheckCircle2 className="size-5" />} tone="cyan" hint={t("rdo.kpi_free_hint")} href={href("available")} />
        <Stat label={t("office.on_job")} value={fmtNum(counts.on_job, locale)} icon={<Truck className="size-5" />} hint={t("rdo.kpi_busy_hint")} href={href("on_job")} />
        <Stat label={t("rdo.drv_s_unverified")} value={fmtNum(counts.unverified, locale)} icon={<ShieldAlert className="size-5" />} tone={counts.unverified > 0 ? "gold" : "muted"} hint={t("rdo.kpi_unverified_hint")} href={href("unverified")} />
        <Stat label={t("office.pending_invites")} value={fmtNum(counts.invited, locale)} icon={<MailPlus className="size-5" />} tone="muted" hint={t("rdo.kpi_invited_hint")} href={href("invited")} />
      </StatGrid>

      {items.length === 0 && (inv?.length ?? 0) === 0 ? (
        <EmptyState icon={<Users className="size-9" aria-hidden />} title={t("office.no_drivers")} hint={t("office.no_drivers_hint")} action={inviteBtn} />
      ) : state === "invited" ? (
        <InvitesTable invites={inviteRows} total={inv?.length ?? 0} toolbar={toolbar} onChange={refresh} onInvite={() => setInvite("1")} />
      ) : (
        <>
          {state === "all" && !q && counts.invited > 0 && (
            <p className="mb-3 text-sm text-muted">{t("rdo.invites_waiting", { n: counts.invited })} <button type="button" className="font-semibold text-cyan hover:underline" onClick={() => pick("invited")}>{t("rdo.view_invites")}</button></p>
          )}
          <Table stack label={t("nav.drivers")} toolbar={toolbar} head={[t("office.driver"), t("wizard.vehicle"), t("verify.title"), t("common.status"), { label: t("rdo.col_jobs_done"), align: "end" }, { label: t("rdo.col_actions"), srOnly: true }]}
            empty={rows.length === 0 ? <EmptyState icon={<Users className="size-9" aria-hidden />} title={t("common.no_results")} hint={t("rdo.drv_no_match")} action={filtered ? <Button variant="secondary" onClick={() => { setQ(""); pick("all"); }}>{t("rdo.clear_filters")}</Button> : undefined} /> : null}>
            {paginate(rows, pageNo, PAGE).map((d) => (
              <tr key={d.id} data-testid="office-driver-row" data-driver={d.id}>
                <Td label={t("office.driver")}><CellPair href={`/office/drivers/${d.id}`} title={<>{d.name}{d.rating != null && <span className="ms-2 text-xs font-normal text-gold"><span aria-hidden>★</span> <span className="ltr-num">{d.rating}</span></span>}</>} sub={<span className="ltr-num">{d.phone}</span>} /></Td>
                <Td label={t("wizard.vehicle")}><CellPair title={d.vehicleType ? t(`vehicle.${d.vehicleType}`) : "—"} sub={[d.vehicleTemperature ? t(`temp.${d.vehicleTemperature}`) : "", d.city ? t(`city.${d.city}`) : ""].filter(Boolean).join(" · ") || undefined} /></Td>
                <Td label={t("verify.title")}><div className="flex flex-col items-end gap-1 sm:items-start"><StatusBadge status={d.verificationStatus} />{d.verificationStatus !== "verified" && <p className="max-w-52 text-xs text-muted">{t("office.driver_unverified_hint")}</p>}</div></Td>
                <Td label={t("common.status")}><div className="flex flex-col items-end gap-1.5 sm:items-start"><DriverStatus d={d} jobRef={d.activeOfferId ? refOf.get(d.activeOfferId) : undefined} />{d.onJob && <ParcelBar parcels={d.parcels} />}</div></Td>
                <Td label={t("rdo.col_jobs_done")} num>{fmtNum(d.jobsCompleted, locale)}</Td>
                <Td align="end"><div className="flex flex-wrap items-center justify-end gap-2">
                  <Link href={`/office/drivers/${d.id}`} className={linkBtn}>{t("common.open")}</Link>
                  <Button size="sm" variant="ghost" disabled={d.onJob} title={d.onJob ? t("ux.d_office_unlink_busy") : undefined} aria-label={`${t("office.unlink")} ${d.name}`} onClick={() => setUnlink({ id: d.id, name: d.name })}>{t("office.unlink")}</Button>
                </div></Td>
              </tr>
            ))}
          </Table>
          <Pagination page={pageNo} total={rows.length} pageSize={PAGE} onPage={setPage} />
        </>
      )}

      <UnlinkDriverModal driver={unlink} onClose={() => setUnlink(null)} onDone={refresh} />
      <InviteDriverModal open={invite === "1"} onClose={() => setInvite("")} onDone={refresh} />
    </>
  );
}
export function OfficeDrivers() { return <Suspense fallback={<PageLoading />}><Drivers /></Suspense>; }
