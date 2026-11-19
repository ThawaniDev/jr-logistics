"use client";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ArrowRight, BellRing, CheckCircle2, ChevronRight, Clock, FileEdit, FilePlus2 } from "lucide-react";
import { Badge, Button, CellPair, EmptyState, ErrorState, PageHeader, PageLoading, Pagination, SearchBox, Segmented, Select, Stat, StatGrid, StatusBadge, Table, Td, Toolbar, Input } from "@/components/ui";
import { useApi, useUrlState } from "@/components/ui/data";
import { parcelsOf } from "./business-shipments-lib";
import { orderFilterCount, orderFilterParams, parseOrderFilter, visibleOrderFilters } from "./business-views-lib";
import { fmtDateTime, fmtMoney, fmtNum, riyadhLocalToIso } from "@/lib/format";
import { cn } from "@/lib/cn";
import { useI18n } from "@/i18n/provider";

const PAGE_SIZE = 15;

/** The status filter lives in the URL (`?status=action`); the older `?needsAction=1` links keep working and are rewritten on the first change. */
function useOrderFilter(): [string, (k: string) => void] {
  const sp = useSearchParams(); const router = useRouter(); const path = usePathname();
  const value = parseOrderFilter(sp.get("status"), sp.get("needsAction"));
  const spStr = sp.toString();
  const set = useCallback((k: string) => {
    const q = new URLSearchParams(spStr);
    q.delete("needsAction"); q.delete("page");
    if (k) q.set("status", k); else q.delete("status");
    const s = q.toString();
    router.replace(s ? `${path}?${s}` : path, { scroll: false });
  }, [spStr, path, router]);
  return [value, set];
}

