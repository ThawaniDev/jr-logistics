"use client";
import { useState } from "react";
import { ArrowDown, ArrowUp, ArrowUpDown, Lock } from "lucide-react";
import { EmptyState, ErrorState, Notice, Pagination, Select, Skeleton, Table, Td } from "@/components/ui";
import { useApi, useUrlPatch } from "@/components/ui/data";
import { cn } from "@/lib/cn";
import { useI18n } from "@/i18n/provider";
import { fmtNum } from "@/lib/format";
import { Cell } from "./ExplorerCell";
import { apiParams, columnLabel, PAGE_SIZES, type CatalogDataset, type ExplorerState, type PageResult } from "./explorer-lib";

/** The result table of the explorer: server-paged and sorted (headers), row count, masked-column and not-applied-filter notices. */
export function ExplorerResults({ ds, state, sharedQs }: { ds: CatalogDataset; state: ExplorerState; sharedQs: string }) {
  const { t, locale } = useI18n();
  const patch = useUrlPatch();
  const params = apiParams(state, ds);
  // the page belongs to one query: when anything else changes the table is back on page 1
  const key = `${ds.key}|${sharedQs}|${params}`;
  const [pg, setPg] = useState({ key, page: 1 });
  const page = pg.key === key ? pg.page : 1;
  const url = `/admin/analytics/explorer/${ds.key}?${sharedQs ? `${sharedQs}&` : ""}${apiParams(state, ds, page)}`;
  const { data, error, mutate, isLoading } = useApi<PageResult>(url, { keepPreviousData: true });
  const cur = data?.sort ?? { key: state.sort || ds.defaultSort.key, dir: state.dir || ds.defaultSort.dir };
  const toggle = (k: string, numeric: boolean) => patch({ sort: k, dir: cur.key === k ? (cur.dir === "asc" ? "desc" : "asc") : numeric ? "desc" : "asc" });
  const cols = data?.columns ?? [];
  const head = cols.map((c) => {
    const on = cur.key === c.key, I = !c.sortable ? null : !on ? ArrowUpDown : cur.dir === "asc" ? ArrowUp : ArrowDown;
    const label = columnLabel(t, c.key);
    const node = (
      <span className="inline-flex items-center gap-1">
        {c.sortable ? <button type="button" onClick={() => toggle(c.key, ["number", "money", "duration", "percent", "datetime", "date"].includes(c.type))} aria-label={on ? t(cur.dir === "asc" ? "rpf.dt_sorted_asc" : "rpf.dt_sorted_desc", { name: label }) : t("rpf.dt_sort_by", { name: label })}
          className={cn("inline-flex items-center gap-1 uppercase tracking-wider hover:text-ink", on && "text-ink")}>{label}{I && <I className={cn("size-3", !on && "opacity-40")} aria-hidden />}</button> : label}
        {c.masked && <Lock className="size-3" aria-label={t("rpq.x_masked")} />}
      </span>
    );
    return { label: node as unknown as string, align: ["number", "money", "duration", "percent"].includes(c.type) ? ("end" as const) : ("start" as const) };
  });
  const reachable = data ? Math.min(data.total, data.offsetCap) : 0;
  return (
    <section className="min-w-0 rounded-card border border-line bg-card" data-testid="rpq-x-results" aria-label={t("rpq.x_results")}>
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-4 py-3">
        <p className="text-sm" aria-live="polite" data-testid="rpq-x-count">
          {data ? <><b className="ltr-num tabular-nums">{fmtNum(data.total, locale)}{data.totalCapped ? "+" : ""}</b> {t("rpq.x_rows")}</> : isLoading ? <Skeleton className="h-4 w-24" /> : null}
          {data?.meta.period && <span className="ms-2 text-xs text-muted">{t("rpq.x_in_period", { from: data.meta.period.from, to: data.meta.period.to })}</span>}
        </p>
        <Select aria-label={t("rpq.x_page_size")} value={String(state.ps)} onChange={(e) => patch({ ps: e.target.value === "25" ? "" : e.target.value })} className="h-8 w-24 text-xs" options={PAGE_SIZES.map((n) => ({ value: String(n), label: String(n) }))} />
      </div>
      {data && data.meta.ignored.length > 0 && <div className="border-b border-line p-3"><Notice tone="warn">{t("rpq.x_ignored", { filters: data.meta.ignored.map((k) => t(`rpf.f_${k}`)).join(", ") })}</Notice></div>}
      {data?.totalCapped && <div className="border-b border-line p-3"><Notice tone="info">{t("rpq.x_capped", { n: fmtNum(data.total, locale) })}</Notice></div>}
      {error ? <div className="p-4"><ErrorState error={error} retry={() => mutate()} /></div>
        : !data && isLoading ? <div className="space-y-2 p-4">{Array.from({ length: 6 }, (_, i) => <Skeleton key={i} className="h-9" />)}</div>
        : data && data.rows.length === 0 ? <div className="p-4"><EmptyState title={t("rpf.no_data")} hint={t("rpq.x_empty_hint")} /></div>
        : data && (
          <div>
            <Table bare dense stack label={t(`rpq.ds_${ds.key}`)} head={head}>
              {data.rows.map((r, i) => (
                <tr key={String(r.id ?? i)} data-testid="rpq-x-row">
                  {cols.map((c) => <Td key={c.key} label={columnLabel(t, c.key)} align={["number", "money", "duration", "percent"].includes(c.type) ? "end" : undefined} className="text-xs"><Cell type={c.type} ns={c.ns} href={c.href} value={r[c.key]} row={r} /></Td>)}
                </tr>
              ))}
            </Table>
            {data.total > data.pageSize && (
              <div className="border-t border-line px-4 pb-4">
                <Pagination page={data.page} total={reachable} pageSize={data.pageSize} onPage={(p) => setPg({ key, page: p })} />
                {data.total > data.offsetCap && <p className="mt-2 text-xs text-muted" data-testid="rpq-x-offset-cap">{t("rpq.x_offset_cap", { n: fmtNum(data.offsetCap, locale) })}</p>}
              </div>
            )}
          </div>
        )}
    </section>
  );
}
