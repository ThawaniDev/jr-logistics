"use client";
import { useState } from "react";
import Link from "next/link";
import { ShieldAlert } from "lucide-react";
import { Badge, EmptyState, ErrorState, InfoGrid, KV, PageLoading, Section, StatGrid, Stat, Table, Td, type Tone } from "@/components/ui";
import { useApi } from "@/components/ui/data";
import { fmtDate, fmtDateTime, fmtMoney, fmtNum } from "@/lib/format";
import { useI18n } from "@/i18n/provider";
import { hasPerm, useUser } from "@/components/layout/auth-context";
import { useTx } from "./admin-common";
import { useOrder } from "./admin-order-ctx";
import { OrderCash, OrderLedger } from "./admin-order-money-cash";

const SETTLE_TONE: Record<string, Tone> = { paid: "success", approved: "info", batch_ready: "info", pending_review: "warn", rejected: "danger", failed: "danger" };

/** Money of one order (`finance.view`): how the price was built, the reservation and its release, settlements with their breakdown, invoices, cash on delivery, refunds and every ledger entry. */
export function OrderMoney() {
  const { t, locale } = useI18n(); const me = useUser(); const tx = useTx();
  const { id } = useOrder();
  const [page, setPage] = useState(1);
  const allowed = hasPerm(me, "finance.view");
  const { data, error, mutate } = useApi(allowed ? `/admin/requests/${id}/money${page > 1 ? `?page=${page}` : ""}` : null, { keepPreviousData: true, refreshInterval: 60000 });
  const m = (c: number | null | undefined) => <span className="ltr-num">{fmtMoney(c, locale)}</span>;
  if (!allowed) return <EmptyState icon={<ShieldAlert className="size-9" aria-hidden />} title={t("dv1.money_denied")} hint={t("dv1.money_denied_hint")} />;
  if (error && !data) return <ErrorState error={error} retry={() => mutate()} />;
  if (!data) return <PageLoading />;
  const s = data.pricing.snapshot, rule = data.pricing.rule, tot = data.totals, res = data.reservation;
  const units = s?.totalUnits ?? null;
  return (
    <div className="space-y-5" data-testid="dv1-money">
      <StatGrid cols={6}>
        <Stat label={t("dv1.m_price")} value={m(data.request.totalCents)} tone="accent" hint={t("dv1.m_price_hint", { units: units ?? "—" })} />
        <Stat label={t("dv1.m_billed")} value={m(tot.customerCents)} tone="cyan" hint={t("dv1.m_settlements_n", { n: tot.settlements })} />
        <Stat label={t("dv1.m_provider")} value={m(tot.settlements ? tot.providerCents : s?.providerTotalCents)} tone="muted" />
        <Stat label={t("dv1.m_margin")} value={m(tot.settlements ? tot.marginCents : s?.marginCents)} tone="gold" />
        <Stat label={t("dv1.m_vat")} value={m(tot.vatCents)} tone="muted" hint={t("dv1.m_invoiced", { amount: fmtMoney(tot.invoicedCents, locale) })} />
        <Stat label={t("dv1.m_refunds")} value={m(tot.refundCents)} tone={tot.refundCents > 0 ? "danger" : "muted"} hint={t("dv1.m_adjust", { amount: fmtMoney(tot.adjustmentCents, locale) })} />
      </StatGrid>

      <Section title={t("dv1.price_title")} description={t("dv1.price_sub")} id="order-pricing">
        {!s ? <p className="text-sm text-muted">{t("req.no_price_yet")}</p> : (
          <div className="grid gap-6 lg:grid-cols-2">
            <dl data-testid="dv1-price-build">
              <KV label={t("dv1.p_units")}><span className="ltr-num">{fmtNum(s.quantity, locale)} × {fmtNum(s.expectedUnits, locale)} → {fmtNum(s.totalUnits, locale)} {tx(`unit.${s.unit}`, s.unit)}</span></KV>
              <KV label={t("rda.unit_price")}>{m(s.unitPriceCents)}</KV>
              <KV label={t("dv1.p_customer")}><b>{m(s.totalCents)}</b><span className="block text-xs font-normal text-muted"><bdi className="ltr-num">{fmtMoney(s.unitPriceCents, locale)} × {fmtNum(s.totalUnits, locale)}</bdi></span></KV>
              <KV label={t("admin.provider_cost")}>{m(s.providerTotalCents)}<span className="block text-xs font-normal text-muted"><bdi className="ltr-num">{fmtMoney(s.providerCostCents, locale)} × {fmtNum(s.totalUnits, locale)}</bdi></span></KV>
              <KV label={t("admin.margin")}><span className="text-gold">{m(s.marginCents)}</span>{s.totalCents > 0 && <span className="block text-xs font-normal text-muted"><bdi className="ltr-num">{fmtNum(Math.round((s.marginCents / s.totalCents) * 1000) / 10, locale)}%</bdi></span>}</KV>
            </dl>
            <div>
              <InfoGrid cols={2} items={[
                { label: t("dv1.p_rule"), value: <span className="ltr-num">v{s.ruleVersion}{rule && <> · <Badge tone={rule.status === "approved" ? "success" : "neutral"}>{tx(`dv1.rule_${rule.status}`, rule.status)}</Badge></>}</span> },
                { label: t("dv1.p_agreement"), value: s.agreementRef ?? "—" },
                { label: t("dv1.p_effective"), value: s.effectiveAt ? fmtDate(s.effectiveAt, locale) : "—" },
                { label: t("dv1.p_expires"), value: s.expiresAt ? fmtDate(s.expiresAt, locale) : t("dv1.p_no_expiry") },
                { label: t("dv1.p_scope"), value: rule ? <span className="flex flex-wrap gap-1">{rule.businessSpecific && <Badge tone="info">{t("dv1.p_scope_business")}</Badge>}{rule.vehicleType && <Badge>{t(`vehicle.${rule.vehicleType}`)}</Badge>}{rule.pickupCity && <Badge>{t(`city.${rule.pickupCity}`)}</Badge>}{rule.deliveryCity && <Badge>{t(`city.${rule.deliveryCity}`)}</Badge>}{!rule.businessSpecific && !rule.vehicleType && !rule.pickupCity && !rule.deliveryCity && <Badge>{t("dv1.p_scope_global")}</Badge>}</span> : "—" },
                { label: t("dv1.p_currency"), value: s.currency ?? "SAR" },
              ]} />
              <p className="mt-3 text-xs text-muted">{rule ? t("req.price_locked", { v: s.ruleVersion }) : t("dv1.p_rule_gone")}</p>
            </div>
          </div>
        )}
      </Section>

      <Section title={t("dv1.reserve_title")} description={t("dv1.reserve_sub")} id="order-reservation" flush>
        <div className="grid gap-px border-b border-line bg-line sm:grid-cols-3">
          {([["dv1.r_now", res.currentCents], ["dv1.r_reserved", res.reservedCents], ["dv1.r_released", res.releasedCents]] as const).map(([k, v]) => <div key={k} className="bg-card p-4"><p className="text-xs text-muted">{t(k)}</p><p className="mt-1 text-lg font-bold">{m(v)}</p></div>)}
        </div>
        <Table bare dense stack label={t("dv1.reserve_title")} head={[t("dv1.col_kind"), { label: t("dv1.col_entries"), align: "end" }, { label: t("dv1.col_available"), align: "end" }, { label: t("dv1.col_reserved"), align: "end" }, { label: t("dv1.col_held"), align: "end" }]}>
          {res.entries.map((e: any) => <tr key={e.kind}><Td label={t("dv1.col_kind")}>{tx(`ledger.${e.kind}`, e.kind)}</Td><Td label={t("dv1.col_entries")} num>{e.n}</Td><Td label={t("dv1.col_available")} num>{fmtMoney(e.availableCents, locale)}</Td><Td label={t("dv1.col_reserved")} num>{fmtMoney(e.reservedCents, locale)}</Td><Td label={t("dv1.col_held")} num>{fmtMoney(e.heldCents, locale)}</Td></tr>)}
        </Table>
      </Section>

      <Section title={t("dv1.settle_title")} description={t("dv1.settle_sub")} id="order-settlements" flush actions={<Link href="/admin/finance/settlements" className="text-sm text-accent hover:underline">{t("dv1.open_settlements")}</Link>}>
        {data.settlements.length === 0 ? <div className="p-5"><EmptyState title={t("dv1.settle_none")} hint={t("dv1.settle_none_hint")} /></div> : (
          <Table bare stack label={t("dv1.settle_title")} head={[t("req.drivers"), t("common.status"), { label: t("dv1.col_units"), align: "end" }, { label: t("dv1.col_customer"), align: "end" }, { label: t("dv1.col_provider"), align: "end" }, { label: t("dv1.col_margin"), align: "end" }, { label: t("dv1.col_vat"), align: "end" }, { label: t("dv1.col_refund"), align: "end" }, t("dv1.col_dates")]}>
            {data.settlements.map((x: any) => (
              <tr key={x.id} data-testid="dv1-settlement-row">
                <Td label={t("req.drivers")}><p className="font-medium">{x.driverName}</p>{x.officeName && <p className="text-xs text-muted">{x.officeName}</p>}</Td>
                <Td label={t("common.status")}><Badge tone={SETTLE_TONE[x.status] ?? "neutral"}>{tx(`settle.${x.status}`, x.status)}</Badge>{x.note && <p className="mt-1 max-w-48 text-xs text-muted">{x.note}</p>}</Td>
                <Td label={t("dv1.col_units")} num>{x.finalUnits}</Td><Td label={t("dv1.col_customer")} num>{fmtMoney(x.customerCents, locale)}</Td><Td label={t("dv1.col_provider")} num>{fmtMoney(x.providerCents, locale)}</Td>
                <Td label={t("dv1.col_margin")} num className="text-gold">{fmtMoney(x.marginCents, locale)}</Td><Td label={t("dv1.col_vat")} num>{fmtMoney(x.vatCents, locale)}</Td><Td label={t("dv1.col_refund")} num>{fmtMoney(x.refundCents, locale)}</Td>
                <Td label={t("dv1.col_dates")} className="whitespace-nowrap text-xs text-muted"><p>{t("dv1.d_created", { time: fmtDateTime(x.createdAt, locale) })}</p>{x.approvedAt && <p>{t("dv1.d_approved", { time: fmtDateTime(x.approvedAt, locale), name: x.approver ?? "—" })}</p>}{x.paidAt && <p>{t("dv1.d_paid", { time: fmtDateTime(x.paidAt, locale) })}</p>}</Td>
              </tr>
            ))}
          </Table>
        )}
      </Section>

      <Section title={t("dv1.invoices_title")} id="order-invoices" flush>
        {data.invoices.length === 0 ? <div className="p-5"><EmptyState title={t("dv1.invoices_none")} /></div> : (
          <Table bare dense stack label={t("dv1.invoices_title")} head={[t("dv1.col_number"), { label: t("dv1.col_subtotal"), align: "end" }, { label: t("dv1.col_vat"), align: "end" }, { label: t("req.total"), align: "end" }, t("dv1.col_dates")]}>
            {data.invoices.map((i: any) => <tr key={i.id}><Td label={t("dv1.col_number")} className="ltr-num font-medium"><Link href={`/admin/finance/invoices/${i.id}`} className="text-accent hover:underline" data-testid="order-invoice-link">{i.number}</Link></Td><Td label={t("dv1.col_subtotal")} num>{fmtMoney(i.subtotalCents, locale)}</Td><Td label={t("dv1.col_vat")} num>{fmtMoney(i.vatCents, locale)} <span className="text-xs text-muted">({i.vatPct}%)</span></Td><Td label={t("req.total")} num>{fmtMoney(i.totalCents, locale)}</Td><Td label={t("dv1.col_dates")} className="text-muted">{fmtDateTime(i.createdAt, locale)}</Td></tr>)}
          </Table>
        )}
      </Section>

      <OrderCash cod={data.cod} adjustments={data.adjustments} requestId={id} />
      <OrderLedger ledger={data.ledger} page={page} onPage={setPage} requestId={id} />
    </div>
  );
}
