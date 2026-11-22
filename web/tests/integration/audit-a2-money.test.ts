/**
 * Audit K / A2 — money and settlement logic (1/2): escrow, VAT / invoices, replay, settlement window and payout failure. Regression tests for memory/audit/money.md findings 1–6, 8, 11.
 */
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { requests, settlements, invoices, settings } from "@/db/schema";
import { shutdown, mkAdmin, mkStaff, mkBusiness, mkDriver, mkRule, publishedRequest, mkShipments } from "../helpers/factories";
import { resetDbWithFieldModes } from "../helpers/field-modes";
import { call } from "../helpers/api";
import { work } from "../helpers/work";
import { offerOf, setup, sound, hold, release } from "../helpers/money-world";
import { createSession } from "@/server/auth/session";
import * as jobs from "@/server/jobs";
import * as settle from "@/server/settlement";
import { cancelRequest, releaseReserve, lockRequest } from "@/server/requests";
import { ensureAccount } from "@/server/wallet";
import { updateSettings } from "@/server/settings";
import { vatOf } from "@/server/settlement";

beforeEach(resetDbWithFieldModes);
afterAll(shutdown);

describe("A2-1: cancelling a part-finished request returns the whole unused escrow", () => {
  it("staff cancel after one driver of two is paid: the other slot's reserve is released, nothing stays escrowed", async () => {
    const { biz } = await setup(); const d1 = await mkDriver();
    const staff = await mkStaff(["requests.edit"]);
    const r = await publishedRequest(biz, { shipments: mkShipments(20), shipmentsPerDriver: 10 });
    const o1 = await offerOf(r.id, d1.id);
    await jobs.acceptOffer(d1, o1.id, true); await jobs.confirmAttendance(biz, o1.id, true);
    await work(biz, d1, o1.id);
    expect((await db.select().from(settlements).where(eq(settlements.offerId, o1.id)))[0].status).toBe("paid");
    await cancelRequest(staff, r.id, "client withdrew the second half");
    const [req] = await db.select().from(requests).where(eq(requests.id, r.id));
    expect(req.status).toBe("cancelled");
    expect(req.reservedCents).toBe(0); // the second slot's 10 × SAR 10 went back (it stayed escrowed for ever before the fix)
    const acct = await ensureAccount(biz.id);
    expect(acct.reservedCents).toBe(0);
    expect(acct.availableCents).toBe(5000_00 - 10 * 1000); // only the delivered half was charged
    await sound();
  });

  it("a finished offer whose payment is HELD by a complaint keeps exactly its own share reserved, and the later payment settles it", async () => {
    const { biz } = await setup(); const d1 = await mkDriver();
    const staff = await mkStaff(["requests.edit"]);
    const r = await publishedRequest(biz, { shipments: mkShipments(20), shipmentsPerDriver: 10 });
    const o1 = await offerOf(r.id, d1.id);
    await jobs.acceptOffer(d1, o1.id, true); await jobs.confirmAttendance(biz, o1.id, true);
    const c = await hold(biz, r.id, o1.id, 1);
    await work(biz, d1, o1.id, 8); // 8 of 10 delivered, 2 returned
    expect((await db.select().from(settlements).where(eq(settlements.offerId, o1.id)))[0].status).toBe("approved");
    await cancelRequest(staff, r.id, "client withdrew the second half");
    expect((await db.select().from(requests).where(eq(requests.id, r.id)))[0].reservedCents).toBe(10 * 1000); // d1's share, still owed to a held settlement
    await sound();
    await release(c.id);
    expect(await settle.paySettlementsDue()).toBe(1);
    expect((await db.select().from(requests).where(eq(requests.id, r.id)))[0].reservedCents).toBe(0);
    const acct = await ensureAccount(biz.id);
    expect(acct).toMatchObject({ reservedCents: 0, availableCents: 5000_00 - 8 * 1000 });
    await sound();
  });
});

