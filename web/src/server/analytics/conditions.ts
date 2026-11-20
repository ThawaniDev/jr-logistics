import { and, inArray, sql, type SQL } from "drizzle-orm";
import { offers, requests, settlements, shipments, tickets } from "@/db/schema";
import type { ResolvedFilters } from "./filters";
import type { Window } from "./periods";

/**
 * Filters → SQL. Every report query has the shape `from <fact> join requests on requests.id = <fact>.request_id where ${scope(f, "<fact>")} and <time window>`
 * (for `requests` itself there is no join). Column references are table-qualified, so DO NOT alias `requests`, `offers`, `shipments`, `settlements` or `tickets`.
 *
 * Meaning of each filter (stated once, shown in the UI legend):
 *   city     the DELIVERY city of the request (where the work happens)       service / vehicle / channel (`created_via`) / status: the request's own columns
 *   company  the business that ordered (requests.business_id)                office / driver: who carried the work (offers, settlements, parcels via their offer)
 * For `tickets` (which may have no request) company/driver/office match the person who opened it; request-level filters then need a linked request.
 */
export const iso = (d: Date) => d.toISOString();
export const TRUE = sql`true`;
/** AND of the given conditions (skipping undefined); `true` when there is none, so it can always be spliced after `where`. */
export const allOf = (...c: Array<SQL | undefined | false>): SQL => and(...(c.filter(Boolean) as SQL[])) ?? TRUE;
/** `col >= start and col < end` for one window; `col` is a Drizzle column, an SQL fragment or a raw identifier string (constants only, never user input). */
export const inWindow = (col: SQL | { _: unknown } | string, w: Pick<Window, "start" | "end">): SQL => {
  const c = typeof col === "string" ? sql.raw(col) : (col as SQL);
  return sql`(${c} >= ${iso(w.start)}::timestamptz and ${c} < ${iso(w.end)}::timestamptz)`;
};
/** The current window OR the comparison window (when there is one) over several time columns: the `where` of a query that reads both periods in one pass. */
export function anyWindow(f: ResolvedFilters, ...cols: Array<SQL | { _: unknown } | string>): SQL {
  const ws = f.prev ? [f.cur, f.prev] : [f.cur];
  return sql`(${sql.join(cols.flatMap((c) => ws.map((w) => inWindow(c, w))), sql` or `)})`;
}

/** Offers that were never taken up do not count as "the driver worked on it". */
const WORKED = sql`offers.accepted_at is not null`;
const list = (xs: string[]) => sql.join(xs.map((x) => sql`${x}`), sql`, `);

/** Conditions on the request itself (service, delivery city, vehicle, channel, status, company). */
export function requestScope(f: ResolvedFilters, o: { company?: boolean } = {}): SQL[] {
  const c: SQL[] = [];
  if (f.service.length) c.push(inArray(requests.service, f.service));
  if (f.city.length) c.push(inArray(requests.deliveryCity, f.city));
  if (f.vehicle.length) c.push(inArray(requests.vehicleType, f.vehicle));
  if (f.channel.length) c.push(inArray(requests.createdVia, f.channel));
  if (f.status.length) c.push(inArray(requests.status, f.status));
  if (f.company.length && o.company !== false) c.push(inArray(requests.businessId, f.company));
  return c;
}

export type Fact = "requests" | "offers" | "shipments" | "settlements" | "tickets";

