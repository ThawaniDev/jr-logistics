"use client";
import Link from "next/link";
import { Coins, Handshake, Landmark, Percent, Receipt } from "lucide-react";
import { Badge, CellPair, EmptyState, InfoGrid, Notice, ProgressBar, Section, Stat, StatGrid, Table, Td } from "@/components/ui";
import { cn } from "@/lib/cn";
import { fmtDate, fmtDateTime, fmtMoney, fmtNum, isoToRiyadhLocal } from "@/lib/format";
import { useI18n } from "@/i18n/provider";
import { useTx } from "./admin-common";
import { Money, partyHref } from "./admin-finance-parts";
import { JsonView } from "./activity-raw";
import { isolate, type AdminInvoiceView } from "./invoice-types";

/** The settlement's list page narrowed to the day it was created (the list has no per-record page; `from` / `to` are its URL filters). */
export const settlementListHref = (createdAt: string | null) => {
  const day = createdAt ? isoToRiyadhLocal(createdAt).slice(0, 10) : "";
  return day ? `/admin/finance/settlements?from=${day}&to=${day}` : "/admin/finance/settlements";
};

/** Customer price → provider cost → platform margin → VAT, plus what was reserved, released and adjusted. Admin only. */
export function MoneyBreakdown({ d }: { d: AdminInvoiceView }) {
  const { t, locale } = useI18n(); const s = d.admin.settlement;
  if (!s) return <Section title={t("inv.money_title")}><Notice tone="info">{t("inv.no_settlement")}</Notice></Section>;
  const share = s.customerCents > 0 ? Math.round((s.marginCents / s.customerCents) * 1000) / 10 : 0;
  return (
    <Section title={t("inv.money_title")} description={t("inv.money_hint")} id="inv-money">
      <div className="space-y-4" data-testid="inv-money">
        <StatGrid cols={4}>
          <Stat label={t("inv.m_customer")} value={<Money c={s.customerCents} />} hint={t("inv.m_customer_hint")} icon={<Receipt className="size-5" />} tone="accent" />
          <Stat label={t("inv.m_provider")} value={<Money c={s.providerCents} />} hint={t("inv.m_provider_hint", { payee: isolate(d.admin.payee?.name ?? "—") })} icon={<Handshake className="size-5" />} tone="cyan" />
          <Stat label={t("admin.margin")} value={<Money c={s.marginCents} />} hint={t("inv.m_margin_hint", { pct: fmtNum(share, locale) })} icon={<Coins className="size-5" />} tone="gold" />
          <Stat label={t("adm.vat")} value={<Money c={s.vatCents} />} hint={t("inv.m_vat_hint", { pct: d.invoice.vatPct })} icon={<Percent className="size-5" />} tone="muted" />
        </StatGrid>
        <div><ProgressBar value={s.providerCents} max={s.customerCents} tone="cyan" label={t("inv.m_split")} /><p className="mt-1 text-xs text-muted">{t("inv.m_split")}</p></div>
        <InfoGrid cols={4} items={[
          { label: t("inv.m_reserved"), value: <Money c={s.reservedCents} /> },
          { label: t("inv.m_released"), value: <Money c={s.refundCents} /> },
          { label: t("inv.m_adjustment"), value: <Money c={s.adjustmentCents} /> },
          { label: t("inv.m_net_margin"), value: <Money c={s.marginCents - s.vatCents} /> },
        ]} />
      </div>
    </Section>
  );
}

/** The settlement behind the invoice and who got paid. */
export function SettlementCard({ d }: { d: AdminInvoiceView }) {
  const { t, locale } = useI18n(); const tx = useTx(); const { settlement: s, payee, driver } = d.admin;
  if (!s) return null;
  const link = (kind: string, id: string, name: string) => <Link href={partyHref(kind, id) ?? "#"} className="text-accent hover:underline">{name}</Link>;
  return (
    <Section title={t("inv.settlement_title")} id="inv-settlement" actions={<Link href={settlementListHref(s.createdAt)} className="text-xs font-medium text-accent hover:underline" data-testid="inv-open-settlement">{t("inv.open_settlement")}</Link>}>
      <InfoGrid cols={3} items={[
        { label: t("common.status"), value: <Badge tone={s.status === "paid" ? "success" : "warn"}>{tx(`settle.${s.status}`, s.status)}</Badge> },
        { label: t("inv.s_paid_at"), value: fmtDateTime(s.paidAt, locale) },
        { label: t("inv.s_created"), value: fmtDateTime(s.createdAt, locale) },
        { label: t("inv.s_units"), value: <span className="ltr-num">{`${s.finalUnits} / ${s.expectedUnits}`}</span> },
        { label: t("inv.s_payee"), value: payee && <>{link(payee.kind, payee.id, payee.name)} <span className="text-xs text-muted">({t(`role.${payee.kind}`)})</span></> },
        { label: t("inv.s_driver"), value: driver && link("driver", driver.id, driver.name) },
        { label: t("inv.s_approved"), value: fmtDateTime(s.approvedAt, locale) },
        ...(s.note ? [{ label: t("inv.s_note"), value: s.note }] : []),
      ]} />
    </Section>
  );
}

