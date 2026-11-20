"use client";
import { useEffect, useState } from "react";
import { Clock } from "lucide-react";
import { Badge, ProgressBar, Section } from "@/components/ui";
import { fmtDur } from "@/components/reports";
import { fmtDateTime } from "@/lib/format";
import { useI18n } from "@/i18n/provider";
import { SLA, slaFor, type SlaClock, type SlaState } from "@/server/details-pure";

const TONE: Record<SlaState, "success" | "warn" | "info" | "danger"> = { met: "success", met_late: "warn", on_track: "info", at_risk: "warn", breached: "danger" };
/** A small state badge for an SLA clock ("Met", "Met late", "On track", "At risk", "Breached"). */
export function SlaBadge({ state, testId }: { state: SlaState; testId?: string }) {
  const { t } = useI18n();
  return <Badge tone={TONE[state]}><span data-testid={testId}>{t(`dv3.sla_${state}`)}</span></Badge>;
}

/** The current time, refreshed every 30 s, so a running clock moves without reloading the page. */
export function useNow(everyMs = 30_000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const h = setInterval(() => setNow(Date.now()), everyMs); return () => clearInterval(h); }, [everyMs]);
  return now;
}

function Clock1({ label, c, testId }: { label: string; c: SlaClock; testId: string }) {
  const { t, locale } = useI18n();
  const running = c.doneAt == null;
  const over = running && (c.remainingSec ?? 0) < 0;
  const used = Math.min(100, (c.elapsedSec / c.targetSec) * 100);
  return (
    <div className="space-y-1.5" data-testid={testId} data-state={c.state}>
      <div className="flex flex-wrap items-center justify-between gap-2"><p className="text-sm font-medium">{label}</p><SlaBadge state={c.state} testId={`${testId}-state`} /></div>
      <ProgressBar value={used} max={100} tone={c.state === "breached" ? "danger" : c.state === "at_risk" || c.state === "met_late" ? "gold" : "accent"} label={label} />
      <p className="flex flex-wrap items-center justify-between gap-x-3 text-xs text-muted">
        <span>{t("dv3.sla_target", { time: fmtDur(c.targetSec, locale) })}</span>
        <span>{running ? (over ? t("dv3.sla_over", { time: fmtDur(-(c.remainingSec ?? 0), locale) }) : t("dv3.sla_left", { time: fmtDur(c.remainingSec ?? 0, locale) })) : t("dv3.sla_done", { time: fmtDur(c.elapsedSec, locale), at: fmtDateTime(c.doneAt, locale) })}</span>
      </p>
    </div>
  );
}

/**
 * The two support clocks of a ticket or complaint: first response within 4 h and resolution within 48 h of opening (`SLA` in server/details-pure.ts — one definition).
 * Recomputed in the browser from the timestamps, so a running clock keeps moving.
 */
export function SlaClocks({ row }: { row: { createdAt: string; firstResponseAt: string | null; resolvedAt: string | null } }) {
  const { t } = useI18n(); const now = useNow();
  const sla = slaFor(row, now);
  return (
    <Section title={<span className="inline-flex items-center gap-2"><Clock className="size-4 text-muted" aria-hidden />{t("dv3.sla_title")}</span>} description={t("dv3.sla_sub", { first: SLA.firstResponseSec / 3600, res: SLA.resolutionSec / 3600 })}>
      <div className="space-y-4" data-testid="dv3-sla">
        <Clock1 label={t("dv3.sla_first")} c={sla.firstResponse} testId="dv3-sla-first" />
        <Clock1 label={t("dv3.sla_resolution")} c={sla.resolution} testId="dv3-sla-resolution" />
      </div>
    </Section>
  );
}
