import { sql, type SQL } from "drizzle-orm";
import { offers, requests, settlements, shipments, users } from "@/db/schema";
import { getSettings } from "../settings";
import { anyWindow, BILLED, ignoredFilters, inWindow, NOT_DRAFT, PARCEL_OUTCOME_AT, scope, twinRead, twinSelect } from "./conditions";
import { kpiDef } from "./definitions";
import type { ResolvedFilters } from "./filters";
import { num, rows } from "./guard";
import { makeKpi, safeDiv, type Kpi } from "./kpi";
import { histogramFromRow, histogramSelect } from "./stats";

type Row = Record<string, unknown>;
type Pair = { cur: number | null; prev: number | null };
const z = (p: Pair): Pair => ({ cur: p.cur ?? 0, prev: p.prev });
/** Edges (seconds) of the time-to-fill histogram: < 15 min, 15–30, 30–60, 1–2 h, 2–6 h, 6–24 h, ≥ 24 h. */
export const FILL_EDGES = [900, 1800, 3600, 7200, 21_600, 86_400];

export const FUNNEL_STEPS = ["published", "accepted", "filled", "started", "completed"] as const;
const FUNNEL_STATE = {
  accepted: sql`exists (select 1 from offers where offers.request_id = requests.id and offers.accepted_at is not null)`,
  filled: sql`(requests.status in ('assigned','confirmed','in_progress','completed') or requests.slots_filled >= requests.quantity)`,
  started: sql`(requests.status in ('in_progress','completed') or exists (select 1 from offers where offers.request_id = requests.id and offers.attendance_at is not null))`,
  completed: sql`requests.status = 'completed'`,
};

/** Requests: created, cancelled cohort, completed, distinct companies — and the funnel of the requests created in the period (current period only). */
async function requestFacts(f: ResolvedFilters) {
  const inCur = inWindow(requests.createdAt, f.cur);
  const step = (cond: SQL) => sql`count(*) filter (where ${inCur} and ${NOT_DRAFT} and ${cond})::int`;
  const [r] = await rows<Row>(sql`
    select ${twinSelect(f, {
      created: (w) => sql`count(*) filter (where ${w(requests.createdAt)} and ${NOT_DRAFT})::int`,
      cancelled: (w) => sql`count(*) filter (where ${w(requests.createdAt)} and requests.status = 'cancelled')::int`,
      completed: (w) => sql`count(*) filter (where ${w(requests.completedAt)} and requests.status = 'completed')::int`,
      companies: (w) => sql`count(distinct requests.business_id) filter (where ${w(requests.createdAt)} and ${NOT_DRAFT})::int`,
    })},
    count(*) filter (where ${inCur} and ${NOT_DRAFT})::int as fn_published, ${step(FUNNEL_STATE.accepted)} as fn_accepted, ${step(FUNNEL_STATE.filled)} as fn_filled,
    ${step(FUNNEL_STATE.started)} as fn_started, ${step(FUNNEL_STATE.completed)} as fn_completed
    from requests where ${scope(f, "requests")} and ${anyWindow(f, requests.createdAt, requests.completedAt)}`);
  // A step can never be larger than the one before it (a request that was cancelled after it was filled still counts as published and accepted).
  const raw = FUNNEL_STEPS.map((k) => num(r?.[`fn_${k}`]));
  const funnel = raw.map((n, i) => ({ key: FUNNEL_STEPS[i], count: Math.min(n, ...raw.slice(0, i)) }));
  return { created: twinRead(r, "created"), cancelled: twinRead(r, "cancelled"), completed: twinRead(r, "completed"), companies: twinRead(r, "companies"), funnel };
}

/** Parcels: outcomes (delivered / failed / returned on the day they were resolved), first-attempt deliveries, parcels registered and the requests that carried them. */
async function parcelFacts(f: ResolvedFilters) {
  const [r] = await rows<Row>(sql`
    select ${twinSelect(f, {
      delivered: (w) => sql`count(*) filter (where shipments.status = 'delivered' and ${w(PARCEL_OUTCOME_AT)})::int`,
      failed: (w) => sql`count(*) filter (where shipments.status = 'failed' and ${w(PARCEL_OUTCOME_AT)})::int`,
      returned: (w) => sql`count(*) filter (where shipments.status = 'returned' and ${w(PARCEL_OUTCOME_AT)})::int`,
      first: (w) => sql`count(*) filter (where shipments.status = 'delivered' and shipments.attempts <= 1 and ${w(PARCEL_OUTCOME_AT)})::int`,
      registered: (w) => sql`count(*) filter (where ${w(shipments.createdAt)})::int`,
      reg_requests: (w) => sql`count(distinct shipments.request_id) filter (where ${w(shipments.createdAt)})::int`,
    })}
    from shipments join requests on requests.id = shipments.request_id
    where ${scope(f, "shipments")} and ${anyWindow(f, PARCEL_OUTCOME_AT, shipments.createdAt)}`);
  return { delivered: twinRead(r, "delivered"), failed: twinRead(r, "failed"), returned: twinRead(r, "returned"), first: twinRead(r, "first"), registered: twinRead(r, "registered"), reg_requests: twinRead(r, "reg_requests") };
}

