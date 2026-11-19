"use client";
import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Banknote, CheckCircle2, Hourglass, Star, Truck, Users } from "lucide-react";
import { Breadcrumbs, Button, CellPair, DetailHeader, EmptyState, ErrorState, PageLoading, Notice, Section, Skeleton, Stat, StatGrid, StatusBadge, Table, Td } from "@/components/ui";
import { useApi } from "@/components/ui/data";
import { fmtDate, fmtDateTime, fmtMoney, fmtNum } from "@/lib/format";
import { useI18n } from "@/i18n/provider";
import { useAllRows } from "./office-data";
import { DriverStatus } from "./office-drivers";
import { UnlinkDriverModal } from "./office-invite";
import { ParcelBar, linkBtn } from "./office-shared";
import { SETTLEMENT_OPEN, sumBy, type OfficeDriver, type OfficeJob, type OfficeSettlement } from "./office-lib";

const SHOWN = 10;

/** One driver of the office: who he is, what he is doing now, his jobs and what he earned for the office. All from the office's existing endpoints. */
export function OfficeDriverDetail({ id }: { id: string }) {
  const { t, locale } = useI18n(); const router = useRouter();
  const [unlink, setUnlink] = useState(false);
  const drivers = useApi<{ items: OfficeDriver[] }>("/office/drivers", { refreshInterval: 30_000, revalidateOnFocus: true });
  const jobsAll = useAllRows<OfficeJob>("/office/jobs?scope=all", { refreshInterval: 30_000 });
  const setAll = useAllRows<OfficeSettlement>("/office/settlements");
  const d = drivers.data?.items.find((x) => x.id === id);
  const jobs = useMemo(() => (jobsAll.data?.items ?? []).filter((j) => j.driverId === id), [jobsAll.data, id]);
  const sets = useMemo(() => (setAll.data?.items ?? []).filter((s) => s.driverId === id), [setAll.data, id]);
  const activeRef = d?.activeOfferId ? jobsAll.data?.items.find((j) => j.offerId === d.activeOfferId)?.ref : undefined;

  const crumbs = (name?: string) => [{ label: t("nav.drivers"), href: "/office/drivers" }, ...(name ? [{ label: name }] : [])];
  if (drivers.error && !drivers.data) return <><Breadcrumbs items={crumbs()} /><ErrorState error={drivers.error} retry={() => drivers.mutate()} /></>;
  if (!drivers.data) return <PageLoading />;
  if (!d) return <><Breadcrumbs items={crumbs()} /><EmptyState icon={<Users className="size-9" aria-hidden />} title={t("rdo.drv_missing")} hint={t("rdo.drv_missing_hint")} action={<Link href="/office/drivers"><Button variant="secondary">{t("nav.drivers")}</Button></Link>} /></>;

  const paid = sumBy(sets.filter((s) => s.status === "paid"), (s) => s.amountCents);
  const pending = sumBy(sets.filter((s) => SETTLEMENT_OPEN.includes(s.status)), (s) => s.amountCents);
  const money = (c: number) => <span className="ltr-num">{fmtMoney(c, locale)}</span>;
  const loadingJobs = !jobsAll.data && !jobsAll.error, loadingSets = !setAll.data && !setAll.error;
  const vehicle = [d.vehicleType ? t(`vehicle.${d.vehicleType}`) : "", d.vehicleTemperature ? t(`temp.${d.vehicleTemperature}`) : ""].filter(Boolean).join(" · ") || "—";

  return (
    <>
      <Breadcrumbs items={crumbs(d.name)} />
      <DetailHeader name={d.name} subtitle={<span className="ltr-num">{d.phone}</span>}
        badges={<><StatusBadge status={d.verificationStatus} /><DriverStatus d={d} jobRef={activeRef} /></>}
        facts={[{ label: t("wizard.vehicle"), value: vehicle }, { label: t("rdo.drv_city"), value: d.city ? t(`city.${d.city}`) : "—" }, { label: t("driver.rating"), value: d.rating != null ? <span className="ltr-num">★ {d.rating}</span> : "—" }, { label: t("rdo.col_jobs_done"), value: <span className="ltr-num">{fmtNum(d.jobsCompleted, locale)}</span> }]}
        actions={<>
          {d.activeOfferId && <Link href={`/office/jobs/${d.activeOfferId}`} className={linkBtn} data-testid="office-driver-follow"><Truck className="me-1.5 size-4" aria-hidden />{t("ux.d_office_follow")}</Link>}
          <Button variant="danger" size="sm" disabled={d.onJob} title={d.onJob ? t("ux.d_office_unlink_busy") : undefined} onClick={() => setUnlink(true)} data-testid="office-driver-unlink">{t("office.unlink")}</Button>
        </>} />
      {d.verificationStatus !== "verified" && <div className="mb-5"><Notice tone="warn">{t("office.driver_unverified_hint")}</Notice></div>}

      <StatGrid cols={4} className="mb-5">
        <Stat label={t("driver.completed")} value={fmtNum(d.jobsCompleted, locale)} icon={<CheckCircle2 className="size-5" />} hint={t("rdo.dd_completed_hint")} />
        <Stat label={t("rdo.dd_current")} value={d.onJob ? <span className="ltr-num">{activeRef ?? "…"}</span> : t("rdo.dd_none")} icon={<Truck className="size-5" />} tone="cyan" hint={d.onJob ? t("rdo.dd_current_hint") : t("rdo.dd_idle_hint")} href={d.activeOfferId ? `/office/jobs/${d.activeOfferId}` : undefined} />
        <Stat label={t("rdo.dd_paid")} value={money(paid)} loading={loadingSets} icon={<Banknote className="size-5" />} hint={t("rdo.dd_paid_hint")} />
        <Stat label={t("rdo.dd_pending")} value={money(pending)} loading={loadingSets} icon={<Hourglass className="size-5" />} tone="gold" hint={t("rdo.dd_pending_hint")} />
      </StatGrid>

      <div className="space-y-5">
        <Section title={t("nav.jobs")} flush description={t("rdo.dd_jobs_sub")} actions={jobs.length > SHOWN ? <Link href={`/office/jobs?status=all&q=${encodeURIComponent(d.name)}`} className="text-sm font-semibold text-cyan hover:underline">{t("common.view_all")}</Link> : undefined}>
          {loadingJobs ? <div className="space-y-3 p-5"><Skeleton className="h-10" /><Skeleton className="h-10" /></div> : jobsAll.error && !jobsAll.data ? <div className="p-5"><ErrorState error={jobsAll.error} retry={() => jobsAll.mutate()} /></div> : jobs.length === 0 ? <div className="p-5"><EmptyState icon={<Truck className="size-9" aria-hidden />} title={t("jobs.empty")} hint={t("rdo.dd_jobs_empty")} /></div> : (
            <Table bare stack dense label={t("nav.jobs")} head={[t("req.ref"), t("req.starts"), t("rdo.col_progress"), t("common.status")]}>
              {jobs.slice(0, SHOWN).map((j) => (
                <tr key={j.offerId} data-testid="office-driver-job">
                  <Td label={t("req.ref")}><CellPair href={`/office/jobs/${j.offerId}`} title={<span className="ltr-num">{j.ref}</span>} sub={j.business ?? undefined} /></Td>
                  <Td label={t("req.starts")}><CellPair title={fmtDateTime(j.startsAt, locale)} sub={`${t(`city.${j.pickupCity}`)} → ${t(`city.${j.deliveryCity}`)}`} /></Td>
                  <Td label={t("rdo.col_progress")}><ParcelBar parcels={j.parcels} /></Td>
                  <Td label={t("common.status")}><StatusBadge status={j.status} ns="jobstatus" /></Td>
                </tr>
              ))}
            </Table>
          )}
        </Section>

        <Section title={t("rdo.dd_earnings")} flush description={t("rdo.dd_earnings_sub")} actions={sets.length > SHOWN ? <Link href={`/office/settlements?q=${encodeURIComponent(d.name)}`} className="text-sm font-semibold text-cyan hover:underline">{t("common.view_all")}</Link> : undefined}>
          {loadingSets ? <div className="space-y-3 p-5"><Skeleton className="h-10" /><Skeleton className="h-10" /></div> : setAll.error && !setAll.data ? <div className="p-5"><ErrorState error={setAll.error} retry={() => setAll.mutate()} /></div> : sets.length === 0 ? <div className="p-5"><EmptyState icon={<Star className="size-9" aria-hidden />} title={t("office.no_settlements")} hint={t("rdo.dd_earnings_empty")} /></div> : (
            <Table bare stack dense label={t("rdo.dd_earnings")} head={[t("req.ref"), { label: t("units.final"), align: "end" }, { label: t("common.amount"), align: "end" }, t("common.status"), t("office.paid_on")]}>
              {sets.slice(0, SHOWN).map((s) => (
                <tr key={s.id} data-testid="office-driver-settlement">
                  <Td label={t("req.ref")}><CellPair href={`/office/jobs?status=all&q=${encodeURIComponent(s.ref)}`} title={<span className="ltr-num">{s.ref}</span>} sub={fmtDate(s.createdAt, locale)} /></Td>
                  <Td label={t("units.final")} num>{s.finalUnits != null ? fmtNum(s.finalUnits, locale) : "—"}</Td>
                  <Td label={t("common.amount")} num className="whitespace-nowrap font-semibold">{fmtMoney(s.amountCents, locale)}</Td>
                  <Td label={t("common.status")}><StatusBadge status={s.status} ns="settle" /></Td>
                  <Td label={t("office.paid_on")} className="whitespace-nowrap text-muted">{fmtDate(s.paidAt, locale)}</Td>
                </tr>
              ))}
            </Table>
          )}
        </Section>
      </div>
      <UnlinkDriverModal driver={unlink ? { id: d.id, name: d.name } : null} onClose={() => setUnlink(false)} onDone={() => router.push("/office/drivers")} />
    </>
  );
}
