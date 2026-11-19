import { and, count, desc, eq, ilike, inArray, notInArray, or, sql, type SQL } from "drizzle-orm";
import { db } from "@/db";
import { users, officeProfiles, driverProfiles, offers, requests, settlements, walletAccounts, documents, businessProfiles, jobEvents, ledgerEntries, type User } from "@/db/schema";
import { err } from "@/lib/errors";
import { contains } from "@/lib/sql";
import { can, requirePerm } from "./auth/permissions";
import { OFFER_BUSY, OFFICE_DOC_TYPES } from "./catalog";
import { getSettings } from "./settings";
import { currentAgreements, officeReadiness } from "./office";
import { driverOpsProfile } from "./adminviews";

/**
 * Back-office views for courier offices, drivers and the accounts directory (the redesigned admin list + detail pages).
 * Read-only aggregates: every state change keeps going through the existing endpoints (verification, status, agreements, unlink, clear-suspension).
 */

/** Who may look at an office account: the same people who can list it through `/admin/users?role=office`, plus the office managers. */
const OFFICE_VIEW = ["offices.view", "offices.manage", "users.view", "verification.manage"] as const;
/** Payouts and wallet balance of an office are money: office managers and finance staff only (never support / verification-only staff). */
const OFFICE_MONEY = ["offices.view", "offices.manage", "finance.view", "wallets.view", "settlements.review"] as const;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const idOf = (id: string) => { if (!UUID.test(id)) throw err("NOT_FOUND"); return id; };
const clampSize = (n: number | undefined, def: number, max: number) => Math.min(Math.max(n ?? def, 1), max);
const asNum = (v: unknown) => Number(v ?? 0);
const busyList = sql.join(OFFER_BUSY.map((s) => sql`${s}`), sql`, `);
/** Settlements that are owed but not yet in the payee's wallet (failed ones are retried by housekeeping). */
const PENDING_PAYOUT = ["pending_review", "reviewed", "approved", "batch_ready", "failed"] as const;
const pendingList = sql.join(PENDING_PAYOUT.map((s) => sql`${s}`), sql`, `);
const hasAnyPerm = (u: User, perms: readonly string[]) => perms.some((p) => can(u, p as never));
const maskPhone = (p: string | null) => (p ? p.slice(0, 4) + "•••" + p.slice(-2) : null);

// ───────── Courier offices ─────────
export const OFFICE_STATES = ["all", "verified", "review", "rejected", "suspended"] as const;
const suspendedOffice = or(eq(users.status, "suspended"), eq(officeProfiles.verificationStatus, "suspended"));
const latestAgreement = (office: SQL | typeof users.id) => sql`(select a.status from office_agreements a where a.office_id = ${office} order by a.version desc limit 1)`;

/** KPI row of the offices page: how many offices, in which state, and how many agreements still wait for the office. */
export async function officesSummary(staff: User) {
  requirePerm(staff, ...OFFICE_VIEW);
  const [r] = (await db.execute(sql`
    select count(*)::int as offices,
      count(*) filter (where p.verification_status = 'verified')::int as verified,
      count(*) filter (where p.verification_status in ('pending','info_requested'))::int as review,
      count(*) filter (where p.verification_status = 'rejected')::int as rejected,
      count(*) filter (where u.status = 'suspended' or p.verification_status = 'suspended')::int as suspended,
      count(*) filter (where (select a.status from office_agreements a where a.office_id = u.id order by a.version desc limit 1) = 'pending_acceptance')::int as "pendingAgreements",
      count(*) filter (where (select count(*) from office_agreements a where a.office_id = u.id) = 0)::int as "noAgreement"
    from users u join office_profiles p on p.user_id = u.id where u.role = 'office'`)).rows as Array<Record<string, number>>;
  const [d] = (await db.execute(sql`select count(*)::int as n from driver_profiles dp join users o on o.id = dp.office_id where o.role = 'office'`)).rows as Array<{ n: number }>;
  return { offices: r.offices, verified: r.verified, review: r.review, rejected: r.rejected, suspended: r.suspended, pendingAgreements: r.pendingAgreements, noAgreement: r.noAgreement, drivers: d.n };
}

