import { sql, type SQL } from "drizzle-orm";
import type { User } from "@/db/schema";
import { audit } from "./audit";
import { can, requirePerm } from "./auth/permissions";
import { requireCompanyView } from "./companies-admin";
import { maskPhone } from "./account-admin-rules";
import { num, rows } from "./analytics/guard";
import { addDays, dayStart, isYmd } from "./analytics/time";
import { toCsv } from "./ops";
import { likeEscape } from "@/lib/sql";
import { loadCompany } from "./details-companies";

type Row = Record<string, unknown>;
const STATUSES = ["pending", "loaded", "delivered", "failed", "returned", "missing", "cancelled"];
const PAGE_MAX = 100, CSV_MAX = 5000;
const iso = (v: unknown) => (v ? new Date(v as string).toISOString() : "");
export interface ParcelFilter { status?: string; city?: string; q?: string; from?: string; to?: string; cod?: "yes" | "no"; page?: number; pageSize?: number }

/** The WHERE of one company's parcels. `withStatus: false` leaves the status out so the status chips can show the counts of the OTHER filters. */
function filterSql(id: string, f: ParcelFilter, withStatus: boolean): SQL {
  const c: SQL[] = [sql`requests.business_id = ${id}`];
  if (withStatus && f.status && STATUSES.includes(f.status)) c.push(sql`shipments.status = ${f.status}`);
  if (f.city) c.push(sql`shipments.city = ${f.city}`);
  if (f.from && isYmd(f.from)) c.push(sql`shipments.created_at >= ${dayStart(f.from).toISOString()}::timestamptz`);
  if (f.to && isYmd(f.to)) c.push(sql`shipments.created_at < ${dayStart(addDays(f.to, 1)).toISOString()}::timestamptz`);
  if (f.cod === "yes") c.push(sql`shipments.cod_cents > 0`); else if (f.cod === "no") c.push(sql`shipments.cod_cents = 0`);
  const q = f.q?.trim();
  if (q) { const l = `%${likeEscape(q)}%`; c.push(sql`(shipments.code ilike ${l} or shipments.external_ref ilike ${l} or shipments.recipient_name ilike ${l} or shipments.recipient_phone ilike ${l} or requests.ref ilike ${l})`); }
  return sql.join(c, sql` and `);
}

/** Parcel analytics of a company under the same filters as the list: counts by status, success and first-attempt rates, average attempts, COD, top failure reasons. */
async function parcelAnalytics(id: string, f: ParcelFilter, money: boolean) {
  const where = filterSql(id, f, false);
  const [byStatus, [k], reasons, cities] = await Promise.all([
    rows<Row>(sql`select shipments.status as k, count(*)::int as n from shipments join requests on requests.id = shipments.request_id where ${where} group by 1`),
    rows<Row>(sql`select count(*)::int as total,
        count(*) filter (where shipments.status = 'delivered')::int as delivered, count(*) filter (where shipments.status in ('failed','returned'))::int as lost,
        count(*) filter (where shipments.status = 'delivered' and shipments.attempts <= 1)::int as first_attempt,
        avg(shipments.attempts) filter (where shipments.status in ('delivered','failed','returned'))::float8 as avg_attempts,
        avg(extract(epoch from (shipments.delivered_at - shipments.created_at))) filter (where shipments.status = 'delivered' and shipments.delivered_at is not null)::float8 as avg_secs,
        ${money ? sql`coalesce(sum(shipments.cod_cents) filter (where shipments.cod_cents > 0), 0)::float8` : sql`null`} as cod_expected,
        ${money ? sql`coalesce(sum(shipments.cod_collected_cents), 0)::float8` : sql`null`} as cod_collected,
        ${money ? sql`count(*) filter (where shipments.cod_cents > 0)::int` : sql`null`} as cod_parcels
      from shipments join requests on requests.id = shipments.request_id where ${where}`),
    rows<Row>(sql`select coalesce(shipments.fail_reason, 'other') as k, count(*)::int as n from shipments join requests on requests.id = shipments.request_id
      where ${where} and shipments.status in ('failed','returned') group by 1 order by n desc limit 8`),
    rows<Row>(sql`select shipments.city as k, count(*)::int as n, count(*) filter (where shipments.status = 'delivered')::int as delivered, count(*) filter (where shipments.status in ('failed','returned'))::int as lost
      from shipments join requests on requests.id = shipments.request_id where ${where} group by 1 order by n desc limit 8`),
  ]);
  const total = num(k?.total), delivered = num(k?.delivered), lost = num(k?.lost);
  return {
    total, byStatus: Object.fromEntries(byStatus.map((r) => [String(r.k), num(r.n)])),
    successRate: delivered + lost > 0 ? delivered / (delivered + lost) : null, firstAttemptRate: delivered > 0 ? num(k?.first_attempt) / delivered : null,
    avgAttempts: k?.avg_attempts == null ? null : num(k.avg_attempts), avgDeliverySecs: k?.avg_secs == null ? null : num(k.avg_secs),
    cod: money ? { parcels: num(k?.cod_parcels), expectedCents: num(k?.cod_expected), collectedCents: num(k?.cod_collected) } : null,
    failureReasons: reasons.map((r) => ({ key: String(r.k), value: num(r.n) })),
    cities: cities.map((r) => ({ key: String(r.k), total: num(r.n), delivered: num(r.delivered), lost: num(r.lost) })),
  };
}

