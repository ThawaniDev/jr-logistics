import { jobStats } from "./driver-fieldops-utils";

/**
 * J5 — what the stat cards of an order card show. The server sends `job.stats` for every card (offered, accepted, active, history); an older
 * server that does not is read from `stopsSummary` / `cod` as before, so a card never crashes and never shows invented numbers.
 */
export interface CardCod { parcels: number; toCollectCents: number; collectedCents: number; handedOverCents: number | null; outstandingCents: number | null }
export interface CardStats { total: number; toDeliver: number; delivered: number; notDelivered: number; failed: number; returned: number; estimated: boolean; cod: CardCod | null }

/** Offer states after which nothing is left to deliver: the card shows the final result instead of the work still to do. */
export const FINAL_STATUSES = ["completed", "cancelled", "no_show", "rejected", "expired", "replaced"];
export const isFinalJob = (job: { status?: string }) => FINAL_STATUSES.includes(job.status ?? "");

const n = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? Math.max(0, Math.trunc(v)) : 0);

export function cardStatsOf(job: { stats?: unknown; stopsSummary?: unknown; cod?: unknown }): CardStats | null {
  const s = job.stats as Partial<CardStats> | null | undefined;
  if (s && typeof s === "object" && typeof s.total === "number") {
    const c = s.cod;
    return {
      total: n(s.total), toDeliver: n(s.toDeliver), delivered: n(s.delivered), notDelivered: n(s.notDelivered), failed: n(s.failed), returned: n(s.returned), estimated: s.estimated === true,
      cod: c ? { parcels: n(c.parcels), toCollectCents: n(c.toCollectCents), collectedCents: n(c.collectedCents), handedOverCents: n(c.handedOverCents), outstandingCents: n(c.outstandingCents) } : null,
    };
  }
  const old = jobStats(job.stopsSummary as Parameters<typeof jobStats>[0], job.cod as Parameters<typeof jobStats>[1]);
  if (!old || old.total <= 0) return null;
  return { total: old.total, toDeliver: old.toDeliver, delivered: old.delivered, notDelivered: old.notDelivered, failed: 0, returned: 0, estimated: false, cod: old.cod ? { ...old.cod, handedOverCents: null, outstandingCents: null } : null };
}
