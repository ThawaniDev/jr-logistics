"use client";
import { useState } from "react";
import { ChevronDown } from "lucide-react";
import { Stat } from "@/components/ui";
import { InfoTip } from "@/components/reports/InfoTip";
import { cn } from "@/lib/cn";
import { useI18n } from "@/i18n/provider";
import { kpiCards } from "./admin-order-lib";

/** The order's key figures. Every card has its definition behind the (i): what is counted, since when, and out of what. Collapsible so the section below gets the room. */
export function OrderKpis({ kpis, loading, expanded }: { kpis: any | null; loading?: boolean; expanded: boolean }) {
  const { t, locale } = useI18n();
  // open on the overview, a one-line bar on the other sections (the viewer's own click wins until they leave the order)
  const [pick, setPick] = useState<boolean | null>(null); const open = pick ?? expanded;
  const cards = kpis ? kpiCards(kpis, locale, t) : [];
  return (
    <section aria-label={t("dv1.kpis_title")} className="mb-5" data-testid="dv1-kpis">
      <button type="button" onClick={() => setPick(!open)} aria-expanded={open} className="mb-2 inline-flex items-center gap-1.5 rounded-lg text-xs font-semibold uppercase tracking-wider text-muted hover:text-ink">
        <ChevronDown className={cn("size-4 transition", !open && "-rotate-90 rtl:rotate-90")} aria-hidden />{t("dv1.kpis_title")}
      </button>
      {open && (
        <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 sm:gap-3 xl:grid-cols-4 2xl:grid-cols-6">
          {loading || !kpis ? Array.from({ length: 6 }, (_, i) => <Stat key={i} loading label="…" value="" />) : cards.map((c) => (
            <div key={c.key} data-testid={`dv1-kpi-${c.key}`}>
              <Stat label={t(`dv1.kpi_${c.key}`)} value={<span className="ltr-num">{c.value}</span>} tone={c.tone} className="h-full"
                hint={<span className="inline-flex items-center gap-1">{c.hint && <span>{c.hint}</span>}<InfoTip name={t(`dv1.kpi_${c.key}`)}><span className="block font-semibold">{t(`dv1.kpi_${c.key}`)}</span><span className="mt-1 block">{t(`dv1.def_${c.key}`)}</span></InfoTip></span>} />
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
