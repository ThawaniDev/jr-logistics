"use client";
import { useState } from "react";
import Link from "next/link";
import { Banknote, HandCoins, Users, Wallet } from "lucide-react";
import { Badge, Button, EmptyState, ErrorState, PageHeader, PageLoading, Pagination, Section, Stat, StatGrid, Table, Td } from "@/components/ui";
import { useApi } from "@/components/ui/data";
import { COD_KEY, REMITTANCES_KEY, ReceiveCashDialog, holdersOf, type CodOverview } from "@/components/features/business-cod";
import { fmtDateTime, fmtMoney, fmtNum } from "@/lib/format";
import { cn } from "@/lib/cn";
import { useI18n } from "@/i18n/provider";

interface Remittance { id: string; ref: string; orderRef?: string | null; requestId?: string | null; driverName: string; amountCents: number; note: string | null; receivedByName: string | null; receivedByRole: string | null; createdAt: string }
interface RemittancePage { items: Remittance[]; page: number; pageSize: number; total: number }

export default function CashPage() {
  const { t, locale } = useI18n();
  const cod = useApi<CodOverview>(COD_KEY, { refreshInterval: 30000 });
  const [page, setPage] = useState(1);
  const hist = useApi<RemittancePage>(`${REMITTANCES_KEY}?page=${page}`, { keepPreviousData: true });
  const [dlg, setDlg] = useState<null | { offerId?: string; driverId?: string }>(null);

  if (cod.error) return <ErrorState error={cod.error} retry={() => cod.mutate()} />;
  if (!cod.data) return <PageLoading />;
  const totals = cod.data.totals ?? { collectedCents: 0, receivedCents: 0, outstandingCents: 0 };
  const holders = holdersOf(cod.data);
  const nothing = (cod.data.drivers ?? []).length === 0 && totals.collectedCents === 0;

  return (
    <>
      <PageHeader title={t("nav.cash")} subtitle={t("fob.cash_sub")}
        actions={<Button onClick={() => setDlg({})} disabled={holders.length === 0} data-testid="cod-receive-open"><HandCoins className="size-4" aria-hidden />{t("fob.rcv_title")}</Button>} />

      <StatGrid cols={4} className="mb-6">
        <div data-testid="cod-total-collected"><Stat label={t("fob.cash_collected")} value={<span className="ltr-num">{fmtMoney(totals.collectedCents, locale)}</span>} hint={t("fob.cash_collected_hint")} icon={<Banknote className="size-5" />} tone="cyan" className="h-full" /></div>
        <div data-testid="cod-total-received"><Stat label={t("fob.cash_received")} value={<span className="ltr-num">{fmtMoney(totals.receivedCents, locale)}</span>} hint={t("fob.cash_received_hint")} icon={<Wallet className="size-5" />} className="h-full" /></div>
        <div data-testid="cod-total-outstanding"><Stat label={t("fob.cash_outstanding")} value={<span className="ltr-num">{fmtMoney(totals.outstandingCents, locale)}</span>} hint={t("fob.cash_outstanding_hint")} icon={<HandCoins className="size-5" />} tone={totals.outstandingCents > 0 ? "gold" : "muted"} className="h-full" /></div>
        <div data-testid="cod-total-holders"><Stat label={t("rdz.k_holders")} value={fmtNum(holders.length, locale)} hint={holders.length > 0 ? t("rdz.k_holders_hint") : t("fob.cash_all_settled")} icon={<Users className="size-5" />} tone={holders.length > 0 ? "gold" : "muted"} className="h-full" /></div>
      </StatGrid>

      <section aria-labelledby="holders-h" className="mb-6">
        <h2 id="holders-h" className="mb-3 font-semibold">{t("fob.cash_holders")}</h2>
        {holders.length === 0 ? (
          <EmptyState icon={<Banknote className="size-9" aria-hidden />} title={nothing ? t("fob.cash_none_title") : t("fob.cash_all_settled")} hint={nothing ? t("fob.cash_none_hint") : t("fob.cash_all_settled_hint")} />
        ) : (
          <ul className="space-y-4" data-testid="cod-holders">
            {holders.map((d) => (
              <li key={d.driverId} data-testid="cod-driver" data-driver={d.driverId}>
                <Section flush title={d.driverName} description={d.phoneMasked ? <span className="ltr-num" dir="ltr">{d.phoneMasked}</span> : undefined}
                  actions={<>
                    <div className="text-end"><p className="text-xs text-muted">{t("fob.cash_outstanding")}</p><p className="ltr-num text-lg font-bold tabular-nums text-gold" data-testid="cod-driver-outstanding">{fmtMoney(d.outstandingCents, locale)}</p></div>
                    <Button size="sm" onClick={() => setDlg({ driverId: d.driverId })} data-testid="cod-driver-receive"><HandCoins className="size-4" aria-hidden />{t("fob.rcv_short")}</Button>
                  </>}>
                  <Table bare stack label={t("fob.cash_orders_of", { name: d.driverName })} head={[t("req.ref"), { label: t("fob.cash_collected"), align: "end" }, { label: t("fob.cash_received"), align: "end" }, { label: t("fob.cash_outstanding"), align: "end" }, { label: t("common.open"), srOnly: true }]}>
                    {d.orders.map((o) => (
                      <tr key={o.offerId} data-testid="cod-order" data-offer={o.offerId}>
                        <Td label={t("req.ref")}><Link href={`/business/requests/${o.requestId}/money`} className="ltr-num font-semibold text-accent hover:underline">{o.ref}</Link></Td>
                        <Td label={t("fob.cash_collected")} num>{fmtMoney(o.collectedCents, locale)}</Td>
                        <Td label={t("fob.cash_received")} num className="text-muted">{fmtMoney(o.receivedCents, locale)}</Td>
                        <Td label={t("fob.cash_outstanding")} num className={cn("font-semibold", o.outstandingCents > 0 && "text-gold")}>{fmtMoney(o.outstandingCents, locale)}</Td>
                        <Td align="end"><Button size="sm" variant="secondary" onClick={() => setDlg({ offerId: o.offerId, driverId: d.driverId })} data-testid="cod-order-receive">{t("fob.rcv_short")}</Button></Td>
                      </tr>
                    ))}
                  </Table>
                </Section>
              </li>
            ))}
          </ul>
        )}
      </section>

      <Section title={t("fob.cash_history")} flush id="history">
        {hist.error ? <div className="p-5"><ErrorState error={hist.error} retry={() => hist.mutate()} /></div> : !hist.data ? <div className="p-5"><PageLoading /></div> : hist.data.items.length === 0 ? (
          <div className="p-5"><EmptyState title={t("fob.cash_history_empty")} hint={t("fob.cash_history_empty_hint")} /></div>
        ) : (
          <div data-testid="cod-history">
            <Table bare stack label={t("fob.cash_history")} head={[t("common.date"), t("req.ref"), t("fob.rcv_driver"), { label: t("fob.cash_amount"), align: "end" }, t("fob.cash_note"), t("fob.cash_by")]}>
              {hist.data.items.map((r) => (
                <tr key={r.id} data-testid="cod-history-row">
                  <Td label={t("common.date")} className="whitespace-nowrap text-muted">{fmtDateTime(r.createdAt, locale)}</Td>
                  <Td label={t("req.ref")}>{r.requestId ? <Link href={`/business/requests/${r.requestId}/money`} className="ltr-num font-semibold text-accent hover:underline">{r.orderRef ?? r.ref}</Link> : <span className="ltr-num font-semibold">{r.orderRef ?? r.ref}</span>}</Td>
                  <Td label={t("fob.rcv_driver")}>{r.driverName}</Td>
                  <Td label={t("fob.cash_amount")} num className="font-semibold text-accent">{fmtMoney(r.amountCents, locale)}</Td>
                  <Td label={t("fob.cash_note")} className="max-w-[260px] text-muted">{r.note || "—"}</Td>
                  <Td label={t("fob.cash_by")}>{r.receivedByName ?? "—"}{r.receivedByRole && <Badge className="ms-2">{t(`role.${r.receivedByRole}`)}</Badge>}</Td>
                </tr>
              ))}
            </Table>
            <div className="px-5 pb-4"><Pagination page={hist.data.page ?? page} total={hist.data.total} pageSize={hist.data.pageSize ?? 25} onPage={setPage} /></div>
          </div>
        )}
      </Section>

      {dlg && <ReceiveCashDialog offerId={dlg.offerId} driverId={dlg.driverId} onClose={() => setDlg(null)} onDone={() => { void cod.mutate(); void hist.mutate(); }} />}
    </>
  );
}