export async function listOffices(staff: User, f: { q?: string; state?: string; agreement?: string; page?: number; pageSize?: number }) {
  requirePerm(staff, ...OFFICE_VIEW);
  const pageSize = clampSize(f.pageSize, 25, 100), page = Math.max(f.page ?? 1, 1);
  const c = f.q?.trim() ? contains(f.q) : null;
  const where = and(
    eq(users.role, "office"),
    f.state === "verified" ? eq(officeProfiles.verificationStatus, "verified") : undefined,
    f.state === "review" ? inArray(officeProfiles.verificationStatus, ["pending", "info_requested"]) : undefined,
    f.state === "rejected" ? eq(officeProfiles.verificationStatus, "rejected") : undefined,
    f.state === "suspended" ? suspendedOffice : undefined,
    f.agreement === "pending" ? sql`${latestAgreement(users.id)} = 'pending_acceptance'` : undefined,
    f.agreement === "none" ? sql`not exists (select 1 from office_agreements a where a.office_id = ${users.id})` : undefined,
    c ? or(ilike(users.name, c), ilike(users.phone, c), ilike(users.email, c), ilike(officeProfiles.officeName, c), ilike(officeProfiles.crNumber, c)) : undefined,
  );
  const money = hasAnyPerm(staff, OFFICE_MONEY);
  const [rows, [{ total }]] = await Promise.all([
    db.select({
      id: users.id, contact: users.name, phone: users.phone, email: users.email, status: users.status, userCity: users.city, createdAt: users.createdAt,
      officeName: officeProfiles.officeName, crNumber: officeProfiles.crNumber, profileCity: officeProfiles.city, verificationStatus: officeProfiles.verificationStatus,
      drivers: sql<number>`(select count(*)::int from driver_profiles dp where dp.office_id = ${users.id})`,
      availableDrivers: sql<number>`(select count(*)::int from driver_profiles dp where dp.office_id = ${users.id} and dp.availability = 'available' and dp.verification_status = 'verified' and (dp.suspended_until is null or dp.suspended_until <= now()))`,
      activeJobs: sql<number>`(select count(*)::int from offers o where o.office_id = ${users.id} and o.status in (${busyList}))`,
      pendingPayoutCents: sql<number>`coalesce((select sum(s.provider_cents) from settlements s where s.office_id = ${users.id} and s.status in (${pendingList})), 0)::double precision`,
      agreementStatus: sql<string | null>`${latestAgreement(users.id)}`,
      agreementExpiresAt: sql<Date | null>`(select a.expires_at from office_agreements a where a.office_id = ${users.id} order by a.version desc limit 1)`,
    }).from(users).innerJoin(officeProfiles, eq(officeProfiles.userId, users.id)).where(where).orderBy(desc(users.createdAt)).limit(pageSize).offset((page - 1) * pageSize),
    db.select({ total: count() }).from(users).innerJoin(officeProfiles, eq(officeProfiles.userId, users.id)).where(where),
  ]);
  return {
    page, pageSize, total: Number(total),
    items: rows.map((r) => ({
      id: r.id, officeName: r.officeName, contact: r.contact, phone: r.phone, email: r.email, city: r.profileCity ?? r.userCity, crNumber: r.crNumber, status: r.status, verificationStatus: r.verificationStatus, createdAt: r.createdAt,
      drivers: asNum(r.drivers), availableDrivers: asNum(r.availableDrivers), activeJobs: asNum(r.activeJobs), pendingPayoutCents: money ? asNum(r.pendingPayoutCents) : null,
      agreementStatus: r.agreementStatus, agreementExpiresAt: r.agreementExpiresAt ? new Date(r.agreementExpiresAt) : null,
    })),
  };
}

