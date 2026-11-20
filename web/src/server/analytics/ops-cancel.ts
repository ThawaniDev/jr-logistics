import { sql, type SQL } from "drizzle-orm";
import { bucketSql } from "./buckets";
import { anyWindow, inWindow, scope, twinRead, twinSelect } from "./conditions";
import type { ResolvedFilters } from "./filters";
import { num, rows } from "./guard";
import { buildSeries } from "./ops-series";
import { CANCEL_KINDS, PARTIES, STAGES } from "./ops-kinds";
import { DRIVEN, list } from "./ops-sql";
import { asNum, type Row } from "./ops-util";
import { histogramFromRow, histogramSelect } from "./stats";

export { CANCEL_KINDS, PARTIES, STAGES } from "./ops-kinds";
/** Edges (seconds before the start time) of the lead-time histogram: after the start (< 0), < 1 h, 1–6 h, 6–24 h, 1–3 days, ≥ 3 days. */
export const LEAD_EDGES = [0, 3600, 21_600, 86_400, 259_200];

/**
 * Every cancellation-type event in one derived table (`ev`), by the time it happened:
 *  - `request`      a request that ended `cancelled`; party business = cancelled by its own business, platform = cancelled by staff or called off because it was not fully staffed;
 *  - `driver_cancel` / `no_show`  an accepted job the driver cancelled / did not turn up for (party driver);
 *  - `replaced`     a driver replaced by operations or the courier office (party platform).
 * Offers withdrawn together with their request (`request_cancelled`, `not_fully_staffed`) are the request's consequence, not events of their own.
 * Stage = how far the work had got: nobody accepted yet · accepted · driver arrived at the warehouse · route started. `win(col)` restricts the event time (so indexes can be used).
 */
export function cancelEvents(f: ResolvedFilters, win: (col: SQL) => SQL): SQL {
  const rAt = sql`coalesce(requests.cancelled_at, requests.updated_at)`, oAt = sql`coalesce(offers.cancelled_at, offers.updated_at)`;
  return sql`
    select 'request'::text as kind, case when requests.cancel_reason = 'not_fully_staffed' or requests.cancelled_by is distinct from requests.business_id then 'platform' else 'business' end as party,
      case when st.mid then 'mid_route' when st.arr then 'after_arrival' when st.acc then 'after_accept' else 'before_accept' end as stage,
      requests.id as request_id, null::uuid as offer_id, requests.business_id as business_id, null::uuid as driver_id, ${rAt} as at, requests.starts_at as starts_at, nullif(btrim(requests.cancel_reason), '') as reason, requests.ref as ref
    from requests left join lateral (select coalesce(bool_or(o.route_approved_at is not null), false) as mid, coalesce(bool_or(o.arrived_at is not null), false) as arr, coalesce(bool_or(o.accepted_at is not null), false) as acc
      from offers o where o.request_id = requests.id) st on true
    where requests.status = 'cancelled' and ${scope(f, "requests")} and ${win(rAt)}
    union all
    select case offers.status when 'cancelled' then 'driver_cancel' when 'no_show' then 'no_show' else 'replaced' end, case when offers.status = 'replaced' then 'platform' else 'driver' end,
      case when offers.route_approved_at is not null then 'mid_route' when offers.arrived_at is not null then 'after_arrival' else 'after_accept' end,
      requests.id, offers.id, requests.business_id, offers.driver_id, ${oAt}, requests.starts_at, nullif(btrim(offers.cancel_reason), ''), requests.ref
    from offers join requests on requests.id = offers.request_id
    where offers.status in ('cancelled','no_show','replaced') and offers.accepted_at is not null and coalesce(offers.cancel_reason, '') not in ('request_cancelled','not_fully_staffed')
      and ${DRIVEN} and ${scope(f, "offers")} and ${win(oAt)}`;
}
const LEAD_S = sql`extract(epoch from (ev.starts_at - ev.at))::float8`;
const cnt = (cond: SQL) => (w: (c: string) => SQL) => sql`count(*) filter (where ${w("ev.at")} and ${cond})::int`;

