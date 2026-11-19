"use client";
import { Banknote, CheckCircle2, Package, Truck, XCircle } from "lucide-react";
import { Stat } from "@/components/ui";
import { fmtMoney, fmtNum } from "@/lib/format";
import { useI18n } from "@/i18n/provider";
import { cn } from "@/lib/cn";
import { jobStats } from "./driver-fieldops-utils";

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

/** Compact counters for the job card in lists (same maths, one line). */
export function JobCounters({ job, className }: { job: { stopsSummary?: unknown; cod?: unknown }; className?: string }) {
  const { t, locale } = useI18n();
  const s = jobStats(job.stopsSummary as Parameters<typeof jobStats>[0], job.cod as Parameters<typeof jobStats>[1]);
  if (!s || s.total <= 0) return null;
  const pill = (id: string, n: number, label: string, cls: string) => <li key={id} data-testid={id} data-value={n} className={cn("flex min-w-0 flex-col items-center rounded-lg bg-bg2 px-1.5 py-1.5 text-center", cls)}><span className="ltr-num text-base font-bold leading-none">{fmtNum(n, locale)}</span><span className="mt-1 max-w-full truncate text-[10px] text-muted">{label}</span></li>;
  return (
    <div className={cn("space-y-2", className)} data-testid="job-card-stats">
      <ul className="grid grid-cols-4 gap-1.5">
        {pill("card-stat-total", s.total, t("fod.stat_total"), "text-ink")}
        {pill("card-stat-to-deliver", s.toDeliver, t("fod.stat_to_deliver"), "text-cyan")}
        {pill("card-stat-delivered", s.delivered, t("fod.stat_delivered"), "text-accent")}
        {pill("card-stat-not-delivered", s.notDelivered, t("fod.stat_not_delivered"), s.notDelivered > 0 ? "text-danger" : "text-muted")}
      </ul>
      {s.cod && <p data-testid="card-stat-cod" className="flex items-center justify-between rounded-lg bg-gold/10 px-2.5 py-1.5 text-xs font-medium text-gold"><span className="flex items-center gap-1.5"><Banknote className="size-3.5" aria-hidden />{t("fod.stat_cod_collect")}</span><span className="ltr-num font-bold">{fmtMoney(s.cod.toCollectCents, locale)}</span></p>}
    </div>
  );
}
