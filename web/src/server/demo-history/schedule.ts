import { DAY, HOUR, ksa, ksaDayStart } from "./calendar";
import { unit } from "./prng";
import type { DriverSim } from "./types";

/** When drivers are "online" (availability = available). Pure functions of the driver and the seed, so the same question always gets the same answer. */
const dayIndex = (dayStart: number) => Math.round(dayStart / DAY);

/** Does the driver work the Riyadh day starting at `dayStart`? (scheduled weekday AND not one of the random days off). */
export function worksDay(d: DriverSim, seed: number, dayStart: number): boolean {
  const dow = ksa(dayStart + 12 * HOUR).dow;
  return d.workDays[dow] && unit(seed, "on", d.idx, dayIndex(dayStart)) < d.dayOn;
}

/** Shift of the day starting at `dayStart`, as absolute ms (may run past midnight for night shifts). */
export const shiftOf = (d: DriverSim, dayStart: number) => ({ from: dayStart + d.shiftStart * HOUR, to: dayStart + (d.shiftStart + d.shiftLen) * HOUR });

export function inStrikeSuspension(d: DriverSim, t: number): boolean {
  return d.strikeSuspensions.some((s) => t >= s.from && t < s.to);
}

/** Employed, verified, not suspended (by admin or by the cancellation policy) at time `t`. */
export function isActiveAt(d: DriverSim, t: number): boolean {
  if (t < d.activeFrom || t >= d.activeTo) return false;
  if (d.verification === "pending" || d.verification === "rejected") return false;
  return !inStrikeSuspension(d, t);
}

export function isOnline(d: DriverSim, seed: number, t: number): boolean {
  if (!isActiveAt(d, t)) return false;
  const day = ksaDayStart(t);
  for (const ds of [day, day - DAY]) {
    if (!worksDay(d, seed, ds)) continue;
    const s = shiftOf(d, ds);
    if (t >= s.from && t < s.to) return true;
  }
  return false;
}

/** The next moment (after `t`, before `horizon`) the driver goes online, or null. */
export function nextOnlineStart(d: DriverSim, seed: number, t: number, horizon: number): number | null {
  const day0 = ksaDayStart(t);
  for (let k = 0; k <= 4; k++) {
    const ds = day0 + k * DAY;
    if (!worksDay(d, seed, ds)) continue;
    const s = shiftOf(d, ds).from;
    if (s > t && s < horizon && isActiveAt(d, s)) return s;
  }
  return null;
}

/** Is the driver free (no accepted-but-unfinished job) at `t`? Mirrors the single-active-job rule (E11) + the overlap check. */
export function isFreeAt(d: DriverSim, t: number): boolean {
  return !d.jobs.some((j) => j.acc <= t && t < j.end);
}

/** Affiliation (office id or null) at time `t`. */
export function officeAt(d: DriverSim, t: number): string | null {
  const a = d.affiliations.find((x) => t >= x.from && t < x.to);
  return a ? a.officeId : null;
}
