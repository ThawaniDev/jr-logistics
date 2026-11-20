"use client";
import { Suspense } from "react";
import { Gauge } from "lucide-react";
import { PageHeader, PageLoading } from "@/components/ui";
import { useI18n } from "@/i18n/provider";
import { FleetReportCenter } from "./FleetReportCenter";

/** `/office/reports/performance`: the fleet report centre of the signed-in courier office (its own drivers only; the server scopes every call to the session). */
export function OfficePerformance() {
  const { t } = useI18n();
  return (
    <>
      <PageHeader title={t("fr.portal_title")} subtitle={t("fr.portal_sub")} icon={<Gauge className="size-5" />} breadcrumbs={[{ label: t("nav.group_reports") }, { label: t("nav.rep_performance") }]} />
      <Suspense fallback={<PageLoading />}><FleetReportCenter scope={{ kind: "portal" }} /></Suspense>
    </>
  );
}
