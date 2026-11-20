import { sql } from "drizzle-orm";
import type { User } from "@/db/schema";
import { can, requirePerm } from "./auth/permissions";
import { requireCompanyView } from "./companies-admin";
import { num, rows } from "./analytics/guard";
import { bucketKeys } from "./analytics/periods";
import { zeroFill } from "./analytics/buckets";
import { addDays, riyadhDay } from "./analytics/time";
import { slaFor, worstSla } from "./details-pure";
import { accountSecurity } from "./details-users";
import { getAdapter } from "./partners/registry";
import { loadCompany } from "./details-companies";

type Row = Record<string, unknown>;
const iso = (v: unknown) => (v ? new Date(v as string).toISOString() : null);
const UUID_IN_PATH = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const clip = (s: unknown, n = 240) => (typeof s === "string" ? (s.length > n ? `${s.slice(0, n)}…` : s) : null);
const day = (offset: number) => addDays(riyadhDay(new Date()), offset);

/**
 * Integrations of one company: warehouse-system connections (status, last error, event outcomes, stuck write-backs), API keys (last used), the outbound webhook (30-day
 * delivery log and failure rate) and API usage (calls, errors, latency, busiest paths). Sections follow the permission that guards the same data elsewhere
 * (`requests.view` for traffic and connections, `users.view` for key metadata). Secrets and payloads are never returned.
 */
