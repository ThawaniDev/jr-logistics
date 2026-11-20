"use client";
import { useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { PackageSearch } from "lucide-react";
import { CellPair, EmptyState, ErrorState, PageHeader, Pagination, SearchBox, Segmented, Table, Td, Toolbar } from "@/components/ui";
import { useApi } from "@/components/ui/data";
import { fmtDateTime } from "@/lib/format";
import { useI18n } from "@/i18n/provider";
import { qs, useDebounced } from "./admin-common";
import { ShipStatusBadge } from "./admin-shipments";

const STATUSES = ["pending", "loaded", "delivered", "failed", "returned", "missing", "cancelled"];
const SIZE = 25;

/** Find a parcel anywhere on the platform by its code, the warehouse's order reference, the recipient's phone (or its last four digits) or name; every result opens the parcel view. */
export function ParcelSearch() {
  const { t, locale } = useI18n(); const sp = useSearchParams();
  const [q, setQ] = useState(sp.get("q") ?? ""); const dq = useDebounced(q.trim());
  const [status, setStatus] = useState(""); const [page, setPage] = useState(1);
  const ready = dq.length >= 3;
  const { data, error, mutate } = useApi(ready ? `/admin/shipments/search${qs({ q: dq, status, page, pageSize: SIZE })}` : null, { keepPreviousData: true, shouldRetryOnError: false });
  return (
    <>
      <PageHeader title={t("dv1.search_title")} subtitle={t("dv1.search_sub")} breadcrumbs={[{ label: t("nav.requests"), href: "/admin/requests" }, { label: t("dv1.search_title") }]} />
      <Toolbar end={data && <span className="text-sm text-muted" data-testid="dv1-search-total">{t("uxa.total_n", { n: data.total })}</span>}>
        <SearchBox value={q} onChange={(v) => { setQ(v); setPage(1); }} label={t("common.search")} placeholder={t("dv1.search_ph")} testId="dv1-search-box" />
        <Segmented label={t("common.status")} value={status} onChange={(k) => { setStatus(k); setPage(1); }} options={[{ key: "", label: t("common.all") }, ...STATUSES.map((s) => ({ key: s, label: t(`shipstatus.${s}`) }))]} />
      </Toolbar>
      {!ready ? <EmptyState icon={<PackageSearch className="size-9" aria-hidden />} title={t("dv1.search_start")} hint={t("dv1.search_min")} />
        : error && !data ? <ErrorState error={error} retry={() => mutate()} />
        : !data ? <p className="text-sm text-muted">{t("uxa.loading")}</p>
        : data.items.length === 0 ? <EmptyState icon={<PackageSearch className="size-9" aria-hidden />} title={t("shipadm.empty")} hint={t("dv1.search_none_hint")} />
        : <>
          <Table stack label={t("dv1.search_title")} head={[t("shipadm.col_parcel"), t("shipadm.col_recipient"), t("common.status"), t("dv1.fact_order"), t("role.business"), t("shipadm.col_driver"), t("dv1.fact_created")]}>
            {data.items.map((s: any) => (
              <tr key={s.id} data-testid="dv1-search-row">
                <Td label={t("shipadm.col_parcel")}><CellPair href={`/admin/parcels/${s.id}`} title={<span className="ltr-num">{s.code}</span>} sub={s.externalRef ? <span className="ltr-num">{s.externalRef}</span> : undefined} /></Td>
                <Td label={t("shipadm.col_recipient")}><CellPair title={s.recipientName} sub={<span className="ltr-num">{s.recipientPhone ?? "—"}</span>} /></Td>
                <Td label={t("common.status")}><ShipStatusBadge status={s.status} /></Td>
                <Td label={t("dv1.fact_order")}><Link href={`/admin/requests/${s.requestId}`} className="ltr-num text-accent hover:underline">{s.requestRef}</Link></Td>
                <Td label={t("role.business")}>{s.businessName}</Td>
                <Td label={t("shipadm.col_driver")}>{s.driverName ?? "—"}</Td>
                <Td label={t("dv1.fact_created")} className="whitespace-nowrap text-muted">{fmtDateTime(s.createdAt, locale)}</Td>
              </tr>
            ))}
          </Table>
          <Pagination page={page} total={data.total} pageSize={SIZE} onPage={setPage} />
        </>}
    </>
  );
}
