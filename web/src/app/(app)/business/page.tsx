"use client";
import Link from "next/link";
import { BellRing, Clock, Coins, FilePlus2, Lock, PackageCheck, Wallet } from "lucide-react";
import { Button, ErrorState, PageHeader, PageLoading, Stat, StatGrid } from "@/components/ui";
import { useApi } from "@/components/ui/data";
import { WarehouseLocationNotice, useWarehouse } from "@/components/features/business-warehouse";
import type { CodOverview } from "@/components/features/business-cod";
import { AccountHealth, AttentionList, Checklist, ICONS as I, QuickActions, RecentOrders, WaitingOrders, type AttentionItem, type QuickLink, type Step } from "@/components/features/business-views-dashboard";
import { ACTIVE_STATUSES, LOW_BALANCE_CENTS, walletTone } from "@/components/features/business-views-lib";
import { fmtMoney, fmtNum } from "@/lib/format";
import { useI18n } from "@/i18n/provider";
import { useUser } from "@/components/layout/auth-context";

export default function BusinessDashboard() {
  const { t, locale } = useI18n(); const me = useUser();
  const ov = useApi("/business/overview"); const reqs = useApi("/requests?pageSize=6"); const wal = useApi("/wallet");
  const needs = useApi("/requests?needsAction=1&pageSize=5");
  const cash = useApi<CodOverview>("/business/cod", { shouldRetryOnError: false }); const wh = useWarehouse(); // cash is optional: the dashboard never waits for it or fails with it
  const nDrafts = ov.data?.requests?.draft ?? 0;
  const drafts = useApi(nDrafts > 0 ? "/requests?status=draft&pageSize=100" : null);
  const err = ov.error ?? reqs.error ?? wal.error;
  if (err) return <ErrorState error={err} retry={() => { ov.mutate(); reqs.mutate(); wal.mutate(); needs.mutate(); }} />;
  if (!ov.data || !reqs.data || !wal.data) return <PageLoading />;

  const r = ov.data.requests as Record<string, number>;
  const total = Object.values(r).reduce((a, b) => a + b, 0);
  const active = ACTIVE_STATUSES.reduce((a, k) => a + (r[k] ?? 0), 0);
  const status: string = ov.data.verificationStatus; const verified = status === "verified";
  const blocked = !!ov.data.requireVerification && !verified; // the platform setting decides whether verification gates publishing
  const available: number = wal.data.availableCents; const reserved: number = wal.data.reservedCents ?? 0;
  const pendingAttendance: number = ov.data.pendingAttendance ?? 0;
  const cashDue: number = cash.data?.totals?.outstandingCents ?? 0; const cashCollected: number = cash.data?.totals?.collectedCents ?? 0;
  const returnsPending: number = ov.data.returnsPending ?? 0;
  const needN: number = needs.data?.total ?? 0; const needIds = new Set<string>((needs.data?.items ?? []).map((x: any) => x.id));
  const delivered = ov.data.parcels ?? { deliveredToday: 0, deliveredWeek: 0 };
  const draftSum: number = (drafts.data?.items ?? []).reduce((a: number, x: any) => a + (x.totalCents ?? 0), 0);
  const shortfall = Math.max(0, draftSum - available);

  const items: AttentionItem[] = [];
  if (!verified) {
    const bad = status === "rejected" || status === "suspended";
    items.push({ key: "verify", tone: bad ? "danger" : ov.data.requireVerification ? "warn" : "info", icon: <I.verify className="size-5" aria-hidden />, text: `${t(`verify.${status}_title`)} — ${t(`verify.${status}_body`)}`, href: "/business/documents", cta: t("verify.go_documents") });
  }
  if (pendingAttendance > 0) items.push({ key: "att", tone: "warn", icon: <I.attendance className="size-5" aria-hidden />, text: t("bz.pending_attendance", { n: pendingAttendance }), href: "/business/requests?status=action", cta: t("bz.review_requests") });
  if (wh.missing && wh.geofence) items.push({ key: "wh", tone: "warn", icon: <I.warehouse className="size-5" aria-hidden />, text: t("fob.wh_missing_dash"), href: "/business/profile#warehouse", cta: t("fob.wh_set_now") });
  if (cashDue > 0) items.push({ key: "cash", tone: "info", icon: <I.cash className="size-5" aria-hidden />, text: t("fob.dash_cash_due", { amount: fmtMoney(cashDue, locale) }), href: "/business/cash", cta: t("fob.dash_cash_cta") });
  if (returnsPending > 0) items.push({ key: "ret", tone: "danger", icon: <I.returns className="size-5" aria-hidden />, text: t("ubz.returns_pending", { n: returnsPending }), href: "/business/requests?status=active", cta: t("bz.review_requests") });
  if (nDrafts > 0) {
    items.push(shortfall > 0
      ? { key: "draft", tone: "warn", icon: <I.drafts className="size-5" aria-hidden />, text: t("ubz.drafts_short", { n: nDrafts, total: fmtMoney(draftSum, locale), short: fmtMoney(shortfall, locale) }), href: "/business/wallet", cta: t("wallet.topup") }
      : { key: "draft", tone: "info", icon: <I.drafts className="size-5" aria-hidden />, text: t("ubz.drafts_waiting", { n: nDrafts }), href: "/business/requests?status=draft", cta: t("ubz.finish_drafts") });
  } else if (available < LOW_BALANCE_CENTS && total > 0) {
    items.push({ key: "low", tone: "info", icon: <I.wallet className="size-5" aria-hidden />, text: t("ubz.low_balance", { amount: fmtMoney(available, locale) }), href: "/business/wallet", cta: t("wallet.topup") });
  }

  const fresh = total === 0;
  const steps: Step[] = [
    { done: verified, title: t("ubz.step_verify"), hint: t("ubz.step_verify_hint"), href: "/business/documents", cta: t("verify.go_documents") },
    { done: available > 0 || reserved > 0 || (wal.data.total ?? 0) > 0, title: t("ubz.step_topup"), hint: t("ubz.step_topup_hint"), href: "/business/wallet", cta: t("wallet.topup") },
    { done: false, title: t("ubz.step_request"), hint: t("ubz.step_request_hint"), href: "/business/requests/new", cta: t("nav.new_request"), disabled: blocked },
  ];
  const quick: QuickLink[] = [
    { key: "new", href: "/business/requests/new", icon: <I.order className="size-5" />, label: t("nav.new_request"), hint: t("rdz.quick_new_hint"), disabled: blocked },
    { key: "topup", href: "/business/wallet", icon: <I.wallet className="size-5" />, label: t("wallet.topup"), hint: t("rdz.quick_topup_hint", { amount: fmtMoney(available, locale) }) },
    { key: "cash", href: "/business/cash", icon: <I.cash className="size-5" />, label: t("fob.rcv_title"), hint: cashDue > 0 ? t("fob.dash_cash_due", { amount: fmtMoney(cashDue, locale) }) : t("rdz.quick_cash_hint") },
    { key: "docs", href: "/business/documents", icon: <I.docs className="size-5" />, label: t("nav.documents"), hint: t("rdz.quick_docs_hint") },
    { key: "int", href: "/business/integrations", icon: <I.plug className="size-5" />, label: t("nav.integrations"), hint: t("rdz.quick_int_hint") },
  ];

  return (
    <>
      <PageHeader title={t("biz.welcome", { name: me.name })} subtitle={t("biz.sub")} actions={<Link href="/business/requests/new" aria-disabled={blocked} className={blocked ? "pointer-events-none" : undefined} tabIndex={blocked ? -1 : undefined}><Button disabled={blocked} data-testid="dash-new"><FilePlus2 className="size-4" aria-hidden />{t("nav.new_request")}</Button></Link>} />

      {fresh && <div className="mb-5"><WarehouseLocationNotice /></div>}
      {fresh && <Checklist steps={steps} />}

      <StatGrid cols={3} className="mb-6">
        <Stat label={t("biz.active")} value={fmtNum(active, locale)} hint={t("rdz.k_active_dash", { done: fmtNum(r.completed ?? 0, locale) })} icon={<Clock className="size-5" />} tone="cyan" href="/business/requests?status=active" />
        <Stat label={t("ubz.needs_action")} value={fmtNum(needN, locale)} hint={needN > 0 ? t("rdz.k_action_dash", { n: fmtNum(pendingAttendance, locale) }) : t("ubz.all_clear")} icon={<BellRing className="size-5" />} tone={needN > 0 ? "gold" : "muted"} href="/business/requests?status=action" />
        <Stat label={t("rdz.k_delivered")} value={fmtNum(delivered.deliveredToday, locale)} hint={t("rdz.k_delivered_hint", { n: fmtNum(delivered.deliveredWeek, locale) })} icon={<PackageCheck className="size-5" />} href="/business/requests" />
        <Stat label={t("wallet.available")} value={<span className="ltr-num">{fmtMoney(available, locale)}</span>} hint={available < 0 ? t("rdz.k_overdrawn") : t("rdz.k_spent_hint", { amount: fmtMoney(ov.data.totalSpentCents, locale) })} icon={<Wallet className="size-5" />} tone={walletTone(available)} href="/business/wallet" />
        <Stat label={t("wallet.reserved")} value={<span className="ltr-num">{fmtMoney(reserved, locale)}</span>} hint={t("wallet.reserved_hint")} icon={<Lock className="size-5" />} tone="muted" href="/business/wallet" />
        <div data-testid="dash-cash"><Stat label={t("fob.dash_cash_with_drivers")} value={<span className="ltr-num">{fmtMoney(cashDue, locale)}</span>} hint={t("fob.dash_cash_hint", { amount: fmtMoney(cashCollected, locale) })} icon={<Coins className="size-5" />} tone={cashDue > 0 ? "gold" : "muted"} href="/business/cash" loading={cash.isLoading} /></div>
      </StatGrid>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="min-w-0 space-y-6 lg:col-span-2">
          {!fresh && <AttentionList items={items} />}
          {needs.data && <WaitingOrders data={needs.data} />}
          <RecentOrders items={reqs.data.items} needIds={needIds} blocked={blocked} />
        </div>
        <div className="min-w-0 space-y-6">
          <QuickActions links={quick} />
          <AccountHealth status={status} warehouseSet={wh.loading ? null : !wh.missing} geofence={wh.geofence} rating={ov.data.rating ?? null} />
        </div>
      </div>
    </>
  );
}
