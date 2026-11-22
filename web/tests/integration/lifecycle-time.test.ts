/**
 * A3 audit — Riyadh vs UTC. Saudi Arabia is UTC+3 all year: between 21:00 and 24:00 UTC it is already the NEXT calendar day in Riyadh.
 * Every place that names a "day" (today's jobs, delivered today, a document that expires ON a date) must follow the Riyadh calendar.
 * Only `Date` is faked (the database keeps its own clock), so each test sets rows relative to the faked "now".
 */
import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { documents, driverProfiles, requests, shipments, offers } from "@/db/schema";
import { shutdown, resetDb, mkAdmin, mkBusiness, mkDriver, mkRule, publishedRequest, mkShipments } from "../helpers/factories";
import { recomputeDriverVerification } from "@/server/accounts";
import { opsToday, opsAlerts, businessOverview } from "@/server/ops";
import { runMaintenance } from "@/server/maintenance";
import { riyadhDay } from "@/server/analytics/time";

afterAll(shutdown);
beforeEach(resetDb);
afterEach(() => vi.useRealTimers());

const at = (iso: string) => { vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date(iso)); };

/** A driver with the three required documents approved; the licence expires ON `expiresOn`. */
async function driverWithDocs(expiresOn: string) {
  const d = await mkDriver();
  const base = { ownerId: d.id, ownerKind: "driver", storageKey: "k", fileName: "f.png", mime: "image/png", size: 10, status: "approved" } as const;
  await db.insert(documents).values([{ ...base, type: "national_id" }, { ...base, type: "vehicle_registration" }, { ...base, type: "driving_license", expiresOn }]);
  return d;
}

describe("a document that expires ON a date", () => {
  it("is still valid at 23:59 Riyadh on that date and expired from 00:00 Riyadh the next day (21:00 UTC)", async () => {
    const d = await driverWithDocs("2026-11-20");
    at("2026-11-20T20:59:00Z"); // 23:59 Riyadh, Nov 20
    expect(await recomputeDriverVerification(d.id)).toBe("verified");
    at("2026-11-20T21:00:00Z"); // 00:00 Riyadh, Nov 21
    expect(await recomputeDriverVerification(d.id)).toBe("expired");
    at("2026-11-20T23:30:00Z"); // 02:30 Riyadh — must not still be "valid" because UTC is still on the 20th
    expect(await recomputeDriverVerification(d.id)).toBe("expired");
  });

  it("the maintenance tick expires the driver at the same moment (no 3-hour window where the tick and the recompute disagree)", async () => {
    const d = await driverWithDocs("2026-11-20");
    await db.update(driverProfiles).set({ verificationStatus: "verified" }).where(eq(driverProfiles.userId, d.id));
    at("2026-11-20T22:30:00Z"); // 01:30 Riyadh on the 21st
    const out = await runMaintenance();
    expect(out.driversRecomputed).toBe(1);
    const [p] = await db.select().from(driverProfiles).where(eq(driverProfiles.userId, d.id));
    expect(p.verificationStatus).toBe("expired");
  });

  it("the ops alert for it is critical (expired) from Riyadh midnight, info before", async () => {
    await driverWithDocs("2026-11-20");
    at("2026-11-20T20:00:00Z");
    expect((await opsAlerts()).find((a) => a.type === "doc_expiring")?.severity).toBe("info");
    at("2026-11-20T22:00:00Z");
    expect((await opsAlerts()).find((a) => a.type === "doc_expiring")?.severity).toBe("critical");
  });
});

describe("'today' on the dashboards is the Riyadh day", () => {
  async function jobAt(startsAt: Date) {
    const admin = await mkAdmin(); await mkRule(admin);
    const biz = await mkBusiness({ fundsCents: 5000_00 }); await mkDriver();
    const r = await publishedRequest(biz, { shipments: mkShipments(2), shipmentsPerDriver: 2 });
    await db.update(requests).set({ startsAt }).where(eq(requests.id, r.id));
    return { biz, r };
  }

  it("ops today: a job at 01:00 Riyadh belongs to the new day, a job at 23:00 Riyadh to the old one", async () => {
    await jobAt(new Date("2026-11-20T22:00:00Z")); // 01:00 Nov 21 Riyadh
    at("2026-11-20T22:30:00Z"); // 01:30 Nov 21 Riyadh
    expect((await opsToday()).scheduled).toBe(1);
    at("2026-11-21T20:59:00Z"); // 23:59 Nov 21 Riyadh — the job at 01:00 is still "today"
    expect((await opsToday()).scheduled).toBe(1);
    at("2026-11-21T21:00:00Z"); // Nov 22 Riyadh — gone
    expect((await opsToday()).scheduled).toBe(0);
  });

  it("business overview: 'delivered today' counts parcels since 00:00 Riyadh, not since 00:00 UTC", async () => {
    const { biz, r } = await jobAt(new Date(Date.now() + 864e5));
    const ps = await db.select().from(shipments).where(eq(shipments.requestId, r.id));
    // one parcel delivered 22:00 UTC the 20th (01:00 Riyadh, the 21st), one at 20:00 UTC the 20th (23:00 Riyadh, the 20th)
    await db.update(shipments).set({ status: "delivered", deliveredAt: new Date("2026-11-20T22:00:00Z") }).where(eq(shipments.id, ps[0].id));
    await db.update(shipments).set({ status: "delivered", deliveredAt: new Date("2026-11-20T20:00:00Z") }).where(eq(shipments.id, ps[1].id));
    at("2026-11-20T22:30:00Z");
    expect((await businessOverview(biz)).parcels.deliveredToday).toBe(1);
  });
});

describe("the Riyadh day helper agrees with the platform's other day logic", () => {
  it("riyadhDay flips at 21:00 UTC", () => {
    expect(riyadhDay(new Date("2026-11-20T20:59:59Z"))).toBe("2026-11-20");
    expect(riyadhDay(new Date("2026-11-20T21:00:00Z"))).toBe("2026-11-21");
    expect(riyadhDay(new Date("2026-12-31T21:00:00Z"))).toBe("2027-01-01");
  });
});

describe("uploading a document that expires today", () => {
  const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(32)]);
  it("is accepted through 23:59 Riyadh on that date and refused from 00:00 Riyadh (21:00 UTC)", async () => {
    const { submitDocument } = await import("@/server/accounts");
    const d = await mkDriver();
    at("2026-11-20T20:59:00Z");
    await expect(submitDocument(d, { type: "national_id", fileName: "id.png", mime: "image/png", data: png, expiresOn: "2026-11-20" })).resolves.toBeTruthy();
    at("2026-11-20T21:00:00Z");
    await expect(submitDocument(d, { type: "national_id", fileName: "id.png", mime: "image/png", data: png, expiresOn: "2026-11-20" })).rejects.toMatchObject({ code: "VALIDATION" });
  });
});

describe("the cron tick keeps going when one step fails", () => {
  it("a failing step is reported as { error } and the maintenance still runs", async () => {
    const { call } = await import("../helpers/api");
    const integrations = await import("@/server/integrations");
    const spy = vi.spyOn(integrations, "processWebhookQueue").mockRejectedValue(new Error("queue exploded"));
    try {
      const res = await call("POST", "/cron/tick", { headers: { authorization: "Bearer test-cron-secret" } });
      expect(res.status).toBe(200);
      expect(res.json.webhooks).toEqual({ error: "webhooks" });
      expect(res.json.maintenance).toHaveProperty("expiredRequests");
    } finally { spy.mockRestore(); }
  });
});

void offers;
