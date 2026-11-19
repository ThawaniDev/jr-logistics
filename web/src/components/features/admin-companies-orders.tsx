"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, ChevronRight, ListChecks } from "lucide-react";
import Link from "next/link";
import { CellPair, EmptyState, ErrorState, PageLoading, Pagination, SearchBox, Segmented, StatusBadge, Table, Td, Toolbar, Button } from "@/components/ui";
import { useApi, useUrlState } from "@/components/ui/data";
import { fmtDateTime, fmtMoney, fmtNum } from "@/lib/format";
import { useI18n } from "@/i18n/provider";
import { useDebounced, useTx, qs } from "./admin-common";
import { useCompany, usePageFor } from "./admin-companies-ctx";

const PAGE = 20;
const ORDER = ["draft", "published", "filling", "assigned", "confirmed", "in_progress", "completed", "cancelled", "expired"];

/** Orders tab: this company's requests (the staff request list scoped with `businessId`), filtered by state and reference. */
export function CompanyOrders() {
  const { t, locale } = useI18n(); const c = useCompany(); const tx = useTx(); const router = useRouter();
  const [status, setStatus] = useUrlState("status", "all");
  const [q, setQ] = useState(""); const dq = useDebounced(q.trim()); const [page, setPage] = usePageFor(`${dq}|${status}`);
  const ov = useApi(`/admin/companies/${c.id}/overview`, { shouldRetryOnError: false });
  const by: Record<string, number> = ov.data?.orders?.byStatus ?? {};
  const { data, error, mutate, isValidating } = useApi(`/admin/requests${qs({ businessId: c.id, status: status === "all" ? "" : status, q: dq, page, pageSize: PAGE })}`, { keepPreviousData: true });
  const total = ov.data?.orders?.total as number | undefined;
  const options = [{ key: "all", label: t("common.all"), count: total }, ...ORDER.filter((s) => (by[s] ?? 0) > 0 || s === status).map((s) => ({ key: s, label: t(`status.${s}`), count: by[s] ?? 0 }))];
  const clear = () => { setQ(""); setStatus("all"); };
  return (
    <>
      <Toolbar end={total != null && <span className="text-sm text-muted">{t("rdp.n_orders", { n: fmtNum(total, locale) })}</span>}>
        <SearchBox value={q} onChange={setQ} placeholder={t("req.search_ref")} label={t("req.search_ref")} />
        <Segmented label={t("common.status")} options={options} value={status} onChange={setStatus} />
      </Toolbar>
      {error ? <ErrorState error={error} retry={() => mutate()} /> : !data ? <PageLoading /> : data.items.length === 0 ? (
        status !== "all" || dq
          ? <EmptyState title={t("common.no_results")} hint={t("ubz.no_results_hint")} action={<Button variant="secondary" onClick={clear}>{t("uxa.clear_filters")}</Button>} />
          : <EmptyState title={t("biz.no_requests")} hint={t("rdp.no_orders_hint")} icon={<ListChecks className="size-9" aria-hidden />} />
      ) : (
        <div aria-busy={isValidating} className={isValidating ? "opacity-70 transition-opacity" : "transition-opacity"}>
          <Table stack label={t("rdp.tab_orders")} head={[t("req.ref"), t("req.route"), t("req.starts"), t("req.slots"), { label: t("req.total"), align: "end" }, t("common.status"), { label: t("common.open"), srOnly: true }]}>
            {data.items.map((x: any) => (
              <tr key={x.id} data-testid="companies-order-row" className="cursor-pointer" onClick={(e) => { if (!(e.target as HTMLElement).closest("a,button")) router.push(`/admin/requests/${x.id}`); }}>
                <Td label={t("req.ref")}><CellPair href={`/admin/requests/${x.id}`} title={<span className="ltr-num font-semibold">{x.ref}</span>} sub={<>{x.title ? `${x.title} · ` : ""}{tx(`svc.${x.service}`, x.service)}</>} /></Td>
                <Td label={t("req.route")} className="text-muted">{tx(`city.${x.pickupCity}`, x.pickupCity)}<ArrowRight className="mx-1 inline size-3.5 rtl:rotate-180" aria-hidden />{tx(`city.${x.deliveryCity}`, x.deliveryCity)}</Td>
                <Td label={t("req.starts")} className="whitespace-nowrap text-muted">{fmtDateTime(x.startsAt, locale)}</Td>
                <Td label={t("req.slots")}><span className="ltr-num tabular-nums">{x.slotsFilled}/{x.quantity}</span></Td>
                <Td label={t("req.total")} num>{fmtMoney(x.totalCents, locale)}</Td>
                <Td label={t("common.status")}><StatusBadge status={x.status} /></Td>
                <Td align="end" className="w-10 max-sm:hidden!"><Link href={`/admin/requests/${x.id}`} aria-label={`${t("common.open")} ${x.ref}`} className="inline-flex size-8 items-center justify-center rounded-lg text-muted hover:bg-card hover:text-ink"><ChevronRight className="size-4 rtl:rotate-180" aria-hidden /></Link></Td>
              </tr>))}
          </Table>
          <Pagination page={data.page ?? page} total={data.total} pageSize={data.pageSize ?? PAGE} onPage={setPage} />
        </div>)}
    </>
  );
}
