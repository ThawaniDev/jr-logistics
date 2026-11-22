/**
 * Runs once when a server instance starts (Node runtime only).
 * A production build first checks its configuration and refuses to start (the process exits with code 1) when something it cannot run without is missing
 * (see `lib/env-check.ts`); then it starts the optional in-process scheduler.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    if (process.env.NODE_ENV === "production") (await import("./lib/env-check")).enforceProductionEnv();
    const { startScheduler } = await import("./server/scheduler");
    startScheduler();
  }
}
