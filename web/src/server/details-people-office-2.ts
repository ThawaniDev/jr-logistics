import { sql } from "drizzle-orm";
import type { User } from "@/db/schema";
import { contains } from "@/lib/sql";
import { can, requirePerm } from "./auth/permissions";
import { getSettings } from "./settings";
import { inWindow } from "./analytics/conditions";
import { bucketSql, zeroFill } from "./analytics/buckets";
import { bucketKeys } from "./analytics/periods";
import { addDays, dayStart, riyadhDay, startOfWeek } from "./analytics/time";
import { num, rows } from "./analytics/guard";
import { clampPage, daysUntil, driverRisks, parsePeriod, resolvePeriod, type PeriodKey, type RiskKey } from "./details-people-lib";
import { COMPLETED_AT, DECIDED, OUTCOME_AT, STOPPED_AT, anyW, hasAnyPerm, list } from "./details-people-sql";
import { OFFICE_MONEY, officeBase } from "./details-people-office";
import { offerList, type ListQuery } from "./details-people-driver";

/** Courier-office detail lists: the driver scorecard, link / unlink / invite history, every job of the office and the agreement history. */
type Rec = Record<string, unknown>;
export const SCORE_SORTS = ["name", "jobs", "parcels", "success", "on_time", "acceptance", "rating", "earnings", "no_shows", "last_active"] as const;
export const SCORE_STATES = ["all", "available", "pending", "suspended"] as const;
const FLEET = ["offices.view", "offices.manage", "drivers.view"] as const;
const maskPhone = (p: unknown) => (typeof p === "string" && p ? p.slice(0, 4) + "•••" + p.slice(-2) : null);

export interface ScoreQuery { period?: string; q?: string; state?: string; sort?: string; dir?: string; page?: number; pageSize?: number }
/**
 * One row per affiliated driver with what they did FOR this office in the period (offers carry the office they were sent through): jobs, parcels, success, punctuality,
 * acceptance, rating, no-shows, earnings (money permission) and an 8-week delivery sparkline. `flags` are the same risk rules the driver page uses (those that need only this data).
 */
