import { sql } from "drizzle-orm";
import { requests } from "@/db/schema";
import { getSettings } from "../settings";
import { inWindow, NOT_DRAFT, scope } from "./conditions";
import { num, rows } from "./guard";
import { cancelEvents } from "./ops-cancel";
import { DRIVEN, FILLED, G_ACCEPT, G_FILL, lateJob, LOADING_S, RESOLVED, SLOTS } from "./ops-sql";
import type { Row } from "./ops-util";
import { defineTable } from "./registry";

/** Drill-down tables of the Operations report (`GET /admin/analytics/operations/table/<name>`, CSV for `reports.export`). */
const REPORT = "operations";
const company = sql`coalesce(bp.company_name, bu.name)`;
const withCompany = sql`join users bu on bu.id = requests.business_id left join business_profiles bp on bp.user_id = requests.business_id`;
const page = async (list: Promise<Row[]>, count: Promise<Row[]>) => { const [r, [t]] = await Promise.all([list, count]); return { rows: r, total: num(t?.n) }; };

/** Jobs that started late or never started (under the start-SLA rule), for requests due to start in the period. */
defineTable({
  report: REPORT, name: "late-jobs", title: "rpo.tbl_late",
  columns: [
    { key: "ref", label: "rpo.col_ref", type: "link", href: "/admin/requests/{requestId}", sub: "company" },
    { key: "driver", label: "rpo.col_driver", type: "text" },
    { key: "deliveryCity", label: "rpo.col_city", type: "enum", ns: "city", phone: false },
    { key: "startsAt", label: "rpo.col_starts", type: "datetime" },
    { key: "arrivedAt", label: "rpo.col_arrived", type: "datetime", phone: false },
    { key: "delayMin", label: "rpo.col_delay_min", type: "number", align: "end" },
    { key: "status", label: "rpo.col_status", type: "status", ns: "status" },
  ],
  sorts: { ref: sql`requests.ref`, driver: sql`driver`, deliveryCity: sql`requests.delivery_city`, startsAt: sql`requests.starts_at`, arrivedAt: sql`offers.arrived_at`, delayMin: sql`delay_min`, status: sql`offers.status` },
  defaultSort: { key: "delayMin", dir: "desc" }, tiebreak: sql`offers.id`,
  async query({ filters: f, limit, offset, order }) {
    const grace = (await getSettings()).lateGraceMin;
    const where = sql`${scope(f, "offers")} and ${DRIVEN} and ${lateJob(grace)} and ${inWindow(requests.startsAt, f.cur)}`;
    const from = sql`from offers join requests on requests.id = offers.request_id ${withCompany} join users du on du.id = offers.driver_id`;
    return page(rows<Row>(sql`
      select offers.id, requests.id as "requestId", requests.ref, ${company} as company, du.name as driver, requests.delivery_city as "deliveryCity", requests.starts_at as "startsAt", offers.arrived_at as "arrivedAt",
        (case when offers.arrived_at is not null then round(extract(epoch from (offers.arrived_at - requests.starts_at)) / 60)::int end) as delay_min, offers.status
      ${from} where ${where} order by ${order} limit ${limit} offset ${offset}`).then((r) => r.map((x) => ({ ...x, delayMin: x.delay_min }))), rows<Row>(sql`select count(*)::int as n ${from} where ${where}`));
  },
});

