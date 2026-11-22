import { describe, it, expect } from "vitest";
import { CSV_PAGE, MAX_CSV_ROWS, getTable, pageAll } from "@/server/analytics/registry";
import "@/server/analytics/fleet-tables-drivers";

/** Export paging (audit K / A4): every page re-runs the table's query, so the page size matters for tables whose query is expensive whatever it returns. */
const rowsOf = (n: number, from = 0) => Array.from({ length: n }, (_, i) => ({ i: from + i }));
describe("pageAll", () => {
  it("walks pages of CSV_PAGE by default and stops at a short page", async () => {
    const calls: Array<[number, number]> = [];
    const r = await pageAll(async (limit, offset) => { calls.push([limit, offset]); return rowsOf(Math.max(0, Math.min(limit, 2500 - offset)), offset); });
    expect(calls).toEqual([[CSV_PAGE, 0], [CSV_PAGE, 1000], [CSV_PAGE, 2000]]);
    expect(r.rows).toHaveLength(2500); expect(r.truncated).toBe(false);
  });
  it("uses a bigger page when the table asks for it: two queries for the whole 50 000-row cap instead of fifty", async () => {
    const calls: Array<[number, number]> = [];
    const r = await pageAll(async (limit, offset) => { calls.push([limit, offset]); return rowsOf(limit, offset); }, 25_000);
    expect(calls).toEqual([[25_000, 0], [25_000, 25_000]]);
    expect(r.rows).toHaveLength(MAX_CSV_ROWS); expect(r.truncated).toBe(true);
  });
  it("the per-driver × per-day table (a 2.6 s chain whatever the page) exports in big pages", () => {
    expect(getTable("drivers", "perf_daily")?.exportPage).toBe(25_000);
  });
});