describe("A2-2: VAT is whole-percent, and the settlement carries the VAT that was invoiced", () => {
  it("PATCH /admin/settings refuses a fractional VAT rate (invoices.vat_pct is an integer column)", async () => {
    const admin = await mkAdmin();
    const token = (await createSession(admin.id, "web")).token;
    const bad = await call("PATCH", "/admin/settings", { token, body: { vatPct: 7.5 } });
    expect(bad.status).toBe(422);
    const ok = await call("PATCH", "/admin/settings", { token, body: { vatPct: 5 } });
    expect(ok.status).toBe(200);
  });

  it("a fractional rate that is already stored does not stop payouts: the invoice records the whole percent it used", async () => {
    const { admin, biz } = await setup(); const d = await mkDriver();
    await updateSettings({ vatPct: 7.5 }, admin.id);
    const r = await publishedRequest(biz, { shipments: mkShipments(4), shipmentsPerDriver: 4 });
    const o = await offerOf(r.id, d.id);
    await jobs.acceptOffer(d, o.id, true); await jobs.confirmAttendance(biz, o.id, true);
    await work(biz, d, o.id);
    const [s] = await db.select().from(settlements).where(eq(settlements.offerId, o.id));
    expect(s.status).toBe("paid");
    const [i] = await db.select().from(invoices).where(eq(invoices.settlementId, s.id));
    expect(i).toMatchObject({ vatPct: 8, totalCents: 4000, vatCents: vatOf(4000, 8), subtotalCents: 4000 - vatOf(4000, 8) });
    expect(s.vatCents).toBe(i.vatCents);
    await sound();
  });

  it("a settlement held while the VAT rate changes is paid with the VAT of the invoice (settlement VAT = invoice VAT)", async () => {
    const { admin, biz } = await setup(); const d = await mkDriver();
    const r = await publishedRequest(biz, { shipments: mkShipments(6), shipmentsPerDriver: 6 });
    const o = await offerOf(r.id, d.id);
    await jobs.acceptOffer(d, o.id, true); await jobs.confirmAttendance(biz, o.id, true);
    const c = await hold(biz, r.id, o.id, 2);
    await work(biz, d, o.id);
    const [held] = await db.select().from(settlements).where(eq(settlements.offerId, o.id));
    expect(held).toMatchObject({ status: "approved", vatCents: vatOf(6000, 15) });
    await updateSettings({ vatPct: 5 }, admin.id); // the rate changes while the money waits
    await release(c.id);
    expect(await settle.paySettlementsDue()).toBe(1);
    const [s] = await db.select().from(settlements).where(eq(settlements.id, held.id));
    const [i] = await db.select().from(invoices).where(eq(invoices.settlementId, s.id));
    expect(i).toMatchObject({ vatPct: 5, vatCents: vatOf(6000, 5) });
    expect(s.vatCents).toBe(i.vatCents);
    expect(i.subtotalCents + i.vatCents).toBe(i.totalCents);
  });

  it("VAT extracted from a VAT-inclusive total never differs from the exact value by more than half a halala, and subtotal + VAT is the total (property)", () => {
    let seed = 20261121;
    const rnd = () => (seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296;
    for (let n = 0; n < 5000; n++) {
      const total = Math.floor(rnd() * 2_000_000_000), pct = [0, 5, 10, 15, 20, 30][Math.floor(rnd() * 6)];
      const vat = vatOf(total, pct);
      expect(Number.isInteger(vat)).toBe(true);
      expect(vat).toBeGreaterThanOrEqual(0); expect(vat).toBeLessThanOrEqual(total);
      expect(Math.abs(vat - (total * pct) / (100 + pct))).toBeLessThanOrEqual(0.5 + 1e-6);
    }
    expect(vatOf(0, 15)).toBe(0); expect(vatOf(115, 15)).toBe(15); expect(vatOf(100, 15)).toBe(13);
  });
});

describe("A2-3: a fulfilled driverless rental is invoiced like every other charge", () => {
  it("the company gets a VAT invoice for the rental, the books balance, and a second fulfilment is refused", async () => {
    const admin = await mkAdmin(); const biz = await mkBusiness({ fundsCents: 5000_00 }); const staff = await mkStaff(["requests.edit"]);
    await mkRule(admin, { service: "car_without_driver", vehicleType: "sedan", priceCents: 25_000, providerCostCents: 20_000 });
    const r = await publishedRequest(biz, { service: "car_without_driver", quantity: 2, durationDays: 3, shipments: null, shipmentsPerDriver: null });
    expect(r).toMatchObject({ status: "confirmed", totalCents: 150_000, reservedCents: 150_000 });
    await jobs.fulfilRental(staff, r.id);
    const inv = await db.select().from(invoices).where(eq(invoices.requestId, r.id));
    expect(inv).toHaveLength(1);
    expect(inv[0]).toMatchObject({ settlementId: null, businessId: biz.id, totalCents: 150_000, vatPct: 15, vatCents: vatOf(150_000, 15), subtotalCents: 150_000 - vatOf(150_000, 15) });
    expect(inv[0].number).toMatch(/^INV-\d{6}$/);
    await expect(jobs.fulfilRental(staff, r.id)).rejects.toMatchObject({ code: "INVALID_TRANSITION" });
    expect(await db.select().from(invoices).where(eq(invoices.requestId, r.id))).toHaveLength(1);
    const token = (await createSession(biz.id, "web")).token; // the company sees it and can open the sheet
    const list = await call("GET", "/business/invoices", { token });
    expect(list.json.total).toBe(1);
    const sheet = await call("GET", `/business/invoices/${inv[0].id}`, { token });
    expect(sheet.status).toBe(200);
    expect(sheet.json.lines.reduce((a: number, l: { amountCents: number | null }) => a + (l.amountCents ?? 0), 0)).toBe(150_000);
    await sound();
  });
});

describe("A2-4: a replayed escrow release moves neither the wallet nor the request's counter", () => {
  it("releasing the same key twice returns the money once and keeps requests.reserved_cents equal to the wallet's reserve", async () => {
    const { biz } = await setup();
    const r = await publishedRequest(biz, { shipments: mkShipments(4), shipmentsPerDriver: 4 });
    await db.transaction(async (tx) => {
      const locked = await lockRequest(tx, r.id);
      await releaseReserve(tx, locked, 1000, "a2-4-key");
      await releaseReserve(tx, { ...locked, reservedCents: locked.reservedCents - 1000 }, 1000, "a2-4-key"); // a replay of the same posting
    });
    const [req] = await db.select().from(requests).where(eq(requests.id, r.id));
    expect(req.reservedCents).toBe(4000 - 1000);
    expect((await ensureAccount(biz.id)).reservedCents).toBe(4000 - 1000);
    await sound();
  });
});

describe("A2-5: held settlements do not crowd out the payable ones", () => {
  it("with a window of 2, two held settlements in front of a released one still let the released one be paid", async () => {
    const { biz } = await setup(); const ds = [await mkDriver(), await mkDriver(), await mkDriver()];
    const cs: string[] = [];
    for (const [n, d] of ds.entries()) {
      const r = await publishedRequest(biz, { shipments: mkShipments(2), shipmentsPerDriver: 2 });
      const o = await offerOf(r.id, d.id);
      await jobs.acceptOffer(d, o.id, true); await jobs.confirmAttendance(biz, o.id, true);
      cs.push((await hold(biz, r.id, o.id, 10 + n)).id);
      await work(biz, d, o.id);
    }
    expect((await db.select().from(settlements)).every((s) => s.status === "approved")).toBe(true);
    await release(cs[2]); // only the newest hold is lifted
    expect(await settle.paySettlementsDue(2)).toBe(1);
    expect((await db.select().from(settlements).where(eq(settlements.status, "paid")))).toHaveLength(1);
    await sound();
  });
});

describe("A2-5c: a settlement hold needs an order to hold", () => {
  it("a complaint that names no order or job cannot be set to hold a settlement (it would say \"on hold\" while the money is paid)", async () => {
    const { biz } = await setup(); const d = await mkDriver();
    const { fileComplaint, updateComplaint } = await import("@/server/support");
    const ops = await mkStaff(["complaints.manage"]);
    const general = await fileComplaint(biz, { category: "other", description: "a general question about invoices" });
    await expect(updateComplaint(ops, general.id, { holdsSettlement: true })).rejects.toMatchObject({ code: "VALIDATION" });
    const r = await publishedRequest(biz, { shipments: mkShipments(2), shipmentsPerDriver: 2 });
    const o = await offerOf(r.id, d.id);
    const linked = await fileComplaint(biz, { category: "damage", description: "box was crushed on arrival", offerId: o.id });
    expect((await updateComplaint(ops, linked.id, { holdsSettlement: true })).holdsSettlement).toBe(true);
  });
});

describe("A2-5b: a payout that fails does not undo the driver's finished work", () => {
  it("an error while moving the money leaves the job completed and the settlement `failed` (escrow still held); the next tick pays it", async () => {
    const { biz } = await setup(); const d = await mkDriver();
    // inject a database failure on the platform-fee posting, switched on by a settings row (so a crashed test can never leave the trigger armed: resetDb empties `settings`)
    await db.execute(sql`create or replace function a2_fail_fee() returns trigger language plpgsql as $$ begin if new.kind = 'platform_fee' and exists (select 1 from settings where key = 'a2_fail') then raise exception 'injected payout failure'; end if; return new; end $$`);
    await db.execute(sql`drop trigger if exists a2_fail_fee_t on ledger_entries`);
    await db.execute(sql`create trigger a2_fail_fee_t before insert on ledger_entries for each row execute function a2_fail_fee()`);
    try {
      const r = await publishedRequest(biz, { shipments: mkShipments(4), shipmentsPerDriver: 4 });
      const o = await offerOf(r.id, d.id);
      await jobs.acceptOffer(d, o.id, true); await jobs.confirmAttendance(biz, o.id, true);
      await db.insert(settings).values({ key: "a2_fail", value: { on: true } });
      await work(biz, d, o.id); // must NOT throw
      expect((await offerOf(r.id, d.id)).status).toBe("completed");
      const [s] = await db.select().from(settlements).where(eq(settlements.offerId, o.id));
      expect(s.status).toBe("failed"); expect(s.note).toMatch(/injected payout failure/);
      expect(await db.select().from(invoices)).toHaveLength(0);
      expect((await db.select().from(requests).where(eq(requests.id, r.id)))[0]).toMatchObject({ status: "completed", reservedCents: 4000 }); // the unpaid share stays escrowed
      expect(await ensureAccount(biz.id)).toMatchObject({ availableCents: 5000_00 - 4000, reservedCents: 4000 });
      expect((await ensureAccount(d.id)).availableCents).toBe(0);
      await sound();
      expect(await settle.paySettlementsDue()).toBe(0); // still failing: the settlement stays `failed`, nothing half-posted
      expect((await db.select().from(settlements).where(eq(settlements.id, s.id)))[0].status).toBe("failed");
      await sound();
      await db.delete(settings).where(eq(settings.key, "a2_fail")); // the cause is fixed
      expect(await settle.paySettlementsDue()).toBe(1);
      expect((await db.select().from(settlements).where(eq(settlements.id, s.id)))[0].status).toBe("paid");
      expect((await db.select().from(requests).where(eq(requests.id, r.id)))[0].reservedCents).toBe(0);
      expect(await ensureAccount(biz.id)).toMatchObject({ availableCents: 5000_00 - 4000, reservedCents: 0 });
      expect((await ensureAccount(d.id)).availableCents).toBe(7 * 4 * 100); // SAR 7 × 4 parcels
      expect(await db.select().from(invoices)).toHaveLength(1);
      await sound();
    } finally {
      await db.execute(sql`drop trigger if exists a2_fail_fee_t on ledger_entries`);
      await db.execute(sql`drop function if exists a2_fail_fee()`);
    }
  });
});