/** Billed amount, platform margin and the number of settled requests (money: call only for `finance.view`). */
async function moneyFacts(f: ResolvedFilters) {
  const [r] = await rows<Row>(sql`
    select ${twinSelect(f, {
      gmv: (w) => sql`coalesce(sum(settlements.customer_cents) filter (where ${w(settlements.createdAt)} and ${BILLED}), 0)::float8`,
      revenue: (w) => sql`coalesce(sum(settlements.margin_cents) filter (where ${w(settlements.createdAt)} and ${BILLED}), 0)::float8`,
      orders: (w) => sql`count(distinct settlements.request_id) filter (where ${w(settlements.createdAt)} and ${BILLED})::int`,
    })}
    from settlements join requests on requests.id = settlements.request_id
    where ${scope(f, "settlements")} and ${anyWindow(f, settlements.createdAt)}`);
  return { gmv: z(twinRead(r, "gmv")), revenue: z(twinRead(r, "revenue")), orders: z(twinRead(r, "orders")) };
}

/** Drivers who accepted work, and start punctuality (arrived by start + grace) of the jobs whose start time falls in the period. */
async function driverFacts(f: ResolvedFilters) {
  const grace = (await getSettings()).lateGraceMin;
  const limit = sql`requests.starts_at + make_interval(mins => ${grace}::int)`;
  const counted = sql`offers.accepted_at is not null and offers.status not in ('rejected','expired','cancelled','replaced')`;
  const [r] = await rows<Row>(sql`
    select ${twinSelect(f, {
      drivers: (w) => sql`count(distinct offers.driver_id) filter (where ${w(offers.acceptedAt)})::int`,
      on_time: (w) => sql`count(*) filter (where ${w(requests.startsAt)} and ${counted} and offers.arrived_at is not null and offers.arrived_at <= ${limit})::int`,
      due: (w) => sql`count(*) filter (where ${w(requests.startsAt)} and ${counted} and (offers.arrived_at is not null or offers.status = 'no_show' or now() > ${limit}))::int`,
    })}
    from offers join requests on requests.id = offers.request_id
    where ${scope(f, "offers")} and ${anyWindow(f, offers.acceptedAt, requests.startsAt)}`);
  return { drivers: twinRead(r, "drivers"), on_time: twinRead(r, "on_time"), due: twinRead(r, "due") };
}

/**
 * Time to fill: from publishing to the moment the LAST live driver accepted, for requests that are fully staffed now, grouped by publish time.
 * Average for both periods; percentiles and the histogram for the current one.
 */
async function fillFacts(f: ResolvedFilters) {
  const inCur = inWindow("x.published_at", f.cur);
  const [r] = await rows<Row>(sql`
    select ${twinSelect(f, {
      avg: (w) => sql`avg(x.secs) filter (where ${w("x.published_at")})::float8`,
      n: (w) => sql`count(*) filter (where ${w("x.published_at")})::int`,
    })},
    percentile_cont(0.5) within group (order by x.secs) filter (where ${inCur}) as p50, percentile_cont(0.9) within group (order by x.secs) filter (where ${inCur}) as p90,
    percentile_cont(0.95) within group (order by x.secs) filter (where ${inCur}) as p95, ${histogramSelect(sql`x.secs`, FILL_EDGES, "h", inCur)}
    from (
      select requests.id, requests.published_at, extract(epoch from (max(offers.accepted_at) - requests.published_at))::float8 as secs
      from requests join offers on offers.request_id = requests.id and offers.accepted_at is not null and offers.status not in ('rejected','expired','cancelled','replaced','no_show')
      where ${scope(f, "requests")} and requests.published_at is not null and requests.slots_filled >= requests.quantity and ${anyWindow(f, requests.publishedAt)}
      group by requests.id, requests.published_at having max(offers.accepted_at) >= requests.published_at
    ) x`);
  const p = (v: unknown) => (v == null ? null : Number(v));
  const avg = twinRead(r, "avg"), n = twinRead(r, "n");
  return { avg, n: n.cur ?? 0, p50: p(r?.p50), p90: p(r?.p90), p95: p(r?.p95), histogram: histogramFromRow(r ?? {}, FILL_EDGES) };
}

