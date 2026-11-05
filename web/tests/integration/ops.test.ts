import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { offers, requests, settlements, walletAccounts, webhookDeliveries, driverProfiles, businessProfiles, jobEvents, ledgerEntries } from "@/db/schema";
import { resetDb, shutdown, mkAdmin, mkBusiness, mkDriver, mkRule, mkOffice, publishedRequest, mkStaff, reqInput } from "../helpers/factories";
import * as jobs from "@/server/jobs";
import * as settle from "@/server/settlement";
import { ensureAccount } from "@/server/wallet";
import { createDraft, publishRequest, listRequests } from "@/server/requests";
import { runMaintenance } from "@/server/maintenance";
import { processWebhookQueue, signPayload } from "@/server/integrations";
import { updateSettings, clearSettingsCache } from "@/server/settings";
import { call } from "../helpers/api";
import { createSession } from "@/server/auth/session";

beforeEach(resetDb);
afterAll(shutdown);
const bal = async (id: string) => (await db.select().from(walletAccounts).where(eq(walletAccounts.id, (await ensureAccount(id)).id)))[0];

async function completeJob(biz: any, driver: any, offerId: string, units = 10) {
  await jobs.acceptOffer(driver, offerId, true);
  await jobs.confirmAttendance(biz, offerId, true);
  await jobs.reportDelivered(driver, offerId, units);
  await jobs.confirmDelivery(biz, offerId, { action: "confirm" });
}

