import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { partnerOutbox, settings, webhookDeliveries } from "@/db/schema";
import { logError } from "@/lib/log";
import { activeSmsProvider } from "./auth/otp";
import { paymentProvider } from "./wallet";

/** A tick that has not run for this long means housekeeping (expiry, refunds, payouts' webhooks) has stopped. */
const STALE_MIN = 10;

/** Liveness + dependency check. Cheap and public: status only. */
export async function basicHealth() {
  const t0 = Date.now();
  // The route answers 503 without saying why (it is public): the reason goes to the server log, with the usual scrubbing.
  try { await db.execute(sql`select 1`); } catch (e) { logError(e, { correlationId: "health", path: "/api/v1/health" }); throw e; }
  return { status: "ok" as const, time: new Date().toISOString(), db: { ok: true, latencyMs: Date.now() - t0 } };
}

/** The payment provider that top-ups would really use (null = not configured: top-ups answer 503). */
function activePaymentName(): string | null { try { return paymentProvider().name; } catch { return null; } }

/** Operator view (needs the cron secret): queue depths, scheduler freshness and provider configuration — no personal data. */
export async function deepHealth() {
  const base = await basicHealth();
  const [last] = await db.select().from(settings).where(eq(settings.key, "maintenance_last_run"));
  const at = (last?.value as { at?: string } | undefined)?.at ?? null;
  const ageMin = at ? Math.round((Date.now() - new Date(at).getTime()) / 60_000) : null;
  const [wh] = await db.select({ n: sql<number>`count(*)::int` }).from(webhookDeliveries).where(and(inArray(webhookDeliveries.status, ["queued", "retry_wait"]), sql`${webhookDeliveries.nextAttemptAt} <= now() - interval '10 minutes'`));
  const [dead] = await db.select({ n: sql<number>`count(*)::int` }).from(webhookDeliveries).where(eq(webhookDeliveries.status, "dead_letter"));
  const [ob] = await db.select({ n: sql<number>`count(*)::int` }).from(partnerOutbox).where(and(inArray(partnerOutbox.status, ["queued", "retry_wait"]), sql`${partnerOutbox.nextAttemptAt} <= now() - interval '10 minutes'`));
  const [obDead] = await db.select({ n: sql<number>`count(*)::int` }).from(partnerOutbox).where(eq(partnerOutbox.status, "dead"));
  const stale = ageMin == null || ageMin > STALE_MIN;
  return {
    ...base,
    status: stale ? ("degraded" as const) : base.status,
    maintenance: { lastRunAt: at, ageMinutes: ageMin, stale },
    queues: { webhooksOverdue: wh.n, webhooksDeadLetter: dead.n, partnerUpdatesOverdue: ob.n, partnerUpdatesDead: obDead.n },
    providers: { sms: activeSmsProvider()?.name ?? null, storage: process.env.STORAGE_DRIVER ?? (process.env.NODE_ENV === "production" ? null : "local"), payments: activePaymentName() },
  };
}
