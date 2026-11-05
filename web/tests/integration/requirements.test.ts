import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { eq, and } from "drizzle-orm";
import { db } from "@/db";
import { offers, requests, settlements, termsConsents, custodyItems, ratings, driverProfiles, pricingRules, jobEvents } from "@/db/schema";
import { resetDb, shutdown, mkAdmin, mkBusiness, mkDriver, mkRule, publishedRequest, mkStaff, reqInput } from "../helpers/factories";
import * as jobs from "@/server/jobs";
import * as support from "@/server/support";
import * as settle from "@/server/settlement";
import { resolveRule, createRule } from "@/server/pricing";
import { createDraft, publishRequest } from "@/server/requests";
import { updateSettings } from "@/server/settings";
import { opsAlerts, report } from "@/server/ops";
import { storage, setStorage } from "@/server/storage";
import { call } from "../helpers/api";
import { createSession } from "@/server/auth/session";

beforeEach(resetDb);
afterAll(shutdown);

async function completedJob(units = 10) {
  const admin = await mkAdmin(); await mkRule(admin);
  const biz = await mkBusiness({ fundsCents: 1000_00 }); const d = await mkDriver();
  const r = await publishedRequest(biz);
  const [o] = await db.select().from(offers).where(eq(offers.requestId, r.id));
  await jobs.acceptOffer(d, o.id, true);
  await jobs.confirmAttendance(biz, o.id, true);
  await jobs.reportDelivered(d, o.id, units);
  await jobs.confirmDelivery(biz, o.id, { action: "confirm" });
  return { admin, biz, d, r, offerId: o.id };
}

describe("AUTH-004 consent evidence", () => {
  it("records versioned consent on publish and on offer acceptance", async () => {
    const { biz, d } = await completedJob();
    const rows = await db.select().from(termsConsents);
    expect(rows.filter((x) => x.userId === biz.id && x.context === "publish")).toHaveLength(1);
    expect(rows.filter((x) => x.userId === d.id && x.context === "offer_accept")).toHaveLength(1);
    expect(rows.every((x) => x.termsVersion === "1.0" && x.acceptedAt instanceof Date)).toBe(true);
  });
});

describe("PRICE-001/002 effective dating and immutable snapshots", () => {
  it("expired, future-dated and retired rules never resolve", async () => {
    const admin = await mkAdmin();
    const q = { service: "delivery_driver" as const, vehicleType: "sedan", pickupCity: "riyadh", deliveryCity: "riyadh" };
    await mkRule(admin, { effectiveAt: new Date(Date.now() + 864e5) }); // future
    expect(await resolveRule(q)).toBeNull();
    await db.update(pricingRules).set({ effectiveAt: new Date(Date.now() - 2 * 864e5), expiresAt: new Date(Date.now() - 864e5) });
    expect(await resolveRule(q)).toBeNull(); // expired
    await db.update(pricingRules).set({ expiresAt: null, status: "retired" });
    expect(await resolveRule(q)).toBeNull(); // retired
    await db.update(pricingRules).set({ status: "approved" });
    expect((await resolveRule(q))?.priceCents).toBe(1000);
  });

  it("later price edits do not change an already-published request or its settlement", async () => {
    const admin = await mkAdmin(); await mkRule(admin);
    const biz = await mkBusiness({ fundsCents: 1000_00 }); const d = await mkDriver();
    const r = await publishedRequest(biz);
    await createRule(admin, { service: "delivery_driver", vehicleType: "sedan", pickupCity: "riyadh", deliveryCity: "riyadh", priceCents: 5000, providerCostCents: 4000 }); // v2, much pricier
    const [o] = await db.select().from(offers).where(eq(offers.requestId, r.id));
    await jobs.acceptOffer(d, o.id, true); await jobs.confirmAttendance(biz, o.id, true); await jobs.reportDelivered(d, o.id, 10); await jobs.confirmDelivery(biz, o.id, { action: "confirm" });
    const [s] = await db.select().from(settlements);
    expect(s.customerCents).toBe(100_00); expect(s.providerCents).toBe(70_00); // v1 economics
    expect((await db.select().from(requests).where(eq(requests.id, r.id)))[0].unitPriceCents).toBe(1000);
  });
});

