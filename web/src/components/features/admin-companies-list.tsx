"use client";
import { useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { CheckCircle2, ChevronRight, Clock, Factory, MapPinOff, MapPin, PauseCircle } from "lucide-react";
import { Badge, Button, CellPair, EmptyState, ErrorState, PageHeader, PageLoading, Pagination, Segmented, SearchBox, Select, Stat, StatGrid, StatusBadge, Table, Td, Toolbar } from "@/components/ui";
import { useApi, useUrlState } from "@/components/ui/data";
import { fmtDate, fmtMoney, fmtNum } from "@/lib/format";
import { useI18n } from "@/i18n/provider";
import { hasPerm, useUser } from "@/components/layout/auth-context";
import { useDebounced, useTx } from "./admin-common";
import { usePageFor } from "./admin-companies-ctx";
import { COMPANY_STATES, companiesQuery, isCompanyState, pct } from "./admin-companies-lib";

const PAGE = 25;

/** `/admin/companies`: KPI row, search + verification filter (kept in the URL so tiles and notifications can deep-link) and the company table. */
export function CompaniesList() {
  const { t, locale } = useI18n(); const me = useUser(); const tx = useTx(); const router = useRouter(); const path = usePathname(); const sp = useSearchParams();
  const [rawState, setState] = useUrlState("state", "all"); const state = isCompanyState(rawState) ? rawState : "all";
  const [wh, setWh] = useUrlState("warehouse", "");
  const [q, setQ] = useState(sp.get("q") ?? ""); const dq = useDebounced(q.trim()); const [page, setPage] = usePageFor(`${dq}|${state}|${wh}`);
  const sum = useApi("/admin/companies/summary", { shouldRetryOnError: false });
  const { data, error, mutate, isValidating } = useApi(`/admin/companies${companiesQuery({ q: dq, state, warehouse: wh, page, pageSize: PAGE })}`, { keepPreviousData: true });
  const s = sum.data; const n = (v?: number | null) => fmtNum(v, locale); const load = !s && !sum.error;
  const seeOrders = hasPerm(me, "requests.view");
  const filtered = state !== "all" || !!wh || !!dq;
  // one navigation drops every filter in the URL (calling both setters in a row would let the second overwrite the first)
  const clear = () => { setQ(""); router.replace(path, { scroll: false }); };
  const counts: Record<string, number | undefined> = { all: s?.total, pending: s?.pending, verified: s?.verified, rejected: s?.rejected, info_requested: s?.infoRequested, suspended: s?.suspended };
  const options = COMPANY_STATES.map((k) => ({ key: k, label: k === "all" ? t("common.all") : t(`status.${k}`), count: counts[k] }));
  const base = "/admin/companies";
  return (
    <>
      <PageHeader title={t("nav.companies")} subtitle={t("rdp.companies_sub")} icon={<Factory className="size-5" />} />
      <StatGrid cols={5} className="mb-5">
        <Stat label={t("rdp.kpi_companies")} value={n(s?.total)} hint={seeOrders && s ? t("rdp.kpi_companies_hint", { n: n(s.companiesWithOpenOrders) }) : undefined} icon={<Factory className="size-5" />} href={base} loading={load} />
        <Stat label={t("status.verified")} value={n(s?.verified)} hint={s ? t("rdp.kpi_verified_hint", { pct: pct(s.verified, s.total) }) : undefined} icon={<CheckCircle2 className="size-5" />} href={`${base}?state=verified`} loading={load} />
        <Stat label={t("rdp.kpi_awaiting")} value={n(s?.pending)} hint={s ? t("rdp.kpi_awaiting_hint", { n: n(s.infoRequested) }) : undefined} tone={(s?.pending ?? 0) > 0 ? "gold" : "muted"} icon={<Clock className="size-5" />} href={`${base}?state=pending`} loading={load} />
        <Stat label={t("status.suspended")} value={n(s?.suspended)} hint={s ? t("rdp.kpi_suspended_hint", { n: n(s.accountSuspended) }) : undefined} tone={(s?.suspended ?? 0) > 0 ? "danger" : "muted"} icon={<PauseCircle className="size-5" />} href={`${base}?state=suspended`} loading={load} />
        <Stat label={t("foa.wh_loc_missing")} value={n(s?.noWarehouse)} hint={t("rdp.kpi_no_wh_hint")} tone={(s?.noWarehouse ?? 0) > 0 ? "gold" : "muted"} icon={<MapPinOff className="size-5" />} href={`${base}?warehouse=missing`} loading={load} />
      </StatGrid>

      <Toolbar end={data && <span className="text-sm text-muted" aria-live="polite">{t("rdp.n_companies", { n: n(data.total) })}</span>}>
        <SearchBox value={q} onChange={setQ} placeholder={t("rdp.search_companies")} label={t("rdp.search_companies")} />
        <Segmented label={t("verify.title")} options={options} value={state} onChange={setState} />
        <Select aria-label={t("foa.wh_location")} placeholder={t("rdp.wh_any")} value={wh} onChange={(e) => setWh(e.target.value)} className="w-56"
          options={[{ value: "missing", label: t("foa.wh_loc_missing") }, { value: "set", label: t("foa.wh_loc_set") }]} />
      </Toolbar>

      {error ? <ErrorState error={error} retry={() => mutate()} /> : !data ? <PageLoading /> : data.items.length === 0 ? (
        filtered
          ? <EmptyState title={t("common.no_results")} hint={t("ubz.no_results_hint")} action={<Button variant="secondary" onClick={clear}>{t("uxa.clear_filters")}</Button>} />
          : <EmptyState title={t("rdp.empty_none")} hint={t("rdp.empty_none_hint")} icon={<Factory className="size-9" aria-hidden />} />
      ) : (
        <div aria-busy={isValidating} className={isValidating ? "opacity-70 transition-opacity" : "transition-opacity"}>
          <Table stack label={t("nav.companies")} head={[t("rdp.col_company"), t("reg.city"), t("verify.title"), t("rdp.col_warehouse"), { label: t("rdp.col_open_orders"), align: "end" }, { label: t("rdp.col_wallet"), align: "end" }, t("rdp.col_joined"), { label: t("common.open"), srOnly: true }]}>
            {data.items.map((c: any) => (
              <tr key={c.id} data-testid="companies-row" className="cursor-pointer" onClick={(e) => { if (!(e.target as HTMLElement).closest("a,button")) router.push(`${base}/${c.id}`); }}>
                <Td label={t("rdp.col_company")} className="max-w-[17rem]"><CellPair href={`${base}/${c.id}`} title={c.name} sub={<>{c.contactName}{c.phone && <> · <span className="ltr-num">{c.phone}</span></>}</>} /></Td>
                <Td label={t("reg.city")} className="text-muted">{c.city ? tx(`city.${c.city}`, c.city) : "—"}</Td>
                <Td label={t("verify.title")}><span className="flex flex-wrap items-center gap-1.5"><StatusBadge status={c.verificationStatus} />{c.status === "suspended" && <Badge tone="danger">{t("rdp.account_suspended")}</Badge>}</span></Td>
                <Td label={t("rdp.col_warehouse")}><Badge tone={c.warehouseSet ? "success" : "warn"}><MapPin className="size-3" aria-hidden /><span data-testid={`foa-wh-badge-${c.id}`}>{c.warehouseSet ? t("foa.wh_loc_set") : t("foa.wh_loc_missing")}</span></Badge></Td>
                <Td label={t("rdp.col_open_orders")} num>{c.openOrders == null ? "—" : fmtNum(c.openOrders, locale)}</Td>
                <Td label={t("rdp.col_wallet")} num className={c.walletCents != null && c.walletCents < 0 ? "text-danger" : undefined}>{c.walletCents == null ? "—" : fmtMoney(c.walletCents, locale)}</Td>
                <Td label={t("rdp.col_joined")} className="whitespace-nowrap text-muted">{fmtDate(c.createdAt, locale)}</Td>
                <Td align="end" className="w-10 max-sm:hidden!"><Link href={`${base}/${c.id}`} aria-label={t("rdp.open_company", { name: c.name })} className="inline-flex size-8 items-center justify-center rounded-lg text-muted hover:bg-card hover:text-ink"><ChevronRight className="size-4 rtl:rotate-180" aria-hidden /></Link></Td>
              </tr>))}
          </Table>
          <Pagination page={data.page ?? page} total={data.total} pageSize={data.pageSize ?? PAGE} onPage={setPage} />
        </div>)}
    </>
  );
}
