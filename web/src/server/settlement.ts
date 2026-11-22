import { and, desc, eq, gte, ilike, inArray, lt, or, sql, count, sum } from "drizzle-orm";
import { contains } from "@/lib/sql";
import { db, type DB, type Exec } from "@/db";
import {
  settlements, requests, driverProfiles, withdrawals, invoices, complaints, users, walletAccounts, businessProfiles, officeProfiles,
  type Request, type Offer, type User,
} from "@/db/schema";
import { err } from "@/lib/errors";
import { logError } from "@/lib/log";
import { getSettings } from "./settings";
import { ensureAccount, platformAccount, post } from "./wallet";
import { audit } from "./audit";
import { notify } from "./notify";
import { logEvent } from "./events";
import { nextSeq } from "./counters";
import { requirePerm } from "./auth/permissions";

type Snap = { unitPriceCents: number; providerCostCents: number; expectedUnits: number; ruleVersion: number };

/** What a person should read about a failed payout: the database's own message (drizzle wraps it in "Failed query: …" and keeps the reason in `cause`). */
const why = (e: unknown) => { const m = (e as { cause?: { message?: string } } | null)?.cause?.message ?? (e instanceof Error ? e.message : "payout error"); return m.slice(0, 200); };

/** VAT extracted from a VAT-inclusive total (decisions #5 / A6) — the one formula for invoices and settlements. Halalas in, halalas out (never a float). */
export const vatOf = (totalCents: number, vatPct: number) => Math.round((totalCents * vatPct) / (100 + vatPct));

/**
 * Issues the tax invoice of a charge: a settled job (`settlementId`) or a fulfilled driverless rental (no settlement). The number comes from a counter that shares the caller's
 * transaction, so numbers are gapless and a rolled-back payout never burns one. VAT is extracted at the rate in force NOW (the tax point is the invoice, not the order).
 */
export async function issueInvoice(tx: Exec, i: { requestId: string; settlementId: string | null; businessId: string; totalCents: number }) {
  const cfg = await getSettings(tx);
  const pct = Math.round(cfg.vatPct); // `invoices.vat_pct` is an integer column; the API only accepts whole percents, this keeps an older fractional setting from failing every payout
  const vat = vatOf(i.totalCents, pct);
  const number = `INV-${String(await nextSeq(tx, "invoice")).padStart(6, "0")}`;
  const [row] = await tx.insert(invoices).values({ number, requestId: i.requestId, settlementId: i.settlementId, businessId: i.businessId, subtotalCents: i.totalCents - vat, vatCents: vat, totalCents: i.totalCents, vatPct: pct }).onConflictDoNothing().returning();
  return row ?? null;
}

/**
 * Create the one-and-only settlement for an offer. Idempotent via UNIQUE(offer_id).
 * customer = unit price × final units; provider = provider cost × final units; margin = difference.
 * Any difference to the slot's reserved share is refunded (or charged) at payout.
 */
export async function createSettlement(tx: Exec, r: Request, o: Offer) {
  if (o.finalUnits == null) throw err("INVALID_TRANSITION", "Final quantity not confirmed");
  const s = await getSettings(tx);
  const snap = r.pricingSnapshot as unknown as Snap;
  const reserved = snap.unitPriceCents * o.expectedUnits;
  const customer = snap.unitPriceCents * o.finalUnits;
  const provider = snap.providerCostCents * o.finalUnits;
  const margin = customer - provider;
  const [row] = await tx.insert(settlements).values({
    requestId: r.id, offerId: o.id, driverId: o.driverId, officeId: o.officeId, businessId: r.businessId, // office = snapshot from when the offer was made, never re-derived from the driver's current link
    finalUnits: o.finalUnits, reservedCents: reserved, customerCents: customer, providerCents: provider, marginCents: margin,
    vatCents: vatOf(customer, Math.round(s.vatPct)), refundCents: reserved - customer, pricingSnapshot: snap as never,
    status: "approved", approvedAt: new Date(), // no review / approval step (E18): ready to pay the moment it exists
  }).onConflictDoNothing({ target: settlements.offerId }).returning();
  return row ?? null;
}

