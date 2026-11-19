"use client";
import { useState } from "react";
import { AlertTriangle, CalendarClock, CheckCircle2, Clock, HardHat, RefreshCw, UserX } from "lucide-react";
import { Button, ErrorState, PageHeader, Stat, StatGrid } from "@/components/ui";
import { useApi } from "@/components/ui/data";
import { fmtTime } from "@/lib/format";
import { useI18n } from "@/i18n/provider";
import { AlertsSection, CitiesSection } from "@/components/features/admin-ops-queue";
import { alertCounts, riyadhDay } from "@/components/features/admin-ops-lib";

/** Operations: today's jobs at a glance, the alert queue with next steps, and today's picture per city. Refreshes itself every 30 seconds. */
export default function Operations() {
  const { t, locale } = useI18n();
  const [stamp, setStamp] = useState<Date | null>(null);
  const seen = { onSuccess: () => setStamp(new Date()) };
  const today = useApi("/admin/ops/today", { refreshInterval: 30000, ...seen });
  const alerts = useApi("/admin/ops/alerts", { refreshInterval: 30000, ...seen });
  const cities = useApi("/admin/ops/city-summary", { refreshInterval: 60000, shouldRetryOnError: false });
  const d = today.data; const loading = !d && !today.error;
  const ac = alertCounts(alerts.data?.items);
  const day = riyadhDay();
  const busy = today.isValidating || alerts.isValidating || cities.isValidating;
  const refresh = () => { today.mutate(); alerts.mutate(); cities.mutate(); };
  const bad = today.error ? <ErrorState error={today.error} retry={() => today.mutate()} /> : null;
  return (
    <>
      <PageHeader title={t("nav.operations")} subtitle={t("ops.sub")} actions={<>
        {stamp && <span className="text-xs text-muted" aria-live="polite" data-testid="admin-ops-updated">{t("rda.updated_at", { time: fmtTime(stamp, locale) })}</span>}
        <Button variant="secondary" size="sm" loading={busy} onClick={refresh} data-testid="admin-ops-refresh"><RefreshCw className="size-4" aria-hidden />{t("rda.refresh")}</Button>
      </>} />
      {bad ? <div className="mb-6">{bad}</div> : (
        <section aria-label={t("rda.today")} className="mb-6">
          <StatGrid cols={6}>
            <Stat loading={loading} label={t("rda.todays_jobs")} value={d?.scheduled ?? 0} icon={<CalendarClock className="size-5" />} tone="cyan" href={`/admin/requests?from=${day}&to=${day}`} hint={t("rda.today_hint")} />
            <Stat loading={loading} label={t("rda.not_arrived")} value={d?.accepted ?? 0} icon={<Clock className="size-5" />} tone={d?.accepted ? "gold" : "muted"} />
            <Stat loading={loading} label={t("ops.arrived")} value={(d?.arrived ?? 0) + (d?.working ?? 0)} icon={<HardHat className="size-5" />} tone="cyan" />
            <Stat loading={loading} label={t("ops.done")} value={d?.done ?? 0} icon={<CheckCircle2 className="size-5" />} tone="accent" />
            <Stat loading={loading} label={t("ops.no_show")} value={d?.noShow ?? 0} icon={<UserX className="size-5" />} tone={d?.noShow ? "danger" : "muted"} />
            <Stat loading={!alerts.data && !alerts.error} label={t("rda.alerts_critical")} value={alerts.error ? "—" : ac.critical} icon={<AlertTriangle className="size-5" />} tone={ac.critical ? "danger" : "muted"} href="#alerts" hint={alerts.data ? t("rda.alerts_hint", { w: ac.warning, i: ac.info }) : undefined} />
            {/* The warehouse confirm / dispute step is gone (E16): these two only appear while legacy jobs are still in those states. */}
            {(d?.awaitingConfirmation ?? 0) > 0 && <Stat label={t("ops.awaiting")} value={d.awaitingConfirmation} tone="gold" />}
            {(d?.disputed ?? 0) > 0 && <Stat label={t("ops.disputed")} value={d.disputed} tone="danger" />}
          </StatGrid>
        </section>
      )}
      <AlertsSection items={alerts.data?.items} error={alerts.error} onRetry={() => alerts.mutate()} onChanged={() => { alerts.mutate(); today.mutate(); }} />
      <CitiesSection data={cities.data} error={cities.error} onRetry={() => cities.mutate()} />
    </>
  );
}
