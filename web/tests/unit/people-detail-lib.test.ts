import { describe, it, expect } from "vitest";
import { OFFER_STATUS } from "@/server/catalog";
import {
  GROUP_STATUSES, JOB_GROUPS, MAX_ALL_DAYS, PARCEL_GROUPS, PERIOD_KEYS, RESPONSE_EDGES, RESPONSE_LABELS, RISK, clampPage, clipIntervals, concentration, daysUntil, driverRisks, fleetUtilisation,
  haversineM, intervalMs, mergeIntervals, onlineIntervals, parsePeriod, pareto, pathSummary, projectPath, resolvePeriod, utilisation, ageSeconds, type Interval,
} from "@/server/details-people-lib";

const at = (iso: string) => new Date(iso);
const H = 3_600_000;

describe("period model", () => {
  const now = at("2026-11-19T09:00:00Z"); // 12:00 in Riyadh, a Thursday
  it("parses only known keys", () => {
    expect(parsePeriod("90d")).toBe("90d"); expect(parsePeriod("nonsense")).toBe("30d"); expect(parsePeriod(undefined)).toBe("30d"); expect(PERIOD_KEYS).toEqual(["30d", "90d", "12m", "all"]);
  });
  it("30 d is 30 Riyadh days ending today, compared with the 30 days before, bucketed by day", () => {
    const p = resolvePeriod("30d", now);
    expect(p.cur).toMatchObject({ from: "2026-10-21", to: "2026-11-19", days: 30 }); expect(p.prev).toMatchObject({ from: "2026-09-21", to: "2026-10-20", days: 30 });
    expect(p.bucket).toBe("day"); expect(p.keys).toHaveLength(30); expect(p.prevKeys).toHaveLength(30);
    expect(p.cur.start.toISOString()).toBe("2026-10-20T21:00:00.000Z"); expect(p.cur.end.toISOString()).toBe("2026-11-19T21:00:00.000Z");
  });
  it("90 d and 12 m use weeks (Sunday first), 12 m is 12 calendar months", () => {
    const p90 = resolvePeriod("90d", now); expect(p90.bucket).toBe("week"); expect(p90.cur.days).toBe(90); expect(p90.keys.length).toBeGreaterThanOrEqual(13); expect(p90.keys.length).toBeLessThanOrEqual(14);
    const p12 = resolvePeriod("12m", now); expect(p12.cur.from).toBe("2025-12-01"); expect(p12.bucket).toBe("week"); expect(p12.prev?.from).toBe("2024-12-01");
    for (const k of p12.keys) expect(new Date(`${k}T00:00:00Z`).getUTCDay()).toBe(0);
  });
  it("all time starts on the day the account was created, has no comparison, and never exceeds the cap", () => {
    const young = resolvePeriod("all", now, at("2026-11-10T08:00:00Z")); expect(young.cur.from).toBe("2026-11-10"); expect(young.prev).toBeNull(); expect(young.prevKeys).toBeNull(); expect(young.bucket).toBe("day");
    const mid = resolvePeriod("all", now, at("2026-06-01T08:00:00Z")); expect(mid.bucket).toBe("week"); expect(resolvePeriod("all", now, at("2026-03-01T08:00:00Z")).bucket).toBe("month");
    const old = resolvePeriod("all", now, at("2015-01-01T00:00:00Z")); expect(old.cur.days).toBe(MAX_ALL_DAYS); expect(old.bucket).toBe("month"); expect(old.keys.length).toBeLessThanOrEqual(40);
    expect(resolvePeriod("all", now, at("2027-01-01")).cur.days).toBe(1); // a creation date in the future cannot make the window empty
    expect(resolvePeriod("all", now).cur.days).toBe(30);
  });
});

describe("paging", () => {
  it("clamps page and size", () => {
    expect(clampPage({})).toEqual({ page: 1, pageSize: 10, offset: 0 });
    expect(clampPage({ page: 3, pageSize: 25 })).toEqual({ page: 3, pageSize: 25, offset: 50 });
    expect(clampPage({ page: -4, pageSize: 5000 }, 10, 50)).toEqual({ page: 1, pageSize: 50, offset: 0 });
    expect(clampPage({ page: Number.NaN, pageSize: 0 }, 20)).toEqual({ page: 1, pageSize: 20, offset: 0 });
  });
});