const lock = async (tx: Exec, id: string) => {
  const [s] = await tx.select().from(settlements).where(eq(settlements.id, id)).for("update");
  if (!s) throw err("NOT_FOUND", "Settlement not found");
  return s;
};

/** Open complaints/disputes tied to the job block money movement. */
async function blockingComplaint(tx: Exec, requestId: string, offerId: string) {
  const [c] = await tx.select({ id: complaints.id }).from(complaints).where(and(
    eq(complaints.holdsSettlement, true), inArray(complaints.status, ["open", "in_progress"]),
    sql`(${complaints.offerId} = ${offerId} or (${complaints.offerId} is null and ${complaints.requestId} = ${requestId}))`)).limit(1);
  return !!c;
}

/** Moves money for one approved settlement. Balanced: provider + margin = customer charge. */
export async function payoutTx(tx: Exec, id: string, actor: User | null) {
  return (await payoutCore(tx, id, actor)).row;
}
/** `applied:false` = it was already paid (a concurrent batch got there first); nothing moved. */
async function payoutCore(tx: Exec, id: string, actor: User | null): Promise<{ row: typeof settlements.$inferSelect; applied: boolean }> {
  const s = await lock(tx, id);
  if (s.status === "paid") return { row: s, applied: false }; // idempotent
  if (!["approved", "failed"].includes(s.status)) throw err("INVALID_TRANSITION", `Settlement is ${s.status}`);
  if (await blockingComplaint(tx, s.requestId, s.offerId)) throw err("DISPUTE_BLOCKS", "An open complaint holds this settlement");
  const biz = await ensureAccount(s.businessId, tx);
  const payee = await ensureAccount(s.officeId ?? s.driverId, tx);
  const plat = await platformAccount(tx);
  const k = (n: string) => `settle:${s.id}:${n}`;
  // Business: release the slot reserve, then pay any shortfall/refund the difference.
  await post(tx, { accountId: biz.id, kind: "release_reserve", reserved: -s.reservedCents, available: s.reservedCents, idempotencyKey: k("release"), requestId: s.requestId, settlementId: s.id, actorId: actor?.id });
  await post(tx, { accountId: biz.id, kind: "charge", available: -s.customerCents, idempotencyKey: k("charge"), requestId: s.requestId, settlementId: s.id, actorId: actor?.id });
  await post(tx, { accountId: payee.id, kind: "payout", available: s.providerCents, idempotencyKey: k("payout"), requestId: s.requestId, offerId: s.offerId, settlementId: s.id, actorId: actor?.id });
  await post(tx, { accountId: plat.id, kind: "platform_fee", available: s.marginCents, idempotencyKey: k("fee"), requestId: s.requestId, settlementId: s.id, actorId: actor?.id });
  await tx.update(requests).set({ reservedCents: sql`${requests.reservedCents} - ${s.reservedCents}` }).where(eq(requests.id, s.requestId));
  const inv = await issueInvoice(tx, { requestId: s.requestId, settlementId: s.id, businessId: s.businessId, totalCents: s.customerCents });
  // The settlement may have waited for a complaint to clear while the VAT rate changed: the settlement's VAT is the one that was invoiced.
  const [u] = await tx.update(settlements).set({ status: "paid", paidAt: new Date(), updatedAt: new Date(), ...(inv ? { vatCents: inv.vatCents } : {}) }).where(eq(settlements.id, id)).returning();
  await tx.update(driverProfiles).set({ jobsCompleted: sql`${driverProfiles.jobsCompleted} + 1` }).where(eq(driverProfiles.userId, s.driverId));
  await notify(s.officeId ?? s.driverId, "payout_paid", { amountCents: s.providerCents }, tx);
  await logEvent(tx, { requestId: s.requestId, offerId: s.offerId, actor: actor ? { id: actor.id, name: actor.name, role: actor.role } : null, type: "payout_paid", payload: { settlementId: s.id } });
  await audit(actor, "settlement.pay", "settlement", id, { provider: s.providerCents, margin: s.marginCents }, tx);
  return { row: u, applied: true };
}

