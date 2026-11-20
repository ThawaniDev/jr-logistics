/**
 * Invoice detail views: `GET /admin/finance/invoices/:id` (finance.view) and `GET /business/invoices/:id` (the company's own invoices only).
 * Covers permissions, 404s, that the derived lines add up to the invoice total, the admin-only money block, and that nothing about provider cost,
 * margin or payee ever reaches the company.
 */
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { businessProfiles, invoices, ledgerEntries, offers, settlements } from "@/db/schema";
import { resetDb, shutdown, mkAdmin, mkBusiness, mkDriver, mkOffice, mkRule, mkStaff, publishedRequest } from "../helpers/factories";
import { work } from "../helpers/work";
import { call } from "../helpers/api";
import { createSession } from "@/server/auth/session";
import * as jobs from "@/server/jobs";

beforeEach(resetDb);
afterAll(shutdown);

const tok = async (u: { id: string }) => (await createSession(u.id, "mobile")).token;
const adminGet = async (u: { id: string }, id: string) => call("GET", `/admin/finance/invoices/${id}`, { token: await tok(u) });
const bizGet = async (u: { id: string }, id: string) => call("GET", `/business/invoices/${id}`, { token: await tok(u) });
const UNKNOWN = "00000000-0000-4000-8000-000000000000";
const sum = (lines: Array<{ amountCents: number | null }>) => lines.reduce((a, l) => a + (l.amountCents ?? 0), 0);

/** A settled job: the driver delivers `delivered` of 10 parcels (the rest are refused at the door), the settlement is paid and the invoice issued. */
async function paidJob(o: { delivered?: number; officeId?: string } = {}) {
  const admin = await mkAdmin(); await mkRule(admin); // 10.00 per parcel, provider cost 7.00
  const biz = await mkBusiness({ fundsCents: 500_00 });
  const driver = await mkDriver({ officeId: o.officeId ?? null });
  const r = await publishedRequest(biz, { shipmentsPerDriver: 10 });
  const [offer] = await db.select().from(offers).where(eq(offers.requestId, r.id));
  await jobs.acceptOffer(driver, offer.id, true); await jobs.confirmAttendance(biz, offer.id, true);
  await work(biz, driver, offer.id, o.delivered ?? 10);
  const [s] = await db.select().from(settlements).where(eq(settlements.requestId, r.id));
  const [inv] = await db.select().from(invoices).where(eq(invoices.settlementId, s.id));
  return { admin, biz, driver, r, offer, s, inv };
}

describe("who may open an invoice", () => {
  it("the admin route needs finance.view; the company route is for companies only; nobody anonymous", async () => {
    const { admin, biz, driver, inv } = await paidJob();
    const viewer = await mkStaff(["finance.view"]), other = await mkStaff(["users.view", "settlements.review", "wallets.view"]);
    expect((await adminGet(admin, inv.id)).status).toBe(200);
    expect((await adminGet(viewer, inv.id)).status).toBe(200);
    expect((await adminGet(other, inv.id)).status).toBe(403);
    expect((await adminGet(biz, inv.id)).status).toBe(403); // a company never reaches the back office…
    expect((await adminGet(driver, inv.id)).status).toBe(403);
    expect((await bizGet(biz, inv.id)).status).toBe(200); // …and has its own route
    expect((await bizGet(driver, inv.id)).status).toBe(403);
    expect((await bizGet(viewer, inv.id)).status).toBe(403);
    expect((await bizGet(admin, inv.id)).status).toBe(403);
    expect((await call("GET", `/admin/finance/invoices/${inv.id}`)).status).toBe(401);
    expect((await call("GET", `/business/invoices/${inv.id}`)).status).toBe(401);
  });
  it("a company sees only its own invoices; somebody else's is simply not found", async () => {
    const { biz, inv } = await paidJob();
    const rival = await mkBusiness({ fundsCents: 100_00 });
    expect((await bizGet(rival, inv.id)).status).toBe(404);
    expect((await bizGet(biz, inv.id)).status).toBe(200);
  });
  it("an unknown or malformed id is a 404 for both, and the list totals route still answers (it comes first)", async () => {
    const { admin, biz } = await paidJob();
    for (const id of [UNKNOWN, "not-a-uuid", "totals-"]) { expect((await adminGet(admin, id)).status, id).toBe(404); expect((await bizGet(biz, id)).status, id).toBe(404); }
    expect((await call("GET", "/admin/finance/invoices/totals", { token: await tok(admin) })).json.invoices).toBe(1);
  });
});

