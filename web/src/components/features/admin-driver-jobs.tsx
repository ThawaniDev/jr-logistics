"use client";
import { useState } from "react";
import Link from "next/link";
import { ArrowRight, ChevronDown } from "lucide-react";
import { Badge, ErrorState, Section, SearchBox, Segmented, StatusBadge, Table, Td } from "@/components/ui";
import { useApi } from "@/components/ui/data";
import { fmtDate } from "@/lib/format";
import { useI18n } from "@/i18n/provider";
import { useUser } from "@/components/layout/auth-context";
import { JOB_GROUPS, type JobGroup } from "@/server/details-people-lib";
import { hasAny, qs, useDebounced, useTx } from "./admin-common";
import { ListEmpty, LoadingRows, Money, pagerFooter } from "./admin-offices-common";
import { JobTimeline, PeriodBar, usePeriod } from "./admin-driver-common";

const SIZE = 10;
const GROUP_LABEL: Record<JobGroup, string> = { all: "common.all", active: "rdq.scope_active", completed: "status.completed", cancelled: "dv2.g_cancelled", no_show: "status.no_show", declined: "dv2.g_declined" };

/**
 * Every offer (job) of a driver or of an office's drivers: status group with counts, text search and the period in the URL, paging, and per row an expandable timeline
 * (offered → accepted → arrived → loaded → delivered → completed), parcels, rating and, for staff who may see money, the earning and its settlement.
 * `endpoint` is `/admin/drivers/:id/offers` or `/admin/offices/:id/job-log`; `driverFilter` (office view) narrows to one driver.
 */
