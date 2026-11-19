"use client";
import { useMemo } from "react";
import Link from "next/link";
import { AlertTriangle, BarChart3, Briefcase, CheckCircle2, ChevronRight, Coins, Handshake, Info, LifeBuoy, ShieldCheck, Truck, UserPlus, Users, Wallet, type LucideIcon } from "lucide-react";
import { Badge, Button, EmptyState, ErrorState, PageHeader, PageLoading, Section, Skeleton, Stat, StatGrid, StatusBadge, Table, Td, CellPair, type Tone } from "@/components/ui";
import { useApi } from "@/components/ui/data";
import { useUser } from "@/components/layout/auth-context";
import { ApiError } from "@/lib/api";
import { fmtDateTime, fmtMoney, fmtNum } from "@/lib/format";
import { cn } from "@/lib/cn";
import { useI18n } from "@/i18n/provider";
import { NotReadyNotice, ParcelBar } from "./office-shared";
import { agreementSummary, attentionItems, docAlerts, waitingJobs, type Attention, type DocRow, type OfficeAgreement, type OfficeDriver, type OfficeJob, type OfficeOpp } from "./office-lib";

const TONE_CHIP = { danger: "bg-danger/10 text-danger", warn: "bg-gold/10 text-gold", info: "bg-cyan/10 text-cyan" } as const;
const TONE_ICON = { danger: AlertTriangle, warn: AlertTriangle, info: Info } as const;

/** One line of the "needs attention" list: what is wrong, and a link to the page where it is fixed. */
function AttentionRow({ a }: { a: Attention }) {
  const { t } = useI18n();
  const Icon = TONE_ICON[a.tone];
  return (
    <li data-testid={`office-attention-${a.id}`} className="flex items-start gap-3 px-5 py-3.5">
      <span className={cn("mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg", TONE_CHIP[a.tone])} aria-hidden><Icon className="size-4" /></span>
      <p className="min-w-0 flex-1 self-center text-sm">{t(a.key, a.vars)}</p>
      <Link href={a.href} className="inline-flex min-h-9 shrink-0 items-center gap-0.5 self-center text-sm font-semibold text-cyan hover:underline">{t(a.cta)}<ChevronRight className="size-4 rtl:rotate-180" aria-hidden /></Link>
    </li>
  );
}

function QuickLink({ href, icon: Icon, label, testid }: { href: string; icon: LucideIcon; label: string; testid: string }) {
  return (
    <Link href={href} data-testid={testid} className="flex min-h-11 items-center gap-3 rounded-xl px-3 py-2 text-sm font-medium transition hover:bg-bg2">
      <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-accent/10 text-accent" aria-hidden><Icon className="size-4" /></span>
      <span className="min-w-0 flex-1 truncate">{label}</span>
      <ChevronRight className="size-4 text-muted rtl:rotate-180" aria-hidden />
    </Link>
  );
}

function ReadyRow({ href, icon: Icon, label, badge }: { href: string; icon: LucideIcon; label: string; badge: React.ReactNode }) {
  return (
    <li><Link href={href} className="flex min-h-11 items-center gap-3 rounded-xl px-3 py-2 text-sm transition hover:bg-bg2">
      <Icon className="size-4 shrink-0 text-muted" aria-hidden /><span className="min-w-0 flex-1">{label}</span>{badge}
    </Link></li>
  );
}

const AGREEMENT_TONE: Record<string, Tone> = { none: "neutral", pending: "warn", active: "success", expiring: "warn", expired: "danger" };

