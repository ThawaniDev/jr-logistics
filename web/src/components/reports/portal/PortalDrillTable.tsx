"use client";
import { useState, type ReactNode } from "react";
import { ArrowDown, ArrowUp, ArrowUpDown, Download } from "lucide-react";
import { CellPair, EmptyState, ErrorState, Pagination, Section, Select, StatusBadge, Skeleton, Table, Td } from "@/components/ui";
import { useApi } from "@/components/ui/data";
import { cn } from "@/lib/cn";
import { useI18n } from "@/i18n/provider";
import { fmtDate, fmtDateTime, fmtKm, fmtMoney, fmtNum } from "@/lib/format";
import { fmtDur, fmtPercent } from "../chartTheme";
import type { DrillPage } from "../types";
import type { PortalRole } from "./types";

type Col = DrillPage["columns"][number];
const fill = (tpl: string, row: Record<string, unknown>) => tpl.replace(/\{(\w+)\}/g, (_, k) => encodeURIComponent(String(row[k] ?? "")));

/**
 * The portal twin of `DrillTable`: the same server-paged, sortable table over the portal drill-down contract (`GET /<business|office>/analytics/table/:name`, see
 * `server/analytics/portal-registry.ts`), with the CSV button for the OWNER (no staff permission: every owner may export their own data, the export is audited).
 * `qs` is the filter query string (`filters.qs`); the page resets to 1 when it changes.
 */
