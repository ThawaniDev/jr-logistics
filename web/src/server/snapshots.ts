import { sql } from "drizzle-orm";
import { db } from "@/db";
import { reconcileMilestones, syncWebhookMessages } from "./data-capture";
import { logError } from "@/lib/log";

/**
 * Hourly and daily numbers (decision G5): what the platform looked like at a point in time — supply, demand, money held — which cannot be
 * recomputed later from the live tables. Written by the maintenance tick; idempotent through the unique (scope, at, city) key.
 *
 * hour  → `at` = start of the UTC hour. Per city (and `city = null` for the whole platform):
 *   drivers_available · drivers_busy · requests_open · slots_unfilled · requests_in_progress · offers_pending · parcels_pending · parcels_in_transit
 * day   → `at` = start of the Riyadh calendar day (refreshed once an hour until the day is over, so the last write is the closing state):
 *   companies_active · drivers_active · offices_active · tickets_open · complaints_open · wallet_liability_cents (+ _available / _held / _escrow)
 *   and, platform-wide only: credit_exposure_cents · cash_with_drivers_cents · settlements_pending(_cents) · withdrawals_pending(_cents)
 */
export const HOUR_MS = 3600_000, KSA_OFFSET_MS = 3 * HOUR_MS, DAY_MS = 864e5;
export const hourStart = (d: Date) => new Date(Math.floor(d.getTime() / HOUR_MS) * HOUR_MS);
/** Saudi Arabia is UTC+3 all year: a "day" starts at local midnight. */
export const riyadhDayStart = (d: Date) => new Date(Math.floor((d.getTime() + KSA_OFFSET_MS) / DAY_MS) * DAY_MS - KSA_OFFSET_MS);

type Metrics = Record<string, number>;
/** Rows of { city, ...numbers } → a map city → metrics, plus the platform total (key "") summed over every row (including rows without a city). */
export function foldByCity(rows: Array<Record<string, unknown>>, into: Map<string, Metrics> = new Map()): Map<string, Metrics> {
  const add = (key: string, r: Record<string, unknown>) => {
    const m = into.get(key) ?? {};
    for (const [k, v] of Object.entries(r)) if (k !== "city") m[k] = (m[k] ?? 0) + Number(v ?? 0);
    into.set(key, m);
  };
  for (const r of rows) { add("", r); const c = r.city == null ? null : String(r.city); if (c) add(c, r); }
  return into;
}

export const HOURLY_KEYS = ["drivers_available", "drivers_busy", "requests_open", "slots_unfilled", "requests_in_progress", "offers_pending", "parcels_pending", "parcels_in_transit"] as const;
export const DAILY_KEYS = ["companies_active", "drivers_active", "offices_active", "tickets_open", "complaints_open", "wallet_available_cents", "wallet_held_cents", "wallet_escrow_cents", "wallet_liability_cents",
  "credit_exposure_cents", "cash_with_drivers_cents", "settlements_pending", "settlements_pending_cents", "withdrawals_pending", "withdrawals_pending_cents"] as const;
/** Every row carries every key (0 when nothing was counted) and the platform row always exists, so readers never have to guess. */
export function zeroFill(m: Map<string, Metrics>, keys: readonly string[]): Map<string, Metrics> {
  if (!m.has("")) m.set("", {});
  for (const row of m.values()) for (const k of keys) row[k] ??= 0;
  return m;
}
const q = async (query: ReturnType<typeof sql>) => (await db.execute(query)).rows as Array<Record<string, unknown>>;

export async function collectHourly(): Promise<Map<string, Metrics>> {
  const m = new Map<string, Metrics>();
  foldByCity(await q(sql`select u.city,
      count(*) filter (where p.availability = 'available' and p.verification_status = 'verified' and (p.suspended_until is null or p.suspended_until <= now()))::int as drivers_available,
      count(*) filter (where exists (select 1 from offers o where o.driver_id = u.id and o.status in ('accepted','arrived','attendance_confirmed')))::int as drivers_busy
    from users u join driver_profiles p on p.user_id = u.id where u.role = 'driver' and u.status = 'active' group by u.city`), m);
  foldByCity(await q(sql`select r.pickup_city as city,
      count(*) filter (where r.status in ('published','filling'))::int as requests_open,
      coalesce(sum(r.quantity - r.slots_filled) filter (where r.status in ('published','filling')), 0)::int as slots_unfilled,
      count(*) filter (where r.status in ('assigned','confirmed','in_progress'))::int as requests_in_progress
    from requests r where r.status in ('published','filling','assigned','confirmed','in_progress') group by r.pickup_city`), m);
  foldByCity(await q(sql`select r.pickup_city as city, count(*)::int as offers_pending from offers o join requests r on r.id = o.request_id where o.status = 'offered' and r.status in ('published','filling') group by r.pickup_city`), m);
  foldByCity(await q(sql`select s.city,
      count(*) filter (where s.status = 'pending')::int as parcels_pending, count(*) filter (where s.status = 'loaded')::int as parcels_in_transit
    from shipments s join requests r on r.id = s.request_id where r.status in ('published','filling','assigned','confirmed','in_progress') and s.status in ('pending','loaded') group by s.city`), m);
  return zeroFill(m, HOURLY_KEYS);
}

