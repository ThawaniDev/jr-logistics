"use client";
import { Skeleton, StatGrid } from "@/components/ui";
import { cn } from "@/lib/cn";
import { useI18n } from "@/i18n/provider";
import type { Kpi } from "@/server/analytics/kpi";
import { KpiCard } from "../KpiGrid";
import { groupKpis, type KpiGroupDef } from "./kpi-groups";

/** Cards per row inside a group on a wide screen, and how many of the 12 columns of the strip the group takes: small groups sit side by side (one card = a quarter of the width). */
const LAYOUT: Record<number, { span: string; cols: string }> = {
  1: { span: "lg:col-span-3", cols: "lg:grid-cols-1" },
  2: { span: "lg:col-span-6", cols: "lg:grid-cols-2" },
  3: { span: "lg:col-span-9", cols: "lg:grid-cols-3" },
  4: { span: "lg:col-span-12", cols: "lg:grid-cols-4" },
  5: { span: "lg:col-span-12", cols: "lg:grid-cols-3 xl:grid-cols-5" },
};
const layoutFor = (n: number) => LAYOUT[n] ?? { span: "lg:col-span-12", cols: "lg:grid-cols-3 2xl:grid-cols-6" };

/**
 * The KPI cards of a report in titled groups (see `kpi-groups.ts`): a KPI that no group names is shown in "More metrics", never dropped. One `kpi-grid` test id for the whole
 * block (like `KpiGrid`), one `kpis-<group>` per group, and every card keeps its `kpi-<key>` id. `loading` shows skeletons while the first response is on its way.
 */
export function KpiGroups({ kpis, groups, hide, comparing, loading }: { kpis?: readonly Kpi[]; groups: readonly KpiGroupDef[]; hide?: readonly string[]; comparing?: boolean; loading?: boolean }) {
  const { t } = useI18n();
  if (loading || !kpis) {
    return (
      <section aria-label={t("rpf.sec_kpis")} data-testid="kpi-grid" aria-busy="true">
        <StatGrid cols={4}>{Array.from({ length: 8 }, (_, i) => <div key={i} className="rounded-card border border-line bg-card p-4"><Skeleton className="h-3 w-24" /><Skeleton className="mt-3 h-7 w-20" /><Skeleton className="mt-3 h-4 w-14" /></div>)}</StatGrid>
      </section>
    );
  }
  return (
    <section aria-label={t("rpf.sec_kpis")} data-testid="kpi-grid" className="grid gap-x-3 gap-y-5 lg:grid-flow-dense lg:grid-cols-12">
      {groupKpis(kpis, groups, hide).map((g) => {
        const l = layoutFor(g.kpis.length);
        return (
          <div key={g.id} role="group" aria-label={t(g.title)} data-testid={`kpis-${g.id}`} className={cn("min-w-0", l.span)}>
            <h2 className="mb-2.5 text-sm font-semibold text-muted">{t(g.title)}</h2>
            <StatGrid cols={2} className={l.cols}>{g.kpis.map((k) => <KpiCard key={k.key} kpi={k} comparing={comparing} />)}</StatGrid>
          </div>
        );
      })}
    </section>
  );
}
