"use client";
import { useState } from "react";
import Link from "next/link";
import { FilePlus2 } from "lucide-react";
import { Button, EmptyState, ErrorState, PageHeader, PageLoading, Pagination, StatusBadge, Table, Tabs, Td } from "@/components/ui";
import { useApi } from "@/components/ui/data";
import { fmtDateTime, fmtMoney } from "@/lib/format";
import { useI18n } from "@/i18n/provider";

const TABS = ["", "draft", "published", "filling", "assigned", "in_progress", "completed", "cancelled"];
export default function RequestsPage() {
  const { t, locale } = useI18n(); const [tab, setTab] = useState(""); const [page, setPage] = useState(1);
  const { data, error, mutate } = useApi(`/requests?page=${page}&pageSize=15${tab ? `&status=${tab}` : ""}`);
  return (
    <>
      <PageHeader title={t("nav.requests")} actions={<Link href="/business/requests/new"><Button><FilePlus2 className="size-4" />{t("nav.new_request")}</Button></Link>} />
      <Tabs value={tab} onChange={(k) => { setTab(k); setPage(1); }} tabs={TABS.map((k) => ({ key: k, label: k ? t(`status.${k}`) : t("common.all") }))} />
      {error ? <ErrorState error={error} retry={() => mutate()} /> : !data ? <PageLoading /> : data.items.length === 0 ? <EmptyState title={t("biz.no_requests")} hint={t("biz.no_requests_hint")} /> : (
        <>
          <Table head={[t("req.ref"), t("req.service"), t("req.route"), t("req.starts"), t("req.slots"), t("req.total"), t("common.status")]}>
            {data.items.map((x: any) => (
              <tr key={x.id} className="hover:bg-bg2/60">
                <Td><Link href={`/business/requests/${x.id}`} className="ltr-num font-semibold text-accent hover:underline">{x.ref}</Link></Td>
                <Td>{t(`svc.${x.service}`)}{x.vehicleType && <span className="block text-xs text-muted">{t(`vehicle.${x.vehicleType}`)}</span>}</Td>
                <Td className="text-muted">{t(`city.${x.pickupCity}`)} → {t(`city.${x.deliveryCity}`)}</Td><Td className="text-muted">{fmtDateTime(x.startsAt, locale)}</Td>
                <Td className="tabular-nums">{x.slotsFilled}/{x.quantity}</Td><Td className="ltr-num tabular-nums">{fmtMoney(x.totalCents, locale)}</Td><Td><StatusBadge status={x.status} /></Td>
              </tr>
            ))}
          </Table>
          <Pagination page={page} total={data.total} pageSize={15} onPage={setPage} />
        </>
      )}
    </>
  );
}
