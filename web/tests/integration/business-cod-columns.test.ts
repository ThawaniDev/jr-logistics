/**
 * J6 — `/business/cash`: `GET /business/cod` and `GET /business/cod/remittances` carry, per order row and per remittance row, the pickup `warehouse` ({ label, city }) and the courier office the
 * driver belonged to AT THE TIME OF THE JOB (`offers.office_id`; null = independent). The per-driver header carries the office of his latest order. Scoped to the owner; the driver's own view is unchanged.
 */
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { codRemittances, driverProfiles, offers, officeProfiles, requests, shipments } from "@/db/schema";
import { resetDb, shutdown, mkBusiness, mkOffice } from "../helpers/factories";
import { seedFleetWorld } from "../helpers/fleet-world";
import { call } from "../helpers/api";
import { createSession } from "@/server/auth/session";
import { clearAnalyticsCache } from "@/server/analytics/guard";

beforeEach(async () => { await resetDb(); clearAnalyticsCache(); });
afterAll(shutdown);
const tok = async (u: { id: string }, client: "web" | "mobile" = "web") => (await createSession(u.id, client)).token;
const get = async (u: { id: string }, path: string, client: "web" | "mobile" = "web") => call("GET", path, { token: await tok(u, client) });

/** The fleet world (Fleet Co): D1 + D2 of office O1 with cash on two orders, D3 independent; plus an order of D3 picked up at a multi-line address in Jeddah, 1 000 handed over of 4 000. */
async function world() {
  const w = await seedFleetWorld();
  const [r6] = await db.insert(requests).values({ ref: "FL-X1", businessId: w.biz.id, service: "delivery_driver", quantity: 1, pickupCity: "jeddah", deliveryCity: "jeddah", pickupAddress: "Depot A, Olaya Street\nGate 3, phase 2", startsAt: new Date("2026-05-12T06:00:00Z"), status: "completed" }).returning();
  const [o6] = await db.insert(offers).values({ requestId: r6.id, driverId: w.d3.id, officeId: null, status: "completed", expectedUnits: 1, expectedEarningCents: 100, acceptedAt: new Date("2026-05-12T03:00:00Z"), finalAt: new Date("2026-05-12T09:00:00Z") }).returning();
  await db.insert(shipments).values({ requestId: r6.id, offerId: o6.id, seq: 900, code: "FL-X1-1", recipientName: "C", recipientPhone: "0500000000", address: "x", city: "jeddah", status: "delivered", codCents: 4000, codCollectedCents: 4000, codCollectedAt: new Date("2026-05-12T08:00:00Z"), deliveredAt: new Date("2026-05-12T08:00:00Z") });
  await db.insert(codRemittances).values({ ref: "FLR-X", requestId: r6.id, offerId: o6.id, driverId: w.d3.id, businessId: w.biz.id, amountCents: 1000, receivedBy: w.biz.id, receivedByRole: "business", createdAt: new Date("2026-05-13T08:00:00Z") });
  return { ...w, r6, o6 };
}
const orderOf = (cod: any, ref: string) => cod.drivers.flatMap((d: any) => d.orders).find((o: any) => o.ref === ref);