export function OffersTable({ endpoint, showDriver, testid, driverFilter }: { endpoint: string; showDriver?: boolean; testid: string; driverFilter?: string }) {
  const { t, locale } = useI18n(); const me = useUser(); const tx = useTx();
  const [period, setPeriod] = usePeriod("all"); const [group, setGroup] = useState<JobGroup>("all"); const [q, setQ] = useState(""); const dq = useDebounced(q.trim()); const [page, setPage] = useState(1);
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const { data, error, mutate } = useApi(`${endpoint}${qs({ period, group: group === "all" ? "" : group, q: dq, driverId: driverFilter, page, pageSize: SIZE })}`, { keepPreviousData: true });
  const canRequest = hasAny(me, "requests.view"), canBusiness = hasAny(me, "users.view", "verification.manage", "offices.view"), canDriver = hasAny(me, "drivers.view", "users.view");
  const rows: any[] = data?.items ?? []; const loading = !data && !error; const money = rows.some((r) => r.earningCents !== undefined);
  const head = [t("req.ref"), ...(showDriver ? [t("adm.col_driver")] : []), t("office.business"), t("req.route"), { label: t("rdq.col_units"), align: "end" as const }, t("common.status"), t("req.starts"), ...(money ? [{ label: t("dv2.col_earning"), align: "end" as const }] : []), { label: t("dv2.details"), srOnly: true }];
  const filtered = group !== "all" || !!dq || period !== "all";
  if (error && !data) return <ErrorState error={error} retry={() => mutate()} />;
  return (
    <Table stack label={t("rdq.tab_jobs")} head={head} bare dense
      toolbar={<>
        <SearchBox value={q} onChange={(v) => { setQ(v); setPage(1); }} placeholder={t("dv2.search_jobs")} label={t("dv2.search_jobs")} />
        <Segmented label={t("rdq.tab_jobs")} value={group} onChange={(k) => { setGroup(k as JobGroup); setPage(1); }} options={JOB_GROUPS.map((k) => ({ key: k, label: t(GROUP_LABEL[k]), count: data?.counts?.[k] }))} />
        <PeriodBar value={period} onChange={(p) => { setPeriod(p); setPage(1); }} />
      </>}
      empty={!loading && rows.length === 0 ? <ListEmpty filtered={filtered} onClear={() => { setQ(""); setGroup("all"); setPeriod("all"); setPage(1); }} title={t("rdq.jobs_none")} hint={t("rdq.jobs_none_hint")} /> : undefined}
      footer={data ? pagerFooter(page, data.total, SIZE, setPage) : undefined}>
      {loading ? <LoadingRows cols={head.length} rows={4} /> : rows.flatMap((j) => {
        const isOpen = !!open[j.offerId]; const done = j.parcels.delivered + j.parcels.failed;
        return [
          <tr key={j.offerId} data-testid={`${testid}-${j.offerId}`}>
            <Td>{canRequest ? <Link href={`/admin/requests/${j.requestId}`} className="ltr-num font-semibold text-accent hover:underline">{j.ref}</Link> : <span className="ltr-num font-semibold">{j.ref}</span>}</Td>
            {showDriver && <Td label={t("adm.col_driver")}>{canDriver ? <Link href={`/admin/drivers/${j.driverId}`} className="text-accent hover:underline">{j.driver}</Link> : j.driver}</Td>}
            <Td label={t("office.business")}>{canBusiness && j.businessId ? <Link href={`/admin/companies/${j.businessId}`} className="hover:underline">{j.business ?? "—"}</Link> : j.business ?? "—"}</Td>
            <Td label={t("req.route")}><span className="inline-flex items-center gap-1.5 whitespace-nowrap">{tx(`city.${j.pickupCity}`, j.pickupCity)}<ArrowRight className="size-3.5 text-muted rtl:rotate-180" aria-hidden />{tx(`city.${j.deliveryCity}`, j.deliveryCity)}</span></Td>
            <Td label={t("rdq.col_units")} num>{j.finalUnits ?? j.expectedUnits}</Td>
            <Td label={t("common.status")}><span className="inline-flex flex-wrap items-center gap-1.5"><StatusBadge status={j.status} />{j.isReplacement && <Badge tone="info">{t("dv2.replacement")}</Badge>}</span></Td>
            <Td label={t("req.starts")} className="whitespace-nowrap text-muted">{fmtDate(j.startsAt, locale)}</Td>
            {money && <Td label={t("dv2.col_earning")} align="end">{j.earningCents != null ? <Money cents={j.earningCents} /> : <span className="text-muted"><Money cents={j.expectedEarningCents} /></span>}</Td>}
            <Td align="end"><button type="button" aria-expanded={isOpen} aria-label={t("dv2.details")} data-testid={`${testid}-toggle-${j.offerId}`} onClick={() => setOpen((o) => ({ ...o, [j.offerId]: !isOpen }))} className="jr-tap inline-flex size-8 items-center justify-center rounded-lg text-muted hover:bg-bg2 hover:text-ink"><ChevronDown className={`size-4 transition ${isOpen ? "rotate-180" : ""}`} aria-hidden /></button></Td>
          </tr>,
          ...(isOpen ? [
            <tr key={`${j.offerId}-d`} data-testid={`${testid}-detail-${j.offerId}`} className="bg-bg2/40">
              <td colSpan={head.length} className="px-4 py-3 !text-start">
                <div className="w-full space-y-3 text-start">
                  <JobTimeline timeline={j.timeline} status={j.status} />
                  <p className="flex flex-wrap gap-x-5 gap-y-1 text-xs text-muted">
                    <span>{t("dv2.source")}: <span className="text-ink">{t(`dv2.src_${j.source}`)}</span></span>
                    <span>{t("dv2.parcels_n", { total: j.parcels.total, delivered: j.parcels.delivered, failed: j.parcels.failed })}{j.parcels.total > done && <> · {t("dv2.parcels_open", { n: j.parcels.total - done })}</>}</span>
                    {j.deliveredUnits != null && <span>{t("dv2.units_reported", { n: j.deliveredUnits, m: j.expectedUnits })}</span>}
                    {j.rating != null && <span>{t("dv2.rated_stars", { n: j.rating })}</span>}
                    {j.settlementStatus && <span>{t("dv2.settlement")}: <StatusBadge status={j.settlementStatus === "batch_ready" ? "approved" : j.settlementStatus} /></span>}
                    {j.cancelReason && <span className="text-danger">{t("dv2.reason")}: {j.cancelReason}</span>}
                  </p>
                </div>
              </td>
            </tr>] : []),
        ];
      })}
    </Table>
  );
}

/** Jobs tab of a driver (`/admin/drivers/:id/jobs`). */
export function DriverJobsTab({ id }: { id: string }) {
  const { t } = useI18n();
  return <Section title={t("office.jobs_title")} description={t("rdq.driver_jobs_sub")} flush><OffersTable endpoint={`/admin/drivers/${id}/offers`} testid="rdq-driver-job" /></Section>;
}