/** Counts of the events (both periods), the lead-time distribution (current period) and the median lead time. */
export async function cancelFacts(f: ResolvedFilters) {
  const inCur = inWindow("ev.at", f.cur);
  const [r] = await rows<Row>(sql`
    select ${twinSelect(f, {
      requests: cnt(sql`ev.kind = 'request'`), by_business: cnt(sql`ev.kind = 'request' and ev.party = 'business'`), by_platform: cnt(sql`ev.kind = 'request' and ev.party = 'platform'`),
      late_requests: cnt(sql`ev.kind = 'request' and ev.stage <> 'before_accept'`), driver_cancels: cnt(sql`ev.kind = 'driver_cancel'`), no_shows: cnt(sql`ev.kind = 'no_show'`), replaced: cnt(sql`ev.kind = 'replaced'`),
      lead_p50: (w) => sql`percentile_cont(0.5) within group (order by ${LEAD_S}) filter (where ${w("ev.at")})`,
    })}, ${histogramSelect(LEAD_S, LEAD_EDGES, "hl", inCur)}
    from (${cancelEvents(f, (c) => anyWindow(f, c))}) ev`);
  const p = (k: string) => twinRead(r, k);
  return {
    requests: p("requests"), byBusiness: p("by_business"), byPlatform: p("by_platform"), lateRequests: p("late_requests"), driverCancels: p("driver_cancels"), noShows: p("no_shows"), replaced: p("replaced"),
    lead: { p50: p("lead_p50"), histogram: histogramFromRow(r ?? {}, LEAD_EDGES, "hl") },
  };
}

/** Current-period events grouped by party, stage and kind (a handful of rows) and the most frequent reasons. */
export async function cancelBreakdown(f: ResolvedFilters) {
  const cur = cancelEvents(f, (c) => inWindow(c, f.cur));
  const [grid, reasons] = await Promise.all([
    rows<Row>(sql`select ev.party, ev.stage, ev.kind, count(*)::int as n from (${cur}) ev group by 1, 2, 3`),
    rows<Row>(sql`
      select coalesce(left(lower(ev.reason), 80), '') as reason, count(*)::int as n, count(*) filter (where ev.party = 'business')::int as business,
        count(*) filter (where ev.party = 'driver')::int as driver, count(*) filter (where ev.party = 'platform')::int as platform
      from (${cur}) ev group by 1 order by 2 desc, 1 limit 12`),
  ]);
  const sumBy = (key: "party" | "stage" | "kind", values: readonly string[]) => values.map((k) => ({ key: k, count: grid.filter((g) => g[key] === k).reduce((s, g) => s + num(g.n), 0) }));
  return {
    parties: sumBy("party", PARTIES), stages: sumBy("stage", STAGES), kinds: sumBy("kind", CANCEL_KINDS),
    reasons: reasons.map((x) => ({ reason: String(x.reason ?? ""), count: num(x.n), business: num(x.business), driver: num(x.driver), platform: num(x.platform) })),
  };
}

export const CANCEL_FIELDS = ["business", "driver", "platform"] as const;
/** Cancellation events per bucket by party. */
export const cancelSeries = (f: ResolvedFilters) => buildSeries(f, CANCEL_FIELDS, (w) => sql`
  select ${bucketSql("ev.at", f.bucket)} as t, count(*) filter (where ev.party = 'business')::int as business, count(*) filter (where ev.party = 'driver')::int as driver,
    count(*) filter (where ev.party = 'platform')::int as platform
  from (${cancelEvents(f, (c) => inWindow(c, w))}) ev group by 1`);

