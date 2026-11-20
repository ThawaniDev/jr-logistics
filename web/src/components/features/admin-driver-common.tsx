"use client";
import type { ReactNode } from "react";
import { Check, TriangleAlert } from "lucide-react";
import { Badge, Notice, Segmented } from "@/components/ui";
import { useUrlState } from "@/components/ui/data";
import { KpiGrid } from "@/components/reports";
import type { Kpi } from "@/components/reports";
import { useI18n } from "@/i18n/provider";
import { fmtDate, fmtDateTime } from "@/lib/format";
import { fmtDur } from "@/components/reports/chartTheme";
import { PERIOD_KEYS, parsePeriod, type PeriodKey, type Risk } from "@/server/details-people-lib";

/** Small pieces shared by the driver and courier-office detail views (`dv2.` strings, decisions G6–G7). */

/** The period of a detail page lives in the URL (`?period=90d`) so a link opens the same view. `fallback` is what the URL means without the parameter. */
export function usePeriod(fallback: PeriodKey = "30d"): [PeriodKey, (p: PeriodKey) => void] {
  const [raw, set] = useUrlState("period", fallback);
  return [parsePeriod(raw || fallback), (p) => set(p)];
}
/** 30 days / 90 days / 12 months / all time. */
export function PeriodBar({ value, onChange, end }: { value: PeriodKey; onChange: (p: PeriodKey) => void; end?: ReactNode }) {
  const { t } = useI18n();
  return (
    <div className="flex flex-wrap items-center gap-3" data-testid="dv2-period">
      <Segmented label={t("dv2.period")} value={value} onChange={(k) => onChange(k as PeriodKey)} options={PERIOD_KEYS.map((k) => ({ key: k, label: t(`dv2.period_${k}`) }))} />
      {end}
    </div>
  );
}
/** "1 Nov – 19 Nov 2026, compared with …" under the period selector, so a number is never read without its window. */
export function PeriodNote({ period, generatedAt }: { period: { from: string; to: string; days: number; prevFrom: string | null; prevTo: string | null }; generatedAt?: string }) {
  const { t, locale } = useI18n(); const d = (s: string) => fmtDate(`${s}T12:00:00+03:00`, locale);
  return (
    <p className="text-xs text-muted" data-testid="dv2-period-note">
      {t("dv2.period_note", { from: d(period.from), to: d(period.to), n: period.days })}
      {period.prevFrom && period.prevTo ? <> · {t("dv2.compared_with", { from: d(period.prevFrom), to: d(period.prevTo) })}</> : <> · {t("dv2.no_comparison")}</>}
      {generatedAt && <> · {t("dv2.updated", { t: fmtDateTime(generatedAt, locale) })}</>}
    </p>
  );
}
/** The KPI row of a detail view: every card has its definition tooltip and the change against the previous period. */
export function KpiStrip({ kpis, comparing, loading, cols = 4, label }: { kpis?: Kpi[]; comparing?: boolean; loading?: boolean; cols?: 3 | 4 | 5 | 6; label: string }) {
  const { t } = useI18n();
  return <div data-testid="dv2-kpis" data-label={label}><KpiGrid kpis={kpis} comparing={comparing} loading={loading} count={cols === 4 ? 8 : cols * 2} cols={cols} partLabel={(k) => t(`dv2.part_${k}`)} /></div>;
}
/** The viewer's role cannot see this part. */
export function Locked({ children }: { children?: ReactNode }) {
  const { t } = useI18n();
  return <Notice tone="warn">{children ?? t("rdq.no_access")}</Notice>;
}
/** Personal data (position, addresses, sign-ins) needs `drivers.sensitive`. */
export function SensitiveOnly() {
  const { t } = useI18n();
  return <Notice tone="warn" title={t("dv2.sensitive_title")}>{t("dv2.sensitive_body")}</Notice>;
}
/** The risk flags of a driver as chips (danger first); each has a plain-language reason. */
export function RiskChips({ risks, fmtMoney }: { risks: Risk[]; fmtMoney?: (cents: number) => string }) {
  const { t } = useI18n();
  if (!risks.length) return <Badge tone="success" className="gap-1"><Check className="size-3" aria-hidden />{t("dv2.risk_none")}</Badge>;
  return (
    <ul className="flex flex-wrap items-center gap-1.5" aria-label={t("dv2.risks")} data-testid="dv2-risks">
      {[...risks].sort((a, b) => (a.level === b.level ? 0 : a.level === "danger" ? -1 : 1)).map((r) => (
        <li key={r.key} data-testid={`dv2-risk-${r.key}`}><Badge tone={r.level === "danger" ? "danger" : "warn"} className="gap-1 whitespace-normal">
          <TriangleAlert className="size-3 shrink-0" aria-hidden />{t(`dv2.risk_${r.key}`, { ...r.params, amount: fmtMoney ? fmtMoney(Number(r.params.cents ?? 0)) : "" } as Record<string, string | number>)}
        </Badge></li>
      ))}
    </ul>
  );
}
/** "5 min ago" from an age in seconds (one wording for "last seen", "position age" …). */
export function Ago({ seconds }: { seconds: number | null | undefined }) {
  const { t, locale } = useI18n();
  if (seconds == null) return <>—</>;
  return <span className="ltr-num">{seconds < 60 ? t("dv2.just_now") : t("dv2.ago", { t: fmtDur(seconds, locale) })}</span>;
}
export const secondsSince = (d: string | Date | null | undefined) => (d ? Math.max(0, Math.round((Date.now() - new Date(d).getTime()) / 1000)) : null);

/** The steps of a job as dots with their time: offered → accepted → arrived → loaded → delivered → completed (a step that never happened is dimmed). */
export function JobTimeline({ timeline, status }: { timeline: Record<string, string | null | undefined>; status: string }) {
  const { t, locale } = useI18n();
  const steps: Array<[string, string]> = [["offeredAt", "dv2.step_offered"], ["acceptedAt", "dv2.step_accepted"], ["arrivedAt", "dv2.step_arrived"], ["attendanceAt", "dv2.step_attendance"], ["loadedAt", "dv2.step_loaded"], ["deliveredAt", "dv2.step_delivered"], ["finalAt", "dv2.step_completed"]];
  const stop = timeline.cancelledAt ? [["cancelledAt", status === "no_show" ? "dv2.step_no_show" : "dv2.step_cancelled"] as [string, string]] : [];
  return (
    <ol className="flex flex-wrap gap-x-5 gap-y-2 text-xs" aria-label={t("dv2.timeline")} data-testid="dv2-timeline">
      {[...steps, ...stop].map(([k, label]) => {
        const at = timeline[k]; const bad = k === "cancelledAt";
        return (
          <li key={k} className={at ? "" : "opacity-40"}>
            <span className="inline-flex items-center gap-1.5"><span className={`size-2 rounded-full ${at ? (bad ? "bg-danger" : "bg-accent") : "border border-muted"}`} aria-hidden /><span className={bad && at ? "font-medium text-danger" : "font-medium"}>{t(label)}</span></span>
            <span className="block ps-3.5 text-muted"><span className="ltr-num">{at ? fmtDateTime(at, locale) : "—"}</span></span>
          </li>
        );
      })}
    </ol>
  );
}
