import { describe, it, expect } from "vitest";
import { buildStats, type JobLike, type ShipCounts } from "@/server/driver-job-stats";
import { cardStatsOf, isFinalJob } from "@/components/features/driver-job-stats-lib";

const job = (o: Partial<JobLike> = {}): JobLike => ({ offerId: "o1", status: "attendance_confirmed", manifest: true, service: "delivery_driver", expectedUnits: 10, loadedUnits: null, deliveredUnits: null, finalUnits: null, ...o });
const ship = (o: Partial<ShipCounts> = {}): ShipCounts => ({ total: 10, pending: 0, loaded: 10, delivered: 0, failed: 0, returned: 0, missing: 0, ...o });

describe("J5 — stat cards of an order card (server maths)", () => {
  it("offered job: the numbers come from the offer — expected parcels, all still to deliver, none delivered, no cash yet", () => {
    expect(buildStats(job({ status: "offered", expectedUnits: 12 }))).toEqual({ total: 12, toDeliver: 12, delivered: 0, notDelivered: 0, failed: 0, returned: 0, estimated: true, cod: null });
  });

  it("accepted / arrived, parcels assigned but not loaded: to deliver = pending, with the cash that will be collected", () => {
    const s = buildStats(job({ status: "accepted" }), ship({ pending: 10, loaded: 0 }), { parcels: 3, toCollectCents: 45_000, collectedCents: 0, receivedCents: 0 })!;
    expect(s).toMatchObject({ total: 10, toDeliver: 10, delivered: 0, notDelivered: 0, estimated: false });
    expect(s.cod).toEqual({ parcels: 3, toCollectCents: 45_000, collectedCents: 0, handedOverCents: 0, outstandingCents: 0 });
  });

  it("working: to deliver counts pending + loaded, not delivered folds failed + returned + missing, outstanding = collected − handed over", () => {
    const s = buildStats(job(), ship({ pending: 1, loaded: 4, delivered: 3, failed: 1, returned: 1, missing: 0 }), { parcels: 5, toCollectCents: 10_000, collectedCents: 30_000, receivedCents: 12_000 })!;
    expect(s).toMatchObject({ total: 10, toDeliver: 5, delivered: 3, notDelivered: 2, failed: 1, returned: 1 });
    expect(s.cod).toEqual({ parcels: 5, toCollectCents: 10_000, collectedCents: 30_000, handedOverCents: 12_000, outstandingCents: 18_000 });
  });

  it("history: the final result, nothing left to deliver; no cash block when the job had no cash", () => {
    const s = buildStats(job({ status: "completed" }), ship({ pending: 0, loaded: 0, delivered: 8, failed: 1, returned: 1 }), { parcels: 0, toCollectCents: 0, collectedCents: 0, receivedCents: 0 })!;
    expect(s).toMatchObject({ total: 10, toDeliver: 0, delivered: 8, notDelivered: 2, estimated: false, cod: null });
  });

  it("a cancelled / rejected offer with no parcels left shows what was expected and nothing to deliver", () => {
    for (const status of ["cancelled", "rejected", "no_show", "replaced", "expired"]) {
      expect(buildStats(job({ status, expectedUnits: 7 }))).toMatchObject({ total: 7, toDeliver: 0, delivered: 0, notDelivered: 0, estimated: true });
    }
  });

  it("older count-based delivery jobs use the booked / loaded / delivered quantities; vehicle-day jobs have no stats", () => {
    expect(buildStats(job({ manifest: false, status: "attendance_confirmed", expectedUnits: 20, loadedUnits: 18 }))).toMatchObject({ total: 18, toDeliver: 18, delivered: 0, estimated: false });
    expect(buildStats(job({ manifest: false, status: "accepted", expectedUnits: 20 }))).toMatchObject({ total: 20, toDeliver: 20, estimated: true });
    expect(buildStats(job({ manifest: false, status: "completed", expectedUnits: 20, loadedUnits: 20, finalUnits: 17 }))).toMatchObject({ total: 20, toDeliver: 0, delivered: 17, notDelivered: 3, estimated: false });
    expect(buildStats(job({ manifest: false, service: "car_with_driver" }))).toBeNull();
  });

  it("never negative or fractional", () => {
    const s = buildStats(job({ manifest: false, expectedUnits: 5, loadedUnits: 5, deliveredUnits: 9 }))!;
    expect(s.delivered).toBe(5); expect(s.toDeliver).toBe(0);
  });
});

describe("J5 — stat cards of an order card (client reading)", () => {
  it("prefers job.stats and keeps cash visible; the final states are recognised", () => {
    const stats = { total: 6, toDeliver: 1, delivered: 4, notDelivered: 1, failed: 1, returned: 0, estimated: false, cod: { parcels: 2, toCollectCents: 100, collectedCents: 900, handedOverCents: 400, outstandingCents: 500 } };
    expect(cardStatsOf({ stats })).toEqual(stats);
    expect(isFinalJob({ status: "completed" })).toBe(true); expect(isFinalJob({ status: "cancelled" })).toBe(true);
    for (const s of ["offered", "accepted", "arrived", "attendance_confirmed", "pending_settlement"]) expect(isFinalJob({ status: s })).toBe(false);
  });
  it("falls back to stopsSummary / cod for an older server and shows nothing when there is nothing", () => {
    const sum = { total: 5, pending: 0, loaded: 3, delivered: 1, failed: 1, returned: 0, missing: 0 };
    expect(cardStatsOf({ stopsSummary: sum, cod: { toCollectCents: 300, collectedCents: 100, parcels: 2 } })).toMatchObject({ total: 5, toDeliver: 3, delivered: 1, notDelivered: 1, cod: { toCollectCents: 300, collectedCents: 100, handedOverCents: null } });
    expect(cardStatsOf({ stopsSummary: null })).toBeNull();
    expect(cardStatsOf({ stopsSummary: { ...sum, total: 0 } })).toBeNull();
  });
});