export async function officeScorecard(viewer: User, officeId: string, q: ScoreQuery) {
  const { u } = await officeBase(viewer, officeId, FLEET);
  const now = new Date(); const per = resolvePeriod(parsePeriod(q.period) as PeriodKey, now, u.createdAt); const win = per.cur;
  const money = hasAnyPerm(viewer, OFFICE_MONEY), sensitive = can(viewer, "drivers.sensitive"); const grace = (await getSettings()).lateGraceMin;
  const { page, pageSize, offset } = clampPage(q, 10, 50); const find = q.q?.trim() ? contains(q.q) : null;
  const state = (SCORE_STATES as readonly string[]).includes(q.state ?? "") ? q.state : "all";
  const sortKey = (SCORE_SORTS as readonly string[]).includes(q.sort ?? "") ? q.sort! : "jobs"; const dir = q.dir === "asc" ? sql`asc` : sql`desc`;
  const limit = sql`requests.starts_at + make_interval(mins => ${grace}::int)`;
  const counted = sql`offers.accepted_at is not null and offers.status not in ('rejected','expired','cancelled','replaced')`;
  const ord: Record<string, ReturnType<typeof sql>> = {
    name: sql`d.name`, jobs: sql`coalesce(o.jobs, 0)`, parcels: sql`coalesce(s.delivered, 0)`, success: sql`case when coalesce(s.outcomes, 0) > 0 then s.delivered::float8 / s.outcomes end`,
    on_time: sql`case when coalesce(o.due, 0) > 0 then o.on_time::float8 / o.due end`, acceptance: sql`case when coalesce(o.decided, 0) > 0 then o.accepted::float8 / o.decided end`,
    rating: sql`case when coalesce(r.n, 0) > 0 then r.sum::float8 / r.n end`, earnings: sql`coalesce(e.cents, 0)`, no_shows: sql`coalesce(o.no_show, 0)`, last_active: sql`d.last_seen_at`,
  };
  const dState = state === "available" ? sql`and dp.availability = 'available' and dp.verification_status = 'verified' and u.status = 'active' and (dp.suspended_until is null or dp.suspended_until <= now())`
    : state === "pending" ? sql`and dp.verification_status = 'pending'` : state === "suspended" ? sql`and (dp.suspended_until > now() or u.status = 'suspended')` : sql``;
  const data = await rows<Rec>(sql`
    with d as (
      select u.id, u.name, u.phone, u.city, u.status, u.last_seen_at, u.created_at, dp.vehicle_type, dp.availability, dp.verification_status, dp.suspended_until, dp.rating_sum, dp.rating_count, dp.jobs_completed,
        exists (select 1 from offers x where x.driver_id = u.id and x.status in (${list(["accepted", "arrived", "attendance_confirmed", "delivered_reported", "qty_disputed", "pending_settlement"])})) as on_job
      from driver_profiles dp join users u on u.id = dp.user_id where dp.office_id = ${officeId} ${dState} ${find ? sql`and (u.name ilike ${find} or u.phone ilike ${find})` : sql``}),
    o as (
      select offers.driver_id,
        count(*) filter (where offers.status = 'completed' and ${inWindow(COMPLETED_AT, win)})::int as jobs,
        count(*) filter (where ${inWindow("offers.created_at", win)} and ${DECIDED})::int as decided, count(*) filter (where ${inWindow("offers.created_at", win)} and ${DECIDED} and offers.accepted_at is not null)::int as accepted,
        count(*) filter (where offers.status = 'no_show' and ${inWindow(STOPPED_AT, win)})::int as no_show,
        count(*) filter (where ${inWindow("requests.starts_at", win)} and ${counted} and offers.arrived_at is not null and offers.arrived_at <= ${limit})::int as on_time,
        count(*) filter (where ${inWindow("requests.starts_at", win)} and ${counted} and (offers.arrived_at is not null or offers.status = 'no_show' or now() > ${limit}))::int as due
      from offers join requests on requests.id = offers.request_id
      where offers.office_id = ${officeId} and offers.driver_id in (select id from d) and ${anyW({ ...per, prev: null }, COMPLETED_AT, "offers.created_at", "requests.starts_at", STOPPED_AT)} group by 1),
    s as (
      select offers.driver_id, count(*) filter (where shipments.status = 'delivered')::int as delivered, count(*)::int as outcomes from shipments join offers on offers.id = shipments.offer_id
      where offers.office_id = ${officeId} and offers.driver_id in (select id from d) and ${inWindow(OUTCOME_AT, win)} group by 1),
    r as (
      select offers.driver_id, sum(ratings.stars)::int as sum, count(*)::int as n from ratings join offers on offers.id = ratings.offer_id
      where offers.office_id = ${officeId} and offers.driver_id in (select id from d) and ${inWindow("ratings.created_at", win)} group by 1),
    e as (
      select settlements.driver_id, sum(settlements.provider_cents)::float8 as cents from settlements
      where settlements.office_id = ${officeId} and settlements.status <> 'rejected' and settlements.driver_id in (select id from d) and ${inWindow("settlements.created_at", win)} group by 1)
    select d.*, o.jobs, o.decided, o.accepted, o.no_show, o.on_time, o.due, s.delivered, s.outcomes, r.sum as rating_sum_p, r.n as rating_n_p, e.cents, count(*) over () as total
    from d left join o on o.driver_id = d.id left join s on s.driver_id = d.id left join r on r.driver_id = d.id left join e on e.driver_id = d.id
    order by ${ord[sortKey]} ${dir} nulls last, d.name asc, d.id limit ${pageSize} offset ${offset}`);
  const ids = data.map((r) => String(r.id));
  const today = riyadhDay(now), from = addDays(startOfWeek(today), -49), keys = bucketKeys(from, today, "week");
  const sparkRows = ids.length ? await rows<Rec>(sql`select offers.driver_id as id, ${bucketSql("shipments.delivered_at", "week")} as t, count(*)::int as delivered from shipments join offers on offers.id = shipments.offer_id
      where offers.office_id = ${officeId} and offers.driver_id in (${list(ids)}) and shipments.status = 'delivered' and shipments.delivered_at >= ${dayStart(from).toISOString()}::timestamptz group by 1, 2`) : [];
  const spark = new Map<string, Array<{ t: string }>>(); for (const r of sparkRows) { const k = String(r.id); const l = spark.get(k) ?? []; l.push({ t: String(r.t), delivered: num(r.delivered) } as { t: string }); spark.set(k, l); }
  const ratio = (n: unknown, d: unknown) => (num(d) > 0 ? num(n) / num(d) : null);
  return {
    page, pageSize, total: num(data[0]?.total), period: { key: per.key, from: win.from, to: win.to }, sparkWeeks: keys,
    items: data.map((r) => {
      const suspended = (!!r.suspended_until && new Date(r.suspended_until as string | Date).getTime() > now.getTime()) || r.status === "suspended";
      const flags: RiskKey[] = driverRisks({ now, joinedAt: r.created_at as Date, verified: r.verification_status === "verified", completedTotal: num(r.jobs_completed), acceptedJobs: num(r.accepted), noShows: num(r.no_show), decidedOffers: num(r.decided), acceptedOffers: num(r.accepted), suspended, strikes: null }).map((x) => x.key);
      return {
        id: r.id, name: r.name, phone: sensitive ? r.phone : maskPhone(r.phone), city: r.city, vehicleType: r.vehicle_type, status: r.status, verificationStatus: r.verification_status, availability: r.availability, onJob: !!r.on_job,
        suspendedUntil: r.suspended_until ?? null, lastSeenAt: r.last_seen_at ?? null, jobs: num(r.jobs), jobsLifetime: num(r.jobs_completed), parcels: num(r.delivered), outcomes: num(r.outcomes), success: ratio(r.delivered, r.outcomes), onTime: ratio(r.on_time, r.due),
        acceptance: ratio(r.accepted, r.decided), rating: ratio(r.rating_sum_p, r.rating_n_p), ratingCount: num(r.rating_n_p), ratingLifetime: num(r.rating_count) ? Math.round((num(r.rating_sum) / num(r.rating_count)) * 10) / 10 : null,
        noShows: num(r.no_show), earningsCents: money ? num(r.cents) : undefined,
        spark: zeroFill(keys, spark.get(String(r.id)) ?? [], ["delivered"] as const).map((x) => x.delivered), flags,
      };
    }),
  };
}