describe("job and parcel groups", () => {
  it("every offer status belongs to exactly one filter group (nothing is lost, nothing is counted twice)", () => {
    const all = Object.values(GROUP_STATUSES).flat();
    expect(new Set(all).size).toBe(all.length);
    expect([...all].sort()).toEqual([...OFFER_STATUS].sort());
    expect(JOB_GROUPS[0]).toBe("all"); expect(JOB_GROUPS.slice(1)).toEqual(Object.keys(GROUP_STATUSES)); expect(PARCEL_GROUPS).toContain("open");
  });
});

describe("online time and utilisation", () => {
  const win = { start: at("2026-11-10T00:00:00Z"), end: at("2026-11-11T00:00:00Z") };
  it("merges and clips intervals", () => {
    expect(mergeIntervals([[5, 8], [1, 3], [2, 4], [8, 9], [10, 10]])).toEqual([[1, 4], [5, 9]]);
    expect(intervalMs(mergeIntervals([[0, 10], [5, 15]]))).toBe(15);
    expect(clipIntervals([[0, 10], [20, 30]], 5, 25)).toEqual([[5, 10], [20, 25]]);
  });
  it("is null (no data) when nothing was recorded, and handles the state carried into the window", () => {
    expect(onlineIntervals([], win)).toBeNull();
    expect(onlineIntervals([{ at: at("2026-11-12T00:00:00Z"), to: "available" }], win)).toBeNull(); // first record is after the window
    const carried = onlineIntervals([{ at: at("2026-11-01T00:00:00Z"), to: "available" }], win, at("2026-12-01T00:00:00Z"))!;
    expect(intervalMs(carried)).toBe(24 * H);
    const off = onlineIntervals([{ at: at("2026-11-01T00:00:00Z"), to: "available" }, { at: at("2026-11-05T00:00:00Z"), to: "unavailable" }], win, at("2026-12-01T00:00:00Z"))!;
    expect(off).toEqual([]);
  });
  it("sums available stretches inside the window, ignoring order and duplicates", () => {
    const ev = [{ at: at("2026-11-10T14:00:00Z"), to: "unavailable" }, { at: at("2026-11-10T06:00:00Z"), to: "available" }, { at: at("2026-11-10T07:00:00Z"), to: "available" }, { at: at("2026-11-10T20:00:00Z"), to: "available" }];
    const r = onlineIntervals(ev, win, at("2026-12-01T00:00:00Z"))!;
    expect(intervalMs(r)).toBe(8 * H + 4 * H); // 06–14 and 20–24
  });
  it("never counts the future: the window is cut at now", () => {
    const r = onlineIntervals([{ at: at("2026-11-10T06:00:00Z"), to: "available" }], win, at("2026-11-10T12:00:00Z"))!;
    expect(intervalMs(r)).toBe(6 * H);
  });
  it("utilisation = time on jobs / (online ∪ on jobs), never above 100 %, null without any time", () => {
    const online: Interval[] = [[0, 10 * H]];
    expect(utilisation(online, [[2 * H, 6 * H]])).toMatchObject({ onlineSec: 36000, busySec: 14400, ratio: 0.4 });
    expect(utilisation(online, [[8 * H, 14 * H]]).ratio).toBeCloseTo(6 / 14); // work after going offline still counts in the denominator
    expect(utilisation(online, [[1 * H, 3 * H], [2 * H, 4 * H]]).busySec).toBe(3 * 3600); // overlapping jobs are one busy stretch
    expect(utilisation([], []).ratio).toBeNull(); expect(utilisation(null, []).onlineSec).toBeNull();
    expect(utilisation([[0, H]], [[0, H]]).ratio).toBe(1);
  });
  it("fleet utilisation skips drivers without a recorded availability", () => {
    const now = at("2026-12-01T00:00:00Z");
    const events = new Map([["a", [{ at: at("2026-11-10T00:00:00Z"), to: "available" }]], ["b", []]]);
    const busy = new Map<string, Interval[]>([["a", [[at("2026-11-10T01:00:00Z").getTime(), at("2026-11-10T07:00:00Z").getTime()]]], ["b", [[0, 1e15]]]]);
    const u = fleetUtilisation(events, busy, win, now);
    expect(u).toMatchObject({ drivers: 1, onlineSec: 86400, busySec: 6 * 3600 }); expect(u.ratio).toBeCloseTo(0.25);
    expect(fleetUtilisation(new Map(), new Map(), win, now)).toMatchObject({ drivers: 0, onlineSec: null, ratio: null });
  });
});

