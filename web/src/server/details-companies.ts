import { and, eq, sql, type SQL } from "drizzle-orm";
import { db } from "@/db";
import { businessProfiles, users, type User } from "@/db/schema";
import { err } from "@/lib/errors";
import { can } from "./auth/permissions";
import { REQUEST_ACTIVE } from "./catalog";
import { requireCompanyView } from "./companies-admin";
import { getSettings } from "./settings";
import { BILLED, inWindow, NOT_DRAFT, PARCEL_OUTCOME_AT, twinRead } from "./analytics/conditions";
import { bucketSql, zeroFill } from "./analytics/buckets";
import { bucketKeys, type Window } from "./analytics/periods";
import { cached, num, rows } from "./analytics/guard";
import { riyadhDay } from "./analytics/time";
import { companyAlerts, healthScore, resolvePeriod, SLA, type CompanyPeriod, type PeriodWindows } from "./details-pure";

/**
 * The numbers of the company view (`GET /admin/companies/:id/stats?period=`): the KPI strip with the previous period beside it, the health score with its
 * five parts, the alerts, and the charts. Every figure is one bounded aggregate through `rows()` (read-only, 15 s timeout); a section the viewer has no
 * permission for is absent (and named in `hidden`), never 0. Definitions live in `details-pure.ts` and in the `dv3.d_*` texts the UI shows next to each number.
 */
type Row = Record<string, unknown>;
type W = Pick<Window, "start" | "end">;
export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ACTIVE = [...REQUEST_ACTIVE];
const list = (xs: string[]) => sql.join(xs.map((x) => sql`${x}`), sql`, `);

/** Select-list of metrics for the current window and (when there is one) the comparison window: `<name>_c` / `<name>_p`. */
export function twin(cur: W, prev: W | null, metrics: Record<string, (w: (c: SQL | string) => SQL) => SQL>): SQL {
  const parts: SQL[] = [];
  for (const [k, f] of Object.entries(metrics)) {
    parts.push(sql`${f((c) => inWindow(c, cur))} as ${sql.raw(`${k}_c`)}`);
    if (prev) parts.push(sql`${f((c) => inWindow(c, prev))} as ${sql.raw(`${k}_p`)}`);
  }
  return sql.join(parts, sql`, `);
}
const pair = (r: Row | undefined, k: string) => twinRead(r, k);
const D90 = sql`now() - interval '90 days'`;

export async function loadCompany(id: string) {
  if (!UUID_RE.test(id)) throw err("NOT_FOUND");
  const [row] = await db.select({ u: users, p: businessProfiles }).from(users).leftJoin(businessProfiles, eq(businessProfiles.userId, users.id)).where(and(eq(users.id, id), eq(users.role, "business")));
  if (!row) throw err("NOT_FOUND");
  return row;
}

async function orderFacts(id: string, pw: PeriodWindows) {
  const q = sql`requests.business_id = ${id}`;
  const [r] = await rows<Row>(sql`
    select ${twin(pw.cur, pw.prev, {
      orders: (w) => sql`count(*) filter (where ${w(sql`requests.created_at`)} and ${NOT_DRAFT})::int`,
      cancelled: (w) => sql`count(*) filter (where ${w(sql`requests.created_at`)} and requests.status = 'cancelled')::int`,
    })},
      max(requests.created_at) filter (where ${NOT_DRAFT}) as last_order_at, min(requests.created_at) filter (where ${NOT_DRAFT}) as first_order_at,
      count(*) filter (where ${NOT_DRAFT})::int as orders_all,
      count(*) filter (where ${NOT_DRAFT} and requests.created_at >= ${D90})::int as orders90,
      count(*) filter (where requests.status = 'cancelled' and requests.created_at >= ${D90})::int as cancelled90,
      count(*) filter (where requests.status in (${list(ACTIVE)}))::int as open_now
    from requests where ${q}`);
  return r ?? ({} as Row);
}