/** Everyone who is or was linked to the office, every invite and every link / unlink, newest first. Unlinks by staff are attributed to the office only when its link was the driver's latest. */
export async function officeDriverHistory(viewer: User, officeId: string) {
  await officeBase(viewer, officeId, FLEET); const sensitive = can(viewer, "drivers.sensitive");
  const [invites, links, unlinks, current] = await Promise.all([
    rows<Rec>(sql`select i.id, i.phone, i.status, i.created_at, i.responded_at, i.driver_id, du.name as driver from office_invites i left join users du on du.id = i.driver_id where i.office_id = ${officeId} order by i.created_at desc limit 100`),
    rows<Rec>(sql`select a.id, a.entity_id as driver_id, a.created_at as at, a.actor_role, au.name as actor, du.name as driver, a.diff->>'via' as via from audit_logs a left join users au on au.id = a.actor_id left join users du on du.id::text = a.entity_id
      where a.action = 'office.link_driver' and a.entity = 'user' and a.diff->>'officeId' = ${officeId} order by a.created_at desc limit 100`),
    rows<Rec>(sql`with links as (
        select driver_id::text as d, office_id::text as o, responded_at as at from office_invites where status = 'accepted' and driver_id is not null and responded_at is not null
        union all select entity_id, diff->>'officeId', created_at from audit_logs where action = 'office.link_driver' and entity = 'user' and diff ? 'officeId')
      select a.id, a.entity_id as driver_id, a.created_at as at, a.actor_role, au.name as actor, du.name as driver from audit_logs a left join users au on au.id = a.actor_id left join users du on du.id::text = a.entity_id
      where a.action = 'office.unlink_driver' and a.entity = 'user' and (a.actor_id = ${officeId} or (select l.o from links l where l.d = a.entity_id and l.at <= a.created_at order by l.at desc limit 1) = ${officeId})
      order by a.created_at desc limit 100`),
    rows<Rec>(sql`select u.id, u.name, u.phone, u.city, dp.availability, dp.verification_status,
        (select max(x.at) from (select responded_at as at from office_invites where office_id = ${officeId} and driver_id = u.id and status = 'accepted'
          union all select created_at from audit_logs where action = 'office.link_driver' and entity = 'user' and entity_id = u.id::text and diff->>'officeId' = ${officeId}) x) as linked_since
      from driver_profiles dp join users u on u.id = dp.user_id where dp.office_id = ${officeId} order by u.name limit 300`),
  ]);
  const events = [
    ...invites.flatMap((i) => [
      { id: `${i.id}:sent`, at: i.created_at, kind: "invite_sent", driverId: i.driver_id ?? null, driver: i.driver ?? null, phone: sensitive ? i.phone : maskPhone(i.phone), by: null as string | null, via: null as string | null },
      ...(i.responded_at ? [{ id: `${i.id}:${i.status}`, at: i.responded_at, kind: `invite_${i.status}`, driverId: i.driver_id ?? null, driver: i.driver ?? null, phone: sensitive ? i.phone : maskPhone(i.phone), by: null, via: null }] : []),
    ]),
    ...links.map((l) => ({ id: String(l.id), at: l.at, kind: "linked", driverId: l.driver_id, driver: l.driver ?? null, phone: null, by: (l.actor as string | null) ?? null, via: (l.via as string | null) ?? null })),
    ...unlinks.map((l) => ({ id: String(l.id), at: l.at, kind: "unlinked", driverId: l.driver_id, driver: l.driver ?? null, phone: null, by: (l.actor as string | null) ?? null, via: l.actor_role === "office" ? "office" : "staff" })),
  ].sort((a, b) => new Date(b.at as Date).getTime() - new Date(a.at as Date).getTime()).slice(0, 150);
  const pendingInvites = invites.filter((i) => i.status === "pending").map((i) => ({ id: i.id, phone: sensitive ? i.phone : maskPhone(i.phone), createdAt: i.created_at, ageDays: Math.floor((Date.now() - new Date(i.created_at as Date).getTime()) / 864e5) }));
  const by = (st: string) => invites.filter((i) => i.status === st).length;
  return {
    current: current.map((d) => ({ id: d.id, name: d.name, phone: sensitive ? d.phone : maskPhone(d.phone), city: d.city, availability: d.availability, verificationStatus: d.verification_status, linkedSince: d.linked_since ?? null })),
    invites: { total: invites.length, pending: by("pending"), accepted: by("accepted"), declined: by("declined"), cancelled: by("cancelled"), pendingList: pendingInvites }, events,
  };
}

