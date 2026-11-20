"use client";
import { Loader2, Package } from "lucide-react";
import { useI18n } from "@/i18n/provider";
import { workbookDownload, type FleetScope, type PeriodLike } from "./fleet-lib";
import type { Downloader } from "./useDownload";

/**
 * "Download workbook": every table of the Reports tab as one multi-sheet `.xlsx` (summary, daily, drivers, money, jobs, earnings, failures, notes) for the whole entity and the
 * selected period. Needs `reports.export` in the back office (disabled with a hint otherwise); an owner may always export their own data.
 */
export function WorkbookButton({ scope, period, canExport, dl }: { scope: FleetScope; period: PeriodLike; canExport: boolean; dl: Downloader }) {
  const { t, locale } = useI18n();
  const { busy, run } = dl;
  const preparing = busy === "workbook";
  return (
    <span title={canExport ? t("fr.workbook_hint") : t("fr.export_needs_perm")} className="inline-flex print:hidden">
      <button type="button" data-testid="fr-workbook" disabled={!canExport || !!busy} aria-busy={preparing || undefined} aria-label={canExport ? undefined : `${t("fr.workbook")} — ${t("fr.export_needs_perm")}`}
        onClick={() => run("workbook", workbookDownload(scope, period, locale), "workbook.xlsx")}
        className="jr-tap inline-flex h-8 items-center gap-2 whitespace-nowrap rounded-xl border border-line bg-bg2 px-3 text-xs text-ink transition hover:border-accent/60 hover:bg-card disabled:cursor-not-allowed disabled:opacity-50 pointer-coarse:h-10">
        {preparing ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Package className="size-4" aria-hidden />}{preparing ? t("fr.workbook_preparing") : t("fr.workbook")}
      </button>
    </span>
  );
}
