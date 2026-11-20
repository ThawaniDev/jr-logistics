import { eq, sql } from "drizzle-orm";
import { db, type Exec, type Tx } from "@/db";
import { loginEvents, users, messageLog } from "@/db/schema";
import { AppError } from "@/lib/errors";
import { normalizePhone } from "@/lib/phone";
import { logError } from "@/lib/log";

/**
 * Platform data capture (decisions G5–G7). Everything here is best-effort and behaviour-preserving: a capture failure is logged and
 * swallowed, it never fails the action that triggered it. Writes made inside a caller's transaction run in a SAVEPOINT, so even a
 * database error from the capture statement cannot poison that transaction.
 */
const isTx = (x: Exec): x is Tx => typeof (x as { rollback?: unknown }).rollback === "function";

export async function capture(x: Exec, label: string, fn: (x: Exec) => Promise<unknown>): Promise<void> {
  try {
    if (isTx(x)) await x.transaction((sp) => fn(sp));
    else await fn(x);
  } catch (e) { logError(e, { correlationId: `capture:${label}` }); }
}

/** Postgres jsonb rejects \u0000; capture payloads are free text from users, so scrub it (and cap the size). */
export function jsonSafe<T>(v: T, maxChars = 4000): T {
  if (v == null) return v;
  try {
    const s = JSON.stringify(v).replace(/\\u0000/g, "");
    return (s.length > maxChars ? { truncated: true, preview: s.slice(0, maxChars) } : JSON.parse(s)) as T;
  } catch { return null as T; }
}

/** `+966501234567` → `••••4567`: only the last four digits of a phone number are ever stored in logs. */
export const maskPhone = (p: string | null | undefined) => { const d = (p ?? "").replace(/\D/g, ""); return d.length >= 4 ? `••••${d.slice(-4)}` : p ? "••••" : null; };
/** A webhook URL is logged as its host only (paths and query strings can carry secrets). */
export const hostOf = (url: string | null | undefined) => { try { return url ? new URL(url).host : null; } catch { return null; } };

/** The failure reason a rejected sign-in step should be stored with. */
export function loginFailureReason(e: unknown, fallback = "invalid_credentials"): string {
  if (e instanceof AppError) {
    if (e.code === "RATE_LIMITED") return e.message.toLowerCase().includes("locked") ? "locked" : "rate_limited";
    if (e.code === "VALIDATION") return "invalid_code";
    if (e.code === "FORBIDDEN") return e.message.toLowerCase().includes("suspend") ? "suspended" : "wrong_portal";
    if (e.code === "UNAUTHENTICATED") return fallback;
  }
  return fallback;
}

// ───────── Sign-ins ─────────
export interface LoginInput {
  userId?: string | null; identifier?: string | null; method: "otp" | "password" | "api_key" | "session"; success: boolean; failureReason?: string | null;
  ip?: string | null; userAgent?: string | null; client?: string | null; sessionId?: string | null;
}
const normId = (v: string | null | undefined) => {
  const t = (v ?? "").trim(); if (!t) return null;
  return (t.includes("@") ? t.toLowerCase() : normalizePhone(t) ?? t).slice(0, 120);
};

/** One row per sign-in attempt; a success also updates the user's last-login / count / IP. */
export async function recordLogin(i: LoginInput, x: Exec = db): Promise<void> {
  await capture(x, "login", async (t) => {
    await t.insert(loginEvents).values({
      userId: i.userId ?? null, identifier: normId(i.identifier), method: i.method, success: i.success, failureReason: i.success ? null : i.failureReason ?? "invalid_credentials",
      ip: i.ip && i.ip !== "unknown" ? i.ip : null, userAgent: i.userAgent?.slice(0, 200) ?? null, client: i.client ?? null, sessionId: i.sessionId ?? null,
    });
    if (i.success && i.userId) {
      await t.update(users).set({
        lastLoginAt: new Date(), lastSeenAt: new Date(), loginCount: sql`${users.loginCount} + 1`,
        lastLoginIp: i.ip && i.ip !== "unknown" ? i.ip : null, lastLoginClient: i.client ?? null,
      }).where(eq(users.id, i.userId));
    }
  });
}