/**
 * E18 — the one money step: when a driver's work ends, the settlement is created and PAID in the same transaction
 * (business reserve released, customer charged, payee — the office or the driver — credited, platform margin booked, invoice issued).
 * An open complaint that holds the job defers the payment; `paySettlementsDue` pays it once the hold is lifted.
 */
export async function settleOffer(tx: Exec, r: Request, o: Offer) {
  const created = await createSettlement(tx, r, o);
  const row = created ?? (await tx.select().from(settlements).where(eq(settlements.offerId, o.id)))[0];
  if (!row) return null;
  if (row.status === "paid") return row;
  if (await blockingComplaint(tx, row.requestId, row.offerId)) return row; // stays `approved` (= on hold)
  // The money moves inside a SAVEPOINT: if anything fails while paying (a lock timeout, a deadlock with another payout, a constraint), the driver's finished work must not be undone —
  // before this, the error rolled back the whole delivery report and left the job stuck. The settlement is then marked `failed` (its escrow share stays reserved) and the housekeeping
  // tick retries it; Finance sees it as "waiting" in the overview.
  try { return await (tx as unknown as DB).transaction((sp) => payoutTx(sp, row.id, null)); }
  catch (e) {
    logError(e, { correlationId: `settle:${row.id}` });
    const [u] = await tx.update(settlements).set({ status: "failed", note: why(e), updatedAt: new Date() }).where(eq(settlements.id, row.id)).returning();
    return u;
  }
}

/** Offers whose settlement has not been paid yet (held, failed, legacy): their escrow share must stay reserved. */
export async function unpaidOfferIds(tx: Exec, offerIds: string[]) {
  if (!offerIds.length) return new Set<string>();
  const paid = await tx.select({ id: settlements.offerId }).from(settlements).where(and(inArray(settlements.offerId, offerIds), eq(settlements.status, "paid")));
  const ok = new Set(paid.map((p) => p.id));
  return new Set(offerIds.filter((id) => !ok.has(id)));
}

/**
 * Escrow (halalas) that `live` offers of a request still need: the shares of the offers whose settlement is not paid yet. A paid settlement already released its own share from the
 * request's reserve, so it must NOT be taken off again when the rest of the reserve is returned (cancellation, closing open slots, completion).
 */
export async function escrowStillNeeded(tx: Exec, r: Pick<Request, "unitPriceCents">, live: Offer[]) {
  const unpaid = await unpaidOfferIds(tx, live.map((o) => o.id));
  return live.filter((o) => unpaid.has(o.id)).reduce((a, o) => a + (r.unitPriceCents ?? 0) * o.expectedUnits, 0);
}

/**
 * Housekeeping: pays every settlement that is not paid yet and is no longer held (hold released, a transient failure, or a settlement created
 * by the old review/approve flow). Each in its own transaction, so one problem never blocks the rest. Returns how many were paid.
 */
export async function paySettlementsDue(limit = 100) {
  // Held settlements (an open complaint) are left out of the window: otherwise `limit` of them would crowd out every payable settlement behind them. Oldest attempt first, so a
  // settlement that keeps failing moves to the back (its `updatedAt` changes on every failure) instead of starving the rest.
  const due = await db.select({ id: settlements.id }).from(settlements).where(and(inArray(settlements.status, ["pending_review", "reviewed", "approved", "failed"]),
    sql`not exists (select 1 from complaints c where c.holds_settlement and c.status in ('open','in_progress') and (c.offer_id = ${settlements.offerId} or (c.offer_id is null and c.request_id = ${settlements.requestId})))`))
    .orderBy(settlements.updatedAt, settlements.createdAt).limit(limit);
  let paid = 0;
  for (const d of due) {
    try {
      const applied = await db.transaction(async (tx) => {
        const s = await lock(tx, d.id);
        if (s.status === "paid" || (await blockingComplaint(tx, s.requestId, s.offerId))) return false;
        if (s.status !== "approved") await tx.update(settlements).set({ status: "approved", approvedAt: new Date(), updatedAt: new Date() }).where(eq(settlements.id, s.id));
        return (await payoutCore(tx, d.id, null)).applied;
      });
      if (applied) paid++;
    } catch (e) {
      logError(e, { correlationId: `settle:${d.id}` });
      await db.update(settlements).set({ status: "failed", note: why(e), updatedAt: new Date() }).where(and(eq(settlements.id, d.id), inArray(settlements.status, ["approved", "pending_review", "reviewed", "failed"])));
    }
  }
  return paid;
}