const COLS = sql`shipments.id, shipments.code, shipments.external_ref, shipments.status, shipments.recipient_name, shipments.recipient_phone, shipments.city, shipments.address,
  shipments.cod_cents, shipments.cod_collected_cents, shipments.attempts, shipments.fail_reason, shipments.created_at, shipments.delivered_at, shipments.request_id, requests.ref as request_ref,
  offers.driver_id, drv.name as driver_name`;
const FROM = sql`from shipments join requests on requests.id = shipments.request_id left join offers on offers.id = shipments.offer_id left join users drv on drv.id = offers.driver_id`;

function view(r: Row, sens: boolean, money: boolean) {
  return {
    id: String(r.id), code: String(r.code), externalRef: (r.external_ref as string | null) ?? null, status: String(r.status), recipientName: String(r.recipient_name), recipientPhone: sens ? String(r.recipient_phone) : maskPhone(String(r.recipient_phone)),
    city: String(r.city), address: sens ? String(r.address) : null, attempts: num(r.attempts), failReason: (r.fail_reason as string | null) ?? null, createdAt: iso(r.created_at) || null, deliveredAt: iso(r.delivered_at) || null,
    codCents: money ? num(r.cod_cents) : null, codCollectedCents: money && r.cod_collected_cents != null ? num(r.cod_collected_cents) : null,
    request: { id: String(r.request_id), ref: String(r.request_ref) }, driver: r.driver_id ? { id: String(r.driver_id), name: String(r.driver_name ?? "") } : null,
  };
}

/** One page of the company's parcels with its analytics (`requests.view`; recipient phone and address follow `drivers.sensitive`, COD amounts need `cod.manage` or `finance.view`). */
export async function companyParcels(viewer: User, id: string, f: ParcelFilter) {
  requireCompanyView(viewer); requirePerm(viewer, "requests.view");
  await loadCompany(id);
  const sens = can(viewer, "drivers.sensitive"), money = can(viewer, "cod.manage") || can(viewer, "finance.view");
  const pageSize = Math.min(Math.max(f.pageSize ?? 25, 1), PAGE_MAX), page = Math.max(f.page ?? 1, 1);
  const where = filterSql(id, f, true);
  const [list, [{ n }], analytics, cityOptions] = await Promise.all([
    rows<Row>(sql`select ${COLS} ${FROM} where ${where} order by shipments.created_at desc, shipments.id limit ${pageSize} offset ${(page - 1) * pageSize}`),
    rows<Row>(sql`select count(*)::int as n from shipments join requests on requests.id = shipments.request_id where ${where}`),
    parcelAnalytics(id, f, money),
    rows<Row>(sql`select distinct shipments.city as k from shipments join requests on requests.id = shipments.request_id where requests.business_id = ${id} order by 1 limit 60`),
  ]);
  return { items: list.map((r) => view(r, sens, money)), page, pageSize, total: num(n), analytics, cities: cityOptions.map((c) => String(c.k)), moneyHidden: !money, sensitiveHidden: !sens };
}

/** The same filtered list as CSV (up to 5 000 rows; `reports.export`; audited as `report.export`). */
export async function companyParcelsCsv(viewer: User, id: string, f: ParcelFilter) {
  requireCompanyView(viewer); requirePerm(viewer, "requests.view"); requirePerm(viewer, "reports.export");
  await loadCompany(id);
  const sens = can(viewer, "drivers.sensitive"), money = can(viewer, "cod.manage") || can(viewer, "finance.view");
  const list = await rows<Row>(sql`select ${COLS} ${FROM} where ${filterSql(id, f, true)} order by shipments.created_at desc, shipments.id limit ${CSV_MAX}`, 30_000);
  await audit(viewer, "report.export", "company", id, { report: "company_parcels", rows: list.length, status: f.status ?? null });
  const cols = ["code", "externalRef", "status", "recipientName", "recipientPhone", "city", "attempts", "failReason", "codCents", "codCollectedCents", "createdAt", "deliveredAt", "order", "driver"];
  const out = list.map((r) => { const v = view(r, sens, money); return { ...v, createdAt: v.createdAt ?? "", deliveredAt: v.deliveredAt ?? "", order: v.request.ref, driver: v.driver?.name ?? "" }; });
  return { csv: "﻿" + toCsv(cols, out), rows: out.length };
}
