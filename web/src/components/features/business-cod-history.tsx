"use client";
import Link from "next/link";
import { Badge, Pagination, Table, Td } from "@/components/ui";
import { fmtDateTime, fmtMoney } from "@/lib/format";
import { useI18n } from "@/i18n/provider";
import type { CodWarehouse } from "./business-cod";
import { OfficeCell, WarehouseCell } from "./business-cod-parts";

export interface Remittance { id: string; ref: string; orderRef?: string | null; requestId?: string | null; driverName: string; amountCents: number; note: string | null; receivedByName: string | null; receivedByRole: string | null; createdAt: string; warehouse?: CodWarehouse; officeId?: string | null; officeName?: string | null }
export interface RemittancePage { items: Remittance[]; page: number; pageSize: number; total: number }

/** The cash history: every hand-over, with the order's warehouse and the office the driver belonged to at the time of the job (J6). */
export function HistoryTable({ data, page, onPage }: { data: RemittancePage; page: number; onPage: (p: number) => void }) {
  const { t, locale } = useI18n();
  return (
    <div data-testid="cod-history">
      <Table bare stack label={t("fob.cash_history")} head={[t("common.date"), t("req.ref"), t("cdc.col_warehouse"), t("cdc.col_office"), t("fob.rcv_driver"), { label: t("fob.cash_amount"), align: "end" }, t("fob.cash_note"), t("fob.cash_by")]}>
        {data.items.map((r) => (
          <tr key={r.id} data-testid="cod-history-row">
            <Td label={t("common.date")} className="whitespace-nowrap text-muted">{fmtDateTime(r.createdAt, locale)}</Td>
            <Td label={t("req.ref")}>{r.requestId ? <Link href={`/business/requests/${r.requestId}/money`} className="ltr-num font-semibold text-accent hover:underline">{r.orderRef ?? r.ref}</Link> : <span className="ltr-num font-semibold">{r.orderRef ?? r.ref}</span>}</Td>
            <Td label={t("cdc.col_warehouse")}><WarehouseCell w={r.warehouse} /></Td>
            <Td label={t("cdc.col_office")}><OfficeCell officeId={r.officeId} officeName={r.officeName} /></Td>
            <Td label={t("fob.rcv_driver")}>{r.driverName}</Td>
            <Td label={t("fob.cash_amount")} num className="font-semibold text-accent">{fmtMoney(r.amountCents, locale)}</Td>
            <Td label={t("fob.cash_note")} className="max-w-[260px] text-muted">{r.note || "—"}</Td>
            <Td label={t("fob.cash_by")}>{r.receivedByName ?? "—"}{r.receivedByRole && <Badge className="ms-2">{t(`role.${r.receivedByRole}`)}</Badge>}</Td>
          </tr>
        ))}
      </Table>
      <div className="px-5 pb-4"><Pagination page={data.page ?? page} total={data.total} pageSize={data.pageSize ?? 25} onPage={onPage} /></div>
    </div>
  );
}
