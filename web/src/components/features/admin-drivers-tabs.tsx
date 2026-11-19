"use client";
import { Section } from "@/components/ui";
import { useI18n } from "@/i18n/provider";
import { JobsTable } from "./admin-offices-jobs";
import { OwnerDocuments } from "./admin-offices-documents";

/** Jobs tab of a driver (every job the driver worked or was assigned, filterable and paged). */
export function DriverJobsTab({ id }: { id: string }) {
  const { t } = useI18n();
  return <Section title={t("office.jobs_title")} description={t("rdq.driver_jobs_sub")} flush><JobsTable endpoint={`/admin/drivers/${id}/jobs`} testid="rdq-driver-job" /></Section>;
}

/** Documents tab of a driver (same table as for offices). */
export function DriverDocumentsTab({ id }: { id: string }) { return <OwnerDocuments ownerId={id} kind="driver" />; }