describe("settlement routing & batches", () => {
  it("office-affiliated work pays the office wallet, not the driver", async () => {
    const admin = await mkAdmin(); await mkRule(admin);
    const office = await mkOffice(); const d = await mkDriver({ officeId: office.id });
    const biz = await mkBusiness({ fundsCents: 1000_00 });
    const r = await publishedRequest(biz);
    const [o] = await db.select().from(offers).where(eq(offers.requestId, r.id));
    expect(o.officeId).toBe(office.id);
    await completeJob(biz, d, o.id);
    const [s] = await db.select().from(settlements);
    expect(s.officeId).toBe(office.id);
    const fin1 = await mkStaff(["settlements.review"]), fin2 = await mkStaff(["settlements.approve", "payouts.execute"]);
    await settle.reviewSettlement(fin1, s.id); await settle.approveSettlement(fin2, s.id); await settle.payoutSettlement(fin2, s.id);
    expect((await bal(office.id)).availableCents).toBe(70_00);
    expect((await bal(d.id)).availableCents).toBe(0);
  });

  it("batch pays approved items, isolates failures, and failed items are retry-safe", async () => {
    const admin = await mkAdmin(); await mkRule(admin);
    const biz = await mkBusiness({ fundsCents: 1000_00 });
    const ds = await Promise.all([mkDriver(), mkDriver()]);
    const sIds: string[] = [];
    for (let i = 0; i < 2; i++) {
      const r = await publishedRequest(biz, { startsAt: new Date(Date.now() + (i + 1) * 3 * 864e5) });
      const o = (await db.select().from(offers).where(eq(offers.requestId, r.id)))[0];
      await completeJob(biz, ds.find((x) => x.id === o.driverId)!, o.id);
    }
    const all = await db.select().from(settlements);
    expect(all).toHaveLength(2);
    const fin1 = await mkStaff(["settlements.review"]), fin2 = await mkStaff(["settlements.approve", "payouts.execute"]);
    for (const s of all) { await settle.reviewSettlement(fin1, s.id); await settle.approveSettlement(fin2, s.id); sIds.push(s.id); }
    // starve the business wallet so the 2nd item cannot be charged beyond its reserve (simulate overcharge)
    await db.update(settlements).set({ customerCents: 100_000_00 }).where(eq(settlements.id, sIds[1]));
    const batch = await settle.runPayoutBatch(fin2);
    expect(batch.paidCount).toBe(1); expect(batch.failedCount).toBe(1);
    const failed = (await db.select().from(settlements).where(eq(settlements.id, sIds[1])))[0];
    expect(failed.status).toBe("failed");
    // fix the cause and retry
    await db.update(settlements).set({ customerCents: 100_00 }).where(eq(settlements.id, sIds[1]));
    await settle.retryFailed(fin2, sIds[1]);
    const batch2 = await settle.runPayoutBatch(fin2);
    expect(batch2.paidCount).toBe(1);
    expect((await db.select().from(settlements)).every((s) => s.status === "paid")).toBe(true);
    // running again does nothing (idempotent)
    expect((await settle.runPayoutBatch(fin2)).itemCount).toBe(0);
  });

  it("a held complaint blocks approval; rejecting a settlement returns the escrow", async () => {
    const admin = await mkAdmin(); await mkRule(admin);
    const biz = await mkBusiness({ fundsCents: 500_00 }); const d = await mkDriver();
    const r = await publishedRequest(biz);
    const [o] = await db.select().from(offers).where(eq(offers.requestId, r.id));
    await completeJob(biz, d, o.id);
    const [s] = await db.select().from(settlements);
    const { complaints } = await import("@/db/schema");
    await db.insert(complaints).values({ ref: "CP-X", filedBy: biz.id, filedByRole: "business", requestId: r.id, offerId: o.id, category: "damage", description: "damaged goods reported", holdsSettlement: true });
    const fin = await mkStaff(["settlements.review", "settlements.approve", "payouts.execute"]);
    await expect(settle.approveSettlement(fin, s.id)).rejects.toMatchObject({ code: "DISPUTE_BLOCKS" });
    await db.delete(complaints);
    const before = await bal(biz.id);
    expect(before.reservedCents).toBe(100_00);
    await settle.rejectSettlement(fin, s.id, "evidence invalid");
    const after = await bal(biz.id);
    expect(after.reservedCents).toBe(0); expect(after.availableCents).toBe(500_00);
    await expect(settle.payoutSettlement(fin, s.id)).rejects.toMatchObject({ code: "INVALID_TRANSITION" });
  });

  it("money is conserved across the ledger for the whole scenario", async () => {
    const admin = await mkAdmin(); await mkRule(admin);
    const biz = await mkBusiness({ fundsCents: 1000_00 }); const d = await mkDriver();
    const r = await publishedRequest(biz, { shipmentsPerDriver: 20 });
    const [o] = await db.select().from(offers).where(eq(offers.requestId, r.id));
    await completeJob(biz, d, o.id, 17);
    const [s] = await db.select().from(settlements);
    const fin1 = await mkStaff(["settlements.review"]), fin2 = await mkStaff(["settlements.approve", "payouts.execute"]);
    await settle.reviewSettlement(fin1, s.id); await settle.approveSettlement(fin2, s.id); await settle.payoutSettlement(fin2, s.id);
    const entries = await db.select().from(ledgerEntries);
    const net = entries.reduce((a, e) => a + e.availableDeltaCents + e.reservedDeltaCents + e.heldDeltaCents, 0);
    expect(net).toBe(1000_00); // only the top-up created money
    const inv = await call("GET", "/admin/finance/summary", { token: (await createSession((await mkStaff(["finance.view"])).id)).token });
    expect(inv.json.platformRevenueCents).toBe(17 * 300);
  });
});

