"use client";
import { Section, Table, Td, Badge, type Tone } from "@/components/ui";
import { fmtDur } from "@/components/reports/chartTheme";
import { cn } from "@/lib/cn";
import { fmtDateTime, fmtTime } from "@/lib/format";
import { useI18n } from "@/i18n/provider";
import { useTx } from "./admin-common";
import { journeyFacts, journeyParams } from "./admin-order-lib";

const DANGER = /fail|missing|cancel|otp_failed|notify_failed/;
const GOOD = /delivered|otp_verified|cod_collected|returned|details_completed/;
const MOVE = /arrived|loaded|assigned|route_positioned|proof_uploaded|otp_sent/;
const DOT = { danger: "bg-danger", accent: "bg-accent", cyan: "bg-cyan", muted: "bg-muted" } as const;
export const parcelTone = (type: string): keyof typeof DOT => (DANGER.test(type) ? "danger" : GOOD.test(type) ? "accent" : MOVE.test(type) ? "cyan" : "muted");
const OUTCOME_TONE: Record<string, Tone> = { delivered: "success", failed: "danger", deferred: "warn" };

/** The parcel's journey, oldest first: what happened, who did it, when, and how long after the previous step. */
export function ParcelJourney({ events, code }: { events: any[]; code: string }) {
  const { t, locale } = useI18n(); const tx = useTx();
  return (
    <Section title={t("dv1.journey_title")} description={t("dv1.journey_sub", { n: events.length })} id="parcel-journey">
      {events.length === 0 ? <p className="text-sm text-muted">{t("dv1.journey_none")}</p> : (
        <ol className="relative space-y-4 border-s border-line ps-5" data-testid="dv1-journey">
          {events.map((e) => {
            const title = t(`dtk.p_${e.type}`, journeyParams(e, code, t, locale)); const facts = journeyFacts(e, t, locale);
            return (
              <li key={e.id} className="relative" data-type={e.type}>
                <span className={cn("absolute -start-[25px] top-1.5 size-2.5 rounded-full ring-4 ring-card", DOT[parcelTone(e.type)])} aria-hidden />
                <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                  <p className="text-sm font-medium">{title.startsWith("dtk.") ? tx(`event.${e.type}`, e.type.replace(/_/g, " ")) : title}</p>
                  {e.fromPrevS != null && <span className="ltr-num rounded-full bg-line/50 px-2 py-0.5 text-xs tabular-nums text-muted" title={t("dv1.since_previous")}>+{fmtDur(Math.max(0, e.fromPrevS), locale)}</span>}
                </div>
                <p className="text-xs text-muted">{e.actorName ? `${e.actorName} · ` : ""}{e.actorRole ? `${tx(`role.${e.actorRole}`, e.actorRole)} · ` : ""}{fmtDateTime(e.createdAt, locale)}</p>
                {facts.length > 0 && <p className="mt-1 text-xs text-muted">{facts.join(" · ")}</p>}
              </li>
            );
          })}
        </ol>
      )}
    </Section>
  );
}

/** The visits to the door: when the driver arrived, what came of it, how long they stayed, the reason and the wrong codes typed. */
export function ParcelAttempts({ attempts }: { attempts: any[] }) {
  const { t, locale } = useI18n(); const tx = useTx();
  return (
    <Section title={t("dv1.attempts_title")} description={t("dv1.attempts_sub")} id="parcel-attempts" flush>
      {attempts.length === 0 ? <p className="p-5 text-sm text-muted">{t("dv1.attempts_none")}</p> : (
        <Table bare dense stack label={t("dv1.attempts_title")} head={["#", t("dv1.col_arrived"), t("dv1.col_outcome"), { label: t("dv1.col_door_time"), align: "end" }, t("dv1.col_reason"), { label: t("dv1.col_wrong_codes"), align: "end" }, t("shipadm.col_driver")]}>
          {attempts.map((a) => (
            <tr key={a.n} data-testid="dv1-attempt-row">
              <Td label="#" className="ltr-num">{a.n}</Td>
              <Td label={t("dv1.col_arrived")} className="whitespace-nowrap">{a.arrivedAt ? fmtTime(a.arrivedAt, locale) : "—"}<span className="block text-xs text-muted">{fmtDateTime(a.arrivedAt ?? a.outcomeAt, locale)}</span></Td>
              <Td label={t("dv1.col_outcome")}>{a.outcome ? <Badge tone={OUTCOME_TONE[a.outcome]}>{t(`dv1.out_${a.outcome}`)}</Badge> : <Badge>{t("dv1.out_open")}</Badge>}</Td>
              <Td label={t("dv1.col_door_time")} num>{a.durationS == null ? "—" : fmtDur(a.durationS, locale)}</Td>
              <Td label={t("dv1.col_reason")} className="max-w-64">{a.reason ? tx(`stopfail.${a.reason}`, a.reason) : "—"}{a.note && <span className="block text-xs text-muted">“{a.note}”</span>}</Td>
              <Td label={t("dv1.col_wrong_codes")} num className={a.otpFailures > 0 ? "text-gold" : undefined}>{a.otpFailures}</Td>
              <Td label={t("shipadm.col_driver")}>{a.actorName ?? "—"}</Td>
            </tr>
          ))}
        </Table>
      )}
    </Section>
  );
}
