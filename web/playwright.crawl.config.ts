import { defineConfig, devices } from "@playwright/test";

/** Config of the UI crawl (`e2e/crawl.spec.ts`): no web server, no test DB — it drives a server that is already running (default http://localhost:3000, the dev DB). */
export default defineConfig({
  testDir: "./e2e",
  outputDir: "test-results/crawl-pw", // Playwright empties its output dir at the start of every run: keep it away from the JSON results in test-results/crawl
  testMatch: process.env.CRAWL_SPEC ?? "crawl.spec.ts",
  timeout: 3 * 3600_000,
  expect: { timeout: 10_000 },
  fullyParallel: true,
  workers: Number(process.env.CRAWL_WORKERS ?? 3),
  retries: 0,
  reporter: [["list"]],
  use: { baseURL: process.env.CRAWL_BASE ?? "http://localhost:3000", navigationTimeout: 90_000, actionTimeout: 15_000 },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