const Delta = ({ cents, locale }: { cents: number; locale: Parameters<typeof fmtMoney>[1] }) => cents
  ? <span className={cn("ltr-num tabular-nums font-semibold", cents > 0 ? "text-accent" : "text-ink")}>{cents > 0 ? "+" : "−"}{fmtMoney(Math.abs(cents), locale)}</span> : <span className="text-muted">—</span>;

/** Every ledger entry that references the settlement (the balanced set: escrow released, charge, payout, platform fee). */
export function LedgerSection({ d }: { d: AdminInvoiceView }) {
  const { t, locale } = useI18n(); const tx = useTx(); const rows = d.admin.ledger;
  return (
    <Section title={t("inv.ledger_title")} description={t("inv.ledger_hint")} flush id="inv-ledger">
      {rows.length === 0 ? <div className="p-5"><EmptyState icon={<Landmark className="size-9" aria-hidden />} title={t("inv.ledger_none")} /></div> : (
        <Table bare dense stack label={t("inv.ledger_title")} head={[t("common.date"), t("inv.l_entry"), t("inv.l_account"), { label: t("ubz.col_available"), align: "end" }, { label: t("wallet.reserved"), align: "end" }]}>
          {rows.map((e) => (
            <tr key={e.id} data-testid="inv-ledger-row">
              <Td label={t("common.date")} className="whitespace-nowrap text-muted">{fmtDateTime(e.createdAt, locale)}</Td>
              <Td label={t("inv.l_entry")}><span className="font-medium">{tx(`ledger.${e.kind}`, e.kind)}</span>{e.simulated && <Badge tone="warn" className="ms-2">{t("wallet.simulated")}</Badge>}</Td>
              <Td label={t("inv.l_account")}>{e.accountKind === "platform" ? <CellPair title={t("inv.platform_account")} /> : <CellPair title={e.owner ?? "—"} href={e.ownerId ? partyHref(e.ownerRole, e.ownerId) : undefined} sub={e.ownerRole ? t(`role.${e.ownerRole}`) : undefined} />}</Td>
              <Td label={t("ubz.col_available")} align="end"><Delta cents={e.availableCents} locale={locale} /></Td>
              <Td label={t("wallet.reserved")} align="end"><Delta cents={e.reservedCents} locale={locale} /></Td>
            </tr>))}
        </Table>
      )}
    </Section>
  );
}

const SNAP_KEYS = ["ruleVersion", "unit", "unitPriceCents", "providerCostCents", "expectedUnits", "quantity", "totalUnits", "agreementRef", "currency"] as const;
/** The price as it was locked when the order was published (unit price, provider cost, the rule it came from). */
export function SnapshotSection({ d }: { d: AdminInvoiceView }) {
  const { t, locale } = useI18n(); const snap = d.admin.snapshot as Record<string, unknown> | null;
  if (!snap || Object.keys(snap).length === 0) return null;
  const show = (k: string, v: unknown) => /Cents$/.test(k) ? <Money c={Number(v)} /> : k === "unit" ? t(`unit.${v}`) : <span className="ltr-num">{String(v)}</span>;
  const items = SNAP_KEYS.filter((k) => snap[k] != null && snap[k] !== "").map((k) => ({ label: t(`inv.snap_${k}`), value: show(k, snap[k]) }));
  return (
    <Section title={t("inv.snapshot_title")} description={t("inv.snapshot_hint")} id="inv-snapshot">
      <div className="space-y-4" data-testid="inv-snapshot">
        {items.length > 0 && <InfoGrid cols={3} items={items} />}
        <JsonView data={snap} testId="inv-snapshot-json" />
        {snap.effectiveAt != null && <p className="text-xs text-muted">{t("inv.snap_effective", { when: isolate(fmtDate(String(snap.effectiveAt), locale)) })}</p>}
      </div>
    </Section>
  );
}

/** The other invoices of the same order (an order with several drivers gets one invoice per driver job). */
export function SiblingsSection({ d }: { d: AdminInvoiceView }) {
  const { t, locale } = useI18n(); const rows = d.admin.siblings;
  if (rows.length === 0) return null;
  return (
    <Section title={t("inv.siblings_title")} flush id="inv-siblings">
      <Table bare dense stack label={t("inv.siblings_title")} head={[t("adm.invoice_no"), t("common.date"), { label: t("req.total"), align: "end" }]}>
        {rows.map((r) => (
          <tr key={r.id} data-testid="inv-sibling">
            <Td label={t("adm.invoice_no")}><Link href={`/admin/finance/invoices/${r.id}`} className="ltr-num font-medium text-accent hover:underline">{r.number}</Link></Td>
            <Td label={t("common.date")} className="whitespace-nowrap text-muted">{fmtDateTime(r.createdAt, locale)}</Td>
            <Td label={t("req.total")} num><Money c={r.totalCents} /></Td>
          </tr>))}
      </Table>
    </Section>
  );
}
