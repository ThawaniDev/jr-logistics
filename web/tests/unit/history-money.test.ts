import { describe, it, expect } from "vitest";
import { planMoney } from "@/server/demo-history/money";
import { Rng } from "@/server/demo-history/prng";
import { IdGen } from "@/server/demo-history/ids";
import { emptyIntervals, type Ctx } from "@/server/demo-history/types";
import type { Posting } from "@/server/demo-history/writer";
import { DAY, HOUR, parseKsaDay } from "@/server/demo-history/calendar";

/** The money pass on a hand-made little world: who tops up when, what a withdrawal looks like, what the daily wallet numbers say. */
const START = parseKsaDay("2026-09-01")!;
function world(postings: Posting[], o: { credit?: number; days?: number } = {}): Ctx {
  const asOf = START + (o.days ?? 40) * DAY;
  return {
    rng: new Rng(5), ids: new IdGen(), windowStart: START, asOf, iv: emptyIntervals(), postings, platformWalletId: "P",
    w: {
      admin: { id: "A", role: "admin", name: "Admin" }, staff: [{ id: "F", role: "staff", team: "finance", name: "Fin" }],
      companies: [
        { id: "C1", walletId: "W1", size: "small", creditLimitCents: 0, city: "riyadh" },
        { id: "C2", walletId: "W2", size: "enterprise", creditLimitCents: o.credit ?? 0, city: "riyadh" },
      ],
      drivers: [{ id: "D1", walletId: "WD", iban: "SA0380000000608010167519", bank: "SNB", city: "riyadh", affiliations: [{ from: 0, to: Infinity, officeId: null }] }],
      offices: [], userCities: new Map(),
    },
  } as unknown as Ctx;
}
const reserve = (acct: string, at: number, cents: number, req: string): Posting => ({ at, accountId: acct, kind: "reserve", available: -cents, reserved: cents, key: `hist:reserve:${req}`, requestId: req });
const settle = (acct: string, driver: string, at: number, cents: number, cost: number, req: string): Posting[] => [
  { at, accountId: acct, kind: "release_reserve", reserved: -cents, available: cents, key: `hist:settle:${req}:release`, requestId: req },
  { at, accountId: acct, kind: "charge", available: -cents, key: `hist:settle:${req}:charge`, requestId: req },
  { at, accountId: driver, kind: "payout", available: cost, key: `hist:settle:${req}:payout`, requestId: req },
  { at, accountId: "P", kind: "platform_fee", available: cents - cost, key: `hist:settle:${req}:fee`, requestId: req },
];
const replay = (ps: Posting[]) => { const b = new Map<string, number[]>(); for (const p of ps) { const v = b.get(p.accountId) ?? [0, 0, 0]; v[0] += p.available ?? 0; v[1] += p.reserved ?? 0; v[2] += p.held ?? 0; b.set(p.accountId, v); } return b; };

