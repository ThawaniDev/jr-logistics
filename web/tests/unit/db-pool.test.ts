import { afterEach, describe, expect, it, vi } from "vitest";
import { closeDb, getPool } from "@/db";

describe("database pool", () => {
  afterEach(async () => { vi.restoreAllMocks(); await closeDb(); });

  it("handles an error on an idle connection (restart, failover) with one scrubbed log line instead of an uncaught exception", () => {
    const lines: string[] = [];
    vi.spyOn(console, "error").mockImplementation((...a: unknown[]) => { lines.push(a.map(String).join(" ")); });
    const pool = getPool();
    expect(pool.listenerCount("error")).toBeGreaterThan(0);
    const dropped = Object.assign(new Error("terminating connection due to administrator command\nparams: SA0380000000608010167519"), { code: "57P01" });
    expect(() => pool.emit("error", dropped, undefined as never)).not.toThrow();
    const j = JSON.parse(lines[0]) as { level: string; correlationId: string; pgCode: string; message: string };
    expect(j).toMatchObject({ level: "error", correlationId: "db:pool", pgCode: "57P01" });
    expect(lines.join("\n")).not.toContain("SA0380");
  });

  it("does not wait for ever for a free connection", () => {
    const opts = (getPool() as unknown as { options: { connectionTimeoutMillis: number; max: number } }).options;
    expect(opts.connectionTimeoutMillis).toBeGreaterThan(0);
    expect(opts.connectionTimeoutMillis).toBeLessThanOrEqual(60_000);
  });
});

describe("report pool", () => {
  afterEach(async () => { vi.restoreAllMocks(); delete process.env.REPORT_POOL_MAX; await closeDb(); });

  it("is a second, small pool of its own with the same error handling, and closeDb ends both", async () => {
    process.env.REPORT_POOL_MAX = "3";
    const { getReportDb } = await import("@/db");
    getReportDb();
    const report = (globalThis as { __jrReportPool?: import("pg").Pool }).__jrReportPool!;
    expect(report).toBeDefined();
    expect(report).not.toBe(getPool());
    expect((report as unknown as { options: { max: number } }).options.max).toBe(3);
    expect(report.listenerCount("error")).toBeGreaterThan(0);
    await closeDb();
    expect((globalThis as { __jrReportPool?: unknown }).__jrReportPool).toBeUndefined();
  });
});
