import { afterEach, describe, expect, it, vi } from "vitest";
import { assertProductionEnv, checkEnv, enforceProductionEnv, initialAdminPasswordProblem } from "@/lib/env-check";

const GOOD = { DATABASE_URL: "postgres://x/y", AUTH_SECRET: "a-long-random-secret-0123456789abcdef", CRON_SECRET: "another-long-random-cron-secret", STORAGE_DRIVER: "local", UPLOAD_DIR: "/data/uploads", INTEGRATIONS_SECRET: "integrations-secret-0123456789", APP_URL: "https://jr.example.com" };
const DEMO = { DEMO_MODE: "true", ALLOW_DEMO_IN_PRODUCTION: "yes-this-is-a-demo-deployment" };

describe("production start-up check (fail closed)", () => {
  it("a complete configuration has no errors and no warnings", () => {
    expect(checkEnv(GOOD)).toEqual({ errors: [], warnings: [] });
  });

  it("refuses to start without a database or a signing secret", () => {
    expect(checkEnv({}).errors.join(" ")).toMatch(/DATABASE_URL/);
    expect(checkEnv({}).errors.join(" ")).toMatch(/AUTH_SECRET is not set/);
    expect(checkEnv({ ...GOOD, AUTH_SECRET: "short" }).errors.join(" ")).toMatch(/AUTH_SECRET is shorter/);
  });

  it("rejects placeholder secrets on a real deployment, including the one .env.example ships", () => {
    expect(checkEnv({ ...GOOD, CRON_SECRET: "change-me" }).errors.join(" ")).toMatch(/CRON_SECRET/);
    expect(checkEnv({ ...GOOD, CRON_SECRET: "xxxxxxxxxxxxxxxxxxxx" }).errors.join(" ")).toMatch(/CRON_SECRET/);
    expect(checkEnv({ ...GOOD, CRON_SECRET: "tooshort" }).errors.join(" ")).toMatch(/CRON_SECRET/);
    expect(checkEnv({ ...GOOD, AUTH_SECRET: "please-change-me-before-going-live" }).errors.join(" ")).toMatch(/AUTH_SECRET is a placeholder/);
    expect(checkEnv({ ...GOOD, AUTH_SECRET: "1234567890123456789012" }).errors.join(" ")).toMatch(/AUTH_SECRET is a placeholder/);
  });

  it("does not mistake a random secret that merely starts like a placeholder for one", () => {
    expect(checkEnv({ ...GOOD, CRON_SECRET: "1234f9c0a7b34d2e9a51" }).errors).toEqual([]);
  });

  it("a demo / test deployment keeps its short made-up secrets (warnings only) but still needs a database and AUTH_SECRET", () => {
    const r = checkEnv({ ...GOOD, ...DEMO, CRON_SECRET: "e2e" });
    expect(r.errors).toEqual([]);
    expect(r.warnings.join(" ")).toMatch(/CRON_SECRET/);
    expect(r.warnings.join(" ")).toMatch(/DEMO MODE IS ACTIVE/);
    expect(checkEnv({ ...DEMO, AUTH_SECRET: "" }).errors.length).toBeGreaterThanOrEqual(2);
  });

  it("says so when DEMO_MODE is ignored because the acknowledgement is missing", () => {
    const r = checkEnv({ ...GOOD, DEMO_MODE: "true" });
    expect(r.errors).toEqual([]);
    expect(r.warnings.join(" ")).toMatch(/ignored in production/);
  });

  it("validates the storage driver and the S3 settings it needs", () => {
    expect(checkEnv({ ...GOOD, STORAGE_DRIVER: "gcs" }).errors.join(" ")).toMatch(/not supported/);
    expect(checkEnv({ ...GOOD, STORAGE_DRIVER: "s3" }).errors.join(" ")).toMatch(/S3_BUCKET, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY are not set/);
    expect(checkEnv({ ...GOOD, STORAGE_DRIVER: "s3", S3_BUCKET: "b", S3_ACCESS_KEY_ID: "k", S3_SECRET_ACCESS_KEY: "s" }).errors).toEqual([]);
    expect(checkEnv({ ...GOOD, STORAGE_DRIVER: "" }).warnings.join(" ")).toMatch(/uploads are refused/);
    expect(checkEnv({ ...GOOD, UPLOAD_DIR: "" }).warnings.join(" ")).toMatch(/UPLOAD_DIR/);
  });

  it("warns (does not stop) about things that degrade a feature", () => {
    const w = checkEnv({ DATABASE_URL: "postgres://x/y", AUTH_SECRET: GOOD.AUTH_SECRET, TRUSTED_PROXY: "two", ALLOW_PRIVATE_OUTBOUND: "yes-this-is-a-test-deployment" }).warnings.join("\n");
    expect(w).toMatch(/CRON_SECRET is not set and INTERNAL_SCHEDULER/);
    expect(w).toMatch(/INTEGRATIONS_SECRET/);
    expect(w).toMatch(/APP_URL is not set/);
    expect(w).toMatch(/TRUSTED_PROXY="two"/);
    expect(w).toMatch(/ALLOW_PRIVATE_OUTBOUND/);
    expect(checkEnv({ ...GOOD, CRON_SECRET: "", INTERNAL_SCHEDULER: "true" }).warnings.join(" ")).toMatch(/internal scheduler still runs/);
  });

  it("assertProductionEnv logs JSON lines, throws on errors and never prints a secret", () => {
    const lines: string[] = [];
    expect(() => assertProductionEnv({ AUTH_SECRET: "super-secret-value-0123", STORAGE_DRIVER: "gcs" }, (l) => lines.push(l))).toThrow(/Refusing to start: 2 configuration error/);
    const parsed = lines.map((l) => JSON.parse(l) as { level: string; msg: string });
    expect(parsed.filter((p) => p.level === "fatal")).toHaveLength(2);
    expect(parsed.every((p) => p.level === "warn" || p.level === "fatal")).toBe(true);
    expect(lines.join("\n")).not.toContain("super-secret-value-0123");
    expect(() => assertProductionEnv(GOOD, () => {})).not.toThrow();
  });

  describe("enforceProductionEnv", () => {
    afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); process.exitCode = undefined; });

    it("exits the process with code 1 on a configuration error (a bare throw would leave the server answering 500s)", () => {
      vi.useFakeTimers();
      const exit = vi.spyOn(process, "exit").mockImplementation((() => undefined) as never);
      vi.spyOn(console, "error").mockImplementation(() => {});
      expect(() => enforceProductionEnv({})).toThrow(/Refusing to start/);
      expect(process.exitCode).toBe(1);
      expect(exit).not.toHaveBeenCalled(); // after a short delay, so the log lines are flushed first
      vi.advanceTimersByTime(150);
      expect(exit).toHaveBeenCalledWith(1);
    });

    it("does nothing on a good configuration", () => {
      vi.useFakeTimers();
      const exit = vi.spyOn(process, "exit").mockImplementation((() => undefined) as never);
      vi.spyOn(console, "error").mockImplementation(() => {});
      expect(() => enforceProductionEnv(GOOD)).not.toThrow();
      vi.advanceTimersByTime(1000);
      expect(exit).not.toHaveBeenCalled();
      expect(process.exitCode).toBeUndefined();
    });
  });

  it("refuses a guessable initial super-admin password", () => {
    for (const bad of [undefined, "", "short1A", "Admin12345678", "Password2026!!", "changeme-please-1", "abcdefghijkl", "123456789012", "JrLogistics2026x"]) expect(initialAdminPasswordProblem(bad), String(bad)).not.toBeNull();
    expect(initialAdminPasswordProblem("Vq7!rT2m-Kx9w")).toBeNull();
    expect(initialAdminPasswordProblem("E2e!Password2026")).not.toBeNull(); // the e2e/demo value is not acceptable on a real deployment
  });
});
