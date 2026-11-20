"use client";
import { useState } from "react";
import { Filter, X } from "lucide-react";
import { Button, Checkbox, Input, Segmented } from "@/components/ui";
import { useUrlPatch } from "@/components/ui/data";
import { useI18n } from "@/i18n/provider";
import { draftOf, filterLabel, rangeValue, splitRange, toggleIn, valueLabel, type CatalogDataset, type CatalogFilter, type ExplorerState } from "./explorer-lib";

type Patch = (p: Record<string, string>) => void;

/** A two-ended range (numbers, or days) that is written to the URL as `min..max` once either end is filled. */
function RangeField({ f, value, patch, type }: { f: CatalogFilter; value: string | undefined; patch: Patch; type: "number" | "date" }) {
  const { t } = useI18n();
  const [lo0, hi0] = splitRange(value);
  const [dLo, setDLo] = useState<{ for: string; v: string } | null>(null), [dHi, setDHi] = useState<{ for: string; v: string } | null>(null);
  const lo = draftOf(dLo, lo0), hi = draftOf(dHi, hi0);
  const setLo = (v: string) => setDLo({ for: lo0, v }), setHi = (v: string) => setDHi({ for: hi0, v });
  const commit = (a: string, b: string) => patch({ [`f.${f.key}`]: rangeValue(a, b) });
  const unit = f.money ? ` (${t("rpq.x_sar")})` : "";
  return (
    <fieldset className="min-w-0" data-testid={`rpq-x-f-${f.key}`}>
      <legend className="mb-1.5 text-xs font-medium text-muted">{filterLabel(t, f.key)}{unit}</legend>
      <div className="grid grid-cols-2 gap-2">
        <Input ltr type={type} inputMode={type === "number" ? "decimal" : undefined} aria-label={`${filterLabel(t, f.key)} — ${t("rpq.x_min")}`} placeholder={t("rpq.x_min")} value={lo} onChange={(e) => setLo(e.target.value)} onBlur={() => commit(lo, hi)} onKeyDown={(e) => e.key === "Enter" && commit(lo, hi)} />
        <Input ltr type={type} inputMode={type === "number" ? "decimal" : undefined} aria-label={`${filterLabel(t, f.key)} — ${t("rpq.x_max")}`} placeholder={t("rpq.x_max")} value={hi} onChange={(e) => setHi(e.target.value)} onBlur={() => commit(lo, hi)} onKeyDown={(e) => e.key === "Enter" && commit(lo, hi)} />
      </div>
    </fieldset>
  );
}
function TextField({ f, value, patch }: { f: CatalogFilter; value: string | undefined; patch: Patch }) {
  const { t } = useI18n();
  const [d, setD] = useState<{ for: string; v: string } | null>(null);
  const v = draftOf(d, value ?? ""), setV = (x: string) => setD({ for: value ?? "", v: x });
  return <div data-testid={`rpq-x-f-${f.key}`}><Input label={filterLabel(t, f.key)} value={v} placeholder={t("rpq.x_contains")} onChange={(e) => setV(e.target.value)} onBlur={() => patch({ [`f.${f.key}`]: v.trim() })} onKeyDown={(e) => e.key === "Enter" && patch({ [`f.${f.key}`]: v.trim() })} /></div>;
}
function EnumField({ f, value, patch }: { f: CatalogFilter; value: string | undefined; patch: Patch }) {
  const { t } = useI18n();
  const picked = value ? value.split(",") : [], order = [...(f.values ?? [])] as string[];
  return (
    <fieldset className="min-w-0" data-testid={`rpq-x-f-${f.key}`}>
      <legend className="mb-1.5 text-xs font-medium text-muted">{filterLabel(t, f.key)}</legend>
      <div className="flex flex-wrap gap-x-4 gap-y-1.5">
        {order.map((v) => <Checkbox key={v} label={valueLabel(t, f.ns, v)} checked={picked.includes(v)} onChange={() => patch({ [`f.${f.key}`]: toggleIn(picked, v, order).join(",") })} data-testid={`rpq-x-f-${f.key}-${v}`} />)}
      </div>
    </fieldset>
  );
}
function FlagField({ f, value, patch }: { f: CatalogFilter; value: string | undefined; patch: Patch }) {
  const { t } = useI18n();
  return (
    <div className="min-w-0" data-testid={`rpq-x-f-${f.key}`}>
      <p className="mb-1.5 text-xs font-medium text-muted">{filterLabel(t, f.key)}</p>
      <Segmented label={filterLabel(t, f.key)} value={value ?? ""} onChange={(k) => patch({ [`f.${f.key}`]: k })} options={[{ key: "", label: t("rpq.x_any") }, { key: "yes", label: t("rpq.x_yes") }, { key: "no", label: t("rpq.x_no") }]} />
    </div>
  );
}

/** The dataset-specific filters: value lists, ranges, days, "contains" and has / has-not switches. Collapsed by default; the badge counts what is in use. */
export function ExplorerFilters({ ds, state }: { ds: CatalogDataset; state: ExplorerState }) {
  const { t } = useI18n();
  const patch = useUrlPatch();
  const used = Object.keys(state.filters).length;
  const clear = () => patch(Object.fromEntries(ds.filters.map((f) => [`f.${f.key}`, ""])));
  if (!ds.filters.length) return null;
  return (
    <details className="rounded-card border border-line bg-card" open={used > 0 || undefined} data-testid="rpq-x-filters">
      <summary className="flex cursor-pointer select-none items-center gap-2 px-4 py-3 text-sm font-semibold">
        <Filter className="size-4 text-muted" aria-hidden />{t("rpq.x_filters")}
        {used > 0 && <span className="ltr-num rounded-full bg-accent/15 px-2 text-xs text-accent" data-testid="rpq-x-filters-count">{used}</span>}
      </summary>
      <div className="grid gap-x-6 gap-y-4 border-t border-line p-4 sm:grid-cols-2 lg:grid-cols-3">
        {ds.filters.map((f) => {
          const v = state.filters[f.key];
          if (f.kind === "enum") return f.values?.length ? <EnumField key={f.key} f={f} value={v} patch={patch} /> : null;
          if (f.kind === "flag") return <FlagField key={f.key} f={f} value={v} patch={patch} />;
          if (f.kind === "text") return <TextField key={f.key} f={f} value={v} patch={patch} />;
          return <RangeField key={f.key} f={f} value={v} patch={patch} type={f.kind === "date" ? "date" : "number"} />;
        })}
      </div>
      {used > 0 && <div className="border-t border-line px-4 py-3"><Button variant="ghost" size="sm" onClick={clear} data-testid="rpq-x-filters-clear"><X className="size-4" aria-hidden />{t("rpq.x_clear_filters")}</Button></div>}
    </details>
  );
}
