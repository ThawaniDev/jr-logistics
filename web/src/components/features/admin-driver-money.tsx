"use client";
import { useState, type ReactNode } from "react";
import Link from "next/link";
import { Banknote, Coins, HandCoins, Hourglass, Wallet } from "lucide-react";
import { Badge, EmptyState, ErrorState, Notice, PageLoading, Section, Segmented, Select, Stat, StatGrid, StatusBadge, Table, Td } from "@/components/ui";
import { useApi } from "@/components/ui/data";
import { fmtDate, fmtDateTime, fmtMoney } from "@/lib/format";
import { fmtDur } from "@/components/reports";
import { useI18n } from "@/i18n/provider";
import { useUser } from "@/components/layout/auth-context";
import { hasAny, qs, useTx } from "./admin-common";
import { LoadingRows, Money, pagerFooter } from "./admin-offices-common";

const SIZE = 10;
const LEDGER_KINDS = ["topup", "reserve", "release_reserve", "refund", "payout", "platform_fee", "withdrawal_hold", "withdrawal_paid", "withdrawal_release", "adjustment"];
type Cols = Array<string | { label: string; align?: "start" | "end"; srOnly?: boolean }>;

/** One paged money list (`GET <base>/money/<part>`): loading rows, an empty state, a pager and an optional filter in the toolbar. */
function MoneyList({ base, part, title, sub, head, row, filter, params, emptyTitle, emptyHint, testId }: {
  base: string; part: string; title: string; sub?: string; head: Cols; row: (r: any) => ReactNode; filter?: ReactNode; params?: Record<string, string>; emptyTitle: string; emptyHint?: string; testId: string;
}) {
  const [page, setPage] = useState(1);
  const { data, error, mutate } = useApi(`${base}/money/${part}${qs({ ...params, page, pageSize: SIZE })}`, { keepPreviousData: true });
  const loading = !data && !error; const rows: any[] = data?.items ?? [];
  if (error && !data) return <ErrorState error={error} retry={() => mutate()} />;
  return (
    <div data-testid={testId}><Section title={title} description={sub} flush actions={filter}>
      <Table stack bare dense label={title} head={head} footer={data ? pagerFooter(page, data.total, SIZE, setPage) : undefined}
        empty={!loading && rows.length === 0 ? <div className="p-4"><EmptyState title={emptyTitle} hint={emptyHint} /></div> : undefined}>
        {loading ? <LoadingRows cols={head.length} rows={3} /> : rows.map(row)}
      </Table>
    </Section></div>
  );
}

/**
 * Money of a driver (`kind = driver`) or a courier office (`kind = office`): balances, the earnings pipeline by settlement status, the wallet ledger, settlements,
 * withdrawals and, for drivers, the cash on delivery they hold (orders and hand-overs). Each part appears only for staff whose role may read it.
 */
