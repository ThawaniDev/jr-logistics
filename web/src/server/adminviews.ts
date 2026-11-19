import { and, count, desc, eq, gte, inArray, lt, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  ledgerEntries, walletAccounts, invoices, ratings, offers, requests, users, driverProfiles, businessProfiles, officeProfiles,
  complaints, type User,
} from "@/db/schema";
import { err } from "@/lib/errors";
import { requirePerm } from "./auth/permissions";
import { audit } from "./audit";
import { ensureAccount, platformAccount, post } from "./wallet";
import { notify } from "./notify";
import { getSettings } from "./settings";

const paging = (f: { page?: number; pageSize?: number }, max = 100) => {
  const pageSize = Math.min(Math.max(f.pageSize ?? 50, 1), max), page = Math.max(f.page ?? 1, 1);
  return { pageSize, page, offset: (page - 1) * pageSize };
};

type Range = { from?: Date; to?: Date };
const between = (col: Parameters<typeof gte>[0], f: Range) => [f.from ? gte(col, f.from) : undefined, f.to ? lt(col, f.to) : undefined];

// ───────── Finance ─────────

/** Every ledger posting, newest first. Source of truth for "where did the money go". */
export async function listLedger(staff: User, f: Range & { page?: number; pageSize?: number; kind?: string; userId?: string; requestId?: string }) {
  requirePerm(staff, "finance.view", "wallets.view");
  const { pageSize, page, offset } = paging(f);
  const where = and(f.kind ? eq(ledgerEntries.kind, f.kind) : undefined, f.userId ? eq(walletAccounts.ownerId, f.userId) : undefined, f.requestId ? eq(ledgerEntries.requestId, f.requestId) : undefined, ...between(ledgerEntries.createdAt, f));
  const [rows, [{ n }]] = await Promise.all([
    db.select({ e: ledgerEntries, ownerId: walletAccounts.ownerId, ownerName: users.name, ownerRole: users.role }).from(ledgerEntries).innerJoin(walletAccounts, eq(walletAccounts.id, ledgerEntries.accountId)).leftJoin(users, eq(users.id, walletAccounts.ownerId))
      .where(where).orderBy(desc(ledgerEntries.createdAt)).limit(pageSize).offset(offset),
    db.select({ n: count() }).from(ledgerEntries).innerJoin(walletAccounts, eq(walletAccounts.id, ledgerEntries.accountId)).where(where),
  ]);
  return {
    page, pageSize, total: Number(n),
    items: rows.map(({ e, ownerId, ownerName, ownerRole }) => ({
      id: e.id, kind: e.kind, availableDeltaCents: e.availableDeltaCents, reservedDeltaCents: e.reservedDeltaCents, heldDeltaCents: e.heldDeltaCents,
      requestId: e.requestId, settlementId: e.settlementId, simulated: e.simulated, note: e.note, createdAt: e.createdAt, ownerId, owner: ownerName ?? "Platform", ownerRole: ownerRole ?? "platform",
    })),
  };
}

export async function listInvoices(staff: User, f: Range & { page?: number; pageSize?: number; businessId?: string }) {
  requirePerm(staff, "finance.view");
  const { pageSize, page, offset } = paging(f);
  const where = and(f.businessId ? eq(invoices.businessId, f.businessId) : undefined, ...between(invoices.createdAt, f));
  const [rows, [{ n }]] = await Promise.all([
    db.select({ i: invoices, biz: businessProfiles.companyName, name: users.name, ref: requests.ref }).from(invoices).innerJoin(users, eq(users.id, invoices.businessId)).innerJoin(requests, eq(requests.id, invoices.requestId))
      .leftJoin(businessProfiles, eq(businessProfiles.userId, invoices.businessId)).where(where).orderBy(desc(invoices.createdAt)).limit(pageSize).offset(offset),
    db.select({ n: count() }).from(invoices).where(where),
  ]);
  return { page, pageSize, total: Number(n), items: rows.map(({ i, biz, name, ref }) => ({ ...i, business: biz ?? name, ref })) };
}

/**
 * Manual, audited wallet correction (refund / goodwill / fix). Positive credits the user and debits the platform account;
 * negative does the reverse, so the books always balance. Idempotent per `idempotencyKey`.
 */
