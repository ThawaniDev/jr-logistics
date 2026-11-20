"use client";
import Link from "next/link";
import { CheckCircle2 } from "lucide-react";
import { fmtDate, fmtDateTime } from "@/lib/format";
import { useI18n } from "@/i18n/provider";
import { useCityNames } from "./admin-common";
import { InvoiceLines } from "./invoice-lines";
import { PrintStyles } from "./invoice-print";
import type { InvoiceView } from "./invoice-types";

function Party({ title, children, testId }: { title: string; children: React.ReactNode; testId: string }) {
  return <section data-testid={testId} className="min-w-0"><h3 className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted">{title}</h3><div className="space-y-0.5 text-sm">{children}</div></section>;
}
function Fact({ label, value, ltr }: { label: string; value: React.ReactNode; ltr?: boolean }) {
  return <p className="flex flex-wrap gap-x-2"><span className="text-muted">{label}</span><span className={ltr ? "ltr-num break-all font-medium" : "break-words font-medium"}>{value || "—"}</span></p>;
}

/**
 * The tax invoice itself, shared by the admin console and the company portal (same markup, so what the company prints is what staff see): seller and buyer,
 * number / date / order, the order in one line, the lines with subtotal / VAT / total, the paid stamp and the notes. On screen it follows the theme;
 * `invoice-print.tsx` turns it into white paper with black ink when printed. `orderHref` makes the order reference a link (screen only matters, print drops the underline).
 */
export function InvoiceSheet({ d, orderHref }: { d: InvoiceView; orderHref?: string }) {
  const { t, locale } = useI18n(); const city = useCityNames().name;
  const { invoice: inv, seller, buyer, order } = d;
  const route = order.pickupCity && order.deliveryCity ? t("inv.route", { from: city(order.pickupCity), to: city(order.deliveryCity) }) : null;
  return (
    <article className="inv-sheet space-y-6 rounded-card border border-line bg-card p-5 sm:p-8" aria-label={t("inv.sheet_label", { number: inv.number })} data-testid="inv-sheet">
      <PrintStyles />
      <header className="flex flex-wrap items-start justify-between gap-4 border-b border-line pb-5">
        <div className="min-w-0">
          <p className="text-lg font-extrabold tracking-tight">{seller.name}</p>
          <h2 className="mt-1 text-2xl font-bold">{t("inv.tax_invoice")}</h2>
        </div>
        <div className="flex flex-wrap items-start gap-4">
          <dl className="grid grid-cols-[auto_auto] gap-x-4 gap-y-1 text-sm">
            <dt className="text-muted">{t("adm.invoice_no")}</dt><dd className="ltr-num font-semibold" data-testid="inv-number">{inv.number}</dd>
            <dt className="text-muted">{t("common.date")}</dt><dd className="font-medium" data-testid="inv-date">{fmtDate(inv.createdAt, locale)}</dd>
            <dt className="text-muted">{t("inv.order_ref")}</dt>
            <dd className="font-medium">{orderHref ? <Link href={orderHref} className="ltr-num text-accent hover:underline" data-testid="inv-order-link">{order.ref}</Link> : <span className="ltr-num">{order.ref}</span>}</dd>
          </dl>
          {d.paidAt && (
            <div className="flex -rotate-3 flex-col items-center rounded-xl border-2 border-accent px-3 py-1.5 text-accent" data-testid="inv-paid">
              <span className="flex items-center gap-1 text-sm font-extrabold uppercase tracking-wide"><CheckCircle2 className="size-4" aria-hidden />{t("inv.paid")}</span>
              <span className="text-[11px] font-medium">{fmtDate(d.paidAt, locale)}</span>
            </div>
          )}
        </div>
      </header>
      <div className="grid gap-6 sm:grid-cols-2">
        <Party title={t("inv.seller")} testId="inv-seller">
          <p className="text-base font-semibold">{seller.name}</p>
          <Fact label={t("inv.vat_rate")} value={`${seller.vatPct}%`} ltr />
        </Party>
        <Party title={t("inv.bill_to")} testId="inv-buyer">
          <p className="text-base font-semibold">{buyer.name}</p>
          {buyer.contact && buyer.contact !== buyer.name && <Fact label={t("inv.contact")} value={buyer.contact} />}
          <Fact label={t("inv.city")} value={buyer.city ? city(buyer.city) : null} />
          <Fact label={t("inv.address")} value={buyer.address} />
          <Fact label={t("inv.cr_number")} value={buyer.crNumber} ltr />
          <Fact label={t("inv.vat_number")} value={buyer.taxNumber} ltr />
        </Party>
      </div>
      <dl className="grid gap-x-6 gap-y-3 rounded-xl border border-line bg-bg2/40 p-4 text-sm sm:grid-cols-2 lg:grid-cols-4" data-testid="inv-order">
        <div><dt className="text-xs text-muted">{t("req.service")}</dt><dd className="font-medium">{t(`svc.${order.service}`)}</dd></div>
        <div><dt className="text-xs text-muted">{t("req.route")}</dt><dd className="font-medium">{route ?? "—"}</dd></div>
        <div><dt className="text-xs text-muted">{t("inv.scheduled")}</dt><dd className="font-medium">{fmtDateTime(order.startsAt, locale)}</dd></div>
        <div><dt className="text-xs text-muted">{t("common.status")}</dt><dd className="font-medium">{t(`status.${order.status}`)}</dd></div>
      </dl>
      <InvoiceLines d={d} />
      <ul className="space-y-1 border-t border-line pt-4 text-xs text-muted" data-testid="inv-notes">
        <li>{t("inv.note_vat", { pct: inv.vatPct })}</li>
        <li>{t("inv.note_wallet")}</li>
        <li>{t("inv.note_generated")}</li>
      </ul>
    </article>
  );
}