/** New accounts by role (the only measure that is not about requests: only the city filter applies). */
async function signupFacts(f: ResolvedFilters) {
  const roleN = (role: string) => (w: (c: string) => SQL) => sql`count(*) filter (where ${w("users.created_at")} and users.role = ${role})::int`;
  const [r] = await rows<Row>(sql`
    select ${twinSelect(f, { business: roleN("business"), driver: roleN("driver"), office: roleN("office") })}
    from users where users.role in ('business','driver','office') and ${f.city.length ? sql`users.city in (${sql.join(f.city.map((c) => sql`${c}`), sql`, `)})` : sql`true`} and ${anyWindow(f, users.createdAt)}`);
  return { business: twinRead(r, "business"), driver: twinRead(r, "driver"), office: twinRead(r, "office") };
}

export async function overviewFacts(f: ResolvedFilters, money: boolean) {
  const [req, parcels, cash, drivers, fill, signups] = await Promise.all([requestFacts(f), parcelFacts(f), money ? moneyFacts(f) : null, driverFacts(f), fillFacts(f), signupFacts(f)]);
  return { req, parcels, cash, drivers, fill, signups };
}
export type OverviewFacts = Awaited<ReturnType<typeof overviewFacts>>;

const add = (...p: Pair[]): Pair => ({ cur: p.reduce((s, x) => s + (x.cur ?? 0), 0), prev: p.every((x) => x.prev == null) ? null : p.reduce((s, x) => s + (x.prev ?? 0), 0) });
const ratio = (n: Pair, d: Pair): Pair => ({ cur: safeDiv(n.cur, d.cur), prev: safeDiv(n.prev, d.prev) });

/** The KPI objects of the Overview from the raw facts (pure: unit-tested). `spark` carries one number per bucket for the KPIs that have a series. */
export function overviewKpis(facts: OverviewFacts, f: ResolvedFilters, spark: Record<string, Array<number | null> | undefined> = {}): Kpi[] {
  const { req, parcels: pc, cash, drivers, fill, signups } = facts;
  const out: Array<[string, Pair, Partial<Kpi>?]> = [];
  if (cash) {
    out.push(["gmv", cash.gmv, { href: "/admin/finance" }], ["revenue", cash.revenue, { href: "/admin/finance" }], ["margin_pct", ratio(cash.revenue, cash.gmv)]);
  }
  const resolved = add(pc.delivered, pc.failed, pc.returned);
  out.push(
    ["requests_created", z(req.created), { href: "/admin/requests" }], ["requests_completed", z(req.completed)], ["parcels_delivered", z(pc.delivered)],
    ["delivery_success", ratio(pc.delivered, resolved)], ["first_attempt", ratio(pc.first, pc.delivered)], ["cancellation_rate", ratio(req.cancelled, req.created)],
    ["active_companies", z(req.companies), { href: "/admin/companies" }], ["active_drivers", z(drivers.drivers), { href: "/admin/drivers" }],
    ["new_signups", add(signups.business, signups.driver, signups.office), { href: "/admin/users", parts: [{ key: "business", value: signups.business.cur ?? 0 }, { key: "driver", value: signups.driver.cur ?? 0 }, { key: "office", value: signups.office.cur ?? 0 }] }],
    ["parcels_per_request", ratio(pc.registered, pc.reg_requests)], ["on_time_start", ratio(drivers.on_time, drivers.due)], ["time_to_fill", fill.avg],
  );
  if (cash) out.splice(out.findIndex((x) => x[0] === "requests_created"), 0, ["aov", ratio(cash.gmv, cash.orders)]);
  return out.map(([key, p, extra]) => {
    const unfiltered = ignoredFilters(f, kpiDef(key).notFilteredBy ?? []);
    return makeKpi(key, p.cur, p.prev, { ...extra, spark: spark[key], ...(unfiltered.length ? { unfiltered } : {}) });
  });
}
