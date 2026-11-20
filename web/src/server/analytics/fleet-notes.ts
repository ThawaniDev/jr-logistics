import type { ResolvedFilters } from "./filters";
import { FLEET } from "./fleet-lib";

/**
 * The "how to read this" lines of the fleet tables (the Notes sheet of an export, the disclosure under a table): the period, which date each measure counts on, who is in the numbers,
 * how distances are measured and what the data cannot say. Pure and localizable: each line is `{ key, vars }` with `fr.note_*` keys (en + ar + ur in `rd-fleet.ts`); the caller translates.
 * `tables` limits the lines to the tables being exported (all of them when omitted); `money: false` leaves out the money lines.
 */
export interface FleetNote { key: string; vars?: Record<string, string | number> }
export interface FleetNoteSet { report: "drivers" | "offices"; tables?: readonly string[]; money?: boolean }
const REQUEST_FILTERS = ["service", "vehicle", "status", "channel", "company", "city"] as const;

export function fleetNotes(set: FleetNoteSet | "drivers" | "offices", f: ResolvedFilters, opts: { grace?: number } = {}): FleetNote[] {
  const s: FleetNoteSet = typeof set === "string" ? { report: set } : set;
  const offices = s.report === "offices";
  const has = (...t: string[]) => !s.tables || t.some((x) => s.tables!.includes(x));
  const money = s.money !== false && has("money", "money_daily", "earnings", "perf", "daily", "jobs");
  const grace = opts.grace;
  const out: FleetNote[] = [{ key: "fr.note_period", vars: { from: f.cur.from, to: f.cur.to, days: f.cur.days } }];
  if (f.prev) out.push({ key: "fr.note_compare", vars: { from: f.prev.from, to: f.prev.to } });
  if (f.active.some((k) => (REQUEST_FILTERS as readonly string[]).includes(k))) out.push({ key: "fr.note_filters_online" });
  // who is in the numbers
  out.push({ key: offices ? "fr.note_pop_offices" : "fr.note_pop_drivers" });
  if (offices && has("perf", "money")) out.push({ key: f.office.length ? "fr.note_pop_selected" : "fr.note_pop_independent" });
  if (offices) out.push({ key: "fr.note_pop_attribution" });
  if (offices && has("daily", "money_daily", "jobs", "earnings", "failures")) out.push({ key: "fr.note_pop_office_work" });
  // which date each measure counts on
  out.push({ key: "fr.note_anchor_offers" }, { key: "fr.note_anchor_jobs" });
  out.push(grace == null ? { key: "fr.note_anchor_punctuality" } : { key: "fr.note_anchor_punctuality_g", vars: { grace } });
  out.push({ key: "fr.note_anchor_parcels" }, { key: "fr.note_anchor_online" });
  if (has("daily", "money_daily")) out.push({ key: "fr.note_daily", vars: { max: FLEET.maxDailyDays } });
  // how averages and distances are formed
  out.push({ key: "fr.note_averages", vars: { hours: FLEET.maxStepSec / 3600, stop: FLEET.maxStopSec / 3600 } });
  if (has("perf", "daily", "jobs")) out.push({ key: "fr.note_lateness", vars: { hours: FLEET.maxStepSec / 3600 } });
  if (has("perf", "daily", "jobs")) out.push({ key: "fr.note_radius" }, { key: "fr.note_route" }, { key: "fr.note_gps", vars: { drivers: FLEET.gps.maxDrivers, gap: FLEET.gps.gapSec / 60, jump: FLEET.gps.jumpM / 1000, accuracy: FLEET.gps.accuracyM } });
  if (has("perf")) out.push({ key: "fr.note_complaints" });
  if (has("failures")) out.push({ key: "fr.note_failures" });
  if (money) out.push({ key: "fr.note_money" }, { key: "fr.note_cod" });
  // the honest gaps (decision I10)
  out.push({ key: "fr.note_gap_warehouse" }, { key: "fr.note_gap_route" }, { key: "fr.note_gap_gps" }, { key: "fr.note_gap_fines" }, { key: "fr.note_gap_promise" });
  return out;
}