export async function companyIntegrations(viewer: User, id: string) {
  requireCompanyView(viewer);
  const { p } = await loadCompany(id);
  const traffic = can(viewer, "requests.view"), keysOk = can(viewer, "users.view");
  const keys = bucketKeys(day(-29), day(0), "day"), from = sql`now() - interval '30 days'`;
  const [conns, events, outbox, apiKeys, hooks, hookSeries, hookFails, calls, callSeries, paths, perKey] = await Promise.all([
    traffic ? rows<Row>(sql`select id, provider, name, status, last_ok_at, last_error, last_event_at, last_poll_at, last_checked_at, created_at from partner_connections where business_id = ${id} order by created_at`) : null,
    traffic ? rows<Row>(sql`select connection_id, outcome, count(*)::int as n from partner_events where business_id = ${id} and created_at >= ${from} group by 1, 2`) : null,
    traffic ? rows<Row>(sql`select connection_id, status, count(*)::int as n from partner_outbox where business_id = ${id} and status in ('queued','retry_wait','dead') group by 1, 2`) : null,
    keysOk ? rows<Row>(sql`select id, name, prefix, scopes, last_used_at, revoked_at, created_at from api_keys where business_id = ${id} order by created_at desc limit 50`) : null,
    traffic ? rows<Row>(sql`select count(*) filter (where status = 'delivered')::int as ok, count(*) filter (where status = 'dead_letter')::int as dead, count(*) filter (where status in ('queued','retry_wait'))::int as waiting,
        coalesce(avg(attempts), 0)::float8 as avg_attempts, max(delivered_at) as last_ok from webhook_deliveries where business_id = ${id} and created_at >= ${from}`) : null,
    traffic ? rows<{ t: string; ok: number; failed: number }>(sql`select to_char(date_trunc('day', created_at at time zone 'Asia/Riyadh'), 'YYYY-MM-DD') as t, count(*) filter (where status = 'delivered')::int as ok, count(*) filter (where status = 'dead_letter')::int as failed
        from webhook_deliveries where business_id = ${id} and created_at >= ${from} group by 1`) : null,
    traffic ? rows<Row>(sql`select d.id, d.event, d.status, d.attempts, d.last_status_code, d.last_error, d.created_at, d.request_id, r.ref from webhook_deliveries d left join requests r on r.id = d.request_id
        where d.business_id = ${id} and d.status in ('dead_letter','retry_wait') order by d.created_at desc limit 10`) : null,
    traffic ? rows<Row>(sql`select count(*)::int as n, count(*) filter (where status >= 400 and status < 500)::int as e4, count(*) filter (where status >= 500)::int as e5,
        percentile_cont(0.5) within group (order by latency_ms) as p50, percentile_cont(0.95) within group (order by latency_ms) as p95, max(created_at) as last_at from api_logs where business_id = ${id} and created_at >= ${from}`) : null,
    traffic ? rows<{ t: string; calls: number; errors: number }>(sql`select to_char(date_trunc('day', created_at at time zone 'Asia/Riyadh'), 'YYYY-MM-DD') as t, count(*)::int as calls, count(*) filter (where status >= 400)::int as errors
        from api_logs where business_id = ${id} and created_at >= ${from} group by 1`) : null,
    traffic ? rows<Row>(sql`select method, regexp_replace(path, ${UUID_IN_PATH}, ':id', 'g') as path, count(*)::int as n, count(*) filter (where status >= 400)::int as errors from api_logs
        where business_id = ${id} and created_at >= ${from} group by 1, 2 order by n desc limit 8`) : null,
    traffic ? rows<Row>(sql`select key_id, count(*)::int as n, count(*) filter (where status >= 400)::int as errors from api_logs where business_id = ${id} and created_at >= ${from} and key_id is not null group by 1`) : null,
  ]);
  const evBy = new Map<string, Record<string, number>>(); for (const e of events ?? []) { const k = String(e.connection_id); evBy.set(k, { ...(evBy.get(k) ?? {}), [String(e.outcome)]: num(e.n) }); }
  const obBy = new Map<string, Record<string, number>>(); for (const o of outbox ?? []) { const k = String(o.connection_id); obBy.set(k, { ...(obBy.get(k) ?? {}), [String(o.status)]: num(o.n) }); }
  const useBy = new Map((perKey ?? []).map((k) => [String(k.key_id), { calls: num(k.n), errors: num(k.errors) }]));
  const h = hooks?.[0], c = calls?.[0];
  const host = (() => { try { return p?.webhookUrl ? new URL(p.webhookUrl).host : null; } catch { return null; } })();
  const done = num(h?.ok) + num(h?.dead);
  return {
    partners: conns ? conns.map((x) => ({
      id: String(x.id), provider: String(x.provider), providerLabel: getAdapter(String(x.provider))?.label ?? String(x.provider), name: String(x.name), status: String(x.status), lastOkAt: iso(x.last_ok_at), lastError: clip(x.last_error), lastEventAt: iso(x.last_event_at), lastPollAt: iso(x.last_poll_at), createdAt: iso(x.created_at),
      events30: { ok: 0, ignored: 0, error: 0, ...(evBy.get(String(x.id)) ?? {}) }, outbox: { queued: 0, retry_wait: 0, dead: 0, ...(obBy.get(String(x.id)) ?? {}) },
    })) : null,
    apiKeys: apiKeys ? apiKeys.map((k) => ({ id: String(k.id), name: String(k.name), prefix: String(k.prefix), scopes: (k.scopes as string[]) ?? [], lastUsedAt: iso(k.last_used_at), revokedAt: iso(k.revoked_at), createdAt: iso(k.created_at), ...(useBy.get(String(k.id)) ?? { calls: 0, errors: 0 }) })) : null,
    webhook: h ? {
      configured: !!p?.webhookUrl, host, hasSecret: !!p?.webhookSecret, delivered: num(h.ok), failed: num(h.dead), waiting: num(h.waiting), failureRate: done > 0 ? num(h.dead) / done : null, avgAttempts: num(h.avg_attempts), lastDeliveredAt: iso(h.last_ok),
      series: zeroFill(keys, hookSeries ?? [], ["ok", "failed"] as const),
      recent: (hookFails ?? []).map((f) => ({ id: String(f.id), event: String(f.event), status: String(f.status), attempts: num(f.attempts), statusCode: f.last_status_code == null ? null : num(f.last_status_code), error: clip(f.last_error), createdAt: iso(f.created_at), request: f.request_id ? { id: String(f.request_id), ref: String(f.ref ?? "") } : null })),
    } : null,
    api: c ? {
      calls: num(c.n), clientErrors: num(c.e4), serverErrors: num(c.e5), errorRate: num(c.n) > 0 ? (num(c.e4) + num(c.e5)) / num(c.n) : null, p50Ms: c.p50 == null ? null : Math.round(num(c.p50)), p95Ms: c.p95 == null ? null : Math.round(num(c.p95)), lastCallAt: iso(c.last_at),
      series: zeroFill(keys, callSeries ?? [], ["calls", "errors"] as const), paths: (paths ?? []).map((x) => ({ method: String(x.method), path: String(x.path), calls: num(x.n), errors: num(x.errors) })),
    } : null,
    hidden: [!traffic && "traffic", !keysOk && "keys"].filter((x): x is string => !!x),
  };
}

