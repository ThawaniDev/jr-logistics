"use client";
import { Suspense, useState } from "react";
import { CheckCircle2, Star, Truck } from "lucide-react";
import { EmptyState, ErrorState, PageHeader, PageLoading, Pagination, Segmented, Stat, StatGrid } from "@/components/ui";
import { useApi, useUrlState } from "@/components/ui/data";
import { JobCard } from "@/components/features/driver-job-card";
import { useI18n } from "@/i18n/provider";

// History is paged by the server; active jobs are always returned in full.
const PAGE = 12;

function Jobs() {
  const { t } = useI18n();
  const [raw, setScope] = useUrlState("scope", "active"); const scope = raw === "history" ? "history" : "active";
  const [page, setPage] = useState(1);
  // Both lists are read so the filter can show its counts; only the chosen one is shown (and the active one keeps refreshing).
  const active = useApi("/driver/jobs?scope=active", { refreshInterval: 30_000, revalidateOnFocus: true });
  const history = useApi(`/driver/jobs?scope=history&page=${scope === "history" ? page : 1}&pageSize=${PAGE}`, { keepPreviousData: true, revalidateOnFocus: true });
  const ov = useApi("/driver/overview");
  const cur = scope === "active" ? active : history;
  const { data, error, mutate } = cur;
  return (
    <>
      <PageHeader title={t("nav.my_jobs")} subtitle={t("rdo.d_jobs_sub")} />
      <StatGrid cols={3} className="mb-5">
        <Stat label={t("driver.active_jobs")} value={ov.data?.activeJobs ?? "—"} loading={!ov.data && !ov.error} icon={<Truck className="size-5" />} hint={t("rdo.d_active_hint")} href="/driver/jobs" />
        <Stat label={t("driver.completed")} value={ov.data?.jobsCompleted ?? "—"} loading={!ov.data && !ov.error} icon={<CheckCircle2 className="size-5" />} hint={t("rdo.d_completed_hint")} href="/driver/jobs?scope=history" />
        <Stat label={t("driver.rating")} value={ov.data?.rating ?? "—"} loading={!ov.data && !ov.error} icon={<Star className="size-5" />} tone="gold" hint={ov.data?.rating == null ? t("rdo.d_rating_none") : t("rdo.d_rating_hint")} />
      </StatGrid>
      <div className="mb-4">
        <Segmented label={t("nav.my_jobs")} value={scope} onChange={(k) => { setScope(k); setPage(1); }} options={[
          { key: "active", label: t("jobs.active"), count: active.data?.items?.length },
          { key: "history", label: t("jobs.history"), count: history.data?.total },
        ]} />
      </div>
      {error && !data ? <ErrorState error={error} retry={() => mutate()} /> : !data ? <PageLoading /> : data.items.length === 0 ? <EmptyState icon={<Truck className="size-9" />} title={t("jobs.empty")} hint={scope === "active" ? t("rdo.d_jobs_empty_hint") : undefined} /> : <><div className="grid gap-4 lg:grid-cols-2">{data.items.map((j: any) => <JobCard key={j.offerId} job={j} history={scope === "history"} href={`/driver/jobs/${j.offerId}`} />)}</div>{scope === "history" && <Pagination page={page} total={data.total} pageSize={PAGE} onPage={setPage} />}</>}
    </>
  );
}
export default function JobsPage() { return <Suspense fallback={<PageLoading />}><Jobs /></Suspense>; }
