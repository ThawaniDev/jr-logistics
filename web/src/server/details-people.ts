import { eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { driverProfiles, officeProfiles, users, type User } from "@/db/schema";
import { err } from "@/lib/errors";
import { can, requirePerm } from "./auth/permissions";
import { DRIVER_DOC_TYPES } from "./catalog";
import { getSettings } from "./settings";
import { inWindow } from "./analytics/conditions";
import { bucketSql, riyadhDow, riyadhHour, zeroFill } from "./analytics/buckets";
import { num, numOrNull, rows } from "./analytics/guard";
import { histogramFromRow, histogramSelect } from "./analytics/stats";
import { driverKpis, type DriverFacts } from "./details-people-kpis";
import {
  RESPONSE_EDGES, RESPONSE_LABELS, driverRisks, daysUntil, onlineIntervals, parsePeriod, resolvePeriod, utilisation, type Interval, type PeriodInfo, type PeriodKey,
} from "./details-people-lib";
import { BUSINESS_JOIN, BUSINESS_NAME, BUSY_END, BUSY_START, COMPLETED_AT, DECIDED, OUTCOME_AT, RESPONDED, RESPONSE_S, STOPPED_AT, T, Z, anyW, hasAnyPerm, idOf, twin } from "./details-people-sql";

/** Driver detail: who the driver is today (standing, risk flags) and how they performed in a period (KPIs + charts). Read-only aggregates, all bounded SQL. */
export const DRIVER_VIEW = ["drivers.view", "users.view"] as const;
export const CASH_VIEW = ["finance.view", "cod.manage", "wallets.view"] as const;
type Rec = Record<string, unknown>;

/** The driver's user + profile, or 404 (unknown id, not a uuid, or not a driver). Needs `drivers.view` or `users.view`. */
export async function driverBase(viewer: User, driverId: string) {
  requirePerm(viewer, ...DRIVER_VIEW);
  idOf(driverId);
  const [row] = await db.select({ u: users, p: driverProfiles, office: officeProfiles.officeName }).from(users).innerJoin(driverProfiles, eq(driverProfiles.userId, users.id))
    .leftJoin(officeProfiles, eq(officeProfiles.userId, driverProfiles.officeId)).where(eq(users.id, driverId));
  if (!row) throw err("NOT_FOUND");
  return row;
}

/** COD cash the driver still holds (collected minus handed over, per order) and the part of it that has been held longer than `days`. */
export async function driverCashHeld(driverId: string, days: number) {
  const [r] = await rows<Rec>(sql`
    select coalesce(sum(greatest(0, c.collected - coalesce(r.received, 0))), 0)::float8 as held, coalesce(sum(c.collected), 0)::float8 as collected, coalesce(sum(coalesce(r.received, 0)), 0)::float8 as received,
      coalesce(sum(greatest(0, c.collected - coalesce(r.received, 0))) filter (where c.last_at < now() - make_interval(days => ${days}::int)), 0)::float8 as held_long,
      count(*) filter (where c.collected > coalesce(r.received, 0))::int as orders
    from (select shipments.offer_id, sum(shipments.cod_collected_cents) as collected, max(shipments.cod_collected_at) as last_at from shipments join offers on offers.id = shipments.offer_id
          where offers.driver_id = ${driverId} and shipments.status = 'delivered' and shipments.cod_collected_cents is not null group by shipments.offer_id) c
    left join (select offer_id, sum(amount_cents) as received from cod_remittances where driver_id = ${driverId} group by offer_id) r on r.offer_id = c.offer_id`);
  return { heldCents: num(r?.held), collectedCents: num(r?.collected), receivedCents: num(r?.received), heldLongCents: num(r?.held_long), orders: num(r?.orders) };
}

/** Current standing: activity, strikes, suspension trail, documents, cash and the risk flags (fixed look-back of 90 days, whatever period the page shows). */
export async function driverStanding(viewer: User, driverId: string) {
  const { u, p } = await driverBase(viewer, driverId);
  const s = await getSettings(); const sensitive = can(viewer, "drivers.sensitive"); const cashOk = hasAnyPerm(viewer, CASH_VIEW);
  const docsOk = hasAnyPerm(viewer, ["documents.review", "verification.manage", "users.view"]);
  const [base, strikes, docs, cash, trail, creator, life] = await Promise.all([
    rows<Rec>(sql`select
        count(*) filter (where status = 'completed')::int as completed, count(*) filter (where accepted_at is not null and created_at > now() - interval '90 days')::int as accepted_jobs,
        count(*) filter (where status = 'no_show' and coalesce(cancelled_at, updated_at) > now() - interval '90 days')::int as no_show,
        count(*) filter (where created_at > now() - interval '90 days' and ${DECIDED})::int as decided, count(*) filter (where created_at > now() - interval '90 days' and ${DECIDED} and accepted_at is not null)::int as accepted,
        count(*) filter (where status = 'no_show')::int as no_show_all, count(*) filter (where status = 'cancelled')::int as cancelled_all, count(*) filter (where accepted_at is not null)::int as accepted_all
      from offers where driver_id = ${driverId}`),
    rows<Rec>(sql`select count(*)::int as n, max(created_at) as last_at from job_events where type = 'driver_cancelled' and actor_id = ${driverId}
        and created_at > now() - make_interval(days => ${s.cancelWindowDays}::int) ${p.strikesResetAt ? sql`and created_at > ${p.strikesResetAt.toISOString()}::timestamptz` : sql``}`),
    docsOk ? rows<Rec>(sql`select distinct on (type) type, status, expires_on::text as expires_on, created_at, reviewed_at from documents where owner_id = ${driverId} and owner_kind = 'driver' order by type, created_at desc`) : Promise.resolve(null),
    cashOk ? driverCashHeld(driverId, 3) : Promise.resolve(null),
    rows<Rec>(sql`select a.id, a.action, a.diff, a.created_at as at, a.actor_role, au.name as actor_name from audit_logs a left join users au on au.id = a.actor_id
        where a.entity = 'user' and a.entity_id = ${driverId} and a.action in ('user.suspended','user.active','driver.clear_suspension','driver.auto_suspend') order by a.created_at desc limit 12`),
    u.createdBy ? db.select({ id: users.id, name: users.name }).from(users).where(eq(users.id, u.createdBy)) : Promise.resolve([]),
    rows<Rec>(sql`select count(*) filter (where shipments.status = 'delivered')::int as delivered from shipments join offers on offers.id = shipments.offer_id where offers.driver_id = ${driverId}`),
  ]);
  const b = base[0] ?? {}, st = strikes[0] ?? {};
  const suspendedNow = !!p.suspendedUntil && p.suspendedUntil.getTime() > Date.now();
  const strikeState = { enabled: s.cancelPolicyEnabled, count: num(st.n), warnAt: s.cancelWarnAt, suspendAt: s.cancelSuspendAt, windowDays: s.cancelWindowDays, suspendDays: s.cancelSuspendDays, resetAt: p.strikesResetAt, lastAt: st.last_at ?? null };
  const docItems = docs?.map((d) => ({ type: String(d.type), status: String(d.status), expiresOn: (d.expires_on as string | null) ?? null, daysLeft: daysUntil(d.expires_on as string | null), uploadedAt: d.created_at, reviewedAt: d.reviewed_at ?? null })) ?? null;
  const risks = driverRisks({
    joinedAt: u.createdAt, verified: p.verificationStatus === "verified", completedTotal: num(b.completed), acceptedJobs: num(b.accepted_jobs), noShows: num(b.no_show),
    decidedOffers: num(b.decided), acceptedOffers: num(b.accepted), strikes: strikeState, suspended: suspendedNow || u.status === "suspended",
    docs: (docs ?? []).filter((d) => d.status === "approved" || d.status === "submitted" || d.status === "under_review").map((d) => ({ type: String(d.type), expiresOn: (d.expires_on as string | null) ?? null, status: String(d.status) })),
    cashHeldLongCents: cash ? cash.heldLongCents : null,
  });
  return {
    id: u.id, lastSeenAt: u.lastSeenAt, lastLoginAt: u.lastLoginAt, loginCount: u.loginCount, lastLoginClient: u.lastLoginClient, lastLoginIp: sensitive ? u.lastLoginIp : null,
    source: u.source, createdBy: creator[0] ?? null, createdAt: u.createdAt, language: u.language,
    rating: { avg: p.ratingCount ? Math.round((p.ratingSum / p.ratingCount) * 100) / 100 : null, count: p.ratingCount },
    lifetime: { completed: num(b.completed), delivered: num(life[0]?.delivered), cancelled: num(b.cancelled_all), noShow: num(b.no_show_all), accepted: num(b.accepted_all) },
    strikes: strikeState,
    suspension: { until: suspendedNow ? p.suspendedUntil : null, account: u.status === "suspended", trail: trail.map((a) => ({ id: a.id, action: a.action, at: a.at, reason: (a.diff as { reason?: string; cancellations?: number } | null)?.reason ?? null, cancellations: (a.diff as { cancellations?: number } | null)?.cancellations ?? null, by: a.actor_name ?? null, byRole: a.actor_role ?? null })) },
    documents: docItems ? { required: DRIVER_DOC_TYPES.filter((d) => d.required).length, items: docItems } : null,
    cash: cash ? { outstandingCents: cash.heldCents, heldLongCents: cash.heldLongCents, orders: cash.orders } : null,
    risks,
  };
}

// ───────── Performance of a period ─────────
async function seriesFor(driverId: string, win: { start: Date; end: Date }, bucket: PeriodInfo["bucket"], keys: string[]) {
  const [ship, jobs] = await Promise.all([
    rows<Rec>(sql`select ${bucketSql(OUTCOME_AT, bucket)} as t, count(*) filter (where shipments.status = 'delivered')::int as delivered, count(*) filter (where shipments.status in ('failed','returned'))::int as failed
      from shipments join offers on offers.id = shipments.offer_id where offers.driver_id = ${driverId} and ${inWindow(OUTCOME_AT, win)} group by 1`),
    rows<Rec>(sql`select ${bucketSql(COMPLETED_AT, bucket)} as t, count(*)::int as jobs from offers where offers.driver_id = ${driverId} and offers.status = 'completed' and ${inWindow(COMPLETED_AT, win)} group by 1`),
  ]);
  const a = zeroFill(keys, ship as Array<{ t: string }>, ["delivered", "failed"] as const), j = zeroFill(keys, jobs as Array<{ t: string }>, ["jobs"] as const);
  return a.map((x, i) => ({ t: x.t, delivered: x.delivered, failed: x.failed, jobs: j[i].jobs, rate: x.delivered + x.failed > 0 ? x.delivered / (x.delivered + x.failed) : null }));
}

/** Every KPI, chart and ranking of the driver for one period (`30d` | `90d` | `12m` | `all`). Money numbers need `finance.view`, cash `finance.view` / `cod.manage` / `wallets.view`. */
export async function driverInsights(viewer: User, driverId: string, periodKey?: string) {
  const { u } = await driverBase(viewer, driverId);
  const now = new Date(); const per: PeriodInfo = resolvePeriod(parsePeriod(periodKey) as PeriodKey, now, u.createdAt);
  const money = can(viewer, "finance.view"), cashOk = hasAnyPerm(viewer, CASH_VIEW); const hasPrev = !!per.prev;
  const grace = (await getSettings()).lateGraceMin;
  const limit = sql`requests.starts_at + make_interval(mins => ${grace}::int)`;
  const counted = sql`offers.accepted_at is not null and offers.status not in ('rejected','expired','cancelled','replaced')`;
  const inCur = inWindow("offers.created_at", per.cur);
  const availFrom = (per.prev ?? per.cur).start.toISOString();
  const [off, shp, cxl, rat, earn, series, prevSeries, resp, heat, fails, cities, firms, avail, busy, cash] = await Promise.all([
    rows<Rec>(sql`select ${twin(per, {
      jobs: (w) => sql`count(*) filter (where offers.status = 'completed' and ${w(COMPLETED_AT)})::int`,
      decided: (w) => sql`count(*) filter (where ${w("offers.created_at")} and ${DECIDED})::int`,
      accepted: (w) => sql`count(*) filter (where ${w("offers.created_at")} and ${DECIDED} and offers.accepted_at is not null)::int`,
      no_show: (w) => sql`count(*) filter (where offers.status = 'no_show' and ${w(STOPPED_AT)})::int`,
      on_time: (w) => sql`count(*) filter (where ${w("requests.starts_at")} and ${counted} and offers.arrived_at is not null and offers.arrived_at <= ${limit})::int`,
      due: (w) => sql`count(*) filter (where ${w("requests.starts_at")} and ${counted} and (offers.arrived_at is not null or offers.status = 'no_show' or now() > ${limit}))::int`,
      resp_sum: (w) => sql`coalesce(sum(${RESPONSE_S}) filter (where ${w("offers.created_at")} and ${RESPONDED}), 0)::float8`,
      resp_n: (w) => sql`count(*) filter (where ${w("offers.created_at")} and ${RESPONDED})::int`,
    })} from offers join requests on requests.id = offers.request_id
      where offers.driver_id = ${driverId} and ${anyW(per, COMPLETED_AT, "offers.created_at", "requests.starts_at", STOPPED_AT)}`),
    rows<Rec>(sql`select ${twin(per, {
      delivered: (w) => sql`count(*) filter (where shipments.status = 'delivered' and ${w(OUTCOME_AT)})::int`,
      outcomes: (w) => sql`count(*) filter (where ${w(OUTCOME_AT)})::int`,
      first_attempt: (w) => sql`count(*) filter (where shipments.status = 'delivered' and shipments.attempts <= 1 and ${w(OUTCOME_AT)})::int`,
    })} from shipments join offers on offers.id = shipments.offer_id where offers.driver_id = ${driverId} and ${anyW(per, OUTCOME_AT)}`),
    rows<Rec>(sql`select ${twin(per, { n: (w) => sql`count(*) filter (where ${w("job_events.created_at")})::int` })} from job_events
      where job_events.type = 'driver_cancelled' and job_events.actor_id = ${driverId} and ${anyW(per, "job_events.created_at")}`),
    rows<Rec>(sql`select ${twin(per, { sum: (w) => sql`coalesce(sum(ratings.stars) filter (where ${w("ratings.created_at")}), 0)::int`, n: (w) => sql`count(*) filter (where ${w("ratings.created_at")})::int` })},
      count(*) filter (where ratings.stars = 1 and ${inWindow("ratings.created_at", per.cur)})::int as s1, count(*) filter (where ratings.stars = 2 and ${inWindow("ratings.created_at", per.cur)})::int as s2,
      count(*) filter (where ratings.stars = 3 and ${inWindow("ratings.created_at", per.cur)})::int as s3, count(*) filter (where ratings.stars = 4 and ${inWindow("ratings.created_at", per.cur)})::int as s4,
      count(*) filter (where ratings.stars = 5 and ${inWindow("ratings.created_at", per.cur)})::int as s5
      from ratings where ratings.ratee_id = ${driverId} and ${anyW(per, "ratings.created_at")}`),
    money ? rows<Rec>(sql`select ${twin(per, { sum: (w) => sql`coalesce(sum(settlements.provider_cents) filter (where ${w("settlements.created_at")}), 0)::float8` })},
      coalesce(sum(settlements.provider_cents), 0)::float8 as life from settlements where settlements.driver_id = ${driverId} and settlements.status <> 'rejected'`) : Promise.resolve([] as Rec[]),
    seriesFor(driverId, per.cur, per.bucket, per.keys),
    per.prev && per.prevKeys ? seriesFor(driverId, per.prev, per.bucket, per.prevKeys) : Promise.resolve(null),
    rows<Rec>(sql`select ${histogramSelect(RESPONSE_S, RESPONSE_EDGES, "h", sql`${inCur} and ${RESPONDED}`)},
        percentile_cont(0.5) within group (order by ${RESPONSE_S}) filter (where ${inCur} and ${RESPONDED}) as p50, percentile_cont(0.9) within group (order by ${RESPONSE_S}) filter (where ${inCur} and ${RESPONDED}) as p90
      from offers where offers.driver_id = ${driverId} and ${inCur}`),
    rows<Rec>(sql`select ${riyadhDow(OUTCOME_AT)} as dow, ${riyadhHour(OUTCOME_AT)} as hour, count(*)::int as n from shipments join offers on offers.id = shipments.offer_id
      where offers.driver_id = ${driverId} and ${inWindow(OUTCOME_AT, per.cur)} group by 1, 2`),
    rows<Rec>(sql`select coalesce(shipments.fail_reason, 'other') as reason, count(*)::int as n from shipments join offers on offers.id = shipments.offer_id
      where offers.driver_id = ${driverId} and shipments.status in ('failed','returned') and ${inWindow(OUTCOME_AT, per.cur)} group by 1 order by 2 desc limit 12`),
    rows<Rec>(sql`select shipments.city as city, count(*) filter (where shipments.status = 'delivered')::int as delivered, count(*)::int as outcomes from shipments join offers on offers.id = shipments.offer_id
      where offers.driver_id = ${driverId} and ${inWindow(OUTCOME_AT, per.cur)} group by 1 order by 2 desc, 3 desc limit 8`),
    rows<Rec>(sql`select requests.business_id as id, ${BUSINESS_NAME} as name, count(distinct offers.id)::int as jobs, count(*) filter (where shipments.status = 'delivered')::int as delivered, count(*)::int as outcomes
      from shipments join offers on offers.id = shipments.offer_id join requests on requests.id = offers.request_id ${BUSINESS_JOIN}
      where offers.driver_id = ${driverId} and ${inWindow(OUTCOME_AT, per.cur)} group by 1, 2 order by 4 desc, 3 desc limit 8`),
    rows<Rec>(sql`(select to_status as "to", at from driver_availability_log where driver_id = ${driverId} and at >= ${availFrom}::timestamptz and at < ${per.cur.end.toISOString()}::timestamptz order by at desc limit 20000)
      union all (select to_status, at from driver_availability_log where driver_id = ${driverId} and at < ${availFrom}::timestamptz order by at desc limit 1)`),
    rows<Rec>(sql`select extract(epoch from ${BUSY_START}) * 1000 as a, extract(epoch from ${BUSY_END}) * 1000 as b from offers
      where offers.driver_id = ${driverId} and ${BUSY_START} is not null and ${BUSY_START} < ${per.cur.end.toISOString()}::timestamptz and ${BUSY_END} > ${availFrom}::timestamptz order by ${BUSY_START} desc limit 5000`),
    cashOk ? driverCashHeld(driverId, 3) : Promise.resolve(null),
  ]);
  const o = off[0], sh = shp[0], ca = cxl[0], ra = rat[0], ea = earn[0];
  const z = (name: string, r: Rec | undefined) => Z(T(r, name), hasPrev);
  const intervals = (w: { start: Date; end: Date }) => onlineIntervals(avail.map((e) => ({ at: e.at as Date, to: String(e.to) })), w, now);
  const busyAll: Interval[] = busy.map((r) => [Number(r.a), Number(r.b)] as Interval).filter(([x, y]) => Number.isFinite(x) && Number.isFinite(y));
  const util = (w: { start: Date; end: Date } | null) => {
    if (!w) return { online: null, ratio: null };
    const on = intervals(w); const from = w.start.getTime(), to = Math.min(w.end.getTime(), now.getTime());
    const u2 = utilisation(on, busyAll.map(([x, y]) => [Math.max(x, from), Math.min(y, to)] as Interval).filter(([x, y]) => y > x));
    return { online: u2.onlineSec, ratio: on == null ? null : u2.ratio }; // nothing recorded about the driver's availability = no data, not "100 % busy"
  };
  const uc = util(per.cur), up = util(per.prev);
  const spark = { jobs: series.map((p) => p.jobs), parcels: series.map((p) => p.delivered), success: series.map((p) => p.rate) };
  const facts: DriverFacts = {
    jobs: z("jobs", o), parcels: z("delivered", sh), delivered: z("delivered", sh), outcomes: z("outcomes", sh), firstAttempt: z("first_attempt", sh), onTime: z("on_time", o), due: z("due", o),
    accepted: z("accepted", o), decided: z("decided", o), cancelled: z("n", ca), noShow: z("no_show", o), ratingSum: z("sum", ra), ratingCount: z("n", ra), respSum: z("resp_sum", o), respCount: z("resp_n", o),
    online: { cur: uc.online, prev: up.online }, utilisation: { cur: uc.ratio, prev: up.ratio },
    earnings: money ? Z(T(ea, "sum"), hasPrev) : null, earningsLife: money ? num(ea?.life) : null, cashHeld: cash ? cash.heldCents : null, spark,
  };
  const hist = histogramFromRow(resp[0] ?? {}, RESPONSE_EDGES, "h");
  const cells = Array.from({ length: 7 }, () => Array<number>(24).fill(0)); for (const h of heat) cells[num(h.dow)][num(h.hour)] = num(h.n);
  const dis = [1, 2, 3, 4, 5].map((n) => ({ stars: n, count: num(ra?.[`s${n}`]) }));
  const totalR = dis.reduce((n, d) => n + d.count, 0);
  return {
    period: { key: per.key, from: per.cur.from, to: per.cur.to, days: per.cur.days, bucket: per.bucket, prevFrom: per.prev?.from ?? null, prevTo: per.prev?.to ?? null },
    generatedAt: now.toISOString(), moneyHidden: !money, kpis: driverKpis(facts),
    series, prevSeries,
    ratings: { distribution: dis, count: totalR, avg: totalR ? dis.reduce((n, d) => n + d.stars * d.count, 0) / totalR : null },
    response: { buckets: hist.map((h, i) => ({ key: RESPONSE_LABELS[i], count: h.count })), p50: numOrNull(resp[0]?.p50), p90: numOrNull(resp[0]?.p90), n: hist.reduce((n, h) => n + h.count, 0) },
    heatmap: cells, failures: fails.map((f) => ({ reason: String(f.reason), count: num(f.n) })),
    cities: cities.map((c) => ({ city: String(c.city), delivered: num(c.delivered), outcomes: num(c.outcomes) })),
    companies: firms.map((c) => ({ id: String(c.id), name: String(c.name ?? "—"), jobs: num(c.jobs), delivered: num(c.delivered), outcomes: num(c.outcomes) })),
    empty: !series.some((p) => p.delivered || p.failed || p.jobs) && !num(o?.decided_c) && !totalR,
  };
}