/** Everything the office detail header and Overview tab need in one call. IBAN / tax number / bank only for staff cleared for sensitive data (same rule as `/admin/users/:id`). */
export async function officeDetail(staff: User, officeId: string) {
  requirePerm(staff, ...OFFICE_VIEW);
  idOf(officeId);
  const [row] = await db.select({ u: users, p: officeProfiles }).from(users).innerJoin(officeProfiles, eq(officeProfiles.userId, users.id)).where(and(eq(users.id, officeId), eq(users.role, "office")));
  if (!row) throw err("NOT_FOUND");
  const { u, p } = row;
  const sensitive = can(staff, "drivers.sensitive");
  const showMoney = hasAnyPerm(staff, OFFICE_MONEY);
  const showDocs = can(staff, "documents.review") || can(staff, "verification.manage");
  const [driverRow, jobRow, ready, agreements, wallet, paid, docs] = await Promise.all([
    db.execute(sql`select count(*)::int as total, count(*) filter (where availability = 'available' and verification_status = 'verified' and (suspended_until is null or suspended_until <= now()))::int as available from driver_profiles where office_id = ${officeId}`),
    db.execute(sql`select count(*) filter (where status in (${busyList}))::int as active, count(*) filter (where status = 'completed')::int as completed, count(distinct driver_id) filter (where status in (${busyList}))::int as "onJob" from offers where office_id = ${officeId}`),
    officeReadiness(officeId),
    currentAgreements(officeId),
    db.select().from(walletAccounts).where(eq(walletAccounts.ownerId, officeId)),
    db.execute(sql`select count(*) filter (where status in (${pendingList}))::int as "pendingCount", coalesce(sum(provider_cents) filter (where status in (${pendingList})), 0)::double precision as "pendingCents",
      count(*) filter (where status = 'paid')::int as "paidCount", coalesce(sum(provider_cents) filter (where status = 'paid'), 0)::double precision as "paidCents" from settlements where office_id = ${officeId}`),
    showDocs ? db.select({ type: documents.type, status: documents.status }).from(documents).where(and(eq(documents.ownerId, officeId), eq(documents.ownerKind, "office"))) : Promise.resolve(null),
  ]);
  const dr = driverRow.rows[0] as { total: number; available: number }, jr = jobRow.rows[0] as { active: number; completed: number; onJob: number }, pr = paid.rows[0] as Record<string, number>;
  const latest = agreements[0] ?? null;
  const required = OFFICE_DOC_TYPES.filter((d) => d.required);
  const issues: string[] = [];
  if (p.verificationStatus !== "verified") issues.push("not_verified");
  if (u.status !== "active") issues.push("suspended");
  const accepted = agreements.find((a) => a.status === "accepted");
  if (!accepted) issues.push(latest?.status === "pending_acceptance" ? "agreement_pending" : "no_agreement");
  else if (accepted.expiresAt && accepted.expiresAt <= new Date()) issues.push("agreement_expired");
  return {
    id: u.id, officeName: p.officeName, contact: p.responsiblePerson ?? u.name, userName: u.name,
    phone: sensitive ? u.phone : maskPhone(u.phone), email: u.email, city: p.city ?? u.city, address: p.address, crNumber: p.crNumber,
    taxNumber: sensitive ? p.taxNumber : undefined, bankName: sensitive ? p.bankName : undefined, iban: sensitive ? p.iban : undefined,
    status: u.status, verificationStatus: p.verificationStatus, verificationNote: p.verificationNote, createdAt: u.createdAt,
    readiness: { ready: ready.ready && issues.length === 0, issues },
    counts: { drivers: dr.total, availableDrivers: dr.available, onJob: jr.onJob, activeJobs: jr.active, completedJobs: jr.completed },
    agreement: latest ? { id: latest.id, version: latest.version, status: latest.status, expiresAt: latest.expiresAt, acceptedAt: latest.acceptedAt, createdAt: latest.createdAt } : null,
    money: showMoney ? { walletAvailableCents: wallet[0]?.availableCents ?? 0, walletHeldCents: wallet[0]?.heldCents ?? 0, pendingPayoutCents: asNum(pr.pendingCents), pendingCount: asNum(pr.pendingCount), paidCents: asNum(pr.paidCents), paidCount: asNum(pr.paidCount) } : null,
    documents: docs ? { required: required.length, approved: required.filter((d) => docs.some((x) => x.type === d.key && x.status === "approved")).length, total: docs.length, missing: required.filter((d) => !docs.some((x) => x.type === d.key && x.status === "approved")).map((d) => d.key) } : null,
  };
}

