/**
 * Admin finance pages (UI redesign): the aggregates behind the overview and the totals above each list.
 * Every total must agree with the list it sits above, and every route must check the permission of the page it feeds.
 */
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { and, asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { complaints, offers, requests, settlements, shipments, walletAccounts } from "@/db/schema";
import { shutdown, mkAdmin, mkBusiness, mkDriver, mkRule, mkShipments, mkStaff, publishedRequest, WAREHOUSE } from "../helpers/factories";
import { resetDbWithFieldModes } from "../helpers/field-modes";
import { call } from "../helpers/api";
import * as jobs from "@/server/jobs";
import * as stops from "@/server/stops";
import * as settle from "@/server/settlement";
import { createSession } from "@/server/auth/session";
import { currentStopOf, otpFor } from "@/server/shipments";
import { finishLoading, scanLoad } from "@/server/loading";
import { receiveCash } from "@/server/cod";
import { ensureAccount, post } from "@/server/wallet";
import { listInvoices, listLedger } from "@/server/adminviews";

beforeEach(resetDbWithFieldModes); // J2 / J3: routing and B2B shipments default to OFF — this suite exercises the route / approve-route / business-parcel behaviour
afterAll(shutdown);

const tok = async (u: { id: string }) => (await createSession(u.id, "mobile")).token;
const get = async (u: { id: string }, path: string) => call("GET", `/admin/finance${path}`, { token: await tok(u) });

/** A finished job whose parcels carried the given COD amounts: settled and paid, the driver holds the cash. */
async function finishedCashJob(cod: number[]) {
  const admin = await mkAdmin(); await mkRule(admin);
  const biz = await mkBusiness({ fundsCents: 5000_00 }); const d = await mkDriver();
  const rows = mkShipments(cod.length, { withRefs: true }).map((s, i) => ({ ...s, codCents: cod[i] }));
  const r = await publishedRequest(biz, { shipments: rows, shipmentsPerDriver: cod.length });
  const [off] = await db.select().from(offers).where(and(eq(offers.requestId, r.id), eq(offers.driverId, d.id)));
  await jobs.acceptOffer(d, off.id, true);
  await db.update(requests).set({ startsAt: new Date(Date.now() + 3600_000) }).where(eq(requests.id, r.id));
  await jobs.checkIn(d, off.id, WAREHOUSE); await jobs.confirmAttendance(biz, off.id, true);
  for (const p of await db.select().from(shipments).where(eq(shipments.offerId, off.id)).orderBy(asc(shipments.seq))) await scanLoad(d, off.id, p.code);
  await finishLoading(d, off.id); await stops.approveRoute(d, off.id);
  for (let s = await currentStopOf(db, off.id); s; s = await currentStopOf(db, off.id)) {
    await stops.arriveAtStop(d, off.id, s.id);
    await stops.deliverStop(d, off.id, s.id, { code: s.code, otp: otpFor(s), cashCollectedCents: s.codCents > 0 ? s.codCents : undefined });
  }
  await jobs.reportDelivered(d, off.id);
  return { admin, biz, d, off, r };
}

describe("finance view aggregates", () => {
  it("each route checks the permission of the page it feeds", async () => {
    const view = await mkStaff(["finance.view"]); const reviewer = await mkStaff(["settlements.review"]); const payouts = await mkStaff(["withdrawals.manage"]);
    const wallets = await mkStaff(["wallets.view"]); const cash = await mkStaff(["cod.manage"]); const other = await mkStaff(["users.view"]);
    const status = async (u: { id: string }, path: string) => (await get(u, path)).status;
    const matrix: Array<[string, Array<{ id: string }>, Array<{ id: string }>]> = [
      ["/overview", [view], [reviewer, payouts, wallets, cash, other]],
      ["/settlements/stats", [view, reviewer], [payouts, wallets, cash, other]],
      ["/withdrawals/stats", [view, payouts], [reviewer, wallets, cash, other]],
      ["/ledger/totals", [view, wallets], [reviewer, payouts, cash, other]],
      ["/invoices/totals", [view], [reviewer, payouts, wallets, cash, other]],
      ["/cod/drivers", [view, cash], [reviewer, payouts, wallets, other]],
    ];
    for (const [path, allowed, denied] of matrix) {
      for (const u of allowed) expect(await status(u, path), `${path} allowed`).toBe(200);
      for (const u of denied) expect(await status(u, path), `${path} denied`).toBe(403);
    }
    const biz = await mkBusiness(); // a business account never reaches the back office
    expect((await call("GET", "/admin/finance/overview", { token: await tok(biz) })).status).toBe(403);
    expect((await call("GET", "/admin/finance/overview")).status).toBe(401);
  });

  it("settlement stats count paid and held settlements under the same filters as the list", async () => {
    const { admin, d, r } = await finishedCashJob([10_000, 0, 5_000]);
    const list = (await get(admin, "/settlements")).json; // the plain list the page shows
    expect(list.total).toBe(1);
    const stats = (await get(admin, "/settlements/stats")).json;
    expect(stats.all).toMatchObject({ n: 1, customerCents: list.items[0].customerCents, providerCents: list.items[0].providerCents, marginCents: list.items[0].marginCents });
    expect(stats.paid.n).toBe(1); expect(stats.hold.n).toBe(0); expect(stats.other.n).toBe(0);
    expect(stats.paid.customerCents).toBe(stats.paid.providerCents + stats.paid.marginCents);
    // the search box is applied to the totals too (order reference, driver name); a date range outside the job empties them
    expect((await get(admin, `/settlements/stats?q=${r.ref}`)).json.all.n).toBe(1);
    expect((await get(admin, `/settlements/stats?q=${encodeURIComponent(d.name)}`)).json.all.n).toBe(1);
    expect((await get(admin, "/settlements/stats?q=nobody-by-this-name")).json.all.n).toBe(0);
    expect((await get(admin, "/settlements/stats?to=2000-01-01T00:00:00.000Z")).json.all.n).toBe(0);
    // a settlement left waiting by a complaint is "on hold" (E18: status approved) and shows in the overview's counters
    await db.update(settlements).set({ status: "approved", paidAt: null }).where(eq(settlements.requestId, r.id));
    const held = (await get(admin, "/settlements/stats")).json;
    expect(held.hold).toMatchObject({ n: 1, providerCents: stats.paid.providerCents }); expect(held.paid.n).toBe(0);
    let ov = (await get(admin, "/overview")).json.settlements;
    expect(ov).toMatchObject({ heldN: 1, heldCents: stats.paid.providerCents, blockedByComplaintN: 0, waitingN: 0 });
    const [s] = await db.select().from(settlements).where(eq(settlements.requestId, r.id));
    await db.insert(complaints).values({ ref: "CMP-T1", filedBy: s.businessId, filedByRole: "business", requestId: r.id, offerId: s.offerId, category: "other", description: "Missing parcel", holdsSettlement: true });
    ov = (await get(admin, "/overview")).json.settlements;
    expect(ov.blockedByComplaintN).toBe(1);
    // older unpaid states are counted apart from the hold
    await db.update(settlements).set({ status: "pending_review" }).where(eq(settlements.requestId, r.id));
    ov = (await get(admin, "/overview")).json.settlements;
    expect(ov).toMatchObject({ heldN: 0, waitingN: 1 });
    expect((await get(admin, "/settlements/stats")).json.other.n).toBe(1);
  });

  it("the overview agrees with the older summary and with the cash drivers hold", async () => {
    const { admin, d, off } = await finishedCashJob([12_000, 8_050]);
    const ov = (await get(admin, "/overview")).json; const sum = (await get(admin, "/summary")).json;
    expect(ov.platformRevenueCents).toBe(sum.platformRevenueCents); expect(ov.paidSettlements).toBe(sum.paidSettlements); expect(ov.marginCents).toBe(sum.marginCents);
    expect(ov.balances).toEqual(sum.userBalances);
    expect(ov.cod).toMatchObject({ collectedCents: 20_050, receivedCents: 0, outstandingCents: 20_050, drivers: 1, orders: 1 });
    expect(ov.cod.top).toEqual([expect.objectContaining({ driverId: d.id, driverName: d.name, outstandingCents: 20_050, openOrders: 1 })]);
    await receiveCash(admin, off.id, 12_000);
    const drivers = (await get(admin, "/cod/drivers")).json;
    expect(drivers.totals).toEqual({ collectedCents: 20_050, receivedCents: 12_000, outstandingCents: 8_050, drivers: 1, orders: 1 });
    expect(drivers.items).toEqual([expect.objectContaining({ driverId: d.id, orders: 1, openOrders: 1, collectedCents: 20_050, receivedCents: 12_000, outstandingCents: 8_050 })]);
    // search by the warehouse, the order or the driver; a settled order stays in the history but leaves the "outstanding" view
    const [req] = await db.select().from(requests);
    expect((await get(admin, `/cod/drivers?q=${req.ref}`)).json.items).toHaveLength(1);
    expect((await get(admin, "/cod/drivers?q=nobody-by-this-name")).json.items).toHaveLength(0);
    expect((await get(admin, `/cod/drivers?businessId=${req.businessId}`)).json.totals.outstandingCents).toBe(8_050);
    await receiveCash(admin, off.id, 8_050);
    const done = (await get(admin, "/cod/drivers?onlyOutstanding=1")).json;
    expect(done.items).toEqual([]); expect(done.totals).toMatchObject({ outstandingCents: 0, drivers: 0, orders: 0, receivedCents: 20_050 });
    expect((await get(admin, "/cod/drivers")).json.items).toHaveLength(1); // still in the full history
    expect((await get(admin, "/overview")).json.cod).toMatchObject({ outstandingCents: 0, drivers: 0, top: [] });
  });

  it("withdrawal stats follow the queue: pending, paid and rejected with their amounts", async () => {
    const { admin, d } = await finishedCashJob([0]);
    await post(db, { accountId: (await ensureAccount(d.id)).id, kind: "topup", available: 90_000, idempotencyKey: "fv:topup", simulated: true });
    expect((await get(admin, "/withdrawals/stats")).json.all).toEqual({ n: 0, cents: 0 });
    const w1 = await settle.requestWithdrawal(d, 20_000); const w2 = await settle.requestWithdrawal(d, 15_000); const w3 = await settle.requestWithdrawal(d, 12_000);
    let st = (await get(admin, "/withdrawals/stats")).json;
    expect(st.pending).toMatchObject({ n: 3, cents: 47_000 }); expect(st.pending.oldestAt).toBeTruthy(); expect(st.all).toEqual({ n: 3, cents: 47_000 });
    expect((await get(admin, "/overview")).json.withdrawals).toMatchObject({ pendingN: 3, pendingCents: 47_000 });
    await settle.decideWithdrawal(admin, w1.id, "paid", { paymentRef: "BANK-1" });
    await settle.decideWithdrawal(admin, w2.id, "rejected", { note: "IBAN mismatch" });
    st = (await get(admin, "/withdrawals/stats")).json;
    expect(st).toMatchObject({ pending: { n: 1, cents: 12_000 }, paid: { n: 1, cents: 20_000 }, rejected: { n: 1, cents: 15_000 }, all: { n: 3, cents: 47_000 } });
    // …and each count equals what the list returns for that status
    for (const status of ["pending", "paid", "rejected"] as const) expect((await get(admin, `/withdrawals?status=${status}`)).json.total).toBe(st[status].n);
    void w3;
  });

  it("ledger and invoice totals are the sums of the rows the lists return for the same filters", async () => {
    const { admin, d, biz, r } = await finishedCashJob([0, 0]);
    const staff = admin;
    const everything = await listLedger(staff, { pageSize: 100 });
    expect(everything.total).toBeLessThanOrEqual(100);
    const sums = (items: Array<{ availableDeltaCents: number; reservedDeltaCents: number; heldDeltaCents: number }>) => ({
      inCents: items.filter((e) => e.availableDeltaCents > 0).reduce((a, e) => a + e.availableDeltaCents, 0),
      outCents: items.filter((e) => e.availableDeltaCents < 0).reduce((a, e) => a - e.availableDeltaCents, 0),
      reservedNetCents: items.reduce((a, e) => a + e.reservedDeltaCents, 0), heldNetCents: items.reduce((a, e) => a + e.heldDeltaCents, 0),
    });
    const all = (await get(admin, "/ledger/totals")).json;
    expect(all).toMatchObject({ entries: everything.total, ...sums(everything.items), netCents: sums(everything.items).inCents - sums(everything.items).outCents });
    // by kind, by account and by request
    const payouts = await listLedger(staff, { pageSize: 100, kind: "payout" });
    expect((await get(admin, "/ledger/totals?kind=payout")).json).toMatchObject({ entries: payouts.total, ...sums(payouts.items) });
    expect(payouts.total).toBeGreaterThan(0);
    const mine = await listLedger(staff, { pageSize: 100, userId: d.id });
    const dt = (await get(admin, `/ledger/totals?userId=${d.id}`)).json;
    expect(dt).toMatchObject({ entries: mine.total, ...sums(mine.items) });
    const [acct] = await db.select().from(walletAccounts).where(eq(walletAccounts.ownerId, d.id));
    expect(dt.netCents).toBe(acct.availableCents); // every wallet change is a ledger entry, so the net of an account is its balance
    const one = await listLedger(staff, { pageSize: 100, requestId: r.id });
    expect((await get(admin, `/ledger/totals?requestId=${r.id}`)).json).toMatchObject({ entries: one.total, ...sums(one.items) });
    expect((await get(admin, "/ledger/totals?to=2000-01-01T00:00:00.000Z")).json).toMatchObject({ entries: 0, inCents: 0, outCents: 0, netCents: 0 });
    // invoices
    const inv = await listInvoices(staff, { pageSize: 100 });
    expect(inv.total).toBe(1);
    const it = (await get(admin, "/invoices/totals")).json;
    expect(it).toEqual({ invoices: 1, subtotalCents: inv.items[0].subtotalCents, vatCents: inv.items[0].vatCents, totalCents: inv.items[0].totalCents });
    expect(it.subtotalCents + it.vatCents).toBe(it.totalCents);
    expect((await get(admin, `/invoices/totals?businessId=${biz.id}`)).json.invoices).toBe(1);
    expect((await get(admin, `/invoices/totals?businessId=${d.id}`)).json).toEqual({ invoices: 0, subtotalCents: 0, vatCents: 0, totalCents: 0 });
    expect((await get(admin, "/invoices/totals?businessId=not-a-uuid")).status).toBe(422);
  });
});