export interface CancelRank { id: string; name: string; value: number; prev: number | null; of?: number | null; noShows?: number }
/** Companies that cancelled the most requests (with the requests they created in the period, for the share), and drivers with the most cancellations + no-shows. */
export async function cancelRankings(f: ResolvedFilters): Promise<{ companies: CancelRank[]; drivers: CancelRank[] }> {
  const ev = cancelEvents(f, (c) => anyWindow(f, c));
  const [co, dr] = await Promise.all([
    rows<Row>(sql`
      select ev.business_id as id, coalesce(bp.company_name, u.name) as name, ${twinSelect(f, { n: cnt(sql`ev.kind = 'request' and ev.party = 'business'`) })},
        (select count(*)::int from requests r2 where r2.business_id = ev.business_id and r2.status <> 'draft' and ${inWindow("r2.created_at", f.cur)}) as total
      from (${ev}) ev join users u on u.id = ev.business_id left join business_profiles bp on bp.user_id = u.id
      where ev.kind = 'request' and ev.party = 'business' group by ev.business_id, bp.company_name, u.name
      having count(*) filter (where ${inWindow("ev.at", f.cur)}) > 0 order by n_c desc, 1 limit 10`),
    rows<Row>(sql`
      select ev.driver_id as id, u.name as name, ${twinSelect(f, { n: cnt(sql`ev.kind in ('driver_cancel','no_show')`), no_shows: cnt(sql`ev.kind = 'no_show'`) })}
      from (${ev}) ev join users u on u.id = ev.driver_id where ev.kind in ('driver_cancel','no_show') group by ev.driver_id, u.name
      having count(*) filter (where ${inWindow("ev.at", f.cur)}) > 0 order by n_c desc, 1 limit 10`),
  ]);
  return {
    companies: co.map((x) => ({ id: String(x.id), name: String(x.name ?? ""), value: twinRead(x, "n").cur ?? 0, prev: f.prev ? twinRead(x, "n").prev ?? 0 : null, of: asNum(x.total) })),
    drivers: dr.map((x) => ({ id: String(x.id), name: String(x.name ?? ""), value: twinRead(x, "n").cur ?? 0, prev: f.prev ? twinRead(x, "n").prev ?? 0 : null, noShows: twinRead(x, "no_shows").cur ?? 0 })),
  };
}

/**
 * Strikes issued: the warnings and automatic suspensions drivers received for repeated cancellations (notifications `cancel_warning` / `cancel_suspended`),
 * and — with finance access — the escrow released back to businesses because a request was cancelled or called off.
 */
export async function cancelPolicy(f: ResolvedFilters, money: boolean) {
  const only = (w: (c: string) => SQL, type: string) => sql`count(*) filter (where ${w("n.created_at")} and n.type = ${type})::int`;
  const drivers = f.driver.length ? sql`and n.user_id in (${list(f.driver)})` : sql``;
  const office = f.office.length ? sql`and exists (select 1 from driver_profiles dp where dp.user_id = n.user_id and dp.office_id in (${list(f.office)}))` : sql``;
  const [s, m] = await Promise.all([
    rows<Row>(sql`
      select ${twinSelect(f, { warnings: (w) => only(w, "cancel_warning"), suspensions: (w) => only(w, "cancel_suspended") })}
      from notifications n where n.type in ('cancel_warning','cancel_suspended') and ${anyWindow(f, "n.created_at")} ${drivers} ${office}`),
    money ? rows<Row>(sql`
      select ${twinSelect(f, { cents: (w) => sql`coalesce(sum(ledger_entries.available_delta_cents) filter (where ${w("ledger_entries.created_at")}), 0)::float8` })}
      from ledger_entries join requests on requests.id = ledger_entries.request_id
      where ledger_entries.kind = 'release_reserve' and (ledger_entries.idempotency_key like 'cancel-release:%' or ledger_entries.idempotency_key like 'allornothing-release:%')
        and ${scope(f, "requests")} and ${anyWindow(f, "ledger_entries.created_at")}`) : Promise.resolve(null),
  ]);
  const warnings = twinRead(s[0], "warnings"), suspensions = twinRead(s[0], "suspensions");
  return {
    warnings, suspensions, strikes: { cur: (warnings.cur ?? 0) + (suspensions.cur ?? 0), prev: warnings.prev == null ? null : (warnings.prev ?? 0) + (suspensions.prev ?? 0) },
    refunds: m ? twinRead(m[0], "cents") : null,
  };
}
