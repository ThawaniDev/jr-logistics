"use client";
import { useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { mutate as refreshGlobal } from "swr";
import { ArrowDownToLine, Banknote, ChevronRight, CircleCheck, Coins, Hourglass, Landmark, PauseCircle, PiggyBank, ShieldCheck, SlidersHorizontal, Wallet } from "lucide-react";
import { Button, CellPair, EmptyState, ErrorState, Notice, PageHeader, PageLoading, Section, Stat, StatGrid, Table, Td } from "@/components/ui";
import { useApi } from "@/components/ui/data";
import { cn } from "@/lib/cn";
import { fmtDateTime, fmtMoney } from "@/lib/format";
import { useI18n } from "@/i18n/provider";
import { hasPerm, useUser } from "@/components/layout/auth-context";
import { hasAny, relTime, useTx } from "./admin-common";
import { AdjustModal } from "./admin-finance";
import { Delta } from "./admin-finance-ledger";
import { ListSkeleton, Money, NoAccess, partyHref } from "./admin-finance-parts";
import { SettleBadge } from "./admin-finance-settlements";

const CHIP = { gold: "bg-gold/10 text-gold", cyan: "bg-cyan/10 text-cyan", accent: "bg-accent/10 text-accent", danger: "bg-danger/10 text-danger" } as const;

/** One thing that waits for someone: icon, what and how many, why it matters, and the page where it is handled. */
function Attention({ href, icon, tone, title, hint, testid }: { href: string; icon: ReactNode; tone: keyof typeof CHIP; title: string; hint?: ReactNode; testid: string }) {
  return (
    <Link href={href} data-testid={testid} className="flex items-center gap-3 rounded-xl border border-line bg-bg2/40 p-3 transition hover:border-accent/40 hover:bg-bg2">
      <span className={cn("flex size-10 shrink-0 items-center justify-center rounded-xl", CHIP[tone])} aria-hidden>{icon}</span>
      <span className="min-w-0 flex-1"><span className="block font-medium">{title}</span>{hint && <span className="block text-xs text-muted">{hint}</span>}</span>
      <ChevronRight className="size-4 shrink-0 text-muted rtl:rotate-180" aria-hidden />
    </Link>
  );
}

const ViewAll = ({ href }: { href: string }) => { const { t } = useI18n(); return <Link href={href} className="text-sm text-accent hover:underline">{t("common.view_all")}</Link>; };

/** The Finance start page: platform money at a glance, what needs a decision, and the latest settlements and wallet movements. */
export function FinanceOverview() {
  const { t, locale } = useI18n(); const me = useUser(); const router = useRouter(); const tx = useTx();
  const canView = hasPerm(me, "finance.view");
  // A reviewer without `finance.view` used to land on this URL; send them to the first finance page they may open.
  const home = hasAny(me, "settlements.review") ? "/admin/finance/settlements" : hasAny(me, "withdrawals.manage") ? "/admin/finance/withdrawals" : hasAny(me, "wallets.view") ? "/admin/finance/ledger" : hasAny(me, "cod.manage") ? "/admin/finance/cod" : hasAny(me, "pricing.view", "pricing.edit") ? "/admin/finance/pricing" : null;
  useEffect(() => { if (!canView && home) router.replace(home); }, [canView, home, router]);
  const ov = useApi(canView ? "/admin/finance/overview" : null, { shouldRetryOnError: false });
  const recentS = useApi(canView ? "/admin/finance/settlements?pageSize=6" : null, { shouldRetryOnError: false });
  const recentL = useApi(canView ? "/admin/finance/ledger?pageSize=8" : null, { shouldRetryOnError: false });
  const [adjust, setAdjust] = useState(false);
  if (!canView) return home ? <PageLoading /> : <NoAccess title={t("nav.finance")} />;
  const s = ov.data; const money = (c: number) => fmtMoney(c, locale);
  const att: ReactNode[] = [];
  if (s) {
    if (s.withdrawals.pendingN > 0) att.push(<Attention key="wd" testid="fin-att-withdrawals" href="/admin/finance/withdrawals" icon={<ArrowDownToLine className="size-5" />} tone="gold" title={t("rdf.att_withdrawals", { n: s.withdrawals.pendingN })} hint={t("rdf.att_withdrawals_hint", { amount: money(s.withdrawals.pendingCents), ago: relTime(s.withdrawals.oldestAt, locale) })} />);
    if (s.settlements.heldN > 0) att.push(<Attention key="held" testid="fin-att-held" href="/admin/finance/settlements?status=hold" icon={<PauseCircle className="size-5" />} tone="gold" title={t("rdf.att_held", { n: s.settlements.heldN })} hint={t("foa.fin_hold_hint")} />);
    if (s.settlements.waitingN > 0) att.push(<Attention key="wait" testid="fin-att-waiting" href="/admin/finance/settlements" icon={<Hourglass className="size-5" />} tone="cyan" title={t("rdf.att_waiting", { n: s.settlements.waitingN })} hint={t("rdf.att_waiting_hint")} />);
    if (s.cod.drivers > 0) att.push(<Attention key="cod" testid="fin-att-cod" href="/admin/finance/cod?view=drivers" icon={<Coins className="size-5" />} tone="gold" title={t("rdf.att_cod", { n: s.cod.drivers })} hint={t("rdf.att_cod_hint", { amount: money(s.cod.outstandingCents), names: s.cod.top.map((d: any) => `${d.driverName} ${money(d.outstandingCents)}`).join(" · ") })} />);
  }
  const refresh = () => { void ov.mutate(); void recentL.mutate(); void refreshGlobal("/admin/stats"); };
  return (
    <>
      <PageHeader title={t("nav.finance")} subtitle={t("foa.fin_sub")} icon={<Banknote className="size-5" />}
        actions={hasAny(me, "wallet.adjust", "refunds.manage") && <Button variant="secondary" data-testid="fin-adjust-open" onClick={() => setAdjust(true)}><SlidersHorizontal className="size-4" aria-hidden />{t("adm.adjust")}</Button>} />
      {ov.error ? <div className="mb-5"><ErrorState error={ov.error} retry={() => ov.mutate()} /></div> : (
        <div className="mb-5"><StatGrid cols={3}>
          <Stat label={t("fin.platform_revenue")} value={s && <Money c={s.platformRevenueCents} />} hint={t("rdf.paid_settlements_n", { n: s?.paidSettlements ?? 0 })} icon={<Landmark className="size-5" />} tone="accent" loading={!s} href="/admin/finance/settlements?status=paid" />
          <Stat label={t("foa.fin_on_hold")} value={s && <span data-testid="foa-fin-on-hold"><Money c={s.settlements.heldCents} /></span>} hint={t("rdf.settlements_n", { n: s?.settlements.heldN ?? 0 })} icon={<PauseCircle className="size-5" />} tone={s && s.settlements.heldN > 0 ? "gold" : "muted"} loading={!s} href="/admin/finance/settlements?status=hold" />
          <Stat label={t("fin.escrow")} value={s && <Money c={s.balances.reservedCents} />} hint={t("wallet.reserved_hint")} icon={<ShieldCheck className="size-5" />} tone="cyan" loading={!s} href="/admin/finance/ledger?kind=reserve" />
          <Stat label={t("fin.wallet_liability")} value={s && <Money c={s.balances.availableCents + s.balances.heldCents} />} hint={t("rdf.liability_hint")} icon={<PiggyBank className="size-5" />} tone="muted" loading={!s} href="/admin/finance/ledger" />
          <Stat label={t("admin.pending_withdrawals")} value={s && <Money c={s.withdrawals.pendingCents} />} hint={t("rdf.requests_n", { n: s?.withdrawals.pendingN ?? 0 })} icon={<ArrowDownToLine className="size-5" />} tone={s && s.withdrawals.pendingN > 0 ? "gold" : "muted"} loading={!s} href="/admin/finance/withdrawals" />
          <Stat label={t("rdf.cod_with_drivers")} value={s && <Money c={s.cod.outstandingCents} />} hint={t("rdf.cod_drivers_orders", { drivers: s?.cod.drivers ?? 0, orders: s?.cod.orders ?? 0 })} icon={<Wallet className="size-5" />} tone={s && s.cod.outstandingCents > 0 ? "gold" : "muted"} loading={!s} href="/admin/finance/cod" />
        </StatGrid></div>)}
      <div className="mb-5 grid gap-4 lg:grid-cols-3">
        <Section title={t("rdf.att_title")} description={t("rdf.att_sub")} className="lg:col-span-2">
          {!s ? (ov.error ? <p className="text-sm text-muted">{t("uxa.load_failed")}</p> : <ListSkeleton rows={2} />) : att.length === 0
            ? <div data-testid="fin-att-clear" className="flex items-center gap-3 rounded-xl border border-accent/30 bg-accent/5 p-3"><span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-accent/10 text-accent" aria-hidden><CircleCheck className="size-5" /></span><div><p className="font-medium">{t("rdf.att_clear")}</p><p className="text-xs text-muted">{t("rdf.att_clear_hint")}</p></div></div>
            : <div className="space-y-2.5">{att}</div>}
        </Section>
        <div className="space-y-3">
          <Notice tone="info" title={t("foa.fin_auto_title")}><span data-testid="foa-fin-auto-notice">{t("foa.fin_auto_banner")}</span></Notice>
          <Notice tone="warn">{t("fin.simulated_note")}</Notice>
        </div>
      </div>
      <div className="space-y-5">
        <Section flush title={t("rdf.recent_settlements")} actions={<ViewAll href="/admin/finance/settlements" />}>
          {recentS.error ? <div className="p-4"><ErrorState error={recentS.error} retry={() => recentS.mutate()} /></div> : !recentS.data ? <div className="p-4"><ListSkeleton rows={3} /></div> : recentS.data.items.length === 0 ? <div className="p-4"><EmptyState title={t("fin.none")} hint={t("foa.fin_history_note")} /></div> : (
            <Table bare stack dense label={t("rdf.recent_settlements")} head={[t("foa.cod_order"), t("role.business"), t("adm.col_driver"), { label: t("fin.provider"), align: "end" }, { label: t("admin.margin"), align: "end" }, t("common.status")]}>
              {recentS.data.items.map((x: any) => (
                <tr key={x.id} data-testid={`fin-recent-settlement-${x.id}`}>
                  <Td label={t("foa.cod_order")}><CellPair href={`/admin/requests/${x.requestId}`} title={<span className="ltr-num font-semibold">{x.ref}</span>} sub={<span className="whitespace-nowrap">{fmtDateTime(x.createdAt, locale)}</span>} /></Td>
                  <Td label={t("role.business")}>{x.businessName ? <CellPair href={partyHref("business", x.businessId)} title={x.businessName} /> : "—"}</Td>
                  <Td label={t("adm.col_driver")}><CellPair href={partyHref("driver", x.driverId)} title={x.driverName} sub={x.officeName ?? t("adm.direct")} /></Td>
                  <Td label={t("fin.provider")} num><Money c={x.providerCents} /></Td>
                  <Td label={t("admin.margin")} num className="text-gold"><Money c={x.marginCents} /></Td>
                  <Td label={t("common.status")}><SettleBadge x={x} /></Td>
                </tr>))}
            </Table>)}
        </Section>
        <Section flush title={t("rdf.recent_ledger")} actions={<ViewAll href="/admin/finance/ledger" />}>
          {recentL.error ? <div className="p-4"><ErrorState error={recentL.error} retry={() => recentL.mutate()} /></div> : !recentL.data ? <div className="p-4"><ListSkeleton rows={3} /></div> : recentL.data.items.length === 0 ? <div className="p-4"><EmptyState title={t("wallet.no_entries")} /></div> : (
            <Table bare stack dense label={t("rdf.recent_ledger")} head={[t("common.date"), t("adm.owner"), t("wallet.type"), { label: t("wallet.available"), align: "end" }, t("rdf.ledger_request")]}>
              {recentL.data.items.map((e: any) => (
                <tr key={e.id}>
                  <Td label={t("common.date")} className="whitespace-nowrap text-muted">{fmtDateTime(e.createdAt, locale)}</Td>
                  <Td label={t("adm.owner")}><CellPair href={partyHref(e.ownerRole, e.ownerId)} title={e.ownerRole === "platform" ? t("rdf.platform_account") : e.owner} sub={e.ownerRole === "platform" ? undefined : tx(`role.${e.ownerRole}`, e.ownerRole)} /></Td>
                  <Td label={t("wallet.type")}>{tx(`ledger.${e.kind}`, e.kind)}</Td>
                  <Td label={t("wallet.available")} num><Delta c={e.availableDeltaCents} /></Td>
                  <Td label={t("rdf.ledger_request")} className="whitespace-nowrap">{e.requestId ? <Link href={`/admin/requests/${e.requestId}`} className="text-accent hover:underline">{t("rdf.ledger_open_request")}</Link> : "—"}</Td>
                </tr>))}
            </Table>)}
        </Section>
      </div>
      <AdjustModal open={adjust} onClose={() => setAdjust(false)} onDone={refresh} />
    </>
  );
}
