/**
 * Regression tests for the gaps found when the rebuild was audited against the old system (business, driver/office,
 * admin/finance). Each test pins one behaviour that was wrong or missing.
 */
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { offers, requests, settlements, walletAccounts, driverProfiles, complaints, tickets, apiIdempotency, users, ledgerEntries, officeInvites } from "@/db/schema";
import { resetDb, shutdown, mkAdmin, mkStaff, mkBusiness, mkDriver, mkRule, mkOffice, publishedRequest, reqInput, tomorrow } from "../helpers/factories";
import { call } from "../helpers/api";
import * as jobs from "@/server/jobs";
import * as settle from "@/server/settlement";
import { ensureAccount, platformAccount, post } from "@/server/wallet";
import { createDraft, publishRequest } from "@/server/requests";
import { runMaintenance } from "@/server/maintenance";
import { updateSettings } from "@/server/settings";
import { driverJobView, businessRequestDetail } from "@/server/views";
import { inviteDriver, respondInvite, unlinkDriver, officeSettlements, officeReport, officeJobs, officeOpportunities } from "@/server/office";
import { createExternalJob, setWebhook, rotateWebhookSecret } from "@/server/integrations";
import { createStaff, updateStaff, resetStaffPassword } from "@/server/accounts";
import { clearSuspension } from "@/server/ops";
import { adjustWallet, listLedger, listInvoices, listCancellations, citySummary, driverOpsProfile } from "@/server/adminviews";
import { createSession } from "@/server/auth/session";
import { work, parcelsOf } from "../helpers/work";
import * as stops from "@/server/stops";
import { currentStopOf, otpFor } from "@/server/shipments";

beforeEach(resetDb);
afterAll(shutdown);

const bal = async (id: string) => (await db.select().from(walletAccounts).where(eq(walletAccounts.id, (await ensureAccount(id)).id)))[0];
const offerOf = async (requestId: string, driverId?: string) => (await db.select().from(offers).where(driverId ? and(eq(offers.requestId, requestId), eq(offers.driverId, driverId)) : eq(offers.requestId, requestId)))[0];
async function completeJob(biz: any, driver: any, offerId: string, units = 10) {
  await jobs.acceptOffer(driver, offerId, true);
  await jobs.confirmAttendance(biz, offerId, true);
  await work(biz, driver, offerId, units); // finishing the route confirms the delivery and pays (E16/E18)
}
const setup = async (funds = 2000_00) => { const admin = await mkAdmin(); await mkRule(admin); const biz = await mkBusiness({ fundsCents: funds }); return { admin, biz }; };

