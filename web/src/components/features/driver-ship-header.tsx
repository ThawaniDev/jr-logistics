"use client";
import { Banknote, HandCoins } from "lucide-react";
import { useI18n } from "@/i18n/provider";
import { cn } from "@/lib/cn";
import { fmtMoney, fmtNum } from "@/lib/format";
import type { ShipCounters } from "./driver-shipments-lib";

/**
 * Top of the run sheet, one card: the four counters (shipments · to deliver · delivered · not delivered — the same `stat-*` test ids as the older stat cards),
 * how far the route is with the progress bar (delivered green, not delivered red), and the cash still to collect / already collected.
 */
export function ShipHeader({ counters, cashLeftCents, cashCollectedCents }: { counters: ShipCounters; cashLeftCents: number; cashCollectedCents: number }) {
  const { t, locale } = useI18n();
  const { total, delivered, failed, done, todo } = counters;
  const pct = (n: number) => `${total ? (n / total) * 100 : 0}%`;
  const tile = (id: string, value: number, label: string, tone: string) => (
    <div key={id} data-testid={id} data-value={value} className="min-w-0 rounded-xl bg-bg2 px-1.5 py-2.5 text-center">
      <p className={cn("ltr-num text-2xl font-bold leading-none", tone)}>{fmtNum(value, locale)}</p>
      <p className="mt-1.5 text-[11px] leading-tight text-muted sm:text-xs">{label}</p>
    </div>
  );
  return (
    <section aria-label={t("fod.stats_title")} data-testid="job-stats" className="space-y-3 rounded-card border border-line bg-card p-3.5 sm:p-4">
      <div className="grid grid-cols-4 gap-2">
        {tile("stat-total", total, t("fod.stat_total"), "text-ink")}
        {tile("stat-to-deliver", todo, t("fod.stat_to_deliver"), "text-cyan")}
        {tile("stat-delivered", delivered, t("fod.stat_delivered"), "text-accent")}
        {tile("stat-not-delivered", failed, t("fod.stat_not_delivered"), failed > 0 ? "text-danger" : "text-muted")}
      </div>
      <div data-testid="ship-progress" data-done={done} data-total={total} className="space-y-1.5">
        <div className="flex flex-wrap items-baseline justify-between gap-x-3 text-sm"><p className="font-semibold">{t("jf2.done_of", { done: fmtNum(done, locale), total: fmtNum(total, locale) })}</p><p className="text-muted">{t("jf2.left_n", { n: fmtNum(todo, locale) })}</p></div>
        <div role="progressbar" aria-label={t("a11y.progress")} aria-valuemin={0} aria-valuemax={total} aria-valuenow={done} className="flex h-2.5 overflow-hidden rounded-full bg-line">
          <div className="bg-accent transition-all" style={{ width: pct(delivered) }} /><div className="bg-danger transition-all" style={{ width: pct(failed) }} />
        </div>
      </div>
      {(cashLeftCents > 0 || cashCollectedCents > 0) && (
        <div className="grid grid-cols-2 gap-2" data-testid="job-stats-cod">
          <p data-testid="stat-cod-collect" data-value={cashLeftCents} className="flex min-w-0 items-center gap-2 rounded-xl bg-gold/10 px-3 py-2 text-xs font-semibold text-gold sm:text-sm">
            <HandCoins className="size-4 shrink-0" aria-hidden /><span className="min-w-0"><span className="block truncate font-normal opacity-80">{t("fod.stat_cod_collect")}</span><span className="ltr-num block truncate text-sm font-bold sm:text-base">{fmtMoney(cashLeftCents, locale)}</span></span>
          </p>
          <p data-testid="stat-cod-collected" data-value={cashCollectedCents} className="flex min-w-0 items-center gap-2 rounded-xl bg-accent/10 px-3 py-2 text-xs font-semibold text-accent sm:text-sm">
            <Banknote className="size-4 shrink-0" aria-hidden /><span className="min-w-0"><span className="block truncate font-normal opacity-80">{t("fod.stat_cod_collected")}</span><span className="ltr-num block truncate text-sm font-bold sm:text-base">{fmtMoney(cashCollectedCents, locale)}</span></span>
          </p>
        </div>
      )}
    </section>
  );
}
