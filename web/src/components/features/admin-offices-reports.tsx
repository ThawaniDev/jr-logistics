"use client";
import { Notice } from "@/components/ui";
import { hasPerm, useUser } from "@/components/layout/auth-context";
import { useI18n } from "@/i18n/provider";
import { FleetReportCenter } from "@/components/reports/fleet";

/** Reports tab of an office (`/admin/offices/:id/reports`, decision I7): period, KPIs, the Daily / Drivers / Money / Jobs / Earnings / Failures views with downloads, and the workbook. */
export function OfficeReportsTab({ id }: { id: string }) {
  const { t } = useI18n(); const me = useUser();
  if (!hasPerm(me, "reports.view")) return <Notice tone="warn">{t("fr.no_access")}</Notice>;
  return <FleetReportCenter scope={{ kind: "office", id }} />;
}
