"use client";
import { StatGrid } from "@/components/ui";
import { useI18n } from "@/i18n/provider";
import { KpiCard } from "../KpiGrid";
import { fmtDur } from "../chartTheme";
import type { Kpi } from "../types";
import { KPI_GROUPS, kpisOf, type SupportData } from "./support-lib";

/** The KPI cards of the Support report in four labelled rows (tickets, speed and SLA, complaints, ratings). Every card keeps `data-testid="kpi-<key>"`. */
export function SupportKpis({ kpis, targets, comparing }: { kpis: Kpi[]; targets: SupportData["targets"]; comparing: boolean }) {
  const { t, locale } = useI18n();
  return (
    <div className="space-y-5" data-testid="rpq-kpis">
      {KPI_GROUPS.map((g) => {
        const list = kpisOf(kpis, g);
        if (!list.length) return null;
        return (
          <section key={g} aria-labelledby={`rpq-grp-${g}`} data-testid={`rpq-kpis-${g}`}>
            <div className="mb-2 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
              <h2 id={`rpq-grp-${g}`} className="text-sm font-semibold text-muted">{t(`rpq.grp_${g}`)}</h2>
              {g === "speed" && <p className="text-xs text-muted" data-testid="rpq-targets">{t("rpq.targets", { response: fmtDur(targets.firstResponseSec, locale), resolution: fmtDur(targets.resolutionSec, locale) })}</p>}
              {g === "complaints" && <p className="text-xs text-muted">{t("rpq.grp_complaints_hint")}</p>}
            </div>
            <StatGrid cols={4}>{list.map((k) => <KpiCard key={k.key} kpi={k} comparing={comparing} />)}</StatGrid>
          </section>
        );
      })}
    </div>
  );
}
