"use client";
import { Columns3, Lock } from "lucide-react";
import { Button, Checkbox } from "@/components/ui";
import { useUrlPatch } from "@/components/ui/data";
import { useI18n } from "@/i18n/provider";
import { columnLabel, toggleIn, type CatalogDataset, type ExplorerState } from "./explorer-lib";

/** The column chooser: tick the columns of the table and the export (the dataset's defaults until you change them). Personal-data columns carry a lock when they are masked for you. */
export function ExplorerColumns({ ds, state }: { ds: CatalogDataset; state: ExplorerState }) {
  const { t } = useI18n();
  const patch = useUrlPatch();
  const order = ds.columns.map((c) => c.key), defaults = ds.columns.filter((c) => c.default).map((c) => c.key);
  const chosen = state.cols.length ? state.cols.filter((c) => order.includes(c)) : defaults;
  const set = (cols: string[]) => patch({ cols: cols.length === defaults.length && cols.every((c) => defaults.includes(c)) ? "" : cols.join(",") });
  return (
    <details className="rounded-card border border-line bg-card" data-testid="rpq-x-columns">
      <summary className="flex cursor-pointer select-none items-center gap-2 px-4 py-3 text-sm font-semibold">
        <Columns3 className="size-4 text-muted" aria-hidden />{t("rpq.x_columns")}
        <span className="ltr-num rounded-full bg-bg2 px-2 text-xs text-muted" data-testid="rpq-x-columns-count">{chosen.length}/{order.length}</span>
      </summary>
      <div className="border-t border-line p-4">
        <div className="mb-3 flex flex-wrap gap-2">
          <Button variant="secondary" size="sm" onClick={() => set(defaults)} data-testid="rpq-x-cols-default">{t("rpq.x_cols_default")}</Button>
          <Button variant="secondary" size="sm" onClick={() => set(order.slice(0, 40))} data-testid="rpq-x-cols-all">{t("rpq.x_cols_all")}</Button>
          <Button variant="ghost" size="sm" onClick={() => set(defaults.slice(0, 1))} data-testid="rpq-x-cols-min">{t("rpq.x_cols_min")}</Button>
        </div>
        <div className="grid gap-x-6 gap-y-2 sm:grid-cols-2 lg:grid-cols-3">
          {ds.columns.map((c) => (
            <Checkbox key={c.key} data-testid={`rpq-x-col-${c.key}`} checked={chosen.includes(c.key)} disabled={chosen.length === 1 && chosen.includes(c.key)} onChange={() => set(toggleIn(chosen, c.key, order))}
              label={<span className="inline-flex items-center gap-1.5">{columnLabel(t, c.key)}{c.masked && <Lock className="size-3 text-muted" aria-label={t("rpq.x_masked")} />}</span>} />
          ))}
        </div>
        <p className="mt-3 text-xs text-muted">{t("rpq.x_cols_hint")}</p>
      </div>
    </details>
  );
}
