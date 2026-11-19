import { and, count, eq, gte, ilike, inArray, lt, or, sql, sum } from "drizzle-orm";
import { db } from "@/db";
import { invoices, ledgerEntries, requests, settlements, users, walletAccounts, withdrawals, type User } from "@/db/schema";
import { contains } from "@/lib/sql";
import { requirePerm } from "./auth/permissions";
import { platformSummary } from "./settlement";

/**
 * Aggregates behind the redesigned finance pages (overview KPIs, per-list totals, cash held by drivers).
 * Every function checks the same permission the page it feeds is shown with, and every list total takes the SAME filters as the list,
 * so a KPI never disagrees with the rows under it.
 */

type Range = { from?: Date; to?: Date };
const between = (col: Parameters<typeof gte>[0], f: Range) => [f.from ? gte(col, f.from) : undefined, f.to ? lt(col, f.to) : undefined];
const num = (v: unknown) => Number(v ?? 0);

// ───────── Cash on delivery, per driver ─────────
export interface CodDriverRow { driverId: string; driverName: string; orders: number; openOrders: number; collectedCents: number; receivedCents: number; outstandingCents: number; lastCollectedAt: string | null }

/**
 * Same figures as `cashOrders` in cod.ts (collected on delivered parcels − remittances, per order, never below zero), grouped by driver.
 * `q` matches the order reference, the driver or the warehouse name, like the order list does.
 */
async function codDriverRows(f: { businessId?: string; q?: string }): Promise<CodDriverRow[]> {
  const q = f.q?.trim() ? contains(f.q.trim()) : null;
  const res = await db.execute(sql`
    with col as (
      select sh.offer_id, sum(sh.cod_collected_cents)::int as collected, max(sh.cod_collected_at) as last_at
      from shipments sh where sh.status = 'delivered' and sh.cod_collected_cents is not null and sh.offer_id is not null group by sh.offer_id
    ), rec as (
      select offer_id, sum(amount_cents)::int as received from cod_remittances group by offer_id
    )
    select o.driver_id as "driverId", u.name as "driverName", count(*)::int as "orders",
      (count(*) filter (where col.collected > coalesce(rec.received, 0)))::int as "openOrders",
      coalesce(sum(col.collected), 0)::int as "collectedCents", coalesce(sum(coalesce(rec.received, 0)), 0)::int as "receivedCents",
      coalesce(sum(greatest(col.collected - coalesce(rec.received, 0), 0)), 0)::int as "outstandingCents", max(col.last_at) as "lastCollectedAt"
    from col
    join offers o on o.id = col.offer_id join requests r on r.id = o.request_id join users u on u.id = o.driver_id
    left join business_profiles bp on bp.user_id = r.business_id left join users bu on bu.id = r.business_id
    left join rec on rec.offer_id = col.offer_id
    where ${f.businessId ? sql`r.business_id = ${f.businessId}` : sql`true`}
      and ${q ? sql`(r.ref ilike ${q} or u.name ilike ${q} or coalesce(bp.company_name, bu.name) ilike ${q})` : sql`true`}
    group by o.driver_id, u.name
    order by "outstandingCents" desc, u.name
  `);
  return (res.rows as Array<Record<string, unknown>>).map((r) => ({
    driverId: String(r.driverId), driverName: String(r.driverName), orders: num(r.orders), openOrders: num(r.openOrders),
    collectedCents: num(r.collectedCents), receivedCents: num(r.receivedCents), outstandingCents: num(r.outstandingCents),
    lastCollectedAt: r.lastCollectedAt ? new Date(r.lastCollectedAt as string | Date).toISOString() : null,
  }));
}
const codTotals = (rows: CodDriverRow[]) => rows.reduce((a, r) => ({
  collectedCents: a.collectedCents + r.collectedCents, receivedCents: a.receivedCents + r.receivedCents, outstandingCents: a.outstandingCents + r.outstandingCents,
  drivers: a.drivers + (r.outstandingCents > 0 ? 1 : 0), orders: a.orders + r.openOrders,
}), { collectedCents: 0, receivedCents: 0, outstandingCents: 0, drivers: 0, orders: 0 });

