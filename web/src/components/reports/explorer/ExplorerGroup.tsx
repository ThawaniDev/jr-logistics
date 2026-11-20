"use client";
import { Plus, Sigma, Trash2 } from "lucide-react";
import { Button, EmptyState, ErrorState, Notice, Select, Skeleton, Table, Td } from "@/components/ui";
import { useApi, useUrlPatch } from "@/components/ui/data";
import { useI18n } from "@/i18n/provider";
import { fmtNum } from "@/lib/format";
import { Cell } from "./ExplorerCell";
import { apiParams, columnLabel, type CatalogDataset, type ExplorerState, type GroupResult } from "./explorer-lib";

const FNS = ["sum", "avg", "min", "max", "p50", "p90"] as const;
const BUCKETS = ["day", "week", "month"] as const;

/** Group by one column and add count, sum, average, min, max, p50 or p90 of numeric columns: a quick pivot over the same filters. */
export function ExplorerGroupPanel({ ds, state }: { ds: CatalogDataset; state: ExplorerState }) {
  const { t } = useI18n();
  const patch = useUrlPatch();
  const [gKey, gBucket] = state.group.split("~");
  const gcol = ds.columns.find((c) => c.key === gKey);
  const groupables = ds.columns.filter((c) => c.groupable), numerics = ds.columns.filter((c) => c.aggregable);
  const setAgg = (next: string[]) => patch({ agg: next.join(",") });
  const aggs = state.agg.filter((a) => a.includes(":"));
  return (
    <details className="rounded-card border border-line bg-card" open={!!state.group || undefined} data-testid="rpq-x-group">
      <summary className="flex cursor-pointer select-none items-center gap-2 px-4 py-3 text-sm font-semibold"><Sigma className="size-4 text-muted" aria-hidden />{t("rpq.x_group")}{state.group && <span className="rounded-full bg-accent/15 px-2 text-xs text-accent">{columnLabel(t, gKey)}</span>}</summary>
      <div className="space-y-4 border-t border-line p-4">
        <p className="text-xs text-muted">{t("rpq.x_group_hint")}</p>
        <div className="grid gap-3 sm:grid-cols-2">
          <Select label={t("rpq.x_group_by")} value={gKey} placeholder={t("rpq.x_no_group")} data-testid="rpq-x-group-by" onChange={(e) => patch({ group: e.target.value, ...(e.target.value ? {} : { agg: "" }) })}
            options={groupables.map((c) => ({ value: c.key, label: columnLabel(t, c.key) }))} />
          {gcol?.temporal && <Select label={t("rpq.x_bucket")} value={gBucket ?? "day"} data-testid="rpq-x-group-bucket" onChange={(e) => patch({ group: `${gKey}~${e.target.value}` })} options={BUCKETS.map((b) => ({ value: b, label: t(`rpf.b_${b}`) }))} />}
        </div>
        {gcol && (
          <div className="space-y-2" data-testid="rpq-x-aggs">
            <p className="text-xs font-medium text-muted">{t("rpq.x_measures")}</p>
            {aggs.map((a, i) => {
              const [fn, col] = a.split(":");
              return (
                <div key={`${a}-${i}`} className="grid grid-cols-[1fr_1fr_auto] items-end gap-2" data-testid="rpq-x-agg">
                  <Select aria-label={t("rpq.x_fn")} value={fn} onChange={(e) => setAgg(aggs.map((x, j) => (j === i ? `${e.target.value}:${col}` : x)))} options={FNS.map((f) => ({ value: f, label: t(`rpq.fn_${f}`) }))} />
                  <Select aria-label={t("rpq.x_measure_col")} value={col} onChange={(e) => setAgg(aggs.map((x, j) => (j === i ? `${fn}:${e.target.value}` : x)))} options={numerics.map((c) => ({ value: c.key, label: columnLabel(t, c.key) }))} />
                  <Button variant="ghost" size="sm" aria-label={t("rpq.x_remove_measure")} onClick={() => setAgg(aggs.filter((_, j) => j !== i))}><Trash2 className="size-4" aria-hidden /></Button>
                </div>
              );
            })}
            {aggs.length < 6 && numerics.length > 0 && <Button variant="secondary" size="sm" data-testid="rpq-x-agg-add" onClick={() => setAgg([...aggs, `sum:${numerics[0].key}`])}><Plus className="size-4" aria-hidden />{t("rpq.x_add_measure")}</Button>}
          </div>
        )}
      </div>
    </details>
  );
}

/** The grouped result: one row per group with the count and the chosen measures. */
export function ExplorerGroupResult({ ds, state, sharedQs }: { ds: CatalogDataset; state: ExplorerState; sharedQs: string }) {
  const { t, locale } = useI18n();
  const url = `/admin/analytics/explorer/${ds.key}?${sharedQs ? `${sharedQs}&` : ""}${apiParams(state, ds)}`;
  const { data, error, mutate, isLoading } = useApi<GroupResult>(url, { keepPreviousData: true });
  if (error) return <ErrorState error={error} retry={() => mutate()} />;
  if (!data && isLoading) return <div className="space-y-2">{Array.from({ length: 5 }, (_, i) => <Skeleton key={i} className="h-9" />)}</div>;
  if (!data) return null;
  const g = data.group, total = data.rows.reduce((s, r) => s + Number(r.n ?? 0), 0);
  return (
    <section className="min-w-0 rounded-card border border-line bg-card" data-testid="rpq-x-group-result" aria-label={t("rpq.x_group")}>
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-3 text-sm">
        <p><b className="ltr-num tabular-nums">{fmtNum(data.rows.length, locale)}</b> {t("rpq.x_groups")} · <b className="ltr-num tabular-nums">{fmtNum(total, locale)}</b> {t("rpq.x_rows")}</p>
      </div>
      {data.meta.ignored.length > 0 && <div className="border-b border-line p-3"><Notice tone="warn">{t("rpq.x_ignored", { filters: data.meta.ignored.map((k) => t(`rpf.f_${k}`)).join(", ") })}</Notice></div>}
      {data.truncated && <div className="border-b border-line p-3"><Notice tone="info">{t("rpq.x_groups_capped", { n: data.groupCap })}</Notice></div>}
      {data.rows.length === 0 ? <div className="p-4"><EmptyState title={t("rpf.no_data")} hint={t("rpq.x_empty_hint")} /></div> : (
        <Table bare dense stack label={t("rpq.x_group")} head={[columnLabel(t, g.key), { label: t("rpq.x_count"), align: "end" }, ...data.aggs.map((a) => ({ label: `${t(`rpq.fn_${a.fn}`)} · ${columnLabel(t, a.column)}`, align: "end" as const }))]}>
          {data.rows.map((r, i) => (
            <tr key={`${r.g ?? "null"}-${i}`} data-testid="rpq-x-group-row">
              <Td label={columnLabel(t, g.key)}>{g.bucket ? <span className="ltr-num">{String(r.g ?? "—")}</span> : <Cell type={g.type} ns={g.ns} value={r.g} row={r} />}</Td>
              <Td label={t("rpq.x_count")} align="end" className="font-semibold"><span className="ltr-num tabular-nums">{fmtNum(Number(r.n ?? 0), locale)}</span></Td>
              {data.aggs.map((a) => <Td key={a.key} label={`${t(`rpq.fn_${a.fn}`)} · ${columnLabel(t, a.column)}`} align="end"><Cell type={a.type} value={r[a.key]} row={r} /></Td>)}
            </tr>
          ))}
        </Table>
      )}
    </section>
  );
}
