"use client";
import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Banknote, Coins, Hourglass, Truck, Users, Wallet } from "lucide-react";
import { Button, EmptyState, ErrorState, PageHeader, Pagination, SearchBox, Select, Stat, StatGrid } from "@/components/ui";
import { useApi, useUrlPatch } from "@/components/ui/data";
import { cn } from "@/lib/cn";
import { fmtDate, fmtMoney } from "@/lib/format";
import { useI18n } from "@/i18n/provider";
import { hasPerm, useUser } from "@/components/layout/auth-context";
import { DownloadMenu } from "@/components/reports/fleet/DownloadMenu";
import { API_PREFIX, type Format } from "@/components/reports/fleet/fleet-lib";
import { useDownload } from "@/components/reports/fleet/useDownload";
import { FD_BY_KEY } from "@/server/finance-drivers-lib";
import { useDebounced, useTx } from "./admin-common";
import { DEFAULT_COLS, PAGE_SIZE, UI_COLS, listQuery, nextSort, pickerGroups, saveCols, sortOfUrl, useColumns, type DriversUrl } from "./admin-finance-drivers-lib";
import { DriverRow, TotalsRow } from "./admin-finance-drivers-table";
import { ColumnPicker } from "./fin-column-picker";
import { FinPeriod, type PeriodParams } from "./fin-period";
import { SortTable } from "./fin-sort-table";
import { ListSkeleton, NoAccess } from "./admin-finance-parts";

/** A filter pill that switches on and off (`aria-pressed`). */
function Chip({ on, onClick, children, testId }: { on: boolean; onClick: () => void; children: string; testId: string }) {
  return (
    <button type="button" aria-pressed={on} onClick={onClick} data-testid={testId}
      className={cn("jr-tap inline-flex h-10 items-center whitespace-nowrap rounded-xl border px-3 text-sm transition", on ? "border-accent/50 bg-accent/10 font-semibold text-accent" : "border-line bg-bg2 text-muted hover:text-ink")}>{children}</button>
  );
}

