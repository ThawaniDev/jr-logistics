import { z, ZodError } from "zod";
import { err } from "@/lib/errors";
import { SERVICES, VEHICLE_TYPES } from "../catalog";
import {
  autoBucket, bucketKeys, BUCKETS, COMPARES, DEFAULT_COMPARE, DEFAULT_PRESET, MAX_BUCKETS, MAX_SPAN_DAYS, maxBucketsFor, presetRange, PRESETS, previousRange, windowOf, yoyRange,
  type Bucket, type BucketReq, type Compare, type Preset, type Window,
} from "./periods";
import { CHANNELS, MULTI_KEYS, type MultiKey } from "./keys";
import { diffDays, isYmd, riyadhDay } from "./time";

/**
 * THE filter model of every report (decision G3). One parser, so the Overview, every other report, every drill-down table and every CSV export read
 * the same query string the same way. Turn the result into SQL with `conditions.ts`.
 *
 * Query string: `from`/`to` (YYYY-MM-DD, Riyadh calendar days, inclusive; both required) OR `preset`; `from`/`to` win when both are given.
 * `bucket` (auto|hour|day|week|month), `compare` (none|prev|yoy, default prev) and the multi-value lists `city service vehicle company office driver status channel`,
 * each repeated (`?city=riyadh&city=jeddah`) or comma-separated (`?city=riyadh,jeddah`). Unknown parameters (page, sort …) are ignored here.
 */
export { CHANNELS, MULTI_KEYS, type MultiKey };

const SERVICE_KEYS = SERVICES.map((s) => s.key) as [string, ...string[]];
const day = z.string().refine(isYmd, "Use YYYY-MM-DD").refine((s) => s >= "2000-01-01" && s <= "2100-12-31", "Date out of range");
const list = <T extends z.ZodType>(item: T, max: number) => z.array(item).max(max, `At most ${max} values`).default([]);
const id = z.string().uuid("Not a valid id");

const schema = z.object({
  preset: z.enum(PRESETS).optional(),
  from: day.optional(), to: day.optional(),
  bucket: z.enum(BUCKETS).default("auto"),
  compare: z.enum(COMPARES).default(DEFAULT_COMPARE),
  city: list(z.string().regex(/^[^\s,]{2,40}$/, "Not a valid city key"), 30),
  service: list(z.enum(SERVICE_KEYS), SERVICE_KEYS.length),
  vehicle: list(z.enum(VEHICLE_TYPES), VEHICLE_TYPES.length),
  company: list(id, 50), office: list(id, 50), driver: list(id, 50),
  status: list(z.string().regex(/^[a-z_]{2,30}$/, "Not a valid status"), 12),
  channel: list(z.enum(CHANNELS), CHANNELS.length),
});

export interface ResolvedFilters {
  /** The preset the period came from, null for a custom from/to range. */
  preset: Preset | null;
  bucketRequested: BucketReq;
  /** The bucket actually used (`auto` resolved from the span). */
  bucket: Bucket;
  compare: Compare;
  cur: Window;
  /** The comparison window (null when compare = none). */
  prev: Window | null;
  /** Every bucket key of the period / the comparison period, in order (zero-fill with them). */
  keys: string[];
  prevKeys: string[] | null;
  city: string[]; service: string[]; vehicle: string[]; company: string[]; office: string[]; driver: string[]; status: string[]; channel: string[];
  /** Same filters → same string, whatever the parameter or list order. Cache key + audit detail. */
  canonical: string;
  /** The multi-value filters that are set. */
  active: MultiKey[];
}

type Source = URLSearchParams | Record<string, unknown>;
const list_ = (v: unknown): string[] => {
  const raw = Array.isArray(v) ? v : v == null ? [] : [v];
  return [...new Set(raw.flatMap((x) => String(x).split(",")).map((x) => x.trim()).filter(Boolean))];
};
function normalise(src: Source): Record<string, unknown> {
  const get = (k: string): unknown[] => (src instanceof URLSearchParams ? src.getAll(k) : list_(src[k]).length ? list_(src[k]) : []);
  const one = (k: string) => { const v = get(k).map(String).find((x) => x.trim() !== ""); return v === undefined ? undefined : v.trim(); };
  const out: Record<string, unknown> = { preset: one("preset"), from: one("from"), to: one("to"), bucket: one("bucket"), compare: one("compare") };
  for (const k of MULTI_KEYS) out[k] = list_(get(k));
  return out;
}

const fail = (field: string, message: string) => err("VALIDATION", message, { field });

/** Parses and validates a query string (or a plain object) into exact UTC windows. Invalid input throws a 422 `VALIDATION` error naming the field. */
export function parseFilters(src: Source, now: Date = new Date()): ResolvedFilters {
  let p: z.infer<typeof schema>;
  try { p = schema.parse(normalise(src)); }
  catch (e) { if (e instanceof ZodError) { const i = e.issues[0]; throw fail(String(i.path[0] ?? "_"), i.message); } throw e; }
  const today = riyadhDay(now);
  let preset: Preset | null = null; let from: string, to: string;
  if (p.from || p.to) {
    if (!p.from) throw fail("from", "from is required with to");
    if (!p.to) throw fail("to", "to is required with from");
    from = p.from; to = p.to;
  } else { preset = p.preset ?? DEFAULT_PRESET; ({ from, to } = presetRange(preset, today)); }
  if (from > to) throw fail("to", "The end date is before the start date");
  const days = diffDays(from, to) + 1;
  if (days > MAX_SPAN_DAYS) throw fail("to", `The period is limited to ${MAX_SPAN_DAYS} days`);
  const bucket: Bucket = p.bucket === "auto" ? autoBucket(days) : p.bucket;
  if (maxBucketsFor(days, bucket) > MAX_BUCKETS) throw fail("bucket", `Too many ${bucket} buckets for this period (limit ${MAX_BUCKETS}); choose a coarser bucket`);
  const range = { from, to };
  const prevRange = p.compare === "prev" ? previousRange(range, preset) : p.compare === "yoy" ? yoyRange(range) : null;
  const cur = windowOf(from, to), prev = prevRange ? windowOf(prevRange.from, prevRange.to) : null;
  const lists = Object.fromEntries(MULTI_KEYS.map((k) => [k, [...p[k]].sort()])) as Record<MultiKey, string[]>;
  const active = MULTI_KEYS.filter((k) => lists[k].length > 0);
  const canonical = [`${from}..${to}`, bucket, p.compare, ...active.map((k) => `${k}=${lists[k].join(",")}`)].join("|");
  return {
    preset, bucketRequested: p.bucket, bucket, compare: p.compare, cur, prev,
    keys: bucketKeys(from, to, bucket), prevKeys: prev ? bucketKeys(prev.from, prev.to, bucket) : null,
    ...lists, canonical, active,
  };
}

/** The JSON echo of the resolved filters that every analytics response carries in `meta` (the UI shows it as "Showing … compared with …"). */
export function filtersMeta(f: ResolvedFilters) {
  const win = (w: Window) => ({ from: w.from, to: w.to, days: w.days, start: w.start.toISOString(), end: w.end.toISOString() });
  return {
    preset: f.preset, bucket: f.bucket, bucketRequested: f.bucketRequested, compare: f.compare,
    period: win(f.cur), prevPeriod: f.prev ? win(f.prev) : null,
    values: Object.fromEntries(MULTI_KEYS.map((k) => [k, f[k]])) as Record<MultiKey, string[]>,
  };
}