async function parcelFacts(id: string, pw: PeriodWindows) {
  const [r] = await rows<Row>(sql`
    select ${twin(pw.cur, pw.prev, {
      sent: (w) => sql`count(*) filter (where ${w(sql`shipments.created_at`)} and shipments.status <> 'cancelled')::int`,
      delivered: (w) => sql`count(*) filter (where shipments.status = 'delivered' and ${w(PARCEL_OUTCOME_AT)})::int`,
      failed: (w) => sql`count(*) filter (where shipments.status = 'failed' and ${w(PARCEL_OUTCOME_AT)})::int`,
      returned: (w) => sql`count(*) filter (where shipments.status = 'returned' and ${w(PARCEL_OUTCOME_AT)})::int`,
    })},
      count(*) filter (where shipments.status = 'delivered' and ${PARCEL_OUTCOME_AT} >= ${D90})::int as delivered90,
      count(*) filter (where shipments.status in ('failed','returned') and ${PARCEL_OUTCOME_AT} >= ${D90})::int as lost90
    from shipments join requests on requests.id = shipments.request_id where requests.business_id = ${id}`);
  return r ?? ({} as Row);
}

/** Start punctuality: arrived by start + grace, among the jobs whose start falls in the window and whose grace has passed (a no-show counts as late). */
async function startFacts(id: string, pw: PeriodWindows) {
  const grace = (await getSettings()).lateGraceMin;
  const limit = sql`requests.starts_at + make_interval(mins => ${grace}::int)`;
  const counted = sql`offers.accepted_at is not null and offers.status not in ('rejected','expired','cancelled','replaced')`;
  const [r] = await rows<Row>(sql`
    select ${twin(pw.cur, pw.prev, {
      on_time: (w) => sql`count(*) filter (where ${w(sql`requests.starts_at`)} and ${counted} and offers.arrived_at is not null and offers.arrived_at <= ${limit})::int`,
      due: (w) => sql`count(*) filter (where ${w(sql`requests.starts_at`)} and ${counted} and (offers.arrived_at is not null or offers.status = 'no_show' or now() > ${limit}))::int`,
    })}
    from offers join requests on requests.id = offers.request_id where requests.business_id = ${id}`);
  return r ?? ({} as Row);
}

async function moneyFacts(id: string, pw: PeriodWindows) {
  const [r] = await rows<Row>(sql`
    select ${twin(pw.cur, pw.prev, {
      gmv: (w) => sql`coalesce(sum(settlements.customer_cents) filter (where ${w(sql`settlements.created_at`)} and ${BILLED}), 0)::float8`,
      billed: (w) => sql`count(distinct settlements.request_id) filter (where ${w(sql`settlements.created_at`)} and ${BILLED})::int`,
    })}
    from settlements where settlements.business_id = ${id}`);
  return r ?? ({} as Row);
}

/** Cash this company's drivers still hold (collected on delivered parcels minus handed back), the same rule as /admin/cod. */
async function codOutstanding(id: string): Promise<number> {
  const [r] = await rows<Row>(sql`
    select coalesce(sum(greatest(c.collected - coalesce(r.received, 0), 0)), 0)::float8 as outstanding
    from (select s.offer_id, sum(s.cod_collected_cents) as collected from shipments s join requests q on q.id = s.request_id
          where q.business_id = ${id} and s.status = 'delivered' and s.cod_collected_cents is not null and s.offer_id is not null group by s.offer_id) c
    left join (select offer_id, sum(amount_cents) as received from cod_remittances where business_id = ${id} group by offer_id) r on r.offer_id = c.offer_id`);
  return num(r?.outstanding);
}

async function supportFacts(id: string, tickets: boolean, complaints: boolean) {
  const first = sql`make_interval(secs => ${SLA.firstResponseSec})`, res = sql`make_interval(secs => ${SLA.resolutionSec})`;
  const [t, c] = await Promise.all([
    tickets ? rows<Row>(sql`select count(*) filter (where status in ('open','in_review'))::int as open_n,
        count(*) filter (where status in ('open','in_review') and ((first_response_at is null and created_at < now() - ${first}) or created_at < now() - ${res}))::int as breached
      from tickets where opened_by = ${id}`) : null,
    complaints ? rows<Row>(sql`select count(*) filter (where status in ('open','in_progress'))::int as open_n,
        count(*) filter (where created_at >= ${D90})::int as filed90,
        count(*) filter (where status in ('open','in_progress') and ((first_response_at is null and created_at < now() - ${first}) or created_at < now() - ${res}))::int as breached
      from complaints where filed_by = ${id}`) : null,
  ]);
  return { tickets: t ? { open: num(t[0]?.open_n), breached: num(t[0]?.breached) } : null, complaints: c ? { open: num(c[0]?.open_n), filed90: num(c[0]?.filed90), breached: num(c[0]?.breached) } : null };
}

