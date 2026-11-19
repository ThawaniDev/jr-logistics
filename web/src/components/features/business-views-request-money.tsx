"use client";
import Link from "next/link";
import { Banknote, FileText, HandCoins, Lock, Wallet } from "lucide-react";
import { Button, CellPair, EmptyState, KV, Section, Stat, StatGrid, Table, Td } from "@/components/ui";
import { outstandingOf, sumCash } from "./business-fieldops-lib";
import { useRequest } from "./business-views-request-ctx";
import { fmtDate, fmtMoney, fmtNum } from "@/lib/format";
import { cn } from "@/lib/cn";
import { useI18n } from "@/i18n/provider";

/** Money of one order: the price it was locked at, what is reserved, the invoices, and the cash the drivers hold. */
export function RequestMoney() {
  const { t, locale } = useI18n(); const { r, data, offers, manifest, open } = useRequest();
  const snap = r.pricingSnapshot as null | { unitPriceCents: number; unit?: string; quantity?: number; expectedUnits?: number; totalUnits?: number; ruleVersion?: number | string };
  const invoices: any[] = data.invoices ?? [];
  const invoiced = invoices.reduce((a, i) => a + (i.totalCents ?? 0), 0);
  const cods = offers.filter((o) => o.cod && ((o.cod.collectedCents ?? 0) > 0 || (o.cod.receivedCents ?? 0) > 0));
  const cash = sumCash(cods.map((o) => o.cod));
  const delivery = r.service === "delivery_driver";
  return (
    <div className="space-y-5">
      <StatGrid cols={4}>
        <Stat label={t("req.total")} value={<span className="ltr-num">{snap ? fmtMoney(r.totalCents, locale) : "—"}</span>} hint={snap ? t("rdz.k_price_hint") : t("req.no_price_yet")} icon={<Wallet className="size-5" />} tone="gold" />
        <Stat label={t("wallet.reserved")} value={<span className="ltr-num">{snap ? fmtMoney(r.reservedCents, locale) : "—"}</span>} hint={t("wallet.reserved_hint")} icon={<Lock className="size-5" />} tone="muted" />
        <Stat label={t("req.invoices")} value={<span className="ltr-num">{fmtMoney(invoiced, locale)}</span>} hint={t("rdz.k_invoices_n", { n: fmtNum(invoices.length, locale) })} icon={<FileText className="size-5" />} />
        {manifest && <Stat label={t("fob.cash_outstanding")} value={<span className="ltr-num">{fmtMoney(cash.outstandingCents, locale)}</span>} hint={t("fob.dash_cash_hint", { amount: fmtMoney(cash.collectedCents, locale) })} icon={<Banknote className="size-5" />} tone={cash.outstandingCents > 0 ? "gold" : "muted"} href="/business/cash" />}
      </StatGrid>

      <div className="grid gap-6 lg:grid-cols-3">
        <Section title={t("req.cost")} description={snap ? t("req.price_locked", { v: snap.ruleVersion ?? "" }) : undefined} className="lg:col-span-1">
          {snap ? (
            <dl data-testid="order-price">
              <KV label={t("wizard.unit_price")}><span className="ltr-num">{fmtMoney(snap.unitPriceCents, locale)}</span>{snap.unit && <span className="text-xs font-normal text-muted"> / {t(`unit.${snap.unit}`)}</span>}</KV>
              {delivery && snap.totalUnits != null && <KV label={t("bs.parcels_count")}><span className="ltr-num tabular-nums">{fmtNum(snap.totalUnits, locale)}</span></KV>}
              {!delivery && snap.quantity != null && snap.expectedUnits != null && <KV label={t("wizard.units")}><span className="ltr-num">{fmtNum(snap.quantity, locale)} × {fmtNum(snap.expectedUnits, locale)}</span></KV>}
              <KV label={t("req.total")}><span className="ltr-num text-accent">{fmtMoney(r.totalCents, locale)}</span></KV>
              <KV label={t("wallet.reserved")}><span className="ltr-num text-gold">{fmtMoney(r.reservedCents, locale)}</span></KV>
              <p className="pt-3 text-xs text-muted">{delivery ? t("bs.refund_note") : t("wizard.refund_note")}</p>
            </dl>
          ) : <p className="text-sm text-muted">{t("req.no_price_yet")}</p>}
        </Section>

        <Section title={t("req.invoices")} flush className="lg:col-span-2">
          {invoices.length === 0 ? <div className="p-5"><EmptyState icon={<FileText className="size-9" aria-hidden />} title={t("rdz.no_invoices")} hint={t("rdz.no_invoices_hint")} /></div> : (
            <Table bare stack label={t("req.invoices")} head={[t("rdz.inv_number"), t("common.date"), { label: t("rdz.inv_subtotal"), align: "end" }, { label: t("rdz.inv_vat"), align: "end" }, { label: t("req.total"), align: "end" }]}>
              {invoices.map((i) => (
                <tr key={i.id} data-testid="order-invoice">
                  <Td label={t("rdz.inv_number")}><span className="ltr-num font-semibold">{i.number}</span></Td>
                  <Td label={t("common.date")} className="whitespace-nowrap text-muted">{fmtDate(i.createdAt, locale)}</Td>
                  <Td label={t("rdz.inv_subtotal")} num>{fmtMoney(i.subtotalCents, locale)}</Td>
                  <Td label={t("rdz.inv_vat")} num className="text-muted">{fmtMoney(i.vatCents, locale)}{i.vatPct != null && <span className="block text-xs">{i.vatPct}%</span>}</Td>
                  <Td label={t("req.total")} num className="font-semibold">{fmtMoney(i.totalCents, locale)}</Td>
                </tr>
              ))}
            </Table>
          )}
        </Section>
      </div>

      {manifest && (
        <Section title={t("fob.cash_title")} description={t("rdz.cash_order_sub")} flush
          actions={<Link href="/business/cash" className="text-sm text-cyan hover:underline">{t("rdz.cash_all")}</Link>}>
          {cods.length === 0 ? <div className="p-5"><EmptyState icon={<Banknote className="size-9" aria-hidden />} title={t("fob.cash_none_title")} hint={t("fob.cash_none_hint")} /></div> : (
            <Table bare stack label={t("fob.cash_title")} head={[t("fob.rcv_driver"), { label: t("fob.cash_collected"), align: "end" }, { label: t("fob.cash_received"), align: "end" }, { label: t("fob.cash_outstanding"), align: "end" }, { label: t("common.open"), srOnly: true }]}>
              {cods.map((o) => { const out = outstandingOf(o.cod); return (
                <tr key={o.id}>
                  <Td label={t("fob.rcv_driver")}><CellPair title={o.driver.name} /></Td>
                  <Td label={t("fob.cash_collected")} num>{fmtMoney(o.cod.collectedCents ?? 0, locale)}</Td>
                  <Td label={t("fob.cash_received")} num className="text-muted">{fmtMoney(o.cod.receivedCents ?? 0, locale)}</Td>
                  <Td label={t("fob.cash_outstanding")} num className={cn("font-semibold", out > 0 && "text-gold")}>{fmtMoney(out, locale)}</Td>
                  <Td align="end">{out > 0 && <Button size="sm" onClick={() => open("cash", o)} data-testid="money-cash-receive"><HandCoins className="size-4" aria-hidden />{t("fob.rcv_short")}</Button>}</Td>
                </tr>); })}
            </Table>
          )}
        </Section>
      )}
    </div>
  );
}