describe("risk flags", () => {
  const now = at("2026-11-19T09:00:00Z");
  it("needs enough data before it flags anything", () => {
    expect(driverRisks({ now, acceptedJobs: 1, noShows: 1 })).toEqual([]); // one no-show is not a pattern
    expect(driverRisks({ now, acceptedJobs: 40, noShows: 2 })).toEqual([]); // 5 % is below the rate
    expect(driverRisks({ now, decidedOffers: 4, acceptedOffers: 0 })).toEqual([]); // too few offers to judge acceptance
    expect(driverRisks({ now })).toEqual([]);
  });
  it("flags a high no-show rate and low acceptance with their numbers", () => {
    const r = driverRisks({ now, acceptedJobs: 10, noShows: 3, decidedOffers: 10, acceptedOffers: 3 });
    expect(r.map((x) => x.key)).toEqual(["high_no_show", "low_acceptance"]);
    expect(r[0]).toMatchObject({ level: "danger", params: { n: 3, pct: 30 } }); expect(r[1]).toMatchObject({ level: "warn", params: { pct: 30, n: 10 } });
    expect(driverRisks({ now, decidedOffers: RISK.decidedMin, acceptedOffers: 2 })).toEqual([]); // 40 % is the limit: exactly 40 % is fine
    expect(driverRisks({ now, decidedOffers: RISK.decidedMin, acceptedOffers: 1 })[0]).toMatchObject({ key: "low_acceptance" });
  });
  it("flags expiring and expired documents (danger once one has expired), ignores rejected ones", () => {
    expect(driverRisks({ now, docs: [{ type: "national_id", expiresOn: "2027-06-01" }] })).toEqual([]);
    expect(driverRisks({ now, docs: [{ type: "national_id", expiresOn: "2026-12-10" }] })[0]).toMatchObject({ key: "expiring_docs", level: "warn", params: { n: 1, expired: 0 } });
    expect(driverRisks({ now, docs: [{ type: "driving_license", expiresOn: "2026-11-01" }, { type: "national_id", expiresOn: "2026-12-10" }] })[0]).toMatchObject({ level: "danger", params: { n: 2, expired: 1 } });
    expect(driverRisks({ now, docs: [{ type: "driving_license", expiresOn: "2026-11-01", status: "rejected" }] })).toEqual([]);
  });
  it("flags strikes at the warning level and a suspension, and cash held too long (only when visible)", () => {
    const s = { enabled: true, count: 2, warnAt: 2, suspendAt: 4 };
    expect(driverRisks({ now, strikes: s })[0]).toMatchObject({ key: "active_strikes", level: "warn", params: { n: 2, max: 4 } });
    expect(driverRisks({ now, strikes: { ...s, count: 4 } })[0].level).toBe("danger");
    expect(driverRisks({ now, strikes: { ...s, count: 0 }, suspended: true })[0]).toMatchObject({ key: "active_strikes", level: "danger" });
    expect(driverRisks({ now, strikes: { ...s, enabled: false, count: 5 } })).toEqual([]);
    expect(driverRisks({ now, cashHeldLongCents: 12_500 })[0]).toMatchObject({ key: "cash_held_long", params: { cents: 12_500, days: RISK.cashDays } });
    expect(driverRisks({ now, cashHeldLongCents: null })).toEqual([]); expect(driverRisks({ now, cashHeldLongCents: 0 })).toEqual([]);
  });
  it("flags a verified driver who never completed a job after two weeks", () => {
    expect(driverRisks({ now, verified: true, completedTotal: 0, joinedAt: "2026-11-01T00:00:00Z" })[0]).toMatchObject({ key: "never_completed", params: { days: 18 } });
    expect(driverRisks({ now, verified: true, completedTotal: 0, joinedAt: "2026-11-15T00:00:00Z" })).toEqual([]);
    expect(driverRisks({ now, verified: false, completedTotal: 0, joinedAt: "2026-01-01T00:00:00Z" })).toEqual([]);
    expect(driverRisks({ now, verified: true, completedTotal: 3, joinedAt: "2026-01-01T00:00:00Z" })).toEqual([]);
  });
  it("daysUntil reads date-only values as the start of the day", () => {
    expect(daysUntil("2026-11-20", now)).toBe(0); expect(daysUntil("2026-11-19", now)).toBe(-1); expect(daysUntil(null, now)).toBeNull(); expect(daysUntil("garbage", now)).toBeNull();
  });
});