/** Requests created in the period that did not get all their drivers (expired, called off, or closed with open slots). */
defineTable({
  report: REPORT, name: "unfilled", title: "rpo.tbl_unfilled",
  columns: [
    { key: "ref", label: "rpo.col_ref", type: "link", href: "/admin/requests/{id}", sub: "company" },
    { key: "service", label: "rpo.col_service", type: "enum", ns: "svc", phone: false },
    { key: "deliveryCity", label: "rpo.col_city", type: "enum", ns: "city", phone: false },
    { key: "slots", label: "rpo.col_slots", type: "number", align: "end", phone: false },
    { key: "filled", label: "rpo.col_filled", type: "number", align: "end" },
    { key: "unfilled", label: "rpo.col_unfilled", type: "number", align: "end" },
    { key: "openSecs", label: "rpo.col_open_for", type: "duration", align: "end", phone: false },
    { key: "startsAt", label: "rpo.col_starts", type: "datetime", phone: false },
    { key: "status", label: "rpo.col_status", type: "status", ns: "status" },
  ],
  sorts: { ref: sql`requests.ref`, service: sql`requests.service`, deliveryCity: sql`requests.delivery_city`, slots: sql`slots`, filled: sql`filled`, unfilled: sql`unfilled`, openSecs: sql`open_secs`, startsAt: sql`requests.starts_at`, status: sql`requests.status` },
  defaultSort: { key: "unfilled", dir: "desc" }, tiebreak: sql`requests.id`,
  async query({ filters: f, limit, offset, order }) {
    const where = sql`${scope(f, "requests")} and ${NOT_DRAFT} and ${DRIVEN} and ${RESOLVED} and ${SLOTS} > ${FILLED} and ${inWindow(requests.createdAt, f.cur)}`;
    const from = sql`from requests ${withCompany}`;
    return page(rows<Row>(sql`
      select requests.id, requests.ref, ${company} as company, requests.service, requests.delivery_city as "deliveryCity", ${SLOTS} as slots, ${FILLED} as filled, (${SLOTS} - ${FILLED}) as unfilled,
        (case when requests.published_at is not null then extract(epoch from (least(requests.starts_at, now()) - requests.published_at))::float8 end) as open_secs, requests.starts_at as "startsAt", requests.status
      ${from} where ${where} order by ${order} limit ${limit} offset ${offset}`).then((r) => r.map((x) => ({ ...x, openSecs: x.open_secs }))), rows<Row>(sql`select count(*)::int as n ${from} where ${where}`));
  },
});

/**
 * Cancellations of every kind (requests cancelled, driver cancellations, no-shows, replacements) with party, stage and how long before — or, for an event after the start time, how long
 * after — the start they happened (two columns, never a negative number: the CSV neutralises a leading minus sign).
 */
defineTable({
  report: REPORT, name: "cancellations", title: "rpo.tbl_cancellations",
  columns: [
    { key: "at", label: "rpo.col_when", type: "datetime" },
    { key: "ref", label: "rpo.col_ref", type: "link", href: "/admin/requests/{requestId}", sub: "company" },
    { key: "kind", label: "rpo.col_kind", type: "enum", ns: "rpo.kind", phone: false },
    { key: "party", label: "rpo.col_party", type: "enum", ns: "rpo.party" },
    { key: "stage", label: "rpo.col_stage", type: "enum", ns: "rpo.stage", phone: false },
    { key: "driver", label: "rpo.col_driver", type: "text", phone: false },
    { key: "leadHours", label: "rpo.col_lead_h", type: "number", align: "end", phone: false },
    { key: "afterHours", label: "rpo.col_after_h", type: "number", align: "end", phone: false },
    { key: "reason", label: "rpo.col_reason", type: "text" },
  ],
  sorts: { at: sql`ev.at`, ref: sql`ev.ref`, kind: sql`ev.kind`, party: sql`ev.party`, stage: sql`ev.stage`, driver: sql`driver`, leadHours: sql`lead_hours`, afterHours: sql`after_hours`, reason: sql`ev.reason` },
  defaultSort: { key: "at", dir: "desc" }, tiebreak: sql`coalesce(ev.offer_id, ev.request_id)`,
  async query({ filters: f, limit, offset, order }) {
    const ev = cancelEvents(f, (c) => inWindow(c, f.cur));
    return page(rows<Row>(sql`
      select coalesce(ev.offer_id, ev.request_id) as id, ev.at, ev.request_id as "requestId", ev.ref, coalesce(bp.company_name, bu.name) as company, ev.kind, ev.party, ev.stage, du.name as driver,
        (case when ev.starts_at >= ev.at then round((extract(epoch from (ev.starts_at - ev.at)) / 3600)::numeric, 1)::float8 end) as lead_hours,
        (case when ev.starts_at < ev.at then round((extract(epoch from (ev.at - ev.starts_at)) / 3600)::numeric, 1)::float8 end) as after_hours, ev.reason
      from (${ev}) ev join users bu on bu.id = ev.business_id left join business_profiles bp on bp.user_id = ev.business_id left join users du on du.id = ev.driver_id
      order by ${order} limit ${limit} offset ${offset}`).then((r) => r.map((x) => ({ ...x, leadHours: x.lead_hours, afterHours: x.after_hours }))), rows<Row>(sql`select count(*)::int as n from (${ev}) ev`));
  },
});