describe("the invoice and its lines", () => {
  it("a fully delivered job is one billed line that equals the total; the buyer comes from the company profile", async () => {
    const { admin, biz, inv, s } = await paidJob();
    await db.update(businessProfiles).set({ companyName: "Alpha Trading", crNumber: "1010123456", taxNumber: "310122393500003", address: "12 Olaya St", responsiblePerson: "Sara Ali" }).where(eq(businessProfiles.userId, biz.id));
    const d = (await adminGet(admin, inv.id)).json;
    expect(d.invoice).toMatchObject({ id: inv.id, number: inv.number, totalCents: 100_00, vatPct: 15 });
    expect(d.invoice.subtotalCents + d.invoice.vatCents).toBe(d.invoice.totalCents);
    expect(d.lines).toEqual([{ kind: "billed", qty: 10, unit: "shipment", unitPriceCents: 10_00, amountCents: 100_00 }]);
    expect(sum(d.lines)).toBe(d.invoice.totalCents); expect(d.linesTotalCents).toBe(d.invoice.totalCents);
    expect(d.buyer).toMatchObject({ id: biz.id, name: "Alpha Trading", contact: "Sara Ali", city: "riyadh", address: "12 Olaya St", crNumber: "1010123456", taxNumber: "310122393500003" });
    expect(d.seller).toEqual({ name: "JR Logistics", vatPct: 15 });
    expect(d.order).toMatchObject({ id: s.requestId, service: "delivery_driver", status: "completed", pickupCity: "riyadh", deliveryCity: "riyadh" });
    expect(d.parcels).toMatchObject({ total: 10, delivered: 10 });
    expect(d.paidAt).toBe(s.paidAt?.toISOString());
  });
  it("parcels that were not delivered become a line that charges nothing; the lines still add up to the total", async () => {
    const { admin, biz, inv } = await paidJob({ delivered: 9 });
    for (const d of [(await adminGet(admin, inv.id)).json, (await bizGet(biz, inv.id)).json]) {
      expect(d.invoice.totalCents).toBe(90_00);
      expect(d.lines.map((l: any) => l.kind)).toEqual(["billed", "released"]);
      expect(d.lines[0]).toMatchObject({ qty: 9, unitPriceCents: 10_00, amountCents: 90_00 });
      expect(d.lines[1]).toMatchObject({ qty: 1, amountCents: null, releasedCents: 10_00 });
      expect(sum(d.lines)).toBe(d.invoice.totalCents);
      expect(d.parcels.delivered).toBe(9); expect(d.parcels.failed + d.parcels.returned).toBe(1);
    }
  });
  it("an invoice without a settlement is one service line, with no money block; a legacy row whose subtotal + VAT is off is shown consistently", async () => {
    const { admin, biz, r, inv } = await paidJob();
    const [bare] = await db.insert(invoices).values({ number: "INV-LEGACY-1", requestId: r.id, settlementId: null, businessId: biz.id, subtotalCents: 1, vatCents: 150, totalCents: 1150, vatPct: 15 }).returning();
    const d = (await adminGet(admin, bare.id)).json;
    expect(d.lines).toEqual([{ kind: "service", qty: 1, unit: null, unitPriceCents: 1150, amountCents: 1150 }]);
    expect(d.invoice).toMatchObject({ subtotalCents: 1000, vatCents: 150, totalCents: 1150 });
    expect(d.settlementId).toBeNull(); expect(d.paidAt).toBeNull();
    expect(d.admin).toMatchObject({ settlement: null, payee: null, ledger: [], snapshot: null });
    expect(d.admin.siblings.map((x: any) => x.id)).toEqual([inv.id]); // the other invoice of the same order
  });
});

