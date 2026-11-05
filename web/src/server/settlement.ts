import { and, desc, eq, inArray, sql, count, sum } from "drizzle-orm";
import { db, type Exec } from "@/db";
import {
  settlements, offers, requests, driverProfiles, payoutBatches, withdrawals, invoices, complaints, users, walletAccounts,
  type Request, type Offer, type User,
} from "@/db/schema";
import { err } from "@/lib/errors";
import { pct } from "@/lib/money";
import { getSettings } from "./settings";
import { ensureAccount, platformAccount, post } from "./wallet";
import { audit } from "./audit";
import { notify } from "./notify";
import { logEvent } from "./events";
import { nextRef, nextSeq } from "./counters";
import { requirePerm } from "./auth/permissions";

type Snap = { unitPriceCents: number; providerCostCents: number; expectedUnits: number; ruleVersion: number };

/**
 * Create the one-and-only settlement for an offer. Idempotent via UNIQUE(offer_id).
 * customer = unit price × final units; provider = provider cost × final units; margin = difference.
 * Any difference to the slot's reserved share is refunded (or charged) at payout.
 */
export async function createSettlement(tx: Exec, r: Request, o: Offer) {
  if (o.finalUnits == null) throw err("INVALID_TRANSITION", "Final quantity not confirmed");
  const s = await getSettings(tx);
  const snap = r.pricingSnapshot as unknown as Snap;
  const [drv] = await tx.select().from(driverProfiles).where(eq(driverProfiles.userId, o.driverId));
  const reserved = snap.unitPriceCents * o.expectedUnits;
  const customer = snap.unitPriceCents * o.finalUnits;
  const provider = snap.providerCostCents * o.finalUnits;
  const margin = customer - provider;
  const [row] = await tx.insert(settlements).values({
    requestId: r.id, offerId: o.id, driverId: o.driverId, officeId: o.officeId ?? drv?.officeId ?? null, businessId: r.businessId,
    finalUnits: o.finalUnits, reservedCents: reserved, customerCents: customer, providerCents: provider, marginCents: margin,
    vatCents: pct(margin, s.vatPct), refundCents: reserved - customer, pricingSnapshot: snap as never,
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

export async function reviewSettlement(actor: User, id: string) {
  requirePerm(actor, "settlements.review");
  return db.transaction(async (tx) => {
    const s = await lock(tx, id);
    if (s.status !== "pending_review") throw err("INVALID_TRANSITION", `Cannot review a ${s.status} settlement`);
    const [u] = await tx.update(settlements).set({ status: "reviewed", reviewedBy: actor.id, updatedAt: new Date() }).where(eq(settlements.id, id)).returning();
    await audit(actor, "settlement.review", "settlement", id, null, tx);
    return u;
  });
}

export async function approveSettlement(actor: User, id: string) {
  requirePerm(actor, "settlements.approve");
  return db.transaction(async (tx) => {
    const s = await lock(tx, id);
    if (!["pending_review", "reviewed"].includes(s.status)) throw err("INVALID_TRANSITION", `Cannot approve a ${s.status} settlement`);
    const cfg = await getSettings(tx);
    if (cfg.separationOfDuties && s.reviewedBy === actor.id) throw err("FORBIDDEN", "Approver must differ from reviewer");
    if (await blockingComplaint(tx, s.requestId, s.offerId)) throw err("DISPUTE_BLOCKS", "An open complaint holds this settlement");
    const [u] = await tx.update(settlements).set({ status: "approved", approvedBy: actor.id, approvedAt: new Date(), updatedAt: new Date() }).where(eq(settlements.id, id)).returning();
    await audit(actor, "settlement.approve", "settlement", id, { amount: s.providerCents }, tx);
    return u;
  });
}

export async function rejectSettlement(actor: User, id: string, reason: string) {
  requirePerm(actor, "settlements.review");
  if (!reason?.trim()) throw err("VALIDATION", "Reason required", { field: "reason" });
  return db.transaction(async (tx) => {
    const s = await lock(tx, id);
    if (["paid", "rejected"].includes(s.status)) throw err("INVALID_TRANSITION", `Cannot reject a ${s.status} settlement`);
    // Return the slot's escrow to the business (fixes the old "stuck escrow" defect).
    const acct = await ensureAccount(s.businessId, tx);
    await post(tx, { accountId: acct.id, kind: "release_reserve", reserved: -s.reservedCents, available: s.reservedCents, idempotencyKey: `settle-reject:${s.id}`, requestId: s.requestId, settlementId: s.id, actorId: actor.id });
    await tx.update(requests).set({ reservedCents: sql`${requests.reservedCents} - ${s.reservedCents}` }).where(eq(requests.id, s.requestId));
    const [u] = await tx.update(settlements).set({ status: "rejected", note: reason, updatedAt: new Date() }).where(eq(settlements.id, id)).returning();
    await audit(actor, "settlement.reject", "settlement", id, { reason }, tx);
    return u;
  });
}

/** Moves money for one approved settlement. Balanced: provider + margin = customer charge. */
export async function payoutTx(tx: Exec, id: string, actor: User | null) {
  const s = await lock(tx, id);
  if (s.status === "paid") return s; // idempotent
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
  const [u] = await tx.update(settlements).set({ status: "paid", paidAt: new Date(), updatedAt: new Date() }).where(eq(settlements.id, id)).returning();
  await tx.update(driverProfiles).set({ jobsCompleted: sql`${driverProfiles.jobsCompleted} + 1` }).where(eq(driverProfiles.userId, s.driverId));
  const cfg = await getSettings(tx);
  const vat = Math.round((s.customerCents * cfg.vatPct) / (100 + cfg.vatPct)); // prices treated as VAT-inclusive [D]
  const num = `INV-${String(await nextSeq(tx, "invoice")).padStart(6, "0")}`;
  await tx.insert(invoices).values({ number: num, requestId: s.requestId, settlementId: s.id, businessId: s.businessId, subtotalCents: s.customerCents - vat, vatCents: vat, totalCents: s.customerCents, vatPct: cfg.vatPct }).onConflictDoNothing();
  await notify(s.officeId ?? s.driverId, "payout_paid", { amountCents: s.providerCents }, tx);
  await logEvent(tx, { requestId: s.requestId, offerId: s.offerId, actor: actor ? { id: actor.id, name: actor.name, role: actor.role } : null, type: "payout_paid", payload: { settlementId: s.id } });
  await audit(actor, "settlement.pay", "settlement", id, { provider: s.providerCents, margin: s.marginCents }, tx);
  return u;
}

export async function payoutSettlement(actor: User, id: string) {
  requirePerm(actor, "payouts.execute");
  return db.transaction((tx) => payoutTx(tx, id, actor));
}

/** Batch: each item in its own transaction, so one failure never blocks or half-applies others. */
export async function runPayoutBatch(actor: User, limit = 200) {
  requirePerm(actor, "payouts.execute");
  const due = await db.select({ id: settlements.id, providerCents: settlements.providerCents }).from(settlements)
    .where(eq(settlements.status, "approved")).orderBy(settlements.approvedAt).limit(limit);
  const results: Array<{ settlementId: string; ok: boolean; error?: string }> = [];
  let total = 0;
  for (const d of due) {
    try {
      await db.transaction((tx) => payoutTx(tx, d.id, actor));
      results.push({ settlementId: d.id, ok: true });
      total += d.providerCents;
    } catch (e) {
      const msg = e instanceof Error ? e.message : "error";
      await db.update(settlements).set({ status: "failed", note: msg.slice(0, 200), updatedAt: new Date() }).where(and(eq(settlements.id, d.id), eq(settlements.status, "approved")));
      results.push({ settlementId: d.id, ok: false, error: msg });
    }
  }
  const [batch] = await db.insert(payoutBatches).values({
    ref: await nextRef(db, "BATCH"), itemCount: due.length, paidCount: results.filter((r) => r.ok).length,
    failedCount: results.filter((r) => !r.ok).length, totalCents: total, results: results as never, createdBy: actor.id,
    periodKey: (await getSettings()).settlementPeriod,
  }).returning();
  await audit(actor, "payout.batch", "payout_batch", batch.id, { items: due.length, total });
  return batch;
}

/** Retry a failed item: failed → approved (visible, retry-safe). */
export async function retryFailed(actor: User, id: string) {
  requirePerm(actor, "payouts.execute");
  const [u] = await db.update(settlements).set({ status: "approved", updatedAt: new Date() }).where(and(eq(settlements.id, id), eq(settlements.status, "failed"))).returning();
  if (!u) throw err("INVALID_TRANSITION", "Only failed settlements can be retried");
  return u;
}

export async function listSettlements(f: { status?: string; page?: number; pageSize?: number; payeeId?: string; businessId?: string }) {
  const pageSize = Math.min(f.pageSize ?? 25, 100), page = Math.max(f.page ?? 1, 1);
  const where = and(
    f.status ? eq(settlements.status, f.status) : undefined,
    f.payeeId ? sql`coalesce(${settlements.officeId}, ${settlements.driverId}) = ${f.payeeId}` : undefined,
    f.businessId ? eq(settlements.businessId, f.businessId) : undefined,
  );
  const [items, [{ total }]] = await Promise.all([
    db.select().from(settlements).where(where).orderBy(desc(settlements.createdAt)).limit(pageSize).offset((page - 1) * pageSize),
    db.select({ total: count() }).from(settlements).where(where),
  ]);
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
      if (p?.officeLinkStatus === "linked") throw err("FORBIDDEN", "Office-linked drivers are paid by their office");
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