describe("GET /business/cod", () => {
  it("every order row has its warehouse and the office the driver belonged to at the time of the job", async () => {
    const w = await world();
    const { status, json } = await get(w.biz, "/business/cod");
    expect(status).toBe(200);
    expect(json.totals).toEqual({ collectedCents: 17000, receivedCents: 4000, outstandingCents: 13000 });
    const d1 = json.drivers.find((d: any) => d.driverId === w.d1.id);
    const o1Name = (await db.select().from(officeProfiles).where(eq(officeProfiles.userId, w.o1.id)))[0].officeName;
    const row1 = d1.orders[0];
    expect(row1).toMatchObject({ officeId: w.o1.id, officeName: o1Name, collectedCents: 5000, receivedCents: 3000, outstandingCents: 2000, parcels: 1 });
    expect(row1.warehouse).toEqual({ label: `Co ${w.biz.name}`, city: "riyadh" }); // no pickup address: the company name
    expect(d1).toMatchObject({ officeId: w.o1.id, officeName: o1Name });
    // independent driver, a multi-line pickup address: its first line, and the pickup city
    const d3 = json.drivers.find((d: any) => d.driverId === w.d3.id);
    expect(d3.orders[0]).toMatchObject({ ref: "FL-X1", officeId: null, officeName: null, warehouse: { label: "Depot A, Olaya Street", city: "jeddah" }, collectedCents: 4000, receivedCents: 1000, outstandingCents: 3000 });
    expect(d3).toMatchObject({ officeId: null, officeName: null });
    expect(typeof d3.orders[0].lastCollectedAt).toBe("string");
    expect(new Date(d3.orders[0].lastCollectedAt).toISOString()).toBe(d3.orders[0].lastCollectedAt);
  });

  it("the office is the one AT THE TIME OF THE JOB: leaving an office, joining another or renaming one changes nothing about past rows (the name follows the office)", async () => {
    const w = await world();
    const o2 = await mkOffice();
    await db.update(driverProfiles).set({ officeId: null, officeLinkStatus: "direct" }).where(eq(driverProfiles.userId, w.d1.id)); // D1 leaves O1 after the job
    await db.update(driverProfiles).set({ officeId: o2.id, officeLinkStatus: "linked" }).where(eq(driverProfiles.userId, w.d3.id)); // D3 joins O2 after his job
    await db.update(officeProfiles).set({ officeName: "Al Noor Couriers" }).where(eq(officeProfiles.userId, w.o1.id));
    const { json } = await get(w.biz, "/business/cod");
    expect(orderOf(json, orderOfRef(json, w.d1.id)).officeName).toBe("Al Noor Couriers");
    expect(json.drivers.find((d: any) => d.driverId === w.d1.id)).toMatchObject({ officeId: w.o1.id, officeName: "Al Noor Couriers" });
    expect(json.drivers.find((d: any) => d.driverId === w.d3.id).orders[0]).toMatchObject({ officeId: null, officeName: null }); // still independent for that job
  });

  it("a driver who worked for two offices shows each order's own office; the header is his latest order's", async () => {
    const w = await world();
    const o2 = await mkOffice();
    const [req] = await db.insert(requests).values({ ref: "FL-X2", businessId: w.biz.id, service: "delivery_driver", quantity: 1, pickupCity: "riyadh", deliveryCity: "riyadh", startsAt: new Date("2026-05-14T06:00:00Z"), status: "completed" }).returning();
    const [off] = await db.insert(offers).values({ requestId: req.id, driverId: w.d1.id, officeId: o2.id, status: "completed", expectedUnits: 1, expectedEarningCents: 100, acceptedAt: new Date("2026-05-14T03:00:00Z") }).returning();
    await db.insert(shipments).values({ requestId: req.id, offerId: off.id, seq: 901, code: "FL-X2-1", recipientName: "C", recipientPhone: "0500000000", address: "x", city: "riyadh", status: "delivered", codCents: 700, codCollectedCents: 700, codCollectedAt: new Date("2026-05-14T08:00:00Z") });
    const d1 = (await get(w.biz, "/business/cod")).json.drivers.find((d: any) => d.driverId === w.d1.id);
    expect(d1.orders.map((o: any) => o.officeId).sort()).toEqual([w.o1.id, o2.id].sort());
    expect(d1.officeId).toBe(o2.id); // the 14th is newer than the 10th
    expect(d1.outstandingCents).toBe(2700);
  });

  it("is scoped to the owner: another company sees nothing", async () => {
    const w = await world();
    const other = await mkBusiness({ name: "Other" });
    expect((await get(other, "/business/cod")).json).toEqual({ totals: { collectedCents: 0, receivedCents: 0, outstandingCents: 0 }, drivers: [] });
    expect((await get(w.d1, "/business/cod")).status).toBe(403);
  });
});

/** The ref of the first order of a driver in a `/business/cod` answer. */
function orderOfRef(cod: any, driverId: string): string { return cod.drivers.find((d: any) => d.driverId === driverId).orders[0].ref; }

describe("GET /business/cod/remittances", () => {
  it("every hand-over carries the warehouse of its order and the office at the time of the job", async () => {
    const w = await world();
    const { status, json } = await get(w.biz, "/business/cod/remittances");
    expect(status).toBe(200);
    expect(json.total).toBe(2);
    const o1Name = (await db.select().from(officeProfiles).where(eq(officeProfiles.userId, w.o1.id)))[0].officeName;
    const byRef = (ref: string) => json.items.find((i: any) => i.ref === ref);
    expect(byRef("FLR-1")).toMatchObject({ amountCents: 3000, driverId: w.d1.id, officeId: w.o1.id, officeName: o1Name, warehouse: { label: `Co ${w.biz.name}`, city: "riyadh" } });
    expect(byRef("FLR-X")).toMatchObject({ amountCents: 1000, driverId: w.d3.id, officeId: null, officeName: null, warehouse: { label: "Depot A, Olaya Street", city: "jeddah" } });
    expect(json.items[0].ref).toBe("FLR-X"); // newest first
    const other = await mkBusiness({ name: "Other" });
    expect((await get(other, "/business/cod/remittances")).json.total).toBe(0);
  });
});

describe("other readers", () => {
  it("staff ops (GET /admin/cod) see the same columns; the driver's own cash view keeps its shape", async () => {
    const w = await world();
    const adminCod = (await get(w.admin, `/admin/cod?driverId=${w.d1.id}`)).json;
    expect(adminCod.items[0]).toMatchObject({ officeId: w.o1.id, warehouse: { city: "riyadh" } });
    const mine = (await get(w.d3, "/driver/cash", "mobile")).json;
    expect(mine.orders[0]).toMatchObject({ ref: "FL-X1", collectedCents: 4000, outstandingCents: 3000 });
    expect(Object.keys(mine.orders[0])).not.toContain("warehouse"); // the mobile model is unchanged
    expect(Object.keys(mine.orders[0])).not.toContain("officeId");
  });
});