describe("business flow", () => {
  it("stores what the driver carries (contents) and exposes it only after accepting", async () => {
    const { biz } = await setup(); const d = await mkDriver();
    const r = await publishedRequest(biz, { contents: "Fresh dates, 12 cartons", notes: "Call on arrival 0500000000" });
    expect((await db.select().from(requests).where(eq(requests.id, r.id)))[0].contents).toBe("Fresh dates, 12 cartons");
    const o = await offerOf(r.id, d.id);
    const before = await driverJobView(o, r);
    expect(before.contents).toBeNull(); expect(before.notes).toBeNull(); expect(before.pickup).toBeNull();
    await jobs.acceptOffer(d, o.id, true);
    const [o2] = await db.select().from(offers).where(eq(offers.id, o.id));
    const after = await driverJobView(o2, r);
    expect(after.contents).toBe("Fresh dates, 12 cartons"); expect(after.notes).toContain("Call on arrival"); expect(after.pickup?.address).toBeTruthy();
  });

  it("completed jobs no longer expose addresses, recipient or notes to the driver", async () => {
    const { biz } = await setup(); const d = await mkDriver();
    const r = await publishedRequest(biz, { recipientName: "Hind", recipientPhone: "0555000111", notes: "gate 3" });
    const o = await offerOf(r.id, d.id);
    await completeJob(biz, d, o.id);
    const [done] = await db.select().from(offers).where(eq(offers.id, o.id));
    const v = await driverJobView(done, (await db.select().from(requests).where(eq(requests.id, r.id)))[0]);
    expect(v.status).toBe("completed");
    expect(v.pickup).toBeNull(); expect(v.delivery).toBeNull(); expect(v.recipient).toBeNull(); expect(v.notes).toBeNull();
  });

  it("confirming one driver's attendance does not close the remaining open slots", async () => {
    const { biz } = await setup(); const [d1, d2, d3] = await Promise.all([mkDriver(), mkDriver(), mkDriver()]);
    const r = await publishedRequest(biz, { quantity: 3 });
    const o1 = await offerOf(r.id, d1.id);
    await jobs.acceptOffer(d1, o1.id, true);
    await jobs.confirmAttendance(biz, o1.id, true);
    expect((await db.select().from(requests).where(eq(requests.id, r.id)))[0].status).toBe("filling");
    await jobs.acceptOffer(d2, (await offerOf(r.id, d2.id)).id, true);        // still possible
    await jobs.acceptOffer(d3, (await offerOf(r.id, d3.id)).id, true);
    expect((await db.select().from(requests).where(eq(requests.id, r.id)))[0].slotsFilled).toBe(3);
  });

  it("offers only the actions that can work: no loading for rentals, no rating twice", async () => {
    const { biz } = await setup(); const d = await mkDriver();
    const admin = await mkAdmin(); await mkRule(admin, { service: "car_with_driver", priceCents: 30000, providerCostCents: 20000 });
    const rent = await publishedRequest(biz, { service: "car_with_driver", shipmentsPerDriver: undefined, vehicleType: "sedan" });
    const ro = await offerOf(rent.id, d.id);
    await jobs.acceptOffer(d, ro.id, true); await jobs.confirmAttendance(biz, ro.id, true);
    const detail = await businessRequestDetail((await db.select().from(requests).where(eq(requests.id, rent.id)))[0], biz);
    expect(detail.offers[0].actions).not.toContain("record_loading");
    expect(detail.offers[0].actions).toContain("handover_custody");

    const d2 = await mkDriver(); const r2 = await publishedRequest(biz, { startsAt: new Date(Date.now() + 3 * 864e5) });
    const o2 = await offerOf(r2.id, d2.id); await completeJob(biz, d2, o2.id);
    const req2 = (await db.select().from(requests).where(eq(requests.id, r2.id)))[0];
    expect((await businessRequestDetail(req2, biz)).offers[0].actions).toContain("rate");
    await jobs.rate(biz, o2.id, 5);
    const after = (await businessRequestDetail(req2, biz)).offers[0];
    expect(after.actions).not.toContain("rate"); expect(after.ratedByMe).toBe(true);
  });

  it("a partly staffed request closes its open slots after the start time and refunds their escrow", async () => {
    const { biz } = await setup(1000_00); const [d1] = await Promise.all([mkDriver(), mkDriver()]);
    const r = await publishedRequest(biz, { quantity: 2 });
    expect((await bal(biz.id)).reservedCents).toBe(200_00);
    await jobs.acceptOffer(d1, (await offerOf(r.id, d1.id)).id, true);
    await db.update(requests).set({ startsAt: new Date(Date.now() - 2 * 3600_000) }).where(eq(requests.id, r.id));
    const out = await runMaintenance();
    expect(out.partialClosed).toBe(1);
    const [after] = await db.select().from(requests).where(eq(requests.id, r.id));
    expect(after.quantity).toBe(1); expect(after.status).toBe("assigned"); expect(after.reservedCents).toBe(100_00);
    const b = await bal(biz.id); expect(b.reservedCents).toBe(100_00); expect(b.availableCents).toBe(900_00);
    // the job can now finish on its own (all remaining slots are staffed)
    const o1 = await offerOf(r.id, d1.id);
    await jobs.confirmAttendance(biz, o1.id, true); await work(biz, d1, o1.id, 10);
    expect((await db.select().from(requests).where(eq(requests.id, r.id)))[0].status).toBe("completed");
    expect((await runMaintenance()).partialClosed).toBe(0); // idempotent
  });

  it("publishing needs the pickup address and the shipments list (each parcel carries its own recipient and address)", async () => {
    const { biz } = await setup(); await mkDriver();
    const noAddr = await createDraft(biz, reqInput({ pickupAddress: undefined }));
    await expect(publishRequest(biz, noAddr.id, { termsAccepted: true })).rejects.toMatchObject({ code: "VALIDATION", details: { field: "pickupAddress" } });
    const noParcels = await createDraft(biz, reqInput({ shipments: null }));
    await expect(publishRequest(biz, noParcels.id, { termsAccepted: true })).rejects.toMatchObject({ code: "MANIFEST_REQUIRED" });
    const ok = await createDraft(biz, reqInput());
    expect((await publishRequest(biz, ok.id, { termsAccepted: true })).status).toBe("published");
  });

  it("billing can never exceed what was handed over (escrow cannot be overrun): the count comes from the parcels, not from typing", async () => {
    const { biz } = await setup(); const d = await mkDriver();
    const r = await publishedRequest(biz); const o = await offerOf(r.id, d.id);
    await jobs.acceptOffer(d, o.id, true); await jobs.confirmAttendance(biz, o.id, true);
    await expect(jobs.reportDelivered(d, o.id)).rejects.toMatchObject({ code: "INVALID_TRANSITION" }); // nothing handed over / route not approved
    const all = await parcelsOf(o.id); expect(all).toHaveLength(10);
    await jobs.recordLoading(biz, o.id, undefined, { codes: all.slice(0, 8).map((s) => s.code) }); // only 8 of 10 handed over
    await jobs.acknowledgeLoading(d, o.id, true);
    expect((await offerOf(r.id, d.id)).expectedUnits).toBe(8); // the 2 not handed over stop counting against this driver
    await stops.approveRoute(d, o.id);
    await expect(jobs.reportDelivered(d, o.id)).rejects.toMatchObject({ code: "STOPS_PENDING" });
    for (;;) { const s = await currentStopOf(db, o.id); if (!s) break; await stops.arriveAtStop(d, o.id, s.id); await stops.deliverStop(d, o.id, s.id, { code: s.code, otp: otpFor(s) }); }
    await jobs.reportDelivered(d, o.id);
    const [s] = await db.select().from(settlements);
    expect(s.finalUnits).toBe(8); expect(s.reservedCents).toBe(80_00); // escrow share = the 8 parcels it carried; the 2 returned to the business via the request release
  });
});

