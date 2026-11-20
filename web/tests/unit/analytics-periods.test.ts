import { describe, it, expect } from "vitest";
import { addDays, addMonths, addYears, dayStart, diffDays, endOfMonth, isYmd, riyadhDay, startOfQuarter, startOfWeek, weekday, wholeMonths } from "@/server/analytics/time";
import { autoBucket, bucketKeys, maxBucketsFor, presetRange, previousRange, windowOf, yoyRange } from "@/server/analytics/periods";
import { filtersMeta, parseFilters } from "@/server/analytics/filters";
import { zeroFill } from "@/server/analytics/buckets";

const NOW = new Date("2026-11-19T10:00:00Z"); // 13:00 in Riyadh, Thursday
const field = (fn: () => unknown) => { try { fn(); return null; } catch (e) { return (e as { details?: { field?: string } }).details?.field ?? "?"; } };

describe("Riyadh calendar math", () => {
  it("a day starts at 21:00 UTC the evening before and the boundary falls on the right day", () => {
    expect(dayStart("2026-11-19").toISOString()).toBe("2026-11-18T21:00:00.000Z");
    expect(riyadhDay(new Date("2026-11-18T20:59:59Z"))).toBe("2026-11-18");
    expect(riyadhDay(new Date("2026-11-18T21:00:00Z"))).toBe("2026-11-19");
    expect(riyadhDay(new Date("2026-12-31T21:30:00Z"))).toBe("2027-01-01");
  });
  it("adds days, months and years across month ends and leap years with clamping", () => {
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2024-02-28", 2)).toBe("2024-03-01");
    expect(addMonths("2026-03-31", -1)).toBe("2026-02-28");
    expect(addMonths("2026-01-31", 1)).toBe("2026-02-28");
    expect(addMonths("2026-01-15", -13)).toBe("2024-12-15");
    expect(addYears("2024-02-29", 1)).toBe("2025-02-28");
    expect(diffDays("2026-11-01", "2026-11-19")).toBe(18);
    expect(endOfMonth("2024-02-10")).toBe("2024-02-29");
    expect(startOfQuarter("2026-11-19")).toBe("2026-10-01");
  });
  it("weeks start on Sunday", () => {
    expect(weekday("2026-11-15")).toBe(0);
    expect(startOfWeek("2026-11-15")).toBe("2026-11-15");
    expect(startOfWeek("2026-11-21")).toBe("2026-11-15"); // Saturday belongs to the week that began on Sunday
    expect(startOfWeek("2026-11-22")).toBe("2026-11-22");
  });
  it("validates days", () => {
    expect(isYmd("2026-02-29")).toBe(false);
    expect(isYmd("2024-02-29")).toBe(true);
    expect(isYmd("2026-13-01")).toBe(false);
    expect(isYmd("26-01-01")).toBe(false);
    expect(wholeMonths("2026-10-01", "2026-10-31")).toBe(1);
    expect(wholeMonths("2026-09-01", "2026-11-30")).toBe(3);
    expect(wholeMonths("2026-10-02", "2026-10-31")).toBeNull();
  });
});

