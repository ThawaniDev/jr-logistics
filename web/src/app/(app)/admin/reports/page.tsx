"use client";
import { useState } from "react";
import { Download } from "lucide-react";
import { Button, EmptyState, ErrorState, Input, PageHeader, PageLoading, Select, Table, Td } from "@/components/ui";
import { useApi } from "@/components/ui/data";
import { useI18n } from "@/i18n/provider";
import { useUser, hasPerm } from "@/components/layout/auth-context";

const TYPES = ["requests", "settlements", "cancellations", "sla", "complaints", "custody", "withdrawals", "drivers"];
export default function Reports() {
  const { t } = useI18n(); const me = useUser();
  const [type, setType] = useState("requests"); const [from, setFrom] = useState(""); const [to, setTo] = useState("");
  const qs = `${from ? `&from=${new Date(from).toISOString()}` : ""}${to ? `&to=${new Date(to + "T23:59:59").toISOString()}` : ""}`;
  const { data, error, mutate } = useApi(`/admin/reports/${type}?pageSize=200${qs}`);
  return (
    <>
      <PageHeader title={t("nav.reports")} actions={hasPerm(me, "reports.export") && <a href={`/api/v1/admin/reports/${type}?format=csv&pageSize=1000${qs}`}><Button variant="secondary"><Download className="size-4" />{t("reports.export")}</Button></a>} />
      <div className="mb-4 flex flex-wrap gap-3"><div className="w-52"><Select aria-label={t("reports.type")} options={TYPES.map((x) => ({ value: x, label: t(`report.${x}`) }))} value={type} onChange={(e) => setType(e.target.value)} /></div><div className="w-44"><Input aria-label={t("reports.from")} type="date" ltr value={from} onChange={(e) => setFrom(e.target.value)} /></div><div className="w-44"><Input aria-label={t("reports.to")} type="date" ltr value={to} onChange={(e) => setTo(e.target.value)} /></div></div>
      {error ? <ErrorState error={error} retry={() => mutate()} /> : !data ? <PageLoading /> : data.rows.length === 0 ? <EmptyState title={t("common.no_results")} /> : (
        <Table head={data.columns.map((c: string) => t(`col.${c}`))}>
          {data.rows.map((r: any, i: number) => <tr key={i}>{data.columns.map((c: string) => <Td key={c} className="ltr-num whitespace-nowrap text-xs">{String(r[c] ?? "—")}</Td>)}</tr>)}
        </Table>
      )}
    </>
  );
}