/** Cash held by drivers: totals plus one row per driver (those who owe cash first). */
export async function codDrivers(staff: User, f: { businessId?: string; q?: string; onlyOutstanding?: boolean } = {}) {
  requirePerm(staff, "cod.manage", "finance.view");
  const all = await codDriverRows(f);
  const items = f.onlyOutstanding ? all.filter((r) => r.outstandingCents > 0) : all;
  return { totals: codTotals(all), items, total: items.length };
}

// ───────── Overview ─────────
const UNPAID = ["pending_review", "reviewed", "approved", "failed"];

/**
 * The numbers of the Finance overview: platform money, settlements on hold, wallet liability, pending withdrawals, cash with drivers.
 * "On hold" is the E18 state `approved` (an open complaint blocks the automatic payment); older unpaid states are counted apart as `waiting`.
 */
export async function financeOverview(staff: User) {
  requirePerm(staff, "finance.view");
  const [summary, [wd], unpaid, [blocked], cod] = await Promise.all([
    platformSummary(),
    db.select({ n: count(), s: sum(withdrawals.amountCents), oldest: sql<string | null>`min(${withdrawals.createdAt})` }).from(withdrawals).where(eq(withdrawals.status, "pending")),
    db.select({ status: settlements.status, n: count(), s: sum(settlements.providerCents) }).from(settlements).where(inArray(settlements.status, UNPAID)).groupBy(settlements.status),
    db.select({ n: count() }).from(settlements).where(and(inArray(settlements.status, UNPAID),
      sql`exists (select 1 from complaints c where c.holds_settlement and c.status in ('open','in_progress') and (c.offer_id = ${settlements.offerId} or (c.offer_id is null and c.request_id = ${settlements.requestId})))`)),
    codDriverRows({}),
  ]);
  const held = unpaid.find((r) => r.status === "approved");
  const waiting = unpaid.filter((r) => r.status !== "approved");
  const totals = codTotals(cod);
  return {
    platformRevenueCents: summary.platformRevenueCents, paidSettlements: summary.paidSettlements, marginCents: summary.marginCents,
    settlements: {
      heldN: Number(held?.n ?? 0), heldCents: num(held?.s), blockedByComplaintN: Number(blocked.n),
      waitingN: waiting.reduce((a, r) => a + Number(r.n), 0), waitingCents: waiting.reduce((a, r) => a + num(r.s), 0),
    },
    balances: summary.userBalances,
    withdrawals: { pendingN: Number(wd.n), pendingCents: num(wd.s), oldestAt: wd.oldest ? new Date(wd.oldest).toISOString() : null },
    cod: { ...totals, top: cod.filter((r) => r.outstandingCents > 0).slice(0, 3) },
  };
}

// ───────── Settlements ─────────
/** Same filters as `listSettlements` except the status (the counts per status ARE the status filter's badges). */
export async function settlementStats(staff: User, f: { q?: string; payeeId?: string; businessId?: string } & Range) {
  requirePerm(staff, "finance.view", "settlements.review");
  const q = f.q?.trim();
  const where = and(
    f.payeeId ? sql`coalesce(${settlements.officeId}, ${settlements.driverId}) = ${f.payeeId}` : undefined,
    f.businessId ? eq(settlements.businessId, f.businessId) : undefined,
    ...between(settlements.createdAt, f),
    q ? or(ilike(requests.ref, contains(q)), ilike(users.name, contains(q)),
      sql`exists (select 1 from shipments sh where sh.request_id = ${settlements.requestId} and sh.offer_id = ${settlements.offerId} and (upper(sh.code) = upper(${q}) or lower(sh.external_ref) = lower(${q})))`) : undefined,
  );
  const rows = await db.select({ status: settlements.status, n: count(), customer: sum(settlements.customerCents), provider: sum(settlements.providerCents), margin: sum(settlements.marginCents) })
    .from(settlements).innerJoin(requests, eq(requests.id, settlements.requestId)).innerJoin(users, eq(users.id, settlements.driverId)).where(where).groupBy(settlements.status);
  const zero = () => ({ n: 0, customerCents: 0, providerCents: 0, marginCents: 0 });
  const out = { all: zero(), paid: zero(), hold: zero(), other: zero() };
  for (const r of rows) {
    const k = r.status === "paid" ? "paid" : r.status === "approved" ? "hold" : "other";
    for (const b of [out[k], out.all]) { b.n += Number(r.n); b.customerCents += num(r.customer); b.providerCents += num(r.provider); b.marginCents += num(r.margin); }
  }
  return out;
}

