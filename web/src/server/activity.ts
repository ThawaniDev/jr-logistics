import { eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { complaints, offers, requests, shipments, tickets, users, withdrawals, settlements } from "@/db/schema";
import { err } from "@/lib/errors";
import { logError } from "@/lib/log";
import type { User } from "@/db/schema";
import { audit } from "./audit";
import { requirePerm } from "./auth/permissions";
import {
  ACTIVITY_KINDS, CSV_COLUMNS, canOpenEntity, canSeeSensitive, clampPaging, csvRows, mergeFeeds, pageOf, redactItem, sumCounts, visibleGroups,
  type ActivityEntity, type ActivityItem, type ActivityQuery, type ActivityRef, type ActivityResult,
} from "./activity-core";
import { filterSql, type Ctx, type Row, type Source } from "./activity-sql";
import { CORE_SOURCES } from "./activity-sources";
import { MORE_SOURCES } from "./activity-sources-b";
import { toCsv } from "./ops";

export const ALL_SOURCES: Source[] = [...CORE_SOURCES, ...MORE_SOURCES];
/** The most rows read from ONE source for a screen (page × pageSize is capped to this) and for an export. */
export const EXPORT_LIMIT = 5000;
const exec = async (q: ReturnType<typeof sql>) => (await db.execute(q)).rows as Array<Record<string, unknown>>;

/** Loads the thing being viewed (404 when it does not exist) and the facts the sources need to scope their queries. */
export async function resolveCtx(entity: ActivityEntity, id: string): Promise<Ctx> {
  const nf = () => err("NOT_FOUND", "Not found");
  switch (entity) {
    case "request": { const [r] = await db.select({ ref: requests.ref }).from(requests).where(eq(requests.id, id)); if (!r) throw nf(); return { entity, id, requestId: id, ref: r.ref, label: r.ref }; }
    case "offer": { const [r] = await db.select({ ref: requests.ref, requestId: offers.requestId, driver: users.name }).from(offers).innerJoin(requests, eq(requests.id, offers.requestId)).innerJoin(users, eq(users.id, offers.driverId)).where(eq(offers.id, id)); if (!r) throw nf(); return { entity, id, requestId: r.requestId, offerId: id, ref: r.ref, label: `${r.ref} · ${r.driver}` }; }
    case "shipment": { const [r] = await db.select({ code: shipments.code, requestId: shipments.requestId, offerId: shipments.offerId }).from(shipments).where(eq(shipments.id, id)); if (!r) throw nf(); return { entity, id, requestId: r.requestId, offerId: r.offerId, ref: r.code, label: r.code }; }
    case "user": { const [r] = await db.select({ name: users.name, role: users.role, phone: users.phone, email: users.email }).from(users).where(eq(users.id, id)); if (!r) throw nf(); return { entity, id, label: r.name, role: r.role, phone: r.phone, email: r.email }; }
    case "ticket": { const [r] = await db.select().from(tickets).where(eq(tickets.id, id)); if (!r) throw nf(); return { entity, id, ref: r.ref, requestId: r.requestId, offerId: r.offerId, label: r.ref, userIds: [r.openedBy, r.assignedTo, r.firstResponseBy].filter((x): x is string => !!x) }; }
    case "complaint": { const [r] = await db.select().from(complaints).where(eq(complaints.id, id)); if (!r) throw nf(); return { entity, id, ref: r.ref, requestId: r.requestId, offerId: r.offerId, label: r.ref, userIds: [r.filedBy, r.handlerId, r.firstResponseBy].filter((x): x is string => !!x) }; }
    case "settlement": { const [r] = await db.select({ requestId: settlements.requestId, offerId: settlements.offerId, ref: requests.ref }).from(settlements).innerJoin(requests, eq(requests.id, settlements.requestId)).where(eq(settlements.id, id)); if (!r) throw nf(); return { entity, id, requestId: r.requestId, offerId: r.offerId, ref: r.ref, label: r.ref }; }
    case "withdrawal": { const [r] = await db.select({ userId: withdrawals.userId, name: users.name }).from(withdrawals).innerJoin(users, eq(users.id, withdrawals.userId)).where(eq(withdrawals.id, id)); if (!r) throw nf(); return { entity, id, label: r.name, userIds: [r.userId] }; }
  }
}

/** The sources a viewer may read for an entity (permission group allowed AND a query exists for that entity). */
export function sourcesFor(viewer: Pick<User, "role" | "permissions">, entity: ActivityEntity, actorFilter = false) {
  const { allowed, hidden } = visibleGroups(viewer, entity);
  return { sources: ALL_SOURCES.filter((s) => allowed.has(s.group) && s.build[entity] && (!actorFilter || s.actor)), hidden };
}

interface Run { items: ActivityItem[]; count: number; kind: string; full: boolean; failed: boolean; table: string }
async function runSource(s: Source, ctx: Ctx, q: ActivityQuery, limit: number, wantRows: boolean): Promise<Run> {
  const base: Run = { items: [], count: 0, kind: s.kind, full: false, failed: false, table: s.table };
  try {
    const sub = s.build[ctx.entity]!(ctx), where = filterSql(q);
    const [c, rows] = await Promise.all([
      exec(sql`select count(*)::int as n from (${sub}) t${where}`),
      wantRows ? exec(sql`select t.* from (${sub}) t${where} order by t.at desc, t.id desc limit ${limit}`) : Promise.resolve([] as Array<Record<string, unknown>>),
    ]);
    base.count = Number(c[0]?.n ?? 0);
    base.full = wantRows && rows.length >= limit && base.count > limit;
    base.items = rows.map((r) => toItem(s, ctx, r as unknown as Row));
  } catch (e) { logError(e, { correlationId: `activity:${s.table}` }); base.failed = true; }
  return base;
}

function toItem(s: Source, ctx: Ctx, r: Row): ActivityItem {
  const m = s.map(r, ctx);
  const at = r.at instanceof Date ? r.at.toISOString() : new Date(r.at).toISOString();
  const actor = m.actor !== undefined ? m.actor : r.actor_id || r.actor_name || r.actor_role ? { id: r.actor_id, name: r.actor_name, role: r.actor_role } : null;
  return { id: r.id, at, kind: s.kind, source: s.group, table: s.table, titleKey: m.titleKey, params: m.params ?? {}, actor, refs: m.refs ?? [], details: m.details ?? null };
}

/** Names for actors that only carry an id, and human labels (request ref, parcel code, ticket ref, person) for every link on the page. One query per kind. */
async function enrich(items: ActivityItem[]): Promise<void> {
  const ids = (t: string) => [...new Set(items.flatMap((i) => i.refs.filter((r) => r.type === t && !r.label).map((r) => r.id)))];
  const actorIds = [...new Set(items.filter((i) => i.actor?.id && !i.actor.name).map((i) => i.actor!.id!))];
  const userRefs = [...new Set(items.flatMap((i) => i.refs.filter((r) => r.type === "user" && !r.label).map((r) => r.id)))];
  const [people, reqs, ships, tks, cps] = await Promise.all([
    actorIds.length || userRefs.length ? db.select({ id: users.id, name: users.name, role: users.role }).from(users).where(inArray(users.id, [...new Set([...actorIds, ...userRefs])])) : [],
    ids("request").length ? db.select({ id: requests.id, ref: requests.ref }).from(requests).where(inArray(requests.id, ids("request"))) : [],
    ids("shipment").length ? db.select({ id: shipments.id, ref: shipments.code }).from(shipments).where(inArray(shipments.id, ids("shipment"))) : [],
    ids("ticket").length ? db.select({ id: tickets.id, ref: tickets.ref }).from(tickets).where(inArray(tickets.id, ids("ticket"))) : [],
    ids("complaint").length ? db.select({ id: complaints.id, ref: complaints.ref }).from(complaints).where(inArray(complaints.id, ids("complaint"))) : [],
  ]);
  const person = new Map(people.map((p) => [p.id, p])), label = new Map<string, string>([...reqs, ...ships, ...tks, ...cps].map((x) => [x.id, x.ref]));
  for (const it of items) {
    if (it.actor?.id && !it.actor.name) { const p = person.get(it.actor.id); if (p) it.actor = { id: p.id, name: p.name, role: it.actor.role ?? p.role }; }
    it.refs = it.refs.map((r: ActivityRef) => (r.label ? r : r.type === "user" ? { ...r, label: person.get(r.id)?.name ?? null, role: person.get(r.id)?.role ?? r.role } : { ...r, label: label.get(r.id) ?? null }));
  }
}

/**
 * Everything that happened to / around ONE entity, newest first, merged from every table that knows something about it (see `activity-sources*.ts`).
 * Permission-aware: sources the viewer may not read are skipped and named in `hidden`; IPs, devices and coordinates are masked without `drivers.sensitive`.
 * Cost: per source one COUNT and one LIMITed SELECT (index-backed), merged in memory.
 */
export async function entityActivity(viewer: User, q: ActivityQuery, opts: { limit?: number } = {}): Promise<ActivityResult> {
  if (!canOpenEntity(viewer, q.entity)) throw err("FORBIDDEN", "Missing permission");
  const ctx = await resolveCtx(q.entity, q.id);
  const { page, pageSize } = clampPaging(q.page, q.pageSize);
  const kinds = q.kinds?.filter((k) => (ACTIVITY_KINDS as readonly string[]).includes(k));
  const nothing = !!q.kinds?.length && !kinds?.length; // only unknown kinds asked for: show nothing rather than everything
  const { sources, hidden } = sourcesFor(viewer, q.entity, !!q.actorId);
  const limit = opts.limit ?? page * pageSize;
  const pick = (kind: string) => !nothing && (!kinds?.length || kinds.includes(kind));
  const runs = await Promise.all(sources.map((s) => runSource(s, ctx, q, limit, pick(s.kind))));
  const selected = (r: Run) => pick(r.kind);
  const merged = mergeFeeds(runs.filter(selected).map((r) => r.items));
  const items = opts.limit ? merged.slice(0, opts.limit) : pageOf(merged, page, pageSize);
  await enrich(items);
  const sensitive = canSeeSensitive(viewer);
  return {
    items: items.map((i) => redactItem(i, sensitive)), page, pageSize,
    total: runs.filter(selected).reduce((a, r) => a + r.count, 0),
    kindCounts: sumCounts(runs.map((r) => ({ kind: r.kind, n: r.count }))),
    hidden, failed: runs.filter((r) => r.failed).map((r) => r.table), truncated: runs.some((r) => r.full),
    entity: { type: q.entity, id: q.id, label: ctx.label ?? null },
  };
}

/** CSV of the same feed (up to EXPORT_LIMIT rows), for people who may export reports. Audited. */
export async function exportActivity(viewer: User, q: ActivityQuery) {
  requirePerm(viewer, "reports.export");
  const r = await entityActivity(viewer, { ...q, page: 1, pageSize: 100 }, { limit: EXPORT_LIMIT });
  await audit(viewer, "activity.export", q.entity, q.id, { rows: r.items.length, truncated: r.truncated, kinds: q.kinds ?? null });
  return { csv: "﻿" + toCsv([...CSV_COLUMNS], csvRows(r.items)), rows: r.items.length, truncated: r.truncated, label: r.entity.label };
}
