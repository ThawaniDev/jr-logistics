import { sql, type SQL } from "drizzle-orm";
import { offers, settlements } from "@/db/schema";
import { BILLED, inWindow, NOT_DRAFT, PARCEL_OUTCOME_AT, scope } from "./conditions";
import type { ResolvedFilters } from "./filters";
import { num, rows } from "./guard";
import { KEPT } from "./drivers-lib";
import { FLEET, haversineSql, stepOk, validPin } from "./fleet-lib";
import type { DailyKind } from "./fleet-daily-sql";

/**
 * Row-level queries of the fleet tables: one row per job (an offer a driver accepted and kept), per settlement and per failure reason. Each returns one page (`total_n` is a window count,
 * so the filters run once) and is bounded by the period. `kind = "offices"` counts only work done through an office. Never alias `offers`, `requests`, `shipments`, `settlements`.
 */
type Row = Record<string, unknown>;
const mins = (x: SQL) => sql`round((${x} / 60.0)::numeric, 2)::float8`;
const step = (a: SQL, b: SQL, max = FLEET.maxStepSec) => sql`case when ${stepOk(a, b, max)} then ${mins(sql`extract(epoch from (${b} - ${a}))`)} end`;
const oo = (kind: DailyKind) => (kind === "offices" ? sql` and offers.office_id is not null` : sql``);
const COMPANY = sql`coalesce(business_profiles.company_name, bu.name)`;

async function page(q: SQL, offset: number, count: SQL): Promise<{ rows: Row[]; total: number }> {
  const list = await rows<Row>(q);
  // an empty page past the end has no window count to read: ask for it
  const total = list.length ? num(list[0].total_n) : offset > 0 ? num((await rows<Row>(count))[0]?.n) : 0;
  return { rows: list.map(({ total_n: _t, ...r }) => r), total };
}

/** One row per kept job accepted in the period, with its warehouse times, parcel outcomes, distance, cash and earning (money only with `finance.view`). */
export async function jobRows(f: ResolvedFilters, money: boolean, kind: DailyKind, limit: number, offset: number, order: SQL) {
  const where = sql`${scope(f, "offers")}${oo(kind)} and ${KEPT} and ${inWindow(offers.acceptedAt, f.cur)}`;
  const radius = haversineSql(sql`requests.pickup_lat`, sql`requests.pickup_lng`, sql`coalesce(shipments.delivered_lat, shipments.lat)`, sql`coalesce(shipments.delivered_lng, shipments.lng)`);
  const from = sql`from offers join requests on requests.id = offers.request_id join users du on du.id = offers.driver_id join users bu on bu.id = requests.business_id
      left join business_profiles on business_profiles.user_id = bu.id left join users ou on ou.id = offers.office_id left join office_profiles on office_profiles.user_id = ou.id`;
  const q = sql`
    select j.*, count(*) over ()::int as total_n from (
      select offers.id, requests.id as "requestId", requests.ref, ${COMPANY} as company, offers.driver_id as "driverId", du.name as driver, coalesce(office_profiles.office_name, ou.name, 'direct') as office,
        requests.starts_at as "startsAt", offers.arrived_at as "arrivedAt",
        case when offers.arrived_at is not null then ${mins(sql`greatest(0, extract(epoch from (offers.arrived_at - requests.starts_at)))`)} end as "lateMin",
        ${step(sql`offers.arrived_at`, sql`offers.loaded_at`)} as "waitMin", ${step(sql`coalesce(offers.attendance_at, offers.arrived_at)`, sql`offers.loaded_at`)} as "loadMin",
        ${step(sql`offers.loaded_at`, sql`offers.route_approved_at`)} as "planMin", offers.expected_units as expected,
        coalesce(p.delivered, 0) as delivered, coalesce(p.failed, 0) as failed, coalesce(p.returned, 0) as returned, round(p.radius_m::numeric)::float8 as "radiusM", offers.status,
        ${money ? sql`p.cod_collected as "codCollectedCents", (select sum(cod_remittances.amount_cents) from cod_remittances where cod_remittances.offer_id = offers.id)::float8 as "codRemittedCents", settlements.provider_cents::float8 as "earnCents"` : sql`null::float8 as "codCollectedCents", null::float8 as "codRemittedCents", null::float8 as "earnCents"`}
      ${from}${money ? sql` left join settlements on settlements.offer_id = offers.id` : sql``}
        left join lateral (select count(*) filter (where shipments.status = 'delivered')::int as delivered, count(*) filter (where shipments.status = 'failed')::int as failed, count(*) filter (where shipments.status = 'returned')::int as returned,
          sum(${radius}) filter (where shipments.status = 'delivered' and ${validPin(sql`requests.pickup_lat`, sql`requests.pickup_lng`)} and ${validPin(sql`coalesce(shipments.delivered_lat, shipments.lat)`, sql`coalesce(shipments.delivered_lng, shipments.lng)`)})::float8 as radius_m,
          sum(shipments.cod_collected_cents)::float8 as cod_collected from shipments where shipments.offer_id = offers.id) p on true
      where ${where}
    ) j order by ${order} limit ${limit} offset ${offset}`;
  return page(q, offset, sql`select count(*)::int as n ${from} where ${where}`);
}

