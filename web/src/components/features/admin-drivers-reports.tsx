"use client";
import { Notice } from "@/components/ui";
import { hasPerm, useUser } from "@/components/layout/auth-context";
import { useI18n } from "@/i18n/provider";
import { FleetReportCenter } from "@/components/reports/fleet";

/** Reports tab of a driver (`/admin/drivers/:id/reports`, decision I7): period, KPIs, the Daily / Money / Money by day / Jobs / Failures views with downloads, and the workbook. */
export function DriverReportsTab({ id }: { id: string }) {
  const { t } = useI18n(); const me = useUser();
  if (!hasPerm(me, "reports.view")) return <Notice tone="warn">{t("fr.no_access")}</Notice>;
  return <FleetReportCenter scope={{ kind: "driver", id }} />;
}
