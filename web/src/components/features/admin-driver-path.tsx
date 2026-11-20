"use client";
import { useEffect, useMemo, useState } from "react";
import { Pause, Play, RotateCcw } from "lucide-react";
import { Button, EmptyState, Select, Stat, StatGrid } from "@/components/ui";
import { fmtDateTime, fmtDuration, fmtKm, fmtNum } from "@/lib/format";
import { useI18n } from "@/i18n/provider";
import { haversineM, pathSummary, projectPath, type PathPoint } from "@/server/details-people-lib";

const SPEEDS = [1, 4, 16];
/**
 * Replays a driver's sampled GPS path (one sample per minute at most) on a dependency-free plot: the whole path in a muted line, the part already travelled in the accent
 * colour, a marker for the current sample, a slider, play / pause and a speed. North is up and the picture is not mirrored in right-to-left languages (it is geography).
 */
export function PathReplay({ points, testId = "dv2-path" }: { points: PathPoint[]; testId?: string }) {
  // a different path starts again from its first sample (the key resets the replay state)
  return <Replay key={`${points.length}|${String(points[0]?.at)}|${String(points[points.length - 1]?.at)}`} points={points} testId={testId} />;
}
function Replay({ points, testId }: { points: PathPoint[]; testId: string }) {
  const { t, locale } = useI18n();
  const [i, setI] = useState(0); const [playing, setPlaying] = useState(false); const [speed, setSpeed] = useState(4);
  const xy = useMemo(() => projectPath(points), [points]); const sum = useMemo(() => pathSummary(points), [points]);
  useEffect(() => {
    if (!playing) return;
    const h = setInterval(() => setI((n) => { if (n >= points.length - 1) { setPlaying(false); return n; } return Math.min(points.length - 1, n + speed); }), 120);
    return () => clearInterval(h);
  }, [playing, speed, points.length]);
  if (points.length < 2) return <EmptyState title={t("dv2.replay_none")} hint={t("dv2.replay_none_hint")} />;
  const cur = points[i], pos = xy[i]; const d = (a: Array<{ x: number; y: number }>) => a.map((p, k) => `${k ? "L" : "M"}${p.x.toFixed(2)} ${p.y.toFixed(2)}`).join(" ");
  const kmh = i > 0 ? (() => { const gap = (new Date(cur.at).getTime() - new Date(points[i - 1].at).getTime()) / 1000; return gap > 0 && gap <= 900 ? (haversineM(points[i - 1], cur) / gap) * 3.6 : null; })() : null;
  return (
    <div className="space-y-4" data-testid={testId}>
      <StatGrid cols={4}>
        <Stat label={t("dv2.replay_points")} value={fmtNum(sum.points, locale)} tone="cyan" hint={t("dv2.replay_every")} />
        <Stat label={t("dv2.replay_distance")} value={fmtKm(sum.distanceM, locale)} tone="accent" />
        <Stat label={t("dv2.replay_duration")} value={fmtDuration(sum.durationS, locale)} tone="muted" hint={t("dv2.replay_moving", { m: fmtDuration(sum.movingS, locale), s: fmtDuration(sum.stoppedS, locale) })} />
        <Stat label={t("dv2.replay_speed")} value={sum.avgKmh != null ? `${fmtNum(Math.round(sum.avgKmh), locale)} km/h` : "—"} tone="gold" hint={sum.maxKmh != null ? t("dv2.replay_max", { n: Math.round(sum.maxKmh) }) : undefined} />
      </StatGrid>
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_16rem]">
        <div dir="ltr" className="overflow-hidden rounded-card border border-line bg-bg2">
          <svg viewBox="0 0 100 100" className="mx-auto block aspect-square max-h-[460px] w-full" role="img" aria-label={t("dv2.replay_label", { n: points.length })} data-testid={`${testId}-svg`}>
            <defs><pattern id="dv2-grid" width="10" height="10" patternUnits="userSpaceOnUse"><path d="M10 0H0V10" fill="none" stroke="var(--jr-line)" strokeWidth="0.25" /></pattern></defs>
            <rect width="100" height="100" fill="url(#dv2-grid)" />
            <path d={d(xy)} fill="none" stroke="var(--jr-muted)" strokeOpacity="0.55" strokeWidth="0.9" strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
            <path d={d(xy.slice(0, i + 1))} fill="none" stroke="var(--jr-accent)" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
            <rect x={xy[0].x - 1.6} y={xy[0].y - 1.6} width="3.2" height="3.2" fill="var(--jr-cyan)" rx="0.6"><title>{t("dv2.replay_start")}</title></rect>
            <circle cx={xy[xy.length - 1].x} cy={xy[xy.length - 1].y} r="1.8" fill="var(--jr-gold)"><title>{t("dv2.replay_end")}</title></circle>
            <circle cx={pos.x} cy={pos.y} r="3.4" fill="var(--jr-accent)" fillOpacity="0.22" /><circle cx={pos.x} cy={pos.y} r="1.7" fill="var(--jr-accent)" stroke="var(--jr-bg)" strokeWidth="0.5" />
          </svg>
        </div>
        <div className="space-y-3 rounded-card border border-line bg-card p-4 text-sm">
          <p className="ltr-num font-semibold tabular-nums" data-testid={`${testId}-time`}>{fmtDateTime(cur.at, locale)}</p>
          <dl className="grid grid-cols-2 gap-2 text-xs text-muted">
            <div><dt>{t("dv2.replay_speed")}</dt><dd className="ltr-num text-sm font-medium text-ink">{kmh != null ? `${Math.round(kmh)} km/h` : cur.speedMps != null ? `${Math.round(cur.speedMps * 3.6)} km/h` : "—"}</dd></div>
            <div><dt>{t("dv2.replay_accuracy")}</dt><dd className="ltr-num text-sm font-medium text-ink">{cur.accuracyM != null ? `±${Math.round(cur.accuracyM)} m` : "—"}</dd></div>
            <div className="col-span-2"><dt>{t("dv2.replay_position")}</dt><dd className="ltr-num text-sm font-medium text-ink">{cur.lat.toFixed(5)}, {cur.lng.toFixed(5)}</dd></div>
          </dl>
          <input type="range" min={0} max={points.length - 1} value={i} onChange={(e) => { setPlaying(false); setI(Number(e.target.value)); }} aria-label={t("dv2.replay_scrub")} className="w-full accent-[var(--jr-accent)]" dir="ltr" data-testid={`${testId}-scrub`} />
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" variant="secondary" onClick={() => { if (i >= points.length - 1) setI(0); setPlaying((p) => !p); }} data-testid={`${testId}-play`}>{playing ? <Pause className="size-4" aria-hidden /> : <Play className="size-4" aria-hidden />}{playing ? t("dv2.replay_pause") : t("dv2.replay_play")}</Button>
            <Button size="sm" variant="ghost" onClick={() => { setPlaying(false); setI(0); }} aria-label={t("dv2.replay_restart")}><RotateCcw className="size-4" aria-hidden /></Button>
            <div className="w-24"><Select aria-label={t("dv2.replay_rate")} value={String(speed)} onChange={(e) => setSpeed(Number(e.target.value))} options={SPEEDS.map((s) => ({ value: String(s), label: `${s}×` }))} /></div>
          </div>
        </div>
      </div>
    </div>
  );
}
