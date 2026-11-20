"use client";
import Link from "next/link";
import { Building2, ChevronLeft, ChevronRight, FileSearch, Package, Receipt } from "lucide-react";
import { Badge, Breadcrumbs, Button, EmptyState, ErrorState, PageHeader, PageLoading } from "@/components/ui";
import { useApi } from "@/components/ui/data";
import { ApiError } from "@/lib/api";
import { fmtDate } from "@/lib/format";
import { useI18n } from "@/i18n/provider";
import { useUser } from "@/components/layout/auth-context";
import { ActivityLog } from "./activity-log";
import { RawDataPanel } from "./activity-raw";
import { NotesPanel } from "./notes-panel";
import { hasAny } from "./admin-common";
import { NoAccess } from "./admin-finance-parts";
import { CopyNumberButton, PrintButton } from "./invoice-actions";
import { LedgerSection, MoneyBreakdown, SettlementCard, SiblingsSection, SnapshotSection, settlementListHref } from "./invoice-admin-panels";
import { InvoiceSheet } from "./invoice-sheet";
import { isolate, type AdminInvoiceView } from "./invoice-types";

const LIST = "/admin/finance/invoices";
const linkCls = "inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-sm font-medium text-accent hover:bg-accent/10 hover:underline";

/** Shown when the id in the URL is not an invoice. */
function NotAnInvoice() {
  const { t } = useI18n();
  return (
    <>
      <PageHeader title={t("inv.not_found")} breadcrumbs={[{ label: t("nav.finance"), href: "/admin/finance" }, { label: t("nav.fin_invoices"), href: LIST }, { label: t("inv.not_found") }]} />
      <div data-testid="inv-not-found"><EmptyState icon={<FileSearch className="size-9" aria-hidden />} title={t("inv.not_found")} hint={t("inv.not_found_hint")} action={<Link href={LIST}><Button variant="secondary">{t("inv.back_to_list")}</Button></Link>} /></div>
    </>
  );
}

/**
 * `/admin/finance/invoices/[id]` — the tax invoice as the company receives it (print-ready), then what only staff see: the money split between company, payee and platform,
 * the settlement and its ledger entries, the locked price, the company's neighbouring invoices and the settlement's activity log, notes and raw record.
 */
export function AdminInvoiceDetail({ id }: { id: string }) {
  const { t, locale } = useI18n(); const me = useUser();
  const ok = hasAny(me, "finance.view");
  const { data, error, mutate } = useApi<AdminInvoiceView>(ok ? `${LIST}/${id}` : null, { shouldRetryOnError: false });
  if (!ok) return <NoAccess title={t("nav.fin_invoices")} />;
  const crumbs = [{ label: t("nav.finance"), href: "/admin/finance" }, { label: t("nav.fin_invoices"), href: LIST }];
  if (error) return error instanceof ApiError && error.code === "NOT_FOUND" ? <NotAnInvoice /> : <><Breadcrumbs items={crumbs} /><ErrorState error={error} retry={() => mutate()} /></>;
  if (!data) return <PageLoading />;
  const { invoice: inv, buyer, order, admin: a } = data;
  const canOrder = hasAny(me, "requests.view"), canCompany = hasAny(me, "users.view", "verification.manage", "offices.view");
  return (
    <>
      <PageHeader title={inv.number} icon={<Receipt className="size-5" />} breadcrumbs={[...crumbs, { label: inv.number }]}
        subtitle={t("inv.page_sub", { company: isolate(buyer.name), date: isolate(fmtDate(inv.createdAt, locale)) })}
        badges={data.paidAt ? <Badge tone="success">{t("inv.paid")}</Badge> : undefined}
        actions={<><PrintButton /><CopyNumberButton number={inv.number} /></>} />
      <nav aria-label={t("inv.related")} className="mb-5 flex flex-wrap items-center gap-x-2 gap-y-1" data-testid="inv-related">
        {canOrder && <Link href={`/admin/requests/${order.id}`} className={linkCls} data-testid="inv-open-order"><Package className="size-4" aria-hidden />{t("inv.open_order")}<span className="ltr-num text-muted">{order.ref}</span></Link>}
        {canCompany && <Link href={`/admin/companies/${buyer.id}`} className={linkCls} data-testid="inv-open-company"><Building2 className="size-4" aria-hidden />{t("inv.open_company")}</Link>}
        {a.settlement && <Link href={settlementListHref(a.settlement.createdAt)} className={linkCls} data-testid="inv-open-settlement-top"><Receipt className="size-4" aria-hidden />{t("inv.open_settlement")}</Link>}
        <span className="ms-auto flex items-center gap-1">
          {a.prev ? <Link href={`${LIST}/${a.prev.id}`} className={linkCls} data-testid="inv-prev" title={t("inv.prev_hint")}><ChevronLeft className="size-4 rtl:rotate-180" aria-hidden /><span className="ltr-num">{a.prev.number}</span></Link> : null}
          {a.next ? <Link href={`${LIST}/${a.next.id}`} className={linkCls} data-testid="inv-next" title={t("inv.next_hint")}><span className="ltr-num">{a.next.number}</span><ChevronRight className="size-4 rtl:rotate-180" aria-hidden /></Link> : null}
        </span>
      </nav>
      <div className="mx-auto max-w-4xl"><InvoiceSheet d={data} orderHref={canOrder ? `/admin/requests/${order.id}` : undefined} /></div>
      <div className="mx-auto mt-6 max-w-4xl space-y-5" data-testid="inv-admin">
        <MoneyBreakdown d={data} />
        <SettlementCard d={data} />
        <LedgerSection d={data} />
        <SnapshotSection d={data} />
        <SiblingsSection d={data} />
        {data.settlementId && <><ActivityLog entity="settlement" id={data.settlementId} /><NotesPanel entity="settlement" id={data.settlementId} /></>}
        <RawDataPanel data={data} title={t("inv.raw_title")} testId="inv-raw" />
      </div>
    </>
  );
}