/** Sign-ins and sessions of the company's account (`users.view`, shared with the user view) plus how its API keys were used. Ending one session is not an admin action (suspending the account ends all of them). */
export async function companySecurity(viewer: User, id: string) {
  requirePerm(viewer, "users.view");
  const { u } = await loadCompany(id);
  const base = await accountSecurity(viewer, u);
  const keyUse = can(viewer, "requests.view") ? await rows<Row>(sql`select k.id, k.name, k.prefix, k.last_used_at, k.revoked_at, (select count(*) from api_logs l where l.key_id = k.id and l.created_at >= now() - interval '30 days')::int as calls
      from api_keys k where k.business_id = ${id} order by k.created_at desc limit 20`) : null;
  return { ...base, apiKeys: keyUse ? keyUse.map((k) => ({ id: String(k.id), name: String(k.name), prefix: String(k.prefix), lastUsedAt: iso(k.last_used_at), revokedAt: iso(k.revoked_at), calls30: num(k.calls) })) : null };
}

/** Tickets and complaints that involve the company: opened / filed by it, or about one of its orders (a driver's complaint about the job counts too), each with its SLA state. */
export async function companySupport(viewer: User, id: string) {
  requireCompanyView(viewer);
  await loadCompany(id);
  const seeT = can(viewer, "tickets.view"), seeC = can(viewer, "complaints.manage");
  const mine = sql`(x.opened_by = ${id} or x.request_id in (select id from requests where business_id = ${id}))`;
  const mineC = sql`(x.filed_by = ${id} or x.request_id in (select id from requests where business_id = ${id}))`;
  const [tk, cp] = await Promise.all([
    seeT ? rows<Row>(sql`select x.id, x.ref, x.subject, x.category, x.status, x.priority, x.created_at, x.first_response_at, x.resolved_at, x.opened_by, u.name as opener, u.role as opener_role, a.name as assignee, r.ref as request_ref, x.request_id
      from tickets x join users u on u.id = x.opened_by left join users a on a.id = x.assigned_to left join requests r on r.id = x.request_id where ${mine} order by x.created_at desc limit 50`) : null,
    seeC ? rows<Row>(sql`select x.id, x.ref, x.category, x.status, x.priority, x.holds_settlement, x.created_at, x.first_response_at, x.resolved_at, x.filed_by, u.name as filer, x.filed_by_role, a.name as handler, r.ref as request_ref, x.request_id
      from complaints x join users u on u.id = x.filed_by left join users a on a.id = x.handler_id left join requests r on r.id = x.request_id where ${mineC} order by x.created_at desc limit 50`) : null,
  ]);
  const now = Date.now();
  const sla = (r: Row) => { const s = slaFor({ createdAt: r.created_at as string, firstResponseAt: r.first_response_at as string | null, resolvedAt: r.resolved_at as string | null }, now); return { ...s, worst: worstSla(s) }; };
  const open = (s: unknown) => s === "open" || s === "in_review" || s === "in_progress";
  const tickets = tk?.map((r) => ({ id: String(r.id), ref: String(r.ref), subject: String(r.subject), category: String(r.category), status: String(r.status), priority: String(r.priority), createdAt: iso(r.created_at), assignee: (r.assignee as string | null) ?? null,
    by: { id: String(r.opened_by), name: String(r.opener), role: String(r.opener_role) }, about: r.opened_by !== id, request: r.request_id ? { id: String(r.request_id), ref: String(r.request_ref) } : null, sla: sla(r) })) ?? null;
  const complaints = cp?.map((r) => ({ id: String(r.id), ref: String(r.ref), category: String(r.category), status: String(r.status), priority: String(r.priority), holdsSettlement: !!r.holds_settlement, createdAt: iso(r.created_at), handler: (r.handler as string | null) ?? null,
    by: { id: String(r.filed_by), name: String(r.filer), role: String(r.filed_by_role) }, about: r.filed_by !== id, request: r.request_id ? { id: String(r.request_id), ref: String(r.request_ref) } : null, sla: sla(r) })) ?? null;
  const all = [...(tickets ?? []), ...(complaints ?? [])];
  const openRows = all.filter((x) => open(x.status));
  return {
    tickets, complaints,
    summary: { open: openRows.length, breached: openRows.filter((x) => x.sla.worst === "breached").length, atRisk: openRows.filter((x) => x.sla.worst === "at_risk").length, total: all.length },
    hidden: [!seeT && "tickets", !seeC && "complaints"].filter((x): x is string => !!x),
  };
}
