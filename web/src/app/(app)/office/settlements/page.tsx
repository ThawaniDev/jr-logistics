"use client";
import { useState } from "react";
import { Coins } from "lucide-react";
import { EmptyState, ErrorState, PageHeader, PageLoading, Pagination, StatusBadge, Table, Td } from "@/components/ui";
import { useApi } from "@/components/ui/data";
import { fmtDateTime, fmtMoney } from "@/lib/format";
import { useI18n } from "@/i18n/provider";

export default function OfficeSettlements() {
  const { t, locale } = useI18n(); const [page, setPage] = useState(1);
  const { data, error, mutate } = useApi(`/office/settlements?page=${page}`);
  if (error) return <ErrorState error={error} retry={() => mutate()} />;
  if (!data) return <PageLoading />;
  return (
    <>
      <PageHeader title={t("nav.settlements")} subtitle={t("office.settle_sub")} />
      {data.items.length === 0 ? <EmptyState icon={<Coins className="size-9" />} title={t("office.no_settlements")} /> : <>
        <Table head={[t("common.date"), t("units.final"), t("common.amount"), t("common.status")]}>
          {data.items.map((s: any) => <tr key={s.id}><Td className="text-muted">{fmtDateTime(s.createdAt, locale)}</Td><Td className="tabular-nums">{s.finalUnits}</Td><Td className="ltr-num font-semibold tabular-nums">{fmtMoney(s.amountCents, locale)}</Td><Td><StatusBadge status={s.status} ns="settle" /></Td></tr>)}
        </Table><Pagination page={page} total={data.total} pageSize={25} onPage={setPage} /></>}
    </>
  );
}
