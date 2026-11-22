import { describe, it, expect, vi, beforeEach } from "vitest";

const tx = { execute: vi.fn(async () => ({ rows: [{ n: 1 }] })) };
const transaction = vi.fn(async (cb: (t: typeof tx) => unknown) => cb(tx));
const fakeDb = { transaction: (cb: never, cfg: never) => (transaction as unknown as (a: unknown, b: unknown) => unknown)(cb, cfg) };
vi.mock("@/db", () => ({ db: fakeDb, getReportDb: () => fakeDb })); // reports run on their own pool (db/index.ts getReportDb)
const { cached, clearAnalyticsCache, permClass, rows, timed, STATEMENT_TIMEOUT_MS } = await import("@/server/analytics/guard");
const { sql } = await import("drizzle-orm");

beforeEach(() => { clearAnalyticsCache(); transaction.mockClear(); tx.execute.mockClear(); });

describe("timed / rows", () => {
  it("runs each query in its own read-only transaction with a local statement timeout", async () => {
    const r = await rows(sql`select 1`);
    expect(r).toEqual([{ n: 1 }]);
    expect(transaction).toHaveBeenCalledTimes(1);
    expect((transaction.mock.calls[0] as unknown[])[1]).toEqual({ accessMode: "read only" });
    expect(tx.execute).toHaveBeenCalledTimes(2); // set_config, then the query
    expect(STATEMENT_TIMEOUT_MS).toBe(15_000);
  });
  it("answers a cancelled statement (57014) with a 503 that says it timed out", async () => {
    transaction.mockRejectedValueOnce(Object.assign(new Error("canceling statement due to statement timeout"), { cause: { code: "57014" } }));
    await expect(timed(async () => 1)).rejects.toMatchObject({ code: "DEPENDENCY_UNAVAILABLE", status: 503, details: { reason: "timeout" } });
  });
  it("lets every other error through unchanged", async () => {
    const boom = new Error("boom");
    transaction.mockRejectedValueOnce(boom);
    await expect(timed(async () => 1)).rejects.toBe(boom);
  });
});

describe("cached", () => {
  it("serves a finished report from memory until the TTL, per key", async () => {
    const fn = vi.fn(async () => ({ v: Math.random() }));
    const a = await cached("k1", fn), b = await cached("k1", fn), c = await cached("k2", fn);
    expect(a.cached).toBe(false); expect(b.cached).toBe(true); expect(b.value).toBe(a.value); expect(b.at).toBe(a.at);
    expect(c.cached).toBe(false); expect(fn).toHaveBeenCalledTimes(2);
    const d = await cached("k1", fn, 1); await new Promise((r) => setTimeout(r, 5));
    expect((await cached("k1", fn, 1)).cached).toBe(false); void d;
  });
  it("lets identical requests that arrive together share one run", async () => {
    let calls = 0;
    const slow = async () => { calls++; await new Promise((r) => setTimeout(r, 20)); return calls; };
    const [x, y, z] = await Promise.all([cached("same", slow), cached("same", slow), cached("same", slow)]);
    expect(calls).toBe(1); expect([x.value, y.value, z.value]).toEqual([1, 1, 1]);
  });
  it("never caches a failure, and ttl 0 disables the cache", async () => {
    let n = 0;
    const flaky = async () => { if (++n === 1) throw new Error("first fails"); return n; };
    await expect(cached("f", flaky)).rejects.toThrow("first fails");
    expect((await cached("f", flaky)).value).toBe(2);
    const fn = vi.fn(async () => 1);
    await cached("z", fn, 0); await cached("z", fn, 0);
    expect(fn).toHaveBeenCalledTimes(2);
  });
});

describe("permission class", () => {
  it("separates viewers by what changes a report's content", () => {
    const admin = permClass({ role: "admin", permissions: [] });
    expect(permClass({ role: "staff", permissions: ["reports.view"] })).toBe("0000");
    expect(permClass({ role: "staff", permissions: ["reports.view", "finance.view"] })).toBe("1000");
    expect(permClass({ role: "staff", permissions: ["reports.view", "reports.export"] })).not.toBe(permClass({ role: "staff", permissions: ["reports.view"] }));
    expect(admin).toBe("1111");
  });
});
