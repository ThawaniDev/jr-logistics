"use client";
import { useState } from "react";
import { Section, Select } from "@/components/ui";
import { useApi } from "@/components/ui/data";
import { useI18n } from "@/i18n/provider";
import { OffersTable } from "./admin-driver-jobs";

/** Jobs tab of an office: every job its drivers worked through it (status group, search, period, per-driver filter, expandable timeline; earnings for staff who may see money). */
export function OfficeJobsTab({ id }: { id: string }) {
  const { t } = useI18n(); const [driver, setDriver] = useState("");
  const drivers = useApi<{ items: Array<{ id: string; name: string }> }>(`/admin/offices/${id}/drivers?pageSize=100`);
  const list = drivers.data?.items ?? [];
  return (
    <Section title={t("office.jobs_title")} description={t("rdq.jobs_sub")} flush
      actions={list.length > 1 ? <div className="w-52"><Select aria-label={t("adm.col_driver")} value={driver} onChange={(e) => setDriver(e.target.value)} options={[{ value: "", label: t("dv2.all_drivers") }, ...list.map((d) => ({ value: d.id, label: d.name }))]} /></div> : undefined}>
      <OffersTable key={driver} endpoint={`/admin/offices/${id}/job-log`} showDriver testid="rdq-office-job" driverFilter={driver || undefined} />
    </Section>
  );
}
