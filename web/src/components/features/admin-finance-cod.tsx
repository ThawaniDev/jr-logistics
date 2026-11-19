"use client";
import { useState } from "react";
import { Coins, HandCoins, Truck, Wallet } from "lucide-react";
import { Button, EmptyState, LinkTabs, Notice, PageHeader, SearchBox, Segmented, Select, Stat, StatGrid, Toolbar } from "@/components/ui";
import { useApi } from "@/components/ui/data";
import { useI18n } from "@/i18n/provider";
import { hasPerm, useUser } from "@/components/layout/auth-context";
import { qs, useDebounced } from "./admin-common";
import { ReceiveMoneyModal, useCodDirectory } from "./admin-cod";
import { driversOf, scopeCodRows, uniqueWarehouses, type CodRow } from "./admin-fieldops-lib";
import { DriversTable, OrdersTable, RemittancesTable } from "./admin-finance-cod-views";
import { ListBody, Money, NoAccess, PAGE, useUrlFilters } from "./admin-finance-parts";

const FILTERS = ["businessId", "driverId", "show", "view", "offerId", "q"] as const;
const withCurrent = (opts: Array<{ id: string; name: string }>, cur: string) => (cur && !opts.some((o) => o.id === cur) ? [{ id: cur, name: cur.slice(0, 8) }, ...opts] : opts);

/**
 * Cash on delivery — two views of one function (LinkTabs): the orders / drivers that still hold cash, and the history of receipts.
 * Deep link from a request page: `?offerId=…` opens "Receive money" for that order.
 */
