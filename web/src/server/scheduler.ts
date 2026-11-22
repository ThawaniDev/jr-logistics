import { getPool } from "@/db";
import { processWebhookQueue } from "./integrations";
import { pollPartners, processPartnerOutbox, prunePartnerData } from "./partners/service";
import { runMaintenance } from "./maintenance";
import { logError, logInfo } from "@/lib/log";

/** Arbitrary constant: the Postgres advisory-lock key that means "someone is running the housekeeping tick". */
const LOCK_KEY = 7_788_002;

/**
 * One housekeeping tick (webhook retries + offer/request/document maintenance) — the same work `POST /api/v1/cron/tick` does.
 * A session-level advisory lock makes it safe to run on every app instance: whoever holds the lock does the work, the rest skip,
 * so a deployment with several replicas never runs two ticks at once.
 */
export async function runSchedulerTick(): Promise<{ ran: boolean }> {
  const client = await getPool().connect();
  try {
    const { rows } = await client.query<{ ok: boolean }>("select pg_try_advisory_lock($1) as ok", [LOCK_KEY]);
    if (!rows[0].ok) return { ran: false };
    try {
      await processWebhookQueue(50);
      await processPartnerOutbox(50);
      await pollPartners().catch((e) => logError(e, { correlationId: "scheduler:partner-poll" }));
      if (new Date().getUTCMinutes() === 7) await prunePartnerData().catch(() => undefined); // hourly is plenty
      await runMaintenance();
      return { ran: true };
    } finally {
      await client.query("select pg_advisory_unlock($1)", [LOCK_KEY]);
    }
  } finally {
    client.release();
  }
}

declare global { var __jrSchedulerStarted: boolean | undefined }

/**
 * Starts the in-process scheduler when `INTERNAL_SCHEDULER=true`. Opt-in: serverless platforms cannot keep timers alive (use an external
 * cron against `/api/v1/cron/tick` there), and dev servers hot-reload. Interval: `SCHEDULER_INTERVAL_SEC` (default 60, minimum 10).
 */
export function startScheduler() {
  if (process.env.INTERNAL_SCHEDULER !== "true" || globalThis.__jrSchedulerStarted) return;
  globalThis.__jrSchedulerStarted = true;
  const every = Math.max(10, Number(process.env.SCHEDULER_INTERVAL_SEC ?? 60) || 60) * 1000;
  let busy = false;
  const timer = setInterval(async () => {
    if (busy) return; // a slow tick must not stack
    busy = true;
    try { await runSchedulerTick(); }
    catch (e) { logError(e, { correlationId: "scheduler:tick" }); } // scrubbed: a database error message carries the failing statement WITH its bound parameters
    finally { busy = false; }
  }, every);
  timer.unref(); // never keep the process alive just for the timer
  logInfo("scheduler started", { everySec: every / 1000 });
}