describe("external API", () => {
  const input = () => reqInput();
  it("two concurrent calls with the same Idempotency-Key create exactly one job", async () => {
    const { biz } = await setup(); await mkDriver();
    const res = await Promise.allSettled([createExternalJob(biz, input(), "idem-key-1"), createExternalJob(biz, input(), "idem-key-1")]);
    expect((await db.select().from(requests).where(eq(requests.businessId, biz.id)))).toHaveLength(1);
    const ok = res.filter((r) => r.status === "fulfilled");
    expect(ok.length).toBeGreaterThanOrEqual(1);
    const again = await createExternalJob(biz, input(), "idem-key-1");
    expect(again.replay).toBe(true); expect(again.status).toBe(201);
    await expect(createExternalJob(biz, reqInput({ quantity: 2 }), "idem-key-1")).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("a failed publish leaves no orphan draft and frees the key for a clean retry", async () => {
    const { biz } = await setup(0); await mkDriver();
    await expect(createExternalJob(biz, input(), "idem-key-2")).rejects.toMatchObject({ code: "INSUFFICIENT_FUNDS" });
    expect(await db.select().from(requests).where(eq(requests.businessId, biz.id))).toHaveLength(0);
    expect(await db.select().from(apiIdempotency)).toHaveLength(0);
    const acct = await ensureAccount(biz.id);
    await post(db, { accountId: acct.id, kind: "topup", available: 500_00, idempotencyKey: "topup-x", simulated: true });
    expect((await createExternalJob(biz, input(), "idem-key-2")).status).toBe(201);
  });

  it("saving the same webhook URL keeps the secret; rotation is explicit", async () => {
    const { biz } = await setup();
    const first = await setWebhook(biz, "https://203.0.113.9/hook");
    expect(first.secret).toMatch(/^whsec_/);
    const same = await setWebhook(biz, "https://203.0.113.9/hook");
    expect(same.secret).toBeNull(); expect(same).toMatchObject({ unchanged: true });
    const rot = await rotateWebhookSecret(biz);
    expect(rot.secret).toMatch(/^whsec_/); expect(rot.secret).not.toBe(first.secret);
    expect((await setWebhook(biz, "https://203.0.113.10/hook")).secret).toMatch(/^whsec_/); // new URL → new secret
  });

  it("junk page/pageSize query values never reach SQL", async () => {
    const { biz } = await setup();
    const { createApiKey } = await import("@/server/integrations");
    const k = await createApiKey(biz, "t");
    const r = await call("GET", "/jobs?page=abc&pageSize=-5", { headers: { "x-api-key": (k as any).key, authorization: `Bearer ${(k as any).key}` } });
    expect([200, 401]).toContain(r.status); // never 500
  });
});

describe("driver & office flow", () => {
  it("office selection is cancelled (C9): a request is never reserved for one office, even if the field is sent", async () => {
    const { biz } = await setup();
    const a = await mkOffice(); const d = await mkDriver();
    const r = await publishedRequest(biz, { preferredOfficeId: a.id } as never);
    expect(r.preferredOfficeId).toBeNull(); expect(r.officeWindowEndsAt).toBeNull();
    expect(await db.select().from(offers).where(eq(offers.requestId, r.id))).toHaveLength(1); // offers went out immediately
    expect((await offerOf(r.id, d.id)).status).toBe("offered");
  });

  it("joining or leaving an office expires offers made under the old link (no wrong payee)", async () => {
    const { biz } = await setup(); const office = await mkOffice(); const d = await mkDriver();
    const r = await publishedRequest(biz);
    expect((await offerOf(r.id, d.id)).officeId).toBeNull();
    const inv = await inviteDriver(office, d.phone!);
    await respondInvite(d, inv.id, true);
    expect((await offerOf(r.id, d.id)).status).toBe("expired");
    // unlink also clears the pending offers that carried the office snapshot
    await db.update(offers).set({ status: "offered" }).where(eq(offers.requestId, r.id));
    await unlinkDriver(office, d.id);
    expect((await offerOf(r.id, d.id)).status).toBe("expired");
  });

  it("cannot invite a driver who belongs to another office, a non-driver, or yourself", async () => {
    const a = await mkOffice(), b = await mkOffice(); const linked = await mkDriver({ officeId: a.id }); const biz = await mkBusiness();
    await expect(inviteDriver(b, linked.phone!)).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(inviteDriver(b, biz.phone!)).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(inviteDriver(b, b.phone!)).rejects.toMatchObject({ code: "VALIDATION" });
    // an old invite from B accepted after the driver joined A is refused too
    const free = await mkDriver(); const inv = await inviteDriver(b, free.phone!);
    await db.update(driverProfiles).set({ officeId: a.id, officeLinkStatus: "linked" }).where(eq(driverProfiles.userId, free.id));
    await expect(respondInvite(free, inv.id, true)).rejects.toMatchObject({ code: "CONFLICT" });
    void officeInvites;
  });

  it("a driver who has arrived can report 'not put to work' once; wrong states are refused", async () => {
    const { biz } = await setup(); const d = await mkDriver();
    const r = await publishedRequest(biz); const o = await offerOf(r.id, d.id);
    await expect(jobs.reportNoWork(d, o.id, "x")).rejects.toMatchObject({ code: "INVALID_TRANSITION" }); // still only offered
    await jobs.acceptOffer(d, o.id, true);
    await expect(jobs.reportNoWork(d, o.id)).rejects.toMatchObject({ code: "INVALID_TRANSITION" });   // accepted, not arrived
    await db.update(offers).set({ status: "arrived", arrivedAt: new Date() }).where(eq(offers.id, o.id));
    const [row] = await db.select().from(offers).where(eq(offers.id, o.id));
    const { driverActions } = await import("@/server/views");
    expect(driverActions(row, (await db.select().from(requests).where(eq(requests.id, r.id)))[0])).toContain("report_no_work");
    const t = await jobs.reportNoWork(d, o.id, "nobody at the gate");
    expect(t.category).toBe("not_put_to_work");
    await expect(jobs.reportNoWork(d, o.id)).rejects.toMatchObject({ code: "CONFLICT" });
    expect(await db.select().from(tickets)).toHaveLength(1);
  });

  it("the office replaces its own driver with a real actor and the substitute goes to its own drivers first", async () => {
    const { biz } = await setup(); const office = await mkOffice();
    const d1 = await mkDriver({ officeId: office.id }), d2 = await mkDriver({ officeId: office.id }), outsider = await mkDriver();
    const r = await publishedRequest(biz, { startsAt: tomorrow() });
    const o = await offerOf(r.id, d1.id); await jobs.acceptOffer(d1, o.id, true);
    const stranger = await mkOffice();
    await expect(jobs.officeReplace(stranger, o.id, "no")).rejects.toMatchObject({ code: "NOT_FOUND" });
    await jobs.officeReplace(office, o.id, "driver sick");
    expect((await db.select().from(offers).where(eq(offers.id, o.id)))[0].status).toBe("replaced");
    const { auditLogs } = await import("@/db/schema");
    const a = (await db.select().from(auditLogs).where(eq(auditLogs.action, "offer.replace")))[0];
    expect(a.actorRole).toBe("office");
    const repl = await db.select().from(offers).where(and(eq(offers.requestId, r.id), eq(offers.isReplacement, true)));
    expect(repl.every((x) => x.officeId === office.id)).toBe(true);
    expect(repl.some((x) => x.driverId === outsider.id)).toBe(false);
    void d2;
  });

  it("office views: enriched settlements, jobs scopes, report and opportunities with reasons", async () => {
    const { biz } = await setup(); const office = await mkOffice(); const d = await mkDriver({ officeId: office.id }); await mkDriver({ officeId: office.id, vehicle: "van", temp: "dry" });
    const r = await publishedRequest(biz); const o = await offerOf(r.id, d.id);
    const opp = await officeOpportunities(office.id);
    expect(opp[0].providerAmountCents).toBe(70_00); expect(opp[0].business).toBeTruthy();
    expect(opp[0].ineligibleDrivers.some((x) => x.reasons.includes("vehicle_mismatch"))).toBe(true);
    await completeJob(biz, d, o.id);
    const jobs_ = await officeJobs(office.id, { scope: "all" });
    expect(jobs_.total).toBe(1); expect(jobs_.items[0].business).toBeTruthy();
    expect((await officeJobs(office.id, { scope: "active" })).total).toBe(0);
    const s = await officeSettlements(office.id);
    expect(s.items[0]).toMatchObject({ ref: r.ref, driver: d.name, amountCents: 70_00 });
    expect(JSON.stringify(s)).not.toContain("customerCents"); expect(JSON.stringify(s)).not.toContain("marginCents");
    const rep = await officeReport(office.id);
    expect(rep.jobs.completed).toBe(1); expect(rep.shipmentsDelivered).toBe(10); expect(rep.money).toMatchObject({ paidCents: 70_00, pendingCents: 0 }); // paid straight into the office wallet
  });
});

describe("admin & finance", () => {
  it("there is no approval step: a finished job is paid at once, and an unpaid settlement left by the old flow is paid by the housekeeping tick", async () => {
    const { biz } = await setup(); const d = await mkDriver();
    const r = await publishedRequest(biz); const o = await offerOf(r.id, d.id); await completeJob(biz, d, o.id);
    const [s] = await db.select().from(settlements);
    expect(s).toMatchObject({ status: "paid", providerCents: 70_00 }); expect(s.reviewedBy).toBeNull(); expect(s.approvedBy).toBeNull();
    expect((await bal(d.id)).availableCents).toBe(70_00);
    // a settlement the old review/approve flow left half-way is swept up (and a paid one is never paid twice)
    expect(await settle.paySettlementsDue()).toBe(0);
    const d2 = await mkDriver(); const r2 = await publishedRequest(biz, { startsAt: new Date(Date.now() + 4 * 864e5) });
    const o2 = await offerOf(r2.id, d2.id);
    await db.insert(complaints).values({ ref: "CP-LEGACY", filedBy: biz.id, filedByRole: "business", requestId: r2.id, offerId: o2.id, category: "other", description: "hold for the test", holdsSettlement: true });
    await completeJob(biz, d2, o2.id);
    const s2 = (await db.select().from(settlements).where(eq(settlements.offerId, o2.id)))[0];
    expect(s2.status).toBe("approved"); expect((await bal(d2.id)).availableCents).toBe(0); // held, not paid
    await db.update(settlements).set({ status: "pending_review" }).where(eq(settlements.id, s2.id)); // as the old flow would have left it
    await db.delete(complaints);
    expect(await settle.paySettlementsDue()).toBe(1);
    expect((await db.select().from(settlements).where(eq(settlements.id, s2.id)))[0].status).toBe("paid");
    expect((await bal(d2.id)).availableCents).toBe(70_00);
  });

  it("a complaint that holds the job defers the payment and the escrow share stays reserved until it is released", async () => {
    const { biz } = await setup(); const d = await mkDriver();
    const r = await publishedRequest(biz); const o = await offerOf(r.id, d.id);
    await db.insert(complaints).values({ ref: "CP-H", filedBy: biz.id, filedByRole: "business", requestId: r.id, offerId: o.id, category: "damage", description: "damaged goods reported", holdsSettlement: true });
    await completeJob(biz, d, o.id);
    expect((await db.select().from(settlements))[0].status).toBe("approved");
    expect((await bal(d.id)).availableCents).toBe(0);
    expect((await bal(biz.id)).reservedCents).toBe(100_00); // the held share is still escrowed
    expect(await settle.paySettlementsDue()).toBe(0);
    await db.delete(complaints);
    expect(await settle.paySettlementsDue()).toBe(1);
    expect((await bal(d.id)).availableCents).toBe(70_00); expect((await bal(biz.id)).reservedCents).toBe(0);
  });

  it("settlement lists carry names/refs and filter by payee and business", async () => {
    const { biz, admin } = await setup(); const d = await mkDriver();
    const r = await publishedRequest(biz); const o = await offerOf(r.id, d.id); await completeJob(biz, d, o.id);
    const l = await settle.listSettlements({});
    expect(l.items[0]).toMatchObject({ ref: r.ref, driverName: d.name }); expect(l.items[0].businessName).toBeTruthy();
    expect((await settle.listSettlements({ payeeId: d.id })).total).toBe(1);
    expect((await settle.listSettlements({ payeeId: biz.id })).total).toBe(0);
    expect((await settle.listSettlements({ businessId: biz.id })).total).toBe(1);
    void admin;
  });

  it("manual adjustments are audited, balanced against the platform account and idempotent", async () => {
    const { admin } = await setup(); const d = await mkDriver();
    const plat = await db.transaction((tx) => platformAccount(tx));
    await post(db, { accountId: plat.id, kind: "platform_fee", available: 1000_00, idempotencyKey: "plat-seed" });
    await expect(adjustWallet(await mkStaff([]), { userId: d.id, amountCents: 100, reason: "goodwill gift", idempotencyKey: "adj-0001" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await adjustWallet(admin, { userId: d.id, amountCents: 50_00, reason: "goodwill credit", idempotencyKey: "adj-0001" });
    const dup = await adjustWallet(admin, { userId: d.id, amountCents: 50_00, reason: "goodwill credit", idempotencyKey: "adj-0001" });
    expect(dup.applied).toBe(false);
    expect((await bal(d.id)).availableCents).toBe(50_00);
    expect((await db.select().from(walletAccounts).where(eq(walletAccounts.id, plat.id)))[0].availableCents).toBe(950_00);
    await adjustWallet(admin, { userId: d.id, amountCents: -20_00, reason: "reverse part of it", idempotencyKey: "adj-0002" });
    expect((await bal(d.id)).availableCents).toBe(30_00);
    await expect(adjustWallet(admin, { userId: d.id, amountCents: -90_00, reason: "too much to take", idempotencyKey: "adj-0003" })).rejects.toMatchObject({ code: "INSUFFICIENT_FUNDS" });
    await expect(adjustWallet(admin, { userId: d.id, amountCents: 10, reason: "x", idempotencyKey: "adj-0004" })).rejects.toMatchObject({ code: "VALIDATION" });
    const led = await listLedger(admin, { kind: "adjustment" });
    expect(led.total).toBe(4); expect(led.items.every((e) => e.note)).toBe(true);
    const net = (await db.select().from(ledgerEntries).where(eq(ledgerEntries.kind, "adjustment"))).reduce((a, e) => a + e.availableDeltaCents, 0);
    expect(net).toBe(0); // user side and platform side cancel out
  });

  it("staff cannot escalate: no self-edit, no granting what you do not hold, only admins reset passwords of others freely", async () => {
    const admin = await mkAdmin();
    const mgr = await mkStaff(["staff.manage", "staff.view", "users.view"]);
    await expect(createStaff(mgr, { name: "N", email: "n@t.test", password: "Passw0rdPassw0rd", permissions: ["settings.edit"] } as never)).rejects.toMatchObject({ code: "FORBIDDEN" });
    const ok = await createStaff(mgr, { name: "N", email: "n2@t.test", password: "Passw0rdPassw0rd", permissions: ["users.view"] } as never);
    await expect(updateStaff(mgr, mgr.id, { permissions: ["staff.manage", "payouts.execute"] })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(updateStaff(mgr, ok.id, { permissions: ["users.view", "payouts.execute"] })).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect((await updateStaff(admin, ok.id, { permissions: ["users.view", "payouts.execute"] })).permissions).toContain("payouts.execute");
    await expect(resetStaffPassword(admin, admin.id, "Passw0rdPassw0rd")).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("a temporary password blocks everything except changing it (enforced by the API); reset also unlocks", async () => {
    const admin = await mkAdmin(); const staff = await mkStaff(["requests.view"]);
    await db.update(users).set({ failedLogins: 5, lockedUntil: new Date(Date.now() + 3600_000) }).where(eq(users.id, staff.id));
    await resetStaffPassword(admin, staff.id, "Temp0rary!Pass1");
    const login = await call("POST", "/auth/staff/login", { body: { email: staff.email, password: "Temp0rary!Pass1" } });
    expect(login.status).toBe(200); expect(login.json.user.mustChangePassword).toBe(true);
    const tok = login.json.token;
    const blocked = await call("GET", "/admin/stats", { token: tok });
    expect(blocked.status).toBe(403); expect(blocked.json.error.code).toBe("PASSWORD_CHANGE_REQUIRED");
    expect((await call("GET", "/auth/me", { token: tok })).status).toBe(200);
    const ch = await call("POST", "/auth/change-password", { token: tok, body: { currentPassword: "Temp0rary!Pass1", newPassword: "Brand-New-Pass9" } });
    expect(ch.status).toBe(200);
    const login2 = await call("POST", "/auth/staff/login", { body: { email: staff.email, password: "Brand-New-Pass9" } });
    expect((await call("GET", "/admin/stats", { token: login2.json.token })).status).toBe(200);
  });

  it("clearing a suspension restarts the strike count (no instant re-suspension)", async () => {
    const { biz, admin } = await setup(); const d = await mkDriver();
    await updateSettings({ cancelSuspendAt: 2, cancelWarnAt: 1 }, admin.id);
    const reqs = [];
    for (let i = 0; i < 3; i++) reqs.push(await publishedRequest(biz, { startsAt: new Date(Date.now() + (i + 2) * 864e5) }));
    const offs = await Promise.all(reqs.map((r) => offerOf(r.id, d.id)));
    await jobs.acceptOffer(d, offs[0].id, true); await jobs.driverCancel(d, offs[0].id, "car broke down");
    await jobs.acceptOffer(d, offs[1].id, true);
    expect((await jobs.driverCancel(d, offs[1].id, "again")).strike).toBe("suspended");
    await clearSuspension(admin, d.id);
    const [p] = await db.select().from(driverProfiles).where(eq(driverProfiles.userId, d.id));
    expect(p.suspendedUntil).toBeNull(); expect(p.strikesResetAt).not.toBeNull();
    await jobs.acceptOffer(d, offs[2].id, true);
    expect((await jobs.driverCancel(d, offs[2].id, "one more")).strike).not.toBe("suspended");
  });

  it("sensitive driver data is masked for staff without drivers.sensitive", async () => {
    const d = await mkDriver(); await db.update(driverProfiles).set({ nationalId: "1098765432" }).where(eq(driverProfiles.userId, d.id));
    const plain = await mkStaff(["users.view", "drivers.view"]), sens = await mkStaff(["users.view", "drivers.view", "drivers.sensitive"]);
    const t1 = (await createSession(plain.id, "mobile")).token, t2 = (await createSession(sens.id, "mobile")).token;
    const a = await call("GET", `/admin/users/${d.id}`, { token: t1 }), b = await call("GET", `/admin/users/${d.id}`, { token: t2 });
    expect(a.json.user.phone).toContain("•"); expect(a.json.profile.nationalId).toBeUndefined(); expect(a.json.profile.iban).toBeUndefined();
    expect(b.json.user.phone).toBe(d.phone); expect(b.json.profile.nationalId).toBe("1098765432");
    const prof = await driverOpsProfile(plain, d.id);
    expect(prof.nationalId).toBeNull(); expect(prof.phone).toContain("•");
  });

  it("dashboard stats hide money from staff without finance.view; reports validate type and honour pageSize", async () => {
    const ops = await mkStaff(["requests.view", "reports.view"]); const fin = await mkStaff(["finance.view", "reports.view", "reports.export"]);
    const t1 = (await createSession(ops.id, "mobile")).token, t2 = (await createSession(fin.id, "mobile")).token;
    const s1 = (await call("GET", "/admin/stats", { token: t1 })).json, s2 = (await call("GET", "/admin/stats", { token: t2 })).json;
    expect(s1.gmvCents).toBeUndefined(); expect(s1.marginCents).toBeUndefined(); expect(s1.pendingPayoutCents).toBeUndefined();
    expect(s2.gmvCents).toBe(0); expect(s2.pendingPayoutCents).toBe(0);
    expect((await call("GET", "/admin/reports/bogus", { token: t1 })).status).toBe(404);
    const biz = await mkBusiness();
    await db.insert(requests).values(Array.from({ length: 130 }, (_, i) => ({ ref: `R-${i}`, businessId: biz.id, service: "delivery_driver", quantity: 1, pickupCity: "riyadh", deliveryCity: "riyadh", startsAt: new Date(Date.now() + 864e5), status: "draft" })));
    const one = await call("GET", "/admin/reports/requests?pageSize=1000", { token: t1 });
    expect(one.json.rows).toHaveLength(130);
    const csv = await call("GET", "/admin/reports/requests?format=csv", { token: t2 });
    expect(csv.text.trim().split("\n")).toHaveLength(131);
  });

  it("views for ratings, cancellations, city summary and invoices answer for the right permissions", async () => {
    const { biz, admin } = await setup(); const d = await mkDriver();
    const r = await publishedRequest(biz); const o = await offerOf(r.id, d.id); await completeJob(biz, d, o.id);
    await jobs.rate(biz, o.id, 2, "late");
    const t = (await createSession(admin.id, "mobile")).token;
    const rat = await call("GET", "/admin/ratings?maxStars=2", { token: t });
    expect(rat.json.total).toBe(1); expect(rat.json.items[0]).toMatchObject({ stars: 2, ref: r.ref });
    const r2 = await publishedRequest(biz, { startsAt: new Date(Date.now() + 5 * 864e5) });
    const { cancelRequest } = await import("@/server/requests");
    await cancelRequest(biz, r2.id, "changed plans");
    const canc = await listCancellations(admin, {});
    expect(canc.items.some((c) => c.party === "business" && c.ref === r2.ref)).toBe(true);
    expect((await citySummary(admin)).items.length).toBeGreaterThan(0);
    const inv = await listInvoices(admin, {});
    expect(inv.total).toBe(1); // the job was paid — and invoiced — the moment the driver finished
    expect(inv.items[0]).toMatchObject({ ref: r.ref });
    await expect(listLedger(await mkStaff(["requests.view"]), {})).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect((await call("GET", "/admin/finance/ledger?requestId=" + r.id, { token: t })).json.total).toBeGreaterThan(3);
  });

  it("complaints: staff can assign to a colleague and toggle the settlement hold", async () => {
    const { biz } = await setup(); const d = await mkDriver();
    const r = await publishedRequest(biz); const o = await offerOf(r.id, d.id); await completeJob(biz, d, o.id);
    const { fileComplaint, updateComplaint } = await import("@/server/support");
    const c = await fileComplaint(biz, { category: "damage", description: "box was crushed on arrival", offerId: o.id });
    const a = await mkStaff(["complaints.manage"]), b = await mkStaff(["complaints.manage"]);
    const u = await updateComplaint(a, c.id, { assignTo: b.id, holdsSettlement: true });
    expect(u.handlerId).toBe(b.id); expect(u.holdsSettlement).toBe(true); expect(u.status).toBe("in_progress");
    expect((await updateComplaint(a, c.id, { holdsSettlement: false })).holdsSettlement).toBe(false);
    await expect(updateComplaint(a, c.id, { assignTo: biz.id })).rejects.toMatchObject({ code: "VALIDATION" });
  });

  it("a ticket cannot be attached to someone else's request", async () => {
    const { biz } = await setup(); const other = await mkBusiness();
    const r = await publishedRequest(biz);
    const { createTicket } = await import("@/server/support");
    await expect(createTicket(other, { category: "other", subject: "hello there", requestId: r.id })).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect((await createTicket(biz, { category: "other", subject: "hello there", requestId: r.id })).requestId).toBe(r.id);
  });
});

describe("profile & registration hardening", () => {
  it("IBAN is validated and canonicalised at registration and on update; city must exist", async () => {
    const { registerUser, updateProfile, normalizeIban } = await import("@/server/accounts");
    expect(normalizeIban("sa03 8000 0000 6080 1016 7519")).toBe("SA0380000000608010167519");
    expect(normalizeIban("GB0380000000608010167519")).toBeNull();
    await expect(registerUser("0500001234", { role: "office", name: "O", companyName: "Co", termsAccepted: true, iban: "SA12" } as never)).rejects.toMatchObject({ code: "VALIDATION" });
    await expect(registerUser("0500001235", { role: "office", name: "O", companyName: "Co", termsAccepted: true, city: "atlantis" } as never)).rejects.toMatchObject({ code: "VALIDATION" });
    const d = await mkDriver();
    await updateProfile(d, { iban: "sa44 2000 0001 2345 6789 1234", vehicleType: "van", vehicleTemperature: "cold" });
    const [p] = await db.select().from(driverProfiles).where(eq(driverProfiles.userId, d.id));
    expect(p).toMatchObject({ iban: "SA4420000001234567891234", vehicleType: "van", vehicleTemperature: "cold" });
    await expect(updateProfile(d, { vehicleType: "dyna", vehicleTemperature: "frozen" })).rejects.toMatchObject({ code: "VALIDATION" });
    // availability is not editable through the profile (it has its own, guarded endpoint)
    await updateProfile(d, { availability: "unavailable" });
    expect((await db.select().from(driverProfiles).where(eq(driverProfiles.userId, d.id)))[0].availability).toBe("available");
    const { notifications } = await import("@/db/schema");
    expect((await db.select().from(notifications).where(and(eq(notifications.userId, d.id), eq(notifications.type, "iban_changed")))).length).toBeGreaterThan(0);
  });
});