describe("what only staff see", () => {
  it("the settlement, the payee, the balanced ledger entries, the locked price and the company's neighbouring invoices", async () => {
    const { admin, driver, inv, s, biz, r } = await paidJob({ delivered: 9 });
    const [second] = await db.insert(invoices).values({ number: "INV-LATER-1", requestId: r.id, settlementId: null, businessId: biz.id, subtotalCents: 870, vatCents: 130, totalCents: 1000, vatPct: 15 }).returning(); // a later invoice of the same company
    const d = (await adminGet(admin, inv.id)).json;
    expect(d.settlementId).toBe(s.id);
    expect(d.admin.settlement).toMatchObject({ id: s.id, status: "paid", finalUnits: 9, expectedUnits: 10, customerCents: 90_00, providerCents: 63_00, marginCents: 27_00, refundCents: 10_00, adjustmentCents: 0 });
    expect(d.admin.settlement.customerCents).toBe(d.admin.settlement.providerCents + d.admin.settlement.marginCents);
    expect(d.admin.payee).toEqual({ kind: "driver", id: driver.id, name: driver.name });
    expect(d.admin.ledger.map((e: any) => e.kind).sort()).toEqual(["charge", "payout", "platform_fee", "release_reserve"]);
    expect(d.admin.ledger.reduce((a: number, e: any) => a + e.availableCents + e.reservedCents + e.heldCents, 0)).toBe(0); // balanced
    expect(d.admin.ledger.find((e: any) => e.kind === "platform_fee")).toMatchObject({ accountKind: "platform", availableCents: 27_00 });
    expect(d.admin.snapshot).toMatchObject({ unitPriceCents: 10_00, providerCostCents: 7_00, unit: "shipment" });
    expect(d.admin.prev).toBeNull(); expect(d.admin.next).toMatchObject({ id: second.id, number: second.number });
    const later = (await adminGet(admin, second.id)).json;
    expect(later.admin.prev).toMatchObject({ id: inv.id }); expect(later.admin.next).toBeNull();
    expect(d.admin.siblings.map((x: any) => x.id)).toEqual([second.id]); // the other invoice of the same order
    // every ledger entry that references the settlement is listed
    expect(d.admin.ledger).toHaveLength((await db.select().from(ledgerEntries).where(eq(ledgerEntries.settlementId, s.id))).length);
  });
  it("an invoice paid out to a courier office names the office as the payee", async () => {
    const office = await mkOffice();
    const { admin, inv, driver } = await paidJob({ officeId: office.id });
    const d = (await adminGet(admin, inv.id)).json;
    expect(d.admin.payee).toMatchObject({ kind: "office", id: office.id }); expect(d.admin.payee.name).toContain("Off ");
    expect(d.admin.driver).toMatchObject({ id: driver.id });
  });
});

describe("what the company never sees", () => {
  it("no provider cost, margin, payee, ledger, settlement id or price snapshot in the company payload (same lines and totals as staff)", async () => {
    const { admin, biz, inv, driver } = await paidJob({ delivered: 9 });
    const res = await bizGet(biz, inv.id);
    expect(res.status).toBe(200);
    const d = res.json, staff = (await adminGet(admin, inv.id)).json;
    expect(Object.keys(d).sort()).toEqual(["buyer", "invoice", "linesTotalCents", "lines", "order", "paidAt", "parcels", "pricing", "seller"].sort());
    expect(d.admin).toBeUndefined(); expect(d.settlementId).toBeUndefined();
    expect(res.text).not.toMatch(/provider|margin|payee|ledger|snapshot|settlementId|offerId/i);
    expect(res.text).not.toContain(driver.id);
    expect(d.pricing).toEqual({ unit: "shipment", unitPriceCents: 10_00 });
    expect(d.invoice).toEqual(staff.invoice); expect(d.lines).toEqual(staff.lines); expect(d.buyer).toEqual(staff.buyer);
  });
});