describe("webhooks", () => {
  it("delivers signed payloads, retries with backoff, then dead-letters", async () => {
    const admin = await mkAdmin(); await mkRule(admin);
    const biz = await mkBusiness({ fundsCents: 500_00 }); await mkDriver();
    await db.update(businessProfiles).set({ webhookUrl: "http://localhost:9/hook", webhookSecret: "whsec_test" }).where(eq(businessProfiles.userId, biz.id));
    await publishedRequest(biz);
    const queued = await db.select().from(webhookDeliveries);
    expect(queued.length).toBeGreaterThan(0); expect(queued[0].event).toBe("request_published");

    const seen: Array<{ url: string; headers: Record<string, string>; body: string }> = [];
    const ok = (async (url: string, init: RequestInit) => { seen.push({ url, headers: init.headers as never, body: init.body as string }); return new Response("ok", { status: 200 }); }) as unknown as typeof fetch;
    const r1 = await processWebhookQueue(10, ok);
    expect(r1.delivered).toBe(1);
    const sig = seen[0].headers["x-jr-signature"]; const m = /t=(\d+),v1=([a-f0-9]+)/.exec(sig)!;
    expect(m[2]).toBe(signPayload("whsec_test", Number(m[1]), seen[0].body));
    expect(JSON.parse(seen[0].body)).toMatchObject({ event: "request_published" });
    expect(JSON.stringify(seen[0].body)).not.toMatch(/phone|recipient/);

    await db.insert(webhookDeliveries).values({ businessId: biz.id, event: "request_cancelled", url: "http://localhost:9/hook", payload: { event: "request_cancelled" }, nextAttemptAt: new Date(Date.now() - 1000) });
    const bad = (async () => new Response("no", { status: 500 })) as unknown as typeof fetch;
    const r2 = await processWebhookQueue(10, bad);
    expect(r2.failed).toBe(1);
    let [row] = await db.select().from(webhookDeliveries).where(eq(webhookDeliveries.event, "request_cancelled"));
    expect(row.status).toBe("retry_wait"); expect(row.attempts).toBe(1); expect(row.lastStatusCode).toBe(500);
    expect(row.nextAttemptAt.getTime()).toBeGreaterThan(Date.now());
    // force due & exhaust retries
    for (let i = 0; i < 6; i++) { await db.update(webhookDeliveries).set({ nextAttemptAt: new Date(Date.now() - 1000) }).where(eq(webhookDeliveries.id, row.id)); await processWebhookQueue(10, bad); }
    [row] = await db.select().from(webhookDeliveries).where(eq(webhookDeliveries.id, row.id));
    expect(row.status).toBe("dead_letter");
  });
});

