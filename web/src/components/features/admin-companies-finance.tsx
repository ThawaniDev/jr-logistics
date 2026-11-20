"use client";
import type { ReactNode } from "react";
import Link from "next/link";
import { ArrowRight, Coins, Lock, Wallet, Banknote, HandCoins } from "lucide-react";
import { Badge, CellPair, ErrorState, Section, Skeleton, Stat, StatGrid, Table, Td } from "@/components/ui";
import { useApi } from "@/components/ui/data";
import { fmtDate, fmtDateTime, fmtMoney, fmtNum } from "@/lib/format";
import { useI18n } from "@/i18n/provider";
import { hasPerm, useUser } from "@/components/layout/auth-context";
import { useTx } from "./admin-common";
import { useCompany } from "./admin-companies-ctx";
import { CompanyMoney } from "./admin-company-detail-money";

interface Q { data?: any; error?: unknown; mutate: () => unknown }
/** Loading / error / empty frame for one list inside a section, so every block of the tab behaves the same. */
function Feed({ q, empty, children }: { q: Q; empty: string; children: (items: any[]) => ReactNode }) {
  const { t } = useI18n();
  if (q.error) return <div className="p-5"><ErrorState error={q.error} retry={() => q.mutate()} /></div>;
  if (!q.data) return <div className="space-y-2 p-5" aria-busy="true"><Skeleton className="h-9" /><Skeleton className="h-9" /><Skeleton className="h-9" /></div>;
  if (q.data.items.length === 0) return <p className="px-5 py-8 text-center text-sm text-muted">{t(empty)}</p>;
  return <>{children(q.data.items)}</>;
}
const more = (href: string, label: string) => <Link href={href} className="inline-flex items-center gap-1 text-sm text-accent hover:underline">{label}<ArrowRight className="size-4 rtl:rotate-180" aria-hidden /></Link>;

