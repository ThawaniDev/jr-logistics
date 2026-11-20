import { sql, type SQL } from "drizzle-orm";
import { codRemittances, settlements, shipments } from "@/db/schema";
import { anyWindow, BILLED, NOT_DRAFT, scope } from "./conditions";
import type { ResolvedFilters } from "./filters";
import { twin } from "./companies-lib";
import { PENDING_STATES } from "./offices-sql";

/**
 * Money pieces of the fleet chain (only built with `finance.view`): settlements (customer price, margin, VAT, refunds, adjustments, paid, still pending), cash on delivery collected,
 * remitted and still held. Settlements by creation (paid by `paid_at`), COD collected by `cod_collected_at`, remitted by the remittance's creation. Never alias the fact tables.
 */
export const SETTLE_COLS = ["customer", "margin", "vat", "refund", "adjust", "paid"] as const;
export const COD_COLS = ["cod_collected", "cod_remitted"] as const;
/** Every money base column of `dx` (plus `earn`, which lives in `dd`); the point-in-time ones have no comparison. */
export const MONEY_BASE = ["earn", ...SETTLE_COLS, "pending", ...COD_COLS, "cod_held"] as const;

/** Settlements grouped by payee: `key` is the SQL expression of the group (`settlements.driver_id`, or the office as text). With `earn` the provider net is included (offices read it here). */
export function settlementsBy(f: ResolvedFilters, key: SQL, officeOnly: boolean, withEarn: boolean): SQL {
  return sql`
    select ${key} as id, ${twin(f, {
      ...(withEarn ? { earn: (w) => sql`coalesce(sum(settlements.provider_cents) filter (where ${w(settlements.createdAt)}), 0)::float8` } : {}),
      customer: (w) => sql`coalesce(sum(settlements.customer_cents) filter (where ${w(settlements.createdAt)}), 0)::float8`,
      margin: (w) => sql`coalesce(sum(settlements.margin_cents) filter (where ${w(settlements.createdAt)}), 0)::float8`,
      vat: (w) => sql`coalesce(sum(settlements.vat_cents) filter (where ${w(settlements.createdAt)}), 0)::float8`,
      refund: (w) => sql`coalesce(sum(settlements.refund_cents) filter (where ${w(settlements.createdAt)}), 0)::float8`,
      adjust: (w) => sql`coalesce(sum(settlements.adjustment_cents) filter (where ${w(settlements.createdAt)}), 0)::float8`,
      paid: (w) => sql`coalesce(sum(settlements.provider_cents) filter (where settlements.status = 'paid' and ${w(settlements.paidAt)}), 0)::float8`,
    })}, coalesce(sum(settlements.provider_cents) filter (where ${PENDING_STATES}), 0)::float8 as pending
    from settlements join requests on requests.id = settlements.request_id
    where ${scope(f, "settlements")}${officeOnly ? sql` and settlements.office_id is not null` : sql``} and ${BILLED} and (${anyWindow(f, settlements.createdAt, settlements.paidAt)} or ${PENDING_STATES}) group by 1`;
}

/** The COD CTEs of `dx` (per driver): collected and remitted in the period, and the lifetime balance still held (collected − remitted, never below 0). */
export function codChain(f: ResolvedFilters, officeOnly: boolean): SQL {
  const oo = officeOnly ? sql` and offers.office_id is not null` : sql``;
  return sql`
  xcod as (
    select offers.driver_id as id, ${twin(f, { cod_collected: (w) => sql`coalesce(sum(shipments.cod_collected_cents) filter (where ${w(shipments.codCollectedAt)}), 0)::float8` })}
    from shipments join requests on requests.id = shipments.request_id join offers on offers.id = shipments.offer_id
    where ${scope(f, "shipments")}${oo} and ${NOT_DRAFT} and shipments.cod_collected_cents is not null and ${anyWindow(f, shipments.codCollectedAt)} group by offers.driver_id
  ),
  xcr as (
    select cod_remittances.driver_id as id, ${twin(f, { cod_remitted: (w) => sql`coalesce(sum(cod_remittances.amount_cents) filter (where ${w(codRemittances.createdAt)}), 0)::float8` })}
    from cod_remittances join offers on offers.id = cod_remittances.offer_id join requests on requests.id = offers.request_id
    where ${scope(f, "offers")}${oo} and ${anyWindow(f, codRemittances.createdAt)} group by cod_remittances.driver_id
  ),
  xh as (
    select h.id, greatest(0, coalesce(sum(h.collected), 0) - coalesce(sum(h.remitted), 0))::float8 as cod_held_c from (
      select offers.driver_id as id, shipments.cod_collected_cents::float8 as collected, 0::float8 as remitted
        from shipments join requests on requests.id = shipments.request_id join offers on offers.id = shipments.offer_id
        where ${scope(f, "shipments")}${oo} and shipments.cod_collected_cents > 0
      union all
      select cod_remittances.driver_id, 0::float8, cod_remittances.amount_cents::float8
        from cod_remittances join offers on offers.id = cod_remittances.offer_id join requests on requests.id = offers.request_id where ${scope(f, "offers")}${oo}
    ) h group by h.id
  )`;
}