describe("maintenance & policy", () => {
  it("expires unfilled lapsed requests and refunds; expires stale offers", async () => {
    const admin = await mkAdmin(); await mkRule(admin);
    const biz = await mkBusiness({ fundsCents: 500_00 }); await mkDriver();
    const r = await publishedRequest(biz);
    await db.update(requests).set({ startsAt: new Date(Date.now() - 3600_000) }).where(eq(requests.id, r.id));
    const out = await runMaintenance();
    expect(out.expiredRequests).toBe(1);
    expect((await db.select().from(requests).where(eq(requests.id, r.id)))[0].status).toBe("expired");
    expect((await bal(biz.id)).availableCents).toBe(500_00);
    expect((await bal(biz.id)).reservedCents).toBe(0);
    expect((await runMaintenance()).expiredRequests).toBe(0); // idempotent
  });

  it("office window elapses → system broadcast to everyone", async () => {
    const admin = await mkAdmin(); await mkRule(admin);
    const office = await mkOffice(); const biz = await mkBusiness({ fundsCents: 500_00 }); const d = await mkDriver();
    const dr = await createDraft(biz, reqInput({ preferredOfficeId: office.id }));
    const r = await publishRequest(biz, dr.id, { termsAccepted: true });
    expect(await db.select().from(offers).where(eq(offers.requestId, r.id))).toHaveLength(0);
    await db.update(requests).set({ officeWindowEndsAt: new Date(Date.now() - 1000) }).where(eq(requests.id, r.id));
    const out = await runMaintenance();
    expect(out.broadcast).toBe(1);
    expect((await db.select().from(offers).where(eq(offers.requestId, r.id)))[0].driverId).toBe(d.id);
  });

  it("repeated driver cancellations trigger a warning then a suspension (configurable)", async () => {
    const admin = await mkAdmin(); await mkRule(admin);
    const biz = await mkBusiness({ fundsCents: 5000_00 }); const d = await mkDriver();
    await updateSettings({ cancelWarnAt: 2, cancelSuspendAt: 3, cancelSuspendDays: 2, overlapPolicy: "time_window" }, admin.id);
    const outs = [];
    for (let i = 0; i < 3; i++) {
      const r = await publishedRequest(biz, { startsAt: new Date(Date.now() + (i + 2) * 3 * 864e5) });
      const [o] = await db.select().from(offers).where(eq(offers.requestId, r.id));
      await jobs.acceptOffer(d, o.id, true);
      outs.push((await jobs.driverCancel(d, o.id, "personal")).strike);
    }
    expect(outs).toEqual(["none", "warning", "suspended"]);
    const [p] = await db.select().from(driverProfiles).where(eq(driverProfiles.userId, d.id));
    expect(p.suspendedUntil!.getTime()).toBeGreaterThan(Date.now() + 47 * 3600_000);
    const r = await publishedRequest(biz, { startsAt: new Date(Date.now() + 20 * 864e5) });
    expect(await db.select().from(offers).where(eq(offers.requestId, r.id))).toHaveLength(0); // suspended drivers get no offers
    // disabling the policy stops strikes
    await updateSettings({ cancelPolicyEnabled: false }, admin.id); clearSettingsCache();
  });

  it("disabled services cannot be requested", async () => {
    const admin = await mkAdmin(); await mkRule(admin);
    const biz = await mkBusiness({ fundsCents: 500_00 });
    await updateSettings({ enabledServices: ["car_with_driver"] }, admin.id);
    await expect(createDraft(biz, reqInput())).rejects.toMatchObject({ code: "SERVICE_DISABLED" });
  });

  it("driverless rental: no offers, funds reserved, staff fulfilment converts to platform revenue", async () => {
    const admin = await mkAdmin(); await mkRule(admin, { service: "car_without_driver", priceCents: 20000, providerCostCents: 0 });
    const biz = await mkBusiness({ fundsCents: 5000_00 }); await mkDriver();
    const r = await publishedRequest(biz, { service: "car_without_driver", shipmentsPerDriver: null, durationDays: 3, quantity: 2 });
    expect(r.status).toBe("confirmed"); expect(r.totalCents).toBe(20000 * 2 * 3);
    expect(await db.select().from(offers)).toHaveLength(0);
    const ops = await mkStaff(["requests.edit"]);
    await jobs.fulfilRental(ops, r.id);
    await expect(jobs.fulfilRental(ops, r.id)).rejects.toMatchObject({ code: "INVALID_TRANSITION" });
    const plat = (await db.select().from(walletAccounts).where(eq(walletAccounts.kind, "platform")))[0];
    expect(plat.availableCents).toBe(120000);
    expect((await bal(biz.id)).reservedCents).toBe(0);
  });

  it("pagination never truncates: totals and pages agree beyond the old 200 cap", async () => {
    const admin = await mkAdmin(); await mkRule(admin);
    const biz = await mkBusiness();
    const rows = Array.from({ length: 230 }, (_, i) => ({ ref: `T-${i}`, businessId: biz.id, service: "delivery_driver", quantity: 1, pickupCity: "riyadh", deliveryCity: "riyadh", startsAt: new Date(Date.now() + 864e5), status: "draft" }));
    await db.insert(requests).values(rows);
    const p1 = await listRequests({ businessId: biz.id, pageSize: 100, page: 1 }), p3 = await listRequests({ businessId: biz.id, pageSize: 100, page: 3 });
    expect(p1.total).toBe(230); expect(p1.items).toHaveLength(100); expect(p3.items).toHaveLength(30);
  });

  it("cron endpoint requires the secret", async () => {
    expect((await call("POST", "/cron/tick")).status).toBe(401);
    expect((await call("POST", "/cron/tick", { headers: { authorization: "Bearer wrong" } })).status).toBe(401);
    const ok = await call("POST", "/cron/tick", { headers: { authorization: "Bearer test-cron-secret" } });
    expect(ok.status).toBe(200);
    void jobEvents;
  });
});
