/**
 * ONE definition per KPI (decision G8). A KPI is registered here with the i18n keys of its label, its definition sentence and, for ratios and averages, what is
 * counted on top (`numerator`) and below (`denominator`); the UI shows them as the card's tooltip and in the report's legend. Nothing else in the code base may
 * describe a KPI, so a number can never be explained two different ways.
 *
 * Key convention (en + ar + ur in your own fragment): label `<prefix>.kpi_<key>`, definition `<prefix>.def_<key>`, `<prefix>.def_<key>_n`, `<prefix>.def_<key>_d`.
 * KPI keys are global: reuse a key (and so its definition) when another report shows the same number, prefix a new key with your report otherwise (`ops_late_rate`).
 */
export type Unit = "count" | "money" | "percent" | "duration" | "rate";
export type Good = "higher" | "lower" | "neutral";
export interface KpiDef {
  key: string; unit: Unit; good: Good;
  /** Needs `finance.view` (the number is omitted for everybody else). */
  money?: boolean;
  label: string; definition: string; numerator?: string; denominator?: string;
  /** Filters that cannot narrow this KPI (a signup has no service); the card says so when one of them is active. */
  notFilteredBy?: readonly string[];
}

const REG = new Map<string, { owner: string; def: KpiDef }>();
const CONFLICTS: string[] = [];
/** Registers KPI definitions. `owner` is the report (`"overview"`); registering the same key from another owner is recorded as a conflict (a unit test fails on it). */
export function defineKpis(owner: string, defs: KpiDef[]) {
  for (const def of defs) {
    const had = REG.get(def.key);
    if (had && had.owner !== owner) CONFLICTS.push(`${def.key}: ${had.owner} / ${owner}`);
    REG.set(def.key, { owner, def });
  }
}
export function kpiDef(key: string): KpiDef {
  const d = REG.get(key)?.def;
  if (!d) throw new Error(`Unknown KPI "${key}": register it with defineKpis()`);
  return d;
}
export const allKpiDefs = (): KpiDef[] => [...REG.values()].map((x) => x.def);
export const kpiConflicts = (): string[] => [...CONFLICTS];

const k = (key: string, unit: Unit, good: Good, o: Partial<KpiDef> & { ratio?: boolean } = {}): KpiDef => {
  const { ratio, ...rest } = o;
  return { key, unit, good, label: `rpf.kpi_${key}`, definition: `rpf.def_${key}`, ...(ratio ? { numerator: `rpf.def_${key}_n`, denominator: `rpf.def_${key}_d` } : {}), ...rest };
};
const NO_SIGNUP_FILTERS = ["service", "vehicle", "status", "channel", "company", "office", "driver"] as const;

defineKpis("overview", [
  k("gmv", "money", "higher", { money: true }),
  k("revenue", "money", "higher", { money: true }),
  k("margin_pct", "percent", "higher", { money: true, ratio: true }),
  k("aov", "money", "higher", { money: true, ratio: true }),
  k("requests_created", "count", "higher"),
  k("requests_completed", "count", "higher"),
  k("parcels_delivered", "count", "higher"),
  k("delivery_success", "percent", "higher", { ratio: true }),
  k("first_attempt", "percent", "higher", { ratio: true }),
  k("cancellation_rate", "percent", "lower", { ratio: true }),
  k("active_companies", "count", "higher"),
  k("active_drivers", "count", "higher"),
  k("new_signups", "count", "higher", { notFilteredBy: NO_SIGNUP_FILTERS }),
  k("parcels_per_request", "rate", "neutral", { ratio: true }),
  k("on_time_start", "percent", "higher", { ratio: true }),
  k("time_to_fill", "duration", "lower", { ratio: true }),
]);
