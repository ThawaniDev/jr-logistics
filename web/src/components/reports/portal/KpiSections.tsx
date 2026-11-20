"use client";
import { useI18n } from "@/i18n/provider";
import type { Kpi } from "@/server/analytics/kpi";
import { KpiGrid } from "@/components/reports";

export interface KpiGroup { id: string; title: string; keys: readonly string[] }
/** The KPI cards of a report in titled groups (orders, parcels, money …). A group without any card (its section failed) is left out. */
export function KpiSections({ kpis, groups, comparing }: { kpis: Kpi[]; groups: KpiGroup[]; comparing: boolean }) {
  const { t } = useI18n();
  return (
    <div className="space-y-5" data-testid="kpi-sections">
      {groups.map((g) => {
        const list = g.keys.map((k) => kpis.find((x) => x.key === k)).filter((x): x is Kpi => !!x);
        if (!list.length) return null;
        return (
          <section key={g.id} aria-label={g.title} data-testid={`kpis-${g.id}`}>
            <h2 className="mb-2.5 text-sm font-semibold text-muted">{g.title}</h2>
            <KpiGrid kpis={list} comparing={comparing} cols={list.length >= 6 ? 6 : list.length === 5 ? 5 : list.length === 3 ? 3 : 4} />
          </section>
        );
      })}
      {kpis.length === 0 && <p className="text-sm text-muted">{t("rpr.section_failed")}</p>}
    </div>
  );
}