export function MoneyPanel({ id, kind }: { id: string; kind: "driver" | "office" }) {
  const { t, locale } = useI18n(); const me = useUser(); const tx = useTx(); const base = `/admin/${kind}s/${id}`;
  const canCod = kind === "driver" && hasAny(me, "cod.manage", "finance.view"); const canWallet = kind === "driver" ? hasAny(me, "finance.view", "wallets.view") : hasAny(me, "offices.view", "offices.manage", "finance.view", "wallets.view", "settlements.review");
  const sum = useApi(canWallet || canCod ? `${base}/money` : null); const ov = useApi(kind === "driver" ? `/admin/drivers/${id}/overview` : null);
  const [stStatus, setStStatus] = useState("all"); const [kindF, setKindF] = useState("");
  if (!canWallet && !canCod) return <Notice tone="warn">{t("rdq.no_access")}</Notice>;
  if (sum.error) return <ErrorState error={sum.error} retry={() => sum.mutate()} />;
  if (!sum.data) return <PageLoading />;
  const { wallet, earnings: e, pipeline, withdrawals: w, cod } = sum.data; const canRequest = hasAny(me, "requests.view");
  const orderLink = (rid: string | null, ref: string | null) => (ref ? (canRequest && rid ? <Link href={`/admin/requests/${rid}`} className="ltr-num font-semibold text-accent hover:underline">{ref}</Link> : <span className="ltr-num font-semibold">{ref}</span>) : <span className="text-muted">—</span>);
  const settleHead: Cols = [t("req.ref"), ...(kind === "office" ? [t("adm.col_driver")] : []), { label: t("rdq.col_units"), align: "end" }, { label: t("common.amount"), align: "end" }, t("common.status"), t("common.date"), t("office.paid_on"), t("dv2.col_batch")];
  return (
    <div className="space-y-5" data-testid={`dv2-money-${kind}`}>
      {ov.data?.officeId && <Notice tone="info">{t("rdq.earnings_to_office", { office: ov.data.office ?? "" })}</Notice>}
      {kind === "driver" && hasAny(me, "finance.view") && <p className="text-sm"><Link href={`/admin/finance/drivers/${id}`} className="font-semibold text-accent hover:underline" data-testid="fdr-open-finance">{t("fdr.open_finance")}</Link></p>}
      {wallet && e && (
        <section aria-label={t("rdq.wallet_title")}>
          <StatGrid cols={4}>
            <Stat label={t("wallet.available")} value={<Money cents={wallet.availableCents} />} icon={<Wallet className="size-5" />} tone="accent" hint={wallet.creditLimitCents ? t("dv2.credit_limit", { amount: fmtMoney(wallet.creditLimitCents, locale) }) : undefined} />
            <Stat label={t("wallet.held")} value={<Money cents={wallet.heldCents} />} hint={t("wallet.held_hint")} tone={wallet.heldCents ? "gold" : "muted"} />
            <Stat label={t("rdq.earnings_paid")} value={<Money cents={e.paidCents} />} icon={<Banknote className="size-5" />} tone="cyan" hint={kind === "driver" && e.viaOfficeCents ? t("rdq.via_office_paid", { amount: fmtMoney(e.viaOfficeCents, locale) }) : t("dv2.n_settlements_paid", { n: e.paidCount })} />
            <Stat label={t("rdq.earnings_pending")} value={<Money cents={e.pendingCents} />} icon={<Hourglass className="size-5" />} tone={e.pendingCents ? "gold" : "muted"} hint={t("dv2.n_settlements_pending", { n: e.pendingCount })} />
          </StatGrid>
          <p className="mt-2 text-xs text-muted">{e.avgPayoutSeconds != null ? t("dv2.avg_payout", { t: fmtDur(e.avgPayoutSeconds, locale) }) : t("dv2.avg_payout_none")}{e.lastPaidAt && <> · {t("dv2.last_paid", { d: fmtDate(e.lastPaidAt, locale) })}</>}{w && <> · {t("dv2.withdrawals_summary", { n: w.total, pending: w.pendingCount })}</>}</p>
        </section>
      )}
      {pipeline && pipeline.length > 0 && (
        <Section title={t("dv2.pipeline")} description={t("dv2.pipeline_sub")} flush>
          <Table stack bare dense label={t("dv2.pipeline")} head={[t("common.status"), { label: t("dv2.col_count"), align: "end" }, { label: t("common.amount"), align: "end" }, t("dv2.col_oldest")]}>
            {pipeline.map((p: any) => (
              <tr key={p.status} data-testid={`dv2-pipe-${p.status}`}>
                <Td><StatusBadge status={p.status === "batch_ready" ? "approved" : p.status} /></Td><Td label={t("dv2.col_count")} num>{p.count}</Td><Td label={t("common.amount")} align="end"><Money cents={p.cents} /></Td>
                <Td label={t("dv2.col_oldest")} className="text-muted">{p.oldestAt ? fmtDate(p.oldestAt, locale) : "—"}</Td>
              </tr>
            ))}
          </Table>
        </Section>
      )}
      {canWallet && <MoneyList key={`st-${stStatus}`} base={base} part="settlements" title={t("dv2.settlements_title")} sub={t("dv2.settlements_sub")} testId="dv2-settlements" params={{ status: stStatus === "all" ? "" : stStatus }} head={settleHead}
        filter={<Segmented label={t("dv2.settlements_title")} value={stStatus} onChange={setStStatus} options={[["all", t("common.all")], ["pending", t("rdq.payout_pending")], ["paid", t("status.paid")], ["rejected", t("status.rejected")]].map(([key, label]) => ({ key, label }))} />}
        emptyTitle={t("office.no_settlements")} emptyHint={t("rdq.payouts_none_hint")}
        row={(s) => (
          <tr key={s.id} data-testid={`rdq-payout-${s.id}`}>
            <Td>{orderLink(s.requestId, s.ref)}</Td>
            {kind === "office" && <Td label={t("adm.col_driver")}><Link href={`/admin/drivers/${s.driverId}`} className="text-accent hover:underline">{s.driver}</Link></Td>}
            <Td label={t("rdq.col_units")} num>{s.finalUnits}</Td><Td label={t("common.amount")} align="end"><Money cents={s.amountCents} />{s.adjustmentCents !== 0 && <span className="block text-xs text-muted">{t("dv2.adjusted")}</span>}</Td>
            <Td label={t("common.status")}><StatusBadge status={s.status === "batch_ready" ? "approved" : s.status} /></Td><Td label={t("common.date")} className="whitespace-nowrap text-muted">{fmtDate(s.createdAt, locale)}</Td>
            <Td label={t("office.paid_on")} className="whitespace-nowrap text-muted">{s.paidAt ? fmtDate(s.paidAt, locale) : "—"}</Td><Td label={t("dv2.col_batch")} className="text-muted"><span className="ltr-num">{s.batch ?? "—"}</span></Td>
          </tr>
        )} />}
      {canWallet && <MoneyList key={`lg-${kindF}`} base={base} part="ledger" title={t("wallet.history")} sub={t("dv2.ledger_sub")} testId="dv2-ledger" params={{ kind: kindF }} head={[t("wallet.type"), { label: t("common.amount"), align: "end" }, t("adm.note"), t("req.ref"), t("dv2.col_by"), t("common.date")]}
        filter={<div className="w-48"><Select aria-label={t("wallet.type")} value={kindF} onChange={(ev) => setKindF(ev.target.value)} options={[{ value: "", label: t("dv2.any_type") }, ...LEDGER_KINDS.map((k) => ({ value: k, label: tx(`ledger.${k}`, k) }))]} /></div>}
        emptyTitle={t("wallet.no_entries")}
        row={(l) => (
          <tr key={l.id}>
            <Td>{tx(`ledger.${l.kind}`, l.kind)}{l.simulated && <Badge className="ms-2">{t("wallet.simulated")}</Badge>}</Td>
            <Td label={t("common.amount")} align="end"><span className={l.availableDeltaCents < 0 ? "text-danger" : l.availableDeltaCents > 0 ? "text-accent" : undefined}><Money cents={l.availableDeltaCents || l.heldDeltaCents || l.reservedDeltaCents} /></span></Td>
            <Td label={t("adm.note")} className="max-w-72 truncate text-muted">{l.note ?? "—"}</Td><Td label={t("req.ref")}>{orderLink(l.requestId, l.ref)}</Td>
            <Td label={t("dv2.col_by")} className="text-muted">{l.actor ?? t("dv2.system")}</Td><Td label={t("common.date")} className="whitespace-nowrap text-muted">{fmtDateTime(l.at, locale)}</Td>
          </tr>
        )} />}
      {canWallet && <MoneyList base={base} part="withdrawals" title={t("wallet.withdrawals")} testId="dv2-withdrawals" head={[{ label: t("common.amount"), align: "end" }, t("dv2.col_bank"), t("common.status"), t("dv2.col_decided"), t("dv2.col_payment_ref"), t("dv2.col_requested")]} emptyTitle={t("dv2.withdrawals_none")}
        row={(x) => (
          <tr key={x.id}>
            <Td label={t("common.amount")} align="end"><Money cents={x.amountCents} /></Td><Td label={t("dv2.col_bank")}>{x.bank ?? "—"}{x.ibanTail && <div className="ltr-num text-xs text-muted">•••• {x.ibanTail}</div>}</Td>
            <Td label={t("common.status")}><StatusBadge status={x.status} /></Td><Td label={t("dv2.col_decided")} className="text-muted">{x.decidedAt ? fmtDate(x.decidedAt, locale) : "—"}{x.decidedBy && <span className="block text-xs">{x.decidedBy}</span>}</Td>
            <Td label={t("dv2.col_payment_ref")} className="ltr-num text-muted">{x.paymentRef ?? "—"}</Td><Td label={t("dv2.col_requested")} className="whitespace-nowrap text-muted">{fmtDate(x.createdAt, locale)}</Td>
          </tr>
        )} />}
      {canCod && cod && (
        <>
          <section aria-label={t("rdq.cash_title")}>
            <StatGrid cols={3}>
              <Stat label={t("foa.cod_collected")} value={<Money cents={cod.collectedCents} />} icon={<Coins className="size-5" />} tone="cyan" hint={t("dv2.cod_orders_n", { n: cod.orders })} />
              <Stat label={t("rdq.cash_handed")} value={<Money cents={cod.receivedCents} />} tone="accent" />
              <Stat label={t("rdq.cash_held")} value={<Money cents={cod.outstandingCents} />} icon={<HandCoins className="size-5" />} tone={cod.outstandingCents ? "gold" : "muted"} hint={cod.heldLongCents ? t("dv2.cod_held_long", { amount: fmtMoney(cod.heldLongCents, locale) }) : cod.outstandingCents ? t("rdq.cash_held_hint") : t("foa.cod_nothing_outstanding")} />
            </StatGrid>
          </section>
          <MoneyList base={base} part="cod" title={t("rdq.cash_title")} testId="dv2-cod" head={[t("req.ref"), t("office.business"), { label: t("rdq.col_parcels"), align: "end" }, { label: t("foa.cod_collected"), align: "end" }, { label: t("rdq.cash_handed"), align: "end" }, { label: t("foa.cod_outstanding"), align: "end" }, t("common.date")]}
            emptyTitle={t("foa.cod_empty")} emptyHint={t("foa.cod_empty_hint")}
            row={(o) => (
              <tr key={o.offerId}>
                <Td>{orderLink(o.requestId, o.ref)}</Td><Td label={t("office.business")}>{o.businessName ?? "—"}</Td><Td label={t("rdq.col_parcels")} num>{o.parcels}</Td>
                <Td label={t("foa.cod_collected")} align="end"><Money cents={o.collectedCents} /></Td><Td label={t("rdq.cash_handed")} align="end"><Money cents={o.receivedCents} /></Td>
                <Td label={t("foa.cod_outstanding")} align="end">{o.outstandingCents > 0 ? <span className="font-semibold text-gold"><Money cents={o.outstandingCents} />{o.ageDays != null && o.ageDays >= 3 && <Badge tone="warn" className="ms-2">{t("dv2.days_n", { n: o.ageDays })}</Badge>}</span> : <Money cents={0} />}</Td>
                <Td label={t("common.date")} className="whitespace-nowrap text-muted">{o.lastCollectedAt ? fmtDate(o.lastCollectedAt, locale) : "—"}</Td>
              </tr>
            )} />
          <MoneyList base={base} part="remittances" title={t("dv2.remittances")} sub={t("dv2.remittances_sub")} testId="dv2-remittances" head={[t("dv2.col_ref"), t("req.ref"), { label: t("common.amount"), align: "end" }, t("dv2.col_received_by"), t("adm.note"), t("common.date")]} emptyTitle={t("dv2.remittances_none")}
            row={(r) => (
              <tr key={r.id}>
                <Td><span className="ltr-num font-semibold">{r.ref}</span></Td><Td label={t("req.ref")}>{orderLink(r.requestId, r.orderRef)}</Td><Td label={t("common.amount")} align="end"><Money cents={r.amountCents} /></Td>
                <Td label={t("dv2.col_received_by")}>{r.receivedByName}<span className="block text-xs text-muted">{t(`role.${r.receivedByRole}`)}</span></Td><Td label={t("adm.note")} className="max-w-64 truncate text-muted">{r.note ?? "—"}</Td>
                <Td label={t("common.date")} className="whitespace-nowrap text-muted">{fmtDateTime(r.createdAt, locale)}</Td>
              </tr>
            )} />
        </>
      )}
    </div>
  );
}

/** Driver "Wallet & cash" tab (`/admin/drivers/:id/wallet`). */
export function DriverMoneyTab({ id }: { id: string }) { return <MoneyPanel id={id} kind="driver" />; }
