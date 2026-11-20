import { eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { businessProfiles, driverProfiles, officeProfiles, users, type User } from "@/db/schema";
import { err } from "@/lib/errors";
import { can, requirePerm } from "./auth/permissions";
import { maskPhone } from "./account-admin-rules";
import { num, rows } from "./analytics/guard";
import { deviceOf, maskIp } from "./details-pure";

type Row = Record<string, unknown>;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const iso = (v: unknown) => (v ? new Date(v as string).toISOString() : null);
export const isStaffRole = (r: string) => r === "staff" || r === "admin";

/** Where a person's own page lives: companies, offices and drivers have entity views; everyone else (staff, admin) the generic user page. */
export const entityPath = (role: string | null | undefined, id: string) => (role === "business" ? `/admin/companies/${id}` : role === "office" ? `/admin/offices/${id}` : role === "driver" ? `/admin/drivers/${id}` : `/admin/users/${id}`);

/** Who may open the page of a person: staff and admin accounts need `staff.view` / `staff.manage`, everyone else a people permission. */
export function requireUserView(viewer: Pick<User, "role" | "permissions">, targetRole: string) {
  if (isStaffRole(targetRole)) requirePerm(viewer, "staff.view", "staff.manage"); else requirePerm(viewer, "users.view", "drivers.view", "offices.view", "verification.manage");
}
export async function loadUser(id: string) {
  if (!UUID.test(id)) throw err("NOT_FOUND");
  const [u] = await db.select().from(users).where(eq(users.id, id));
  if (!u) throw err("NOT_FOUND");
  return u;
}

/** Sign-ins and sessions of any account (shared by the company and the user views). Addresses and devices are masked without `drivers.sensitive`. */
export async function accountSecurity(viewer: User, u: typeof users.$inferSelect) {
  const sens = can(viewer, "drivers.sensitive");
  const ip = (v: unknown) => (sens ? (v as string | null) ?? null : maskIp(v as string | null));
  const dev = (v: unknown) => (sens ? deviceOf(v as string | null) : null);
  const who = sql`(le.user_id = ${u.id} or (le.user_id is null and ${u.phone ? sql`le.identifier = ${u.phone}` : u.email ? sql`le.identifier = ${u.email}` : sql`false`}))`;
  const [events, stats, active, ended] = await Promise.all([
    rows<Row>(sql`select le.id, le.created_at, le.method, le.success, le.failure_reason, le.ip, le.user_agent, le.client from login_events le where ${who} order by le.created_at desc limit 30`),
    rows<Row>(sql`select count(*) filter (where success)::int as ok, count(*) filter (where not success)::int as failed, count(distinct ip)::int as ips,
        count(*) filter (where client = 'api')::int as api, count(*) filter (where client = 'mobile')::int as mobile, count(*) filter (where client = 'web')::int as web
      from login_events le where ${who} and le.created_at >= now() - interval '30 days'`),
    rows<Row>(sql`select id, client, user_agent, ip, last_seen_at, created_at, expires_at from sessions where user_id = ${u.id} and revoked_at is null and expires_at > now() order by coalesce(last_seen_at, created_at) desc limit 20`),
    rows<Row>(sql`select id, client, user_agent, ip, created_at, revoked_at, revoke_reason from sessions where user_id = ${u.id} and (revoked_at is not null or expires_at <= now()) order by coalesce(revoked_at, expires_at) desc limit 10`),
  ]);
  const s = stats[0];
  return {
    account: { status: u.status, lastLoginAt: u.lastLoginAt, lastSeenAt: u.lastSeenAt, loginCount: u.loginCount, lastLoginIp: ip(u.lastLoginIp), lastLoginClient: u.lastLoginClient, failedLogins: u.failedLogins, lockedUntil: u.lockedUntil, mustChangePassword: u.mustChangePassword },
    stats: { ok30: num(s?.ok), failed30: num(s?.failed), ips30: sens ? num(s?.ips) : null, web: num(s?.web), mobile: num(s?.mobile), api: num(s?.api) },
    events: events.map((e) => ({ id: String(e.id), at: iso(e.created_at), method: String(e.method), success: !!e.success, failureReason: (e.failure_reason as string | null) ?? null, ip: ip(e.ip), device: dev(e.user_agent), client: (e.client as string | null) ?? null })),
    sessions: active.map((x) => ({ id: String(x.id), client: String(x.client), device: dev(x.user_agent), ip: ip(x.ip), lastSeenAt: iso(x.last_seen_at), createdAt: iso(x.created_at), expiresAt: iso(x.expires_at) })),
    ended: ended.map((x) => ({ id: String(x.id), client: String(x.client), device: dev(x.user_agent), ip: ip(x.ip), createdAt: iso(x.created_at), endedAt: iso(x.revoked_at), reason: (x.revoke_reason as string | null) ?? null })),
    sensitiveHidden: !sens,
  };
}

async function entityFacts(viewer: User, u: typeof users.$inferSelect) {
  const sens = can(viewer, "drivers.sensitive");
  if (u.role === "business") {
    const [p] = await db.select().from(businessProfiles).where(eq(businessProfiles.userId, u.id));
    if (!p) return null;
    return { type: "business", name: p.companyName, href: entityPath("business", u.id), verificationStatus: p.verificationStatus, facts: { crNumber: p.crNumber, taxNumber: p.taxNumber, industry: p.industry, rating: p.ratingCount ? Math.round((p.ratingSum / p.ratingCount) * 10) / 10 : null, ratingCount: p.ratingCount } };
  }
  if (u.role === "office") {
    const [p] = await db.select().from(officeProfiles).where(eq(officeProfiles.userId, u.id));
    if (!p) return null;
    const [d] = await rows<Row>(sql`select count(*)::int as n from driver_profiles where office_id = ${u.id} and office_link_status = 'linked'`);
    return { type: "office", name: p.officeName, href: entityPath("office", u.id), verificationStatus: p.verificationStatus, facts: { crNumber: p.crNumber, drivers: num(d?.n), city: p.city } };
  }
  if (u.role === "driver") {
    const [p] = await db.select().from(driverProfiles).where(eq(driverProfiles.userId, u.id));
    if (!p) return null;
    return { type: "driver", name: u.name, href: entityPath("driver", u.id), verificationStatus: p.verificationStatus, facts: { vehicleType: p.vehicleType, vehiclePlate: sens ? p.vehiclePlate : null, availability: p.availability, jobsCompleted: p.jobsCompleted, rating: p.ratingCount ? Math.round((p.ratingSum / p.ratingCount) * 10) / 10 : null, ratingCount: p.ratingCount, linkedOffice: p.officeLinkStatus === "linked" ? p.officeId : null } };
  }
  return null;
}

/** What a staff or admin account did: counts per action and the latest entries (`audit.view`; the entries link to the record they touched). */
async function actionsBy(id: string) {
  const [byAction, latest, total] = await Promise.all([
    rows<Row>(sql`select action, count(*)::int as n from audit_logs where actor_id = ${id} and created_at >= now() - interval '90 days' group by 1 order by n desc limit 12`),
    rows<Row>(sql`select id, created_at, action, entity, entity_id from audit_logs where actor_id = ${id} order by created_at desc limit 25`),
    rows<Row>(sql`select count(*)::int as n, max(created_at) as last_at from audit_logs where actor_id = ${id}`),
  ]);
  return {
    total: num(total[0]?.n), lastAt: iso(total[0]?.last_at), byAction: byAction.map((r) => ({ action: String(r.action), n: num(r.n) })),
    latest: latest.map((r) => ({ id: String(r.id), at: iso(r.created_at), action: String(r.action), entity: String(r.entity), entityId: (r.entity_id as string | null) ?? null })),
  };
}

/** The user view (`GET /admin/users/:id/detail`) for any role. Staff-only blocks (permissions, two-step, lock, actions performed) are present only for staff and admin accounts. */
export async function userDetail(viewer: User, id: string) {
  const u = await loadUser(id);
  requireUserView(viewer, u.role);
  const sens = can(viewer, "drivers.sensitive"), staffAcct = isStaffRole(u.role);
  const [creator] = u.createdBy ? await db.select({ id: users.id, name: users.name, role: users.role }).from(users).where(eq(users.id, u.createdBy)) : [];
  const [entity, tk, cp, nt, actions] = await Promise.all([
    entityFacts(viewer, u),
    can(viewer, "tickets.view") ? rows<Row>(sql`select count(*)::int as n, count(*) filter (where status in ('open','in_review'))::int as open_n from tickets where opened_by = ${id}`) : null,
    can(viewer, "complaints.manage") ? rows<Row>(sql`select count(*)::int as n, count(*) filter (where status in ('open','in_progress'))::int as open_n from complaints where filed_by = ${id}`) : null,
    rows<Row>(sql`select count(*)::int as n from entity_notes where entity = 'user' and entity_id = ${id} and deleted_at is null`),
    staffAcct && can(viewer, "audit.view") ? actionsBy(id) : null,
  ]);
  return {
    id: u.id, role: u.role, name: u.name, phone: sens ? u.phone : maskPhone(u.phone), email: u.email, city: u.city, language: u.language, status: u.status, isDemo: u.isDemo,
    source: u.source, createdBy: creator ?? null, createdAt: u.createdAt, updatedAt: u.updatedAt, mustChangePassword: u.mustChangePassword,
    login: { lastLoginAt: u.lastLoginAt, lastSeenAt: u.lastSeenAt, loginCount: u.loginCount, lastLoginIp: sens ? u.lastLoginIp : maskIp(u.lastLoginIp), lastLoginClient: u.lastLoginClient },
    entity,
    staff: staffAcct ? { staffRole: u.staffRole, permissions: [...u.permissions].sort(), mfaEnabled: !!u.totpEnabledAt, mfaEnabledAt: u.totpEnabledAt, locked: !!u.lockedUntil && u.lockedUntil > new Date(), lockedUntil: u.lockedUntil, failedLogins: u.failedLogins, allPermissions: u.role === "admin" } : null,
    counts: { tickets: tk ? { total: num(tk[0]?.n), open: num(tk[0]?.open_n) } : null, complaints: cp ? { total: num(cp[0]?.n), open: num(cp[0]?.open_n) } : null, notes: num(nt[0]?.n) },
    actions, auditHidden: staffAcct && !can(viewer, "audit.view"), sensitiveHidden: !sens,
  };
}

/** `GET /admin/users/:id/security`: sign-in attempts, live and ended sessions of any account. */
export async function userSecurity(viewer: User, id: string) {
  const u = await loadUser(id);
  requireUserView(viewer, u.role);
  if (!isStaffRole(u.role)) requirePerm(viewer, "users.view");
  return accountSecurity(viewer, u);
}

/** Raw record of a person for support (no secrets). */
export async function userRaw(viewer: User, id: string) {
  const u = await loadUser(id);
  requireUserView(viewer, u.role);
  const sens = can(viewer, "drivers.sensitive");
  return {
    id: u.id, role: u.role, status: u.status, name: u.name, phone: sens ? u.phone : maskPhone(u.phone), email: u.email, city: u.city, language: u.language, source: u.source, createdBy: u.createdBy, isDemo: u.isDemo,
    staffRole: u.staffRole, mustChangePassword: u.mustChangePassword, failedLogins: u.failedLogins, lockedUntil: u.lockedUntil, mfaEnabledAt: u.totpEnabledAt, createdAt: u.createdAt, updatedAt: u.updatedAt,
    lastLoginAt: u.lastLoginAt, lastSeenAt: u.lastSeenAt, loginCount: u.loginCount, lastLoginIp: sens ? u.lastLoginIp : maskIp(u.lastLoginIp), lastLoginClient: u.lastLoginClient, permissions: u.permissions,
  };
}
