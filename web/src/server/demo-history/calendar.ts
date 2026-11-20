import type { Rng } from "./prng";

/** Saudi Arabia is UTC+3 all year; the weekend is Friday–Saturday. All "days" and "hours" in the generator are Riyadh local time. */
export const MIN = 60_000, HOUR = 3_600_000, DAY = 86_400_000, KSA_OFFSET = 3 * HOUR;

export interface KsaParts { y: number; m: number; d: number; dow: number; hour: number; min: number }
/** dow: 0 = Sunday … 6 = Saturday. */
export function ksa(ms: number): KsaParts {
  const x = new Date(ms + KSA_OFFSET);
  return { y: x.getUTCFullYear(), m: x.getUTCMonth() + 1, d: x.getUTCDate(), dow: x.getUTCDay(), hour: x.getUTCHours(), min: x.getUTCMinutes() };
}
/** Start (UTC ms) of the Riyadh calendar day containing `ms`. */
export const ksaDayStart = (ms: number) => Math.floor((ms + KSA_OFFSET) / DAY) * DAY - KSA_OFFSET;
export const ksaDateKey = (ms: number) => { const p = ksa(ms); return `${p.y}-${String(p.m).padStart(2, "0")}-${String(p.d).padStart(2, "0")}`; };
/** `YYYY-MM-DD` (a Riyadh calendar day) → UTC ms of its start. */
export function parseKsaDay(s: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return null;
  const t = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) - KSA_OFFSET;
  return Number.isNaN(t) ? null : t;
}
export const isWeekend = (ms: number) => { const d = ksa(ms).dow; return d === 5 || d === 6; };
export const hourStart = (ms: number) => Math.floor(ms / HOUR) * HOUR;

/**
 * Public-holiday / peak calendar (Gregorian dates of the Islamic holidays are approximate: they follow moon sighting).
 * factor < 1 = quiet days, > 1 = peaks (White Friday, Ramadan evenings are not modelled separately).
 */
const H = (from: string, to: string, factor: number, name: string) => ({ from: parseKsaDay(from)!, to: parseKsaDay(to)! + DAY, factor, name });
export const HOLIDAYS = [
  H("2025-03-30", "2025-04-03", 0.3, "Eid al-Fitr 2025"), H("2025-06-05", "2025-06-09", 0.3, "Eid al-Adha 2025"), H("2025-09-23", "2025-09-23", 0.45, "Saudi National Day 2025"),
  H("2025-11-28", "2025-11-30", 1.45, "White Friday 2025"),
  H("2026-02-22", "2026-02-22", 0.5, "Founding Day 2026"), H("2026-03-20", "2026-03-24", 0.3, "Eid al-Fitr 2026"), H("2026-05-26", "2026-05-30", 0.3, "Eid al-Adha 2026"),
  H("2026-09-23", "2026-09-23", 0.45, "Saudi National Day 2026"), H("2026-11-27", "2026-11-29", 1.45, "White Friday 2026"),
  H("2027-02-22", "2027-02-22", 0.5, "Founding Day 2027"), H("2027-03-10", "2027-03-14", 0.3, "Eid al-Fitr 2027"), H("2027-05-16", "2027-05-20", 0.3, "Eid al-Adha 2027"),
  H("2027-09-23", "2027-09-23", 0.45, "Saudi National Day 2027"),
];
export const holidayFactor = (dayStart: number) => HOLIDAYS.find((h) => dayStart >= h.from && dayStart < h.to)?.factor ?? 1;

/** Demand by weekday (Sun..Sat): the Saudi weekend is quiet, Thursday evening already slows down. */
export const DOW_FACTOR = [1.1, 1.12, 1.06, 1.0, 0.88, 0.42, 0.72];
/** Salary week: demand rises toward the 27th–1st (a smooth bump around the 28th, wrapping into the next month). */
export function monthEndFactor(dayStart: number): number {
  const p = ksa(dayStart);
  const dim = new Date(Date.UTC(p.y, p.m, 0)).getUTCDate();
  const toEnd = Math.min(Math.abs(p.d - 28), Math.abs(p.d + dim - 28));
  return 1 + 0.42 * Math.exp(-(toEnd * toEnd) / 9);
}

/** Request creation by Riyadh hour: two peaks, 09–13 and 16–21. */
export const HOUR_WEIGHTS = [0.2, 0.1, 0.08, 0.06, 0.08, 0.2, 0.7, 2, 4.2, 7, 8, 8, 6.5, 4, 3, 3.5, 6, 7.6, 8, 8, 6.5, 4, 1.5, 0.5];
export function sampleHour(rng: Rng, weights: readonly number[] = HOUR_WEIGHTS): number {
  return rng.weighted(weights.map((w, h) => [h, w] as const));
}
/** A moment inside the Riyadh day starting at `dayStart`, drawn from the hourly demand curve. */
export function sampleMoment(rng: Rng, dayStart: number, weights: readonly number[] = HOUR_WEIGHTS): number {
  return dayStart + sampleHour(rng, weights) * HOUR + Math.floor(rng.next() * HOUR);
}

/** Round a time to a plausible "scheduled start": the quarter hour. */
export const toQuarter = (ms: number) => Math.round(ms / (15 * MIN)) * 15 * MIN;