export async function adjustWallet(staff: User, i: { userId: string; amountCents: number; reason: string; idempotencyKey: string }) {
  requirePerm(staff, "wallet.adjust", "refunds.manage");
  if (!Number.isInteger(i.amountCents) || i.amountCents === 0 || Math.abs(i.amountCents) > 5_000_000_00) throw err("VALIDATION", "Invalid amount", { field: "amountCents" });
  if (!i.reason?.trim() || i.reason.trim().length < 5) throw err("VALIDATION", "A reason is required", { field: "reason" });
  return db.transaction(async (tx) => {
    const [u] = await tx.select({ id: users.id, role: users.role }).from(users).where(eq(users.id, i.userId));
    if (!u || !["business", "driver", "office"].includes(u.role)) throw err("NOT_FOUND", "Account not found", { field: "userId" });
    const acct = await ensureAccount(u.id, tx), plat = await platformAccount(tx);
    const k = `adjust:${i.idempotencyKey}`;
    const credit = i.amountCents > 0, amt = Math.abs(i.amountCents);
    const a = await post(tx, { accountId: acct.id, kind: "adjustment", available: credit ? amt : -amt, idempotencyKey: `${k}:user`, actorId: staff.id, note: i.reason });
    if (a.applied) {
      await post(tx, { accountId: plat.id, kind: "adjustment", available: credit ? -amt : amt, idempotencyKey: `${k}:platform`, actorId: staff.id, note: i.reason });
      await audit(staff, "wallet.adjust", "user", u.id, { amountCents: i.amountCents, reason: i.reason }, tx);
      await notify(u.id, "wallet_adjusted", { amountCents: i.amountCents }, tx);
    }
    return { applied: a.applied };
  });
}

/** B7: grant, change or remove a business's postpaid credit line. Cannot be set below the debt already carried. */
export async function setCreditLimit(staff: User, userId: string, creditLimitCents: number) {
  requirePerm(staff, "wallet.adjust", "refunds.manage");
  if (!Number.isInteger(creditLimitCents) || creditLimitCents < 0 || creditLimitCents > 1_000_000_000) throw err("VALIDATION", "Invalid credit limit", { field: "creditLimitCents" });
  return db.transaction(async (tx) => {
    const [u] = await tx.select({ id: users.id, role: users.role }).from(users).where(eq(users.id, userId));
    if (!u || u.role !== "business") throw err("NOT_FOUND", "Business not found", { field: "userId" });
    const acct = await ensureAccount(u.id, tx);
    const [locked] = await tx.select().from(walletAccounts).where(eq(walletAccounts.id, acct.id)).for("update");
    if (locked.availableCents + creditLimitCents < 0) throw err("VALIDATION", "The business already owes more than this limit", { field: "creditLimitCents", owedCents: -locked.availableCents });
    await tx.update(walletAccounts).set({ creditLimitCents, updatedAt: new Date() }).where(eq(walletAccounts.id, acct.id));
    await audit(staff, "wallet.credit_limit", "user", u.id, { from: locked.creditLimitCents, to: creditLimitCents }, tx);
    await notify(u.id, "credit_limit_changed", { creditLimitCents }, tx);
    return { userId: u.id, creditLimitCents, availableCents: locked.availableCents };
  });
}

// ───────── Quality & operations views ─────────

export async function listRatings(staff: User, f: { page?: number; pageSize?: number; maxStars?: number }) {
  requirePerm(staff, "reports.view", "users.view");
  const { pageSize, page, offset } = paging(f);
  const rows = await db.execute(sql`
    select r.id, r.stars, r.comment, r.created_at as "createdAt", rq.ref, rater.name as "rater", rater.role as "raterRole", ratee.name as "ratee", ratee.role as "rateeRole"
    from ratings r join offers o on o.id = r.offer_id join requests rq on rq.id = o.request_id
    join users rater on rater.id = r.rater_id join users ratee on ratee.id = r.ratee_id
    ${f.maxStars ? sql`where r.stars <= ${f.maxStars}` : sql``}
    order by r.created_at desc limit ${pageSize} offset ${offset}`);
  const [{ n }] = await db.select({ n: count() }).from(ratings).where(f.maxStars ? sql`${ratings.stars} <= ${f.maxStars}` : undefined);
  return { page, pageSize, total: Number(n), items: rows.rows };
}

/** Cancellations by either party: who cancelled, why, and on which request. */
export async function listCancellations(staff: User, f: Range & { page?: number; pageSize?: number }) {
  requirePerm(staff, "requests.view", "reports.view");
  const { pageSize, page, offset } = paging(f);
  const where = and(inArray(requests.status, ["cancelled"]), ...between(requests.updatedAt, f));
  const reqRows = await db.select({ r: requests, biz: businessProfiles.companyName, name: users.name }).from(requests).innerJoin(users, eq(users.id, requests.businessId)).leftJoin(businessProfiles, eq(businessProfiles.userId, requests.businessId))
    .where(where).orderBy(desc(requests.updatedAt)).limit(pageSize).offset(offset);
  const drvWhere = and(inArray(offers.status, ["cancelled", "no_show", "replaced"]), ...between(offers.cancelledAt, f));
  const offRows = await db.select({ o: offers, r: requests, d: users.name }).from(offers).innerJoin(requests, eq(requests.id, offers.requestId)).innerJoin(users, eq(users.id, offers.driverId))
    .where(drvWhere).orderBy(desc(offers.cancelledAt)).limit(pageSize).offset(offset);
  const items = [
    ...reqRows.map(({ r, biz, name }) => ({ party: "business", kind: "request_cancelled", requestId: r.id, ref: r.ref, who: biz ?? name, reason: null as string | null, at: r.updatedAt })),
    ...offRows.map(({ o, r, d }) => ({ party: o.status === "replaced" ? "ops" : "driver", kind: o.status, requestId: r.id, ref: r.ref, who: d, reason: o.cancelReason, at: o.cancelledAt ?? o.updatedAt })),
  ].sort((a, b) => +new Date(b.at) - +new Date(a.at));
  const [{ a }] = await db.select({ a: count() }).from(requests).where(where);
  const [{ b }] = await db.select({ b: count() }).from(offers).where(drvWhere);
  return { page, pageSize, total: Number(a) + Number(b), items };
}

