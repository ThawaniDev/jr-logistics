import { and, eq, inArray, sql } from "drizzle-orm";
import { db, type Exec } from "@/db";
import { ledgerEntries, walletAccounts, requests } from "@/db/schema";
import { err, AppError } from "@/lib/errors";
import { logError } from "@/lib/log";
import { env } from "@/lib/env";

export type Account = typeof walletAccounts.$inferSelect;

/** Payment provider boundary: real providers report real state; the demo one is flagged simulated. */
export interface PaymentProvider { name: string; simulated: boolean; charge(amountCents: number, ref: string): Promise<{ providerRef: string }> }
export const DemoPayments: PaymentProvider = { name: "demo", simulated: true, async charge(_a, ref) { return { providerRef: `demo-${ref}` }; } };
let payments: PaymentProvider | null = null;
export const setPaymentProvider = (p: PaymentProvider | null) => { payments = p; };
export function paymentProvider(): PaymentProvider {
  const p = payments ?? (env.demoMode ? DemoPayments : null);
  if (!p) throw err("DEPENDENCY_UNAVAILABLE", "Payment provider is not configured");
  return p;
}

export async function ensureAccount(ownerId: string, x: Exec = db): Promise<Account> {
  await x.insert(walletAccounts).values({ ownerId, kind: "user" }).onConflictDoNothing({ target: walletAccounts.ownerId });
  const [a] = await x.select().from(walletAccounts).where(eq(walletAccounts.ownerId, ownerId));
  return a;
}

export async function platformAccount(x: Exec): Promise<Account> {
  const find = async () => (await x.select().from(walletAccounts).where(eq(walletAccounts.kind, "platform")).limit(1))[0];
  let a = await find();
  if (a) return a;
  await x.execute(sql`select pg_advisory_xact_lock(7788001)`);
  a = await find();
  if (a) return a;
  [a] = await x.insert(walletAccounts).values({ kind: "platform" }).returning();
  return a;
}

export interface Posting {
  accountId: string;
  kind: string;
  available?: number; reserved?: number; held?: number;
  idempotencyKey: string;
  requestId?: string | null; offerId?: string | null; settlementId?: string | null;
  simulated?: boolean; note?: string; actorId?: string | null;
}

/**
 * Applies a ledger posting and balance change atomically.
 * Must be called inside a transaction when moving funds between accounts.
 * Idempotent: replaying the same key is a no-op returning `applied:false`.
 */
export async function post(x: Exec, p: Posting): Promise<{ applied: boolean }> {
  const a = p.available ?? 0, r = p.reserved ?? 0, h = p.held ?? 0;
  const ins = await x.insert(ledgerEntries).values({
    accountId: p.accountId, kind: p.kind, availableDeltaCents: a, reservedDeltaCents: r, heldDeltaCents: h,
    requestId: p.requestId ?? null, offerId: p.offerId ?? null, settlementId: p.settlementId ?? null,
    idempotencyKey: p.idempotencyKey, simulated: p.simulated ?? false, note: p.note, actorId: p.actorId ?? null,
  }).onConflictDoNothing({ target: ledgerEntries.idempotencyKey }).returning({ id: ledgerEntries.id });
  if (!ins.length) return { applied: false };
  try {
    await x.update(walletAccounts).set({
      availableCents: sql`${walletAccounts.availableCents} + ${a}`,
      reservedCents: sql`${walletAccounts.reservedCents} + ${r}`,
      heldCents: sql`${walletAccounts.heldCents} + ${h}`,
      updatedAt: new Date(),
    }).where(eq(walletAccounts.id, p.accountId));
  } catch (e) {
    if ((e as { cause?: { code?: string }; code?: string }).cause?.code === "23514" || (e as { code?: string }).code === "23514") {
      throw err("INSUFFICIENT_FUNDS", "Insufficient wallet balance");
    }
    throw e;
  }
  return { applied: true };
}

/**
 * Credits a wallet through the payment provider. Idempotent per (user, key): a retried call — a lost response, a double tap, two tabs —
 * charges the provider ONCE. The key is serialised with an advisory lock and the ledger is consulted BEFORE the provider is called
 * (calling the provider first double-charged real cards on every retry).
 */
export async function topUp(userId: string, amountCents: number, idempotencyKey: string, maxCents: number) {
  if (!Number.isInteger(amountCents) || amountCents <= 0 || amountCents > maxCents) throw err("VALIDATION", "Invalid top-up amount");
  const provider = paymentProvider();
  const key = `topup:${userId}:${idempotencyKey}`;
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${key}))`);
    const acct = await ensureAccount(userId, tx);
    const [prior] = await tx.select().from(ledgerEntries).where(eq(ledgerEntries.idempotencyKey, key));
    if (prior) {
      if (prior.availableDeltaCents !== amountCents) throw err("CONFLICT", "This idempotency key was already used for a different amount");
    } else {
      let providerRef: string;
      try { ({ providerRef } = await provider.charge(amountCents, idempotencyKey)); }
      catch (e) { if (e instanceof AppError) throw e; logError(e, { correlationId: "topup" }); throw err("DEPENDENCY_UNAVAILABLE", "The payment service is unavailable right now — nothing was charged, please try again"); }
      await post(tx, { accountId: acct.id, kind: "topup", available: amountCents, idempotencyKey: key, simulated: provider.simulated, note: providerRef, actorId: userId });
    }
    const [fresh] = await tx.select().from(walletAccounts).where(eq(walletAccounts.id, acct.id));
    return { ...fresh, simulated: prior ? prior.simulated : provider.simulated };
  });
}

/** `kinds` narrows the statement to some ledger kinds (the wallet page's filter); the total follows the same filter. */
export async function walletView(userId: string, page = 1, pageSize = 50, kinds?: string[]) {
  const a = await ensureAccount(userId);
  const p = Math.max(page, 1);
  const where = and(eq(ledgerEntries.accountId, a.id), kinds?.length ? inArray(ledgerEntries.kind, kinds) : undefined);
  const [entries, [{ n }]] = await Promise.all([
    db.select({ e: ledgerEntries, requestRef: requests.ref }).from(ledgerEntries).leftJoin(requests, eq(requests.id, ledgerEntries.requestId)).where(where).orderBy(sql`${ledgerEntries.createdAt} desc`).limit(pageSize).offset((p - 1) * pageSize),
    db.select({ n: sql<number>`count(*)::int` }).from(ledgerEntries).where(where),
  ]);
  return { account: a, entries: entries.map(({ e, requestRef }) => ({ ...e, requestRef })), page: p, pageSize, total: Number(n) };
}