export async function collectDaily(): Promise<Map<string, Metrics>> {
  const m = new Map<string, Metrics>();
  foldByCity(await q(sql`select u.city,
      count(*) filter (where u.role = 'business' and u.status = 'active' and b.verification_status = 'verified')::int as companies_active,
      count(*) filter (where u.role = 'driver' and u.status = 'active' and d.verification_status = 'verified')::int as drivers_active,
      count(*) filter (where u.role = 'office' and u.status = 'active' and o.verification_status = 'verified')::int as offices_active
    from users u left join business_profiles b on b.user_id = u.id left join driver_profiles d on d.user_id = u.id left join office_profiles o on o.user_id = u.id
    where u.role in ('business','driver','office') group by u.city`), m);
  foldByCity(await q(sql`select u.city,
      count(*)::int as tickets_open from tickets t join users u on u.id = t.opened_by where t.status <> 'resolved' group by u.city`), m);
  foldByCity(await q(sql`select u.city, count(*)::int as complaints_open from complaints c join users u on u.id = c.filed_by where c.status in ('open','in_progress') group by u.city`), m);
  foldByCity(await q(sql`select u.city,
      coalesce(sum(greatest(w.available_cents, 0)), 0)::bigint as wallet_available_cents, coalesce(sum(w.held_cents), 0)::bigint as wallet_held_cents, coalesce(sum(w.reserved_cents), 0)::bigint as wallet_escrow_cents,
      coalesce(sum(greatest(w.available_cents, 0) + w.held_cents + w.reserved_cents), 0)::bigint as wallet_liability_cents
    from wallet_accounts w join users u on u.id = w.owner_id where w.kind = 'user' group by u.city`), m);
  const plat = m.get("") ?? {};
  const [x] = await q(sql`select
      (select coalesce(sum(-least(available_cents, 0)), 0) from wallet_accounts where kind = 'user')::bigint as credit_exposure_cents,
      ((select coalesce(sum(cod_collected_cents), 0) from shipments where cod_collected_cents is not null) - (select coalesce(sum(amount_cents), 0) from cod_remittances))::bigint as cash_with_drivers_cents,
      (select count(*) from settlements where status in ('pending_review','approved','batch_ready','failed'))::int as settlements_pending,
      (select coalesce(sum(provider_cents), 0) from settlements where status in ('pending_review','approved','batch_ready','failed'))::bigint as settlements_pending_cents,
      (select count(*) from withdrawals where status in ('pending','approved'))::int as withdrawals_pending,
      (select coalesce(sum(amount_cents), 0) from withdrawals where status in ('pending','approved'))::bigint as withdrawals_pending_cents`);
  for (const [k, v] of Object.entries(x)) plat[k] = Number(v ?? 0);
  m.set("", plat);
  return zeroFill(m, DAILY_KEYS);
}

async function write(scope: "hour" | "day", at: Date, rows: Map<string, Metrics>, refresh: boolean): Promise<number> {
  let n = 0;
  for (const [city, metrics] of rows) {
    const res = await db.execute(sql`insert into metric_snapshots (at, scope, city, metrics) values (${at}, ${scope}, ${city || null}, ${JSON.stringify(metrics)}::jsonb)
      on conflict (scope, at, (coalesce(city, ''))) ${refresh ? sql`do update set metrics = excluded.metrics` : sql`do nothing`}`);
    n += res.rowCount ?? 0;
  }
  return n;
}

export async function takeHourlySnapshot(now = new Date()) { return write("hour", hourStart(now), await collectHourly(), false); }
export async function takeDailySnapshot(now = new Date()) { return write("day", riyadhDayStart(now), await collectDaily(), true); }

