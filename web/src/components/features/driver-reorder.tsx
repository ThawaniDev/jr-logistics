"use client";
import { useState, type ReactNode } from "react";
import { ArrowDown, ArrowUp, ChevronDown, ChevronsUp, Lock, RotateCcw, Save } from "lucide-react";
import { toast } from "sonner";
import { Badge, Button, Notice } from "@/components/ui";
import { useDriverAction } from "./driver-action";
import { ApiError, post } from "@/lib/api";
import { fmtNum } from "@/lib/format";
import { useI18n } from "@/i18n/provider";
import { cn } from "@/lib/cn";
import { StopRouteInfo } from "./driver-route";
import { makeNextIds, moveStopBy, movableStops, isPinnedStop, isResolvedStop, reconcileDraft, reorderPayload, sameOrder } from "./driver-fieldops-utils";
import { RecipientBadge, type RouteInfo, type Stop } from "./driver-stops-shared";

interface ReorderResult { plan?: unknown; currentId?: string | null; job?: any }

/** `POST /offers/:id/route/reorder` — the server accepts exactly the movable stops (not resolved, not the one the driver has arrived at). */
export function reorderRequest(offerId: string, ids: string[]) { return post<ReorderResult>(`/offers/${offerId}/route/reorder`, reorderPayload(ids)); }

/** "Make next" straight from a popup: the stop goes to the front of the movable stops and the order is saved at once. */
export function makeNextRequest(offerId: string, stops: Stop[], stopId: string) { return reorderRequest(offerId, makeNextIds(movableStops(stops).map((s) => s.id), stopId)); }

/** Why re-ordering is not available (null = it is, or nothing to explain). */
export function ReorderOff({ route, job }: { route: RouteInfo | null; job: unknown }) {
  const { t } = useI18n();
  // Only say "turned off" when the server told us the setting is off — fewer than two movable stops, or loading not finished, is not worth a notice.
  const pol = (job as { policy?: { canReorderRoute?: unknown } } | null)?.policy;
  if (!route || route.canReorder || !pol || pol.canReorderRoute !== false) return null;
  return <div data-testid="reorder-off"><Notice tone="info">{t("fod.reorder_off")}</Notice></div>;
}

/**
 * Draft + save logic of the manual order. The draft survives background refreshes (new ids appended, vanished ones dropped) and is dropped after saving.
 */
export function useStopReorder({ stops, offerId, onJob, onRefresh }: { stops: Stop[]; offerId: string; onJob?: (job: any) => void; onRefresh: () => void }) {
  const { t } = useI18n(); const a = useDriverAction();
  const movable = movableStops(stops);
  const base = movable.map((s) => s.id);
  // The draft belongs to the server order it was made from: if that order changes underneath (re-optimise, a stop finished) the draft is dropped.
  const baseSig = base.join(",");
  const [draftState, setDraft] = useState<{ ids: string[]; from: string } | null>(null);
  const draft = draftState && draftState.from === baseSig ? draftState.ids : null;
  const ids = draft ? reconcileDraft(draft, base) : base;
  const dirty = !sameOrder(ids, base);
  const byId = new Map(movable.map((s) => [s.id, s]));
  const currentId = stops.find((s) => s.current)?.id ?? null;
  const apply = (next: string[]) => setDraft(sameOrder(next, base) ? null : { ids: next, from: baseSig });

  const save = () => a.run("reorder", () => reorderRequest(offerId, ids), {
    onDone: (res) => {
      setDraft(null);
      toast.success(t(res.currentId && currentId && res.currentId !== currentId ? "fod.reorder_saved_next" : "fod.reorder_saved"));
      if (res.job) onJob?.(res.job); else onRefresh();
    },
    onError: (e) => { if (e instanceof ApiError) { setDraft(null); onRefresh(); if (e.code === "VALIDATION") toast.error(t("fod.reorder_stale")); } },
  });
  return {
    ordered: ids.map((id) => byId.get(id)).filter((s): s is Stop => !!s), dirty, saving: a.is("reorder"),
    move: (id: string, d: -1 | 1) => apply(moveStopBy(ids, id, d)), makeNext: (id: string) => apply(makeNextIds(ids, id)), reset: () => setDraft(null), save,
  };
}

/**
 * The re-orderable stops: up / down buttons and "Make next" per row (big touch targets), then "Save order".
 * `firstNo` = the route position of the first movable stop (finished stops and the pinned one come before it).
 */
