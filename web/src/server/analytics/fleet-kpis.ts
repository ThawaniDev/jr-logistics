import { defineKpis, kpiDef } from "./definitions";
import type { ResolvedFilters } from "./filters";
import { makeKpi, type Kpi } from "./kpi";
import { kdef, ratioPair, zeroPair, type Pair } from "./companies-lib";

/**
 * The fleet KPIs added to the Drivers and the Courier offices reports (prefix `fr.`, keys `fl_*`): lateness, warehouse and route times, distance, offer outcomes, activity, efficiency, complaints.
 * They are the ratios of the SUMS over the selected drivers (never an average of averages). `first_attempt` is the Overview's KPI (same definition). Durations are seconds, `fl_arrival_delta` is
 * minutes (signed: negative = early), distances are km, ratios fractions 0–1. Pure: `fleetKpis` only does arithmetic on the totals of `fleet-facts.ts`.
 */
const k = kdef("fr");
const REQUEST_FILTERS = ["service", "vehicle", "status", "channel", "company", "city"] as const;

defineKpis("fleet", [
  k("fl_late", "percent", "lower", { ratio: true }), k("fl_very_late", "percent", "lower", { ratio: true }), k("fl_late_avg", "duration", "lower", { ratio: true }),
  k("fl_arrival_delta", "rate", "lower", { ratio: true }), k("fl_wait", "duration", "lower", { ratio: true }), k("fl_load", "duration", "lower", { ratio: true }),
  k("fl_stop_time", "duration", "lower", { ratio: true }), k("fl_parcel_time", "duration", "lower", { ratio: true }), k("fl_job_time", "duration", "neutral", { ratio: true }),
  k("fl_radius", "rate", "neutral"), k("fl_route", "rate", "neutral"),
  k("fl_decline_rate", "percent", "lower", { ratio: true }), k("fl_timeout_rate", "percent", "lower", { ratio: true }), k("fl_resp_avg", "duration", "lower", { ratio: true }),
  k("fl_active_days", "count", "higher"), k("fl_online_days", "count", "higher", { notFilteredBy: REQUEST_FILTERS }),
  k("fl_efficiency", "rate", "higher", { ratio: true, notFilteredBy: REQUEST_FILTERS }), k("fl_parcels_per_job", "rate", "higher", { ratio: true }),
  k("fl_complaints", "count", "lower"), k("fl_cod_held", "money", "lower", { money: true }),
]);
/** Keys in card order, per report (the COD balance is on the Drivers report already as `flt_cash`; `first_attempt` is the Overview's KPI). */
const COMMON = ["fl_late", "fl_very_late", "fl_late_avg", "fl_arrival_delta", "fl_wait", "fl_load", "fl_stop_time", "fl_parcel_time", "fl_job_time", "fl_radius", "fl_route", "fl_decline_rate", "fl_timeout_rate",
  "fl_resp_avg", "fl_active_days", "fl_online_days", "fl_efficiency", "fl_parcels_per_job", "first_attempt", "fl_complaints"] as const;
export const FLEET_DRIVER_KPI_KEYS = COMMON;
export const FLEET_OFFICE_KPI_KEYS = [...COMMON, "fl_cod_held"] as const;
export type FleetKind = "drivers" | "offices";
/** Totals of the additive base columns (`fleet-facts.ts`): `{ cur, prev }` per name (`late`, `late_sec`, `declined` …). */
export type Totals = Record<string, Pair>;

const add = (...p: Pair[]): Pair => ({ cur: p.reduce((s, x) => s + (x.cur ?? 0), 0), prev: p.some((x) => x.prev == null) ? null : p.reduce((s, x) => s + (x.prev ?? 0), 0) });
const NONE: Pair = { cur: null, prev: null };
const scale = (p: Pair, by: number): Pair => ({ cur: p.cur == null ? null : p.cur * by, prev: p.prev == null ? null : p.prev * by });
const at = (t: Totals, n: string): Pair => t[n] ?? NONE;

/** The KPI objects of the fleet from the totals over the selected drivers (pure: unit-tested). Money KPIs are left out without finance access. */
export function fleetKpis(t: Totals, f: ResolvedFilters, money: boolean, kind: FleetKind): Kpi[] {
  const arrived = add(at(t, "punctual"), at(t, "late"), at(t, "very_late")), late = add(at(t, "late"), at(t, "very_late"));
  const hours = scale(at(t, "online"), 1 / 3600);
  const out: Array<[string, Pair]> = [
    ["fl_late", ratioPair(late, arrived)], ["fl_very_late", ratioPair(at(t, "very_late"), arrived)], ["fl_late_avg", ratioPair(at(t, "late_sec"), late)],
    ["fl_arrival_delta", scale(ratioPair(at(t, "delta_sec"), arrived), 1 / 60)], ["fl_wait", ratioPair(at(t, "wait_sec"), at(t, "wait_n"))], ["fl_load", ratioPair(at(t, "load_sec"), at(t, "load_n"))],
    ["fl_stop_time", ratioPair(at(t, "stop_sec"), at(t, "stop_n"))], ["fl_parcel_time", ratioPair(at(t, "parcel_sec"), at(t, "parcel_n"))], ["fl_job_time", ratioPair(at(t, "job_sec"), at(t, "job_n"))],
    ["fl_radius", scale(at(t, "radius_m"), 1 / 1000)], ["fl_route", scale(at(t, "route_m"), 1 / 1000)],
    ["fl_decline_rate", ratioPair(add(at(t, "declined"), at(t, "timedout")), at(t, "offered"))], ["fl_timeout_rate", ratioPair(at(t, "timedout"), at(t, "offered"))], ["fl_resp_avg", ratioPair(at(t, "resp_sec"), at(t, "resp_n"))],
    ["fl_active_days", zeroPair(at(t, "active_days"))], ["fl_online_days", zeroPair(at(t, "online_days"))], ["fl_efficiency", ratioPair(at(t, "deliv"), hours)],
    ["fl_parcels_per_job", ratioPair(at(t, "deliv"), at(t, "jobs"))], ["first_attempt", ratioPair(at(t, "first_att"), at(t, "deliv"))], ["fl_complaints", zeroPair(at(t, "complaints"))],
  ];
  if (money && kind === "offices") out.push(["fl_cod_held", { cur: at(t, "cod_held").cur, prev: null }]);
  return out.map(([key, p]) => {
    const un = f.active.filter((a) => (kpiDef(key).notFilteredBy ?? []).includes(a));
    return makeKpi(key, p.cur, p.prev, un.length ? { unfiltered: [...un] } : {});
  });
}
