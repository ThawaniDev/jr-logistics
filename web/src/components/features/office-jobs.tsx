"use client";
import { Suspense, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { AlertTriangle, CheckCircle2, Truck, XCircle } from "lucide-react";
import { Button, CellPair, EmptyState, ErrorState, Modal, Notice, PageHeader, PageLoading, Pagination, SearchBox, Segmented, Stat, StatGrid, StatusBadge, Table, Td, Textarea } from "@/components/ui";
import { useUrlState } from "@/components/ui/data";
import { useDriverAction } from "./driver-action";
import { useAllRows } from "./office-data";
import { ParcelBar, linkBtn } from "./office-shared";
import { JOB_FILTERS, REPLACEABLE_JOB, completionPct, isJobFilter, jobCounts, jobMatches, matchesQuery, paginate, waitingJobs, type JobFilter, type OfficeJob } from "./office-lib";
import { post } from "@/lib/api";
import { fmtDateTime, fmtNum } from "@/lib/format";
import { cn } from "@/lib/cn";
import { useI18n } from "@/i18n/provider";

const PAGE = 20;

/** Hand a job that has not started to another driver of the office; the reason is kept in the job's log. */
export function ReplaceJobModal({ job, onClose, onDone }: { job: { offerId: string; ref: string } | null; onClose: () => void; onDone: () => void }) {
  const { t } = useI18n(); const a = useDriverAction();
  const [reason, setReason] = useState("");
  const close = () => { setReason(""); onClose(); };
  return (
    <Modal open={!!job} onClose={close} busy={a.any} title={t("office.replace")} footer={<><Button variant="ghost" onClick={close} disabled={a.any}>{t("common.cancel")}</Button><Button variant="danger" loading={a.is("rp")} disabled={reason.trim().length < 3} data-testid="office-replace-confirm" onClick={() => job && a.run("rp", () => post(`/office/jobs/${job.offerId}/replace`, { reason: reason.trim() }), { success: "common.saved", onDone: () => { close(); onDone(); } })}>{t("common.confirm")}</Button></>}>
      {job && <p className="text-sm text-muted">{t("req.ref")}: <span className="ltr-num font-semibold text-ink">{job.ref}</span></p>}
      <Notice tone="info">{t("office.replace_hint")}</Notice>
      <Textarea label={t("req.reason")} required value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} />
    </Modal>
  );
}

