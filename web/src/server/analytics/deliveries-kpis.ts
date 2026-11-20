import type { ResolvedFilters } from "./filters";
import { add, makeKpis, ratio, z, type Pair } from "./finance-core";
import type { Kpi } from "./kpi";
import "./deliveries-defs";
import type { FlowFacts, JobFacts, TimingFacts } from "./deliveries-facts";

export interface DeliveryFacts { flow: FlowFacts; timing: TimingFacts; jobs: JobFacts; otpBad: Pair; otpOk: Pair }

/** The KPI objects of the Deliveries report from the raw facts (pure: unit-tested). `spark` carries one number per bucket for the KPIs that have a series. */
export function deliveryKpis(x: DeliveryFacts, f: ResolvedFilters, spark: Record<string, Array<number | null> | undefined> = {}): Kpi[] {
  const { flow: a, timing: t, jobs: j } = x;
  const resolved = add(a.delivered, a.failed, a.returned);
  return makeKpis(f, [
    ["dlv_created", z(a.created)], ["dlv_handed", z(a.handed)], ["parcels_delivered", z(a.delivered)], ["dlv_failed", z(a.failed)], ["dlv_returned", z(a.returned)],
    ["dlv_missing", z(a.missing)], ["dlv_pending", z(a.pending)], ["delivery_success", ratio(a.delivered, resolved)],
    ["first_attempt", ratio(a.first, a.delivered)], ["dlv_attempts_avg", ratio(a.attempts, a.delivered)], ["dlv_defer_rate", ratio(a.deferred, resolved)],
    ["dlv_return_rate", ratio(a.returned, resolved)], ["dlv_return_time", ratio(a.ret_secs, a.ret_n)], ["dlv_incomplete_rate", ratio(a.incomplete, a.created)],
    ["dlv_b2b_share", ratio(a.b2b_created, a.created)], ["dlv_b2c_success", ratio(a.b2c_del, a.b2c_res)], ["dlv_b2b_success", ratio(a.b2b_del, a.b2b_res)],
    ["dlv_evidence_rate", ratio(a.evidence, a.delivered)], ["dlv_otp_fail_rate", ratio(x.otpBad, add(x.otpBad, x.otpOk))], ["dlv_far_rate", ratio(t.far, t.dist_n)],
    ["dlv_time_p50", t.time_p50], ["dlv_time_p90", t.time_p90], ["dlv_dwell_p50", t.dwell_p50], ["dlv_dist_p50", t.dist_p50], ["dlv_dist_p90", t.dist_p90],
    ["dlv_sms_per_parcel", ratio(a.sms, resolved)], ["dlv_parcels_per_job", ratio(j.del, j.jobs)], ["dlv_stops_per_hour", ratio(j.stopsN, j.stopsHrs)], ["dlv_leg_ratio", ratio(j.actual, j.planned)],
  ], spark);
}