// ───────── Withdrawals ─────────
export async function withdrawalStats(staff: User) {
  requirePerm(staff, "finance.view", "withdrawals.manage");
  const rows = await db.select({ status: withdrawals.status, n: count(), s: sum(withdrawals.amountCents), oldest: sql<string | null>`min(${withdrawals.createdAt})` }).from(withdrawals).groupBy(withdrawals.status);
  const zero = () => ({ n: 0, cents: 0 });
  const out = { all: zero(), pending: { ...zero(), oldestAt: null as string | null }, paid: zero(), rejected: zero() };
  for (const r of rows) {
    out.all.n += Number(r.n); out.all.cents += num(r.s);
    if (r.status === "pending") out.pending = { n: Number(r.n), cents: num(r.s), oldestAt: r.oldest ? new Date(r.oldest).toISOString() : null };
    else if (r.status === "paid" || r.status === "rejected") out[r.status] = { n: Number(r.n), cents: num(r.s) };
  }
  return out;
}

// ───────── Ledger ─────────
/** Money in / out of the entries `listLedger` would return for the same filters (available balance only; reserved and held are reported separately). */
export async function ledgerTotals(staff: User, f: { kind?: string; userId?: string; requestId?: string } & Range) {
  requirePerm(staff, "finance.view", "wallets.view");
  const where = and(f.kind ? eq(ledgerEntries.kind, f.kind) : undefined, f.userId ? eq(walletAccounts.ownerId, f.userId) : undefined, f.requestId ? eq(ledgerEntries.requestId, f.requestId) : undefined, ...between(ledgerEntries.createdAt, f));
  const [r] = await db.select({
    n: count(),
    inCents: sql<number>`coalesce(sum(case when ${ledgerEntries.availableDeltaCents} > 0 then ${ledgerEntries.availableDeltaCents} end), 0)`,
    outCents: sql<number>`coalesce(sum(case when ${ledgerEntries.availableDeltaCents} < 0 then -${ledgerEntries.availableDeltaCents} end), 0)`,
    reservedNetCents: sql<number>`coalesce(sum(${ledgerEntries.reservedDeltaCents}), 0)`,
    heldNetCents: sql<number>`coalesce(sum(${ledgerEntries.heldDeltaCents}), 0)`,
  }).from(ledgerEntries).innerJoin(walletAccounts, eq(walletAccounts.id, ledgerEntries.accountId)).where(where);
  return { entries: Number(r.n), inCents: num(r.inCents), outCents: num(r.outCents), netCents: num(r.inCents) - num(r.outCents), reservedNetCents: num(r.reservedNetCents), heldNetCents: num(r.heldNetCents) };
}

// ───────── Invoices ─────────
export async function invoiceTotals(staff: User, f: { businessId?: string } & Range) {
  requirePerm(staff, "finance.view");
  const where = and(f.businessId ? eq(invoices.businessId, f.businessId) : undefined, ...between(invoices.createdAt, f));
  const [r] = await db.select({ n: count(), sub: sum(invoices.subtotalCents), vat: sum(invoices.vatCents), total: sum(invoices.totalCents) }).from(invoices).where(where);
  return { invoices: Number(r.n), subtotalCents: num(r.sub), vatCents: num(r.vat), totalCents: num(r.total) };
}