/** Loads that took longest: from the driver arriving at the warehouse to the loading being finished. */
defineTable({
  report: REPORT, name: "slow-loads", title: "rpo.tbl_slow_loads",
  columns: [
    { key: "ref", label: "rpo.col_ref", type: "link", href: "/admin/requests/{requestId}", sub: "company" },
    { key: "driver", label: "rpo.col_driver", type: "text" },
    { key: "arrivedAt", label: "rpo.col_arrived", type: "datetime", phone: false },
    { key: "loadedAt", label: "rpo.col_loaded", type: "datetime", phone: false },
    { key: "loadingSecs", label: "rpo.col_loading", type: "duration", align: "end" },
    { key: "parcels", label: "rpo.col_parcels", type: "number", align: "end" },
  ],
  sorts: { ref: sql`requests.ref`, driver: sql`driver`, arrivedAt: sql`offers.arrived_at`, loadedAt: sql`offers.loaded_at`, loadingSecs: sql`loading_secs`, parcels: sql`offers.loaded_units` },
  defaultSort: { key: "loadingSecs", dir: "desc" }, tiebreak: sql`offers.id`,
  async query({ filters: f, limit, offset, order }) {
    const where = sql`${scope(f, "offers")} and ${DRIVEN} and ${LOADING_S} is not null and ${inWindow(requests.startsAt, f.cur)}`;
    const from = sql`from offers join requests on requests.id = offers.request_id ${withCompany} join users du on du.id = offers.driver_id`;
    return page(rows<Row>(sql`
      select offers.id, requests.id as "requestId", requests.ref, ${company} as company, du.name as driver, offers.arrived_at as "arrivedAt", offers.loaded_at as "loadedAt", ${LOADING_S} as loading_secs, offers.loaded_units as parcels
      ${from} where ${where} order by ${order} limit ${limit} offset ${offset}`).then((r) => r.map((x) => ({ ...x, loadingSecs: x.loading_secs }))), rows<Row>(sql`select count(*)::int as n ${from} where ${where}`));
  },
});

/** Requests that took longest to get all their drivers, from publishing to the last slot being filled. */
defineTable({
  report: REPORT, name: "slow-fills", title: "rpo.tbl_slow_fills",
  columns: [
    { key: "ref", label: "rpo.col_ref", type: "link", href: "/admin/requests/{id}", sub: "company" },
    { key: "deliveryCity", label: "rpo.col_city", type: "enum", ns: "city", phone: false },
    { key: "slots", label: "rpo.col_slots", type: "number", align: "end", phone: false },
    { key: "publishedAt", label: "rpo.col_published", type: "datetime", phone: false },
    { key: "acceptSecs", label: "rpo.col_first_accept", type: "duration", align: "end", phone: false },
    { key: "fillSecs", label: "rpo.col_fill_time", type: "duration", align: "end" },
    { key: "status", label: "rpo.col_status", type: "status", ns: "status" },
  ],
  sorts: { ref: sql`requests.ref`, deliveryCity: sql`requests.delivery_city`, slots: sql`slots`, publishedAt: sql`requests.published_at`, acceptSecs: sql`accept_secs`, fillSecs: sql`fill_secs`, status: sql`requests.status` },
  defaultSort: { key: "fillSecs", dir: "desc" }, tiebreak: sql`requests.id`,
  async query({ filters: f, limit, offset, order }) {
    const where = sql`${scope(f, "requests")} and ${NOT_DRAFT} and ${DRIVEN} and requests.published_at is not null and ${G_FILL} is not null and ${inWindow(requests.createdAt, f.cur)}`;
    const from = sql`from requests ${withCompany}`;
    return page(rows<Row>(sql`
      select requests.id, requests.ref, ${company} as company, requests.delivery_city as "deliveryCity", ${SLOTS} as slots, requests.published_at as "publishedAt", ${G_ACCEPT} as accept_secs, ${G_FILL} as fill_secs, requests.status
      ${from} where ${where} order by ${order} limit ${limit} offset ${offset}`).then((r) => r.map((x) => ({ ...x, acceptSecs: x.accept_secs, fillSecs: x.fill_secs }))), rows<Row>(sql`select count(*)::int as n ${from} where ${where}`));
  },
});