describe("presets and comparison windows", () => {
  const today = "2026-11-19";
  it("resolves every preset (inclusive days)", () => {
    expect(presetRange("today", today)).toEqual({ from: today, to: today });
    expect(presetRange("7d", today)).toEqual({ from: "2026-11-13", to: today });
    expect(presetRange("30d", today)).toEqual({ from: "2026-10-21", to: today });
    expect(presetRange("90d", today)).toEqual({ from: "2026-08-22", to: today });
    expect(presetRange("mtd", today)).toEqual({ from: "2026-11-01", to: today });
    expect(presetRange("qtd", today)).toEqual({ from: "2026-10-01", to: today });
    expect(presetRange("ytd", today)).toEqual({ from: "2026-01-01", to: today });
    expect(presetRange("12m", today)).toEqual({ from: "2025-12-01", to: today });
  });
  it("previous period is the same number of days right before", () => {
    expect(previousRange({ from: "2026-10-21", to: today }, "30d")).toEqual({ from: "2026-09-21", to: "2026-10-20" });
    expect(previousRange({ from: today, to: today }, "today")).toEqual({ from: "2026-11-18", to: "2026-11-18" });
  });
  it("month/quarter/year to date compare the same elapsed days of the period before", () => {
    expect(previousRange({ from: "2026-11-01", to: today }, "mtd")).toEqual({ from: "2026-10-01", to: "2026-10-19" });
    expect(previousRange({ from: "2026-03-01", to: "2026-03-31" }, "mtd")).toEqual({ from: "2026-02-01", to: "2026-02-28" }); // clipped to the shorter month
    expect(previousRange({ from: "2026-10-01", to: today }, "qtd")).toEqual({ from: "2026-07-01", to: "2026-08-19" });
    expect(previousRange({ from: "2026-01-01", to: today }, "ytd")).toEqual({ from: "2025-01-01", to: "2025-11-19" });
  });
  it("a custom range of whole months compares the months before; other custom ranges the same length before", () => {
    expect(previousRange({ from: "2026-10-01", to: "2026-10-31" }, null)).toEqual({ from: "2026-09-01", to: "2026-09-30" });
    expect(previousRange({ from: "2026-07-01", to: "2026-09-30" }, null)).toEqual({ from: "2026-04-01", to: "2026-06-30" });
    expect(previousRange({ from: "2026-10-05", to: "2026-10-11" }, null)).toEqual({ from: "2026-09-28", to: "2026-10-04" });
  });
  it("year over year keeps the calendar dates", () => {
    expect(yoyRange({ from: "2026-11-01", to: today })).toEqual({ from: "2025-11-01", to: "2025-11-19" });
    expect(yoyRange({ from: "2024-02-29", to: "2024-03-02" })).toEqual({ from: "2023-02-28", to: "2023-03-02" });
  });
  it("windows are half-open Riyadh days", () => {
    const w = windowOf("2026-11-19", "2026-11-19");
    expect(w.days).toBe(1);
    expect(w.start.toISOString()).toBe("2026-11-18T21:00:00.000Z");
    expect(w.end.toISOString()).toBe("2026-11-19T21:00:00.000Z");
  });
});

describe("buckets", () => {
  it("auto picks from the span", () => {
    expect([1, 2, 3, 30, 92, 93, 200, 201, 365].map(autoBucket)).toEqual(["hour", "hour", "day", "day", "day", "week", "week", "month", "month"]);
  });
  it("enumerates every bucket key (zero fill)", () => {
    expect(bucketKeys("2026-11-19", "2026-11-19", "hour")).toHaveLength(24);
    expect(bucketKeys("2026-11-19", "2026-11-19", "hour")[14]).toBe("2026-11-19T14");
    expect(bucketKeys("2026-11-01", "2026-11-03", "day")).toEqual(["2026-11-01", "2026-11-02", "2026-11-03"]);
    // 2026-11-19 is a Thursday: the first week starts on Sunday 15 Nov, the next on 22 Nov
    expect(bucketKeys("2026-11-19", "2026-11-23", "week")).toEqual(["2026-11-15", "2026-11-22"]);
    expect(bucketKeys("2026-10-15", "2026-12-02", "month")).toEqual(["2026-10-01", "2026-11-01", "2026-12-01"]);
    expect(maxBucketsFor(731, "day")).toBe(731);
  });
  it("zeroFill leaves no holes and ignores junk", () => {
    const keys = ["a", "b", "c"];
    const out = zeroFill(keys, [{ t: "b", n: "4", m: 1 }, { t: "zzz", n: 9 }], ["n", "m"] as const);
    expect(out).toEqual([{ t: "a", n: 0, m: 0 }, { t: "b", n: 4, m: 1 }, { t: "c", n: 0, m: 0 }]);
  });
});

