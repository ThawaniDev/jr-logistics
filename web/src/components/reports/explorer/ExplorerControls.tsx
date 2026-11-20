"use client";
import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Checkbox, SearchBox, Segmented, Select } from "@/components/ui";
import { useUrlPatch } from "@/components/ui/data";
import { useI18n } from "@/i18n/provider";
import { datasetPatch, draftOf, type Catalog, type CatalogDataset, type ExplorerState } from "./explorer-lib";

const GROUPS = ["operations", "finance", "people", "support", "system"] as const;

/** Which dataset (grouped by area), whether the period applies, and the free-text search. Everything is written to the URL, so a view is a link. */
export function ExplorerControls({ catalog, ds, state }: { catalog: Catalog; ds: CatalogDataset; state: ExplorerState }) {
  const { t } = useI18n();
  const patch = useUrlPatch();
  const sp = useSearchParams();
  const groups = GROUPS.filter((g) => catalog.datasets.some((d) => d.group === g));
  const inGroup = catalog.datasets.filter((d) => d.group === ds.group);
  // the search box keeps what is typed locally and writes it to the URL after a short pause
  const [draft, setDraft] = useState<{ for: string; v: string } | null>(null);
  const q = draftOf(draft, state.q), setQ = (v: string) => setDraft({ for: state.q, v });
  useEffect(() => {
    if (q === state.q) return;
    const h = setTimeout(() => patch({ q }), 350);
    return () => clearTimeout(h);
  }, [q, state.q, patch]);
  return (
    <section className="space-y-4 rounded-card border border-line bg-card p-4 sm:p-5" aria-label={t("rpq.x_dataset")} data-testid="rpq-x-controls">
      <div className="grid gap-4 lg:grid-cols-[auto_minmax(0,1fr)] lg:items-end">
        <div className="min-w-0">
          <p className="mb-1.5 text-xs font-medium text-muted">{t("rpq.x_area")}</p>
          <Segmented label={t("rpq.x_area")} value={ds.group} onChange={(g) => { const first = catalog.datasets.find((d) => d.group === g); if (first) patch(datasetPatch(first.key, new URLSearchParams(sp.toString()))); }}
            options={groups.map((g) => ({ key: g, label: t(`rpq.dg_${g}`) }))} />
        </div>
        <Select label={t("rpq.x_dataset")} value={ds.key} onChange={(e) => patch(datasetPatch(e.target.value, new URLSearchParams(sp.toString())))} data-testid="rpq-x-dataset"
          options={inGroup.map((d) => ({ value: d.key, label: t(`rpq.ds_${d.key}`) }))} />
      </div>
      <p className="text-sm text-muted" data-testid="rpq-x-desc">{t(`rpq.ds_${ds.key}_d`)}</p>
      <div className="flex flex-wrap items-center gap-x-5 gap-y-3">
        <SearchBox testId="rpq-x-search" value={q} onChange={setQ} placeholder={t("rpq.x_search")} label={t("rpq.x_search")} className="sm:w-80" />
        <Checkbox label={t("rpq.x_all_time")} checked={state.all} onChange={(e) => patch({ all: e.target.checked ? "1" : "" })} data-testid="rpq-x-all" />
        <p className="text-xs text-muted" data-testid="rpq-x-time">{state.all ? t("rpq.x_period_off") : t("rpq.x_period_on", { what: t(ds.time) })}</p>
        {!catalog.viewer.sensitive && <p className="text-xs text-muted" data-testid="rpq-x-pii-note">{t("rpq.x_pii_note")}</p>}
      </div>
    </section>
  );
}
