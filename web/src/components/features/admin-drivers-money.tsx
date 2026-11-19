"use client";
import { useState } from "react";
import Link from "next/link";
import { Coins, HandCoins, Wallet } from "lucide-react";
import { Badge, EmptyState, ErrorState, Notice, PageLoading, Section, Stat, StatGrid, Table, Td } from "@/components/ui";
import { useApi } from "@/components/ui/data";
import { fmtDate, fmtDateTime, fmtMoney } from "@/lib/format";
import { useI18n } from "@/i18n/provider";
import { useUser } from "@/components/layout/auth-context";
import { hasAny, qs, useTx } from "./admin-common";
import { Money, pagerFooter } from "./admin-offices-common";

const SIZE = 10;

/** "Wallet & cash" tab: the driver's wallet and earnings (needs `finance.view` / `wallets.view`) and the cash on delivery they hold (needs `cod.manage` / `finance.view`). */
export function DriverMoneyTab({ id }: { id: string }) {
  const { t } = useI18n(); const me = useUser();
  const canWallet = hasAny(me, "finance.view", "wallets.view"), canCod = hasAny(me, "cod.manage", "finance.view");
  if (!canWallet && !canCod) return <Notice tone="warn">{t("rdq.no_access")}</Notice>;
  return <div className="space-y-6">{canWallet && <WalletPart id={id} />}{canCod && <CashPart id={id} />}</div>;
}

function WalletPart({ id }: { id: string }) {
  const { t, locale } = useI18n(); const tx = useTx();
  const { data, error, mutate } = useApi(`/admin/drivers/${id}/wallet`);
  const ov = useApi(`/admin/drivers/${id}/overview`);
  if (error) return <ErrorState error={error} retry={() => mutate()} />;
  if (!data) return <PageLoading />;
  const { wallet, earnings, entries } = data; const money = (c: number) => fmtMoney(c, locale);
  return (
    <section aria-label={t("rdq.wallet_title")} className="space-y-4">
      {ov.data?.officeId && <Notice tone="info">{t("rdq.earnings_to_office", { office: ov.data.office ?? "" })}</Notice>}
      <StatGrid cols={4}>
        <Stat label={t("wallet.available")} value={<Money cents={wallet.availableCents} />} icon={<Wallet className="size-5" />} tone="accent" />
        <Stat label={t("wallet.held")} value={<Money cents={wallet.heldCents} />} hint={t("wallet.held_hint")} tone={wallet.heldCents ? "gold" : "muted"} />
        <Stat label={t("rdq.earnings_paid")} value={<Money cents={earnings.paidCents} />} hint={earnings.viaOfficePaidCents ? t("rdq.via_office_paid", { amount: money(earnings.viaOfficePaidCents) }) : t("rdq.paid_to_driver")} tone="cyan" />
        <Stat label={t("rdq.earnings_pending")} value={<Money cents={earnings.pendingCents} />} hint={earnings.viaOfficePendingCents ? t("rdq.via_office_pending", { amount: money(earnings.viaOfficePendingCents) }) : t("rdq.earnings_pending_hint")} tone={earnings.pendingCents ? "gold" : "muted"} />
      </StatGrid>
      <Section title={t("wallet.history")} flush>
        {entries.length === 0 ? <div className="p-4"><EmptyState title={t("wallet.no_entries")} /></div> : (
          <Table stack bare dense label={t("wallet.history")} head={[t("wallet.type"), { label: t("common.amount"), align: "end" }, t("adm.note"), t("common.date")]}>
            {entries.map((e: any) => (
              <tr key={e.id}>
                <Td>{tx(`ledger.${e.kind}`, e.kind)}{e.simulated && <Badge className="ms-2">{t("wallet.simulated")}</Badge>}</Td>
                <Td label={t("common.amount")} align="end"><span className={e.availableDeltaCents < 0 ? "text-danger" : e.availableDeltaCents > 0 ? "text-accent" : undefined}><Money cents={e.availableDeltaCents || e.heldDeltaCents} /></span></Td>
                <Td label={t("adm.note")} className="max-w-72 truncate text-muted">{e.note ?? "—"}</Td>
                <Td label={t("common.date")} className="whitespace-nowrap text-muted">{fmtDateTime(e.createdAt, locale)}</Td>
              </tr>
            ))}
          </Table>
        )}
      </Section>
    </section>
  );
}

function CashPart({ id }: { id: string }) {
  const { t, locale } = useI18n(); const me = useUser(); const [page, setPage] = useState(1);
  const { data, error, mutate } = useApi(`/admin/cod${qs({ driverId: id, page, pageSize: SIZE })}`, { keepPreviousData: true });
  if (error && !data) return <ErrorState error={error} retry={() => mutate()} />;
  if (!data) return <PageLoading />;
  const tot = data.totals;
  return (
    <section aria-label={t("rdq.cash_title")} className="space-y-4">
      <StatGrid cols={3}>
        <Stat label={t("foa.cod_collected")} value={<Money cents={tot.collectedCents} />} icon={<Coins className="size-5" />} tone="cyan" />
        <Stat label={t("rdq.cash_handed")} value={<Money cents={tot.receivedCents} />} tone="accent" />
        <Stat label={t("rdq.cash_held")} value={<Money cents={tot.outstandingCents} />} icon={<HandCoins className="size-5" />} tone={tot.outstandingCents ? "gold" : "muted"} hint={tot.outstandingCents ? t("rdq.cash_held_hint") : t("foa.cod_nothing_outstanding")} />
      </StatGrid>
      <Section title={t("rdq.cash_title")} flush
        actions={hasAny(me, "cod.manage", "finance.view") ? <Link href="/admin/finance/cod" className="text-sm font-medium text-accent hover:underline" data-testid="rdq-open-cod">{t("foa.cod_open_console")}</Link> : undefined}>
        {data.items.length === 0 ? <div className="p-4"><EmptyState title={t("foa.cod_empty")} hint={t("foa.cod_empty_hint")} /></div> : (
          <Table stack bare dense label={t("rdq.cash_title")} head={[t("req.ref"), t("office.business"), { label: t("rdq.col_parcels"), align: "end" }, { label: t("foa.cod_collected"), align: "end" }, { label: t("foa.cod_outstanding"), align: "end" }, t("common.date")]}
          footer={pagerFooter(page, data.total, SIZE, setPage)}>
            {data.items.map((o: any) => (
              <tr key={o.offerId}>
                <Td>{hasAny(me, "requests.view") ? <Link href={`/admin/requests/${o.requestId}`} className="ltr-num font-semibold text-accent hover:underline">{o.ref}</Link> : <span className="ltr-num font-semibold">{o.ref}</span>}</Td>
                <Td label={t("office.business")}>{o.businessName ?? "—"}</Td>
                <Td label={t("rdq.col_parcels")} num>{o.parcels}</Td>
                <Td label={t("foa.cod_collected")} align="end"><Money cents={o.collectedCents} /></Td>
                <Td label={t("foa.cod_outstanding")} align="end">{o.outstandingCents > 0 ? <span className="font-semibold text-gold"><Money cents={o.outstandingCents} /></span> : <Money cents={0} />}</Td>
                <Td label={t("common.date")} className="whitespace-nowrap text-muted">{o.lastCollectedAt ? fmtDate(o.lastCollectedAt, locale) : "—"}</Td>
              </tr>
            ))}
          </Table>
        )}
      </Section>
    </section>
  );
}
