import { and, count, desc, eq, ilike, inArray, isNotNull, or, sql } from "drizzle-orm";
import { db } from "@/db";
import { businessProfiles, complaints, documents, driverProfiles, officeProfiles, requests, settlements, tickets, users, walletAccounts, type User } from "@/db/schema";
import { err } from "@/lib/errors";
import { contains } from "@/lib/sql";
import { can, requirePerm } from "./auth/permissions";
import { BUSINESS_DOC_TYPES, REQUEST_ACTIVE } from "./catalog";

/**
 * Back-office views of the "companies" (business accounts): list, KPI summary, header payload and the overview numbers of one company,
 * plus the queue sizes the verification workspace shows. Permissions mirror the neighbouring routes in routes/admin.ts: the people lists are
 * open to `users.view` / `offices.view` / `verification.manage`, money and tickets only to the permissions that already guard them elsewhere.
 */
const VIEW = ["users.view", "offices.view", "verification.manage"] as const;
export const requireCompanyView = (u: Pick<User, "role" | "permissions">) => requirePerm(u, ...VIEW);

const maskPhone = (p: string | null) => (p ? p.slice(0, 4) + "•••" + p.slice(-2) : null);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const COMPANY_STATES = ["pending", "verified", "rejected", "info_requested", "suspended"] as const;
const ACTIVE = [...REQUEST_ACTIVE] as string[];

const hasPin = (lat: number | null, lng: number | null) => lat != null && lng != null;
const noPin = sql`(${businessProfiles.warehouseLat} is null or ${businessProfiles.warehouseLng} is null)`;
/** Suspended = the verification was suspended OR the account itself was (the two are set by different actions). */
const suspendedSql = sql`(${businessProfiles.verificationStatus} = 'suspended' or ${users.status} = 'suspended')`;

export interface CompanyFilter { q?: string; state?: string; warehouse?: string; page?: number; pageSize?: number }

function filterOf(f: CompanyFilter) {
  const q = f.q?.trim() ? contains(f.q) : null;
  return and(
    eq(users.role, "business"),
    q ? or(ilike(users.name, q), ilike(users.phone, q), ilike(users.email, q), ilike(businessProfiles.companyName, q), ilike(businessProfiles.crNumber, q)) : undefined,
    f.state === "suspended" ? suspendedSql : f.state && (COMPANY_STATES as readonly string[]).includes(f.state) ? eq(businessProfiles.verificationStatus, f.state) : undefined,
    f.warehouse === "missing" ? noPin : f.warehouse === "set" ? and(isNotNull(businessProfiles.warehouseLat), isNotNull(businessProfiles.warehouseLng)) : undefined,
  );
}