export function OrdersList() {
  const { t, locale } = useI18n(); const router = useRouter();
  const [filter, setFilter] = useOrderFilter();
  const [pageStr, setPageStr] = useUrlState("page", "1"); const page = Math.max(1, Number(pageStr) || 1);
  const [qInput, setQInput] = useState(""); const [q, setQ] = useState(""); const [city, setCity] = useState(""); const [from, setFrom] = useState(""); const [to, setTo] = useState("");
  // Search as you type, but only hit the API once typing pauses.
  useEffect(() => {
    const next = qInput.trim(); if (next === q) return;
    const id = setTimeout(() => { setQ(next); setPageStr("1"); }, 300);
    return () => clearTimeout(id);
  }, [qInput, q, setPageStr]);
  const { data: cat } = useApi("/catalog");
  const ov = useApi("/business/overview");
  const needs = useApi("/requests?needsAction=1&pageSize=100");
  const needIds = new Set<string>((needs.data?.items ?? []).map((x: any) => x.id));
  const qs = new URLSearchParams({ page: String(page), pageSize: String(PAGE_SIZE), ...orderFilterParams(filter) });
  if (q) qs.set("q", q);
  if (city) qs.set("city", city);
  if (from) qs.set("from", riyadhLocalToIso(`${from}T00:00`));
  if (to) qs.set("to", riyadhLocalToIso(`${to}T23:59`));
  const { data, error, mutate, isValidating } = useApi(`/requests?${qs}`, { keepPreviousData: true });
  const byStatus: Record<string, number> | undefined = ov.data?.requests;
  const needN: number | undefined = needs.data ? needs.data.total ?? needIds.size : undefined;
  const count = (k: string) => orderFilterCount(k, byStatus, needN);
  const narrowed = !!(q || city || from || to);
  const clear = () => { setQInput(""); setQ(""); setCity(""); setFrom(""); setTo(""); setPageStr("1"); };

  const label = (k: string) => (k === "" ? t("common.all") : k === "action" ? t("ubz.needs_action") : k === "active" ? t("rdz.f_active") : t(`status.${k}`));
  const options = visibleOrderFilters(filter, count).map((k) => ({ key: k, label: label(k), count: count(k) }));
  const total = byStatus ? Object.values(byStatus).reduce((a, b) => a + b, 0) : undefined;

  return (
    <>
      <PageHeader title={t("nav.requests")} subtitle={total ? t("ubz.requests_count", { n: fmtNum(total, locale) }) : t("rdz.orders_sub")}
        actions={<Link href="/business/requests/new" data-testid="orders-new"><Button><FilePlus2 className="size-4" aria-hidden />{t("nav.new_request")}</Button></Link>} />
      <StatGrid cols={4} className="mb-5">
        <Stat label={t("rdz.f_active")} value={fmtNum(count("active"), locale)} hint={t("rdz.k_active_hint")} icon={<Clock className="size-5" />} tone="cyan" href="/business/requests?status=active" loading={!byStatus} />
        <Stat label={t("ubz.needs_action")} value={fmtNum(needN, locale)} hint={t("rdz.k_action_hint")} icon={<BellRing className="size-5" />} tone={(needN ?? 0) > 0 ? "gold" : "muted"} href="/business/requests?status=action" loading={needN === undefined} />
        <Stat label={t("bz.drafts")} value={fmtNum(count("draft"), locale)} hint={t("rdz.k_drafts_hint")} icon={<FileEdit className="size-5" />} tone="muted" href="/business/requests?status=draft" loading={!byStatus} />
        <Stat label={t("biz.completed")} value={fmtNum(count("completed"), locale)} hint={ov.data ? t("rdz.k_spent_hint", { amount: fmtMoney(ov.data.totalSpentCents, locale) }) : undefined} icon={<CheckCircle2 className="size-5" />} href="/business/requests?status=completed" loading={!byStatus} />
      </StatGrid>

      <Toolbar>
        <SearchBox value={qInput} onChange={setQInput} placeholder={t("req.search_ref")} label={t("req.search_ref")} />
        <Segmented label={t("common.status")} options={options} value={filter} onChange={setFilter} />
        <Select aria-label={t("wizard.pickup_city")} placeholder={t("bz.all_cities")} options={(cat?.cities ?? []).map((c: any) => ({ value: c.key, label: c[locale] }))} value={city} onChange={(e) => { setCity(e.target.value); setPageStr("1"); }} className="w-44" />
        <label className="flex items-center gap-2 text-xs text-muted">{t("bz.date_from")}<Input aria-label={t("bz.date_from")} type="date" ltr value={from} max={to || undefined} onChange={(e) => { setFrom(e.target.value); setPageStr("1"); }} className="w-40 text-ink" /></label>
        <label className="flex items-center gap-2 text-xs text-muted">{t("bz.date_to")}<Input aria-label={t("bz.date_to")} type="date" ltr value={to} min={from || undefined} onChange={(e) => { setTo(e.target.value); setPageStr("1"); }} className="w-40 text-ink" /></label>
        {(narrowed || qInput) && <Button variant="ghost" onClick={clear}>{t("bz.clear_filters")}</Button>}
      </Toolbar>

      {error ? <ErrorState error={error} retry={() => mutate()} /> : !data ? <PageLoading /> : data.items.length === 0 ? (
        narrowed || filter
          ? <EmptyState title={t("common.no_results")} hint={t("ubz.no_results_hint")} action={<Button variant="secondary" onClick={() => { clear(); setFilter(""); }}>{t("bz.clear_filters")}</Button>} />
          : <EmptyState title={t("biz.no_requests")} hint={t("biz.no_requests_hint")} action={<Link href="/business/requests/new"><Button><FilePlus2 className="size-4" aria-hidden />{t("nav.new_request")}</Button></Link>} />
      ) : (
        <div className={cn("transition-opacity", isValidating && "opacity-70")} aria-busy={isValidating}>
          <Table stack label={t("nav.requests")} head={[t("req.ref"), t("req.route"), t("req.starts"), t("req.slots"), { label: t("req.total"), align: "end" }, t("common.status"), { label: t("common.open"), srOnly: true }]}>
            {data.items.map((x: any) => (
              <tr key={x.id} data-testid="order-row" className={cn("cursor-pointer", needIds.has(x.id) && "bg-gold/5")} onClick={(e) => { if (!(e.target as HTMLElement).closest("a,button")) router.push(`/business/requests/${x.id}`); }}>
                <Td label={t("req.ref")}><CellPair href={`/business/requests/${x.id}`} title={<span className="ltr-num font-semibold">{x.ref}</span>} sub={<>{x.title ? `${x.title} · ` : ""}{t(`svc.${x.service}`)}{x.vehicleType ? ` · ${t(`vehicle.${x.vehicleType}`)}` : ""}</>} /></Td>
                <Td label={t("req.route")} className="text-muted">{t(`city.${x.pickupCity}`)}<ArrowRight className="mx-1 inline size-3.5 rtl:rotate-180" aria-hidden />{t(`city.${x.deliveryCity}`)}</Td>
                <Td label={t("req.starts")} className="whitespace-nowrap text-muted">{fmtDateTime(x.startsAt, locale)}</Td>
                <Td label={t("req.slots")}><span className="ltr-num tabular-nums">{x.slotsFilled}/{x.quantity}</span>{parcelsOf(x) != null && <span className="block text-xs text-muted">{t("bs.parcels_n", { n: fmtNum(parcelsOf(x), locale) })}</span>}</Td>
                <Td label={t("req.total")} num>{fmtMoney(x.totalCents, locale)}</Td>
                <Td label={t("common.status")}><span className="flex flex-wrap items-center gap-1.5"><StatusBadge status={x.status} />{needIds.has(x.id) && <Badge tone="warn">{t("ubz.action_badge")}</Badge>}</span></Td>
                <Td align="end" className="w-10"><Link href={`/business/requests/${x.id}`} aria-label={`${t("common.open")} ${x.ref}`} className="inline-flex size-8 items-center justify-center rounded-lg text-muted hover:bg-card hover:text-ink"><ChevronRight className="size-4 rtl:rotate-180" aria-hidden /></Link></Td>
              </tr>
            ))}
          </Table>
          <Pagination page={data.page ?? page} total={data.total} pageSize={data.pageSize ?? PAGE_SIZE} onPage={(p) => setPageStr(String(p))} />
        </div>
      )}
    </>
  );
}
