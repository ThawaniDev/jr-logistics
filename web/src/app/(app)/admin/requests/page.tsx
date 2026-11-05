"use client";
import { useState } from "react";
import Link from "next/link";
import { EmptyState, ErrorState, Input, PageHeader, PageLoading, Pagination, StatusBadge, Table, Tabs, Td } from "@/components/ui";
import { useApi } from "@/components/ui/data";
import { fmtDateTime, fmtMoney } from "@/lib/format";
import { useI18n } from "@/i18n/provider";

const TABS = ["", "published", "filling", "assigned", "in_progress", "completed", "cancelled", "expired"];
export default function AdminRequests() {
  const { t, locale } = useI18n(); const [tab, setTab] = useState(""); const [page, setPage] = useState(1); const [q, setQ] = useState("");
  const { data, error, mutate } = useApi(`/admin/requests?page=${page}&pageSize=20${tab ? `&status=${tab}` : ""}${q ? `&q=${encodeURIComponent(q)}` : ""}`);
  return (
    <>
      <PageHeader title={t("nav.requests")} actions={<div className="w-56"><Input aria-label={t("common.search")} placeholder={t("req.search_ref")} ltr value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} /></div>} />
      <Tabs value={tab} onChange={(k) => { setTab(k); setPage(1); }} tabs={TABS.map((k) => ({ key: k, label: k ? t(`status.${k}`) : t("common.all") }))} />
      {error ? <ErrorState error={error} retry={() => mutate()} /> : !data ? <PageLoading /> : data.items.length === 0 ? <EmptyState title={t("common.no_results")} /> : <>
        <Table head={[t("req.ref"), t("req.service"), t("req.route"), t("req.starts"), t("req.slots"), t("req.total"), t("common.status")]}>
          {data.items.map((x: any) => <tr key={x.id} className="hover:bg-bg2/60"><Td><Link href={`/admin/requests/${x.id}`} className="ltr-num font-semibold text-accent hover:underline">{x.ref}</Link></Td><Td>{t(`svc.${x.service}`)}</Td><Td className="text-muted">{t(`city.${x.pickupCity}`)} → {t(`city.${x.deliveryCity}`)}</Td><Td className="text-muted">{fmtDateTime(x.startsAt, locale)}</Td><Td className="tabular-nums">{x.slotsFilled}/{x.quantity}</Td><Td className="ltr-num tabular-nums">{fmtMoney(x.totalCents, locale)}</Td><Td><StatusBadge status={x.status} /></Td></tr>)}
        </Table><Pagination page={page} total={data.total} pageSize={20} onPage={setPage} /></>}
    </>
  );
}
