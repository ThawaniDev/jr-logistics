import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * A failing housekeeping tick used to print `error.message` straight to the console. A database error's message is the failing statement
 * WITH its bound parameters (IBANs, phone numbers, password hashes): it has to go through the scrubbing logger instead.
 */
const LEAKY = Object.assign(new Error('Failed query: update "users" set "iban" = $1 where "phone" = $2\nparams: SA0380000000608010167519,+966555123456'), { cause: { code: "23505" } });

vi.mock("@/db", () => ({ getPool: () => ({ connect: async () => ({ query: async () => ({ rows: [{ ok: true }] }), release() {} }) }) }));
vi.mock("@/server/integrations", () => ({ processWebhookQueue: async () => { throw LEAKY; } }));
vi.mock("@/server/partners/service", () => ({ pollPartners: async () => { throw LEAKY; }, processPartnerOutbox: async () => ({}), prunePartnerData: async () => undefined }));
vi.mock("@/server/maintenance", () => ({ runMaintenance: async () => ({}) }));

afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); delete (globalThis as { __jrSchedulerStarted?: boolean }).__jrSchedulerStarted; delete process.env.INTERNAL_SCHEDULER; delete process.env.SCHEDULER_INTERVAL_SEC; });

describe("scheduler logging", () => {
  it("a failing tick is logged as one scrubbed JSON line (no bound parameters, no PII)", async () => {
    process.env.INTERNAL_SCHEDULER = "true"; process.env.SCHEDULER_INTERVAL_SEC = "10";
    vi.useFakeTimers();
    const out: string[] = [];
    vi.spyOn(console, "error").mockImplementation((...a: unknown[]) => { out.push(a.map(String).join(" ")); });
    vi.spyOn(console, "log").mockImplementation((...a: unknown[]) => { out.push(a.map(String).join(" ")); });
    const { startScheduler } = await import("@/server/scheduler");
    startScheduler();
    await vi.advanceTimersByTimeAsync(10_000);
    const all = out.join("\n");
    expect(all).not.toMatch(/SA0380|966555|params:/);
    const errors = out.map((l) => { try { return JSON.parse(l) as { level?: string; correlationId?: string; pgCode?: string }; } catch { return null; } }).filter((j) => j?.level === "error");
    expect(errors.length).toBeGreaterThanOrEqual(1);
    expect(errors.some((j) => j?.correlationId === "scheduler:tick" || j?.correlationId === "scheduler:partner-poll")).toBe(true);
    expect(errors[0]?.pgCode).toBe("23505");
  });
});