/** The office's own jobs (offers whose payee snapshot is this office). `scope` is a state of the list, not another list. */
export async function officeJobsPage(staff: User, officeId: string, f: { scope?: string; page?: number; pageSize?: number }) {
  requirePerm(staff, "offices.view", "offices.manage");
  idOf(officeId);
  return offersPage(and(eq(offers.officeId, officeId), scopeWhere(f.scope)), f);
}
export async function officeSettlementsPage(staff: User, officeId: string, f: { status?: string; page?: number; pageSize?: number }) {
  requirePerm(staff, ...OFFICE_MONEY);
  idOf(officeId);
  const pageSize = clampSize(f.pageSize, 10, 50), page = Math.max(f.page ?? 1, 1);
  const where = and(
    eq(settlements.officeId, officeId),
    f.status === "pending" ? inArray(settlements.status, [...PENDING_PAYOUT]) : f.status === "paid" ? eq(settlements.status, "paid") : f.status === "rejected" ? eq(settlements.status, "rejected") : undefined,
  );
  const [rows, [{ n }]] = await Promise.all([
    db.select({ s: settlements, ref: requests.ref, driver: users.name }).from(settlements).innerJoin(requests, eq(requests.id, settlements.requestId)).innerJoin(users, eq(users.id, settlements.driverId))
      .where(where).orderBy(desc(settlements.createdAt)).limit(pageSize).offset((page - 1) * pageSize),
    db.select({ n: count() }).from(settlements).where(where),
  ]);
  return { page, pageSize, total: Number(n), items: rows.map(({ s, ref, driver }) => ({ id: s.id, requestId: s.requestId, ref, driverId: s.driverId, driver, finalUnits: s.finalUnits, amountCents: s.providerCents, status: s.status, createdAt: s.createdAt, paidAt: s.paidAt })) };
}

// ───────── Offers (jobs) of an office or a driver ─────────
export const JOB_SCOPES = ["all", "active", "completed", "issues"] as const;
function scopeWhere(scope?: string) {
  switch (scope) {
    case "active": return inArray(offers.status, [...OFFER_BUSY, "offered"]);
    case "completed": return eq(offers.status, "completed");
    case "issues": return inArray(offers.status, ["cancelled", "no_show", "replaced", "qty_disputed"]);
    default: return notInArray(offers.status, ["rejected", "expired"]); // declined / unanswered offers are noise, not jobs
  }
}
async function offersPage(where: SQL | undefined, f: { page?: number; pageSize?: number }) {
  const pageSize = clampSize(f.pageSize, 10, 50), page = Math.max(f.page ?? 1, 1);
  const [rows, [{ n }]] = await Promise.all([
    db.select({ o: offers, r: requests, driver: users.name, biz: businessProfiles.companyName, bizName: sql<string | null>`(select bu.name from users bu where bu.id = ${requests.businessId})` })
      .from(offers).innerJoin(requests, eq(requests.id, offers.requestId)).innerJoin(users, eq(users.id, offers.driverId)).leftJoin(businessProfiles, eq(businessProfiles.userId, requests.businessId))
      .where(where).orderBy(desc(offers.createdAt)).limit(pageSize).offset((page - 1) * pageSize),
    db.select({ n: count() }).from(offers).where(where),
  ]);
  return {
    page, pageSize, total: Number(n),
    items: rows.map(({ o, r, driver, biz, bizName }) => ({
      offerId: o.id, requestId: r.id, ref: r.ref, service: r.service, status: o.status, driver, driverId: o.driverId, businessId: r.businessId, business: biz ?? bizName,
      startsAt: r.startsAt, pickupCity: r.pickupCity, deliveryCity: r.deliveryCity, expectedUnits: o.expectedUnits, finalUnits: o.finalUnits, cancelReason: o.cancelReason, createdAt: o.createdAt,
    })),
  };
}
export async function driverJobsPage(staff: User, driverId: string, f: { scope?: string; page?: number; pageSize?: number }) {
  requirePerm(staff, "drivers.view", "users.view");
  idOf(driverId);
  return offersPage(and(eq(offers.driverId, driverId), scopeWhere(f.scope)), f);
}

// ───────── Drivers ─────────
export const DRIVER_STATES = ["all", "available", "pending", "suspended"] as const;
const driverSuspended = sql`(${driverProfiles.suspendedUntil} > now() or ${users.status} = 'suspended')`;
const driverAvailable = and(eq(driverProfiles.availability, "available"), eq(driverProfiles.verificationStatus, "verified"), eq(users.status, "active"), sql`(${driverProfiles.suspendedUntil} is null or ${driverProfiles.suspendedUntil} <= now())`);

