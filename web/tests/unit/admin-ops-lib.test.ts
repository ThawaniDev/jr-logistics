import { describe, expect, it } from "vitest";
import {
  addDays, alertCounts, cancellationKpis, cancellationParty, isFollowOn, stripUnit, eventTone, alertsOfType, alertTarget, cleanReportType, cleanStatus, driverStats, filterDrivers, filterParty, isDay, matchPeriod, pageRange, partyCounts,
  periodRange, plotPosition, reportColumnAlign, reportTypesFor, riyadhDay, statusSegments, sumCounts, LIVE_REQUEST_STATUSES,
} from "@/components/features/admin-ops-lib";

// 2026-11-19 22:30 UTC is already the 20th in Riyadh (UTC+3).
const NOW = new Date("2026-11-19T22:30:00Z");

describe("periods (Riyadh calendar days)", () => {
  it("riyadhDay uses the Riyadh calendar, not UTC", () => {
    expect(riyadhDay(NOW)).toBe("2026-11-20");
    expect(riyadhDay(new Date("2026-11-19T20:59:00Z"))).toBe("2026-11-19");
  });
  it("addDays crosses month and year ends", () => {
    expect(addDays("2026-01-01", -1)).toBe("2025-12-31");
    expect(addDays("2026-02-27", 3)).toBe("2026-03-02");
  });
  it("isDay rejects malformed and impossible dates", () => {
    expect(isDay("2026-11-19")).toBe(true);
    for (const bad of ["", null, undefined, "2026-13-01", "19-11-2026", "2026-1-1"]) expect(isDay(bad as string)).toBe(false);
  });
  it("presets resolve to inclusive day ranges", () => {
    expect(periodRange("", NOW)).toEqual({ from: "", to: "" });
    expect(periodRange("today", NOW)).toEqual({ from: "2026-11-20", to: "2026-11-20" });
    expect(periodRange("7d", NOW)).toEqual({ from: "2026-11-14", to: "2026-11-20" });
    expect(periodRange("30d", NOW)).toEqual({ from: "2026-10-22", to: "2026-11-20" });
    expect(periodRange("month", NOW)).toEqual({ from: "2026-11-01", to: "2026-11-20" });
  });
  it("matchPeriod lights the preset a range equals, else custom, else none", () => {
    expect(matchPeriod("", "", NOW)).toBe("");
    expect(matchPeriod("2026-11-14", "2026-11-20", NOW)).toBe("7d");
    expect(matchPeriod("2026-11-20", "2026-11-20", NOW)).toBe("today");
    expect(matchPeriod("2026-11-01", "2026-11-20", NOW)).toBe("month");
    expect(matchPeriod("2026-11-02", "2026-11-20", NOW)).toBe("custom");
    expect(matchPeriod("2026-11-02", "", NOW)).toBe("custom");
  });
});

describe("request statuses", () => {
  const counts = { published: 3, filling: 1, completed: 5, cancelled: 1, draft: 2, weird: 1, expired: 0 };
  it("sums chosen statuses and tolerates missing ones", () => {
    expect(sumCounts(counts, LIVE_REQUEST_STATUSES)).toBe(4);
    expect(sumCounts(undefined, LIVE_REQUEST_STATUSES)).toBe(0);
  });
  it("breaks down non-empty statuses in canonical order with shares of the total", () => {
    const s = statusSegments(counts);
    expect(s.map((x) => x.status)).toEqual(["published", "filling", "completed", "cancelled", "draft", "weird"]);
    expect(s.reduce((a, x) => a + x.n, 0)).toBe(13);
    expect(s[0]).toEqual({ status: "published", n: 3, pct: 23.1 });
    expect(statusSegments({})).toEqual([]);
    expect(statusSegments(null)).toEqual([]);
  });
  it("cleanStatus keeps only filterable statuses", () => {
    expect(cleanStatus("in_progress")).toBe("in_progress");
    expect(cleanStatus("draft")).toBe("");
    expect(cleanStatus("nope")).toBe("");
    expect(cleanStatus(null)).toBe("");
  });
});

describe("operations alerts", () => {
  const items = [
    { type: "driver_late", severity: "critical", requestId: "r1" },
    { type: "unfilled_soon", severity: "warning", requestId: "r2" },
    { type: "unfilled_soon", severity: "critical", requestId: "r3" },
    { type: "doc_expiring", severity: "info" },
    { type: "settlement_pending", severity: "info" },
    { type: "mystery", severity: "info" },
  ];
  it("counts by severity and by type", () => {
    expect(alertCounts(items)).toEqual({ critical: 2, warning: 1, info: 3 });
    expect(alertCounts(undefined)).toEqual({ critical: 0, warning: 0, info: 0 });
    expect(alertsOfType(items, "unfilled_soon")).toBe(2);
  });
  it("points every alert at the page that handles it", () => {
    expect(alertTarget(items[0])).toBe("request");
    expect(alertTarget(items[3])).toBe("verification");
    expect(alertTarget(items[4])).toBe("settlements");
    expect(alertTarget(items[5])).toBeNull();
  });
});