/** One row per billed settlement created in the period (courier offices: the ones paid to an office). */
export async function earningRows(f: ResolvedFilters, kind: DailyKind, limit: number, offset: number, order: SQL) {
  const where = sql`${scope(f, "settlements")}${kind === "offices" ? sql` and settlements.office_id is not null` : sql``} and ${BILLED} and ${inWindow(settlements.createdAt, f.cur)}`;
  const from = sql`from settlements join requests on requests.id = settlements.request_id join users du on du.id = settlements.driver_id join users bu on bu.id = requests.business_id
      left join business_profiles on business_profiles.user_id = bu.id left join users ou on ou.id = settlements.office_id left join office_profiles on office_profiles.user_id = ou.id`;
  const q = sql`
    select e.*, count(*) over ()::int as total_n from (
      select settlements.id, requests.id as "requestId", requests.ref, ${COMPANY} as company, settlements.driver_id as "driverId", du.name as driver, coalesce(office_profiles.office_name, ou.name, 'direct') as office,
        settlements.customer_cents::float8 as "customerCents", settlements.provider_cents::float8 as "earnCents", settlements.margin_cents::float8 as "marginCents", settlements.vat_cents::float8 as "vatCents",
        settlements.refund_cents::float8 as "refundCents", settlements.status, settlements.created_at as "createdAt", settlements.paid_at as "paidAt"
      ${from} where ${where}
    ) e order by ${order} limit ${limit} offset ${offset}`;
  return page(q, offset, sql`select count(*)::int as n ${from} where ${where}`);
}

/** Failed and returned parcels of the period by reason: how many, their share and how many drivers were affected (a parcel counts once, at its outcome time). */
export async function failureRows(f: ResolvedFilters, kind: DailyKind, limit: number, offset: number, order: SQL) {
  const q = sql`
    select x.*, count(*) over ()::int as total_n from (
      select coalesce(shipments.fail_reason, 'unknown') as id, coalesce(shipments.fail_reason, 'unknown') as reason, count(*)::int as count,
        count(*)::float8 / nullif(sum(count(*)) over (), 0) as share, count(distinct offers.driver_id)::int as drivers
      from shipments join requests on requests.id = shipments.request_id join offers on offers.id = shipments.offer_id
      where ${scope(f, "shipments")}${oo(kind)} and ${NOT_DRAFT} and shipments.status in ('failed','returned') and ${inWindow(PARCEL_OUTCOME_AT, f.cur)} group by 1
    ) x order by ${order} limit ${limit} offset ${offset}`;
  return page(q, offset, sql`select 0 as n`);
}