async function walletFacts(id: string) {
  const [r] = await rows<Row>(sql`select available_cents::float8 as a, reserved_cents::float8 as r, held_cents::float8 as h, credit_limit_cents::float8 as c from wallet_accounts where owner_id = ${id}`);
  return { availableCents: num(r?.a), reservedCents: num(r?.r), heldCents: num(r?.h), creditLimitCents: num(r?.c) };
}

async function seriesFacts(id: string, pw: PeriodWindows, money: boolean) {
  const keys = bucketKeys(pw.cur.from, pw.cur.to, pw.bucket);
  const [reqs, created, outcomes, reasons, cities, svc, next, integ] = await Promise.all([
    rows<{ t: string; orders: number; cancelled: number }>(sql`select ${bucketSql(sql`requests.created_at`, pw.bucket)} as t, count(*) filter (where ${NOT_DRAFT})::int as orders, count(*) filter (where requests.status = 'cancelled')::int as cancelled
      from requests where requests.business_id = ${id} and ${inWindow("requests.created_at", pw.cur)} group by 1`),
    rows<{ t: string; parcels: number }>(sql`select ${bucketSql(sql`shipments.created_at`, pw.bucket)} as t, count(*)::int as parcels from shipments join requests on requests.id = shipments.request_id
      where requests.business_id = ${id} and shipments.status <> 'cancelled' and ${inWindow("shipments.created_at", pw.cur)} group by 1`),
    rows<{ t: string; delivered: number; failed: number }>(sql`select ${bucketSql(PARCEL_OUTCOME_AT, pw.bucket)} as t, count(*) filter (where shipments.status = 'delivered')::int as delivered, count(*) filter (where shipments.status in ('failed','returned'))::int as failed
      from shipments join requests on requests.id = shipments.request_id where requests.business_id = ${id} and ${inWindow(PARCEL_OUTCOME_AT, pw.cur)} group by 1`),
    rows<Row>(sql`select coalesce(shipments.fail_reason, 'other') as k, count(*)::int as n from shipments join requests on requests.id = shipments.request_id
      where requests.business_id = ${id} and shipments.status in ('failed','returned') and ${inWindow(PARCEL_OUTCOME_AT, pw.cur)} group by 1 order by n desc limit 8`),
    rows<Row>(sql`select requests.delivery_city as k, count(*)::int as n from requests where requests.business_id = ${id} and ${NOT_DRAFT} and ${inWindow("requests.created_at", pw.cur)} group by 1 order by n desc, k limit 6`),
    money ? rows<Row>(sql`select requests.service as k, coalesce(sum(settlements.customer_cents), 0)::float8 as n from settlements join requests on requests.id = settlements.request_id
      where settlements.business_id = ${id} and ${BILLED} and ${inWindow("settlements.created_at", pw.cur)} group by 1 order by n desc`) : null,
    rows<Row>(sql`select id, ref, total_cents::float8 as total from requests where business_id = ${id} and status = 'draft' and total_cents > 0 order by starts_at limit 1`),
    rows<Row>(sql`select (select count(*) from partner_connections where business_id = ${id} and status = 'active' and last_error is not null)::int as conn,
      (select count(*) from webhook_deliveries where business_id = ${id} and status = 'dead_letter' and created_at >= now() - interval '7 days')::int as hooks`),
  ]);
  const a = zeroFill(keys, reqs, ["orders", "cancelled"] as const), b = zeroFill(keys, created, ["parcels"] as const), c = zeroFill(keys, outcomes, ["delivered", "failed"] as const);
  return {
    orders: a.map((p, i) => ({ ...p, parcels: b[i].parcels, delivered: c[i].delivered, failed: c[i].failed })),
    failureReasons: reasons.map((x) => ({ key: String(x.k), value: num(x.n) })),
    cities: cities.map((x) => ({ key: String(x.k), value: num(x.n) })),
    spendByService: svc ? svc.map((x) => ({ key: String(x.k), value: num(x.n) })) : null,
    nextDraft: next[0] ? { ref: String(next[0].ref), totalCents: num(next[0].total) } : null,
    integrationErrors: num(integ[0]?.conn) + num(integ[0]?.hooks),
  };
}