/** One page of companies with the numbers a table needs (open orders, wallet) fetched in two grouped queries, not per row. */
export async function listCompanies(viewer: User, f: CompanyFilter) {
  requireCompanyView(viewer);
  const pageSize = Math.min(Math.max(f.pageSize ?? 25, 1), 100), page = Math.max(f.page ?? 1, 1);
  const where = filterOf(f);
  const base = db.select({
    id: users.id, name: users.name, phone: users.phone, email: users.email, city: users.city, status: users.status, createdAt: users.createdAt,
    company: businessProfiles.companyName, crNumber: businessProfiles.crNumber, verificationStatus: businessProfiles.verificationStatus, lat: businessProfiles.warehouseLat, lng: businessProfiles.warehouseLng,
  }).from(users).leftJoin(businessProfiles, eq(businessProfiles.userId, users.id));
  const [rows, [{ total }]] = await Promise.all([
    base.where(where).orderBy(desc(users.createdAt)).limit(pageSize).offset((page - 1) * pageSize),
    db.select({ total: count() }).from(users).leftJoin(businessProfiles, eq(businessProfiles.userId, users.id)).where(where),
  ]);
  const ids = rows.map((r) => r.id);
  const [open, wallets] = ids.length ? await Promise.all([
    db.select({ id: requests.businessId, n: count() }).from(requests).where(and(inArray(requests.businessId, ids), inArray(requests.status, ACTIVE))).groupBy(requests.businessId),
    db.select({ id: walletAccounts.ownerId, available: walletAccounts.availableCents }).from(walletAccounts).where(inArray(walletAccounts.ownerId, ids)),
  ]) : [[], []];
  const openBy = new Map(open.map((r) => [r.id, Number(r.n)])), walletBy = new Map(wallets.map((w) => [w.id, w.available]));
  const sensitive = can(viewer, "drivers.sensitive"), money = can(viewer, "wallets.view") || can(viewer, "finance.view");
  return {
    page, pageSize, total: Number(total),
    items: rows.map((r) => ({
      id: r.id, name: r.company ?? r.name, contactName: r.name, phone: sensitive ? r.phone : maskPhone(r.phone), email: r.email, city: r.city, status: r.status, verificationStatus: r.verificationStatus ?? "pending",
      crNumber: r.crNumber, warehouseSet: hasPin(r.lat, r.lng), openOrders: can(viewer, "requests.view") ? openBy.get(r.id) ?? 0 : null, walletCents: money ? walletBy.get(r.id) ?? 0 : null, createdAt: r.createdAt,
    })),
  };
}

/** KPI counts for the companies list (one aggregate over the business accounts). */
export async function companySummary(viewer: User) {
  requireCompanyView(viewer);
  const [a] = await db.select({
    total: count(),
    verified: sql<number>`count(*) filter (where ${businessProfiles.verificationStatus} = 'verified')::int`,
    pending: sql<number>`count(*) filter (where ${businessProfiles.verificationStatus} = 'pending')::int`,
    infoRequested: sql<number>`count(*) filter (where ${businessProfiles.verificationStatus} = 'info_requested')::int`,
    rejected: sql<number>`count(*) filter (where ${businessProfiles.verificationStatus} = 'rejected')::int`,
    suspended: sql<number>`count(*) filter (where ${suspendedSql})::int`,
    accountSuspended: sql<number>`count(*) filter (where ${users.status} = 'suspended')::int`,
    noWarehouse: sql<number>`count(*) filter (where ${noPin})::int`,
  }).from(users).leftJoin(businessProfiles, eq(businessProfiles.userId, users.id)).where(eq(users.role, "business"));
  const seeOrders = can(viewer, "requests.view");
  const [o] = seeOrders ? await db.select({ n: count(), companies: sql<number>`count(distinct ${requests.businessId})::int` }).from(requests).where(inArray(requests.status, ACTIVE)) : [null];
  return {
    total: Number(a.total), verified: a.verified, pending: a.pending, infoRequested: a.infoRequested, rejected: a.rejected, suspended: a.suspended, accountSuspended: a.accountSuspended, noWarehouse: a.noWarehouse,
    openOrders: o ? Number(o.n) : null, companiesWithOpenOrders: o ? o.companies : null,
  };
}

async function companyRow(id: string) {
  if (!UUID.test(id)) throw err("NOT_FOUND");
  const [row] = await db.select({ u: users, p: businessProfiles }).from(users).leftJoin(businessProfiles, eq(businessProfiles.userId, users.id)).where(and(eq(users.id, id), eq(users.role, "business")));
  if (!row) throw err("NOT_FOUND");
  return row;
}

