"use client";
import { useState } from "react";
import Link from "next/link";
import { Download, FileText, Percent, Receipt, Sigma } from "lucide-react";
import { Button, CellPair, PageHeader, Pagination, Stat, StatGrid, Table, Td, Toolbar } from "@/components/ui";
import { useApi } from "@/components/ui/data";
import { fmtDateTime } from "@/lib/format";
import { useI18n } from "@/i18n/provider";
import { useUser } from "@/components/layout/auth-context";
import { dayEndIso, dayStartIso, downloadCsv, hasAny, qs, sar } from "./admin-common";
import { AccountFilter, DateRangeFilter, ListBody, Money, NoAccess, NoRows, PAGE, partyHref, useUrlFilters } from "./admin-finance-parts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const FILTERS = ["businessId", "from", "to"] as const;

export function InvoicesView() {
  const { t, locale } = useI18n(); const me = useUser();
  const ok = hasAny(me, "finance.view");
  const [f, setF] = useUrlFilters(FILTERS);
  const businessId = UUID.test(f.businessId) ? f.businessId : "";
  const [page, setPage] = useState(1);
  const filter = { businessId, from: dayStartIso(f.from), to: dayEndIso(f.to) };
  const list = useApi(ok ? `/admin/finance/invoices${qs({ ...filter, page, pageSize: PAGE })}` : null, { keepPreviousData: true });
  const totals = useApi(ok ? `/admin/finance/invoices/totals${qs(filter)}` : null, { keepPreviousData: true, shouldRetryOnError: false });
  if (!ok) return <NoAccess title={t("nav.fin_invoices")} />;
  const s = totals.data; const filtered = !!(businessId || f.from || f.to);
  const go = (patch: Partial<Record<(typeof FILTERS)[number], string>>) => { setPage(1); setF(patch); };
  const reset = () => go({ businessId: "", from: "", to: "" });
  const items: any[] = list.data?.items ?? [];
  const csv = () => downloadCsv("invoices.csv", [t("adm.invoice_no"), t("req.ref"), t("role.business"), t("adm.subtotal"), t("adm.vat"), t("req.total"), t("common.date")],
    items.map((i) => [i.number, i.ref, i.business, sar(i.subtotalCents), sar(i.vatCents), sar(i.totalCents), i.createdAt]));
  return (
    <>
      <PageHeader title={t("nav.fin_invoices")} subtitle={t("rdf.inv_sub")} icon={<FileText className="size-5" />} />
      <div className="mb-5"><StatGrid cols={4}>
        <Stat label={t("nav.fin_invoices")} value={s && <span className="ltr-num">{s.invoices}</span>} hint={t(filtered ? "rdf.in_view" : "rdf.all_time")} icon={<Receipt className="size-5" />} tone="cyan" loading={!s} />
        <Stat label={t("adm.subtotal")} value={s && <Money c={s.subtotalCents} />} hint={t("rdf.inv_subtotal_hint")} icon={<Sigma className="size-5" />} tone="muted" loading={!s} />
        <Stat label={t("adm.vat")} value={s && <Money c={s.vatCents} />} hint={t("rdf.inv_vat_hint")} icon={<Percent className="size-5" />} tone="gold" loading={!s} />
        <Stat label={t("req.total")} value={s && <Money c={s.totalCents} />} hint={t("rdf.inv_total_hint")} icon={<FileText className="size-5" />} tone="accent" loading={!s} />
      </StatGrid></div>
      <Toolbar end={<>
        {filtered && <Button variant="ghost" size="sm" onClick={reset} data-testid="fin-clear-filters">{t("uxa.clear_filters")}</Button>}
        {items.length > 0 && <Button variant="secondary" size="sm" onClick={csv} data-testid="fin-invoices-csv"><Download className="size-4" aria-hidden />{t("adm.csv_page")}</Button>}
      </>}>
        <AccountFilter role="business" value={businessId} onChange={(id) => go({ businessId: id })} placeholder={t("rdf.inv_business_ph")} clearLabel={t("common.clear")} testid="fin-invoices-business" />
        <DateRangeFilter from={f.from} to={f.to} onFrom={(v) => go({ from: v })} onTo={(v) => go({ to: v })} />
      </Toolbar>
      <ListBody error={list.error} loaded={!!list.data} isEmpty={items.length === 0} retry={() => list.mutate()}
        emptyState={<NoRows title={t("rdf.inv_empty")} hint={t("rdf.inv_empty_hint")} filtered={filtered} onReset={reset} icon={<FileText className="size-9" aria-hidden />} />}>
        <Table stack label={t("nav.fin_invoices")} head={[t("adm.invoice_no"), t("foa.cod_order"), t("role.business"), { label: t("adm.subtotal"), align: "end" }, { label: t("adm.vat"), align: "end" }, { label: t("req.total"), align: "end" }]}>
          {items.map((i) => (
            <tr key={i.id}>
              <Td label={t("adm.invoice_no")}><CellPair title={<span className="ltr-num">{i.number}</span>} sub={<span className="whitespace-nowrap">{fmtDateTime(i.createdAt, locale)}</span>} /></Td>
              <Td label={t("foa.cod_order")}><Link href={`/admin/requests/${i.requestId}`} className="ltr-num font-medium text-accent hover:underline">{i.ref}</Link></Td>
              <Td label={t("role.business")}><CellPair href={partyHref("business", i.businessId)} title={i.business} /></Td>
              <Td label={t("adm.subtotal")} num><Money c={i.subtotalCents} /></Td>
              <Td label={t("adm.vat")} num><Money c={i.vatCents} /><span className="ms-1 text-xs text-muted">{i.vatPct}%</span></Td>
              <Td label={t("req.total")} num className="font-semibold"><Money c={i.totalCents} /></Td>
            </tr>))}
        </Table>
        <Pagination page={page} total={list.data?.total ?? 0} pageSize={PAGE} onPage={setPage} />
      </ListBody>
    </>
  );
}