export function OfficeDashboard() {
  const { t, locale } = useI18n(); const me = useUser();
  const live = { refreshInterval: 60_000, revalidateOnFocus: true };
  const dash = useApi("/office/dashboard", live);
  const active = useApi<{ total: number; items: OfficeJob[] }>("/office/jobs?scope=active", live);
  const recent = useApi<{ items: OfficeJob[] }>("/office/jobs?scope=all", live);
  const drivers = useApi<{ items: OfficeDriver[] }>("/office/drivers", live);
  const invites = useApi<{ items: unknown[] }>("/office/invites");
  const opps = useApi<{ items: OfficeOpp[] }>("/office/opportunities", { shouldRetryOnError: false }); // loads the candidate check: no polling
  const agreements = useApi<{ items: OfficeAgreement[] }>("/office/agreements");
  const docs = useApi<{ items: DocRow[] }>("/documents");
  const report = useApi<{ money: { failedCents: number } }>("/office/reports");

  const agreement = useMemo(() => (agreements.data ? agreementSummary(agreements.data.items, new Date()) : null), [agreements.data]);
  const oppsReady = opps.data?.items.filter((o) => o.eligibleDrivers.length > 0).length ?? 0;
  const attention = useMemo(() => attentionItems({
    readiness: dash.data?.readiness, agreement, docs: docs.data ? docAlerts(docs.data.items, new Date()) : null, drivers: drivers.data?.items,
    invites: invites.data?.items.length, opportunities: opps.data ? { ready: oppsReady } : null, jobs: active.data?.items, failedCents: report.data?.money.failedCents,
  }), [dash.data, agreement, docs.data, drivers.data, invites.data, opps.data, oppsReady, active.data, report.data]);

  if (dash.error && !dash.data) return <ErrorState error={dash.error} retry={() => dash.mutate()} />;
  if (!dash.data) return <PageLoading />;
  const d = dash.data; const r = d.readiness;
  const money = (c: number) => <span className="ltr-num">{fmtMoney(c, locale)}</span>;
  const oppsBlocked = opps.error instanceof ApiError && opps.error.code === "NOT_ELIGIBLE";
  const attentionLoading = [active, drivers, invites, agreements, docs].some((x) => !x.data && !x.error);
  const waiting = active.data ? waitingJobs(active.data.items) : 0;

  return (
    <>
      <PageHeader title={t("biz.welcome", { name: me.name })} subtitle={t("office.sub")} actions={<>
        <Link href="/office/reports"><Button variant="secondary" data-testid="office-dash-reports"><BarChart3 className="size-4" aria-hidden />{t("nav.reports")}</Button></Link>
        <Link href="/office/drivers?invite=1"><Button data-testid="office-dash-invite"><UserPlus className="size-4" aria-hidden />{t("office.invite_driver")}</Button></Link>
      </>} />
      {!r.ready && <div className="mb-5"><NotReadyNotice verification={r.verification} /></div>}

      <StatGrid cols={6}>
        <Stat label={t("office.drivers_total")} value={fmtNum(d.drivers.total, locale)} hint={t("rdo.drivers_hint", { free: d.drivers.available, busy: d.drivers.onJob })} icon={<Users className="size-5" />} href="/office/drivers" />
        <Stat label={t("office.active_jobs")} value={fmtNum(active.data?.total ?? d.activeJobs, locale)} loading={!active.data && !active.error} hint={waiting > 0 ? t("rdo.waiting_hint", { n: waiting }) : t("rdo.active_hint")} tone="cyan" icon={<Truck className="size-5" />} href="/office/jobs" />
        <Stat label={t("nav.opportunities")} value={oppsBlocked || opps.error ? "—" : fmtNum(opps.data?.items.length ?? 0, locale)} loading={!opps.data && !opps.error} hint={oppsBlocked ? t("office.not_ready") : t("rdo.opps_hint", { n: oppsReady })} icon={<Briefcase className="size-5" />} href="/office/opportunities" />
        <Stat label={t("rdo.kpi_pending")} value={money(d.pendingSettlementCents)} hint={t("rdo.pending_hint")} tone="gold" icon={<Coins className="size-5" />} href="/office/settlements" />
        <Stat label={t("office.wallet_balance")} value={money(d.wallet.availableCents)} hint={d.wallet.heldCents > 0 ? `${t("wallet.held")}: ${fmtMoney(d.wallet.heldCents, locale)}` : t("rdo.wallet_hint")} tone="cyan" icon={<Wallet className="size-5" />} href="/office/wallet" />
        <Stat label={t("office.paid_total")} value={money(d.paidCents)} hint={t("rdo.paid_hint")} icon={<CheckCircle2 className="size-5" />} href="/office/settlements?status=paid" />
      </StatGrid>

      <div className="mt-5 grid gap-5 lg:grid-cols-3">
        <div className="space-y-5 lg:col-span-2">
          <Section title={t("rdo.attention_title")} description={t("rdo.attention_sub")} flush actions={attention.length > 0 ? <Badge tone={attention[0].tone === "danger" ? "danger" : "warn"}>{attention.length}</Badge> : undefined}>
            {attentionLoading ? <div className="space-y-3 p-5" aria-busy="true"><Skeleton className="h-9" /><Skeleton className="h-9" /></div> : attention.length === 0 ? (
              <div data-testid="office-attention-clear" className="flex items-center gap-3 px-5 py-6 text-sm"><CheckCircle2 className="size-6 shrink-0 text-accent" aria-hidden /><div><p className="font-semibold">{t("rdo.all_clear")}</p><p className="text-muted">{t("rdo.all_clear_hint")}</p></div></div>
            ) : <ul className="divide-y divide-line/70" data-testid="office-attention">{attention.map((a) => <AttentionRow key={a.id} a={a} />)}</ul>}
          </Section>

          <Section title={t("rdo.recent_jobs")} flush actions={<Link href="/office/jobs?status=all" className="text-sm font-semibold text-cyan hover:underline">{t("common.view_all")}</Link>}>
            {recent.error && !recent.data ? <div className="p-5"><ErrorState error={recent.error} retry={() => recent.mutate()} /></div> : !recent.data ? <div className="space-y-3 p-5" aria-busy="true"><Skeleton className="h-10" /><Skeleton className="h-10" /><Skeleton className="h-10" /></div> : recent.data.items.length === 0 ? (
              <div className="p-5"><EmptyState icon={<Truck className="size-9" />} title={t("jobs.empty")} hint={t("rdo.recent_empty_hint")} action={<Link href="/office/opportunities"><Button variant="secondary"><Briefcase className="size-4" aria-hidden />{t("nav.opportunities")}</Button></Link>} /></div>
            ) : (
              <Table bare stack dense label={t("rdo.recent_jobs")} head={[t("req.ref"), t("office.driver"), t("rdo.col_progress"), t("common.status")]}>
                {recent.data.items.slice(0, 6).map((j) => (
                  <tr key={j.offerId} data-testid="office-recent-job">
                    <Td label={t("req.ref")}><CellPair title={<span className="ltr-num">{j.ref}</span>} href={`/office/jobs/${j.offerId}`} sub={<>{j.business ?? "—"} · <span className="ltr-num">{fmtDateTime(j.startsAt, locale)}</span></>} /></Td>
                    <Td label={t("office.driver")}>{j.driver}</Td>
                    <Td label={t("rdo.col_progress")}><ParcelBar parcels={j.parcels} /></Td>
                    <Td label={t("common.status")}><StatusBadge status={j.status} ns="jobstatus" /></Td>
                  </tr>
                ))}
              </Table>
            )}
          </Section>
        </div>

        <div className="space-y-5">
          <Section title={t("rdo.quick_title")}>
            <nav aria-label={t("rdo.quick_title")} className="-m-2 space-y-0.5">
              <QuickLink testid="office-quick-invite" href="/office/drivers?invite=1" icon={UserPlus} label={t("office.invite_driver")} />
              <QuickLink testid="office-quick-opps" href="/office/opportunities" icon={Briefcase} label={t("rdo.quick_assign")} />
              <QuickLink testid="office-quick-jobs" href="/office/jobs" icon={Truck} label={t("rdo.quick_follow")} />
              <QuickLink testid="office-quick-payouts" href="/office/wallet" icon={Wallet} label={t("rdo.quick_payout")} />
              <QuickLink testid="office-quick-support" href="/office/support" icon={LifeBuoy} label={t("nav.support")} />
            </nav>
          </Section>
          <Section title={t("rdo.ready_title")} description={r.ready ? t("rdo.ready_ok") : t("rdo.ready_not")}>
            <ul className="-m-2 space-y-0.5" data-testid="office-readiness">
              <ReadyRow href="/office/documents" icon={ShieldCheck} label={t("rdo.ready_docs")} badge={<StatusBadge status={r.verification} />} />
              <ReadyRow href="/office/agreement" icon={Handshake} label={t("rdo.ready_agreement")} badge={agreement ? <Badge tone={AGREEMENT_TONE[agreement.state]}>{t(`rdo.agr_${agreement.state}`)}</Badge> : <Skeleton className="h-5 w-16" />} />
              <ReadyRow href="/office/drivers?state=available" icon={Users} label={t("rdo.ready_drivers")} badge={<Badge tone={d.drivers.available > 0 ? "success" : "neutral"}><span className="ltr-num">{d.drivers.available}</span></Badge>} />
            </ul>
          </Section>
        </div>
      </div>
    </>
  );
}