/** Deletes in bounded batches so the first run after a long gap cannot hold a lock for minutes. */
async function prune(table: string, col: string, olderThanDays: number, now: Date): Promise<number> {
  let total = 0;
  for (let i = 0; i < 20; i++) {
    const r = await db.execute(sql`delete from ${sql.raw(table)} where id in (select id from ${sql.raw(table)} where ${sql.raw(col)} < ${new Date(now.getTime() - olderThanDays * DAY_MS)} limit 10000)`);
    total += r.rowCount ?? 0;
    if ((r.rowCount ?? 0) < 10000) break;
  }
  return total;
}
export const RETENTION_DAYS = { driver_location_history: 90, login_events: 400, message_log: 400 } as const;
/**
 * A failed sign-in that matched NO account (`user_id is null`) stores what was typed in the username box in `identifier` — very often a mistyped PASSWORD — so after this many
 * days the text is erased (audit K, A4). The row stays (counts by day, device and reason feed the Growth report's sign-in failure rate); only the free text goes. Bounded batches.
 */
export const UNKNOWN_LOGIN_IDENTIFIER_DAYS = 30;
export async function redactUnknownLoginIdentifiers(now = new Date()): Promise<number> {
  let total = 0;
  const cutoff = new Date(now.getTime() - UNKNOWN_LOGIN_IDENTIFIER_DAYS * DAY_MS);
  for (let i = 0; i < 20; i++) {
    const r = await db.execute(sql`update login_events set identifier = null where id in (select id from login_events where success = false and user_id is null and identifier is not null and created_at < ${cutoff} limit 10000)`);
    total += r.rowCount ?? 0;
    if ((r.rowCount ?? 0) < 10000) break;
  }
  return total;
}
/**
 * In-app notifications are a mailbox, not a record: a read one is noise after 90 days, any one is after 12 months (an unread one older than that was never going to be read). Every new request
 * pushes an `offer_new` notification to each eligible driver, so this is the fastest-growing business table (14 rows per request, 344 000 rows / 154 MB on a 365-day scratch database).
 * The request activity timeline reads `notifications` too: it shows notifications of the last 90 days (read) / 12 months (unread). One constant, in days.
 */
export const NOTIFICATION_RETENTION = { readDays: 90, anyDays: 365 } as const;
export async function pruneNotifications(now = new Date()): Promise<number> {
  let total = 0;
  const readBefore = new Date(now.getTime() - NOTIFICATION_RETENTION.readDays * DAY_MS), anyBefore = new Date(now.getTime() - NOTIFICATION_RETENTION.anyDays * DAY_MS);
  for (let i = 0; i < 20; i++) {
    const r = await db.execute(sql`delete from notifications where id in (select id from notifications where created_at < ${readBefore} and (read_at is not null or created_at < ${anyBefore}) limit 10000)`);
    total += r.rowCount ?? 0;
    if ((r.rowCount ?? 0) < 10000) break;
  }
  return total;
}
export async function pruneCaptureData(now = new Date()) {
  const out = {
    locations: await prune("driver_location_history", "recorded_at", RETENTION_DAYS.driver_location_history, now),
    logins: await prune("login_events", "created_at", RETENTION_DAYS.login_events, now),
    messages: await prune("message_log", "created_at", RETENTION_DAYS.message_log, now),
    notifications: await pruneNotifications(now),
  };
  await redactUnknownLoginIdentifiers(now);
  return out;
}

/**
 * One call from the maintenance tick. Cheap every minute (webhook log sync); once per hour (the first tick of each hour) it also writes the
 * hourly snapshot, refreshes today's daily snapshot, fills missed request milestones and prunes old capture data. Never throws.
 */
export async function runCaptureTick(now = new Date()) {
  const out = { hourly: false, daily: false, webhookLogSynced: 0, milestonesFilled: 0, pruned: null as null | Awaited<ReturnType<typeof pruneCaptureData>> };
  try { out.webhookLogSynced = await syncWebhookMessages(); } catch (e) { logError(e, { correlationId: "capture:webhook_sync" }); }
  try {
    const has = async (scope: string, at: Date) => (await db.execute(sql`select 1 from metric_snapshots where scope = ${scope} and at = ${at} and city is null`)).rows.length > 0;
    if (!(await has("hour", hourStart(now)))) {
      out.hourly = (await takeHourlySnapshot(now)) > 0;
      out.daily = (await takeDailySnapshot(now)) > 0;
      out.milestonesFilled = await reconcileMilestones();
      out.pruned = await pruneCaptureData(now);
    } else if (!(await has("day", riyadhDayStart(now)))) out.daily = (await takeDailySnapshot(now)) > 0;
  } catch (e) { logError(e, { correlationId: "capture:snapshots" }); }
  return out;
}
