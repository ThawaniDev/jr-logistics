"use client";
import { useMemo, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Archive, CheckCircle2, ChevronRight, Clock, Download, FilePlus2, Inbox, PackageX, RotateCcw, Truck } from "lucide-react";
import { toast } from "sonner";
import { Button, CellPair, EmptyState, ErrorState, PageHeader, PageLoading, Pagination, SearchBox, Segmented, Select, Stat, StatGrid, Table, Td, Toolbar, Badge, NoAccess } from "@/components/ui";
import { useApi, useUrlPatch, useUrlState } from "@/components/ui/data";
import { fmtDateTime, fmtNum } from "@/lib/format";
import { cn } from "@/lib/cn";
import { useI18n } from "@/i18n/provider";
import { useDebounced } from "./admin-common";
import { PartnerStatusBadge, providerName, type Connection, type PartnerOrder, type PartnerOrderDetail } from "./business-shipments-partner";
import { DEFAULT_FILTER, ORDER_FILTERS, countOf, importableConnections, isSelectable, ordersPath, parseFilter, prunePicked, selectionSummary, togglePicked, type OrderCounts, type OrderFilter } from "./partner-orders-lib";
import {
  ArrivalHelp, CityValue, CodValue, DismissDialog, ImportOrderDialog, OrderStateBadge, PhoneValue, ProviderBadge, isAdminApi, ordersHome, requestHref,
  useCityNames, useCreateFromOrders, useOrderConnections, useOrderPerms, useRestore,
} from "./partner-orders-parts";

const PAGE_SIZE = 50;
interface OrdersPage { items: PartnerOrder[]; page: number; pageSize: number; total: number; counts: OrderCounts }

/**
 * Incoming orders list (company: `/business/integrations/orders`, staff: `/admin/integrations/orders`). Filters live in the URL
 * (`?state=`, `?connectionId=` — connection pages link here —, `?city=`, staff also `?businessId=`). Needs a <Suspense> above it.
 */
