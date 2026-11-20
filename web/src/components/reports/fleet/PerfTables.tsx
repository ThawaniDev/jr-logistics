"use client";
import { hasPerm, useUser } from "@/components/layout/auth-context";
import { useUrlState } from "@/components/ui/data";
import { useI18n } from "@/i18n/provider";
import { isDailyView, MAX_DAILY_DAYS, pageSizeOf, tooLong, type FleetView } from "./fleet-lib";
import { Notice } from "@/components/ui";
import { FleetNotes } from "./FleetNotes";
import { FleetTable } from "./FleetTable";
import { Pills } from "./Pills";
import { useDownload } from "./useDownload";

type PerfView = "perf" | Exclude<FleetView, "drivers" | "money_daily">;
const VIEWS: Record<"drivers" | "offices", readonly PerfView[]> = {
  drivers: ["perf", "daily", "money", "jobs", "failures"],
  offices: ["perf", "daily", "money", "jobs", "earnings", "failures"],
};
const MONEY = new Set<PerfView>(["money", "earnings"]);

/**
 * "Performance tables" at the bottom of Reports › Drivers and Reports › Courier offices (decision I9): the registered tables `perf`, `daily`, `money`, `jobs`, `failures`
 * (+ `earnings` for offices) of the report, narrowed by the page's own filters (`qs` = `filters.qs`), each with the Download menu and the notes. The chosen table is in the URL
 * (`?ptable=`). Money tables need `finance.view`, downloads `reports.export`.
 */
export function PerfTables({ report, qs, days }: { report: "drivers" | "offices"; qs: string; days: number }) {
  const { t } = useI18n();
  const me = useUser();
  const finance = hasPerm(me, "finance.view"), canExport = hasPerm(me, "reports.export");
  const list = VIEWS[report].filter((v) => finance || !MONEY.has(v));
  const [raw, setRaw] = useUrlState("ptable", "perf");
  const view = (list as string[]).includes(raw) ? (raw as PerfView) : list[0];
  const dl = useDownload();
  const long = tooLong(days) && isDailyView(view);
  return (
    <section aria-labelledby="fr-perf-title" data-testid="fr-perf" className="min-w-0 space-y-3">
      <div>
        <h2 id="fr-perf-title" className="text-base font-semibold">{t("fr.perf_title")}</h2>
        <p className="mt-0.5 text-xs text-muted">{t(`fr.perf_sub_${report}`)}</p>
      </div>
      <Pills label={t("fr.perf_title")} value={view} onChange={setRaw} testId="fr-perf-switch" options={list.map((v) => ({ key: v, label: t(`fr.view_${v}`), testId: `fr-perf-${v}` }))} />
      <p className="text-xs text-muted" data-testid="fr-perf-hint">{t(view === "perf" ? `fr.hint_perf_${report}` : `fr.hint_${view}`)}</p>
      {long ? <Notice tone="warn"><span data-testid="fr-too-long">{t("fr.too_long", { n: MAX_DAILY_DAYS })}</span></Notice>
        : <FleetTable key={view} tref={{ portal: false, report, name: view }} qs={qs} canExport={canExport} dl={dl} pageSize={pageSizeOf(view as FleetView)} testId={`fr-perf-table-${view}`} fileBase={`${report}-${view}`} />}
      {!long && <FleetNotes tref={{ portal: false, report, name: view }} qs={qs} />}
    </section>
  );
}