/** The header of one company: contact details (phone masked unless the viewer may see sensitive data), profile and the badges for the tab bar. */
export async function companyDetail(viewer: User, id: string) {
  requireCompanyView(viewer);
  const { u, p } = await companyRow(id);
  const docsReview = can(viewer, "documents.review") || can(viewer, "verification.manage");
  const [orders, toReview] = await Promise.all([
    can(viewer, "requests.view") ? db.select({ n: count() }).from(requests).where(eq(requests.businessId, id)) : null,
    docsReview ? db.select({ n: count() }).from(documents).where(and(eq(documents.ownerId, id), inArray(documents.status, ["submitted", "under_review"]))) : null,
  ]);
  return {
    id: u.id, name: p?.companyName ?? u.name, contactName: u.name, phone: can(viewer, "drivers.sensitive") ? u.phone : maskPhone(u.phone), email: u.email, city: u.city, status: u.status, createdAt: u.createdAt,
    profile: {
      crNumber: p?.crNumber ?? null, industry: p?.industry ?? null, address: p?.address ?? null, responsiblePerson: p?.responsiblePerson ?? null,
      verificationStatus: p?.verificationStatus ?? "pending", verificationNote: p?.verificationNote ?? null,
      warehouse: p && hasPin(p.warehouseLat, p.warehouseLng) ? { lat: p.warehouseLat, lng: p.warehouseLng } : null,
      rating: p?.ratingCount ? Math.round((p.ratingSum / p.ratingCount) * 10) / 10 : null, ratingCount: p?.ratingCount ?? 0, hasWebhook: !!p?.webhookUrl,
    },
    counts: { orders: orders ? Number(orders[0].n) : null, docsToReview: toReview ? Number(toReview[0].n) : null },
  };
}

/** Cash this company's drivers still hold: per offer, collected on delivered parcels minus what was handed back (same rule as /admin/cod). */
async function codFigures(businessId: string) {
  const r = await db.execute<{ collected: number; received: number; outstanding: number }>(sql`
    select coalesce(sum(c.collected),0)::int as collected, coalesce(sum(coalesce(r.received,0)),0)::int as received, coalesce(sum(greatest(c.collected - coalesce(r.received,0),0)),0)::int as outstanding
    from (select s.offer_id, sum(s.cod_collected_cents) as collected from shipments s join requests q on q.id = s.request_id
          where q.business_id = ${businessId} and s.status = 'delivered' and s.cod_collected_cents is not null and s.offer_id is not null group by s.offer_id) c
    left join (select offer_id, sum(amount_cents) as received from cod_remittances where business_id = ${businessId} group by offer_id) r on r.offer_id = c.offer_id`);
  const x = r.rows[0];
  return { collectedCents: Number(x?.collected ?? 0), receivedCents: Number(x?.received ?? 0), outstandingCents: Number(x?.outstanding ?? 0) };
}

