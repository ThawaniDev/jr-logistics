"use client";
import { useMemo, useState } from "react";
import Link from "next/link";
import { ExternalLink, MapPin, Radio } from "lucide-react";
import { Badge, EmptyState, ErrorState, PageLoading, Section, Segmented, Stat, StatGrid } from "@/components/ui";
import { useApi } from "@/components/ui/data";
import { fmtDate, fmtDateTime } from "@/lib/format";
import { useI18n } from "@/i18n/provider";
import { hasPerm, useUser } from "@/components/layout/auth-context";
import { dayEndIso, dayStartIso, hasAny, qs, useTx } from "./admin-common";
import { Ago, SensitiveOnly } from "./admin-driver-common";
import { PathReplay } from "./admin-driver-path";

type Pick = { kind: "job"; offerId: string; from: string; to: string } | { kind: "day"; day: string } | null;
const pad = (iso: string, ms: number) => new Date(new Date(iso).getTime() + ms).toISOString();

/** Location of a driver: the last known position with its age, a replay of the GPS path of a chosen job or day, and the availability timeline. Needs `drivers.sensitive`; every look is audited. */
export function DriverLocationTab({ id }: { id: string }) {
  const { t, locale } = useI18n(); const me = useUser(); const tx = useTx(); const sensitive = hasPerm(me, "drivers.sensitive");
  const { data, error, mutate } = useApi(sensitive ? `/admin/drivers/${id}/location` : null);
  const [mode, setMode] = useState<"job" | "day">("day"); const [pick, setPick] = useState<Pick>(null);
  const range = useMemo(() => !pick ? null : pick.kind === "day" ? { from: dayStartIso(pick.day)!, to: dayEndIso(pick.day)!, offerId: undefined } : { from: pad(pick.from, -60_000), to: pad(pick.to, 60_000), offerId: pick.offerId }, [pick]);
  const path = useApi(range ? `/admin/location-history/${id}${qs(range)}` : null);
  if (!sensitive) return <SensitiveOnly />;
  if (error) return <ErrorState error={error} retry={() => mutate()} />;
  if (!data) return <PageLoading />;
  const last = data.last; const canRequest = hasAny(me, "requests.view");
  const choices = mode === "day" ? data.days : data.jobs;
  return (
    <div className="space-y-5" data-testid="dv2-location">
      <StatGrid cols={4}>
        <Stat label={t("dv2.loc_last")} icon={<MapPin className="size-5" />} tone={last && last.ageSeconds != null && last.ageSeconds < 1800 ? "accent" : "muted"} value={last ? <Ago seconds={last.ageSeconds} /> : "—"} hint={last?.at ? fmtDateTime(last.at, locale) : t("dv2.loc_never")} />
        <Stat label={t("dv2.loc_position")} tone="cyan" value={last ? <span className="ltr-num text-base">{last.lat.toFixed(4)}, {last.lng.toFixed(4)}</span> : "—"}
          hint={last ? <a href={`https://www.google.com/maps?q=${last.lat},${last.lng}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-cyan hover:underline" data-testid="dv2-loc-open">{t("dv2.loc_open_map")}<ExternalLink className="size-3" aria-hidden /></a> : undefined} />
        <Stat label={t("adm.availability")} icon={<Radio className="size-5" />} tone={data.current === "available" ? "accent" : "muted"} value={data.current === "available" ? t("map.available") : t("adm.unavailable")} hint={t("dv2.avail_changes", { n: data.availability.length })} />
        <Stat label={t("dv2.loc_samples")} tone="gold" value={data.samples.last31d} hint={t("dv2.loc_samples_hint", { n: data.samples.total, d: data.samples.retentionDays })} />
      </StatGrid>

      <Section title={t("dv2.replay_title")} description={t("dv2.replay_sub")} actions={<Segmented label={t("dv2.replay_by")} value={mode} onChange={(k) => { setMode(k as "job" | "day"); setPick(null); }} options={[{ key: "day", label: t("dv2.replay_by_day"), count: data.days.length }, { key: "job", label: t("dv2.replay_by_job"), count: data.jobs.length }]} />}>
        {choices.length === 0 ? <EmptyState icon={<MapPin className="size-9" aria-hidden />} title={t("dv2.loc_none")} hint={t("dv2.loc_none_hint")} /> : (
          <div className="space-y-4">
            <ul className="flex flex-wrap gap-2" aria-label={t("dv2.replay_pick")}>
              {mode === "day" ? data.days.map((d: any) => {
                const on = pick?.kind === "day" && pick.day === d.day;
                return <li key={d.day}><button type="button" aria-pressed={on} data-testid={`dv2-day-${d.day}`} onClick={() => setPick({ kind: "day", day: d.day })} className={`rounded-xl border px-3 py-1.5 text-sm transition ${on ? "border-accent bg-accent/10 text-accent" : "border-line bg-bg2 text-muted hover:text-ink"}`}><span className="ltr-num">{fmtDate(`${d.day}T12:00:00+03:00`, locale)}</span> <span className="ltr-num text-xs opacity-80">· {d.points}</span></button></li>;
              }) : data.jobs.map((j: any) => {
                const on = pick?.kind === "job" && pick.offerId === j.offerId;
                return <li key={j.offerId}><button type="button" aria-pressed={on} data-testid={`dv2-job-${j.offerId}`} onClick={() => setPick({ kind: "job", offerId: j.offerId, from: j.firstAt, to: j.lastAt })} className={`rounded-xl border px-3 py-1.5 text-sm transition ${on ? "border-accent bg-accent/10 text-accent" : "border-line bg-bg2 text-muted hover:text-ink"}`}><span className="ltr-num font-semibold">{j.ref}</span> <span className="ltr-num text-xs opacity-80">· {j.points}</span></button></li>;
              })}
            </ul>
            {pick?.kind === "job" && canRequest && <p className="text-xs text-muted"><Link href={`/admin/requests/${data.jobs.find((j: any) => j.offerId === pick.offerId)?.requestId}`} className="text-accent hover:underline">{t("adm.open_request")}</Link></p>}
            {!pick ? <p className="text-sm text-muted">{t("dv2.replay_choose")}</p> : path.error ? <ErrorState error={path.error} retry={() => path.mutate()} /> : !path.data ? <PageLoading /> : (
              <>
                {path.data.thinned && <p className="text-xs text-muted">{t("dv2.replay_thinned", { n: path.data.points.length, total: path.data.total })}</p>}
                <PathReplay points={path.data.points} />
              </>
            )}
          </div>
        )}
      </Section>

      <Section title={t("dv2.avail_title")} description={t("dv2.avail_sub")}>
        {data.availability.length === 0 ? <p className="text-sm text-muted">{t("dv2.avail_none")}</p> : (
          <ol className="relative space-y-3 border-s border-line ps-4" data-testid="dv2-avail-log">
            {data.availability.map((e: any) => (
              <li key={e.id} className="relative text-sm">
                <span className={`absolute -start-[1.3rem] top-1.5 size-2.5 rounded-full ${e.to === "available" ? "bg-accent" : "bg-muted"}`} aria-hidden />
                <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                  <span><span className="font-medium">{e.to === "available" ? t("dv2.went_online") : t("dv2.went_offline")}</span>{" "}<Badge tone={e.source === "system" ? "warn" : e.source === "admin" ? "info" : "neutral"}>{t(`dv2.avail_src_${e.source}`)}</Badge>{e.reason && <span className="text-muted"> · {tx(`dv2.avail_reason_${e.reason}`, e.reason)}</span>}{e.actor && <span className="text-muted"> · {e.actor}</span>}</span>
                  <span className="ltr-num text-xs text-muted">{fmtDateTime(e.at, locale)}</span>
                </div>
              </li>
            ))}
          </ol>
        )}
      </Section>
    </div>
  );
}
