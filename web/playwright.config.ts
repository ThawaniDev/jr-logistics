import { defineConfig, devices } from "@playwright/test";

const PORT = Number(process.env.E2E_PORT ?? 3101); // 3100 is often taken by another project
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
    env: { DATABASE_URL: DB, DEMO_MODE: "true", APP_URL: `http://localhost:${PORT}`, NEXT_DIST_DIR: ".next-e2e", ALLOW_DEMO_IN_PRODUCTION: "yes-this-is-a-demo-deployment", ALLOW_PRIVATE_OUTBOUND: "yes-this-is-a-test-deployment", INTEGRATIONS_SECRET: "e2e-integrations-secret-e2e-integrations", GOOGLE_MAPS_API_KEY: "e2e-google-key", GOOGLE_ROUTES_URL: "http://127.0.0.1:3199/routes", GOOGLE_GEOCODE_URL: "http://127.0.0.1:3199/geocode", STORAGE_DRIVER: "local", AUTH_SECRET: "e2e-secret-e2e-secret-e2e-secret", UPLOAD_DIR: ".next-e2e/uploads", CRON_SECRET: "e2e", SUPER_ADMIN_EMAIL: "admin@jrlogistics.test", SUPER_ADMIN_PASSWORD: "E2e!Password2026" },
  },
});
