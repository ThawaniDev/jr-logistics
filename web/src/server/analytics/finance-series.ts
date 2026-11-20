import { sql } from "drizzle-orm";
import { settlements } from "@/db/schema";
import { SERVICES } from "../catalog";
import { anyWindow, BILLED, inWindow, scope, twinRead, twinSelect } from "./conditions";
import { bucketOf, buildSeries, MIN_VOLUME, type Row } from "./finance-core";
import type { ResolvedFilters } from "./filters";
import { num, rows } from "./guard";
import { SETTLE_FROM } from "./finance-facts";
import { namesOf } from "./finance-core";

const SERVICE_KEYS = SERVICES.map((s) => s.key);
export const MONEY_FIELDS = ["billed", "vat", "provider", "margin", "office", "direct"] as const;
export const SERVICE_FIELDS = SERVICE_KEYS.map((k) => `s_${k}`);
const sum = (col: string, cond?: string) => sql`coalesce(sum(${sql.raw(col)})${cond ? sql` filter (where ${sql.raw(cond)})` : sql``}, 0)::float8`;

/** Billed amount, VAT, provider cost, margin and the payee split per bucket on the day the settlement was created, plus the billed amount of each service (`s_<service>`). */
export const moneySeries = (f: ResolvedFilters) => buildSeries(f, [...MONEY_FIELDS, ...SERVICE_FIELDS], (w) => sql`
  select ${bucketOf(settlements.createdAt, f)} as t, ${sum("settlements.customer_cents")} as billed, ${sum("settlements.vat_cents")} as vat, ${sum("settlements.provider_cents")} as provider, ${sum("settlements.margin_cents")} as margin,
    ${sum("settlements.provider_cents", "settlements.office_id is not null")} as office, ${sum("settlements.provider_cents", "settlements.office_id is null")} as direct,
    ${sql.join(SERVICE_KEYS.map((k) => sql`${sum("settlements.customer_cents", `requests.service = '${k}'`)} as ${sql.raw(`s_${k}`)}`), sql`, `)}
  ${SETTLE_FROM} where ${scope(f, "settlements")} and ${BILLED} and ${inWindow(settlements.createdAt, w)} group by 1`);

export const PIPE_FIELDS = ["created", "paid"] as const;
/** Settlements created and settlements paid per bucket (each on its own day). */
export const pipelineSeries = (f: ResolvedFilters) => buildSeries(f, [...PIPE_FIELDS], (w) => sql`
  select t, sum(created)::int as created, sum(paid)::int as paid from (
    select ${bucketOf(settlements.createdAt, f)} as t, count(*)::int as created, 0 as paid ${SETTLE_FROM} where ${scope(f, "settlements")} and ${BILLED} and ${inWindow(settlements.createdAt, w)} group by 1
    union all
    select ${bucketOf(settlements.paidAt, f)} as t, 0, count(*)::int ${SETTLE_FROM} where ${scope(f, "settlements")} and settlements.status = 'paid' and ${inWindow(settlements.paidAt, w)} group by 1) x group by t`);

export interface MarginRow { dim: "city" | "service" | "vehicle"; key: string; billed: number; prevBilled: number | null; provider: number; margin: number; vat: number; n: number }
/** Billed amount, provider cost, margin and VAT by city, service and vehicle type (current period; billed also for the comparison period). */
export async function marginBreakdowns(f: ResolvedFilters): Promise<MarginRow[]> {
  const base = sql`select requests.delivery_city::text as city, requests.service::text as service, coalesce(requests.vehicle_type, '') as vehicle, settlements.customer_cents as billed, settlements.provider_cents as provider,
      settlements.margin_cents as margin, settlements.vat_cents as vat, settlements.created_at as created_at ${SETTLE_FROM} where ${scope(f, "settlements")} and ${BILLED} and ${anyWindow(f, settlements.createdAt)}`;
  const twin = twinSelect(f, {
    billed: (w) => sql`coalesce(sum(billed) filter (where ${w("created_at")}), 0)::float8`, provider: (w) => sql`coalesce(sum(provider) filter (where ${w("created_at")}), 0)::float8`,
    margin: (w) => sql`coalesce(sum(margin) filter (where ${w("created_at")}), 0)::float8`, vat: (w) => sql`coalesce(sum(vat) filter (where ${w("created_at")}), 0)::float8`,
    n: (w) => sql`count(*) filter (where ${w("created_at")})::int`,
  });
  const branch = (d: string) => sql`select ${sql.raw(`'${d}'`)} as dim, ${sql.raw(d)} as k, ${twin} from base group by ${sql.raw(d)}`;
  const r = await rows<Row>(sql`with base as (${base}) select * from (${sql.join(["city", "service", "vehicle"].map(branch), sql` union all `)}) x where n_c > 0 or billed_c > 0 order by billed_c desc, k`);
  return r.map((x) => ({ dim: x.dim as MarginRow["dim"], key: String(x.k), billed: num(x.billed_c), prevBilled: f.prev ? twinRead(x, "billed").prev ?? 0 : null, provider: num(x.provider_c), margin: num(x.margin_c), vat: num(x.vat_c), n: num(x.n_c) }));
}

export interface CompanyRow { id: string; name: string | null; billed: number; prevBilled: number | null; provider: number; margin: number; vat: number; n: number }
/** The companies with the largest billed amount of either period (up to 200), with the previous period alongside: the base of the concentration, the ranking and the margin outliers. */
export async function companyMargins(f: ResolvedFilters): Promise<CompanyRow[]> {
  const twin = twinSelect(f, {
    billed: (w) => sql`coalesce(sum(settlements.customer_cents) filter (where ${w(settlements.createdAt)}), 0)::float8`, provider: (w) => sql`coalesce(sum(settlements.provider_cents) filter (where ${w(settlements.createdAt)}), 0)::float8`,
    margin: (w) => sql`coalesce(sum(settlements.margin_cents) filter (where ${w(settlements.createdAt)}), 0)::float8`, vat: (w) => sql`coalesce(sum(settlements.vat_cents) filter (where ${w(settlements.createdAt)}), 0)::float8`,
    n: (w) => sql`count(*) filter (where ${w(settlements.createdAt)})::int`,
  });
  const order = f.prev ? sql`greatest(billed_c, billed_p)` : sql`billed_c`;
  const r = await rows<Row>(sql`select * from (
      select settlements.business_id::text as id, ${twin} ${SETTLE_FROM} where ${scope(f, "settlements")} and ${BILLED} and ${anyWindow(f, settlements.createdAt)} group by settlements.business_id) x
    order by ${order} desc, id limit 200`);
  const names = await namesOf(r.map((x) => String(x.id)));
  return r.map((x) => ({ id: String(x.id), name: names.get(String(x.id)) ?? null, billed: num(x.billed_c), prevBilled: f.prev ? twinRead(x, "billed").prev ?? 0 : null, provider: num(x.provider_c), margin: num(x.margin_c), vat: num(x.vat_c), n: num(x.n_c) }));
}
export { MIN_VOLUME };