export type CompanyKpiKey = "orders" | "parcels" | "success" | "cancellation" | "on_time" | "spend" | "aov" | "cod" | "wallet" | "frequency" | "support" | "health";
export interface CompanyKpi { key: CompanyKpiKey; unit: "count" | "money" | "percent" | "rate" | "score"; good: "higher" | "lower" | "neutral"; value: number | null; prev: number | null; sub?: string | number | null }

export async function companyStats(viewer: User, id: string, period: CompanyPeriod) {
  requireCompanyView(viewer);
  const { u, p } = await loadCompany(id);
  const perms = { orders: can(viewer, "requests.view"), finance: can(viewer, "finance.view"), wallet: can(viewer, "finance.view") || can(viewer, "wallets.view"), cod: can(viewer, "cod.manage") || can(viewer, "finance.view"), tickets: can(viewer, "tickets.view"), complaints: can(viewer, "complaints.manage") };
  const key = `co-stats|${id}|${period}|${Object.values(perms).map(Number).join("")}`;
  const c = await cached(key, () => build(u, p, period, perms));
  return { ...c.value, generatedAt: new Date(c.at).toISOString(), cached: c.cached };
}

async function build(u: typeof users.$inferSelect, p: typeof businessProfiles.$inferSelect | null, period: CompanyPeriod, perms: Record<"orders" | "finance" | "wallet" | "cod" | "tickets" | "complaints", boolean>) {
  const pw = resolvePeriod(period, riyadhDay(new Date()), u.createdAt), id = u.id;
  const [o, par, st, mon, cod, sup, wal, ser] = await Promise.all([
    perms.orders ? orderFacts(id, pw) : null, perms.orders ? parcelFacts(id, pw) : null, perms.orders ? startFacts(id, pw) : null,
    perms.finance ? moneyFacts(id, pw) : null, perms.cod ? codOutstanding(id) : null,
    perms.tickets || perms.complaints ? supportFacts(id, perms.tickets, perms.complaints) : null, perms.wallet ? walletFacts(id) : null,
    perms.orders ? seriesFacts(id, pw, perms.finance) : null,
  ]);
  const hidden = [!perms.orders && "orders", !perms.finance && "money", !perms.wallet && "wallet", !perms.cod && "cod", !(perms.tickets || perms.complaints) && "support"].filter((x): x is string => !!x);
  const kpis: CompanyKpi[] = []; const days = { cur: pw.cur.days, prev: pw.prev?.days ?? null };
  const div = (n: number | null, d: number | null) => (n == null || d == null || d === 0 ? null : n / d);
  let facts: Record<string, unknown> | null = null; let daysSince: number | null = null, successRate: number | null = null, cancelRate: number | null = null, failure = { cur: null as number | null, prev: null as number | null, outcomes: 0 }, cancelPair = { cur: null as number | null, prev: null as number | null, orders: 0 };
  if (o && par && st) {
    const ord = pair(o, "orders"), can_ = pair(o, "cancelled"), sent = pair(par, "sent"), del = pair(par, "delivered"), fl = pair(par, "failed"), ret = pair(par, "returned"), ot = pair(st, "on_time"), due = pair(st, "due");
    const out = { cur: (del.cur ?? 0) + (fl.cur ?? 0) + (ret.cur ?? 0), prev: pw.prev ? (del.prev ?? 0) + (fl.prev ?? 0) + (ret.prev ?? 0) : null };
    const succ = { cur: div(del.cur, out.cur), prev: div(del.prev, out.prev) }, canc = { cur: div(can_.cur, ord.cur), prev: div(can_.prev, ord.prev) };
    const last = o.last_order_at ? new Date(o.last_order_at as string) : null, ordersAll = num(o.orders_all);
    const freq = (n: number | null, d: number | null) => (n == null || !d ? null : (n / d) * 30);
    const spanAll = Math.max(1, Math.round((Date.now() - new Date((o.first_order_at as string) ?? u.createdAt).getTime()) / 864e5));
    daysSince = last ? Math.floor((Date.now() - last.getTime()) / 864e5) : null;
    const dl = num(par.delivered90), ls = num(par.lost90); successRate = div(dl, dl + ls); cancelRate = div(num(o.cancelled90), num(o.orders90));
    failure = { cur: out.cur ? 1 - (succ.cur ?? 0) : null, prev: out.prev ? 1 - (succ.prev ?? 0) : null, outcomes: out.cur };
    cancelPair = { cur: canc.cur, prev: canc.prev, orders: ord.cur ?? 0 };
    kpis.push(
      { key: "orders", unit: "count", good: "higher", value: ord.cur, prev: ord.prev, sub: ordersAll },
      { key: "parcels", unit: "count", good: "higher", value: sent.cur, prev: sent.prev },
      { key: "success", unit: "percent", good: "higher", value: succ.cur, prev: succ.prev, sub: out.cur },
      { key: "cancellation", unit: "percent", good: "lower", value: canc.cur, prev: canc.prev, sub: can_.cur },
      { key: "on_time", unit: "percent", good: "higher", value: div(ot.cur, due.cur), prev: div(ot.prev, due.prev), sub: due.cur },
      { key: "frequency", unit: "rate", good: "higher", value: period === "all" ? freq(ordersAll, spanAll) : freq(ord.cur, days.cur), prev: freq(ord.prev, days.prev) },
    );
    facts = { lastOrderAt: last?.toISOString() ?? null, firstOrderAt: o.first_order_at ? new Date(o.first_order_at as string).toISOString() : null, daysSinceLastOrder: daysSince, ordersAll, openNow: num(o.open_now) };
  }
  let avgOrder: number | null = null;
  if (mon) {
    const g = pair(mon, "gmv"), b = pair(mon, "billed"), aov = { cur: div(g.cur, b.cur), prev: div(g.prev, b.prev) };
    avgOrder = aov.cur;
    kpis.push({ key: "spend", unit: "money", good: "higher", value: g.cur, prev: g.prev, sub: b.cur }, { key: "aov", unit: "money", good: "neutral", value: aov.cur, prev: aov.prev });
  }
  if (cod != null) kpis.push({ key: "cod", unit: "money", good: "lower", value: cod, prev: null });
  const creditUse = wal && wal.creditLimitCents > 0 ? Math.max(0, -wal.availableCents) / wal.creditLimitCents : null;
  const supportOpen = sup ? (sup.tickets?.open ?? 0) + (sup.complaints?.open ?? 0) : null;
  if (supportOpen != null) kpis.push({ key: "support", unit: "count", good: "lower", value: supportOpen, prev: null, sub: sup?.tickets && sup.complaints ? `${sup.tickets.open}/${sup.complaints.open}` : null });
  const healthInputs = o && par ? { daysSinceLastOrder: daysSince, orders90: num(o.orders90), successRate, cancellationRate: cancelRate, openSupport: supportOpen, complaints90: sup ? sup.complaints?.filed90 ?? 0 : null } : null;
  const health = healthInputs ? healthScore(healthInputs) : null;
  if (health) kpis.push({ key: "health", unit: "score", good: "higher", value: health.score, prev: null });
  const alerts = o && par ? companyAlerts({
    accountAgeDays: Math.floor((Date.now() - u.createdAt.getTime()) / 864e5), verified: p?.verificationStatus === "verified", daysSinceLastOrder: daysSince,
    spendableCents: wal ? wal.availableCents + wal.creditLimitCents : null, nextOrder: ser?.nextDraft ?? null, avgOrderCents: avgOrder,
    failureRate: failure, cancellationRate: cancelPair, creditUse, integrationErrors: ser?.integrationErrors ?? 0, slaBreached: (sup?.tickets?.breached ?? 0) + (sup?.complaints?.breached ?? 0),
  }) : [];
  return {
    period: { key: pw.key, from: pw.cur.from, to: pw.cur.to, days: pw.cur.days, bucket: pw.bucket, prevFrom: pw.prev?.from ?? null, prevTo: pw.prev?.to ?? null },
    kpis, health, healthInputs, alerts, facts, hidden, moneyHidden: !perms.finance,
    wallet: wal ? { ...wal, creditUse } : null,
    charts: ser ? { orders: ser.orders, failureReasons: ser.failureReasons, cities: ser.cities, spendByService: ser.spendByService } : null,
  };
}