export async function listSettlements(f: { status?: string; q?: string; page?: number; pageSize?: number; payeeId?: string; businessId?: string; from?: Date; to?: Date }) {
  const pageSize = Math.min(f.pageSize ?? 25, 100), page = Math.max(f.page ?? 1, 1);
  const where = and(
    f.status ? eq(settlements.status, f.status) : undefined,
    f.payeeId ? sql`coalesce(${settlements.officeId}, ${settlements.driverId}) = ${f.payeeId}` : undefined,
    f.businessId ? eq(settlements.businessId, f.businessId) : undefined,
    f.from ? gte(settlements.createdAt, f.from) : undefined, f.to ? lt(settlements.createdAt, f.to) : undefined,
    // free text: the order reference, the driver's name, or a parcel code / warehouse reference of that job
    f.q?.trim() ? or(ilike(requests.ref, contains(f.q.trim())), ilike(users.name, contains(f.q.trim())),
      sql`exists (select 1 from shipments sh where sh.request_id = ${settlements.requestId} and sh.offer_id = ${settlements.offerId} and (upper(sh.code) = upper(${f.q.trim()}) or lower(sh.external_ref) = lower(${f.q.trim()})))`) : undefined,
  );
  const [rows, [{ total }]] = await Promise.all([
    db.select({ s: settlements, ref: requests.ref, driver: users.name }).from(settlements).innerJoin(requests, eq(requests.id, settlements.requestId)).innerJoin(users, eq(users.id, settlements.driverId))
      .where(where).orderBy(desc(settlements.createdAt)).limit(pageSize).offset((page - 1) * pageSize),
    db.select({ total: count() }).from(settlements).innerJoin(requests, eq(requests.id, settlements.requestId)).innerJoin(users, eq(users.id, settlements.driverId)).where(where),
  ]);
  // Names for the payee office and the paying business in one extra query (no per-row lookups).
  const ids = [...new Set(rows.flatMap(({ s: x }) => [x.officeId, x.businessId].filter(Boolean) as string[]))];
  const names = ids.length ? await db.select({ id: users.id, name: users.name, company: businessProfiles.companyName, office: officeProfiles.officeName }).from(users)
    .leftJoin(businessProfiles, eq(businessProfiles.userId, users.id)).leftJoin(officeProfiles, eq(officeProfiles.userId, users.id)).where(inArray(users.id, ids)) : [];
  const nm = new Map(names.map((n) => [n.id, n.company ?? n.office ?? n.name]));
  const held = rows.length ? await db.select({ offerId: complaints.offerId, requestId: complaints.requestId }).from(complaints).where(and(eq(complaints.holdsSettlement, true), inArray(complaints.status, ["open", "in_progress"]))) : [];
  const heldOffers = new Set(held.map((h) => h.offerId).filter(Boolean)), heldRequests = new Set(held.filter((h) => !h.offerId).map((h) => h.requestId));
  const items = rows.map(({ s: x, ref, driver }) => ({ ...x, held: heldOffers.has(x.offerId) || heldRequests.has(x.requestId), ref, driverName: driver, officeName: x.officeId ? nm.get(x.officeId) ?? null : null, businessName: nm.get(x.businessId) ?? null }));
  return { items, page, pageSize, total: Number(total) };
}

