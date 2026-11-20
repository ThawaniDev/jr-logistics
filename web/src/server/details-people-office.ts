import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { officeProfiles, users, type User } from "@/db/schema";
import { err } from "@/lib/errors";
import { requirePerm } from "./auth/permissions";
import type { Permission } from "./catalog";
import { getSettings } from "./settings";
import { inWindow } from "./analytics/conditions";
import { bucketSql, zeroFill } from "./analytics/buckets";
import { num, rows } from "./analytics/guard";
import { officeKpis, type OfficeFacts } from "./details-people-kpis";
import { fleetUtilisation, parsePeriod, pareto, resolvePeriod, concentration, type Interval, type PeriodInfo, type PeriodKey } from "./details-people-lib";
import { BUSINESS_JOIN, BUSINESS_NAME, BUSY, BUSY_END, BUSY_START, COMPLETED_AT, OUTCOME_AT, T, Z, anyW, hasAnyPerm, idOf, twin } from "./details-people-sql";

/** Courier-office detail: who may open it, and how the office (its drivers' work through it) performed in a period. */
type Rec = Record<string, unknown>;
/** Who may look at an office account (same as the existing office views). */
export const OFFICE_VIEW: readonly Permission[] = ["offices.view", "offices.manage", "users.view", "verification.manage"];
/** Payouts and wallet of an office are money: office managers and finance staff only. */
export const OFFICE_MONEY: readonly Permission[] = ["offices.view", "offices.manage", "finance.view", "wallets.view", "settlements.review"];
/** Settlements owed but not yet in the payee's wallet. */
const PENDING_SQL = sql`('pending_review','reviewed','approved','batch_ready','failed')`;

/** The office's user + profile, or 404 (unknown id, not a uuid, or not an office). */
export async function officeBase(viewer: User, officeId: string, perms: readonly Permission[] = OFFICE_VIEW) {
  requirePerm(viewer, ...perms);
  idOf(officeId);
  const [row] = await db.select({ u: users, p: officeProfiles }).from(users).innerJoin(officeProfiles, eq(officeProfiles.userId, users.id)).where(and(eq(users.id, officeId), eq(users.role, "office")));
  if (!row) throw err("NOT_FOUND");
  return row;
}

async function seriesFor(officeId: string, win: { start: Date; end: Date }, bucket: PeriodInfo["bucket"], keys: string[]) {
  const [ship, jobs] = await Promise.all([
    rows<Rec>(sql`select ${bucketSql(OUTCOME_AT, bucket)} as t, count(*) filter (where shipments.status = 'delivered')::int as delivered, count(*) filter (where shipments.status in ('failed','returned'))::int as failed
      from shipments join offers on offers.id = shipments.offer_id where offers.office_id = ${officeId} and ${inWindow(OUTCOME_AT, win)} group by 1`),
    rows<Rec>(sql`select ${bucketSql(COMPLETED_AT, bucket)} as t, count(*)::int as jobs from offers where offers.office_id = ${officeId} and offers.status = 'completed' and ${inWindow(COMPLETED_AT, win)} group by 1`),
  ]);
  const a = zeroFill(keys, ship as Array<{ t: string }>, ["delivered", "failed"] as const), j = zeroFill(keys, jobs as Array<{ t: string }>, ["jobs"] as const);
  return a.map((x, i) => ({ t: x.t, delivered: x.delivered, failed: x.failed, jobs: j[i].jobs, rate: x.delivered + x.failed > 0 ? x.delivered / (x.delivered + x.failed) : null }));
}