// ───────── Location & availability ─────────
export interface Ping { lat: number; lng: number; accuracyM?: number | null; speedMps?: number | null; heading?: number | null }
export const LOCATION_SAMPLE_SEC = 60;

/**
 * Appends a point to the driver's path — at most one row per 60 s per driver (a ping that arrives sooner is dropped; the live position on
 * the driver profile is still updated by the caller). `offerId` = the job the driver is on right now, if any.
 */
export async function recordLocation(driverId: string, p: Ping, offerId: string | null = null, x: Exec = db): Promise<boolean> {
  let wrote = false;
  await capture(x, "location", async (t) => {
    const r = await t.execute(sql`insert into driver_location_history (driver_id, lat, lng, accuracy_m, speed_mps, heading, offer_id, recorded_at)
      select ${driverId}::uuid, ${p.lat}, ${p.lng}, ${p.accuracyM ?? null}, ${p.speedMps ?? null}, ${p.heading ?? null}, ${offerId}::uuid, now()
      where not exists (select 1 from driver_location_history h where h.driver_id = ${driverId}::uuid and h.recorded_at > now() - make_interval(secs => ${LOCATION_SAMPLE_SEC}))`);
    wrote = (r.rowCount ?? 0) > 0;
  });
  return wrote;
}

export async function recordAvailability(driverId: string, from: string | null, to: string, source: "driver" | "system" | "admin", reason: string | null = null, actorId: string | null = null, x: Exec = db): Promise<void> {
  if (from === to) return;
  await capture(x, "availability", async (t) => {
    await t.execute(sql`insert into driver_availability_log (driver_id, from_status, to_status, source, reason, actor_id) values (${driverId}::uuid, ${from}, ${to}, ${source}, ${reason}, ${actorId}::uuid)`);
  });
}

// ───────── Message log ─────────
export interface MessageInput {
  channel: "sms" | "push" | "webhook" | "email" | "inapp"; type: string; recipient?: string | null; direction?: "out" | "in";
  userId?: string | null; requestId?: string | null; shipmentId?: string | null; status?: "queued" | "sent" | "failed" | "delivered";
  providerRef?: string | null; error?: string | null; meta?: Record<string, unknown> | null;
}
/** Records one outbound message (recipient already masked by the caller). Returns the row id, or null if the capture failed. */
export async function logMessage(i: MessageInput, x: Exec = db): Promise<string | null> {
  let id: string | null = null;
  const status = i.status ?? "queued";
  await capture(x, "message", async (t) => {
    const [row] = await t.insert(messageLog).values({
      channel: i.channel, direction: i.direction ?? "out", recipient: i.recipient ?? null, type: i.type, userId: i.userId ?? null, requestId: i.requestId ?? null, shipmentId: i.shipmentId ?? null,
      status, providerRef: i.providerRef ?? null, error: i.error ? i.error.slice(0, 300) : null, sentAt: status === "queued" ? null : new Date(), meta: jsonSafe(i.meta ?? null),
    }).returning({ id: messageLog.id });
    id = row?.id ?? null;
  });
  return id;
}

// ───────── Request milestones & activity ─────────
export type Milestone = "first_offer" | "first_accepted" | "filled" | "started";

/**
 * Stamps `last_activity_at` and any milestone that is still empty. Never waits for a row lock (SKIP LOCKED): a request that another
 * transaction is editing is simply caught on its next event, and `reconcileMilestones()` (hourly tick) fills what was missed from
 * offers / events — so capture can neither slow nor deadlock the money-moving transactions that already hold these rows.
 */
export async function touchRequest(x: Exec, requestId: string, milestones: Milestone[] = []): Promise<void> {
  const set = (m: Milestone, col: string) => (milestones.includes(m) ? sql.raw(`, ${col} = coalesce(r.${col}, clock_timestamp())`) : sql``);
  try {
    await x.execute(sql`update requests r set last_activity_at = clock_timestamp()${set("first_offer", "first_offer_at")}${set("first_accepted", "first_accepted_at")}${set("filled", "filled_at")}${set("started", "started_at")}
      from (select id from requests where id = ${requestId}::uuid for update skip locked) l where r.id = l.id`);
  } catch (e) { logError(e, { correlationId: "capture:touch_request" }); }
}

