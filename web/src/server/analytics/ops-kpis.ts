import { ignoredFilters } from "./conditions";
import { kpiDef } from "./definitions";
import type { ResolvedFilters } from "./filters";
import { makeKpi, type Kpi } from "./kpi";
import type { cancelFacts, cancelPolicy } from "./ops-cancel";
import type { demandFacts, speedFacts } from "./ops-demand";
import type { ExecFacts, stopsFacts, loadingFacts } from "./ops-exec";
import "./ops-defs";
import type { OfferFacts } from "./ops-offers";
import type { SupplyFacts } from "./ops-supply";
import { add, ratio, scale, sub, z, type Pair } from "./ops-util";

/** The raw facts of the Operations report; a group is null when its section failed (its KPIs are then left out, never shown as 0). */
export interface OpsFacts {
  demand: Awaited<ReturnType<typeof demandFacts>> | null;
  speed: Awaited<ReturnType<typeof speedFacts>> | null;
  offers: OfferFacts | null;
  exec: ExecFacts | null;
  stops: Awaited<ReturnType<typeof stopsFacts>> | null;
  loading: Awaited<ReturnType<typeof loadingFacts>> | null;
  supply: SupplyFacts | null;
  cancel: Awaited<ReturnType<typeof cancelFacts>> | null;
  policy: Awaited<ReturnType<typeof cancelPolicy>> | null;
}
type Extra = Partial<Pick<Kpi, "href" | "spark">>;

/**
 * The KPI objects of the Operations report from the raw facts (pure, unit-tested). `spark` carries one number per bucket for the KPIs that have a series.
 * Order = the order of `OPS_KPI_GROUPS`. Money KPIs are produced only when `money` (and the facts exist).
 */
export function opsKpis(facts: OpsFacts, f: ResolvedFilters, spark: Record<string, Array<number | null> | undefined> = {}, money = true): Kpi[] {
  const { demand: d, speed: s, offers: o, exec: e, stops, loading: l, supply: sp, cancel: c, policy: p } = facts;
  const out: Array<[string, Pair, Extra?]> = [];
  const put = (key: string, pair: Pair | null | undefined, extra?: Extra) => { if (pair) out.push([key, pair, extra]); };

  if (d) {
    put("requests_created", z(d.created), { href: "/admin/requests" });
    put("ops_published", z(d.published));
    put("ops_fill_rate", ratio(d.filled, d.slots));
    put("ops_fully_filled", ratio(d.full, d.cohort));
    put("ops_unfilled_slots", z(sub(d.slots, d.filled)), { href: "/admin/operations" });
  }
  if (s) { put("ops_first_offer_p50", s.offer.p50); put("ops_first_accept_p50", s.accept.p50); put("ops_fill_p50", s.fill.p50); put("ops_fill_p90", s.fill.p90); }
  if (d) { put("ops_expiry_rate", ratio(d.expired, d.driven)); put("ops_aon_failed", ratio(d.aonFailed, d.aon)); }
  if (o) { put("ops_manual_share", ratio(o.manual, o.accepted)); put("ops_replacement_rate", ratio(o.lost, o.accepted)); }

  if (e) {
    put("on_time_start", ratio(e.onTime, e.due));
    put("ops_delay_p90", e.delay.p90); put("ops_no_show_rate", ratio(e.noShow, e.due)); put("ops_arrival_distance", e.distance.p50);
    put("ops_loading_p50", e.loading.p50);
  }
  if (l) put("ops_scan_share", ratio(l.scan, add(l.scan, l.warehouse)));
  if (e) {
    put("ops_route_approval_p50", e.approval.p50); put("ops_job_duration_p50", e.job.p50); put("ops_parcels_per_job", ratio(e.parcels, e.parcelJobs));
  }
  if (stops) put("ops_stops_per_hour", scale(ratio(stops.stops, stops.secs), 3600));
  if (e) put("ops_completion_rate", ratio(e.finished, e.started));

  if (o) { put("ops_offer_acceptance", ratio(o.accepted, o.offered)); put("ops_response_p50", o.response.p50); }
  if (sp) {
    put("ops_utilisation", ratio(sp.sumBusy, add(sp.sumBusy, sp.sumAvailable)));
    put("ops_drivers_available", sp.available); put("ops_slots_open", sp.unfilled);
  }
  if (d) put("cancellation_rate", ratio(d.cancelled, d.created), { href: "/admin/cancellations" });
  if (c) {
    put("ops_cancelled_requests", z(c.requests), { href: "/admin/cancellations" }); put("ops_driver_cancels", z(c.driverCancels), { href: "/admin/cancellations" });
    put("ops_late_cancel_share", ratio(c.lateRequests, c.requests));
  }
  if (p) put("ops_strikes", p.strikes);
  if (money && p?.refunds) put("ops_refunds_released", z(p.refunds));

  return out.map(([key, pair, extra]) => {
    const unfiltered = ignoredFilters(f, kpiDef(key).notFilteredBy ?? []);
    return makeKpi(key, pair.cur, pair.prev, { ...extra, spark: spark[key], ...(unfiltered.length ? { unfiltered } : {}) });
  });
}
