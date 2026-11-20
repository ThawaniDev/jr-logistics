import { and, asc, count, eq, ilike, isNull, or, sql, type SQL } from "drizzle-orm";
import { db } from "@/db";
import { offers, shipments, users, type Shipment, type User } from "@/db/schema";
import { err } from "@/lib/errors";
import { contains } from "@/lib/sql";
import { audit } from "./audit";
import { requirePerm } from "./auth/permissions";
import { SHIPMENT_STATUS } from "./catalog";
import { loadOrder, isoOrNull, maskPhone, moneyAccess, num, rowsOf } from "./details-orders";
import { secBetween } from "./details-orders-lib";
import { toCsv } from "./ops";

export interface ParcelFilter { status?: string; offerId?: string; city?: string; q?: string; cod?: boolean; incomplete?: boolean; page?: number; pageSize?: number }
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function filterOf(requestId: string, f: ParcelFilter): SQL | undefined {
  const status = (f.status ?? "").split(",").filter((s) => (SHIPMENT_STATUS as readonly string[]).includes(s));
  return and(
    eq(shipments.requestId, requestId),
    status.length ? sql`${shipments.status} in (${sql.join(status.map((s) => sql`${s}`), sql`, `)})` : undefined,
    f.offerId === "none" ? isNull(shipments.offerId) : f.offerId && UUID.test(f.offerId) ? eq(shipments.offerId, f.offerId) : undefined,
    f.city ? eq(shipments.city, f.city) : undefined,
    f.cod ? sql`${shipments.codCents} > 0` : undefined,
    f.incomplete ? sql`${shipments.detailsComplete} = false` : undefined,
    f.q?.trim() ? or(ilike(shipments.code, contains(f.q)), ilike(shipments.externalRef, contains(f.q)), ilike(shipments.recipientName, contains(f.q)), ilike(shipments.recipientPhone, contains(f.q)), ilike(shipments.address, contains(f.q))) : undefined,
  );
}

/** One manifest row. Recipient phones follow the `drivers.sensitive` rule; cash amounts are shown as the old manifest did (to everyone who may open the order). */
function rowOf(s: Shipment, driver: string | null, sensitive: boolean) {
  const end = s.deliveredAt ?? s.failedAt;
  return {
    id: s.id, seq: s.seq, code: s.code, externalRef: s.externalRef, recipientType: s.recipientType, recipientName: s.recipientName, recipientPhone: sensitive ? s.recipientPhone : maskPhone(s.recipientPhone),
    address: s.address, city: s.city, located: s.lat != null && s.lng != null, status: s.status, offerId: s.offerId, driverName: driver, attempts: s.attempts, deferCount: s.deferCount, stopOrder: s.stopOrder,
    proofType: s.proofType, hasProof: !!s.proofKey, receiverName: s.receiverName, codCents: s.codCents, codCollectedCents: s.codCollectedCents, codCollectedAt: isoOrNull(s.codCollectedAt),
    loadedAt: isoOrNull(s.loadedAt), loadedVia: s.loadedVia, arrivedAt: isoOrNull(s.arrivedAt), deliveredAt: isoOrNull(s.deliveredAt), failedAt: isoOrNull(s.failedAt), returnedAt: isoOrNull(s.returnedAt),
    dwellS: secBetween(s.arrivedAt, end), failReason: s.failReason, failNote: s.failNote, deliveredDistanceM: s.deliveredDistanceM, detailsComplete: s.detailsComplete, partnerId: s.partnerId, partnerStatus: s.partnerStatus,
  };
}
const select = () => db.select({ s: shipments, d: users.name }).from(shipments).leftJoin(offers, eq(offers.id, shipments.offerId)).leftJoin(users, eq(users.id, offers.driverId));

/** The order's manifest: filtered, paged (server side) and with the counts the filter bar needs (status, cities, drivers — always for the whole order). */
export async function orderParcels(user: User, id: string, f: ParcelFilter) {
  const r = await loadOrder(user, id);
  const pageSize = Math.min(Math.max(f.pageSize ?? 50, 1), 100), page = Math.max(f.page ?? 1, 1), where = filterOf(r.id, f), sensitive = moneyAccess(user).sensitive;
  const [rows, [{ total }], byStatus, cities, drivers, [flags]] = await Promise.all([
    select().where(where).orderBy(asc(shipments.seq)).limit(pageSize).offset((page - 1) * pageSize),
    db.select({ total: count() }).from(shipments).where(where),
    rowsOf(sql`select status, count(*)::int n from shipments where request_id = ${r.id}::uuid group by status`),
    rowsOf(sql`select city, count(*)::int n from shipments where request_id = ${r.id}::uuid group by city order by n desc, city limit 50`),
    rowsOf(sql`select s.offer_id, u.name, o.status, count(*)::int n from shipments s left join offers o on o.id = s.offer_id left join users u on u.id = o.driver_id where s.request_id = ${r.id}::uuid group by s.offer_id, u.name, o.status order by n desc limit 100`),
    rowsOf(sql`select count(*) filter (where cod_cents > 0)::int cod, count(*) filter (where not details_complete)::int incomplete from shipments where request_id = ${r.id}::uuid`),
  ]);
  return {
    page, pageSize, total: Number(total), items: rows.map(({ s, d }) => rowOf(s, d, sensitive)),
    counts: Object.fromEntries(byStatus.map((x) => [x.status, num(x.n)])), cities: cities.map((c) => ({ city: c.city, n: num(c.n) })),
    drivers: drivers.map((d) => ({ offerId: d.offer_id, name: d.name ?? null, status: d.status ?? null, n: num(d.n) })), withCod: num(flags?.cod), incomplete: num(flags?.incomplete),
  };
}

export const MANIFEST_CSV_COLUMNS = ["seq", "code", "externalRef", "recipientType", "recipientName", "recipientPhone", "address", "city", "status", "driver", "attempts", "deferCount", "stopOrder", "proofType", "codDue", "codCollected", "loadedAt", "arrivedAt", "deliveredAt", "failedAt", "returnedAt", "dwellMin", "failReason", "failNote", "pinDistanceM", "detailsComplete", "partnerStatus"] as const;
const CSV_MAX = 5000;
/** The filtered manifest as a CSV (every matching parcel up to 5 000, all columns). Needs `reports.export`; audited like the other exports. */
export async function orderParcelsCsv(user: User, id: string, f: ParcelFilter) {
  requirePerm(user, "reports.export");
  const r = await loadOrder(user, id);
  const sensitive = moneyAccess(user).sensitive;
  const rows = await select().where(filterOf(r.id, f)).orderBy(asc(shipments.seq)).limit(CSV_MAX + 1);
  if (rows.length > CSV_MAX) throw err("VALIDATION", `More than ${CSV_MAX} parcels match — narrow the filter`, { field: "q" });
  await audit(user, "report.export", "request", r.id, { report: "order_manifest", rows: rows.length, filter: { status: f.status, offerId: f.offerId, city: f.city, q: f.q, cod: f.cod, incomplete: f.incomplete } });
  const out = rows.map(({ s, d }) => { const v = rowOf(s, d, sensitive); return { ...v, driver: d, codDue: v.codCents / 100, codCollected: v.codCollectedCents == null ? "" : v.codCollectedCents / 100, dwellMin: v.dwellS == null ? "" : Math.round(v.dwellS / 60), pinDistanceM: v.deliveredDistanceM }; });
  return { csv: "﻿" + toCsv([...MANIFEST_CSV_COLUMNS], out), rows: out.length, ref: r.ref };
}
