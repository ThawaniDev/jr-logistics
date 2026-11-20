/**
 * Riyadh calendar-day arithmetic (UTC+3, no daylight saving). PURE: no imports, safe to use from client components.
 * A "day" is a `YYYY-MM-DD` string meaning the Riyadh calendar day; instants are UTC `Date`s. Days are computed on UTC midnights of the
 * same digits, so month/leap-year rules come from `Date.UTC` and never from the machine's time zone.
 */
export type Ymd = string;
export const RIYADH_OFFSET_MS = 3 * 3_600_000;
const DAY_MS = 86_400_000;
const YMD = /^(\d{4})-(\d{2})-(\d{2})$/;

export function parseYmd(s: string): { y: number; m: number; d: number } | null {
  const m = YMD.exec(s);
  if (!m) return null;
  const y = +m[1], mo = +m[2], d = +m[3];
  const x = new Date(Date.UTC(y, mo - 1, d));
  return x.getUTCFullYear() === y && x.getUTCMonth() === mo - 1 && x.getUTCDate() === d ? { y, m: mo, d } : null;
}
export const isYmd = (s: string) => parseYmd(s) !== null;
const ms = (s: Ymd) => { const p = parseYmd(s); if (!p) throw new Error(`Invalid day ${s}`); return Date.UTC(p.y, p.m - 1, p.d); };
const ymd = (t: number): Ymd => new Date(t).toISOString().slice(0, 10);

/** The Riyadh calendar day an instant falls on. */
export const riyadhDay = (d: Date): Ymd => ymd(d.getTime() + RIYADH_OFFSET_MS);
/** The instant a Riyadh day starts (00:00 Riyadh = 21:00 UTC the day before). */
export const dayStart = (s: Ymd): Date => new Date(ms(s) - RIYADH_OFFSET_MS);
export const addDays = (s: Ymd, n: number): Ymd => ymd(ms(s) + n * DAY_MS);
/** Whole days from `a` to `b` (b − a). */
export const diffDays = (a: Ymd, b: Ymd): number => Math.round((ms(b) - ms(a)) / DAY_MS);
/** 0 = Sunday … 6 = Saturday. */
export const weekday = (s: Ymd): number => new Date(ms(s)).getUTCDay();

/** Weeks start on SUNDAY (the Saudi working week is Sunday–Thursday). */
export const startOfWeek = (s: Ymd): Ymd => addDays(s, -weekday(s));
export const startOfMonth = (s: Ymd): Ymd => `${s.slice(0, 7)}-01`;
export const startOfYear = (s: Ymd): Ymd => `${s.slice(0, 4)}-01-01`;
export const startOfQuarter = (s: Ymd): Ymd => { const m = +s.slice(5, 7); return `${s.slice(0, 5)}${String(Math.floor((m - 1) / 3) * 3 + 1).padStart(2, "0")}-01`; };
export const daysInMonth = (s: Ymd): number => { const p = parseYmd(s)!; return new Date(Date.UTC(p.y, p.m, 0)).getUTCDate(); };
export const endOfMonth = (s: Ymd): Ymd => `${s.slice(0, 7)}-${String(daysInMonth(s)).padStart(2, "0")}`;
/** Moves by whole months; the day of month is clamped to the target month's length (31 Mar − 1 month = 28 Feb). */
export function addMonths(s: Ymd, n: number): Ymd {
  const p = parseYmd(s)!;
  const t = p.y * 12 + (p.m - 1) + n;
  const y = Math.floor(t / 12), m = (t % 12 + 12) % 12 + 1;
  const first = `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-01`;
  return `${first.slice(0, 8)}${String(Math.min(p.d, daysInMonth(first))).padStart(2, "0")}`;
}
export const addYears = (s: Ymd, n: number): Ymd => addMonths(s, n * 12);
/** Number of whole calendar months from the 1st of `from` to the last day of `to`, or null when the range is not whole months. */
export function wholeMonths(from: Ymd, to: Ymd): number | null {
  if (from.slice(8) !== "01" || to !== endOfMonth(to)) return null;
  const a = parseYmd(from)!, b = parseYmd(to)!;
  return (b.y - a.y) * 12 + (b.m - a.m) + 1;
}