/** Numbers behind the Overview tab. A section the viewer has no permission for is `null` (the page hides it) instead of failing the whole call. */
export async function companyOverview(viewer: User, id: string) {
  requireCompanyView(viewer);
  await companyRow(id);
  const money = can(viewer, "finance.view") || can(viewer, "wallets.view");
  const seeOrders = can(viewer, "requests.view");
  const [byStatus, recent, wallet, spent, cod, tix, cmp, docs] = await Promise.all([
    seeOrders ? db.select({ status: requests.status, n: count() }).from(requests).where(eq(requests.businessId, id)).groupBy(requests.status) : null,
    seeOrders ? db.select().from(requests).where(eq(requests.businessId, id)).orderBy(desc(requests.createdAt)).limit(5) : null,
    money ? db.select().from(walletAccounts).where(eq(walletAccounts.ownerId, id)) : null,
    can(viewer, "finance.view") ? db.select({ s: sql<number>`coalesce(sum(${settlements.customerCents}),0)::int`, n: count() }).from(settlements).where(and(eq(settlements.businessId, id), eq(settlements.status, "paid"))) : null,
    can(viewer, "cod.manage") || can(viewer, "finance.view") ? codFigures(id) : null,
    can(viewer, "tickets.view") ? db.select({ n: count() }).from(tickets).where(and(eq(tickets.openedBy, id), inArray(tickets.status, ["open", "in_review"]))) : null,
    can(viewer, "complaints.manage") ? db.select({ n: count() }).from(complaints).where(and(eq(complaints.filedBy, id), inArray(complaints.status, ["open", "in_progress"]))) : null,
    can(viewer, "documents.review") || can(viewer, "verification.manage") ? db.select({ type: documents.type, status: documents.status }).from(documents).where(eq(documents.ownerId, id)) : null,
  ]);
  const by = byStatus ? Object.fromEntries(byStatus.map((r) => [r.status, Number(r.n)])) : null;
  const sum = (keys: string[]) => (by ? keys.reduce((a, k) => a + (by[k] ?? 0), 0) : 0);
  const priced = can(viewer, "finance.view") || can(viewer, "pricing.view");
  const required = BUSINESS_DOC_TYPES.filter((d) => d.required);
  return {
    orders: by ? { byStatus: by, total: Object.values(by).reduce((a, n) => a + n, 0), open: sum(ACTIVE), completed: sum(["completed"]), draft: sum(["draft"]), lost: sum(["cancelled", "expired"]) } : null,
    recent: recent ? recent.map((r) => ({ id: r.id, ref: r.ref, service: r.service, status: r.status, pickupCity: r.pickupCity, deliveryCity: r.deliveryCity, startsAt: r.startsAt, quantity: r.quantity, totalCents: priced ? r.totalCents : null, createdAt: r.createdAt })) : null,
    wallet: wallet ? { availableCents: wallet[0]?.availableCents ?? 0, reservedCents: wallet[0]?.reservedCents ?? 0, heldCents: wallet[0]?.heldCents ?? 0, creditLimitCents: wallet[0]?.creditLimitCents ?? 0 } : null,
    spend: spent ? { billedCents: Number(spent[0].s), settlements: Number(spent[0].n) } : null,
    cod,
    support: tix || cmp ? { openTickets: tix ? Number(tix[0].n) : null, openComplaints: cmp ? Number(cmp[0].n) : null } : null,
    documents: docs ? {
      total: docs.length, toReview: docs.filter((d) => ["submitted", "under_review"].includes(d.status)).length, requiredTotal: required.length,
      requiredApproved: required.filter((r) => docs.some((d) => d.type === r.key && d.status === "approved")).length,
    } : null,
  };
}

/** Queue sizes for the verification workspace (KPI row and tab badges). Each section follows the permission that opens its queue. */
export async function verificationSummary(viewer: User) {
  requirePerm(viewer, "verification.manage", "offices.view", "documents.review");
  const docsAllowed = can(viewer, "documents.review") || can(viewer, "verification.manage");
  const [biz, off, drv, docs] = await Promise.all([
    db.select({ status: businessProfiles.verificationStatus, n: count() }).from(businessProfiles).where(inArray(businessProfiles.verificationStatus, ["pending", "info_requested"])).groupBy(businessProfiles.verificationStatus),
    db.select({ status: officeProfiles.verificationStatus, n: count() }).from(officeProfiles).where(inArray(officeProfiles.verificationStatus, ["pending", "info_requested"])).groupBy(officeProfiles.verificationStatus),
    db.select({ n: count() }).from(driverProfiles).where(eq(driverProfiles.verificationStatus, "pending")),
    docsAllowed ? db.select({ kind: documents.ownerKind, n: count() }).from(documents).where(eq(documents.status, "submitted")).groupBy(documents.ownerKind) : null,
  ]);
  const pick = (rows: Array<{ status: string; n: number }>, s: string) => Number(rows.find((r) => r.status === s)?.n ?? 0);
  const docKinds = docs ? Object.fromEntries(docs.map((d) => [d.kind, Number(d.n)])) : null;
  return {
    business: { pending: pick(biz, "pending"), infoRequested: pick(biz, "info_requested") },
    offices: { pending: pick(off, "pending"), infoRequested: pick(off, "info_requested") },
    drivers: { pending: Number(drv[0].n) },
    documents: docKinds ? { total: Object.values(docKinds).reduce((a, n) => a + n, 0), byKind: docKinds } : null,
  };
}