/** `/admin/finance/drivers`: every driver's wallet, earnings, payouts, withdrawals and cash on delivery in one table. Filters, sort and period live in the URL; the columns are the viewer's choice. */
export function FinanceDriversView() {
  const { t, locale } = useI18n(); const me = useUser(); const tx = useTx(); const sp = useSearchParams(); const patch = useUrlPatch(); const dl = useDownload();
  const canView = hasPerm(me, "finance.view"), canExport = hasPerm(me, "reports.export");
  const url: DriversUrl = {
    q: sp.get("q") ?? "", office: sp.get("office") ?? "", city: sp.get("city") ?? "", status: sp.get("status") ?? "", hasCash: sp.get("hasCash") === "1", hasPending: sp.get("hasPending") === "1",
    sort: sp.get("sort") ?? "", dir: sp.get("dir") ?? "", page: 1, from: sp.get("from") ?? "", to: sp.get("to") ?? "", period: sp.get("period") ?? "",
  };
  // The page belongs to the filters it was chosen under: any filter change shows page 1 again.
  const fkey = listQuery({ ...url, page: 1 });
  const [pg, setPg] = useState({ k: fkey, p: 1 });
  const page = pg.k === fkey ? pg.p : 1; const setPage = (p: number) => setPg({ k: fkey, p });
  const [q, setQ] = useState(url.q); const dq = useDebounced(q.trim());
  useEffect(() => { if (dq !== url.q.trim()) patch({ q: dq }); }, [dq]); // eslint-disable-line react-hooks/exhaustive-deps
  const colKeys = useColumns();
  const change = (p: Record<string, string>) => patch(p);
  const sort = sortOfUrl(url.sort, url.dir);
  const list = useApi(canView ? `/admin/finance/drivers${listQuery({ ...url, page })}` : null, { keepPreviousData: true, shouldRetryOnError: false });
  const cols = useMemo(() => UI_COLS.filter((c) => colKeys.includes(c.key)), [colKeys]);
  const label = (k: string) => t(`fdr.col_${k}`);
  if (!canView) return <NoAccess title={t("nav.fin_drivers")} />;

  const d = list.data; const tot = d?.totals as Record<string, number> | undefined; const rows: any[] = d?.rows ?? []; const loading = !d && !list.error;
  const filtered = !!(url.q || url.office || url.city || url.status || url.hasCash || url.hasPending);
  const reset = () => { setQ(""); change({ q: "", office: "", city: "", status: "", hasCash: "", hasPending: "" }); };
  const money = (c: number | undefined) => <span className="ltr-num">{fmtMoney(c ?? 0, locale)}</span>;
  const per: PeriodParams = { from: url.from, to: url.to, period: url.period };
  const period = d?.period as { mode: string; from: string | null; to: string | null; days: number | null } | undefined;
  const href = (f: Format) => `${API_PREFIX}/admin/finance/drivers${listQuery({ ...url, page: 1 }, { format: f, lang: locale })}`;
  const setSort = (key: string) => { const n = nextSort(sort, key); change({ sort: n.key, dir: n.dir }); };
  const strip = (
    <StatGrid cols={6}>
      <Stat label={t("fdr.k_drivers")} value={d ? <span data-testid="fd-kpi-drivers">{tot?.drivers ?? 0}</span> : undefined} loading={!d} icon={<Truck className="size-5" />} tone="accent" hint={filtered ? t("fdr.k_filtered") : t("fdr.k_all")} />
      <Stat label={t("fdr.k_earned")} value={d && <span data-testid="fd-kpi-earned">{money(tot?.earnedCents)}</span>} loading={!d} icon={<Banknote className="size-5" />} tone="cyan" hint={d && t("fdr.k_in_period", { amount: fmtMoney(tot?.periodEarnedCents ?? 0, locale) })} />
      <Stat label={t("fdr.k_paid")} value={d && <span data-testid="fd-kpi-paid">{money(tot?.paidCents)}</span>} loading={!d} icon={<Wallet className="size-5" />} tone="accent" hint={d && t("fdr.k_in_period", { amount: fmtMoney(tot?.periodPaidCents ?? 0, locale) })} />
      <Stat label={t("fdr.k_pending")} value={d && <span data-testid="fd-kpi-pending">{money(tot?.pendingCents)}</span>} loading={!d} icon={<Hourglass className="size-5" />} tone={tot?.pendingCents ? "gold" : "muted"} hint={t("fdr.k_pending_hint")} />
      <Stat label={t("fdr.k_cash")} value={d && <span data-testid="fd-kpi-cash">{money(tot?.cashHeldCents)}</span>} loading={!d} icon={<Coins className="size-5" />} tone={tot?.cashHeldCents ? "gold" : "muted"} hint={t("fdr.k_cash_hint")} />
      <Stat label={t("fdr.k_wallets")} value={d && <span data-testid="fd-kpi-wallets">{money(tot?.walletAvailableCents)}</span>} loading={!d} icon={<Users className="size-5" />} tone="muted" hint={d && t("fdr.k_wallets_hint", { held: fmtMoney(tot?.walletHeldCents ?? 0, locale) })} />
    </StatGrid>
  );
  const toolbar = (
    <>
      <SearchBox value={q} onChange={setQ} placeholder={t("fdr.f_search_ph")} label={t("fdr.f_search")} testId="fd-search" className="sm:w-60" />
      <div className="w-full sm:w-44"><Select aria-label={t("fdr.f_office")} data-testid="fd-office" value={url.office} onChange={(e) => change({ office: e.target.value })}
        options={[{ value: "", label: t("fdr.f_all_offices") }, { value: "independent", label: t("fdr.independent") }, ...(d?.offices ?? []).map((o: any) => ({ value: o.id, label: o.name }))]} /></div>
      <div className="w-[48%] sm:w-32"><Select aria-label={t("fdr.f_city")} data-testid="fd-city" value={url.city} onChange={(e) => change({ city: e.target.value })}
        options={[{ value: "", label: t("fdr.f_all_cities") }, ...(d?.cities ?? []).map((c: string) => ({ value: c, label: tx(`city.${c}`, c) }))]} /></div>
      <div className="w-[48%] sm:w-32"><Select aria-label={t("fdr.f_status")} data-testid="fd-status" value={url.status} onChange={(e) => change({ status: e.target.value })}
        options={[{ value: "", label: t("fdr.f_all_statuses") }, { value: "active", label: t("status.active") }, { value: "suspended", label: t("status.suspended") }]} /></div>
      <Chip on={url.hasCash} testId="fd-has-cash" onClick={() => change({ hasCash: url.hasCash ? "" : "1" })}>{t("fdr.f_has_cash")}</Chip>
      <Chip on={url.hasPending} testId="fd-has-pending" onClick={() => change({ hasPending: url.hasPending ? "" : "1" })}>{t("fdr.f_has_pending")}</Chip>
      <div className="ms-auto flex flex-wrap items-center gap-2">
        <ColumnPicker groups={pickerGroups(label, (g) => t(`fdr.grp_${g}`))} selected={colKeys} onChange={saveCols} onReset={() => saveCols(DEFAULT_COLS)} />
        <DownloadMenu href={href} busy={dl.busy} run={dl.run} canExport={canExport} fileBase="finance-drivers" testId="fd-download" />
      </div>
    </>
  );
  return (
    <>
      <PageHeader title={t("nav.fin_drivers")} subtitle={t("fdr.sub")} icon={<Truck className="size-5" />} />
      <div className="mb-5" data-testid="fd-kpis">{strip}</div>
      <div className="mb-4 rounded-card border border-line bg-card p-3 sm:p-4">
        <FinPeriod value={per} onChange={(p) => change({ from: p.from, to: p.to, period: p.period })} />
        {period && <p className="mt-3 border-t border-line pt-3 text-xs text-muted" data-testid="fd-period-note">{period.mode === "all" ? t("fdr.period_note_all") : t("fdr.period_note", { from: fmtDate(`${period.from}T12:00:00+03:00`, locale), to: fmtDate(`${period.to}T12:00:00+03:00`, locale), days: period.days ?? 0 })} {t("fdr.amounts_note")}</p>}
      </div>
      {list.error && !d ? <ErrorState error={list.error} retry={() => list.mutate()} /> : (
        <SortTable dense label={t("nav.fin_drivers")} testId="fd-table" cols={cols.map((c) => ({ key: c.key, label: label(c.key), sortable: FD_BY_KEY.has(c.key), align: c.kind === "money" || c.kind === "int" ? "end" : "start" }))} sort={sort} onSort={setSort} toolbar={toolbar}
          empty={!loading && rows.length === 0 ? <div className="p-4"><EmptyState icon={<Truck className="size-9" aria-hidden />} title={filtered ? t("common.no_results") : t("fdr.empty_title")} hint={filtered ? t("rdf.try_other_filters") : t("fdr.empty_hint")} action={filtered ? <Button variant="secondary" size="sm" onClick={reset} data-testid="fd-clear">{t("uxa.clear_filters")}</Button> : undefined} /></div> : undefined}
          foot={!loading && rows.length > 0 && tot ? <TotalsRow totals={tot} cols={cols} label={t("fdr.totals")} drivers={tot.drivers} /> : undefined}
          footer={d ? <Pagination page={d.page ?? page} total={d.total} pageSize={d.pageSize ?? PAGE_SIZE} onPage={setPage} /> : undefined}>
          {loading ? <tr><td colSpan={cols.length}><ListSkeleton rows={6} /></td></tr> : rows.map((r) => <DriverRow key={r.id} row={r} cols={cols} label={label} />)}
        </SortTable>
      )}
    </>
  );
}