/** Which milestones a job event completes. Pure. */
export function milestonesFor(type: string, payload?: Record<string, unknown> | null): Milestone[] {
  switch (type) {
    case "offers_dispatched": return Number(payload?.count ?? 0) > 0 ? ["first_offer"] : [];
    case "driver_assigned": return ["first_offer"];
    case "driver_accepted": return payload?.requestStatus === "assigned" ? ["first_offer", "first_accepted", "filled"] : ["first_offer", "first_accepted"];
    case "route_approved": case "stop_arrived": return ["started"];
    case "loading_recorded": return payload?.manifest ? [] : ["started"]; // count-based jobs have no route: the recorded hand-over is the start
    default: return [];
  }
}

/** Fills milestones that live capture missed (lock contention, events from before this feature) from the offers themselves. Idempotent. */
export async function reconcileMilestones(days = 7): Promise<number> {
  const since = sql`now() - make_interval(days => ${days})`;
  const upd = async (q: ReturnType<typeof sql>) => (await db.execute(q)).rowCount ?? 0;
  let n = 0;
  n += await upd(sql`update requests r set first_offer_at = x.t from (select request_id, min(created_at) t from offers group by request_id) x where x.request_id = r.id and r.first_offer_at is null and r.updated_at > ${since}`);
  n += await upd(sql`update requests r set first_accepted_at = x.t from (select request_id, min(accepted_at) t from offers where accepted_at is not null group by request_id) x where x.request_id = r.id and r.first_accepted_at is null and r.updated_at > ${since}`);
  n += await upd(sql`update requests r set filled_at = x.t from (select request_id, accepted_at t, row_number() over (partition by request_id order by accepted_at) rn from offers where accepted_at is not null) x
    where x.request_id = r.id and x.rn = r.quantity and r.filled_at is null and r.updated_at > ${since}`);
  n += await upd(sql`update requests r set started_at = x.t from (select request_id, min(route_approved_at) t from offers where route_approved_at is not null group by request_id) x where x.request_id = r.id and r.started_at is null and r.updated_at > ${since}`);
  n += await upd(sql`update requests r set last_activity_at = r.updated_at where r.last_activity_at is null`);
  return n;
}

// ───────── Support: first response, reopen count ─────────
/** First staff response on a ticket / complaint: stamped once, by whoever got there first. */
export async function markFirstResponse(x: Exec, table: "tickets" | "complaints", id: string, byId: string): Promise<void> {
  try {
    await x.execute(sql`update ${sql.raw(table)} set first_response_at = clock_timestamp(), first_response_by = ${byId}::uuid where id = ${id}::uuid and first_response_at is null`);
  } catch (e) { logError(e, { correlationId: "capture:first_response" }); }
}
export async function bumpReopen(x: Exec, ticketId: string): Promise<void> {
  try { await x.execute(sql`update tickets set reopen_count = reopen_count + 1 where id = ${ticketId}::uuid`); }
  catch (e) { logError(e, { correlationId: "capture:reopen" }); }
}

/** Keeps webhook rows of the message log in step with the delivery queue (delivered / dead-lettered / retry count). */
export async function syncWebhookMessages(): Promise<number> {
  const a = await db.execute(sql`update message_log m set status = case d.status when 'delivered' then 'delivered' else 'failed' end, attempts = d.attempts, error = d.last_error,
      sent_at = coalesce(d.delivered_at, now()), meta = coalesce(m.meta, '{}'::jsonb) || jsonb_build_object('statusCode', d.last_status_code)
    from webhook_deliveries d where m.channel = 'webhook' and m.status = 'queued' and m.provider_ref = d.id::text and d.status in ('delivered', 'dead_letter')`);
  const b = await db.execute(sql`update message_log m set attempts = d.attempts, error = d.last_error from webhook_deliveries d
    where m.channel = 'webhook' and m.status = 'queued' and m.provider_ref = d.id::text and d.status = 'retry_wait' and (m.attempts <> d.attempts)`);
  return (a.rowCount ?? 0) + (b.rowCount ?? 0);
}
