import { sql, type SQL } from "drizzle-orm";
import { err } from "@/lib/errors";
import type { User } from "@/db/schema";
import { can } from "./auth/permissions";
import { OFFER_BUSY } from "./catalog";
import { inWindow, PARCEL_OUTCOME_AT } from "./analytics/conditions";
import { num } from "./analytics/guard";
import type { Twin } from "./details-people-kpis";
import type { PeriodInfo } from "./details-people-lib";

/** SQL building blocks shared by the driver and office detail queries (`details-people*.ts`). Tables are NOT aliased: `offers`, `requests`, `shipments`, `settlements` appear by name. */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** A path id that is not a uuid is the same 404 as one that does not exist. */
export const idOf = (id: string) => { if (!UUID.test(id)) throw err("NOT_FOUND"); return id; };
export const hasAnyPerm = (u: Pick<User, "role" | "permissions">, perms: readonly string[]) => perms.some((p) => can(u, p as never));

export type Col = SQL | { _: unknown } | string;
export const list = (xs: readonly string[]) => sql.join(xs.map((x) => sql`${x}`), sql`, `);
export const BUSY = list(OFFER_BUSY);
/** When a job was finished (the offer's completion time; falls back to its last update for old rows). */
export const COMPLETED_AT = sql`coalesce(offers.final_at, offers.delivered_at, offers.updated_at)`;
/** When a no-show / cancellation was recorded. */
export const STOPPED_AT = sql`coalesce(offers.cancelled_at, offers.updated_at)`;
/** When a driver started a job: arrival at the warehouse, or the confirmed attendance when the arrival was never recorded. */
export const BUSY_START = sql`coalesce(offers.arrived_at, offers.attendance_at)`;
/** The end of the time a driver was on a job: delivery / completion / cancellation, or now while the job is still running. */
export const BUSY_END = sql`coalesce(offers.delivered_at, offers.final_at, offers.cancelled_at, case when offers.status in (${BUSY}) then now() else offers.updated_at end)`;
/** Offers that count as "the driver was offered work and answered": accepted, declined or expired (driver applications are not offers to the driver). */
export const DECIDED = sql`(offers.source <> 'apply' and (offers.accepted_at is not null or offers.status in ('rejected','expired')))`;
export const OUTCOME_AT = PARCEL_OUTCOME_AT;
/** Seconds between an offer being sent and being accepted (system offers only: manual / office assignments have no waiting). */
export const RESPONSE_S = sql`extract(epoch from (offers.accepted_at - offers.created_at))`;
export const RESPONDED = sql`(offers.source in ('system','replacement') and offers.accepted_at is not null and offers.accepted_at >= offers.created_at)`;
/** Display name of the business behind a request (company name, falling back to the account name). Needs `bp` and `bu` joins. */
export const BUSINESS_NAME = sql`coalesce(bp.company_name, bu.name)`;
export const BUSINESS_JOIN = sql`left join business_profiles bp on bp.user_id = requests.business_id left join users bu on bu.id = requests.business_id`;

/** `<name>_c` for the current period and `<name>_p` for the comparison period, from one pass over the table. */
export function twin(p: PeriodInfo, metrics: Record<string, (w: (c: Col) => SQL) => SQL>): SQL {
  const parts: SQL[] = [];
  for (const [name, m] of Object.entries(metrics)) {
    if (!/^[a-z][a-z0-9_]*$/.test(name)) throw new Error(`twin: metric name "${name}" must be lower snake_case`);
    parts.push(sql`${m((c) => inWindow(c, p.cur))} as ${sql.raw(`${name}_c`)}`);
    if (p.prev) { const pv = p.prev; parts.push(sql`${m((c) => inWindow(c, pv))} as ${sql.raw(`${name}_p`)}`); }
  }
  return sql.join(parts, sql`, `);
}
/** The current OR the previous window over several time columns: the `where` of a `twin()` query. */
export function anyW(p: PeriodInfo, ...cols: Col[]): SQL {
  const ws = p.prev ? [p.cur, p.prev] : [p.cur];
  return sql`(${sql.join(cols.flatMap((c) => ws.map((w) => inWindow(c, w))), sql` or `)})`;
}
export const T = (row: Record<string, unknown> | undefined, name: string): Twin => {
  const n = (v: unknown) => (v == null || !Number.isFinite(Number(v)) ? null : Number(v));
  return { cur: n(row?.[`${name}_c`]), prev: n(row?.[`${name}_p`]) };
};
/** A count / sum is 0 when nothing happened (never null) in both periods; the comparison stays null without a comparison window. */
export const Z = (t: Twin, hasPrev: boolean): Twin => ({ cur: t.cur ?? 0, prev: hasPrev ? t.prev ?? 0 : null });
export const first = <R extends Record<string, unknown>>(rs: R[]): R | undefined => rs[0];
export { num };
