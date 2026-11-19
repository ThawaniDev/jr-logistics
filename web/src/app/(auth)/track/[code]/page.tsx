"use client";
import { Suspense, use } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { AlertTriangle, CheckCircle2, Package, PackageSearch, RefreshCw, Truck, WifiOff, XCircle } from "lucide-react";
import useSWR from "swr";
import { Button, Skeleton } from "@/components/ui";
import { ApiError, get } from "@/lib/api";
import { cn } from "@/lib/cn";
import { fmtDateTime } from "@/lib/format";
import { useI18n } from "@/i18n/provider";
import { TrackForm } from "../track-form";

const TERMINAL = ["delivered", "attempt_failed", "cancelled"];
interface Track { code: string; sender: string; stage: "preparing" | "on_the_way" | "arrived" | "delivered" | "attempt_failed" | "cancelled"; city: string; updatedAt: string; steps: { created?: string | null; handedToDriver?: string | null; deliveredAt?: string | null; attemptFailedAt?: string | null }; failReason?: string | null }

export default function TrackResultPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = use(params);
  return <Suspense fallback={<Skeleton className="h-96 w-full max-w-md" />}><Result code={decodeURIComponent(code)} /></Suspense>;
}

function Result({ code }: { code: string }) {
  const { t, locale } = useI18n();
  const p = useSearchParams().get("p") ?? "";
  const valid = /^\d{4}$/.test(p);
  // Public + rate-limited: never retry a wrong guess automatically.
  const { data, error, mutate, isValidating } = useSWR<Track>(valid ? `/track/${encodeURIComponent(code)}?p=${p}` : null, (k: string) => get<Track>(k), { revalidateOnFocus: false, shouldRetryOnError: false, refreshInterval: (d) => (d && TERMINAL.includes(d.stage) ? 0 : 60000) }); // stop polling once nothing can change

  const wrap = (children: React.ReactNode) => <div className="w-full max-w-md space-y-4">{children}</div>;
  const card = "glass-card-elevated rounded-3xl border border-line/80 p-6 shadow-2xl sm:p-8";
  if (!valid) return wrap(<div className={card}><p className="mb-4 text-sm text-muted">{t("bs.track_need_digits")}</p><TrackForm initialCode={code} /></div>);
  if (error) {
    const api = error instanceof ApiError ? error : null;
    const notFound = api?.code === "NOT_FOUND";
    const offline = !api; // the request never reached the server
    // The wrong-code message is deliberately identical whether the code exists or not.
    const title = notFound ? t("bs.track_not_found_title") : offline ? t("ux.d_track_offline_title") : t("common.error_title");
    const body = notFound ? t("bs.track_not_found") : offline ? t("ux.d_err_network") : api?.code === "RATE_LIMITED" ? t("ux.d_track_rate") : t("err.INTERNAL");
    return wrap(
      <div className={card} role="alert">
        <span className={cn("mx-auto mb-3 flex size-12 items-center justify-center rounded-2xl", offline ? "bg-gold/15 text-gold" : "bg-danger/15 text-danger")}>{offline ? <WifiOff className="size-6" aria-hidden /> : <AlertTriangle className="size-6" aria-hidden />}</span>
        <h1 className="text-center text-xl font-bold">{title}</h1>
        <p className="mb-5 mt-1 text-center text-sm text-muted">{body}</p>
        {!notFound && <Button type="button" variant="secondary" full size="lg" className="mb-4" loading={isValidating} onClick={() => void mutate()}><RefreshCw className="size-4" aria-hidden />{t("common.retry")}</Button>}
        <TrackForm initialCode={code} initialDigits={p} />
      </div>,
    );
  }
  if (!data) return wrap(<div aria-busy="true" role="status" aria-label={t("a11y.loading")}><Skeleton className="h-96 w-full" /></div>);

  const terminal = data.stage === "attempt_failed" || data.stage === "cancelled";
  const flow = [
    { key: "preparing", icon: Package, at: data.steps.created },
    { key: "on_the_way", icon: Truck, at: data.steps.handedToDriver },
    { key: "delivered", icon: CheckCircle2, at: data.steps.deliveredAt },
  ] as const;
  const idx = data.stage === "delivered" ? 2 : data.stage === "on_the_way" || data.stage === "arrived" ? 1 : 0;
  const city = (() => { const k = t(`city.${data.city}`); return k.startsWith("city.") ? data.city : k; })();
  const why = data.failReason ? (() => { const k = t(`stopfail.${data.failReason}`); return k.startsWith("stopfail.") ? null : k; })() : null;
  return wrap(
    <>
      <div className={card}>
        <p className="text-xs font-medium text-muted">{t("bs.track_parcel")}</p>
        <p className="ltr-num text-xl font-extrabold tracking-wide" dir="ltr">{data.code}</p>
        <dl className="mt-3 grid grid-cols-2 gap-3 text-sm">
          <div><dt className="text-xs text-muted">{t("bs.track_sender")}</dt><dd className="font-medium">{data.sender}</dd></div>
          <div><dt className="text-xs text-muted">{t("bs.track_city")}</dt><dd className="font-medium">{city}</dd></div>
        </dl>
      </div>
      <div className={card} aria-live="polite">
        <h1 className={cn("text-lg font-bold", data.stage === "delivered" && "text-accent", terminal && "text-danger")}>{t(`track.stage.${data.stage}`)}</h1>
        {why && data.stage === "attempt_failed" && <p className="mt-1 text-sm text-muted">{why}</p>}
        {terminal ? (
          <div className="mt-4 flex items-start gap-3 rounded-2xl border border-danger/40 bg-danger/5 p-4 text-sm">
            <XCircle className="mt-0.5 size-5 shrink-0 text-danger" aria-hidden />
            <div><p>{data.stage === "attempt_failed" ? t("bs.track_failed_help") : t("bs.track_cancelled_help")}</p>{data.steps.attemptFailedAt && data.stage === "attempt_failed" && <p className="mt-1 text-xs text-muted">{fmtDateTime(data.steps.attemptFailedAt, locale)}</p>}</div>
          </div>
        ) : (
          <ol className="mt-5 flex items-start" aria-label={t("bs.track_progress")}>
            {flow.map((s, i) => {
              const done = i <= idx; const current = i === idx; const I = s.icon;
              return (
                <li key={s.key} className="relative flex flex-1 flex-col items-center text-center" aria-current={current ? "step" : undefined}>
                  {i > 0 && <span className={cn("absolute end-1/2 top-5 h-0.5 w-full -translate-y-1/2", i <= idx ? "bg-accent" : "bg-line")} aria-hidden />}
                  <span className={cn("relative z-10 flex size-10 items-center justify-center rounded-full border-2", done ? "border-accent bg-accent text-accent-ink" : "border-line bg-card text-muted", current && data.stage !== "delivered" && "ring-4 ring-accent/25")}><I className="size-5" aria-hidden /></span>
                  <span className={cn("mt-2 px-1 text-xs leading-snug", done ? "font-semibold text-ink" : "text-muted")}>{t(`track.stage.${current && data.stage === "arrived" ? "arrived" : s.key}`)}</span>
                  {s.at && done && <span className="mt-0.5 px-1 text-[11px] text-muted">{fmtDateTime(s.at, locale)}</span>}
                </li>
              );
            })}
          </ol>
        )}
        {(data.stage === "on_the_way" || data.stage === "arrived") && (
          <p className="mt-5 rounded-2xl border border-accent/30 bg-accent/10 p-4 text-sm leading-relaxed">{t(data.stage === "arrived" ? "ux.d_track_tip_arrived" : "ux.d_track_tip_onway")}</p>
        )}
        {data.stage === "delivered" && data.steps.deliveredAt && <p className="mt-4 text-sm text-muted">{t("ux.d_track_delivered_at", { time: fmtDateTime(data.steps.deliveredAt, locale) })}</p>}
        <div className="mt-5 flex items-center justify-between gap-3 border-t border-line pt-3 text-xs text-muted">
          <p>{t("bs.track_updated", { time: fmtDateTime(data.updatedAt, locale) })}</p>
          {!TERMINAL.includes(data.stage) && <button type="button" onClick={() => void mutate()} disabled={isValidating} className="inline-flex min-h-11 items-center gap-1.5 font-medium text-cyan hover:underline disabled:opacity-60"><RefreshCw className={cn("size-3.5", isValidating && "animate-spin")} aria-hidden />{t("ux.d_track_refresh")}</button>}
        </div>
        <p className="border-t border-line pt-3 text-xs text-muted">{t("ux.d_track_questions", { sender: data.sender })}</p>
      </div>
      <p className="text-center text-sm"><Link href="/track" className="inline-flex items-center gap-1.5 text-cyan hover:underline"><PackageSearch className="size-4" aria-hidden />{t("bs.track_another")}</Link></p>
    </>,
  );
}