export function PartnerOrdersList({ apiBase }: { apiBase: string }) {
  const { t, locale } = useI18n(); const router = useRouter(); const path = usePathname(); const sp = useSearchParams();
  const admin = isAdminApi(apiBase); const perms = useOrderPerms(apiBase); const patchUrl = useUrlPatch();
  const [stateRaw, setStateRaw] = useUrlState("state", DEFAULT_FILTER); const filter = parseFilter(stateRaw);
  const [connectionId, setConnectionId] = useUrlState("connectionId"); const [city, setCity] = useUrlState("city"); const [businessId] = useUrlState("businessId");
  const [qIn, setQIn] = useState(() => sp.get("q") ?? ""); const q = useDebounced(qIn.trim());
  // Page and selection belong to one combination of filters: changing a filter starts again at page 1 with nothing selected.
  const filterKey = JSON.stringify([filter, connectionId, city, admin ? businessId : "", q]);
  const [pageAt, setPageAt] = useState({ key: filterKey, n: 1 }); const page = pageAt.key === filterKey ? pageAt.n : 1;
  const pageKey = `${filterKey}|${page}`;
  const [pickedAt, setPickedAt] = useState<{ key: string; ids: Set<string> }>({ key: pageKey, ids: new Set() });

  const list = useApi<OrdersPage>(perms.view ? ordersPath(apiBase, { state: filter, connectionId, city, businessId: admin ? businessId : undefined, q, page, pageSize: PAGE_SIZE }) : null, { keepPreviousData: true, refreshInterval: 60_000 });
  // All visible connections (staff: every company's): the company filter and the company column come from them.
  const conns = useOrderConnections(apiBase);
  const { names, options: cityOptions } = useCityNames();
  const create = useCreateFromOrders(apiBase);
  const [dismissing, setDismissing] = useState<PartnerOrder[] | null>(null); const [importing, setImporting] = useState(false);

  const items = useMemo(() => list.data?.items ?? [], [list.data]);
  const picked = pickedAt.key === pageKey ? prunePicked(pickedAt.ids, items) : new Set<string>();
  const setPicked = (ids: Set<string>) => setPickedAt({ key: pageKey, ids });
  const sel = selectionSummary(items, picked);
  const selectable = items.filter(isSelectable).map((o) => o.id);
  const allOn = selectable.length > 0 && selectable.every((id) => picked.has(id));
  const afterAction = () => { setPicked(new Set()); void list.mutate(); };
  const restore = useRestore(apiBase, afterAction);

  if (!perms.view) return <NoAccess />;

  const counts = list.data?.counts;
  const connById = new Map(conns.items.map((c) => [c.id, c]));
  const importable = importableConnections(conns.items);
  const canImport = perms.manage && importable.length > 0;
  const conn = connectionId ? connById.get(connectionId) : undefined;
  const narrowed = !!(q || city || connectionId || (admin && businessId));
  const clear = () => { setQIn(""); patchUrl({ connectionId: "", city: "", businessId: "", q: "" }); };
  const hrefFor = (f: OrderFilter) => { const p = new URLSearchParams(sp.toString()); p.delete("page"); if (f === DEFAULT_FILTER) p.delete("state"); else p.set("state", f); const s = p.toString(); return s ? `${path}?${s}` : path; };
  const stateLabel = (f: OrderFilter) => t(`iord.state_${f}`);
  const options = ORDER_FILTERS.map((f) => ({ key: f, label: stateLabel(f), count: countOf(counts, f) }));
  const connLabel = (c: Connection) => `${c.name} · ${providerName(t, c.provider, c.providerLabel)}${admin && c.business ? ` · ${c.business}` : ""}`;
  const connChoices = admin && businessId ? conns.items.filter((c) => c.businessId === businessId) : conns.items;
  const connOptions = [...connChoices.map((c) => ({ value: c.id, label: connLabel(c) })), ...(connectionId && !conn ? [{ value: connectionId, label: t("iord.f_connection_this") }] : [])];
  const cities = [...cityOptions, ...(city && !cityOptions.some((c) => c.value === city) ? [{ value: city, label: city }] : [])];
  const companies = admin ? [...new Map(conns.items.filter((c) => c.businessId).map((c) => [c.businessId!, c.business ?? c.businessId!])).entries()].map(([value, label]) => ({ value, label })) : [];
  if (admin && businessId && !companies.some((c) => c.value === businessId)) companies.push({ value: businessId, label: t("iord.f_company_this") });
  const integrationsHref = admin ? "/admin/integrations" : "/business/integrations";
  const detailHref = (o: PartnerOrder) => `${ordersHome(apiBase)}/${o.id}`;
  const onImported = (o: PartnerOrderDetail) => {
    setImporting(false); void list.mutate();
    toast.success(t("iord.imported", { ref: o.displayRef }), { action: { label: t("common.open"), onClick: () => router.push(detailHref(o)) } });
  };
  const all = countOf(counts, "all") ?? 0;
  const head = [
    { label: t("iord.h_select"), srOnly: true, className: "w-10" }, t("iord.h_order"), ...(admin ? [t("iord.h_company")] : []), t("iord.h_recipient"), t("iord.h_city"),
    { label: t("iord.h_cod"), align: "end" as const }, { label: t("iord.h_pieces"), align: "end" as const }, t("iord.h_partner_status"), t("iord.h_parcel"), t("iord.h_received"), { label: t("common.open"), srOnly: true },
  ];

  const bulk = selectable.length > 0 && (perms.create || perms.manage) ? (
    <div className="flex w-full flex-wrap items-center gap-2" data-testid="orders-bulk">
      <label className="me-1 inline-flex cursor-pointer items-center gap-2 text-sm text-muted">
        <input type="checkbox" className="size-4 accent-[var(--jr-accent)]" checked={allOn} onChange={(e) => setPicked(togglePicked(picked, selectable, e.target.checked))} data-testid="orders-select-page" />
        {t("iord.select_page")}
      </label>
      <span className="text-sm font-medium tabular-nums" data-testid="orders-selected-count" aria-live="polite">{t("iord.selected_n", { n: fmtNum(sel.count, locale) })}</span>
      <div className="ms-auto flex flex-wrap items-center gap-2">
        {perms.create && <Button size="sm" disabled={sel.open.length === 0} loading={create.busy} onClick={() => create.start(sel.open)} data-testid="orders-create"><FilePlus2 className="size-4" aria-hidden />{t("iord.create_order_n", { n: fmtNum(sel.open.length, locale) })}</Button>}
        {perms.manage && <Button size="sm" variant="secondary" disabled={sel.open.length === 0} onClick={() => setDismissing(items.filter((o) => sel.open.includes(o.id)))} data-testid="orders-dismiss"><Archive className="size-4" aria-hidden />{t("iord.set_aside_n", { n: fmtNum(sel.open.length, locale) })}</Button>}
        {perms.manage && (filter === "cancelled" || filter === "all" || sel.restorable.length > 0) && <Button size="sm" variant="secondary" disabled={sel.restorable.length === 0} loading={restore.busy} onClick={() => restore.run(sel.restorable)} data-testid="orders-restore"><RotateCcw className="size-4" aria-hidden />{t("iord.restore_n", { n: fmtNum(sel.restorable.length, locale) })}</Button>}
        {sel.count > 0 && <Button size="sm" variant="ghost" onClick={() => setPicked(new Set())}>{t("iord.clear_selection")}</Button>}
      </div>
    </div>
  ) : undefined;

  return (
    <>
      <PageHeader title={t("iord.nav")} icon={<Inbox className="size-5" aria-hidden />}
        breadcrumbs={[{ label: t("nav.integrations"), href: integrationsHref }, { label: t("iord.nav") }]}
        subtitle={conn ? t("iord.sub_connection", { name: conn.name }) : admin ? t("iord.admin_sub") : t("iord.sub")}
        actions={canImport ? <Button variant="secondary" onClick={() => setImporting(true)} data-testid="orders-import"><Download className="size-4" aria-hidden />{t("iord.import")}</Button> : undefined} />

      <StatGrid cols={5} className="mb-5">
        <Stat label={t("iord.state_open")} value={fmtNum(counts?.open, locale)} hint={t("iord.k_open_hint")} icon={<Clock className="size-5" />} tone={(counts?.open ?? 0) > 0 ? "gold" : "muted"} href={hrefFor("open")} loading={!counts} />
        <Stat label={t("iord.state_in_jr")} value={fmtNum(counts?.in_jr, locale)} hint={t("iord.k_in_jr_hint")} icon={<Truck className="size-5" />} tone="cyan" href={hrefFor("in_jr")} loading={!counts} />
        <Stat label={t("iord.state_delivered")} value={fmtNum(counts?.delivered, locale)} hint={t("iord.k_delivered_hint")} icon={<CheckCircle2 className="size-5" />} href={hrefFor("delivered")} loading={!counts} />
        <Stat label={t("iord.state_undelivered")} value={fmtNum(counts?.undelivered, locale)} hint={t("iord.k_undelivered_hint")} icon={<PackageX className="size-5" />} tone={(counts?.undelivered ?? 0) > 0 ? "danger" : "muted"} href={hrefFor("undelivered")} loading={!counts} />
        <Stat label={t("iord.state_cancelled")} value={fmtNum(counts?.cancelled, locale)} hint={t("iord.k_cancelled_hint")} icon={<Archive className="size-5" />} tone="muted" href={hrefFor("cancelled")} loading={!counts} />
      </StatGrid>

      <Toolbar><Segmented label={t("iord.f_state")} options={options} value={filter} onChange={(k) => setStateRaw(k)} /></Toolbar>
      <Toolbar>
        <SearchBox value={qIn} onChange={setQIn} placeholder={t("iord.search_ph")} label={t("iord.search_ph")} testId="orders-search" />
        {admin && <div className="w-52"><Select aria-label={t("iord.f_company")} placeholder={t("iord.f_company_any")} options={companies} value={businessId} onChange={(e) => patchUrl({ businessId: e.target.value, connectionId: "" })} data-testid="orders-company" /></div>}
        <div className="w-60"><Select aria-label={t("iord.f_connection")} placeholder={t("iord.f_connection_any")} options={connOptions} value={connectionId} onChange={(e) => setConnectionId(e.target.value)} data-testid="orders-connection" /></div>
        <div className="w-44"><Select aria-label={t("iord.f_city")} placeholder={t("iord.f_city_any")} options={cities} value={city} onChange={(e) => setCity(e.target.value)} data-testid="orders-city" /></div>
        {(narrowed || qIn) && <Button variant="ghost" onClick={clear}>{t("iord.clear_filters")}</Button>}
      </Toolbar>

      {list.error && !list.data ? <ErrorState error={list.error} retry={() => list.mutate()} /> : !list.data ? <PageLoading /> : items.length === 0 ? (
        // `counts` cover every state under the other filters: none at all = nothing arrived (or nothing matches); some = only this state is empty.
        all === 0 ? (narrowed ? <EmptyState title={t("iord.none_match")} action={<Button variant="secondary" onClick={clear}>{t("iord.clear_filters")}</Button>} />
          : <ArrivalHelp connections={conns.items} integrationsHref={integrationsHref} action={canImport ? <Button size="sm" onClick={() => setImporting(true)}><Download className="size-4" aria-hidden />{t("iord.import")}</Button> : undefined} />)
          : <EmptyState title={t("iord.none_in_view", { state: stateLabel(filter) })} hint={filter === "open" ? t("iord.none_open_hint") : undefined}
            action={filter !== "all" ? <Button variant="secondary" size="sm" onClick={() => setStateRaw("all")}>{t("iord.show_all")}</Button> : undefined} />
      ) : (
        <div className={cn("transition-opacity", list.isValidating && "opacity-80")} aria-busy={list.isValidating}>
          <Table stack label={t("iord.nav")} head={head} toolbar={bulk}>
            {items.map((o) => {
              const c = connById.get(o.connectionId);
              return (
                <tr key={o.id} data-testid="orders-row" data-ref={o.displayRef} data-state={o.state} className={cn("cursor-pointer align-top", picked.has(o.id) && "bg-accent/5")}
                  onClick={(e) => { if (!(e.target as HTMLElement).closest("a,button,input,label")) router.push(detailHref(o)); }}>
                  <Td label={t("iord.h_select")} className="w-10">
                    {isSelectable(o) && (perms.create || perms.manage)
                      ? <input type="checkbox" className="size-4 accent-[var(--jr-accent)]" aria-label={t("iord.pick", { ref: o.displayRef })} checked={picked.has(o.id)} onChange={(e) => setPicked(togglePicked(picked, [o.id], e.target.checked))} data-testid="order-pick" />
                      : <span className="inline-block size-4" aria-hidden />}
                  </Td>
                  <Td label={t("iord.h_order")}>
                    <Link href={detailHref(o)} className="ltr-num font-semibold text-accent hover:underline" dir="ltr">{o.displayRef}</Link>
                    <div className="mt-1 flex flex-wrap items-center gap-1"><ProviderBadge o={o} />{!o.detailsComplete && isSelectable(o) && <Badge tone="warn">{t("iord.details_incomplete")}</Badge>}</div>
                    {o.awb && o.awb !== o.displayRef && <p className="ltr-num mt-1 text-xs text-muted" dir="ltr">{t("iord.awb", { awb: o.awb })}</p>}
                    {!admin && !connectionId && conns.items.length > 1 && <p className="mt-0.5 text-xs text-muted">{o.connectionName ?? c?.name}</p>}
                  </Td>
                  {admin && <Td label={t("iord.h_company")}><CellPair title={o.businessName ?? c?.business ?? "—"} href={perms.companies ? `/admin/companies/${o.businessId}` : undefined} sub={o.connectionName ?? c?.name} /></Td>}
                  <Td label={t("iord.h_recipient")}><p className="font-medium" dir="auto">{o.recipientName || "—"}</p><div className="mt-0.5 text-xs"><PhoneValue o={o} /></div></Td>
                  <Td label={t("iord.h_city")}><CityValue o={o} names={names} /></Td>
                  <Td label={t("iord.h_cod")} align="end"><CodValue cents={o.codCents} /></Td>
                  <Td label={t("iord.h_pieces")} num>{fmtNum(o.pieces, locale)}</Td>
                  <Td label={t("iord.h_partner_status")} className="max-w-[14rem]">{o.partnerStatus ? <PartnerStatusBadge status={o.partnerStatus} at={o.partnerStatusAt} provider={providerName(t, o.provider, o.providerLabel)} /> : <span className="text-muted">—</span>}</Td>
                  <Td label={t("iord.h_parcel")}>
                    <OrderStateBadge state={o.state} />
                    {o.parcel ? (
                      <p className="mt-1 text-xs"><span className="ltr-num font-medium" dir="ltr">{o.parcel.code}</span> · <Link href={requestHref(apiBase, o.parcel.requestId)} className="ltr-num text-cyan hover:underline" data-testid="order-request-link">{o.parcel.requestRef}</Link></p>
                    ) : o.state === "cancelled" ? <p className="mt-1 text-xs text-muted">{t(o.cancelledBy === "partner" ? "iord.cancelled_by_partner_short" : "iord.set_aside_short")}</p>
                      : <p className="mt-1 text-xs text-muted">{t("iord.not_in_jr")}</p>}
                  </Td>
                  <Td label={t("iord.h_received")} className="whitespace-nowrap text-xs text-muted">{fmtDateTime(o.createdAt, locale)}</Td>
                  <Td align="end" className="w-10"><Link href={detailHref(o)} aria-label={`${t("common.open")} ${o.displayRef}`} className="inline-flex size-8 items-center justify-center rounded-lg text-muted hover:bg-card hover:text-ink"><ChevronRight className="size-4 rtl:rotate-180" aria-hidden /></Link></Td>
                </tr>
              );
            })}
          </Table>
          <Pagination page={list.data.page ?? page} total={list.data.total} pageSize={list.data.pageSize ?? PAGE_SIZE} onPage={(n) => setPageAt({ key: filterKey, n })} />
        </div>
      )}
      {create.dialog}
      {dismissing && <DismissDialog apiBase={apiBase} orders={dismissing} onClose={() => setDismissing(null)} onDone={() => { setDismissing(null); afterAction(); }} />}
      {importing && <ImportOrderDialog apiBase={apiBase} connections={conns.items} onClose={() => setImporting(false)} onImported={onImported} />}
    </>
  );
}
