"use client";
import { Suspense, useState } from "react";
import { Banknote, HandCoins, Rows3, Users, Wallet } from "lucide-react";
import { Button, EmptyState, ErrorState, PageHeader, PageLoading, Section, Stat, StatGrid } from "@/components/ui";
import { useApi, useUrlState } from "@/components/ui/data";
import { COD_KEY, REMITTANCES_KEY, ReceiveCashDialog, holdersOf, type CodOverview } from "@/components/features/business-cod";
import { AllOrdersTable } from "@/components/features/business-cod-all";
import { HistoryTable, type RemittancePage } from "@/components/features/business-cod-history";
import { HolderOrders } from "@/components/features/business-cod-parts";
import { ViewToggle } from "@/components/features/fin-sort-table";
import { fmtMoney, fmtNum } from "@/lib/format";
import { useI18n } from "@/i18n/provider";

/** `/business/cash`: what drivers hold of the company's cash — by driver (default) or as one table of all orders (`?view=table`); and the hand-over history. Warehouse and office columns on every table (J6). */
function CashView() {
  const { t, locale } = useI18n();
  const cod = useApi<CodOverview>(COD_KEY, { refreshInterval: 30000 });
  const [page, setPage] = useState(1);
  const hist = useApi<RemittancePage>(`${REMITTANCES_KEY}?page=${page}`, { keepPreviousData: true });
  const [dlg, setDlg] = useState<null | { offerId?: string; driverId?: string }>(null);
  const [viewRaw, setView] = useUrlState("view");
  const view = viewRaw === "table" ? "table" : "driver";

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

      <div className="mb-4"><ViewToggle label={t("cdc.view")} testId="cod-view" value={view} onChange={(k) => setView(k === "table" ? "table" : "")}
        options={[{ key: "driver", label: t("cdc.view_driver"), icon: <Users className="size-4" aria-hidden /> }, { key: "table", label: t("cdc.view_table"), icon: <Rows3 className="size-4" aria-hidden /> }]} /></div>

      {view === "table" ? (
        <div className="mb-6"><AllOrdersTable data={cod.data} onReceive={(offerId, driverId) => setDlg({ offerId, driverId })} /></div>
      ) : (
        <section aria-labelledby="holders-h" className="mb-6">
          <h2 id="holders-h" className="mb-3 font-semibold">{t("fob.cash_holders")}</h2>
          {holders.length === 0 ? (
            <EmptyState icon={<Banknote className="size-9" aria-hidden />} title={nothing ? t("fob.cash_none_title") : t("fob.cash_all_settled")} hint={nothing ? t("fob.cash_none_hint") : t("fob.cash_all_settled_hint")} />
          ) : (
            <ul className="space-y-4" data-testid="cod-holders">
              {holders.map((d) => (
                <li key={d.driverId} data-testid="cod-driver" data-driver={d.driverId}>
                  <Section flush title={d.driverName}
                    description={<span className="flex flex-col gap-0.5">{d.phoneMasked && <span className="ltr-num" dir="ltr">{d.phoneMasked}</span>}<span data-testid="cod-driver-office">{d.officeId ? t("cdc.office_line", { name: d.officeName ?? "—" }) : t("cdc.independent")}</span></span>}
                    actions={<>
                      <div className="text-end"><p className="text-xs text-muted">{t("fob.cash_outstanding")}</p><p className="ltr-num text-lg font-bold tabular-nums text-gold" data-testid="cod-driver-outstanding">{fmtMoney(d.outstandingCents, locale)}</p></div>
                      <Button size="sm" onClick={() => setDlg({ driverId: d.driverId })} data-testid="cod-driver-receive"><HandCoins className="size-4" aria-hidden />{t("fob.rcv_short")}</Button>
                    </>}>
                    <HolderOrders driver={d} onReceive={(offerId) => setDlg({ offerId, driverId: d.driverId })} />
                  </Section>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      <Section title={t("fob.cash_history")} flush id="history">
        {hist.error ? <div className="p-5"><ErrorState error={hist.error} retry={() => hist.mutate()} /></div> : !hist.data ? <div className="p-5"><PageLoading /></div> : hist.data.items.length === 0 ? (
          <div className="p-5"><EmptyState title={t("fob.cash_history_empty")} hint={t("fob.cash_history_empty_hint")} /></div>
        ) : <HistoryTable data={hist.data} page={page} onPage={setPage} />}
      </Section>

      {dlg && <ReceiveCashDialog offerId={dlg.offerId} driverId={dlg.driverId} onClose={() => setDlg(null)} onDone={() => { void cod.mutate(); void hist.mutate(); }} />}
    </>
  );
}

export default function CashPage() { return <Suspense fallback={<PageLoading />}><CashView /></Suspense>; }
