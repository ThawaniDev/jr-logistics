import { eq } from "drizzle-orm";
import { db } from "@/db";
import { ledgerEntries, users, withdrawals } from "@/db/schema";
import { ensureAccount, post, type Posting } from "@/server/wallet";
import { seedFleetWorld } from "./fleet-world";

/**
 * The hand-computable world of the Finance › Drivers tests: the fleet world (period 2026-05-10 … 2026-05-12, Riyadh days) plus the wallet side of the independent driver D3.
 *
 *   D1, D2 belong to office O1 (paid through the office: no wallet); D3 is independent.
 *   settlements (provider cents)  D1: 2100 paid + 1400 approved (refund 100, adjustment 50) · D2: 1750 paid + 700 pending review · D3: 1050 paid
 *   cash                          D1 collected 5000 (10th), handed over 3000 (11th) → holds 2000 · D2 collected 8000 (11th) → holds 8000 · D3 none
 *   jobs / parcels                D1 2 jobs, 4 delivered, 1 failed, 1 returned · D2 2 jobs, 3 delivered · D3 1 job, 2 delivered, 1 failed
 *   D3 wallet                     payout +1050 (12th) → withdrawal 500 requested and paid (13th) → manual debit 200 (14th) → withdrawal 100 pending (15th) → withdrawal 50 requested and rejected (16th)
 *                                 ⇒ available 250, held 100; withdrawals requested 650 (3) · paid 500 (1) · pending 100 (1) · rejected 50 (1); penalties 200, wallet adjustments −200
 */
const at = (day: string, hm: string) => new Date(`${day}T${hm}:00Z`);

export async function seedFinanceDriversWorld() {
  const w = await seedFleetWorld();
  for (const [d, username] of [[w.d1, "drv.one"], [w.d2, "drv.two"], [w.d3, "drv.three"]] as const) await db.update(users).set({ username }).where(eq(users.id, d.id));
  const [wRow] = await db.select().from(users).where(eq(users.id, w.d3.id));
  const acct = await ensureAccount(w.d3.id);
  const posting = async (key: string, p: Omit<Posting, "accountId" | "idempotencyKey">, when: Date) => {
    await post(db, { ...p, accountId: acct.id, idempotencyKey: `fdw:${key}` });
    await db.update(ledgerEntries).set({ createdAt: when }).where(eq(ledgerEntries.idempotencyKey, `fdw:${key}`));
  };
  await posting("payout", { kind: "payout", available: 1050, note: "payout JR" }, at("2026-05-12", "12:00"));
  await posting("wd1-hold", { kind: "withdrawal_hold", available: -500, held: 500 }, at("2026-05-13", "08:00"));
  await posting("wd1-paid", { kind: "withdrawal_paid", held: -500 }, at("2026-05-13", "09:00"));
  await posting("adj", { kind: "adjustment", available: -200, note: "fine for damaged parcel", actorId: w.admin.id }, at("2026-05-14", "08:00"));
  await posting("wd2-hold", { kind: "withdrawal_hold", available: -100, held: 100 }, at("2026-05-15", "08:00"));
  await posting("wd3-hold", { kind: "withdrawal_hold", available: -50, held: 50 }, at("2026-05-16", "08:00"));
  await posting("wd3-release", { kind: "withdrawal_release", available: 50, held: -50 }, at("2026-05-16", "09:00"));
  const wd = (amount: number, status: string, createdAt: Date, extra: Partial<typeof withdrawals.$inferInsert> = {}) =>
    db.insert(withdrawals).values({ userId: w.d3.id, amountCents: amount, iban: "SA0380000000608010167519", bankName: "Test Bank", status, createdAt, ...extra });
  await wd(500, "paid", at("2026-05-13", "08:00"), { decidedBy: w.admin.id, decidedAt: at("2026-05-13", "09:00"), paymentRef: "TRF-1" });
  await wd(100, "pending", at("2026-05-15", "08:00"));
  await wd(50, "rejected", at("2026-05-16", "08:00"), { decidedBy: w.admin.id, decidedAt: at("2026-05-16", "09:00"), note: "wrong IBAN" });
  return { ...w, d3Row: wRow, d3Account: acct };
}
export const PERIOD = "from=2026-05-10&to=2026-05-12";