export function PortalDrillTable({ role, name, qs, title, pageSize = 10, testId, actions, csv: csvButton = true }: { role: PortalRole; name: string; qs: string; title?: string; pageSize?: number; testId?: string; /** extra header controls (the fleet centre's Download menu) */ actions?: ReactNode; /** `false` hides the built-in CSV button when `actions` offers the export */ csv?: boolean }) {
  const { t, locale } = useI18n();
  // The page belongs to one filter set: when `qs` changes the stored page no longer applies and the table is back on page 1.
  const [pg, setPg] = useState({ qs, page: 1 });
  const page = pg.qs === qs ? pg.page : 1;
  const setPage = (p: number) => setPg({ qs, page: p });
  const [sort, setSort] = useState<{ key: string; dir: "asc" | "desc" } | null>(null);
  const base = `/${role}/analytics/table/${name}?${qs ? `${qs}&` : ""}`;
  const sortQs = sort ? `&sort=${sort.key}&dir=${sort.dir}` : "";
  const { data, error, mutate, isLoading } = useApi<DrillPage>(`${base}page=${page}&pageSize=${pageSize}${sortQs}`, { keepPreviousData: true });
  const cur = data?.sort ?? sort;
  const cols = data?.columns ?? [];
  const toggle = (c: Col) => { setPage(1); setSort(cur?.key === c.key ? { key: c.key, dir: cur.dir === "asc" ? "desc" : "asc" } : { key: c.key, dir: c.align === "end" ? "desc" : "asc" }); };
  const cell = (c: Col, row: Record<string, unknown>): ReactNode => {
    const v = row[c.key];
    if (v === null || v === undefined || v === "") return "—";
    const num = (s: string) => <span className="ltr-num whitespace-nowrap tabular-nums">{s}</span>;
    switch (c.type) {
      case "money": return num(fmtMoney(Number(v), locale));
      case "number": return num(fmtNum(Number(v), locale));
      case "percent": return num(fmtPercent(Number(v), locale));
      case "duration": return num(fmtDur(Number(v), locale));
      case "distance": return num(fmtKm(Number(v), locale)); // metres in the API, kilometres on screen
      case "date": return <span className="whitespace-nowrap">{fmtDate(String(v), locale)}</span>;
      case "datetime": return <span className="whitespace-nowrap">{fmtDateTime(String(v), locale)}</span>;
      case "status": return <StatusBadge status={String(v)} ns={c.ns ?? "status"} />;
      case "enum": { const k = `${c.ns}.${v}`; const s = t(k); return s === k ? String(v) : s; }
      case "link": return <CellPair title={<span className="ltr-num">{String(v)}</span>} sub={c.sub ? (row[c.sub] as ReactNode) : undefined} href={c.href ? fill(c.href, row) : undefined} />;
      default: return c.sub ? <CellPair title={String(v)} sub={row[c.sub] as ReactNode} /> : String(v);
    }
  };
  const head = cols.map((c) => {
    const on = cur?.key === c.key, I = !c.sortable ? null : !on ? ArrowUpDown : cur!.dir === "asc" ? ArrowUp : ArrowDown;
    const label = t(c.label);
    const node = c.sortable ? (
      <button type="button" onClick={() => toggle(c)} aria-label={on ? t(cur!.dir === "asc" ? "rpf.dt_sorted_asc" : "rpf.dt_sorted_desc", { name: label }) : t("rpf.dt_sort_by", { name: label })} className={cn("inline-flex items-center gap-1 uppercase tracking-wider hover:text-ink", on && "text-ink")}>{label}{I && <I className={cn("size-3", !on && "opacity-40")} aria-hidden />}</button>
    ) : label;
    return { label: node as unknown as string, align: c.align ?? ("start" as const), className: c.phone === false ? "max-sm:hidden!" : undefined };
  });
  const csv = csvButton && data ? `/api/v1${base}format=csv${sortQs}` : null;
  const heading = title ?? (data ? t(data.title) : "");
  return (
    <div data-testid={testId} className="min-w-0"><Section title={heading} flush actions={<>
      {data && cols.some((c) => c.sortable) && (
        <div className="flex items-center gap-1.5 sm:hidden">
          <Select aria-label={t("rpf.dt_sort")} value={cur?.key ?? ""} onChange={(e) => { setPage(1); setSort({ key: e.target.value, dir: cur?.dir ?? "desc" }); }} className="h-8 text-xs" options={cols.filter((c) => c.sortable).map((c) => ({ value: c.key, label: t(c.label) }))} />
          <button type="button" aria-label={t("rpf.dt_toggle_dir")} onClick={() => cur && (setPage(1), setSort({ key: cur.key, dir: cur.dir === "asc" ? "desc" : "asc" }))} className="jr-tap flex size-8 items-center justify-center rounded-lg border border-line text-muted">{cur?.dir === "asc" ? <ArrowUp className="size-4" /> : <ArrowDown className="size-4" />}</button>
        </div>
      )}
      {actions}
      {csv && <a href={csv} download data-testid={testId ? `${testId}-csv` : "portal-drill-csv"} className="inline-flex h-8 items-center gap-2 rounded-xl border border-line bg-bg2 px-3 text-xs text-ink hover:border-accent/60 pointer-coarse:h-10 print:hidden"><Download className="size-4" aria-hidden />{t("rpf.export_csv")}</a>}
    </>}>
      {error ? <div className="p-4"><ErrorState error={error} retry={() => mutate()} /></div> : !data && isLoading ? <div className="space-y-2 p-4">{Array.from({ length: 5 }, (_, i) => <Skeleton key={i} className="h-9" />)}</div> : data && data.rows.length === 0 ? <div className="p-4"><EmptyState title={t("rpf.no_data")} hint={t("rpf.no_data_hint")} /></div> : data && (
        <>
          <Table bare dense stack label={heading} head={head}>
            {data.rows.map((r, i) => <tr key={String(r.id ?? i)}>{cols.map((c) => <Td key={c.key} label={t(c.label)} align={c.align === "end" ? "end" : undefined} className={cn("text-xs", c.phone === false && "max-sm:hidden!")}>{cell(c, r)}</Td>)}</tr>)}
          </Table>
          {data.total > data.pageSize && <div className="border-t border-line px-4 pb-4"><Pagination page={data.page} total={data.total} pageSize={data.pageSize} onPage={setPage} /></div>}
        </>
      )}
    </Section></div>
  );
}