/** KPI row of the drivers page. "Available" = online, verified and not suspended (the same predicate the list filter uses, so tile and list always agree). */
export async function driversSummary(staff: User) {
  requirePerm(staff, "drivers.view");
  const [r] = (await db.execute(sql`
    select count(*)::int as total,
      count(*) filter (where p.availability = 'available' and p.verification_status = 'verified' and u.status = 'active' and (p.suspended_until is null or p.suspended_until <= now()))::int as available,
      count(*) filter (where p.verification_status = 'pending')::int as pending,
      count(*) filter (where p.suspended_until > now() or u.status = 'suspended')::int as suspended,
      count(*) filter (where p.office_id is not null)::int as "withOffice",
      count(*) filter (where p.office_id is null)::int as direct
    from driver_profiles p join users u on u.id = p.user_id`)).rows as Array<Record<string, number>>;
  return r;
}

type DriverFilter = { q?: string; state?: string; link?: string; officeId?: string; page?: number; pageSize?: number };
/** Driver directory. Phones are masked and national IDs withheld unless the staff member holds `drivers.sensitive` (as in the existing directory). */
export async function driversPage(staff: User, f: DriverFilter) {
  const pageSize = clampSize(f.pageSize, 25, 100), page = Math.max(f.page ?? 1, 1);
  const sensitive = can(staff, "drivers.sensitive");
  const c = f.q?.trim() ? contains(f.q) : null;
  const where = and(
    f.officeId ? eq(driverProfiles.officeId, f.officeId) : undefined,
    f.link === "office" ? sql`${driverProfiles.officeId} is not null` : f.link === "direct" ? sql`${driverProfiles.officeId} is null` : undefined,
    f.state === "available" ? driverAvailable : undefined,
    f.state === "pending" ? eq(driverProfiles.verificationStatus, "pending") : undefined,
    f.state === "suspended" ? driverSuspended : undefined,
    c ? or(ilike(users.name, c), ilike(users.phone, c)) : undefined,
  );
  const [rows, [{ total }]] = await Promise.all([
    db.select({ u: users, p: driverProfiles, office: officeProfiles.officeName, onJob: sql<boolean>`exists (select 1 from offers o where o.driver_id = ${users.id} and o.status in (${busyList}))` })
      .from(driverProfiles).innerJoin(users, eq(users.id, driverProfiles.userId)).leftJoin(officeProfiles, eq(officeProfiles.userId, driverProfiles.officeId))
      .where(where).orderBy(desc(users.createdAt)).limit(pageSize).offset((page - 1) * pageSize),
    db.select({ total: count() }).from(driverProfiles).innerJoin(users, eq(users.id, driverProfiles.userId)).where(where),
  ]);
  return {
    page, pageSize, total: Number(total),
    items: rows.map(({ u, p, office, onJob }) => ({
      id: u.id, name: u.name, phone: sensitive ? u.phone : u.phone?.replace(/\d(?=\d{3})/g, "•") ?? null, city: u.city, status: u.status, createdAt: u.createdAt,
      vehicleType: p.vehicleType, verificationStatus: p.verificationStatus, availability: p.availability, officeId: p.officeId, office, onJob: !!onJob,
      jobsCompleted: p.jobsCompleted, rating: p.ratingCount ? Math.round((p.ratingSum / p.ratingCount) * 10) / 10 : null, ratingCount: p.ratingCount, suspendedUntil: p.suspendedUntil,
    })),
  };
}
export async function directoryDrivers(staff: User, f: DriverFilter) {
  requirePerm(staff, "drivers.view");
  if (f.officeId) idOf(f.officeId);
  return driversPage(staff, f);
}
export async function officeDriversPage(staff: User, officeId: string, f: DriverFilter) {
  requirePerm(staff, "offices.view", "offices.manage", "drivers.view");
  return driversPage(staff, { ...f, officeId: idOf(officeId), link: undefined });
}

