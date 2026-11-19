"use client";
import Link from "next/link";
import { Briefcase, Star, Truck, Wallet, Hourglass, CheckCircle2, HandCoins } from "lucide-react";
import { Badge, Button, Card, EmptyState, ErrorState, Notice, PageHeader, PageLoading, Stat, StatGrid } from "@/components/ui";
import { useDriverAction } from "@/components/features/driver-action";
import { useApi } from "@/components/ui/data";
import { JobCard } from "@/components/features/driver-job-card";
import { ActiveJobShortcut, OffersHiddenBanner } from "@/components/features/driver-offers";
import { offersHidden } from "@/components/features/driver-fieldops-utils";
import { put } from "@/lib/api";
import { fmtMoney, fmtDateTime } from "@/lib/format";
import { useI18n } from "@/i18n/provider";
import { useUser } from "@/components/layout/auth-context";
import { cn } from "@/lib/cn";

export default function DriverDashboard() {
  const { t, locale } = useI18n(); const me = useUser(); const a = useDriverAction();
  // New offers and the job in progress change while the app is open: poll and refresh when the driver returns to the tab.
  const live = { refreshInterval: 30_000, revalidateOnFocus: true };
  const ov = useApi("/driver/overview", live); const offers = useApi("/driver/offers", live); const jobs = useApi("/driver/jobs?scope=active", live); const inv = useApi("/driver/invites");
  const failed = ov.error ?? offers.error ?? jobs.error;
  if (failed && !(ov.data && offers.data && jobs.data)) return <ErrorState error={failed} retry={() => { void ov.mutate(); void offers.mutate(); void jobs.mutate(); }} />;
  if (!ov.data || !offers.data || !jobs.data) return <PageLoading />;
  const o = ov.data; const available = o.availability === "available";
  const active = offersHidden({ activeJob: o.activeJob }).activeJob; const hidden = offersHidden(offers.data); const cashCents: number = o.cash?.outstandingCents ?? 0;
  const suspended = o.suspendedUntil && new Date(o.suspendedUntil) > new Date();
  const toggle = () => a.run("av", () => put("/driver/availability", { available: !available }), { success: available ? "driver.now_offline" : "driver.now_online", onDone: () => ov.mutate() });
  return (
    <>
      <PageHeader title={t("driver.hello", { name: me.name.split(" ")[0] })} subtitle={t("driver.sub")} />
      {o.verificationStatus !== "verified" && <div className="mb-5"><Notice tone="warn" title={t(`verify.driver_${o.verificationStatus}_title`)}>{t("verify.driver_body")} <Link href="/driver/documents" className="inline-flex min-h-11 items-center font-semibold text-cyan underline">{t("verify.go_documents")}</Link></Notice></div>}
      {suspended && <div className="mb-5"><Notice tone="danger" title={t("driver.suspended")}>{t("driver.suspended_until", { d: fmtDateTime(o.suspendedUntil, locale) })}</Notice></div>}
      {inv.data?.items?.length > 0 && <div className="mb-5"><Notice tone="info" title={t("driver.invite_title")}>{inv.data.items.map((i: any) => <span key={i.id} className="me-3">{i.officeName}</span>)} <Link href="/driver/profile" className="font-semibold text-cyan underline">{t("driver.invite_review")}</Link></Notice></div>}
      {active && <ActiveJobShortcut job={active} />}
      {jobs.data.items.filter((j: any) => j.offerId !== active?.offerId).length > 0 && (
        <section aria-labelledby="dash-active" className="mb-6">
          <h2 id="dash-active" className="mb-3 font-semibold">{t("ux.d_continue_title")}</h2>
          <div className="grid gap-4 lg:grid-cols-2">{jobs.data.items.filter((j: any) => j.offerId !== active?.offerId).map((j: any) => <JobCard key={j.offerId} job={j} href={`/driver/jobs/${j.offerId}`} />)}</div>
        </section>
      )}
      <Card className={cn("mb-6 flex flex-wrap items-center justify-between gap-4 border-2", available ? "border-accent/60" : "border-line")}>
        <div className="flex items-center gap-3"><span className={cn("size-3 rounded-full", available ? "bg-accent shadow-[0_0_12px_var(--jr-accent)]" : "bg-muted")} aria-hidden /><div><p className="font-semibold">{available ? t("driver.online") : t("driver.offline")}</p><p className="text-xs text-muted">{available ? t("driver.online_hint") : t("driver.offline_hint")}</p></div></div>
        <Button size="lg" variant={available ? "secondary" : "primary"} className="min-h-12" loading={a.is("av")} onClick={toggle} disabled={!!suspended || o.verificationStatus !== "verified"}>{available ? t("driver.go_offline") : t("driver.go_online")}</Button>
      </Card>
      <StatGrid cols={4} className="mb-4">
        <Stat label={t("driver.new_offers")} value={o.newOffers} icon={<Briefcase className="size-5" />} tone="cyan" hint={t("rdo.d_offers_hint")} href="/driver/opportunities" />
        <Stat label={t("driver.active_jobs")} value={o.activeJobs} icon={<Truck className="size-5" />} hint={t("rdo.d_active_hint")} href="/driver/jobs" />
        <div data-testid="cash-card" data-value={cashCents} className="[&>*]:h-full"><Stat label={t("fod.cash_with_me")} value={<span className="ltr-num">{fmtMoney(cashCents, locale)}</span>} hint={cashCents > 0 ? t("fod.cash_card_hint") : t("fod.cash_nothing")} icon={<HandCoins className="size-5" />} tone="gold" href="/driver/cash" /></div>
        <Stat label={t("wallet.available")} value={<span className="ltr-num">{fmtMoney(o.wallet.availableCents, locale)}</span>} icon={<Wallet className="size-5" />} tone="gold" hint={t("rdo.d_wallet_hint")} href="/driver/wallet" />
      </StatGrid>
      <StatGrid cols={o.wallet.pendingCents > 0 ? 3 : 2} className="mb-8">
        <Stat label={t("driver.completed")} value={o.jobsCompleted} icon={<CheckCircle2 className="size-5" />} hint={t("rdo.d_completed_hint")} href="/driver/jobs?scope=history" />
        <Stat label={t("driver.rating")} value={o.rating ?? "—"} icon={<Star className="size-5" />} tone="gold" hint={o.rating == null ? t("rdo.d_rating_none") : t("rdo.d_rating_hint")} />
        {o.wallet.pendingCents > 0 && <div data-testid="wallet-on-hold" className="[&>*]:h-full"><Stat label={t("fod.on_hold")} value={<span className="ltr-num">{fmtMoney(o.wallet.pendingCents, locale)}</span>} hint={t("fod.on_hold_hint")} icon={<Hourglass className="size-5" />} tone="gold" href="/driver/wallet" /></div>}
      </StatGrid>
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 className="font-semibold">{t("driver.offers_for_you")} {offers.data.items.length > 0 && <Badge tone="info" className="ms-2">{offers.data.items.length}</Badge>}</h2>
        {!hidden.hidden && offers.data.items.length > 4 && <Link href="/driver/opportunities" className="inline-flex min-h-11 items-center text-sm font-semibold text-cyan hover:underline">{t("ux.d_see_all_offers", { n: offers.data.items.length })}</Link>}
      </div>
      {hidden.hidden ? <OffersHiddenBanner activeJob={hidden.activeJob ?? active} /> : offers.data.items.length === 0 ? <EmptyState title={t("driver.no_offers")} hint={available ? t("driver.no_offers_hint") : t("driver.no_offers_offline")} /> : <div className="grid gap-4 lg:grid-cols-2">{offers.data.items.slice(0, 4).map((j: any) => <JobCard key={j.offerId} job={j} href={`/driver/jobs/${j.offerId}`} />)}</div>}
    </>
  );
}
