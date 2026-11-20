"use client";
import { useMemo, useState } from "react";
import Link from "next/link";
import { Download } from "lucide-react";
import { Button, EmptyState, Pagination, SearchBox, Td } from "@/components/ui";
import { cn } from "@/lib/cn";
import { useI18n } from "@/i18n/provider";
import { useTx } from "./admin-common";
import type { CodOverview } from "./business-cod";
import { COD_SORT_DEFAULT, filterOrders, flattenOrders, ordersCsv, sortOrders, type CodSort, type CodSortKey } from "./business-cod-lib";
import { OfficeCell, WarehouseCell } from "./business-cod-parts";
import { Amount } from "./fin-amount";
import { SortTable } from "./fin-sort-table";

const PAGE = 25;
/** The "Table" view of the cash page: every order with cash in ONE table — Order · Warehouse · Office · Driver · Collected · Received · Outstanding — with column sorting, search and a CSV of what is shown. */
export function AllOrdersTable({ data, onReceive }: { data: CodOverview; onReceive: (offerId: string, driverId: string) => void }) {
  const { t, locale } = useI18n(); const tx = useTx();
  const [q, setQ] = useState(""); const [only, setOnly] = useState(false); const [sort, setSort] = useState<CodSort>(COD_SORT_DEFAULT);
  // The page belongs to the search / sort it was chosen under: any change shows page 1 again.
  const sel = `${q}|${only}|${sort.key}|${sort.dir}`; const [pg, setPg] = useState({ k: sel, p: 1 });
  const page = pg.k === sel ? pg.p : 1; const setPage = (p: number) => setPg({ k: sel, p });
  const all = useMemo(() => flattenOrders(data), [data]);
  const city = (k: string) => tx(`city.${k}`, k);
  const rows = useMemo(() => sortOrders(filterOrders(all, q, only, city), sort, locale), [all, q, only, sort, locale]); // eslint-disable-line react-hooks/exhaustive-deps
  const onSort = (key: string) => setSort((s) => (s.key === key ? { key: s.key, dir: s.dir === "asc" ? "desc" : "asc" } : { key: key as CodSortKey, dir: ["collected", "received", "outstanding"].includes(key) ? "desc" : "asc" }));
  const exportCsv = () => {
    const csv = ordersCsv(rows, { ref: t("req.ref"), warehouse: t("cdc.col_warehouse"), city: t("fdr.col_city"), office: t("cdc.col_office"), driver: t("cdc.col_driver"), collected: t("fob.cash_collected"), received: t("fob.cash_received"), outstanding: t("fob.cash_outstanding") }, t("cdc.independent"), city);
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a"); a.href = url; a.download = "cash-on-delivery.csv"; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30_000);
  };
  const cols = [
    { key: "ref", label: t("req.ref"), sortable: true }, { key: "warehouse", label: t("cdc.col_warehouse"), sortable: true }, { key: "office", label: t("cdc.col_office"), sortable: true }, { key: "driver", label: t("cdc.col_driver"), sortable: true },
    { key: "collected", label: t("fob.cash_collected"), sortable: true, align: "end" as const }, { key: "received", label: t("fob.cash_received"), sortable: true, align: "end" as const },
    { key: "outstanding", label: t("fob.cash_outstanding"), sortable: true, align: "end" as const }, { key: "actions", label: t("common.open"), srOnly: true, align: "end" as const },
  ];
  const shown = rows.slice((page - 1) * PAGE, page * PAGE);
  const sum = rows.reduce((a, r) => ({ c: a.c + r.collectedCents, r: a.r + r.receivedCents, o: a.o + r.outstandingCents }), { c: 0, r: 0, o: 0 });
  return (
    <section aria-labelledby="all-h" data-testid="cod-all">
      <div className="mb-3 flex flex-wrap items-end justify-between gap-2"><div><h2 id="all-h" className="font-semibold">{t("cdc.all_title")}</h2><p className="text-sm text-muted">{t("cdc.all_sub")}</p></div></div>
      <SortTable dense label={t("cdc.all_title")} testId="cod-all-table" cols={cols} sort={sort} onSort={onSort}
        toolbar={<>
          <SearchBox value={q} onChange={setQ} placeholder={t("cdc.search_ph")} label={t("cdc.search_ph")} testId="cod-all-search" className="sm:w-72" />
          <button type="button" aria-pressed={only} onClick={() => setOnly((v) => !v)} data-testid="cod-all-only-outstanding"
            className={cn("jr-tap inline-flex h-10 items-center rounded-xl border px-3 text-sm transition", only ? "border-accent/50 bg-accent/10 font-semibold text-accent" : "border-line bg-bg2 text-muted hover:text-ink")}>{t("cdc.only_outstanding")}</button>
          <span className="text-xs text-muted" data-testid="cod-all-count">{t("cdc.n_orders", { n: rows.length })}</span>
          <div className="ms-auto"><Button variant="secondary" size="sm" onClick={exportCsv} disabled={rows.length === 0} data-testid="cod-all-export"><Download className="size-4" aria-hidden />{t("cdc.export")}</Button></div>
        </>}
        empty={rows.length === 0 ? <div className="p-4"><EmptyState title={all.length === 0 ? t("fob.cash_none_title") : t("cdc.empty_search")} hint={all.length === 0 ? t("fob.cash_none_hint") : undefined} /></div> : undefined}
        footer={<Pagination page={page} total={rows.length} pageSize={PAGE} onPage={setPage} />}
        foot={rows.length > 0 ? (
          <tr data-testid="cod-all-totals">
            <td className="px-4 py-3" colSpan={4}>{t("cdc.total_row")}</td>
            <td className="px-4 py-3 text-end"><Amount c={sum.c} className="text-ink" /></td><td className="px-4 py-3 text-end"><Amount c={sum.r} className="text-ink" /></td>
            <td className="px-4 py-3 text-end"><Amount c={sum.o} className={sum.o > 0 ? "text-gold" : "text-ink"} /></td><td />
          </tr>
        ) : undefined}>
        {shown.map((r) => (
          <tr key={r.offerId} data-testid="cod-all-row" data-offer={r.offerId}>
            <Td label={t("req.ref")}><Link href={`/business/requests/${r.requestId}/money`} className="ltr-num whitespace-nowrap font-semibold text-accent hover:underline">{r.ref}</Link></Td>
            <Td label={t("cdc.col_warehouse")}><WarehouseCell w={r.warehouse} /></Td>
            <Td label={t("cdc.col_office")}><OfficeCell officeId={r.officeId} officeName={r.officeName} /></Td>
            <Td label={t("cdc.col_driver")}><span data-testid="cod-all-driver">{r.driverName}</span></Td>
            <Td label={t("fob.cash_collected")} num><Amount c={r.collectedCents} className="text-ink" /></Td>
            <Td label={t("fob.cash_received")} num className="text-muted"><Amount c={r.receivedCents} /></Td>
            <Td label={t("fob.cash_outstanding")} num className={cn("font-semibold", r.outstandingCents > 0 && "text-gold")}><Amount c={r.outstandingCents} className={r.outstandingCents > 0 ? "text-gold" : undefined} /></Td>
            <Td align="end">{r.outstandingCents > 0 && <Button size="sm" variant="secondary" onClick={() => onReceive(r.offerId, r.driverId)} data-testid="cod-order-receive" className="whitespace-nowrap">{t("fob.rcv_short")}</Button>}</Td>
          </tr>
        ))}
      </SortTable>
    </section>
  );
}