function Jobs() {
  const { t, locale } = useI18n(); const sp = useSearchParams();
  const hiRef = sp.get("ref");
  const [statusRaw, setStatus] = useUrlState("status", sp.get("scope") === "all" ? "all" : "active"); // `scope=` is the old spelling of the same filter
  const status: JobFilter = isJobFilter(statusRaw) ? statusRaw : "active";
  const [q, setQ] = useState(sp.get("q") ?? hiRef ?? ""); const [page, setPage] = useState(1);
  const [sel, setSel] = useState<null | { offerId: string; ref: string }>(null);
  const { data, error, mutate } = useAllRows<OfficeJob>("/office/jobs?scope=all", { refreshInterval: 30_000, revalidateOnFocus: true });
  const items = data?.items;
  const counts = useMemo(() => jobCounts(items ?? []), [items]);
  const rows = useMemo(() => (items ?? []).filter((j) => jobMatches(j, status) && matchesQuery(q, j.ref, j.business, j.driver)), [items, status, q]);
  if (error && !data) return <ErrorState error={error} retry={() => mutate()} />;
  if (!items) return <PageLoading />;

  const href = (f: JobFilter) => `/office/jobs?status=${f}`;
  const pageNo = Math.min(page, Math.max(1, Math.ceil(rows.length / PAGE)));
  const filtered = !!q || status !== "all";
  const pct = completionPct(counts.completed, counts.closed);
  const waiting = waitingJobs(items);
  const toolbar = (
    <>
      <SearchBox className="sm:w-80" value={q} onChange={(v) => { setQ(v); setPage(1); }} placeholder={t("rdo.jobs_search")} label={t("rdo.jobs_search")} />
      <Segmented label={t("common.status")} value={status} onChange={(k) => { setStatus(k); setPage(1); }} options={JOB_FILTERS.map((f) => ({ key: f, label: t(`rdo.jobs_f_${f}`), count: counts[f] }))} />
    </>
  );

  return (
    <>
      <PageHeader title={t("office.jobs_title")} subtitle={t("office.jobs_sub")} />
      <StatGrid cols={4} className="mb-5">
        <Stat label={t("rdo.jobs_f_active")} value={fmtNum(counts.active, locale)} icon={<Truck className="size-5" />} tone="cyan" hint={waiting > 0 ? t("rdo.waiting_hint", { n: waiting }) : t("rdo.active_hint")} href={href("active")} />
        <Stat label={t("rdo.jobs_f_attention")} value={fmtNum(counts.attention, locale)} icon={<AlertTriangle className="size-5" />} tone={counts.attention > 0 ? "gold" : "muted"} hint={t("rdo.attention_hint")} href={href("attention")} />
        <Stat label={t("rdo.jobs_f_completed")} value={fmtNum(counts.completed, locale)} icon={<CheckCircle2 className="size-5" />} hint={pct == null ? t("rdo.rate_none") : t("rdo.rate_hint", { n: pct })} href={href("completed")} />
        <Stat label={t("rdo.jobs_f_closed")} value={fmtNum(counts.closed, locale)} icon={<XCircle className="size-5" />} tone={counts.closed > 0 ? "danger" : "muted"} hint={t("rdo.closed_hint")} href={href("closed")} />
      </StatGrid>
      {data?.truncated && <div className="mb-4"><Notice tone="info">{t("rdo.truncated", { n: items.length, total: data.total })}</Notice></div>}
      <Table stack label={t("office.jobs_title")} toolbar={toolbar} head={[t("req.ref"), t("office.driver"), t("req.starts"), t("rdo.col_progress"), t("common.status"), { label: t("rdo.col_actions"), srOnly: true }]}
        empty={rows.length === 0 ? <EmptyState icon={<Truck className="size-9" aria-hidden />} title={items.length === 0 ? t("jobs.empty") : t("common.no_results")} hint={items.length === 0 ? t("rdo.jobs_empty_hint") : t("rdo.jobs_no_match")}
          action={items.length === 0 ? <Link href="/office/opportunities"><Button variant="secondary">{t("nav.opportunities")}</Button></Link> : filtered ? <Button variant="secondary" onClick={() => { setQ(""); setStatus("all"); }}>{t("rdo.clear_filters")}</Button> : undefined} /> : null}>
        {paginate(rows, pageNo, PAGE).map((j) => (
          <tr key={j.offerId} data-testid="office-job-row" data-ref={j.ref} className={cn(hiRef && j.ref === hiRef && "bg-accent/5")}>
            <Td label={t("req.ref")}><CellPair title={<Link href={`/office/jobs/${j.offerId}`} className="ltr-num text-accent hover:underline" aria-label={`${t("ux.d_office_job_detail")} ${j.ref}`}>{j.ref}</Link>} sub={j.business ?? undefined} /></Td>
            <Td label={t("office.driver")}><CellPair title={<Link href={`/office/drivers/${j.driverId}`} className="hover:text-accent hover:underline">{j.driver}</Link>} /></Td>
            <Td label={t("req.starts")}><CellPair title={fmtDateTime(j.startsAt, locale)} sub={`${t(`city.${j.pickupCity}`)} → ${t(`city.${j.deliveryCity}`)}`} /></Td>
            <Td label={t("rdo.col_progress")}><ParcelBar parcels={j.parcels} /></Td>
            <Td label={t("common.status")}><div className="flex flex-col items-end gap-1 sm:items-start"><StatusBadge status={j.status} ns="jobstatus" />{jobMatches(j, "active") && <span className="text-xs text-muted">{t("rdo.last_activity", { time: fmtDateTime(j.lastActivityAt, locale) })}</span>}</div></Td>
            <Td align="end"><div className="flex flex-wrap items-center justify-end gap-2">
              <Link href={`/office/jobs/${j.offerId}`} className={linkBtn}>{t("ux.d_office_follow")}</Link>
              {REPLACEABLE_JOB.includes(j.status) && <Button size="sm" variant="danger" onClick={() => setSel({ offerId: j.offerId, ref: j.ref })}>{t("office.replace")}</Button>}
            </div></Td>
          </tr>
        ))}
      </Table>
      <Pagination page={pageNo} total={rows.length} pageSize={PAGE} onPage={setPage} />
      <ReplaceJobModal job={sel} onClose={() => setSel(null)} onDone={() => void mutate()} />
    </>
  );
}
export function OfficeJobs() { return <Suspense fallback={<PageLoading />}><Jobs /></Suspense>; }