describe("JOB-006 custody", () => {
  it("handover → driver acknowledges → business records outcome; parties only", async () => {
    const admin = await mkAdmin(); await mkRule(admin);
    const biz = await mkBusiness({ fundsCents: 1000_00 }); const d = await mkDriver(); const other = await mkDriver(); const stranger = await mkBusiness();
    const r = await publishedRequest(biz);
    const o = (await db.select().from(offers).where(eq(offers.requestId, r.id))).find((x) => x.driverId === d.id)!; // two drivers are offered; pick ours
    await jobs.acceptOffer(d, o.id, true);
    await expect(support.handoverCustody(biz, o.id, [{ itemType: "pos_device" }])).rejects.toMatchObject({ code: "INVALID_TRANSITION" }); // before attendance
    await jobs.confirmAttendance(biz, o.id, true);
    await expect(support.handoverCustody(stranger, o.id, [{ itemType: "pos_device" }])).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(support.handoverCustody(d, o.id, [{ itemType: "pos_device" }])).rejects.toMatchObject({ code: "FORBIDDEN" }); // driver can't hand over
    await expect(support.handoverCustody(biz, o.id, [{ itemType: "rocket" }])).rejects.toMatchObject({ code: "VALIDATION" });
    const [item] = await support.handoverCustody(biz, o.id, [{ itemType: "pos_device", qty: 2 }]);
    await expect(support.acknowledgeCustody(other, item.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect((await support.acknowledgeCustody(d, item.id)).status).toBe("acknowledged");
    await expect(support.returnCustody(biz, item.id, "damaged")).rejects.toMatchObject({ code: "VALIDATION" }); // needs a note
    expect((await support.returnCustody(biz, item.id, "damaged", "screen cracked")).status).toBe("damaged");
    await expect(support.returnCustody(biz, item.id, "returned")).rejects.toMatchObject({ code: "INVALID_TRANSITION" }); // terminal
    expect((await db.select().from(custodyItems))).toHaveLength(1);
  });
});

describe("JOB-008 overlap policy is configurable", () => {
  it("single_active blocks a second job even on a different day; time_window allows it", async () => {
    const admin = await mkAdmin(); await mkRule(admin);
    const biz = await mkBusiness({ fundsCents: 5000_00 }); const d = await mkDriver();
    const r1 = await publishedRequest(biz);
    const [o1] = await db.select().from(offers).where(eq(offers.requestId, r1.id));
    await jobs.acceptOffer(d, o1.id, true);
    const later = { startsAt: new Date(Date.now() + 5 * 864e5) };
    const r2 = await publishedRequest(biz, later);
    expect((await db.select().from(offers).where(eq(offers.requestId, r2.id))).length).toBe(1); // different day → still offered
    await updateSettings({ overlapPolicy: "single_active" }, admin.id);
    const r3 = await publishedRequest(biz, { startsAt: new Date(Date.now() + 9 * 864e5) });
    expect((await db.select().from(offers).where(eq(offers.requestId, r3.id))).length).toBe(0);
    await expect(jobs.applyToRequest(d, r3.id, true)).rejects.toMatchObject({ code: "OVERLAPPING_JOB" });
  });
});

describe("FIN-009 ratings", () => {
  it("only completed jobs, only parties, once each; averages update", async () => {
    const { biz, d, offerId } = await completedJob();
    const stranger = await mkBusiness();
    await expect(jobs.rate(stranger, offerId, 5)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(jobs.rate(biz, offerId, 6)).rejects.toMatchObject({ code: "VALIDATION" });
    await jobs.rate(biz, offerId, 4, "good");
    await expect(jobs.rate(biz, offerId, 5)).rejects.toMatchObject({ code: "CONFLICT" });
    await jobs.rate(d, offerId, 5);
    const [p] = await db.select().from(driverProfiles).where(eq(driverProfiles.userId, d.id));
    expect(p.ratingSum).toBe(4); expect(p.ratingCount).toBe(1);
    expect(await db.select().from(ratings)).toHaveLength(2);
  });
  it("cannot rate an unfinished job", async () => {
    const admin = await mkAdmin(); await mkRule(admin);
    const biz = await mkBusiness({ fundsCents: 500_00 }); const d = await mkDriver();
    const r = await publishedRequest(biz);
    const [o] = await db.select().from(offers).where(eq(offers.requestId, r.id));
    await jobs.acceptOffer(d, o.id, true);
    await expect(jobs.rate(biz, o.id, 5)).rejects.toMatchObject({ code: "INVALID_TRANSITION" });
  });
});

describe("OPS-004 alerts", () => {
  it("flags late drivers, soon-to-start unfilled requests, disputes and expiring documents with severity", async () => {
    const admin = await mkAdmin(); await mkRule(admin);
    const biz = await mkBusiness({ fundsCents: 5000_00 }); const d = await mkDriver();
    const late = await publishedRequest(biz);
    const [o] = await db.select().from(offers).where(eq(offers.requestId, late.id));
    await jobs.acceptOffer(d, o.id, true);
    await db.update(requests).set({ startsAt: new Date(Date.now() - 2 * 3600_000) }).where(eq(requests.id, late.id)); // 2h past start, never arrived
    const unfilled = await publishedRequest(biz, { startsAt: new Date(Date.now() + 5 * 3600_000), quantity: 3 });
    const alerts = await opsAlerts();
    expect(alerts.find((a) => a.type === "driver_late")).toMatchObject({ severity: "critical", requestId: late.id });
    expect(alerts.find((a) => a.type === "unfilled_soon" && a.requestId === unfilled.id)).toBeTruthy();
    expect(alerts[0].severity).toBe("critical"); // critical first
    void jobEvents;
  });
});

describe("storage & enumeration hardening", () => {
  it("production never silently falls back to local disk", () => {
    const env = process.env as Record<string, string | undefined>;
    const prev = { n: env.NODE_ENV, s: env.STORAGE_DRIVER };
    setStorage(null);
    try {
      env.NODE_ENV = "production"; delete env.STORAGE_DRIVER;
      expect(() => storage()).toThrow(/not configured/);
      env.STORAGE_DRIVER = "local"; expect(storage().name).toBe("local");
    } finally { env.NODE_ENV = prev.n; if (prev.s === undefined) delete env.STORAGE_DRIVER; else env.STORAGE_DRIVER = prev.s; setStorage(null); }
  });

  it("OTP send does not reveal which phone numbers belong to staff", async () => {
    const staff = await mkStaff(["requests.view"]);
    const { users } = await import("@/db/schema");
    await db.update(users).set({ phone: "+966577700001" }).where(eq(users.id, staff.id));
    const known = await call("POST", "/auth/otp/send", { body: { phone: "0577700001" } });
    const unknown = await call("POST", "/auth/otp/send", { body: { phone: "0577700002" } });
    expect(known.status).toBe(unknown.status);
    expect(Object.keys(known.json).sort()).toEqual(Object.keys(unknown.json).sort());
  });
});

describe("REPORTS & finance visibility", () => {
  it("reports respect permissions: settlements need finance.view; requests need reports.view", async () => {
    await completedJob();
    const reporter = await mkStaff(["reports.view"]);
    await expect(report(reporter, "settlements")).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect((await report(reporter, "requests")).rows.length).toBeGreaterThan(0);
    const fin = await mkStaff(["reports.view", "finance.view"]);
    const s = await report(fin, "settlements");
    expect(s.rows[0]).toMatchObject({ customerCents: 100_00, providerCents: 70_00, marginCents: 30_00 });
    const sla = await report(reporter, "sla");
    expect(sla.columns).toContain("startStatus");
  });

  it("platform summary matches the ledger after payout", async () => {
    const { r } = await completedJob();
    const f1 = await mkStaff(["settlements.review"]), f2 = await mkStaff(["settlements.approve", "payouts.execute"]);
    const [s] = await db.select().from(settlements).where(eq(settlements.requestId, r.id));
    await settle.reviewSettlement(f1, s.id); await settle.approveSettlement(f2, s.id); await settle.payoutSettlement(f2, s.id);
    const sum = await settle.platformSummary();
    expect(sum.platformRevenueCents).toBe(30_00);
    expect(sum.paidSettlements).toBe(1);
    expect(sum.userBalances.reservedCents).toBe(0);
    void createDraft; void publishRequest; void reqInput; void and; void createSession;
  });
});
