"use client";
import { useCallback, useMemo } from "react";
import { useSearchParams } from "next/navigation";
import { useUrlPatch } from "@/components/ui/data";
import { MULTI_KEYS, type MultiKey } from "@/server/analytics/keys";
import {
  autoBucket, BUCKETS, COMPARES, DEFAULT_COMPARE, DEFAULT_PRESET, MAX_BUCKETS, MAX_SPAN_DAYS, maxBucketsFor, presetRange, PRESETS, previousRange, yoyRange,
  type Bucket, type BucketReq, type Compare, type Preset, type Range,
} from "@/server/analytics/periods";
import { diffDays, isYmd, riyadhDay } from "@/server/analytics/time";

/** The URL parameter names of the filter model (everything else in the URL — page, sort, tab — is left alone). */
export const FILTER_PARAMS = ["preset", "from", "to", "bucket", "compare", ...MULTI_KEYS] as const;
export type FilterValues = Record<MultiKey, string[]>;

export interface ReportFilterState {
  /** `custom` when `from`/`to` are in the URL. */
  preset: Preset | "custom";
  from: string; to: string; days: number;
  bucket: BucketReq; resolvedBucket: Bucket; compare: Compare;
  /** The comparison range as the server will resolve it (null with compare = none). */
  prev: Range | null;
  values: FilterValues;
  /** Query string to append to every analytics API call (`preset=30d&city=riyadh,jeddah`); only valid, non-default parameters. */
  qs: string;
  /** Number of multi-value filters that are set. */
  activeCount: number;
  /** Anything (period, compare, bucket or filter) differs from the defaults. */
  dirty: boolean;
  set: (patch: Partial<Record<(typeof FILTER_PARAMS)[number], string>>) => void;
  setValues: (key: MultiKey, next: string[]) => void;
  /** Back to the default period, comparison and bucket with no filters. */
  reset: () => void;
}

const split = (v: string | null) => (v ? [...new Set(v.split(",").map((x) => x.trim()).filter(Boolean))] : []);

/**
 * The shared filter state of every report page: parsed from the URL (so a link, a reload and the back button all work), validated the same way the server does,
 * and written back with batched `useUrlPatch`. Needs a <Suspense> boundary above it (it reads `useSearchParams`).
 * Pass `qs` to your API path: `useApi(\`/admin/analytics/overview?${filters.qs}\`)`.
 */
export function useReportFilters(): ReportFilterState {
  const sp = useSearchParams();
  const patch = useUrlPatch();
  const raw = sp.toString();
  const state = useMemo(() => {
    const p = new URLSearchParams(raw);
    const today = riyadhDay(new Date());
    const rawFrom = p.get("from") ?? "", rawTo = p.get("to") ?? "";
    const custom = isYmd(rawFrom) && isYmd(rawTo) && rawFrom <= rawTo && diffDays(rawFrom, rawTo) < MAX_SPAN_DAYS;
    const presetRaw = p.get("preset") as Preset | null;
    const preset: Preset = presetRaw && (PRESETS as readonly string[]).includes(presetRaw) ? presetRaw : DEFAULT_PRESET;
    const range: Range = custom ? { from: rawFrom, to: rawTo } : presetRange(preset, today);
    const compare = (COMPARES as readonly string[]).includes(p.get("compare") ?? "") ? (p.get("compare") as Compare) : DEFAULT_COMPARE;
    const days = diffDays(range.from, range.to) + 1;
    // A grouping that would give too many points for this period (hours over 90 days) falls back to automatic instead of failing the report.
    const asked = (BUCKETS as readonly string[]).includes(p.get("bucket") ?? "") ? (p.get("bucket") as BucketReq) : "auto";
    const bucket: BucketReq = asked !== "auto" && maxBucketsFor(days, asked) > MAX_BUCKETS ? "auto" : asked;
    const values = Object.fromEntries(MULTI_KEYS.map((k) => [k, split(p.get(k))])) as FilterValues;
    const out = new URLSearchParams();
    if (custom) { out.set("from", range.from); out.set("to", range.to); } else if (p.get("preset")) out.set("preset", preset);
    if (p.get("compare")) out.set("compare", compare);
    if (bucket !== "auto") out.set("bucket", bucket);
    for (const k of MULTI_KEYS) if (values[k].length) out.set(k, values[k].join(","));
    const activeCount = MULTI_KEYS.filter((k) => values[k].length).length;
    return {
      preset: custom ? ("custom" as const) : preset, ...range, days, bucket, resolvedBucket: bucket === "auto" ? autoBucket(days) : bucket, compare,
      prev: compare === "prev" ? previousRange(range, custom ? null : preset) : compare === "yoy" ? yoyRange(range) : null,
      values, qs: out.toString().replace(/%2C/g, ","), activeCount,
      dirty: custom || (!!p.get("preset") && preset !== DEFAULT_PRESET) || compare !== DEFAULT_COMPARE || bucket !== "auto" || activeCount > 0,
    };
  }, [raw]);
  const set = useCallback((x: Partial<Record<(typeof FILTER_PARAMS)[number], string>>) => patch(x as Record<string, string>), [patch]);
  const setValues = useCallback((key: MultiKey, next: string[]) => patch({ [key]: next.join(",") }), [patch]);
  const reset = useCallback(() => patch(Object.fromEntries(FILTER_PARAMS.map((k) => [k, ""]))), [patch]);
  return { ...state, set, setValues, reset };
}
