"use client";
import { Banknote, CheckCircle2, Package, Truck, XCircle } from "lucide-react";
import { Stat } from "@/components/ui";
import { fmtMoney, fmtNum } from "@/lib/format";
import { useI18n } from "@/i18n/provider";
import { cn } from "@/lib/cn";
import { jobStats } from "./driver-fieldops-utils";
import { cardStatsOf, isFinalJob } from "./driver-job-stats-lib";

/**
 * E13 — the stat cards at the top of the driver's job page (outside the stop panels):
 * shipments · to deliver · delivered · not delivered, plus cash to collect / collected when any parcel is cash on delivery.
 */
export function JobStatCards({ job }: { job: { stopsSummary?: unknown; cod?: unknown } }) {
  const { t, locale } = useI18n();
  const s = jobStats(job.stopsSummary as Parameters<typeof jobStats>[0], job.cod as Parameters<typeof jobStats>[1]);
  if (!s || s.total <= 0) return null;
  const cell = (id: string, value: number, label: string, icon: React.ReactNode, tone: "accent" | "cyan" | "gold" | "muted" | "danger") => (
    <div data-testid={id} data-value={value}><Stat label={label} value={<span className="ltr-num">{fmtNum(value, locale)}</span>} icon={icon} tone={tone} /></div>
  );
  return (
    <section aria-label={t("fod.stats_title")} data-testid="job-stats" className="mb-5 space-y-3">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {cell("stat-total", s.total, t("fod.stat_total"), <Package className="size-5" />, "muted")}
        {cell("stat-to-deliver", s.toDeliver, t("fod.stat_to_deliver"), <Truck className="size-5" />, "cyan")}
        {cell("stat-delivered", s.delivered, t("fod.stat_delivered"), <CheckCircle2 className="size-5" />, "accent")}
        {cell("stat-not-delivered", s.notDelivered, t("fod.stat_not_delivered"), <XCircle className="size-5" />, s.notDelivered > 0 ? "danger" : "muted")}
      </div>
      {s.cod && (
        <div className="grid grid-cols-2 gap-3" data-testid="job-stats-cod">
          <div data-testid="stat-cod-collect" data-value={s.cod.toCollectCents}><Stat label={t("fod.stat_cod_collect")} value={<span className="ltr-num">{fmtMoney(s.cod.toCollectCents, locale)}</span>} hint={t("fod.stat_cod_parcels", { n: fmtNum(s.cod.parcels, locale) })} icon={<Banknote className="size-5" />} tone="gold" /></div>
          <div data-testid="stat-cod-collected" data-value={s.cod.collectedCents}><Stat label={t("fod.stat_cod_collected")} value={<span className="ltr-num">{fmtMoney(s.cod.collectedCents, locale)}</span>} icon={<Banknote className="size-5" />} tone="accent" /></div>
        </div>
      )}
    </section>
  );
}

/**
 * J5 — the compact stat cards of EVERY order card in lists (offered, accepted, active, history): parcels · to deliver · delivered · not delivered,
 * and the cash of the job — to collect / collected while it runs, collected / handed over once it is over. Same maths as the job page, one block.
 */
export function JobCounters({ job, className }: { job: { status?: string; stats?: unknown; stopsSummary?: unknown; cod?: unknown }; className?: string }) {
  const { t, locale } = useI18n();
  const s = cardStatsOf(job);
  if (!s) return null;
  const final = isFinalJob(job);
  const money = (c: number) => <span className="ltr-num">{fmtMoney(c, locale)}</span>;
  const pill = (id: string, v: number, label: string, cls: string, shown?: React.ReactNode) => (
    <li key={id} data-testid={id} data-value={v} className={cn("flex min-w-0 flex-col items-center justify-start rounded-lg bg-bg2 px-1 py-1.5 text-center", cls)}>
      <span className="ltr-num text-base font-bold leading-none">{shown ?? fmtNum(v, locale)}</span><span className="mt-1 max-w-full break-words text-[10px] leading-tight text-muted">{label}</span>
    </li>
  );
  const cash = (id: string, v: number, label: string, cls: string) => (
    <div key={id} data-testid={id} data-value={v} className={cn("min-w-0 rounded-lg px-2.5 py-1.5", cls)}>
      <p className="flex items-center gap-1 text-[10px] leading-tight text-muted"><Banknote className="size-3 shrink-0" aria-hidden /><span className="break-words">{label}</span></p>
      <p className="mt-0.5 text-sm font-bold leading-tight">{money(v)}</p>
    </div>
  );
  const c = s.cod;
  return (
    <div className={cn("space-y-2", className)} data-testid="job-card-stats" data-final={final} data-estimated={s.estimated}>
      <ul className="grid grid-cols-4 gap-1.5" title={s.estimated ? t("jd.stat_expected") : undefined}>
        {pill("card-stat-total", s.total, t("fod.stat_total"), "text-ink", s.estimated && !final ? <span dir="ltr">≤{fmtNum(s.total, locale)}</span> : undefined)}
        {pill("card-stat-to-deliver", s.toDeliver, t("fod.stat_to_deliver"), "text-cyan")}
        {pill("card-stat-delivered", s.delivered, t("fod.stat_delivered"), "text-accent")}
        {pill("card-stat-not-delivered", s.notDelivered, t("fod.stat_not_delivered"), s.notDelivered > 0 ? "text-danger" : "text-muted")}
      </ul>
      {final && s.notDelivered > 0 && (s.failed > 0 || s.returned > 0) && (
        <p data-testid="card-stat-breakdown" className="text-xs text-muted">{[s.failed > 0 && `${t("jd.stat_failed")} ${fmtNum(s.failed, locale)}`, s.returned > 0 && `${t("jd.stat_returned")} ${fmtNum(s.returned, locale)}`].filter(Boolean).join(" · ")}</p>
      )}
      {c && (
        <div className="grid grid-cols-2 gap-1.5">
          {final
            ? <>{cash("card-stat-cod-collected", c.collectedCents, t("fod.stat_cod_collected"), "bg-accent/10 text-accent")}{c.handedOverCents != null && cash("card-stat-cod-handed", c.handedOverCents, t("jd.stat_cod_handed"), "bg-gold/10 text-gold")}</>
            : <>{cash("card-stat-cod", c.toCollectCents, t("fod.stat_cod_collect"), "bg-gold/10 text-gold")}{cash("card-stat-cod-collected", c.collectedCents, t("fod.stat_cod_collected"), "bg-accent/10 text-accent")}</>}
        </div>
      )}
      {final && c && (c.outstandingCents ?? 0) > 0 && <p data-testid="card-stat-cod-open" className="text-xs font-medium text-gold">{t("jd.stat_cod_open", { amount: fmtMoney(c.outstandingCents ?? 0, locale) })}</p>}
    </div>
  );
}
