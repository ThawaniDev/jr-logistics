import { maskPhoneUsername } from "@/lib/username";
import { eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { walletAccounts, type User } from "@/db/schema";
import { requirePerm, can } from "./auth/permissions";
import { audit } from "./audit";
import { BUSINESS_DOC_TYPES, DRIVER_DOC_TYPES, OFFICE_DOC_TYPES } from "./catalog";
import { num, rows } from "./analytics/guard";
import { ageSeconds, clampPage, daysUntil } from "./details-people-lib";
import { driverBase } from "./details-people";
import { officeBase } from "./details-people-office";

/** Detail data that drivers and courier offices share: document submissions with every decision, sign-in security, the raw record for support, and a driver's live position. */
type Rec = Record<string, unknown>;
export type OwnerKind = "driver" | "office";
const base = (viewer: User, id: string, kind: OwnerKind) => (kind === "driver" ? driverBase(viewer, id) : officeBase(viewer, id));
const REQUIRED = { driver: DRIVER_DOC_TYPES, office: OFFICE_DOC_TYPES, business: BUSINESS_DOC_TYPES } as const;

/** Every document the account ever submitted with who decided what and when (from the document and the audit log), plus the required types still missing. */
export async function ownerDocuments(viewer: User, id: string, kind: OwnerKind) {
  requirePerm(viewer, "documents.review", "verification.manage");
  await base(viewer, id, kind);
  const mine = sql`(select id::text from documents where owner_id = ${id} and owner_kind = ${kind})`;
  const [docs, decisions] = await Promise.all([
    rows<Rec>(sql`select d.id, d.type, d.status, d.file_name, d.mime, d.size, d.expires_on::text as expires_on, d.created_at, d.reviewed_at, d.review_note, ru.name as reviewer
      from documents d left join users ru on ru.id = d.reviewer_id where d.owner_id = ${id} and d.owner_kind = ${kind} order by d.created_at desc limit 300`),
    rows<Rec>(sql`select a.entity_id as doc_id, a.action, a.created_at as at, a.diff->>'note' as note, au.name as by from audit_logs a left join users au on au.id = a.actor_id
      where a.entity = 'document' and a.entity_id in ${mine} and a.action in ('document.approved','document.rejected','document.info_requested') order by a.created_at asc limit 1500`),
  ]);
  const byDoc = new Map<string, Array<{ action: string; at: unknown; by: unknown; note: unknown }>>();
  for (const d of decisions) { const l = byDoc.get(String(d.doc_id)) ?? []; l.push({ action: String(d.action).replace("document.", ""), at: d.at, by: d.by ?? null, note: d.note ?? null }); byDoc.set(String(d.doc_id), l); }
  const newest = new Map<string, Rec>(); for (const d of docs) if (!newest.has(String(d.type))) newest.set(String(d.type), d);
  const today = new Date();
  const required = REQUIRED[kind].filter((t) => t.required).map((t) => ({ type: t.key, doc: newest.get(t.key) ?? null }));
  const pending = docs.filter((d) => ["submitted", "under_review"].includes(String(d.status)));
  const expiries = [...newest.values()].filter((d) => d.status === "approved" && d.expires_on).map((d) => ({ type: String(d.type), expiresOn: String(d.expires_on), daysLeft: daysUntil(String(d.expires_on), today) })).sort((a, b) => (a.daysLeft ?? 0) - (b.daysLeft ?? 0));
  return {
    items: docs.map((d) => ({
      id: d.id, type: d.type, status: d.status, fileName: d.file_name, mime: d.mime, size: num(d.size), expiresOn: d.expires_on ?? null, daysLeft: daysUntil(d.expires_on as string | null, today),
      uploadedAt: d.created_at, reviewedAt: d.reviewed_at ?? null, reviewer: d.reviewer ?? null, note: d.review_note ?? null, decisions: byDoc.get(String(d.id)) ?? [],
    })),
    summary: {
      total: docs.length, approved: docs.filter((d) => d.status === "approved").length, rejected: docs.filter((d) => d.status === "rejected").length, pending: pending.length, infoRequested: docs.filter((d) => d.status === "info_requested").length,
      missing: required.filter((r) => !r.doc || r.doc.status !== "approved").map((r) => ({ type: r.type, state: r.doc ? String(r.doc.status) : "missing" })), nextExpiry: expiries[0] ?? null,
      oldestPendingDays: pending.length ? Math.floor((today.getTime() - Math.min(...pending.map((d) => new Date(d.created_at as Date).getTime()))) / 864e5) : null,
    },
  };
}

/** Sign-in security of the account: attempts with address and client, sessions, devices and the messages (OTP SMS) sent to it. Personal data: `drivers.sensitive`; every look is audited. */
export async function ownerSecurity(viewer: User, id: string, kind: OwnerKind, q: { page?: number; pageSize?: number } = {}) {
  requirePerm(viewer, "drivers.sensitive");
  const { u } = await base(viewer, id, kind);
  const { page, pageSize, offset } = clampPage(q, 15, 50);
  const [sum, events, sessions, devices, msgs] = await Promise.all([
    rows<Rec>(sql`select count(*) filter (where success and created_at > now() - interval '30 days')::int as ok30, count(*) filter (where not success and created_at > now() - interval '30 days')::int as failed30,
        count(distinct ip) filter (where created_at > now() - interval '30 days')::int as ips30, count(*)::int as total, count(*) filter (where not success)::int as failed_total from login_events where user_id = ${id}`),
    rows<Rec>(sql`select id, method, success, failure_reason, ip, user_agent, client, created_at from login_events where user_id = ${id} order by created_at desc, id desc limit ${pageSize} offset ${offset}`),
    rows<Rec>(sql`select id, client, ip, user_agent, created_at, last_seen_at, expires_at, revoked_at, revoke_reason, (revoked_at is null and expires_at > now()) as active from sessions where user_id = ${id} order by created_at desc limit 20`),
    rows<Rec>(sql`select client, user_agent, count(*)::int as logins, count(distinct ip)::int as ips, min(created_at) as first_at, max(created_at) as last_at from login_events where user_id = ${id} and success group by 1, 2 order by max(created_at) desc limit 10`),
    rows<Rec>(sql`select id, channel, type, status, error, attempts, recipient, sent_at, created_at from message_log where user_id = ${id} order by created_at desc limit 15`),
  ]);
  await audit(viewer, "user.security_view", "user", id, { kind });
  const s = sum[0] ?? {};
  return {
    page, pageSize, total: num(s.total),
    summary: { success30: num(s.ok30), failed30: num(s.failed30), ips30: num(s.ips30), failedTotal: num(s.failed_total), loginCount: u.loginCount, lastLoginAt: u.lastLoginAt, lastLoginIp: u.lastLoginIp, lastLoginClient: u.lastLoginClient, lastSeenAt: u.lastSeenAt,
      failedLogins: u.failedLogins, lockedUntil: u.lockedUntil && u.lockedUntil.getTime() > Date.now() ? u.lockedUntil : null, mustChangePassword: u.mustChangePassword, activeSessions: sessions.filter((x) => x.active).length, source: u.source },
    events: events.map((e) => ({ id: e.id, method: e.method, success: !!e.success, reason: e.failure_reason ?? null, ip: e.ip ?? null, userAgent: e.user_agent ?? null, client: e.client ?? null, at: e.created_at })),
    sessions: sessions.map((x) => ({ id: x.id, client: x.client, ip: x.ip ?? null, userAgent: x.user_agent ?? null, createdAt: x.created_at, lastSeenAt: x.last_seen_at ?? null, expiresAt: x.expires_at, revokedAt: x.revoked_at ?? null, revokeReason: x.revoke_reason ?? null, active: !!x.active })),
    devices: devices.map((d) => ({ client: d.client ?? null, userAgent: d.user_agent ?? null, logins: num(d.logins), ips: num(d.ips), firstAt: d.first_at, lastAt: d.last_at })),
    messages: msgs.map((m) => ({ id: m.id, channel: m.channel, type: m.type, status: m.status, error: m.error ?? null, attempts: num(m.attempts), recipient: m.recipient ?? null, at: m.sent_at ?? m.created_at })),
  };
}

/** The record as stored (ids, timestamps, flags) for support. Secrets (password hash, two-step secret) are never included; phone, national id and bank details only with `drivers.sensitive`. */
export async function ownerRaw(viewer: User, id: string, kind: OwnerKind) {
  const { u, p } = await base(viewer, id, kind) as { u: Rec & { id: string }; p: Rec };
  const sensitive = can(viewer, "drivers.sensitive"); const mask = (v: unknown) => (typeof v === "string" && v ? v.slice(0, 4) + "•••" + v.slice(-2) : null);
  const { passwordHash: _a, totpSecret: _b, totpRecovery: _c, totpLastStep: _d, ...user } = u as Rec;
  const { nationalId, iban, bankName, taxNumber, ...profile } = p;
  const [acct] = can(viewer, "finance.view") || can(viewer, "wallets.view") ? await db.select({ id: walletAccounts.id }).from(walletAccounts).where(eq(walletAccounts.ownerId, id)) : [];
  const [c] = await rows<Rec>(kind === "driver"
    ? sql`select (select count(*) from offers where driver_id = ${id})::int as offers, (select count(*) from ratings where ratee_id = ${id})::int as ratings, (select count(*) from login_events where user_id = ${id})::int as logins, (select count(*) from driver_location_history where driver_id = ${id})::int as location_points, (select count(*) from driver_availability_log where driver_id = ${id})::int as availability_changes, (select count(*) from documents where owner_id = ${id})::int as documents`
    : sql`select (select count(*) from driver_profiles where office_id = ${id})::int as drivers, (select count(*) from offers where office_id = ${id})::int as offers, (select count(*) from settlements where office_id = ${id})::int as settlements, (select count(*) from office_agreements where office_id = ${id})::int as agreements, (select count(*) from office_invites where office_id = ${id})::int as invites, (select count(*) from documents where owner_id = ${id})::int as documents`);
  return {
    user: { ...user, phone: sensitive ? user.phone : mask(user.phone), username: sensitive ? user.username : maskPhoneUsername(user.username as string | null) }, [kind === "driver" ? "driverProfile" : "officeProfile"]: { ...profile, ...(sensitive ? { nationalId, iban, bankName, taxNumber } : {}) },
    walletAccountId: acct?.id ?? null, counts: c ?? {}, generatedAt: new Date().toISOString(),
  };
}

/** Where a driver is and has been: last known position, days and jobs with GPS samples, and the availability timeline. Needs `drivers.sensitive`; audited like the path itself. */
export async function driverLocation(viewer: User, driverId: string) {
  requirePerm(viewer, "drivers.sensitive");
  const { p } = await driverBase(viewer, driverId);
  const [days, jobs, events, summary] = await Promise.all([
    rows<Rec>(sql`select to_char(recorded_at at time zone 'Asia/Riyadh', 'YYYY-MM-DD') as day, count(*)::int as n, min(recorded_at) as first_at, max(recorded_at) as last_at from driver_location_history
      where driver_id = ${driverId} and recorded_at > now() - interval '31 days' group by 1 order by 1 desc limit 31`),
    rows<Rec>(sql`select h.offer_id, requests.id as request_id, requests.ref, count(*)::int as n, min(h.recorded_at) as first_at, max(h.recorded_at) as last_at from driver_location_history h
      join offers on offers.id = h.offer_id join requests on requests.id = offers.request_id where h.driver_id = ${driverId} and h.offer_id is not null and h.recorded_at > now() - interval '31 days'
      group by 1, 2, 3 order by max(h.recorded_at) desc limit 30`),
    rows<Rec>(sql`select l.id, l.from_status, l.to_status, l.source, l.reason, l.at, au.name as actor from driver_availability_log l left join users au on au.id = l.actor_id where l.driver_id = ${driverId} order by l.at desc limit 100`),
    rows<Rec>(sql`select count(*)::int as total, count(*) filter (where recorded_at > now() - interval '31 days')::int as recent, min(recorded_at) as first_at from driver_location_history where driver_id = ${driverId}`),
  ]);
  await audit(viewer, "location.view", "driver_location", driverId, { summary: true });
  return {
    current: p.availability, last: p.lat != null && p.lng != null ? { lat: p.lat, lng: p.lng, at: p.locationAt, ageSeconds: ageSeconds(p.locationAt) } : null,
    samples: { total: num(summary[0]?.total), last31d: num(summary[0]?.recent), firstAt: summary[0]?.first_at ?? null, retentionDays: 90 },
    days: days.map((d) => ({ day: d.day, points: num(d.n), firstAt: d.first_at, lastAt: d.last_at })),
    jobs: jobs.map((j) => ({ offerId: j.offer_id, requestId: j.request_id, ref: j.ref, points: num(j.n), firstAt: j.first_at, lastAt: j.last_at })),
    availability: events.map((e) => ({ id: e.id, from: e.from_status ?? null, to: e.to_status, source: e.source, reason: e.reason ?? null, at: e.at, actor: e.actor ?? null })),
  };
}
