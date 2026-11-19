"use client";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import { CheckCircle2, Clock, Package, PackageX, Truck, Undo2 } from "lucide-react";
import { Badge, Breadcrumbs, Button, DetailHeader, EmptyState, ErrorState, InfoGrid, Notice, PageLoading, Pagination, ProgressBar, Section, Skeleton, Stat, StatGrid, StatusBadge, Table, Td } from "@/components/ui";
import { useApi } from "@/components/ui/data";
import { ApiError } from "@/lib/api";
import { JobChat } from "./chat";
import { Timeline, type TimelineEvent } from "./timeline";
import { ReplaceJobModal } from "./office-jobs";
import { CLOSED_JOB, REPLACEABLE_JOB, parcelPct, type Parcels } from "./office-lib";
import { parcelProgress } from "./office-shared";
import { fmtDateTime, fmtNum } from "@/lib/format";
import { useI18n } from "@/i18n/provider";

interface Stop { seq: number; stopOrder: number | null; code: string; status: string; failReason: string | null; deliveredAt: string | null; failedAt: string | null; returnedAt: string | null }
interface JobDetail {
  offerId: string; ref: string; service: string; status: string; requestStatus: string; driver: string; driverId: string; business: string | null; startsAt: string; durationDays: number | null;
  pickupCity: string; deliveryCity: string; vehicleType: string | null; expectedUnits: number; loadedUnits: number | null; deliveredUnits: number | null; finalUnits: number | null;
  acceptedAt: string | null; arrivedAt: string | null; routeApprovedAt: string | null; cancelReason: string | null; manifest: boolean; parcels: Parcels | null; stops: Stop[]; lastActivityAt: string;
}
const STOPS_PAGE = 15;

/** The parcel-by-parcel outcome of the route. Only codes and outcomes: the office never sees a recipient name, phone or address. */
function StopsTable({ stops }: { stops: Stop[] }) {
  const { t, locale } = useI18n(); const [page, setPage] = useState(1);
  const reason = (r: string | null) => { if (!r) return "—"; const s = t(`stopfail.${r}`); return s.startsWith("stopfail.") ? r : s; };
  return (
    <>
      <Table bare stack dense label={t("rdo.jd_stops")} head={[t("rdo.col_parcel"), t("common.status"), t("req.reason"), t("common.date")]}>
        {stops.slice((page - 1) * STOPS_PAGE, page * STOPS_PAGE).map((s) => (
          <tr key={s.code} data-testid="office-stop" data-code={s.code}>
            <Td label={t("rdo.col_parcel")} className="ltr-num font-medium">{s.code}</Td>
            <Td label={t("common.status")}><Badge tone={s.status === "delivered" ? "success" : s.status === "failed" || s.status === "missing" ? "danger" : s.status === "returned" ? "info" : "neutral"}>{t(`shipstatus.${s.status}`)}</Badge></Td>
            <Td label={t("req.reason")} className="text-muted">{s.status === "failed" ? reason(s.failReason) : "—"}</Td>
            <Td label={t("common.date")} className="whitespace-nowrap text-muted">{fmtDateTime(s.deliveredAt ?? s.failedAt ?? s.returnedAt, locale)}</Td>
          </tr>
        ))}
      </Table>
      <div className="px-4 pb-3"><Pagination page={page} total={stops.length} pageSize={STOPS_PAGE} onPage={setPage} /></div>
    </>
  );
}

/**
 * The shared job chat scrolls the whole page to its newest message when it mounts and when messages load. On this page the chat sits below the fold,
 * so the page would open scrolled to the bottom. Until the reader scrolls on purpose, hold the page where it opened.
 */