// ───────── Withdrawals ─────────
export async function requestWithdrawal(user: User, amountCents: number) {
  const cfg = await getSettings();
  if (!["driver", "office"].includes(user.role)) throw err("FORBIDDEN");
  if (!Number.isInteger(amountCents) || amountCents < cfg.minWithdrawalCents) throw err("VALIDATION", "Amount below minimum withdrawal", { min: cfg.minWithdrawalCents });
  return db.transaction(async (tx) => {
    let iban: string | null = null, bank: string | null = null;
    if (user.role === "driver") {
      const [p] = await tx.select().from(driverProfiles).where(eq(driverProfiles.userId, user.id));
      // J4: a driver of an office does not manage a wallet at all — the office is paid and handles payouts (the wallet comes back if he leaves the office).
      if (p?.officeId) throw err("WALLET_MANAGED_BY_OFFICE", "Your wallet is managed by your office");
      iban = p?.iban ?? null; bank = p?.bankName ?? null;
    } else {
      const { officeProfiles } = await import("@/db/schema");
      const [p] = await tx.select().from(officeProfiles).where(eq(officeProfiles.userId, user.id));
      iban = p?.iban ?? null; bank = p?.bankName ?? null;
    }
    if (!iban) throw err("VALIDATION", "Add your IBAN in your profile first", { field: "iban" });
    const acct = await ensureAccount(user.id, tx);
    const [w] = await tx.insert(withdrawals).values({ userId: user.id, amountCents, iban, bankName: bank }).returning();
    await post(tx, { accountId: acct.id, kind: "withdrawal_hold", available: -amountCents, held: amountCents, idempotencyKey: `wd-hold:${w.id}`, actorId: user.id });
    return w;
  });
}

export async function decideWithdrawal(actor: User, id: string, decision: "paid" | "rejected", opts: { paymentRef?: string; note?: string }) {
  requirePerm(actor, "withdrawals.manage");
  if (decision === "paid" && !opts.paymentRef?.trim()) throw err("VALIDATION", "Payment reference required", { field: "paymentRef" });
  if (decision === "rejected" && !opts.note?.trim()) throw err("VALIDATION", "Reason required", { field: "note" });
  return db.transaction(async (tx) => {
    const [w] = await tx.select().from(withdrawals).where(eq(withdrawals.id, id)).for("update");
    if (!w) throw err("NOT_FOUND");
    if (w.status !== "pending") throw err("INVALID_TRANSITION", `Withdrawal is ${w.status}`);
    const acct = await ensureAccount(w.userId, tx);
    if (decision === "paid") await post(tx, { accountId: acct.id, kind: "withdrawal_paid", held: -w.amountCents, idempotencyKey: `wd-paid:${w.id}`, actorId: actor.id, note: opts.paymentRef });
    else await post(tx, { accountId: acct.id, kind: "withdrawal_release", held: -w.amountCents, available: w.amountCents, idempotencyKey: `wd-rel:${w.id}`, actorId: actor.id });
    const [u] = await tx.update(withdrawals).set({ status: decision, decidedBy: actor.id, decidedAt: new Date(), paymentRef: opts.paymentRef ?? null, note: opts.note ?? null }).where(eq(withdrawals.id, id)).returning();
    await notify(w.userId, decision === "paid" ? "withdrawal_paid" : "withdrawal_rejected", { amountCents: w.amountCents }, tx);
    await audit(actor, `withdrawal.${decision}`, "withdrawal", id, { amount: w.amountCents }, tx);
    return u;
  });
}

export async function platformSummary() {
  const plat = await db.transaction((tx) => platformAccount(tx));
  const [paid] = await db.select({ n: count(), s: sum(settlements.marginCents) }).from(settlements).where(eq(settlements.status, "paid"));
  const [pend] = await db.select({ n: count(), s: sum(settlements.providerCents) }).from(settlements).where(inArray(settlements.status, ["pending_review", "reviewed", "approved", "failed"]));
  const [liab] = await db.select({ avail: sum(walletAccounts.availableCents), res: sum(walletAccounts.reservedCents), held: sum(walletAccounts.heldCents) }).from(walletAccounts).where(eq(walletAccounts.kind, "user"));
  return {
    platformRevenueCents: plat.availableCents, paidSettlements: Number(paid.n), marginCents: Number(paid.s ?? 0),
    pendingSettlements: Number(pend.n), pendingPayoutCents: Number(pend.s ?? 0),
    userBalances: { availableCents: Number(liab.avail ?? 0), reservedCents: Number(liab.res ?? 0), heldCents: Number(liab.held ?? 0) },
  };
}
export { users };
