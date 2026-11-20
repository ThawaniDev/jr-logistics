import { describe, it, expect } from "vitest";
import { MILESTONE_KEYS, buildAttempts, buildMilestones, closedKind, histogram, offerSteps, orderAlerts, overdueMin, percentile, punctuality, rate, resolveMilestoneTimes, secBetween, signedMin, topReasons, withElapsed } from "@/server/details-orders-lib";

const at = (m: number) => new Date(Date.UTC(2026, 10, 19, 8, m, 0)).toISOString();

describe("secBetween / rate", () => {
  it("is signed seconds and null when a side is missing", () => {
    expect(secBetween(at(0), at(2))).toBe(120);
    expect(secBetween(at(2), at(0))).toBe(-120);
    expect(secBetween(null, at(0))).toBeNull();
    expect(secBetween(at(0), undefined)).toBeNull();
    expect(secBetween("not a date", at(0))).toBeNull();
  });
  it("never reports 0 % for an empty set", () => {
    expect(rate(0, 0)).toBeNull();
    expect(rate(0, 4)).toBe(0);
    expect(rate(3, 4)).toBe(0.75);
  });
});

describe("milestones", () => {
  it("takes the request's own column first, then the offers, then the events", () => {
    const t = resolveMilestoneTimes({ row: { createdAt: at(0), firstOfferAt: at(5) }, offers: { firstOfferAt: at(1), firstAcceptedAt: at(7) }, events: { firstOfferAt: at(2), firstAcceptedAt: at(9), publishedAt: at(3) } });
    expect(t.firstOfferAt).toBe(at(5));
    expect(t.firstAcceptedAt).toBe(at(7));
    expect(t.publishedAt).toBe(at(3));
    expect(t.filledAt).toBeNull();
  });
  it("lists every milestone in order with the time since the previous one that was reached", () => {
    const t = resolveMilestoneTimes({ row: { createdAt: at(0), publishedAt: at(1), firstAcceptedAt: at(11), startedAt: at(70), closedAt: at(100) }, offers: {}, events: {} });
    const m = buildMilestones(t);
    expect(m.map((x) => x.key)).toEqual([...MILESTONE_KEYS]);
    const by = Object.fromEntries(m.map((x) => [x.key, x]));
    expect(by.created.fromPrevS).toBeNull();
    expect(by.published.fromPrevS).toBe(60);
    expect(by.first_offer.at).toBeNull();
    expect(by.first_accepted.fromPrevS).toBe(600); // skips the missing first_offer
    expect(by.started.fromPrevS).toBe(59 * 60);
    expect(by.closed.sinceCreatedS).toBe(6000);
    expect(by.filled.sinceCreatedS).toBeNull();
  });
  it("knows how an order ended", () => {
    expect(closedKind("completed")).toBe("completed");
    expect(closedKind("cancelled")).toBe("cancelled");
    expect(closedKind("expired")).toBe("expired");
    expect(closedKind("in_progress")).toBeNull();
  });
});

describe("punctuality", () => {
  it("measures arrivals against the start (negative = early) and counts late drivers past the grace period", () => {
    const p = punctuality(at(60), [at(35), at(100), at(95)], 30);
    expect(p.deltaMin).toBe(-25);
    expect(p.lastDeltaMin).toBe(40);
    expect(p.arrived).toBe(3);
    expect(p.late).toBe(2); // +35 and +40 min are beyond the 30 min grace, −25 is early
    expect(p.onTime).toBe(1);
    expect(punctuality(at(60), [at(35), at(90)], 30).late).toBe(0); // exactly at the end of the grace period is still on time
  });
  it("shows nothing for an order nobody has arrived at", () => {
    const p = punctuality(at(60), [], 30);
    expect(p.deltaMin).toBeNull();
    expect(p.firstArrivalAt).toBeNull();
    expect(p.late).toBe(0);
  });
  it("overdue minutes only start after the grace period", () => {
    expect(overdueMin(at(0), 30, at(20))).toBe(0);
    expect(overdueMin(at(0), 30, at(30))).toBe(0);
    expect(overdueMin(at(0), 30, at(75))).toBe(45);
  });
  it("signed minutes", () => {
    expect(signedMin(5)).toBe("+5");
    expect(signedMin(-12)).toBe("−12");
    expect(signedMin(0)).toBe("0");
    expect(signedMin(null)).toBe("—");
  });
});

describe("histogram and percentiles", () => {
  it("puts every value in exactly one bucket, the last one open-ended", () => {
    const h = histogram([10, 899, 900, 1799, 40000, -5, Number.NaN], [900, 1800]);
    expect(h).toEqual([{ from: 0, to: 900, count: 2 }, { from: 900, to: 1800, count: 2 }, { from: 1800, to: null, count: 1 }]);
    expect(h.reduce((s, b) => s + b.count, 0)).toBe(5);
  });
  it("percentile interpolates and is null for no data", () => {
    expect(percentile([], 50)).toBeNull();
    expect(percentile([10], 90)).toBe(10);
    expect(percentile([10, 20, 30, 40], 50)).toBe(25);
    expect(percentile([40, 10, 30, 20], 100)).toBe(40);
    expect(percentile([1, 2, 3], 0)).toBe(1);
  });
  it("keeps the biggest failure reasons and folds the rest", () => {
    const r = topReasons([{ reason: "refused", n: 1 }, { reason: null, n: 4 }, { reason: "closed", n: 2 }, { reason: "damaged", n: 2 }, { reason: "unreachable", n: 7 }], 3);
    expect(r).toEqual([{ reason: "unreachable", n: 7 }, { reason: "other", n: 4 }, { reason: "more", n: 5 }]);
    expect(topReasons([{ reason: "x", n: 0 }])).toEqual([]);
  });
});