export function CodConsole({ tab }: { tab: "orders" | "remittances" }) {
  const { t } = useI18n(); const me = useUser();
  const canManage = hasPerm(me, "cod.manage"); const canView = canManage || hasPerm(me, "finance.view");
  const [f, setF] = useUrlFilters(FILTERS);
  const { businessId, driverId } = f; const focusOffer = f.offerId;
  const show = f.show === "all" ? "all" : "outstanding"; const view = f.view === "drivers" ? "drivers" : "orders";
  const [q, setQ] = useState(f.q); const dq = useDebounced(q.trim()); const [page, setPage] = useState(1);
  const [receive, setReceive] = useState<null | { row: CodRow | null }>(null); const [dismissed, setDismissed] = useState(false);
  const orders = useApi(canView && tab === "orders" && view === "orders" ? `/admin/cod${qs({ businessId, driverId, q: dq, onlyOutstanding: show === "outstanding" ? 1 : "", page, pageSize: PAGE })}` : null, { keepPreviousData: true });
  const byDriver = useApi(canView && tab === "orders" && view === "drivers" ? `/admin/finance/cod/drivers${qs({ businessId, q: dq, onlyOutstanding: show === "outstanding" ? 1 : "" })}` : null, { keepPreviousData: true });
  const kpi = useApi(canView ? "/admin/finance/cod/drivers" : null, { keepPreviousData: true, shouldRetryOnError: false });
  const dir = useCodDirectory(canView);
  const rows: CodRow[] = dir.data?.rows ?? [];
  if (!canView) return <NoAccess title={t("nav.cod")} />;
  const refresh = () => { void orders.mutate(); void byDriver.mutate(); void kpi.mutate(); void dir.mutate(); };

  // Deep link from a request page: opens the receive dialog for that order.
  const deepRow = !dismissed && focusOffer ? rows.find((r) => r.offerId === focusOffer) : undefined;
  const modalRow = receive ? receive.row : deepRow && deepRow.outstandingCents > 0 ? deepRow : null;
  const modalOpen = canManage && (receive !== null || !!modalRow);
  const focusMissing = !!focusOffer && !dismissed && !!dir.data && !deepRow;
  const k = kpi.data?.totals;
  const warehouses = uniqueWarehouses(rows); const drivers = driversOf(rows, businessId);
  // Segment counts follow the search / warehouse / driver filters; the directory is capped, so they are hidden when it is incomplete.
  const scoped = scopeCodRows(rows, { businessId, driverId, q: dq });
  const counts = dir.data && !dir.data.truncated ? { out: scoped.outstanding, all: scoped.all } : null;
  const filtered = !!(businessId || driverId || dq);
  const go = (patch: Partial<Record<(typeof FILTERS)[number], string>>) => { setPage(1); setF(patch); };
  const reset = () => { setQ(""); go({ businessId: "", driverId: "", q: "" }); };
  const open = (row: CodRow | null) => { setDismissed(true); setReceive({ row }); };
  const listErr = orders.error ?? byDriver.error;
  const driverRows = (byDriver.data?.items ?? []).filter((d: { driverId: string }) => !driverId || d.driverId === driverId);
  return (
    <>
      <PageHeader title={t("nav.cod")} subtitle={t("foa.cod_sub")} icon={<Coins className="size-5" />}
        actions={canManage && <Button data-testid="foa-cod-receive-generic" onClick={() => open(null)}><HandCoins className="size-4" aria-hidden />{t("foa.cod_receive_btn")}</Button>} />
      <div className="mb-5" aria-live="polite"><StatGrid cols={4}>
        <Stat label={t("foa.cod_collected")} value={k && <span data-testid="foa-cod-total-collected"><Money c={k.collectedCents} /></span>} hint={t("rdf.cod_collected_hint")} icon={<Wallet className="size-5" />} tone="cyan" loading={!k} />
        <Stat label={t("foa.cod_received")} value={k && <span data-testid="foa-cod-total-received"><Money c={k.receivedCents} /></span>} hint={t("rdf.cod_received_hint")} icon={<HandCoins className="size-5" />} tone="accent" loading={!k} />
        <Stat label={t("foa.cod_outstanding")} value={k && <span data-testid="foa-cod-total-outstanding"><Money c={k.outstandingCents} /></span>} hint={t("rdf.cod_outstanding_hint")} icon={<Coins className="size-5" />} tone={k && k.outstandingCents > 0 ? "gold" : "muted"} loading={!k} />
        <Stat label={t("rdf.cod_drivers_holding")} value={k && <span data-testid="fin-cod-drivers-holding" className="ltr-num">{k.drivers}</span>} hint={t("rdf.cod_orders_open", { n: k?.orders ?? 0 })} icon={<Truck className="size-5" />} tone="muted" loading={!k} href="/admin/finance/cod?view=drivers" />
      </StatGrid></div>
      {!canManage && <div className="mb-4"><Notice tone="info">{t("foa.cod_readonly")}</Notice></div>}
      <div className="mb-4"><Notice tone="info">{t("foa.cod_explain")}</Notice></div>
      {focusMissing && <div className="mb-4"><Notice tone="warn">{t("foa.cod_focus_missing")}</Notice></div>}
      <LinkTabs label={t("nav.cod")} tabs={[{ href: "/admin/finance/cod", label: t("foa.cod_tab_orders"), count: k ? k.orders : undefined }, { href: "/admin/finance/cod/remittances", label: t("foa.cod_tab_remittances") }]} />
      <Toolbar end={filtered && <Button variant="ghost" size="sm" onClick={reset} data-testid="fin-clear-filters">{t("uxa.clear_filters")}</Button>}>
        {tab === "orders" && <>
          <Segmented label={t("rdf.cod_view")} value={view} onChange={(v) => go({ view: v === "drivers" ? "drivers" : "" })} options={[{ key: "orders", label: t("rdf.cod_by_order") }, { key: "drivers", label: t("rdf.cod_by_driver") }]} />
          <div data-testid="foa-cod-only-outstanding" className="contents"><Segmented label={t("common.status")} value={show} onChange={(v) => go({ show: v === "all" ? "all" : "" })} options={[{ key: "outstanding", label: t("foa.cod_outstanding"), count: counts?.out }, { key: "all", label: t("common.all"), count: counts?.all }]} /></div>
          <div data-testid="foa-cod-filter-q" className="contents"><SearchBox value={q} onChange={(v) => { setQ(v); setPage(1); }} placeholder={t("foa.cod_search_ph")} label={t("common.search")} /></div>
        </>}
        <div className="w-full sm:w-48"><Select data-testid="foa-cod-filter-business" aria-label={t("foa.cod_warehouse")} placeholder={t("rdf.cod_all_warehouses")} options={withCurrent(warehouses, businessId).map((w) => ({ value: w.id, label: w.name }))} value={businessId} onChange={(e) => go({ businessId: e.target.value, driverId: "" })} /></div>
        <div className="w-full sm:w-48"><Select data-testid="foa-cod-filter-driver" aria-label={t("foa.cod_driver")} placeholder={t("rdf.cod_all_drivers")} options={withCurrent(drivers, driverId).map((w) => ({ value: w.id, label: w.name }))} value={driverId} onChange={(e) => go({ driverId: e.target.value })} /></div>
      </Toolbar>
      {dir.data?.truncated && <p className="mb-3 text-xs text-muted">{t("foa.cod_truncated")}</p>}
      {tab === "remittances" ? <RemittancesTable key={`${businessId}|${driverId}`} businessId={businessId} driverId={driverId} enabled /> : view === "drivers" ? (
        <ListBody error={listErr} loaded={!!byDriver.data} isEmpty={driverRows.length === 0} retry={() => byDriver.mutate()}
          emptyState={<EmptyState icon={<Truck className="size-9" aria-hidden />} title={t("foa.cod_nothing_outstanding")} hint={t("rdf.cod_drivers_empty_hint")} action={show === "outstanding" && !filtered ? <Button size="sm" variant="secondary" onClick={() => go({ show: "all" })}>{t("rdf.cod_show_all")}</Button> : filtered ? <Button size="sm" variant="secondary" onClick={reset}>{t("uxa.clear_filters")}</Button> : undefined} />}>
          <DriversTable key={`${businessId}|${driverId}|${dq}|${show}`} rows={driverRows} onOpen={(id) => go({ view: "", driverId: id })} />
        </ListBody>
      ) : (
        <ListBody error={listErr} loaded={!!orders.data} isEmpty={orders.data?.items.length === 0} retry={() => orders.mutate()}
          emptyState={<EmptyState icon={<HandCoins className="size-9" aria-hidden />} title={filtered ? t("common.no_results") : show === "outstanding" && rows.length > 0 ? t("foa.cod_nothing_outstanding") : t("foa.cod_empty")} hint={filtered ? t("rdf.try_other_filters") : show === "outstanding" && rows.length > 0 ? t("rdf.cod_show_all_hint") : t("foa.cod_empty_hint")}
            action={filtered ? <Button size="sm" variant="secondary" onClick={reset} data-testid="fin-clear-filters">{t("uxa.clear_filters")}</Button> : show === "outstanding" && rows.length > 0 ? <Button size="sm" variant="secondary" onClick={() => go({ show: "all" })}>{t("rdf.cod_show_all")}</Button> : undefined} />}>
          <OrdersTable rows={orders.data?.items ?? []} focusOffer={focusOffer} canManage={canManage} onReceive={open} page={page} total={orders.data?.total ?? 0} onPage={setPage} />
        </ListBody>
      )}
      <ReceiveMoneyModal open={modalOpen} row={modalRow} directory={rows} onClose={() => { setReceive(null); setDismissed(true); }} onDone={refresh} />
    </>
  );
}
