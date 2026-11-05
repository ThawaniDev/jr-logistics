"use client";
import Link from "next/link";
import { Briefcase, Star, Truck, Wallet, Hourglass, CheckCircle2 } from "lucide-react";
import { Badge, Button, Card, EmptyState, ErrorState, Notice, PageHeader, PageLoading, Stat, useAction } from "@/components/ui";
import { useApi } from "@/components/ui/data";
import { JobCard } from "@/components/features/driver-job-card";
import { put } from "@/lib/api";
import { fmtMoney, fmtDateTime } from "@/lib/format";
import { useI18n } from "@/i18n/provider";
import { useUser } from "@/components/layout/auth-context";
import { cn } from "@/lib/cn";

export default function DriverDashboard() {
  const { t, locale } = useI18n(); const me = useUser(); const a = useAction();
  const ov = useApi("/driver/overview"); const offers = useApi("/driver/offers"); const jobs = useApi("/driver/jobs?scope=active"); const inv = useApi("/driver/invites");
  if (ov.error) return <ErrorState error={ov.error} retry={() => ov.mutate()} />;
  if (!ov.data || !offers.data || !jobs.data) return <PageLoading />;
  const o = ov.data; const available = o.availability === "available";
  const suspended = o.suspendedUntil && new Date(o.suspendedUntil) > new Date();
  const toggle = () => a.run("av", () => put("/driver/availability", { available: !available }), { success: available ? "driver.now_offline" : "driver.now_online", onDone: () => ov.mutate() });
  return (
    <>
      <PageHeader title={t("driver.hello", { name: me.name.split(" ")[0] })} subtitle={t("driver.sub")} />
      {o.verificationStatus !== "verified" && <div className="mb-5"><Notice tone="warn" title={t(`verify.driver_${o.verificationStatus}_title`)}>{t("verify.driver_body")} <Link href="/driver/documents" className="font-semibold text-cyan underline">{t("verify.go_documents")}</Link></Notice></div>}
      {suspended && <div className="mb-5"><Notice tone="danger" title={t("driver.suspended")}>{t("driver.suspended_until", { d: fmtDateTime(o.suspendedUntil, locale) })}</Notice></div>}
      {inv.data?.items?.length > 0 && <div className="mb-5"><Notice tone="info" title={t("driver.invite_title")}>{inv.data.items.map((i: any) => <span key={i.id} className="me-3">{i.officeName}</span>)} <Link href="/driver/profile" className="font-semibold text-cyan underline">{t("driver.invite_review")}</Link></Notice></div>}
      <Card className={cn("mb-6 flex flex-wrap items-center justify-between gap-4 border-2", available ? "border-accent/60" : "border-line")}>
        <div className="flex items-center gap-3"><span className={cn("size-3 rounded-full", available ? "bg-accent shadow-[0_0_12px_var(--jr-accent)]" : "bg-muted")} aria-hidden /><div><p className="font-semibold">{available ? t("driver.online") : t("driver.offline")}</p><p className="text-xs text-muted">{available ? t("driver.online_hint") : t("driver.offline_hint")}</p></div></div>
        <Button size="lg" variant={available ? "secondary" : "primary"} loading={a.is("av")} onClick={toggle} disabled={!!suspended || o.verificationStatus !== "verified"}>{available ? t("driver.go_offline") : t("driver.go_online")}</Button>
      </Card>
      <div className="mb-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label={t("driver.new_offers")} value={o.newOffers} icon={<Briefcase className="size-5" />} tone="cyan" />
        <Stat label={t("driver.active_jobs")} value={o.activeJobs} icon={<Truck className="size-5" />} />
        <Stat label={t("driver.pending_pay")} value={<span className="ltr-num">{fmtMoney(o.wallet.pendingCents, locale)}</span>} icon={<Hourglass className="size-5" />} tone="gold" />
        <Stat label={t("wallet.available")} value={<span className="ltr-num">{fmtMoney(o.wallet.availableCents, locale)}</span>} icon={<Wallet className="size-5" />} tone="gold" />
      </div>
      <div className="mb-8 grid gap-4 sm:grid-cols-2"><Stat label={t("driver.completed")} value={o.jobsCompleted} icon={<CheckCircle2 className="size-5" />} /><Stat label={t("driver.rating")} value={o.rating ?? "—"} icon={<Star className="size-5" />} tone="gold" /></div>
      <h2 className="mb-3 font-semibold">{t("driver.offers_for_you")} {offers.data.items.length > 0 && <Badge tone="info" className="ms-2">{offers.data.items.length}</Badge>}</h2>
      {offers.data.items.length === 0 ? <EmptyState title={t("driver.no_offers")} hint={available ? t("driver.no_offers_hint") : t("driver.no_offers_offline")} /> : <div className="grid gap-4 lg:grid-cols-2">{offers.data.items.slice(0, 4).map((j: any) => <JobCard key={j.offerId} job={j} href={`/driver/jobs/${j.offerId}`} />)}</div>}
      {jobs.data.items.length > 0 && <><h2 className="mb-3 mt-8 font-semibold">{t("driver.active_jobs")}</h2><div className="grid gap-4 lg:grid-cols-2">{jobs.data.items.map((j: any) => <JobCard key={j.offerId} job={j} href={`/driver/jobs/${j.offerId}`} />)}</div></>}
    </>
  );
}