const base = { status: "in_progress", slotsFilled: 2, quantity: 2, startsInMin: -10, manifest: true, parcels: { total: 5, noCoords: 0, unassigned: 0, incomplete: 0, failedOpen: 0 }, lateDrivers: 0, maxLateMin: 0, codOutstandingCents: 0, openSupport: 0 };
describe("orderAlerts", () => {
  it("is empty for a healthy order", () => { expect(orderAlerts(base)).toEqual([]); });
  it("flags an unfilled order that starts soon as critical within the hour, a warning before", () => {
    expect(orderAlerts({ ...base, status: "filling", slotsFilled: 0, startsInMin: 45 })[0]).toEqual({ key: "unfilled", severity: "critical", params: { n: 2, min: 45 } });
    expect(orderAlerts({ ...base, status: "filling", slotsFilled: 1, startsInMin: 200 })[0].severity).toBe("warning");
    expect(orderAlerts({ ...base, status: "filling", slotsFilled: 0, startsInMin: 900 })).toEqual([]); // far in the future: not an alert yet
  });
  it("reports late drivers, parcels without coordinates, outstanding cash and support, most severe first", () => {
    const a = orderAlerts({ ...base, lateDrivers: 1, maxLateMin: 75, parcels: { ...base.parcels, noCoords: 2, failedOpen: 1 }, codOutstandingCents: 1500, openSupport: 2 });
    expect(a.map((x) => x.key)).toEqual(["driver_late", "no_coords", "cod_outstanding", "returns_pending", "support_open"]);
    expect(a[0].severity).toBe("critical");
    expect(a.find((x) => x.key === "no_coords")?.params).toEqual({ n: 2 });
    expect(a.find((x) => x.key === "cod_outstanding")?.params).toEqual({ cents: 1500 });
  });
  it("says nothing about money or support the viewer cannot see (null) and nothing about parcels of a non-manifest order", () => {
    expect(orderAlerts({ ...base, codOutstandingCents: null, openSupport: null })).toEqual([]);
    expect(orderAlerts({ ...base, manifest: false, parcels: { ...base.parcels, noCoords: 3, unassigned: 3 } })).toEqual([]);
  });
  it("does not nag about a cancelled order", () => {
    expect(orderAlerts({ ...base, status: "cancelled", slotsFilled: 0, parcels: { ...base.parcels, noCoords: 3 } })).toEqual([]);
  });
});

describe("buildAttempts", () => {
  const ev = (type: string, m: number, payload?: Record<string, unknown>, actorName = "Nasser") => ({ type, createdAt: at(m), actorName, offerId: "o1", payload });
  it("pairs each arrival with its outcome, counting wrong codes on the visit", () => {
    const a = buildAttempts([ev("created", 0), ev("arrived", 10), ev("otp_failed", 11), ev("otp_failed", 12), ev("deferred", 14, { note: "not home" }), ev("arrived", 40), ev("delivered", 43)]);
    expect(a).toHaveLength(2);
    expect(a[0]).toMatchObject({ n: 1, outcome: "deferred", durationS: 240, otpFailures: 2, note: "not home" });
    expect(a[1]).toMatchObject({ n: 2, outcome: "delivered", durationS: 180, otpFailures: 0 });
  });
  it("keeps an outcome without a recorded arrival and an arrival still waiting for its outcome", () => {
    expect(buildAttempts([ev("failed", 5, { reason: "refused" })])).toEqual([expect.objectContaining({ n: 1, arrivedAt: null, outcome: "failed", reason: "refused", durationS: null })]);
    const open = buildAttempts([ev("arrived", 5)]);
    expect(open[0].outcome).toBeNull();
    expect(buildAttempts([ev("created", 0), ev("assigned", 1)])).toEqual([]);
  });
  it("orders by time whatever the input order", () => {
    const a = buildAttempts([ev("delivered", 9), ev("arrived", 3)]);
    expect(a).toHaveLength(1);
    expect(a[0].outcome).toBe("delivered");
  });
});

describe("withElapsed / offerSteps", () => {
  it("adds the time since the previous event, oldest first", () => {
    const l = withElapsed([{ createdAt: at(10) }, { createdAt: at(0) }, { createdAt: at(1) }]);
    expect(l.map((e) => e.fromPrevS)).toEqual([null, 60, 540]);
  });
  it("lists the reached steps of an offer with durations", () => {
    const s = offerSteps({ createdAt: at(0), acceptedAt: at(2), arrivedAt: at(30), attendanceAt: at(31), loadedAt: null, routeApprovedAt: at(40), deliveredAt: null, finalAt: null, cancelledAt: null, status: "attendance_confirmed" });
    expect(s.map((x) => x.key)).toEqual(["offered", "accepted", "arrived", "attendance", "route_approved"]);
    expect(s.map((x) => x.fromPrevS)).toEqual([null, 120, 1680, 60, 540]);
    expect(offerSteps({ createdAt: at(0), acceptedAt: at(1), arrivedAt: null, attendanceAt: null, loadedAt: null, routeApprovedAt: null, deliveredAt: null, finalAt: null, cancelledAt: at(9), status: "no_show" }).at(-1)?.key).toBe("no_show");
  });
});