describe("live map", () => {
  const drivers = [
    { id: "1", name: "Ali Hassan", status: "available", city: "riyadh" },
    { id: "2", name: "Sara Noor", status: "on_job", city: "jeddah" },
    { id: "3", name: "Omar", status: "available", city: null },
  ];
  it("plots inside the box and clamps strays", () => {
    expect(plotPosition(24.5, 45)).toEqual({ left: 50, top: expect.closeTo(50, 5) });
    expect(plotPosition(0, 0)).toEqual({ left: 0, top: 100 });
    expect(plotPosition(80, 120)).toEqual({ left: 100, top: 0 });
  });
  it("summarises and filters drivers", () => {
    expect(driverStats(drivers)).toEqual({ total: 3, available: 2, onJob: 1, cities: 2 });
    expect(driverStats(null)).toEqual({ total: 0, available: 0, onJob: 0, cities: 0 });
    expect(filterDrivers(drivers, { status: "available" }).map((d) => d.id)).toEqual(["1", "3"]);
    expect(filterDrivers(drivers, { city: "jeddah" }).map((d) => d.id)).toEqual(["2"]);
    expect(filterDrivers(drivers, { q: " ALI " }).map((d) => d.id)).toEqual(["1"]);
    expect(filterDrivers(drivers, {}).length).toBe(3);
  });
});

describe("cancellations", () => {
  const items = [{ party: "business" }, { party: "driver" }, { party: "driver" }, { party: "ops" }, { party: "other" }];
  it("counts and filters by party", () => {
    expect(partyCounts(items)).toEqual({ business: 1, driver: 2, ops: 1 });
    expect(filterParty(items, "driver")).toHaveLength(2);
    expect(filterParty(items, "")).toHaveLength(5);
  });
});

describe("cancellation attribution", () => {
  const rows = [
    { party: "business", kind: "request_cancelled", reason: null },
    { party: "driver", kind: "cancelled", reason: "request_cancelled" }, // offer withdrawn with the request
    { party: "driver", kind: "cancelled", reason: "not_fully_staffed" }, // offer withdrawn by the platform
    { party: "driver", kind: "cancelled", reason: "Car broke down" },
    { party: "driver", kind: "no_show", reason: "Did not come" },
    { party: "ops", kind: "replaced", reason: "Complaint" },
    { party: "driver", kind: "cancelled", reason: "constructor" }, // never a prototype hit
  ];
  it("sends follow-on offers to whoever decided, keeps everything else", () => {
    expect(rows.map(isFollowOn)).toEqual([false, true, true, false, false, false, false]);
    expect(rows.map(cancellationParty)).toEqual(["business", "business", "ops", "driver", "driver", "ops", "driver"]);
  });
  it("KPIs count real events only", () => {
    expect(cancellationKpis(rows)).toEqual({ requests: 1, drivers: 3, replaced: 1 });
    expect(cancellationKpis(undefined)).toEqual({ requests: 0, drivers: 0, replaced: 0 });
  });
});

describe("reports", () => {
  it("strips a trailing unit from a money column header", () => {
    expect(stripUnit("Total (halalas)")).toBe("Total");
    expect(stripUnit("الإجمالي (هللة)")).toBe("الإجمالي");
    expect(stripUnit("Reference")).toBe("Reference");
  });
  it("hides finance reports from viewers without finance.view", () => {
    expect(reportTypesFor(true)).toContain("settlements");
    expect(reportTypesFor(false)).not.toContain("settlements");
    expect(reportTypesFor(false)).not.toContain("withdrawals");
    expect(reportTypesFor(false)).toContain("requests");
  });
  it("falls back to the first allowed type for an unknown or forbidden one from the URL", () => {
    const allowed = reportTypesFor(false);
    expect(cleanReportType("settlements", allowed)).toBe("requests");
    expect(cleanReportType("sla", allowed)).toBe("sla");
    expect(cleanReportType(null, allowed)).toBe("requests");
  });
  it("right-aligns columns that hold only numbers", () => {
    const rows = [{ qty: 2, ref: "JR-1", startsAt: "2026-11-19T10:00:00Z", note: null }, { qty: 0, ref: "JR-2", startsAt: "2026-11-20T10:00:00Z", note: 3 }];
    expect(reportColumnAlign("qty", rows)).toBe("end");
    expect(reportColumnAlign("ref", rows)).toBe("start");
    expect(reportColumnAlign("startsAt", rows)).toBe("start");
    expect(reportColumnAlign("note", rows)).toBe("end"); // nulls are ignored
    expect(reportColumnAlign("missing", rows)).toBe("start");
  });
  it("computes the page range shown", () => {
    expect(pageRange(1, 100, 100)).toEqual({ from: 1, to: 100 });
    expect(pageRange(3, 100, 40)).toEqual({ from: 201, to: 240 });
  });
});

describe("timeline event tones", () => {
  it("colours problems, completions and field movement", () => {
    for (const t of ["request_cancelled", "driver_no_show", "delivery_disputed", "shipment_failed", "custody_not_returned"]) expect(eventTone(t), t).toBe("danger");
    for (const t of ["request_completed", "shipment_delivered", "payout_paid", "dispute_resolved", "custody_returned"]) expect(eventTone(t), t).toBe("accent");
    for (const t of ["driver_arrived", "driver_assigned", "route_approved", "request_published"]) expect(eventTone(t), t).toBe("cyan");
    expect(eventTone("whatsapp_handoff_opened")).toBe("muted");
  });
});