/** Finance tab: wallet balances, the latest ledger entries, invoices and cash on delivery of this company. Each block follows the permission of its own API. */
export function CompanyFinance() {
  const { t, locale } = useI18n(); const me = useUser(); const c = useCompany(); const tx = useTx();
  const can = (p: string) => hasPerm(me, p);
  const seeWallet = can("finance.view") || can("wallets.view"), seeInvoices = can("finance.view"), seeCod = can("cod.manage") || can("finance.view");
  const ov = useApi(seeWallet ? `/admin/companies/${c.id}/overview` : null, { shouldRetryOnError: false });
  const ledger = useApi(seeWallet ? `/admin/finance/ledger?userId=${c.id}&pageSize=8` : null, { shouldRetryOnError: false });
  const inv = useApi(seeInvoices ? `/admin/finance/invoices?businessId=${c.id}&pageSize=8` : null, { shouldRetryOnError: false });
  const cod = useApi(seeCod ? `/admin/cod?businessId=${c.id}&pageSize=8` : null, { shouldRetryOnError: false });
  const w = ov.data?.wallet; const m = (n?: number | null) => fmtMoney(n, locale); const sign = (n: number) => `${n > 0 ? "+" : ""}${m(n)}`;
  const tone = (n: number) => (n > 0 ? "text-accent" : n < 0 ? "text-danger" : "text-muted");
  const totals = cod.data?.totals;
  return (
    <div className="space-y-5">
      {seeWallet && (
        <StatGrid cols={4}>
          <Stat label={t("wallet.available")} value={m(w?.availableCents)} hint={w && w.creditLimitCents > 0 ? t("rdp.ov_credit_hint", { amount: m(w.creditLimitCents) }) : t("rdp.ov_wallet_hint")} tone={(w?.availableCents ?? 0) < 0 ? "danger" : "accent"} icon={<Wallet className="size-5" />} loading={!ov.data && !ov.error} />
          <Stat label={t("wallet.reserved")} value={m(w?.reservedCents)} hint={t("wallet.reserved_hint")} tone="muted" icon={<Lock className="size-5" />} loading={!ov.data && !ov.error} />
          <Stat label={t("wallet.held")} value={m(w?.heldCents)} hint={t("wallet.held_hint")} tone="muted" icon={<Banknote className="size-5" />} loading={!ov.data && !ov.error} />
          <Stat label={t("rdp.credit_limit")} value={m(w?.creditLimitCents)} hint={t("rdp.credit_limit_hint")} tone="gold" icon={<HandCoins className="size-5" />} loading={!ov.data && !ov.error} />
        </StatGrid>)}

      {(seeWallet || seeInvoices) && <CompanyMoney />}

      {seeWallet && (
        <Section title={t("rdp.recent_ledger")} flush actions={more(`/admin/finance/ledger?userId=${c.id}`, t("rdp.open_ledger"))}>
          <Feed q={ledger} empty="wallet.no_entries">{(items) => (
            <Table bare stack label={t("rdp.recent_ledger")} head={[t("common.date"), t("wallet.type"), { label: t("common.amount"), align: "end" }, t("adm.note")]}>
              {items.map((e) => (
                <tr key={e.id} data-testid="companies-ledger-row">
                  <Td label={t("common.date")} className="whitespace-nowrap text-muted">{fmtDateTime(e.createdAt, locale)}</Td>
                  <Td label={t("wallet.type")}><span className="inline-flex flex-wrap items-center gap-1.5">{tx(`ledger.${e.kind}`, e.kind)}{e.simulated && <Badge>{t("wallet.simulated")}</Badge>}</span></Td>
                  <Td label={t("common.amount")} align="end" className="ltr-num tabular-nums"><span className={tone(e.availableDeltaCents)}>{sign(e.availableDeltaCents)}</span>{e.reservedDeltaCents !== 0 && <span className="block text-xs text-muted">{t("wallet.reserved")}: {sign(e.reservedDeltaCents)}</span>}</Td>
                  <Td label={t("adm.note")} className="max-w-xs truncate text-muted">{e.note ?? "—"}</Td>
                </tr>))}
            </Table>)}</Feed>
        </Section>)}

      {seeInvoices && (
        <Section title={t("req.invoices")} flush actions={more(`/admin/finance/invoices?businessId=${c.id}`, t("rdp.open_invoices"))}>
          <Feed q={inv} empty="rdp.no_invoices">{(items) => (
            <Table bare stack label={t("req.invoices")} head={[t("adm.invoice_no"), t("req.ref"), { label: t("adm.subtotal"), align: "end" }, { label: t("adm.vat"), align: "end" }, { label: t("req.total"), align: "end" }, t("common.date")]}>
              {items.map((i) => (
                <tr key={i.id} data-testid="companies-invoice-row">
                  <Td label={t("adm.invoice_no")} className="ltr-num font-medium"><Link href={`/admin/finance/invoices/${i.id}`} className="text-accent hover:underline" data-testid="companies-invoice-link">{i.number}</Link></Td>
                  <Td label={t("req.ref")}><Link href={`/admin/requests/${i.requestId}`} className="ltr-num text-accent hover:underline">{i.ref}</Link></Td>
                  <Td label={t("adm.subtotal")} num>{m(i.subtotalCents)}</Td>
                  <Td label={t("adm.vat")} num>{m(i.vatCents)}</Td>
                  <Td label={t("req.total")} num className="font-semibold">{m(i.totalCents)}</Td>
                  <Td label={t("common.date")} className="whitespace-nowrap text-muted">{fmtDate(i.createdAt, locale)}</Td>
                </tr>))}
            </Table>)}</Feed>
        </Section>)}

      {seeCod && (
        <Section title={t("nav.cod")} flush actions={more(`/admin/finance/cod?businessId=${c.id}`, t("rdp.open_cod"))}>
          {totals && (
            <div className="p-4"><StatGrid cols={3}>
              <Stat label={t("rdp.cod_collected")} value={m(totals.collectedCents)} tone="muted" icon={<Coins className="size-5" />} />
              <Stat label={t("rdp.cod_received")} value={m(totals.receivedCents)} tone="accent" icon={<Banknote className="size-5" />} />
              <Stat label={t("rdp.ov_cod")} value={m(totals.outstandingCents)} tone={totals.outstandingCents > 0 ? "gold" : "muted"} icon={<HandCoins className="size-5" />} />
            </StatGrid></div>)}
          <Feed q={cod} empty="rdp.no_cod">{(items) => (
            <Table bare stack label={t("nav.cod")} head={[t("req.ref"), t("adm.col_driver"), { label: t("rdp.cod_parcels"), align: "end" }, { label: t("rdp.cod_collected"), align: "end" }, { label: t("rdp.cod_received"), align: "end" }, { label: t("rdp.ov_cod"), align: "end" }]}>
              {items.map((o) => (
                <tr key={o.offerId} data-testid="companies-cod-row">
                  <Td label={t("req.ref")}><CellPair href={`/admin/requests/${o.requestId}`} title={<span className="ltr-num">{o.ref}</span>} sub={o.lastCollectedAt ? fmtDateTime(o.lastCollectedAt, locale) : undefined} /></Td>
                  <Td label={t("adm.col_driver")}>{can("drivers.view") ? <Link href={`/admin/drivers/${o.driverId}`} className="text-accent hover:underline">{o.driverName}</Link> : o.driverName}</Td>
                  <Td label={t("rdp.cod_parcels")} num>{fmtNum(o.parcels, locale)}</Td>
                  <Td label={t("rdp.cod_collected")} num>{m(o.collectedCents)}</Td>
                  <Td label={t("rdp.cod_received")} num>{m(o.receivedCents)}</Td>
                  <Td label={t("rdp.ov_cod")} num className={o.outstandingCents > 0 ? "font-semibold text-gold" : "text-muted"}>{m(o.outstandingCents)}</Td>
                </tr>))}
            </Table>)}</Feed>
        </Section>)}
    </div>
  );
}
