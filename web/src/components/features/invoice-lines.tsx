"use client";
import { cn } from "@/lib/cn";
import { fmtMoney, fmtNum } from "@/lib/format";
import { useI18n } from "@/i18n/provider";
import type { InvoiceLine, ParcelCounts } from "@/server/invoice-detail";
import { isolateLtr, type InvoiceView } from "./invoice-types";

const GRID = "sm:grid-cols-[minmax(0,1fr)_5.5rem_8rem_9rem] sm:gap-x-4";
/** A line cell: on a phone it carries its own label (the column header row is hidden), from `sm` up it is a right-aligned table cell. */
function Cell({ label, children, className }: { label: string; children: React.ReactNode; className?: string }) {
  return <div role="cell" className={cn("flex items-baseline justify-between gap-3 sm:block sm:text-end", className)}><span className="text-xs text-muted sm:hidden">{label}</span><span className="ltr-num tabular-nums">{children}</span></div>;
}

/** "3 failed · 1 returned": the parcels that were not delivered, by what happened to them (only the non-zero ones). */
function notDelivered(p: ParcelCounts, t: (k: string, v?: Record<string, string | number>) => string) {
  return ([["failed", p.failed], ["returned", p.returned], ["missing", p.missing]] as const).filter(([, n]) => n > 0).map(([k, n]) => t(`inv.p_${k}`, { n })).join(" · ");
}

/**
 * The lines table and the totals of the sheet. Line amounts include VAT (every price on the platform does) and add up to the invoice total exactly:
 * the server derives the lines and a "not charged" line adds nothing. Then subtotal, VAT and total, as on a tax invoice.
 */
export function InvoiceLines({ d }: { d: InvoiceView }) {
  const { t, locale } = useI18n();
  const m = (c: number | null | undefined) => fmtMoney(c, locale);
  const unitName = (u: string | null) => { if (!u) return ""; const v = t(`unit.${u}`); return v.startsWith("unit.") ? u : v; };
  const { invoice: inv } = d;
  const title = (l: InvoiceLine) => l.kind === "released" ? t("inv.line_released") : l.kind === "rounding" ? t("inv.line_rounding") : t(`svc.${d.order.service}`);
  const sub = (l: InvoiceLine) => {
    if (l.kind === "billed") return l.unit === "shipment" ? t("inv.sub_delivered", { n: fmtNum(l.qty, locale) }) : t("inv.sub_days", { n: fmtNum(l.qty, locale), unit: unitName(l.unit) });
    if (l.kind === "released") return [t("inv.sub_released", { amount: isolateLtr(m(l.releasedCents ?? 0)) }), l.unit === "shipment" ? notDelivered(d.parcels, t) : ""].filter(Boolean).join(" · ");
    return null;
  };
  return (
    <div>
      <div role="table" aria-label={t("inv.lines")} data-testid="inv-lines" className="text-sm">
        <div role="row" className={cn("hidden border-b border-line pb-2 text-[11px] font-semibold uppercase tracking-wider text-muted sm:grid", GRID)}>
          <div role="columnheader">{t("inv.col_desc")}</div><div role="columnheader" className="text-end">{t("inv.col_qty")}</div>
          <div role="columnheader" className="text-end">{t("inv.col_unit_price")}</div><div role="columnheader" className="text-end">{t("inv.col_amount")}</div>
        </div>
        {d.lines.map((l, i) => (
          <div role="row" key={i} data-testid="inv-line" data-kind={l.kind} className={cn("grid gap-y-1 border-b border-line/70 py-3", GRID)}>
            <div role="cell" className="min-w-0"><p className="font-medium">{title(l)}</p>{sub(l) && <p className="mt-0.5 text-xs text-muted">{sub(l)}</p>}</div>
            <Cell label={t("inv.col_qty")}>{l.kind === "rounding" ? "—" : <>{fmtNum(l.qty, locale)}{l.unit && <span className="ms-1 text-xs text-muted">{unitName(l.unit)}</span>}</>}</Cell>
            <Cell label={t("inv.col_unit_price")}>{l.unitPriceCents == null || l.kind === "rounding" ? "—" : m(l.unitPriceCents)}</Cell>
            <Cell label={t("inv.col_amount")} className="font-medium">{l.amountCents == null ? <span className="text-muted">{t("inv.not_charged")}</span> : m(l.amountCents)}</Cell>
          </div>
        ))}
      </div>
      <p className="mt-2 text-xs text-muted">{t("inv.lines_incl_vat")}</p>
      <dl className="ms-auto mt-4 w-full max-w-xs space-y-1.5 text-sm" data-testid="inv-totals">
        <div className="flex justify-between gap-4"><dt className="text-muted">{t("inv.subtotal_ex")}</dt><dd className="ltr-num tabular-nums" data-testid="inv-subtotal">{m(inv.subtotalCents)}</dd></div>
        <div className="flex justify-between gap-4"><dt className="text-muted">{t("inv.vat_pct", { pct: inv.vatPct })}</dt><dd className="ltr-num tabular-nums" data-testid="inv-vat">{m(inv.vatCents)}</dd></div>
        <div className="flex justify-between gap-4 border-t border-line pt-2 text-base font-bold"><dt>{t("inv.total_incl")}</dt><dd className="ltr-num tabular-nums" data-testid="inv-total">{m(inv.totalCents)}</dd></div>
      </dl>
    </div>
  );
}