describe("parseFilters", () => {
  it("defaults to the last 30 days compared with the 30 before", () => {
    const f = parseFilters(new URLSearchParams(), NOW);
    expect(f.preset).toBe("30d"); expect(f.cur.from).toBe("2026-10-21"); expect(f.cur.to).toBe("2026-11-19");
    expect(f.compare).toBe("prev"); expect(f.prev?.from).toBe("2026-09-21"); expect(f.prev?.to).toBe("2026-10-20");
    expect(f.bucket).toBe("day"); expect(f.keys).toHaveLength(30); expect(f.prevKeys).toHaveLength(30); expect(f.active).toEqual([]);
  });
  it("uses Riyadh days, not UTC days, to decide what today is", () => {
    const f = parseFilters({ preset: "today" }, new Date("2026-11-18T21:30:00Z")); // 00:30 on the 19th in Riyadh
    expect(f.cur.from).toBe("2026-11-19");
    expect(f.bucket).toBe("hour");
    expect(f.cur.start.toISOString()).toBe("2026-11-18T21:00:00.000Z");
  });
  it("a custom range wins over the preset and compare=none has no comparison", () => {
    const f = parseFilters(new URLSearchParams("preset=7d&from=2026-10-01&to=2026-10-31&compare=none"), NOW);
    expect(f.preset).toBeNull(); expect(f.cur.days).toBe(31); expect(f.prev).toBeNull(); expect(f.prevKeys).toBeNull();
    expect(parseFilters({ from: "2026-10-01", to: "2026-10-31" }, NOW).prev).toMatchObject({ from: "2026-09-01", to: "2026-09-30" });
  });
  it("accepts repeated and comma-separated lists, trims, dedupes and sorts for a canonical key", () => {
    const a = parseFilters(new URLSearchParams("city=riyadh&city=jeddah,riyadh&service=delivery_driver&channel=api,web"), NOW);
    const b = parseFilters(new URLSearchParams("channel=web&channel=api&service=delivery_driver&city= jeddah , riyadh"), NOW);
    expect(a.city).toEqual(["jeddah", "riyadh"]);
    expect(a.channel).toEqual(["api", "web"]);
    expect(a.canonical).toBe(b.canonical);
    expect(a.active).toEqual(["city", "service", "channel"]);
    expect(parseFilters(new URLSearchParams("city="), NOW).active).toEqual([]);
  });
  it("rejects invalid input with a 422 naming the field", () => {
    const bad = (q: string) => field(() => parseFilters(new URLSearchParams(q), NOW));
    expect(bad("preset=5y")).toBe("preset");
    expect(bad("from=2026-02-30&to=2026-03-01")).toBe("from");
    expect(bad("from=2026-03-02&to=2026-03-01")).toBe("to");
    expect(bad("from=2026-03-02")).toBe("to");
    expect(bad("to=2026-03-02")).toBe("from");
    expect(bad("from=2020-01-01&to=2026-01-01")).toBe("to"); // longer than 731 days
    expect(bad("compare=sometimes")).toBe("compare");
    expect(bad("bucket=minute")).toBe("bucket");
    expect(bad("preset=90d&bucket=hour")).toBe("bucket"); // 2160 hourly points
    expect(bad("service=helicopter")).toBe("service");
    expect(bad("vehicle=tank")).toBe("vehicle");
    expect(bad("channel=fax")).toBe("channel");
    expect(bad("company=not-a-uuid")).toBe("company");
  });
  it("limits list sizes", () => {
    const ids = Array.from({ length: 51 }, (_, i) => `0b8f3d3e-7b53-4c36-9f0c-6a8f0d2a${String(i).padStart(4, "0")}`).join(",");
    expect(field(() => parseFilters(new URLSearchParams(`company=${ids}`), NOW))).toBe("company");
    expect(field(() => parseFilters(new URLSearchParams(`city=${Array.from({ length: 31 }, (_, i) => `c${i + 10}`).join(",")}`), NOW))).toBe("city");
  });
  it("echoes the resolved period for the UI", () => {
    const m = filtersMeta(parseFilters({ preset: "mtd", compare: "prev" }, NOW));
    expect(m.period).toMatchObject({ from: "2026-11-01", to: "2026-11-19", days: 19 });
    expect(m.prevPeriod).toMatchObject({ from: "2026-10-01", to: "2026-10-19" });
    expect(m.bucket).toBe("day"); expect(m.values.city).toEqual([]);
  });
});