/** Every job (offer) the office's drivers worked through it, filterable by period, status, driver and text. Earnings need a money permission. */
export async function officeJobLog(viewer: User, officeId: string, q: ListQuery & { driverId?: string }) {
  const { u } = await officeBase(viewer, officeId, ["offices.view", "offices.manage"]);
  const per = resolvePeriod(parsePeriod(q.period ?? "all") as PeriodKey, new Date(), u.createdAt);
  return offerList({ where: sql`offers.office_id = ${officeId}`, money: hasAnyPerm(viewer, OFFICE_MONEY) }, per.cur, q);
}

const AGREEMENT_STATES = ["none", "pending", "accepted", "expired", "superseded"] as const;
/** All agreements ever sent to the office: terms, who sent it, when it was accepted (and how long that took), expiry, plus the current state. Needs `offices.view`. */
export async function officeAgreementHistory(viewer: User, officeId: string) {
  await officeBase(viewer, officeId, ["offices.view"]);
  const data = await rows<Rec>(sql`select a.id, a.version, a.status, a.terms, a.effective_at, a.expires_at, a.accepted_at, a.created_at, cu.name as created_by from office_agreements a left join users cu on cu.id = a.created_by
    where a.office_id = ${officeId} order by a.version desc limit 100`);
  const now = new Date();
  const items = data.map((a) => {
    const expired = a.status === "accepted" && !!a.expires_at && new Date(a.expires_at as Date).getTime() <= now.getTime();
    const state = a.status === "pending_acceptance" ? "pending" : a.status === "accepted" ? (expired ? "expired" : "accepted") : "superseded";
    const days = a.accepted_at ? (new Date(a.accepted_at as Date).getTime() - new Date(a.created_at as Date).getTime()) / 864e5 : null;
    return {
      id: a.id, version: num(a.version), status: a.status, state, terms: a.terms ?? null, sentAt: a.created_at, effectiveAt: a.effective_at ?? null, acceptedAt: a.accepted_at ?? null, expiresAt: a.expires_at ?? null, createdBy: a.created_by ?? null,
      daysToAccept: days == null ? null : Math.round(days * 10) / 10, daysToExpiry: a.expires_at && state === "accepted" ? daysUntil(a.expires_at as Date, now) : null,
    };
  });
  const accepted = items.filter((a) => a.acceptedAt); const live = items.find((a) => a.state === "accepted");
  const avg = accepted.length ? accepted.reduce((n, a) => n + (a.daysToAccept ?? 0), 0) / accepted.length : null;
  return {
    items, summary: {
      total: items.length, state: (AGREEMENT_STATES as readonly string[]).includes(items[0]?.state ?? "") ? items[0].state : "none",
      accepted: accepted.length, pending: items.filter((a) => a.state === "pending").length, superseded: items.filter((a) => a.state === "superseded").length, expired: items.filter((a) => a.state === "expired").length,
      avgDaysToAccept: avg == null ? null : Math.round(avg * 10) / 10, liveSince: live?.acceptedAt ?? null, ageDays: live?.acceptedAt ? Math.floor((now.getTime() - new Date(live.acceptedAt as Date).getTime()) / 864e5) : null,
    },
  };
}