describe("rankings", () => {
  const rows = [{ id: "a", name: "A", value: 50 }, { id: "b", name: "B", value: 30 }, { id: "c", name: "C", value: 15 }, { id: "d", name: "D", value: 5 }, { id: "e", name: "E", value: 0 }];
  it("pareto sorts, shares and accumulates; zero rows are dropped; the tail folds into others", () => {
    const p = pareto(rows, 2);
    expect(p.rows.map((r) => r.id)).toEqual(["a", "b"]); expect(p.rows[0]).toMatchObject({ share: 0.5, cumulative: 0.5 }); expect(p.rows[1].cumulative).toBeCloseTo(0.8);
    expect(p.others).toMatchObject({ count: 2, value: 20 }); expect(p.others!.share).toBeCloseTo(0.2); expect(p.total).toBe(100); expect(p.drivers).toBe(4);
    expect(pareto([], 5)).toMatchObject({ rows: [], others: null, total: 0, drivers: 0 });
    expect(pareto(rows, 10).others).toBeNull();
  });
  it("ties are ordered by name so the chart is stable", () => {
    expect(pareto([{ id: "x", name: "Zed", value: 5 }, { id: "y", name: "Amy", value: 5 }]).rows.map((r) => r.name)).toEqual(["Amy", "Zed"]);
  });
  it("concentration: how many top contributors make 80 %", () => {
    expect(concentration(rows)).toBe(2); expect(concentration(rows, 0.5)).toBe(1); expect(concentration([{ value: 0 }])).toBeNull(); expect(concentration([])).toBeNull(); expect(concentration([{ value: 3 }, { value: 3 }, { value: 3 }, { value: 1 }], 1)).toBe(4);
  });
});

describe("GPS path", () => {
  const p = (lat: number, lng: number, iso: string) => ({ lat, lng, at: iso });
  it("haversine is about 111 km per degree of latitude", () => {
    expect(haversineM({ lat: 24, lng: 46 }, { lat: 25, lng: 46 })).toBeGreaterThan(110_000); expect(haversineM({ lat: 24, lng: 46 }, { lat: 25, lng: 46 })).toBeLessThan(112_000); expect(haversineM({ lat: 1, lng: 1 }, { lat: 1, lng: 1 })).toBe(0);
  });
  it("summarises distance, time, speed and stops; a pause in sharing adds no distance; a GPS jump is ignored", () => {
    const pts = [p(24.7, 46.6, "2026-11-10T08:00:00Z"), p(24.7009, 46.6, "2026-11-10T08:01:00Z"), p(24.7009, 46.6, "2026-11-10T08:02:00Z"), p(24.71, 46.6, "2026-11-10T09:30:00Z"), p(30, 50, "2026-11-10T09:31:00Z")];
    const s = pathSummary(pts);
    expect(s.points).toBe(5); expect(s.distanceM).toBeGreaterThan(95); expect(s.distanceM).toBeLessThan(105); // only the first leg counts
    expect(s.movingS).toBe(60); expect(s.stoppedS).toBe(60); expect(s.durationS).toBe(91 * 60); expect(s.avgKmh).toBeGreaterThan(5); expect(s.maxKmh).toBeLessThan(10); expect(s.firstAt?.toISOString()).toBe("2026-11-10T08:00:00.000Z");
    expect(pathSummary([])).toMatchObject({ points: 0, distanceM: 0, durationS: 0, avgKmh: null, maxKmh: null, firstAt: null });
  });
  it("projects points into a 0–100 box with north up and no distortion", () => {
    expect(projectPath([])).toEqual([]);
    const [a, b] = projectPath([{ lat: 24, lng: 46 }, { lat: 25, lng: 46 }]);
    expect(a.y).toBeGreaterThan(b.y); expect(a.x).toBeCloseTo(b.x); // the more northern point is higher up
    const sq = projectPath([{ lat: 0, lng: 0 }, { lat: 1, lng: 1 }, { lat: 0, lng: 1 }, { lat: 1, lng: 0 }]);
    for (const q of sq) { expect(q.x).toBeGreaterThanOrEqual(0); expect(q.x).toBeLessThanOrEqual(100); expect(q.y).toBeGreaterThanOrEqual(0); expect(q.y).toBeLessThanOrEqual(100); }
    expect(projectPath([{ lat: 5, lng: 5 }])[0]).toEqual({ x: 50, y: 50 }); // a single point is centred, not NaN
  });
  it("age of a position", () => {
    expect(ageSeconds("2026-11-19T08:55:00Z", at("2026-11-19T09:00:00Z"))).toBe(300); expect(ageSeconds(null)).toBeNull(); expect(ageSeconds("2027-01-01", at("2026-11-19T09:00:00Z"))).toBe(0);
  });
});

describe("response-time buckets", () => {
  it("have one label per bucket", () => { expect(RESPONSE_LABELS).toHaveLength(RESPONSE_EDGES.length + 1); expect([...RESPONSE_EDGES]).toEqual([...RESPONSE_EDGES].sort((a, b) => a - b)); });
});