/** The driver's profile plus what the redesigned detail page adds: affiliation id, joined date and the cancellation strikes behind a suspension. */
export async function driverOverview(staff: User, driverId: string) {
  idOf(driverId);
  const base = await driverOpsProfile(staff, driverId); // checks drivers.view / users.view, NOT_FOUND for non-drivers
  const s = await getSettings();
  const [[x], events] = await Promise.all([
    db.select({ officeId: driverProfiles.officeId, resetAt: driverProfiles.strikesResetAt, createdAt: users.createdAt, email: users.email, lat: driverProfiles.lat, lng: driverProfiles.lng, locationAt: driverProfiles.locationAt })
      .from(driverProfiles).innerJoin(users, eq(users.id, driverProfiles.userId)).where(eq(driverProfiles.userId, driverId)),
    db.select({ at: jobEvents.createdAt, requestId: jobEvents.requestId, payload: jobEvents.payload, ref: requests.ref }).from(jobEvents).innerJoin(requests, eq(requests.id, jobEvents.requestId))
      .where(and(eq(jobEvents.type, "driver_cancelled"), eq(jobEvents.actorId, driverId))).orderBy(desc(jobEvents.createdAt)).limit(20),
  ]);
  return {
    ...base, officeId: x?.officeId ?? null, createdAt: x?.createdAt ?? null, email: x?.email ?? null,
    strikes: {
      policyEnabled: s.cancelPolicyEnabled, warnAt: s.cancelWarnAt, suspendAt: s.cancelSuspendAt, windowDays: s.cancelWindowDays, suspendDays: s.cancelSuspendDays, resetAt: x?.resetAt ?? null,
      recent: events.map((e) => ({ at: e.at, requestId: e.requestId, ref: e.ref, reason: (e.payload as { reason?: string } | null)?.reason ?? null })),
    },
  };
}

/** Wallet balance and earnings of a driver. Earnings of office-affiliated drivers are paid to the office, so they are reported separately. */
export async function driverMoney(staff: User, driverId: string) {
  requirePerm(staff, "finance.view", "wallets.view");
  idOf(driverId);
  const [acct] = await db.select().from(walletAccounts).where(eq(walletAccounts.ownerId, driverId));
  const [earn, entries] = await Promise.all([
    db.execute(sql`select
        coalesce(sum(provider_cents) filter (where office_id is null and status = 'paid'), 0)::double precision as "paidCents",
        coalesce(sum(provider_cents) filter (where office_id is null and status in (${pendingList})), 0)::double precision as "pendingCents",
        coalesce(sum(provider_cents) filter (where office_id is not null and status = 'paid'), 0)::double precision as "viaOfficePaidCents",
        coalesce(sum(provider_cents) filter (where office_id is not null and status in (${pendingList})), 0)::double precision as "viaOfficePendingCents"
      from settlements where driver_id = ${driverId}`),
    acct ? db.select().from(ledgerEntries).where(eq(ledgerEntries.accountId, acct.id)).orderBy(desc(ledgerEntries.createdAt)).limit(10) : Promise.resolve([]),
  ]);
  const e = earn.rows[0] as Record<string, number> | undefined;
  return {
    wallet: { availableCents: acct?.availableCents ?? 0, reservedCents: acct?.reservedCents ?? 0, heldCents: acct?.heldCents ?? 0 },
    earnings: { paidCents: asNum(e?.paidCents), pendingCents: asNum(e?.pendingCents), viaOfficePaidCents: asNum(e?.viaOfficePaidCents), viaOfficePendingCents: asNum(e?.viaOfficePendingCents) },
    entries: entries.map((l) => ({ id: l.id, kind: l.kind, availableDeltaCents: l.availableDeltaCents, heldDeltaCents: l.heldDeltaCents, note: l.note, simulated: l.simulated, createdAt: l.createdAt })),
  };
}

// ───────── Accounts directory ─────────
/** KPI row of the users page: accounts per role, with how many are suspended or still awaiting verification. */
export async function accountsSummary(staff: User) {
  requirePerm(staff, "users.view");
  const rows = (await db.execute(sql`
    select u.role, count(*)::int as total, count(*) filter (where u.status = 'suspended')::int as suspended,
      count(*) filter (where coalesce(bp.verification_status, op.verification_status, dp.verification_status) in ('pending','info_requested'))::int as review
    from users u left join business_profiles bp on bp.user_id = u.id left join office_profiles op on op.user_id = u.id left join driver_profiles dp on dp.user_id = u.id
    group by u.role`)).rows as Array<{ role: string; total: number; suspended: number; review: number }>;
  const roles: Record<string, { total: number; suspended: number; review: number }> = {};
  for (const r of ["business", "driver", "office", "staff", "admin"]) roles[r] = { total: 0, suspended: 0, review: 0 };
  for (const r of rows) roles[r.role] = { total: r.total, suspended: r.suspended, review: r.review };
  return { roles, total: Object.values(roles).reduce((a, r) => a + r.total, 0), suspended: Object.values(roles).reduce((a, r) => a + r.suspended, 0) };
}