/** All filter conditions for one fact table (see the header comment for the required FROM/JOIN shape). */
export function scope(f: ResolvedFilters, fact: Fact): SQL {
  const c = requestScope(f, { company: fact !== "tickets" });
  const has = (k: "driver" | "office") => f[k].length > 0;
  switch (fact) {
    case "requests":
      if (has("driver")) c.push(sql`exists (select 1 from offers where offers.request_id = requests.id and ${WORKED} and offers.driver_id in (${list(f.driver)}))`);
      if (has("office")) c.push(sql`exists (select 1 from offers where offers.request_id = requests.id and ${WORKED} and offers.office_id in (${list(f.office)}))`);
      break;
    case "offers":
      if (has("driver")) c.push(inArray(offers.driverId, f.driver));
      if (has("office")) c.push(inArray(offers.officeId, f.office));
      break;
    case "settlements":
      if (has("driver")) c.push(inArray(settlements.driverId, f.driver));
      if (has("office")) c.push(inArray(settlements.officeId, f.office));
      break;
    case "shipments":
      if (has("driver")) c.push(sql`${shipments.offerId} in (select id from offers where driver_id in (${list(f.driver)}))`);
      if (has("office")) c.push(sql`${shipments.offerId} in (select id from offers where office_id in (${list(f.office)}))`);
      break;
    case "tickets": {
      // The request is a LEFT join here: a request-level filter simply excludes tickets that have no request.
      if (f.company.length) { c.push(sql`(${tickets.openedBy} in (${list(f.company)}) or ${requests.businessId} in (${list(f.company)}))`); }
      if (has("driver")) c.push(inArray(tickets.openedBy, f.driver));
      if (has("office")) c.push(inArray(tickets.openedBy, f.office));
      break;
    }
  }
  return allOf(...c);
}

/** `requests.status <> 'draft'`: a draft was never submitted to the platform, so no report counts it as an order. */
export const NOT_DRAFT = sql`requests.status <> 'draft'`;
/** Settlements that count as billed work (a rejected settlement was reversed). */
export const BILLED = sql`settlements.status <> 'rejected'`;
/**
 * When a parcel's outcome happened: delivery time for a delivered parcel, the failed-delivery time for a failed or returned one (so a parcel counts once, when it was
 * resolved, and a later return does not count it again). Null for parcels still on their way.
 */
export const PARCEL_OUTCOME_AT = sql`(case when shipments.status = 'delivered' then shipments.delivered_at when shipments.status in ('failed','returned') then coalesce(shipments.failed_at, shipments.returned_at, shipments.updated_at) end)`;
/** The filters that cannot narrow a measure (shown on its card so a number is never silently unfiltered). */
export const ignoredFilters = (f: ResolvedFilters, notApplicable: readonly string[]): string[] => f.active.filter((k) => notApplicable.includes(k));

type Col = SQL | { _: unknown } | string;
/** A metric is an aggregate that restricts itself to one window: `(inw) => sql\`count(*) filter (where ${inw(requests.createdAt)})::int\``. */
export type Metric = (inw: (col: Col) => SQL) => SQL;
/**
 * Select-list for reading the current AND the comparison period in ONE pass over the table: every metric becomes `<name>_c` (current) and, when there is a
 * comparison window, `<name>_p` (previous). Pair it with `anyWindow()` in the `where`, and read the row with `twinRead()`.
 */
export function twinSelect(f: ResolvedFilters, metrics: Record<string, Metric>): SQL {
  const parts: SQL[] = [];
  for (const [name, m] of Object.entries(metrics)) {
    // Postgres folds unquoted aliases to lower case, so `onTime_c` would come back as `ontime_c` and read as "no data": names are snake_case by rule.
    if (!/^[a-z][a-z0-9_]*$/.test(name)) throw new Error(`twinSelect: metric name "${name}" must be lower snake_case`);
    parts.push(sql`${m((c) => inWindow(c, f.cur))} as ${sql.raw(`${name}_c`)}`);
    if (f.prev) { const p = f.prev; parts.push(sql`${m((c) => inWindow(c, p))} as ${sql.raw(`${name}_p`)}`); }
  }
  return sql.join(parts, sql`, `);
}
export const twinRead = (row: Record<string, unknown> | undefined, name: string): { cur: number | null; prev: number | null } => {
  const n = (v: unknown) => (v == null || !Number.isFinite(Number(v)) ? null : Number(v));
  return { cur: n(row?.[`${name}_c`]), prev: n(row?.[`${name}_p`]) };
};