function HoldScroll({ children }: { children: ReactNode }) {
  const [y0] = useState(() => (typeof window === "undefined" ? 0 : window.scrollY));
  useEffect(() => {
    let touched = false;
    const stop = () => { touched = true; };
    const restore = () => { if (!touched && window.scrollY !== y0) window.scrollTo({ top: y0, behavior: "instant" }); };
    const events = ["wheel", "touchstart", "keydown", "pointerdown"] as const;
    events.forEach((e) => window.addEventListener(e, stop, { passive: true }));
    window.addEventListener("scroll", restore, { passive: true });
    const timer = setTimeout(stop, 4000);
    return () => { clearTimeout(timer); events.forEach((e) => window.removeEventListener(e, stop)); window.removeEventListener("scroll", restore); };
  }, [y0]);
  return <>{children}</>;
}

/** Office oversight of one job: who is driving it, how far the route is, what went wrong, and a line to the driver. */
export function OfficeJobDetail({ id }: { id: string }) {
  const { t, locale } = useI18n();
  const live = { refreshInterval: 20_000, revalidateOnFocus: true };
  const [replace, setReplace] = useState(false);
  const job = useApi<JobDetail>(`/office/jobs/${id}`, { ...live, shouldRetryOnError: false });
  const tl = useApi<{ items: TimelineEvent[] }>(`/offers/${id}/timeline`, live);
  const fallback = useMemo(() => parcelProgress((tl.data?.items ?? []) as Parameters<typeof parcelProgress>[0]), [tl.data]);
  const crumbs = (ref?: string) => [{ label: t("office.jobs_title"), href: "/office/jobs" }, ...(ref ? [{ label: ref }] : [])];

  if (job.error instanceof ApiError && job.error.code === "NOT_FOUND") return <><Breadcrumbs items={crumbs()} /><EmptyState icon={<Truck className="size-9" aria-hidden />} title={t("rdo.job_missing")} hint={t("rdo.job_missing_hint")} action={<Link href="/office/jobs"><Button variant="secondary">{t("office.jobs_title")}</Button></Link>} /></>;
  if (job.error && !job.data) return <><Breadcrumbs items={crumbs()} /><ErrorState error={job.error} retry={() => job.mutate()} /></>;
  if (!job.data) return <PageLoading />;
  const j = job.data; const p = j.parcels;
  const closed = CLOSED_JOB.includes(j.status);
  const pct = parcelPct(p) ?? (fallback.total ? Math.min(100, Math.round(((fallback.delivered + fallback.failed) / fallback.total) * 100)) : null);
  const num = (n: number | null | undefined) => (n == null ? "—" : fmtNum(n, locale));
  const vehicle = j.vehicleType ? t(`vehicle.${j.vehicleType}`) : "—";

  return (
    <>
      <Breadcrumbs items={crumbs(j.ref)} />
      <DetailHeader name={j.ref} subtitle={[j.business, t(`svc.${j.service}`)].filter(Boolean).join(" · ")} badges={<StatusBadge status={j.status} ns="jobstatus" />}
        avatar={<span className="flex size-14 shrink-0 items-center justify-center rounded-full bg-accent/10 text-accent" aria-hidden><Truck className="size-6" /></span>}
        facts={[{ label: t("office.driver"), value: <Link href={`/office/drivers/${j.driverId}`} className="text-accent hover:underline">{j.driver}</Link> }, { label: t("req.starts"), value: fmtDateTime(j.startsAt, locale) }, { label: t("req.route"), value: `${t(`city.${j.pickupCity}`)} → ${t(`city.${j.deliveryCity}`)}` }, { label: t("wizard.vehicle"), value: vehicle }]}
        actions={REPLACEABLE_JOB.includes(j.status) ? <Button variant="danger" onClick={() => setReplace(true)} data-testid="office-replace">{t("office.replace")}</Button> : undefined} />
      {tl.error && <div className="mb-4"><Notice tone="warn">{t("ux.d_stale")}</Notice></div>}
      {j.cancelReason && <div className="mb-4"><Notice tone="warn">{t("job.cancel_reason", { reason: j.cancelReason })}</Notice></div>}

      <StatGrid cols={4} className="mb-5">
        {p ? <>
          <Stat label={t("rdo.jd_delivered")} value={num(p.delivered)} icon={<CheckCircle2 className="size-5" />} hint={t("rdo.jd_of_total", { n: p.total })} />
          <Stat label={t("rdo.jd_failed")} value={num(p.failed)} icon={<PackageX className="size-5" />} tone={p.failed > 0 ? "danger" : "muted"} hint={p.missing > 0 ? t("rdo.jd_missing_hint", { n: p.missing }) : t("rdo.jd_failed_hint")} />
          <Stat label={t("rdo.jd_remaining")} value={num(p.pending + p.loaded)} icon={<Package className="size-5" />} tone="cyan" hint={t("rdo.jd_remaining_hint", { n: p.loaded })} />
          <Stat label={t("rdo.jd_returned")} value={num(p.returned)} icon={<Undo2 className="size-5" />} tone="muted" hint={t("rdo.jd_returned_hint")} />
        </> : <>
          <Stat label={t("units.exp")} value={num(j.expectedUnits)} icon={<Package className="size-5" />} />
          <Stat label={t("units.loaded")} value={num(j.loadedUnits)} icon={<Truck className="size-5" />} tone="cyan" />
          <Stat label={t("units.delivered")} value={num(j.deliveredUnits)} icon={<CheckCircle2 className="size-5" />} />
          <Stat label={t("units.final")} value={num(j.finalUnits)} icon={<PackageX className="size-5" />} tone="muted" />
        </>}
      </StatGrid>

      <div className="mb-5 grid gap-5 lg:grid-cols-3">
        <Section title={t("ux.d_office_progress")} flush={!!j.stops.length} className="lg:col-span-2" actions={pct !== null ? <span className="ltr-num text-sm font-semibold tabular-nums">{pct}%</span> : undefined}>
          {pct === null ? <p className="text-sm text-muted">{t("ux.d_office_not_started")}</p> : (
            <>
              <div className={j.stops.length ? "space-y-1 p-5 pb-4" : "space-y-1"}>
                <ProgressBar value={pct} label={t("a11y.progress")} tone={p && p.failed > 0 ? "gold" : "accent"} />
                {fallback.lastAt && <p className="flex items-center gap-1.5 pt-1 text-xs text-muted"><Clock className="size-3.5" aria-hidden />{t("ux.d_office_last_activity", { time: fmtDateTime(j.lastActivityAt, locale) })}</p>}
              </div>
              {j.stops.length > 0 && <StopsTable stops={j.stops} />}
            </>
          )}
        </Section>
        <Section title={t("job.details")}>
          <InfoGrid cols={1} items={[
            { label: t("units.exp"), value: num(j.expectedUnits) }, { label: t("units.final"), value: num(j.finalUnits) },
            { label: t("rdo.jd_accepted"), value: fmtDateTime(j.acceptedAt, locale) }, { label: t("rdo.jd_arrived"), value: fmtDateTime(j.arrivedAt, locale) }, { label: t("rdo.jd_route"), value: fmtDateTime(j.routeApprovedAt, locale) },
            { label: t("rdo.jd_last"), value: fmtDateTime(j.lastActivityAt, locale) },
          ]} />
        </Section>
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <HoldScroll><JobChat offerId={id} closed={closed} /></HoldScroll>
        <Section title={t("timeline.title")} flush>
          {tl.data ? <div tabIndex={0} role="region" aria-label={t("timeline.title")} className="max-h-[34rem] overflow-y-auto p-5"><Timeline bare events={tl.data.items} /></div> : <div className="space-y-3 p-5" aria-busy="true"><Skeleton className="h-8" /><Skeleton className="h-8" /><Skeleton className="h-8" /></div>}
        </Section>
      </div>
      <ReplaceJobModal job={replace ? { offerId: j.offerId, ref: j.ref } : null} onClose={() => setReplace(false)} onDone={() => { void job.mutate(); void tl.mutate(); }} />
    </>
  );
}