/** Every KPI, chart and ranking of the office for one period (`30d` | `90d` | `12m` | `all`). Money needs one of `OFFICE_MONEY`. */
export async function officeInsights(viewer: User, officeId: string, periodKey?: string) {
  const { u } = await officeBase(viewer, officeId);
  const now = new Date(); const per = resolvePeriod(parsePeriod(periodKey) as PeriodKey, now, u.createdAt); const hasPrev = !!per.prev;
  const money = hasAnyPerm(viewer, OFFICE_MONEY); const grace = (await getSettings()).lateGraceMin;
  const limit = sql`requests.starts_at + make_interval(mins => ${grace}::int)`;
  const counted = sql`offers.accepted_at is not null and offers.status not in ('rejected','expired','cancelled','replaced')`;
  const inCur = inWindow("offers.created_at", per.cur); const availFrom = (per.prev ?? per.cur).start;
  const prevWin = per.prev ?? per.cur;
  const [fleet, off, shp, rat, earn, series, prevSeries, drv, firms, cities, fails, funnel, agr, churn, joins, evs, busy] = await Promise.all([
    rows<Rec>(sql`select count(*)::int as total,
        count(*) filter (where dp.availability = 'available' and dp.verification_status = 'verified' and (dp.suspended_until is null or dp.suspended_until <= now()) and users.status = 'active')::int as available,
        count(*) filter (where exists (select 1 from offers o where o.driver_id = dp.user_id and o.status in (${BUSY})))::int as on_job
      from driver_profiles dp join users on users.id = dp.user_id where dp.office_id = ${officeId}`),
    rows<Rec>(sql`select ${twin(per, {
      jobs: (w) => sql`count(*) filter (where offers.status = 'completed' and ${w(COMPLETED_AT)})::int`,
      active: (w) => sql`count(distinct offers.driver_id) filter (where ${w("offers.accepted_at")})::int`,
      on_time: (w) => sql`count(*) filter (where ${w("requests.starts_at")} and ${counted} and offers.arrived_at is not null and offers.arrived_at <= ${limit})::int`,
      due: (w) => sql`count(*) filter (where ${w("requests.starts_at")} and ${counted} and (offers.arrived_at is not null or offers.status = 'no_show' or now() > ${limit}))::int`,
    })} from offers join requests on requests.id = offers.request_id where offers.office_id = ${officeId} and ${anyW(per, COMPLETED_AT, "offers.accepted_at", "requests.starts_at")}`),
    rows<Rec>(sql`select ${twin(per, {
      delivered: (w) => sql`count(*) filter (where shipments.status = 'delivered' and ${w(OUTCOME_AT)})::int`, outcomes: (w) => sql`count(*) filter (where ${w(OUTCOME_AT)})::int`,
    })} from shipments join offers on offers.id = shipments.offer_id where offers.office_id = ${officeId} and ${anyW(per, OUTCOME_AT)}`),
    rows<Rec>(sql`select ${twin(per, { sum: (w) => sql`coalesce(sum(ratings.stars) filter (where ${w("ratings.created_at")}), 0)::int`, n: (w) => sql`count(*) filter (where ${w("ratings.created_at")})::int` })}
      from ratings join offers on offers.id = ratings.offer_id where offers.office_id = ${officeId} and ${anyW(per, "ratings.created_at")}`),
    money ? rows<Rec>(sql`select ${twin(per, {
      earned: (w) => sql`coalesce(sum(settlements.provider_cents) filter (where settlements.status <> 'rejected' and ${w("settlements.created_at")}), 0)::float8`,
      paid: (w) => sql`coalesce(sum(settlements.provider_cents) filter (where settlements.status = 'paid' and ${w("settlements.paid_at")}), 0)::float8`,
    })}, coalesce(sum(settlements.provider_cents) filter (where settlements.status in ${PENDING_SQL}), 0)::float8 as pending from settlements where settlements.office_id = ${officeId}`) : Promise.resolve([] as Rec[]),
    seriesFor(officeId, per.cur, per.bucket, per.keys),
    per.prev && per.prevKeys ? seriesFor(officeId, per.prev, per.bucket, per.prevKeys) : Promise.resolve(null),
    rows<Rec>(sql`select offers.driver_id as id, du.name, count(*) filter (where shipments.status = 'delivered')::int as delivered, count(*)::int as outcomes from shipments join offers on offers.id = shipments.offer_id join users du on du.id = offers.driver_id
      where offers.office_id = ${officeId} and ${inWindow(OUTCOME_AT, per.cur)} group by 1, 2 order by 3 desc limit 200`),
    rows<Rec>(sql`select requests.business_id as id, ${BUSINESS_NAME} as name, count(distinct offers.id)::int as jobs, count(*) filter (where shipments.status = 'delivered')::int as delivered, count(*)::int as outcomes
      from shipments join offers on offers.id = shipments.offer_id join requests on requests.id = offers.request_id ${BUSINESS_JOIN}
      where offers.office_id = ${officeId} and ${inWindow(OUTCOME_AT, per.cur)} group by 1, 2 order by 4 desc, 3 desc limit 8`),
    rows<Rec>(sql`select shipments.city as city, count(*) filter (where shipments.status = 'delivered')::int as delivered, count(*)::int as outcomes from shipments join offers on offers.id = shipments.offer_id
      where offers.office_id = ${officeId} and ${inWindow(OUTCOME_AT, per.cur)} group by 1 order by 2 desc, 3 desc limit 8`),
    rows<Rec>(sql`select coalesce(shipments.fail_reason, 'other') as reason, count(*)::int as n from shipments join offers on offers.id = shipments.offer_id
      where offers.office_id = ${officeId} and shipments.status in ('failed','returned') and ${inWindow(OUTCOME_AT, per.cur)} group by 1 order by 2 desc limit 12`),
    rows<Rec>(sql`select count(*)::int as offered, count(*) filter (where offers.accepted_at is not null)::int as accepted,
        count(*) filter (where offers.arrived_at is not null)::int as arrived, count(*) filter (where offers.status = 'completed')::int as completed from offers where offers.office_id = ${officeId} and ${inCur}`),
    rows<Rec>(sql`select status, version, accepted_at, effective_at, expires_at from office_agreements where office_id = ${officeId} and status = 'accepted' order by version desc limit 1`),
    per.prev ? rows<Rec>(sql`select count(distinct offers.driver_id)::int as worked,
        count(distinct offers.driver_id) filter (where not exists (select 1 from driver_profiles dp where dp.user_id = offers.driver_id and dp.office_id = ${officeId}))::int as churned
      from offers where offers.office_id = ${officeId} and ${inWindow("offers.accepted_at", prevWin)}`) : Promise.resolve([] as Rec[]),
    rows<Rec>(sql`select ${twin(per, { n: (w) => sql`count(distinct l.driver_id) filter (where ${w("l.at")})::int` })} from (
        select driver_id, responded_at as at from office_invites where office_id = ${officeId} and status = 'accepted' and driver_id is not null and responded_at is not null
        union all select entity_id::uuid, created_at from audit_logs where action = 'office.link_driver' and entity = 'user' and diff->>'officeId' = ${officeId}) l where ${anyW(per, "l.at")}`),
    rows<Rec>(sql`(select dal.driver_id, dal.to_status as "to", dal.at from driver_availability_log dal join driver_profiles dp on dp.user_id = dal.driver_id where dp.office_id = ${officeId}
        and dal.at >= ${availFrom.toISOString()}::timestamptz and dal.at < ${per.cur.end.toISOString()}::timestamptz order by dal.at desc limit 30000)
      union all (select x.driver_id, x."to", x.at from (select distinct on (dal.driver_id) dal.driver_id, dal.to_status as "to", dal.at from driver_availability_log dal join driver_profiles dp on dp.user_id = dal.driver_id
        where dp.office_id = ${officeId} and dal.at < ${availFrom.toISOString()}::timestamptz order by dal.driver_id, dal.at desc) x)`),
    rows<Rec>(sql`select offers.driver_id, extract(epoch from ${BUSY_START}) * 1000 as a, extract(epoch from ${BUSY_END}) * 1000 as b from offers join driver_profiles dp on dp.user_id = offers.driver_id
      where dp.office_id = ${officeId} and offers.office_id = ${officeId} and ${BUSY_START} is not null and ${BUSY_START} < ${per.cur.end.toISOString()}::timestamptz and ${BUSY_END} > ${availFrom.toISOString()}::timestamptz order by ${BUSY_START} desc limit 20000`),
  ]);
  const f0 = fleet[0] ?? {}, o = off[0], sh = shp[0], ra = rat[0], ea = earn[0], z = (n: string, r: Rec | undefined) => Z(T(r, n), hasPrev);
  const events = new Map<string, Array<{ at: Date; to: string }>>(); for (const e of evs) { const k = String(e.driver_id); const l = events.get(k) ?? []; l.push({ at: e.at as Date, to: String(e.to) }); events.set(k, l); }
  const busyBy = new Map<string, Interval[]>(); for (const b of busy) { const k = String(b.driver_id); const l = busyBy.get(k) ?? []; l.push([Number(b.a), Number(b.b)]); busyBy.set(k, l); }
  const truncated = evs.length >= 30000 || busy.length >= 20000;
  const uc = truncated ? null : fleetUtilisation(events, busyBy, per.cur, now), up = truncated || !per.prev ? null : fleetUtilisation(events, busyBy, per.prev, now);
  const agree = agr[0]; const since = agree ? new Date((agree.accepted_at ?? agree.effective_at) as Date).getTime() : null;
  const facts: OfficeFacts = {
    drivers: num(f0.total), availableDrivers: num(f0.available), onJobDrivers: num(f0.on_job), activeDrivers: z("active", o), newDrivers: z("n", joins[0]), jobs: z("jobs", o), parcels: z("delivered", sh), delivered: z("delivered", sh), outcomes: z("outcomes", sh),
    onTime: z("on_time", o), due: z("due", o), ratingSum: z("sum", ra), ratingCount: z("n", ra), utilisation: { cur: uc?.ratio ?? null, prev: up?.ratio ?? null },
    earnings: money ? Z(T(ea, "earned"), hasPrev) : null, paid: money ? Z(T(ea, "paid"), hasPrev) : null, pending: money ? num(ea?.pending) : null,
    agreementAgeSec: since ? Math.max(0, Math.round((now.getTime() - since) / 1000)) : null, churned: per.prev ? num(churn[0]?.churned) : null, workedPrev: per.prev ? num(churn[0]?.worked) : null,
    spark: { jobs: series.map((p) => p.jobs), parcels: series.map((p) => p.delivered), success: series.map((p) => p.rate) },
  };
  const contrib = pareto(drv.map((d) => ({ id: String(d.id), name: String(d.name), value: num(d.delivered) })), 10);
  const fn = funnel[0] ?? {};
  return {
    period: { key: per.key, from: per.cur.from, to: per.cur.to, days: per.cur.days, bucket: per.bucket, prevFrom: per.prev?.from ?? null, prevTo: per.prev?.to ?? null },
    generatedAt: now.toISOString(), moneyHidden: !money, kpis: officeKpis(facts), series, prevSeries,
    contribution: { ...contrib, top80: concentration(drv.map((d) => ({ value: num(d.delivered) })), 0.8) },
    funnel: [{ key: "offered", count: num(fn.offered) }, { key: "accepted", count: num(fn.accepted) }, { key: "arrived", count: num(fn.arrived) }, { key: "completed", count: num(fn.completed) }],
    companies: firms.map((c) => ({ id: String(c.id), name: String(c.name ?? "—"), jobs: num(c.jobs), delivered: num(c.delivered), outcomes: num(c.outcomes) })),
    cities: cities.map((c) => ({ city: String(c.city), delivered: num(c.delivered), outcomes: num(c.outcomes) })), failures: fails.map((x) => ({ reason: String(x.reason), count: num(x.n) })),
    utilisation: uc ? { drivers: uc.drivers, onlineSec: uc.onlineSec, busySec: uc.busySec } : null, utilisationTruncated: truncated,
    empty: !series.some((p) => p.delivered || p.failed || p.jobs) && !num(fn.offered),
  };
}
