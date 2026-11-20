import { presetRange, type Preset } from "@/server/analytics/periods";

/**
 * The period of a finance page, pure part: presets (7 / 30 / 90 days, this month, this year), "All time" and a custom range. It lives in the URL as `from` + `to` (YYYY-MM-DD, Riyadh days) or
 * `period=all`; no parameter means the default, the last 30 days.
 */
export const FIN_PRESETS = ["7d", "30d", "90d", "mtd", "ytd"] as const satisfies readonly Preset[];
export type FinPreset = (typeof FIN_PRESETS)[number] | "all" | "custom";
export interface PeriodParams { from: string; to: string; period: string }

/** The preset a URL stands for (no parameters = the 30 day default; a range that matches no preset is `custom`). */
export function activePreset(p: PeriodParams, today: string): FinPreset {
  if (p.period === "all") return "all";
  if (!p.from && !p.to) return "30d";
  for (const k of FIN_PRESETS) { const r = presetRange(k, today); if (r.from === p.from && r.to === p.to) return k; }
  return "custom";
}
/** URL parameters of a preset (the default 30 days is "no parameters"). */
export function presetParams(k: FinPreset, today: string, current: { from: string; to: string }): PeriodParams {
  if (k === "all") return { from: "", to: "", period: "all" };
  if (k === "30d") return { from: "", to: "", period: "" };
  if (k === "custom") return { from: current.from, to: current.to, period: "" };
  const r = presetRange(k, today);
  return { from: r.from, to: r.to, period: "" };
}
/** The range the page shows when the URL has no dates: the last 30 days. */
export const effectiveRange = (p: PeriodParams, today: string) => (p.from && p.to ? { from: p.from, to: p.to } : presetRange("30d", today));

