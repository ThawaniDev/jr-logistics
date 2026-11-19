"use client";
import { useState } from "react";
import Link from "next/link";
import { FileText } from "lucide-react";
import { EmptyState, ErrorState, PageLoading, Pagination, Section, Table, Td } from "@/components/ui";
import { useApi } from "@/components/ui/data";
import { fmtDate, fmtMoney, fmtNum } from "@/lib/format";
import { useI18n } from "@/i18n/provider";

interface Invoice { id: string; number: string; requestId: string; requestRef: string; subtotalCents: number; vatCents: number; vatPct: number; totalCents: number; createdAt: string }
interface InvoicePage { page: number; pageSize: number; total: number; totals: { totalCents: number; vatCents: number }; items: Invoice[] }

/** The company's tax invoices (one per settled request) — its own section of the wallet page. */
export function InvoicesSection() {
  const { t, locale } = useI18n();
  const [page, setPage] = useState(1);
  const { data, error, mutate } = useApi<InvoicePage>(`/business/invoices?page=${page}`, { keepPreviousData: true });
  return (
    <Section id="invoices" title={t("req.invoices")} flush description={data ? t("rdz.inv_summary", { n: fmtNum(data.total, locale), total: fmtMoney(data.totals.totalCents, locale), vat: fmtMoney(data.totals.vatCents, locale) }) : undefined}>
      {error ? <div className="p-5"><ErrorState error={error} retry={() => mutate()} /></div> : !data ? <div className="p-5"><PageLoading /></div> : data.items.length === 0 ? (
        <div className="p-5"><EmptyState icon={<FileText className="size-9" aria-hidden />} title={t("rdz.no_invoices")} hint={t("rdz.no_invoices_hint")} /></div>
      ) : (
        <div data-testid="wallet-invoices">
          <Table bare stack label={t("req.invoices")} head={[t("rdz.inv_number"), t("common.date"), t("req.ref"), { label: t("rdz.inv_subtotal"), align: "end" }, { label: t("rdz.inv_vat"), align: "end" }, { label: t("req.total"), align: "end" }]}>
            {data.items.map((i) => (
              <tr key={i.id} data-testid="wallet-invoice">
                <Td label={t("rdz.inv_number")}><span className="ltr-num font-semibold">{i.number}</span></Td>
                <Td label={t("common.date")} className="whitespace-nowrap text-muted">{fmtDate(i.createdAt, locale)}</Td>
                <Td label={t("req.ref")}><Link href={`/business/requests/${i.requestId}/money`} className="ltr-num font-medium text-accent hover:underline">{i.requestRef}</Link></Td>
                <Td label={t("rdz.inv_subtotal")} num>{fmtMoney(i.subtotalCents, locale)}</Td>
                <Td label={t("rdz.inv_vat")} num className="text-muted">{fmtMoney(i.vatCents, locale)} <span className="text-xs">({i.vatPct}%)</span></Td>
                <Td label={t("req.total")} num className="font-semibold">{fmtMoney(i.totalCents, locale)}</Td>
              </tr>
            ))}
          </Table>
          <div className="px-5 pb-4"><Pagination page={data.page} total={data.total} pageSize={data.pageSize} onPage={setPage} /></div>
        </div>
      )}
    </Section>
  );
}