/** Today's operations by pickup city. */
export async function citySummary(staff: User) {
  requirePerm(staff, "requests.view");
  const rows = await db.execute(sql`
    select pickup_city as city,
      count(*) filter (where status in ('published','filling'))::int as open,
      count(*) filter (where status in ('assigned','confirmed','in_progress'))::int as active,
      count(*) filter (where status = 'completed')::int as completed,
      count(*) filter (where status in ('cancelled','expired'))::int as lost
    from requests where starts_at >= now() - interval '1 day' group by pickup_city order by 2 desc`);
  const drivers = await db.execute(sql`select u.city, count(*) filter (where p.availability = 'available')::int as available, count(*)::int as total from driver_profiles p join users u on u.id = p.user_id group by u.city`);
  const dmap = new Map((drivers.rows as Array<{ city: string | null; available: number; total: number }>).map((d) => [d.city, d]));
  return { items: (rows.rows as Array<{ city: string; open: number; active: number; completed: number; lost: number }>).map((r) => ({ ...r, driversAvailable: dmap.get(r.city)?.available ?? 0, driversTotal: dmap.get(r.city)?.total ?? 0 })) };
}

/** Operational profile of one driver for ops/HR. Sensitive identifiers only with `drivers.sensitive`. */
export async function driverOpsProfile(staff: User, driverId: string) {
  requirePerm(staff, "drivers.view", "users.view");
  const sensitive = staff.role === "admin" || staff.permissions.includes("drivers.sensitive");
  const [row] = await db.select({ u: users, p: driverProfiles, office: officeProfiles.officeName }).from(users).innerJoin(driverProfiles, eq(driverProfiles.userId, users.id)).leftJoin(officeProfiles, eq(officeProfiles.userId, driverProfiles.officeId)).where(eq(users.id, driverId));
  if (!row) throw err("NOT_FOUND");
  const s = await getSettings();
  const [stats] = (await db.execute(sql`
    select count(*) filter (where status = 'completed')::int as completed, count(*) filter (where status = 'cancelled')::int as cancelled,
      count(*) filter (where status = 'no_show')::int as "noShow", count(*) filter (where status = 'replaced')::int as replaced, coalesce(sum(final_units) filter (where status = 'completed'),0)::int as units
    from offers where driver_id = ${driverId}`)).rows as Array<Record<string, number>>;
  const recent = await db.select({ o: offers, ref: requests.ref }).from(offers).innerJoin(requests, eq(requests.id, offers.requestId)).where(eq(offers.driverId, driverId)).orderBy(desc(offers.createdAt)).limit(10);
  const [open] = await db.select({ n: count() }).from(complaints).where(and(sql`${complaints.offerId} in (select id from offers where driver_id = ${driverId})`, inArray(complaints.status, ["open", "in_progress"])));
  const { p, u } = row;
  return {
    id: u.id, name: u.name, phone: sensitive ? u.phone : u.phone ? u.phone.slice(0, 4) + "•••" + u.phone.slice(-2) : null, city: u.city, status: u.status,
    nationalId: sensitive ? p.nationalId : null, vehicleType: p.vehicleType, vehicleTemperature: p.vehicleTemperature, vehiclePlate: p.vehiclePlate, services: p.services,
    verificationStatus: p.verificationStatus, availability: p.availability, suspendedUntil: p.suspendedUntil, office: row.office, officeLinkStatus: p.officeLinkStatus,
    rating: p.ratingCount ? Math.round((p.ratingSum / p.ratingCount) * 10) / 10 : null, ratingCount: p.ratingCount,
    stats: { ...stats, cancelPolicyWindowDays: s.cancelWindowDays }, openComplaints: Number(open?.n ?? 0),
    recent: recent.map(({ o, ref }) => ({ offerId: o.id, requestId: o.requestId, ref, status: o.status, at: o.updatedAt })),
  };
}

