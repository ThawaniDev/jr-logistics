"use client";
import { useState } from "react";
import { Truck } from "lucide-react";
import { EmptyState, ErrorState, PageHeader, PageLoading, Tabs } from "@/components/ui";
import { useApi } from "@/components/ui/data";
import { JobCard } from "@/components/features/driver-job-card";
import { useI18n } from "@/i18n/provider";

export default function JobsPage() {
  const { t } = useI18n(); const [scope, setScope] = useState("active");
  const { data, error, mutate } = useApi(`/driver/jobs?scope=${scope}`);
  return (
    <>
      <PageHeader title={t("nav.my_jobs")} />
      <Tabs value={scope} onChange={setScope} tabs={[{ key: "active", label: t("jobs.active") }, { key: "history", label: t("jobs.history") }]} />
      {error ? <ErrorState error={error} retry={() => mutate()} /> : !data ? <PageLoading /> : data.items.length === 0 ? <EmptyState icon={<Truck className="size-9" />} title={t("jobs.empty")} /> : <div className="grid gap-4 lg:grid-cols-2">{data.items.map((j: any) => <JobCard key={j.offerId} job={j} href={`/driver/jobs/${j.offerId}`} />)}</div>}
    </>
  );
}
