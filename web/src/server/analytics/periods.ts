import { addDays, addMonths, addYears, dayStart, diffDays, startOfMonth, startOfQuarter, startOfWeek, startOfYear, wholeMonths, type Ymd } from "./time";

/** PURE period logic shared by the server filter parser and the client filter bar (no imports besides ./time). */
export const PRESETS = ["today", "7d", "30d", "90d", "mtd", "qtd", "ytd", "12m"] as const;
export type Preset = (typeof PRESETS)[number];
export const BUCKETS = ["auto", "hour", "day", "week", "month"] as const;
export type BucketReq = (typeof BUCKETS)[number];
export type Bucket = Exclude<BucketReq, "auto">;
export const COMPARES = ["none", "prev", "yoy"] as const;
export type Compare = (typeof COMPARES)[number];

export const DEFAULT_PRESET: Preset = "30d";
export const DEFAULT_COMPARE: Compare = "prev";
export const MAX_SPAN_DAYS = 731;
/** A chart never gets more points than this: hours need a span of at most 16 days, days of at most 400. */
export const MAX_BUCKETS = 400;

export interface Range { from: Ymd; to: Ymd }
/** `start` is inclusive, `end` exclusive (the next Riyadh midnight): `start <= t < end`. */
export interface Window extends Range { days: number; start: Date; end: Date }

export function windowOf(from: Ymd, to: Ymd): Window {
  return { from, to, days: diffDays(from, to) + 1, start: dayStart(from), end: dayStart(addDays(to, 1)) };
}

/** The day range a preset stands for, relative to `today` (a Riyadh day). `12m` = the last 12 calendar months including the current one. */
export function presetRange(p: Preset, today: Ymd): Range {
  switch (p) {
    case "today": return { from: today, to: today };
    case "7d": return { from: addDays(today, -6), to: today };
    case "30d": return { from: addDays(today, -29), to: today };
    case "90d": return { from: addDays(today, -89), to: today };
    case "mtd": return { from: startOfMonth(today), to: today };
    case "qtd": return { from: startOfQuarter(today), to: today };
    case "ytd": return { from: startOfYear(today), to: today };
    case "12m": return { from: startOfMonth(addMonths(today, -11)), to: today };
  }
}

const minDay = (a: Ymd, b: Ymd) => (a < b ? a : b);

/**
 * "Previous period". Month/quarter/year-to-date compare the same elapsed days of the previous month/quarter/year (1–19 Nov vs 1–19 Oct, not the
 * 19 days before); a custom range that is whole calendar months compares the same number of months before; everything else is the window of the same
 * length immediately before `from`.
 */
export function previousRange(r: Range, preset?: Preset | null): Range {
  const n = diffDays(r.from, r.to) + 1;
  const before = addDays(r.from, -1);
  const sameElapsed = (pf: Ymd, cap: Ymd): Range => ({ from: pf, to: minDay(addDays(pf, n - 1), cap) });
  if (preset === "mtd") return sameElapsed(addMonths(r.from, -1), before);
  if (preset === "qtd") return sameElapsed(addMonths(r.from, -3), before);
  if (preset === "ytd") return sameElapsed(addYears(r.from, -1), before);
  if (preset === "12m") return sameElapsed(addMonths(r.from, -12), before);
  if (!preset) {
    const k = wholeMonths(r.from, r.to);
    if (k) return { from: addMonths(r.from, -k), to: before };
  }
  return { from: addDays(before, -(n - 1)), to: before };
}
/** Same calendar dates one year earlier (29 Feb clamps to 28 Feb). */
export const yoyRange = (r: Range): Range => ({ from: addYears(r.from, -1), to: addYears(r.to, -1) });

/** auto: hours up to 2 days, days up to 92, weeks up to 200, months beyond. */
export function autoBucket(days: number): Bucket {
  return days <= 2 ? "hour" : days <= 92 ? "day" : days <= 200 ? "week" : "month";
}
export function bucketCount(r: Range, b: Bucket): number {
  return bucketKeys(r.from, r.to, b).length;
}
/** The key of every bucket of a range, in order (zero-filling uses these). Hour `YYYY-MM-DDTHH`, day/week/month `YYYY-MM-DD` of the bucket's first day. Weeks start on Sunday. */
export function bucketKeys(from: Ymd, to: Ymd, b: Bucket): string[] {
  const out: string[] = [];
  if (b === "hour") {
    for (let d = from; d <= to; d = addDays(d, 1)) for (let h = 0; h < 24; h++) out.push(`${d}T${String(h).padStart(2, "0")}`);
  } else if (b === "day") {
    for (let d = from; d <= to; d = addDays(d, 1)) out.push(d);
  } else if (b === "week") {
    for (let d = startOfWeek(from); d <= to; d = addDays(d, 7)) out.push(d);
  } else {
    for (let d = startOfMonth(from); d <= to; d = addMonths(d, 1)) out.push(d);
  }
  return out;
}
/** Cheap upper bound used before enumerating keys, so a hostile range cannot make us allocate thousands of buckets. */
export function maxBucketsFor(days: number, b: Bucket): number {
  return b === "hour" ? days * 24 : b === "day" ? days : b === "week" ? Math.ceil(days / 7) + 1 : Math.ceil(days / 28) + 1;
}