describe("money pass", () => {
  it("tops a business up BEFORE the order that would overdraw it, in round amounts, never above the top-up cap", () => {
    const t = START + 3 * DAY;
    const ctx = world([reserve("W1", t, 120_000, "R1")]);
    const { postings, topups } = planMoney(ctx, 10_000, 10_000_000);
    expect(topups).toBe(1);
    const top = postings.find((p) => p.kind === "topup")!;
    expect(top.at).toBeLessThan(t);
    expect(top.available).toBeGreaterThanOrEqual(120_000);
    expect(top.available! % 50_000).toBe(0); // small accounts top up in SAR 500 steps
    expect(top.simulated).toBe(true);
    expect(top.key).toMatch(/^hist:topup:/);
    expect(postings.indexOf(top)).toBeLessThan(postings.findIndex((p) => p.kind === "reserve"));
    expect(replay(postings).get("W1")![0]).toBeGreaterThanOrEqual(0);
  });

  it("splits a top-up larger than the platform's cap into several", () => {
    const ctx = world([reserve("W2", START + DAY, 25_000_000, "R1")]);
    const { postings } = planMoney(ctx, 10_000, 10_000_000);
    const tops = postings.filter((p) => p.kind === "topup");
    expect(tops.length).toBeGreaterThanOrEqual(3);
    expect(tops.every((p) => p.available! <= 10_000_000)).toBe(true);
    expect(new Set(tops.map((p) => p.key)).size).toBe(tops.length);
  });

  it("a credit line is used before topping up, and the debt is paid down on the 3rd of the month", () => {
    const ctx = world([reserve("W2", START + 2 * DAY, 2_000_000, "R1"), ...settle("W2", "WD", START + 2 * DAY + HOUR, 2_000_000, 1_400_000, "R1")], { credit: 6_000_000, days: 40 });
    const { postings } = planMoney(ctx, 10_000, 10_000_000);
    const firstReserve = postings.findIndex((p) => p.kind === "reserve");
    expect(postings.slice(0, firstReserve).some((p) => p.kind === "topup")).toBe(false); // covered by the credit line
    const final = replay(postings).get("W2")!;
    expect(final[0]).toBeGreaterThanOrEqual(0); // the monthly payment cleared the debt
    expect(postings.some((p) => p.kind === "topup" && p.at > START + 2 * DAY)).toBe(true);
  });

  it("payees withdraw part of what they hold; finance pays (or rejects) later; pending ones keep the money held", () => {
    const ps: Posting[] = [];
    for (let i = 0; i < 30; i++) ps.push(reserve("W2", START + i * DAY + HOUR, 100_000, `R${i}`), ...settle("W2", "WD", START + i * DAY + 3 * HOUR, 100_000, 70_000, `R${i}`));
    const ctx = world(ps, { credit: 50_000_000, days: 60 });
    const { postings, withdrawals } = planMoney(ctx, 10_000, 10_000_000);
    expect(withdrawals.length).toBeGreaterThan(0);
    for (const w of withdrawals) {
      expect(w.amountCents).toBeGreaterThanOrEqual(10_000);
      expect(w.amountCents % 10_000).toBe(0); // whole riyals in hundreds
      expect(w.iban).toMatch(/^SA/);
      const hold = postings.find((p) => p.key === `hist:wd-hold:${w.id}`)!;
      expect(hold).toMatchObject({ kind: "withdrawal_hold", available: -w.amountCents, held: w.amountCents });
      const done = postings.find((p) => p.key === `hist:wd-paid:${w.id}` || p.key === `hist:wd-rel:${w.id}`);
      if (w.status === "pending") expect(done).toBeUndefined();
      else { expect(done!.at).toBeGreaterThanOrEqual(hold.at); expect(w.decidedAt).toBe(done!.at); }
      if (w.status === "paid") expect(done).toMatchObject({ kind: "withdrawal_paid", held: -w.amountCents });
      if (w.status === "rejected") expect(done).toMatchObject({ kind: "withdrawal_release", held: -w.amountCents, available: w.amountCents });
    }
    // decisions are made at working hours, Sunday–Thursday
    for (const w of withdrawals.filter((x) => x.decidedAt)) { const d = new Date(w.decidedAt! + 3 * HOUR); expect([5, 6]).not.toContain(d.getUTCDay()); expect(d.getUTCHours()).toBeGreaterThanOrEqual(9); expect(d.getUTCHours()).toBeLessThan(17); }
    expect(ctx.iv.withdrawalsPending).toHaveLength(withdrawals.length);
    const bal = replay(postings).get("WD")!;
    expect(bal[0]).toBeGreaterThanOrEqual(0);
    expect(bal[2]).toBe(withdrawals.filter((w) => w.status === "pending").reduce((a, w) => a + w.amountCents, 0));
  });

  it("refuses to produce an impossible ledger (a release with no escrow behind it)", () => {
    const ctx = world([{ at: START + DAY, accountId: "W1", kind: "release_reserve", reserved: -500, available: 500, key: "hist:bad", requestId: "R1" }]);
    expect(() => planMoney(ctx, 10_000, 10_000_000)).toThrow(/wallet_nonneg/);
  });

  it("reports the wallet numbers of every complete day (available, held, escrow, liability, credit exposure)", () => {
    const ctx = world([reserve("W1", START + DAY, 40_000, "R1")], { days: 10 });
    const { daily } = planMoney(ctx, 10_000, 10_000_000);
    const d1 = daily.get(START + DAY)!;
    expect(d1.get("")!.wallet_escrow_cents).toBe(40_000);
    expect(d1.get("riyadh")!.wallet_escrow_cents).toBe(40_000);
    expect(d1.get("")!.wallet_liability_cents).toBe(d1.get("")!.wallet_available_cents + d1.get("")!.wallet_held_cents + d1.get("")!.wallet_escrow_cents);
    expect(d1.get("")!.credit_exposure_cents).toBe(0);
    expect(daily.has(START)).toBe(true);
    expect(daily.has(ctx.asOf)).toBe(false); // the running day is left to the live tick
  });
});
