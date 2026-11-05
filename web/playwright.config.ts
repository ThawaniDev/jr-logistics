import { defineConfig, devices } from "@playwright/test";

const PORT = 3100;
const DB = "postgres://dogorshom@localhost:5432/jr_logistics_test";
export default defineConfig({
  testDir: "./e2e",
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  globalSetup: "./e2e/global-setup.ts",
  use: { baseURL: `http://localhost:${PORT}`, trace: "retain-on-failure", screenshot: "only-on-failure", locale: "en" },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: `npx next build && npx next start -p ${PORT}`, // production build: deterministic (no on-demand compile reloads)
    url: `http://localhost:${PORT}/api/v1/health`,
    reuseExistingServer: false,
    timeout: 240_000,
    env: { DATABASE_URL: DB, DEMO_MODE: "true", APP_URL: `http://localhost:${PORT}`, NEXT_DIST_DIR: ".next-e2e", ALLOW_DEMO_IN_PRODUCTION: "yes-this-is-a-demo-deployment", STORAGE_DRIVER: "local", AUTH_SECRET: "e2e-secret-e2e-secret-e2e-secret", UPLOAD_DIR: ".next-e2e/uploads", CRON_SECRET: "e2e", SUPER_ADMIN_EMAIL: "admin@jrlogistics.test", SUPER_ADMIN_PASSWORD: "E2e!Password2026" },
  },
});