/**
 * What the office's drivers did on the jobs sent through it (accepted, arrived, delivered, cancelled, no-show …), newest first. Per-parcel events are left out (they are in the
 * parcel journeys); needs the same permission as the order events of the activity log (`requests.view`).
 */
export async function officeDriverEvents(viewer: User, officeId: string, q: { page?: number; pageSize?: number }) {
  await officeBase(viewer, officeId, FLEET); requirePerm(viewer, "requests.view");
  const { page, pageSize, offset } = clampPage(q, 20, 50);
  const where = sql`o.office_id = ${officeId} and not (e.payload ? 'shipmentId')`;
  const [items, [c]] = await Promise.all([
    rows<Rec>(sql`select e.id, e.type, e.created_at, e.new_status, e.actor_name, e.actor_role, o.driver_id, du.name as driver, r.id as request_id, r.ref
      from job_events e join offers o on o.id = e.offer_id join requests r on r.id = e.request_id join users du on du.id = o.driver_id where ${where} order by e.created_at desc, e.id desc limit ${pageSize} offset ${offset}`),
    rows<Rec>(sql`select count(*)::int as n from job_events e join offers o on o.id = e.offer_id where ${where}`),
  ]);
  return { page, pageSize, total: num(c?.n), items: items.map((e) => ({ id: e.id, type: e.type, at: e.created_at, status: e.new_status ?? null, actor: e.actor_name ?? null, actorRole: e.actor_role, driverId: e.driver_id, driver: e.driver, requestId: e.request_id, ref: e.ref })) };
}
