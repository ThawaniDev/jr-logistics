"use client";
import Link from "next/link";
import { FileSearch, Package, Receipt } from "lucide-react";
import { Badge, Breadcrumbs, Button, EmptyState, ErrorState, PageHeader, PageLoading } from "@/components/ui";
import { useApi } from "@/components/ui/data";
import { ApiError } from "@/lib/api";
import { fmtDate } from "@/lib/format";
import { useI18n } from "@/i18n/provider";
import { CopyNumberButton, PrintButton } from "./invoice-actions";
import { InvoiceSheet } from "./invoice-sheet";
import { isolate, type InvoiceView } from "./invoice-types";

const WALLET = "/business/wallet", INVOICES = "/business/wallet#invoices";

/** `/business/wallet/invoices/[id]` — one of the company's own tax invoices: the same sheet staff see, ready to print or save as PDF. Nothing about provider cost or margin is ever sent here. */
export function BusinessInvoiceDetail({ id }: { id: string }) {
  const { t, locale } = useI18n();
  const { data, error, mutate } = useApi<InvoiceView>(`/business/invoices/${id}`, { shouldRetryOnError: false });
  const crumbs = [{ label: t("nav.wallet"), href: WALLET }, { label: t("req.invoices"), href: INVOICES }];
  if (error) {
    if (!(error instanceof ApiError && error.code === "NOT_FOUND")) return <><Breadcrumbs items={crumbs} /><ErrorState error={error} retry={() => mutate()} /></>;
    return (
      <>
        <PageHeader title={t("inv.not_found")} breadcrumbs={[...crumbs, { label: t("inv.not_found") }]} />
        <div data-testid="inv-not-found"><EmptyState icon={<FileSearch className="size-9" aria-hidden />} title={t("inv.not_found")} hint={t("inv.not_found_hint_biz")} action={<Link href={INVOICES}><Button variant="secondary">{t("inv.back_to_wallet")}</Button></Link>} /></div>
      </>
    );
  }
  if (!data) return <PageLoading />;
  const { invoice: inv, order } = data;
  return (
    <>
      <PageHeader title={inv.number} icon={<Receipt className="size-5" />} breadcrumbs={[...crumbs, { label: inv.number }]}
        subtitle={t("inv.page_sub_biz", { date: isolate(fmtDate(inv.createdAt, locale)) })} badges={data.paidAt ? <Badge tone="success">{t("inv.paid")}</Badge> : undefined}
        actions={<><PrintButton /><CopyNumberButton number={inv.number} /></>} />
      <nav aria-label={t("inv.related")} className="mb-5"><Link href={`/business/requests/${order.id}`} className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-sm font-medium text-accent hover:bg-accent/10 hover:underline" data-testid="inv-open-order"><Package className="size-4" aria-hidden />{t("inv.open_order")}<span className="ltr-num text-muted">{order.ref}</span></Link></nav>
      <div className="mx-auto max-w-4xl"><InvoiceSheet d={data} orderHref={`/business/requests/${order.id}`} /></div>
    </>
  );
}