export function ReorderList({ stops, offerId, firstNo, onJob, onRefresh, extra }: { stops: Stop[]; offerId: string; firstNo: number; onJob?: (job: any) => void; onRefresh: () => void; extra?: (s: Stop, i: number) => ReactNode }) {
  const { t, locale } = useI18n();
  const r = useStopReorder({ stops, offerId, onJob, onRefresh });
  const pinned = stops.find((s) => isPinnedStop(s));
  const total = stops.length;
  return (
    <div className="space-y-3" data-testid="reorder-list">
      <p className="text-sm text-muted">{t("fod.reorder_hint")}</p>
      <ol className="space-y-2">
        {pinned && (
          <li data-testid="reorder-pinned" data-code={pinned.code} className="flex items-center gap-3 rounded-card border border-line bg-bg2 p-3 text-sm">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-bg text-muted"><Lock className="size-4" aria-hidden /></span>
            <div className="min-w-0 flex-1"><p className="font-medium">{pinned.address}</p><p className="text-xs text-muted">{t("fod.reorder_pinned")}</p></div>
          </li>
        )}
        {r.ordered.map((s, i) => (
          <li key={s.id} data-testid="reorder-row" data-code={s.code} className={cn("flex gap-3 rounded-card border bg-card p-3", i === 0 ? "border-accent/50" : "border-line")}>
            <span className="ltr-num flex size-9 shrink-0 items-center justify-center rounded-full bg-bg2 text-sm font-bold text-accent" aria-label={t("dstop.stop_x_of_n", { x: firstNo + i, n: total })}>{fmtNum(firstNo + i, locale)}</span>
            <div className="min-w-0 flex-1 space-y-1 text-sm">
              <p className="font-medium">{s.address}{s.city && <span className="text-muted"> · {t(`city.${s.city}`)}</span>}</p>
              <StopRouteInfo stop={s} first={i === 0 && !pinned && firstNo === 1} hint />
              {s.contents && <p className="text-muted">{s.contents}</p>}
              <div className="flex flex-wrap items-center gap-2 pt-0.5"><RecipientBadge type={s.recipientType} /><span className="ltr-num text-xs text-muted">{s.code}</span>{i === 0 && <Badge tone="success">{t("fod.reorder_next_badge")}</Badge>}{extra?.(s, i)}</div>
            </div>
            <div className="flex shrink-0 flex-col gap-1.5">
              <div className="flex gap-1.5">
                <button type="button" data-testid="reorder-up" data-code={s.code} aria-label={t("fod.reorder_up")} disabled={i === 0 || r.saving} onClick={() => r.move(s.id, -1)} className="flex size-11 items-center justify-center rounded-xl border-2 border-line bg-bg2 text-ink disabled:opacity-35"><ArrowUp className="size-5" aria-hidden /></button>
                <button type="button" data-testid="reorder-down" data-code={s.code} aria-label={t("fod.reorder_down")} disabled={i === r.ordered.length - 1 || r.saving} onClick={() => r.move(s.id, 1)} className="flex size-11 items-center justify-center rounded-xl border-2 border-line bg-bg2 text-ink disabled:opacity-35"><ArrowDown className="size-5" aria-hidden /></button>
              </div>
              <button type="button" data-testid="reorder-make-next" data-code={s.code} disabled={i === 0 || r.saving} onClick={() => r.makeNext(s.id)} className="flex h-11 items-center justify-center gap-1 rounded-xl border-2 border-accent/50 bg-accent/10 px-2 text-xs font-semibold text-accent disabled:opacity-35"><ChevronsUp className="size-4" aria-hidden />{t("fod.make_next")}</button>
            </div>
          </li>
        ))}
      </ol>
      <div className="grid grid-cols-2 gap-2">
        <Button type="button" data-testid="reorder-reset" variant="secondary" size="lg" disabled={!r.dirty || r.saving} onClick={r.reset}><RotateCcw className="size-4" aria-hidden />{t("fod.reorder_reset")}</Button>
        <Button type="button" data-testid="reorder-save" size="lg" loading={r.saving} disabled={!r.dirty} onClick={r.save}><Save className="size-4" aria-hidden />{t("fod.reorder_save")}</Button>
      </div>
      {r.dirty && <p role="status" className="text-xs text-gold">{t("fod.reorder_unsaved")}</p>}
    </div>
  );
}

/** Collapsible "Upcoming stops — change the order" block of the working screen (collapsed until the driver wants it). */
export function ReorderSection({ stops, offerId, onJob, onRefresh }: { stops: Stop[]; offerId: string; onJob?: (job: any) => void; onRefresh: () => void }) {
  const { t, locale } = useI18n();
  const movable = movableStops(stops);
  const done = stops.filter((s) => isResolvedStop(s)).length + (stops.some((s) => isPinnedStop(s)) ? 1 : 0);
  if (movable.length < 2) return null;
  return (
    <details data-testid="reorder-panel" className="group rounded-card border border-line bg-card">
      <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between gap-2 px-4 py-3 font-semibold [&::-webkit-details-marker]:hidden">
        <span className="flex items-center gap-2">{t("fod.reorder_title")}<Badge>{fmtNum(movable.length, locale)}</Badge></span><ChevronDown className="size-5 text-muted transition group-open:rotate-180" aria-hidden />
      </summary>
      <div className="border-t border-line p-3"><ReorderList stops={stops} offerId={offerId} firstNo={done + 1} onJob={onJob} onRefresh={onRefresh} /></div>
    </details>
  );
}
