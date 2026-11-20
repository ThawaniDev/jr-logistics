import { describe, it, expect } from "vitest";
import {
  ALERT_RULES, CANNED_CATEGORIES, HEALTH_WEIGHTS, SLA, cannedKeys, companyAlerts, deviceOf, firstName, handlingHistory, healthParts, healthScore, maskIp, rate, resolvePeriod, slaClock, slaFor, worstSla,
  type AlertInputs, type AuditRow, type HealthInputs,
} from "@/server/details-pure";

const T0 = new Date("2026-11-19T06:00:00Z");
const plus = (sec: number) => new Date(T0.getTime() + sec * 1000);

describe("SLA clocks (one definition: first response 4 h, resolution 48 h)", () => {
  it("pins the targets", () => { expect(SLA.firstResponseSec).toBe(14_400); expect(SLA.resolutionSec).toBe(172_800); });
  it("a running clock is on track, then at risk in the last quarter, then breached", () => {
    expect(slaClock(T0, null, plus(3600), 14_400)).toMatchObject({ state: "on_track", elapsedSec: 3600, remainingSec: 10_800, doneAt: null });
    expect(slaClock(T0, null, plus(14_400 * 0.76), 14_400).state).toBe("at_risk");
    expect(slaClock(T0, null, plus(14_400), 14_400).state).toBe("at_risk"); // exactly on the line is not yet late
    expect(slaClock(T0, null, plus(14_401), 14_400)).toMatchObject({ state: "breached", remainingSec: -1 });
  });
  it("a finished clock says whether the target was met and stops running", () => {
    expect(slaClock(T0, plus(600), plus(999_999), 14_400)).toMatchObject({ state: "met", elapsedSec: 600, remainingSec: null });
    expect(slaClock(T0, plus(14_400), plus(999_999), 14_400).state).toBe("met");
    expect(slaClock(T0, plus(14_401), plus(999_999), 14_400).state).toBe("met_late");
  });
  it("never goes negative when a timestamp is slightly ahead of the clock", () => {
    expect(slaClock(plus(60), null, T0, 100).elapsedSec).toBe(0);
  });
  it("slaFor runs both clocks; a reopened ticket (no resolvedAt) keeps counting from the opening", () => {
    const open = slaFor({ createdAt: T0, firstResponseAt: plus(100), resolvedAt: null }, plus(SLA.resolutionSec + 5));
    expect(open.firstResponse.state).toBe("met"); expect(open.resolution.state).toBe("breached");
    expect(worstSla(open)).toBe("breached");
    const done = slaFor({ createdAt: T0, firstResponseAt: plus(100), resolvedAt: plus(5000) }, plus(999_999));
    expect(worstSla(done)).toBe("met");
    expect(worstSla(slaFor({ createdAt: T0, firstResponseAt: plus(SLA.firstResponseSec + 60), resolvedAt: plus(SLA.firstResponseSec + 120) }, plus(1e6)))).toBe("met_late");
  });
});

const base: HealthInputs = { daysSinceLastOrder: 3, orders90: 24, successRate: 0.9, cancellationRate: 0.05, openSupport: 0, complaints90: 0 };
describe("health score", () => {
  it("weights add up to 100", () => { expect(Object.values(HEALTH_WEIGHTS).reduce((a, b) => a + b, 0)).toBe(100); });
  it("scores each part from its rule", () => {
    const p = Object.fromEntries(healthParts(base).map((x) => [x.key, x.score]));
    expect(p).toEqual({ recency: 100, frequency: 100, success: 90, cancellations: 83, support: 100 });
    const worse = Object.fromEntries(healthParts({ daysSinceLastOrder: 90, orders90: 0, successRate: 0, cancellationRate: 0.3, openSupport: 2, complaints90: 3 }).map((x) => [x.key, x.score]));
    expect(worse).toEqual({ recency: 0, frequency: 0, success: 0, cancellations: 0, support: 20 });
    expect(Object.fromEntries(healthParts({ ...base, daysSinceLastOrder: 48.5 }).map((x) => [x.key, x.score])).recency).toBe(50);
  });
  it("a healthy company lands in the healthy band; the score is the weighted mean", () => {
    const h = healthScore(base);
    expect(h.score).toBe(Math.round((100 * 30 + 100 * 20 + 90 * 25 + 83 * 15 + 100 * 10) / 100));
    expect(h.band).toBe("healthy");
  });
  it("bands: watch and at risk", () => {
    expect(healthScore({ ...base, daysSinceLastOrder: 60, orders90: 6, successRate: 0.7, cancellationRate: 0.15 }).band).toBe("watch");
    expect(healthScore({ daysSinceLastOrder: 85, orders90: 1, successRate: 0.4, cancellationRate: 0.25, openSupport: 2, complaints90: 2 }).band).toBe("risk");
  });
  it("a part without data is left out and the rest re-weighted (no data is not zero)", () => {
    const h = healthScore({ ...base, successRate: null, cancellationRate: null });
    expect(h.parts.find((x) => x.key === "success")?.score).toBeNull();
    expect(h.score).toBe(100); // recency, frequency and support are all 100
  });
  it("a company that never ordered has no score, even with a spotless support record", () => {
    const h = healthScore({ daysSinceLastOrder: null, orders90: 0, successRate: null, cancellationRate: null, openSupport: 0, complaints90: 0 });
    expect(h).toMatchObject({ score: null, band: null });
    expect(h.parts.find((x) => x.key === "support")?.score).toBe(100);
  });
  it("support is left out when the viewer may not see it", () => {
    const h = healthScore({ ...base, openSupport: null, complaints90: null });
    expect(h.parts.find((x) => x.key === "support")?.score).toBeNull();
    expect(h.score).not.toBeNull();
  });
});

const calm: AlertInputs = {
  accountAgeDays: 100, verified: true, daysSinceLastOrder: 2, spendableCents: 500_000, nextOrder: null, avgOrderCents: 100_000, failureRate: { cur: 0.05, prev: 0.05, outcomes: 50 }, cancellationRate: { cur: 0.05, prev: 0.05, orders: 20 },
  creditUse: 0.1, integrationErrors: 0, slaBreached: 0,
};
const keys = (i: Partial<AlertInputs>) => companyAlerts({ ...calm, ...i }).map((a) => a.key);
describe("company alerts", () => {
  it("raises nothing for a calm company", () => { expect(keys({})).toEqual([]); });
  it("no orders for 45 days, or never ordered after 14 days", () => {
    expect(keys({ daysSinceLastOrder: ALERT_RULES.noOrdersDays - 1 })).toEqual([]);
    expect(companyAlerts({ ...calm, daysSinceLastOrder: 45 })[0]).toMatchObject({ key: "no_orders", params: { days: 45 } });
    expect(keys({ daysSinceLastOrder: null, accountAgeDays: 13 })).toEqual([]);
    expect(keys({ daysSinceLastOrder: null, accountAgeDays: 14 })).toEqual(["never_ordered"]);
    expect(keys({ daysSinceLastOrder: null, accountAgeDays: 90, verified: false })).toEqual([]);
  });
  it("wallet below the next draft order, else below the average order", () => {
    const a = companyAlerts({ ...calm, spendableCents: 10_000, nextOrder: { ref: "JR-1", totalCents: 50_000 } });
    expect(a[0]).toMatchObject({ key: "wallet_low", tone: "danger", params: { ref: "JR-1", need: 50_000, have: 10_000 } });
    expect(keys({ spendableCents: 50_000, nextOrder: { ref: "JR-1", totalCents: 50_000 } })).toEqual([]);
    expect(companyAlerts({ ...calm, spendableCents: 50_000 })[0]).toMatchObject({ key: "wallet_low", tone: "warn", params: { ref: "", need: 100_000 } });
    expect(keys({ spendableCents: null, avgOrderCents: 100_000 })).toEqual([]); // money hidden: never guess
  });
  it("failure and cancellation rises need enough data and a real rise", () => {
    expect(keys({ failureRate: { cur: 0.2, prev: 0.1, outcomes: 50 } })).toEqual(["failure_up"]);
    expect(keys({ failureRate: { cur: 0.2, prev: 0.1, outcomes: 9 } })).toEqual([]);
    expect(keys({ failureRate: { cur: 0.14, prev: 0.1, outcomes: 50 } })).toEqual([]);
    expect(keys({ failureRate: { cur: 0.3, prev: null, outcomes: 50 } })).toEqual([]);
    expect(keys({ cancellationRate: { cur: 0.3, prev: 0.1, orders: 20 } })).toEqual(["cancel_up"]);
    expect(keys({ cancellationRate: { cur: 0.3, prev: 0.1, orders: 4 } })).toEqual([]);
  });
  it("credit, integrations and deadlines", () => {
    expect(keys({ creditUse: 0.8 })).toEqual(["credit_high"]); expect(keys({ creditUse: 0.79 })).toEqual([]); expect(keys({ creditUse: null })).toEqual([]);
    expect(keys({ integrationErrors: 2, slaBreached: 1 })).toEqual(["integration_errors", "sla_breached"]);
  });
});

const rowOf = (id: string, action: string, diff: unknown, at = "2026-11-19T07:00:00Z", actorName = "Sara"): AuditRow => ({ id, at, action, actorId: "u1", actorName, diff });
describe("handling history from the audit trail", () => {
  it("turns a ticket update into one item per change, with from → to", () => {
    const h = handlingHistory("ticket", [rowOf("a1", "ticket.update", { from: { status: "open", priority: "normal", assignedTo: null }, patch: { status: "in_review", priority: "urgent", assignToMe: true } })], (id) => (id === "u1" ? "Sara" : null));
    expect(h.map((x) => [x.kind, x.from, x.to])).toEqual(expect.arrayContaining([["status", "open", "in_review"], ["priority", "normal", "urgent"], ["assign", null, "Sara"]]));
    expect(h).toHaveLength(3); expect(h[0].actor).toEqual({ id: "u1", name: "Sara" });
  });
  it("assigning to somebody else and unassigning; ids it cannot name stay ids", () => {
    const names = new Map([["b2", "Omar"], ["b3", "Lina"]]);
    const h = handlingHistory("ticket", [
      rowOf("a1", "ticket.update", { from: { assignedTo: "b2" }, patch: { assignTo: "b3" } }, "2026-11-19T08:00:00Z"),
      rowOf("a2", "ticket.update", { from: { assignedTo: "b3" }, patch: { assignTo: null } }, "2026-11-19T09:00:00Z"),
      rowOf("a3", "ticket.update", { from: {}, patch: { assignTo: "zz" } }, "2026-11-19T10:00:00Z"),
    ], (id) => (id ? names.get(id) ?? null : null));
    expect(h.map((x) => [x.from, x.to])).toEqual([[null, "zz"], ["Lina", null], ["Omar", "Lina"]]); // newest first
  });
  it("resolve and reopen actions, and rows of other actions are ignored", () => {
    const h = handlingHistory("ticket", [rowOf("r1", "ticket.resolve", null), rowOf("r2", "ticket.reopen", null, "2026-11-19T08:00:00Z"), rowOf("x", "ticket.view", {}), rowOf("y", "complaint.update", { status: "resolved" })]);
    expect(h.map((x) => x.kind)).toEqual(["reopen", "resolve"]);
  });
  it("complaints: status, resolution text, hold switches and assignment live in the patch itself", () => {
    const h = handlingHistory("complaint", [
      rowOf("c1", "complaint.update", { status: "resolved", resolution: "Late fee credited" }, "2026-11-19T08:00:00Z"),
      rowOf("c2", "complaint.update", { holdsSettlement: true }, "2026-11-19T07:30:00Z"),
      rowOf("c3", "complaint.update", { resolution: "Edited text" }, "2026-11-19T07:40:00Z"),
      rowOf("c4", "complaint.update", { assignToMe: true }, "2026-11-19T07:10:00Z"),
    ]);
    expect(h.map((x) => x.kind)).toEqual(["status", "resolution", "hold", "assign"]);
    expect(h[0]).toMatchObject({ to: "resolved", note: "Late fee credited" }); expect(h[2].to).toBe("on");
  });
  it("copes with junk in the diff column", () => {
    expect(handlingHistory("ticket", [rowOf("j1", "ticket.update", "oops"), rowOf("j2", "ticket.update", null), rowOf("j3", "ticket.update", { patch: [] })])).toEqual([]);
  });
});

describe("period windows", () => {
  const today = "2026-11-19";
  it("30 days: today and the 29 before, compared with the 30 days right before; daily buckets", () => {
    const p = resolvePeriod("30d", today, "2025-01-01T00:00:00Z");
    expect([p.cur.from, p.cur.to, p.cur.days]).toEqual(["2026-10-21", "2026-11-19", 30]);
    expect([p.prev?.from, p.prev?.to, p.prev?.days]).toEqual(["2026-09-21", "2026-10-20", 30]); expect(p.bucket).toBe("day");
  });
  it("90 days: weekly buckets", () => {
    const p = resolvePeriod("90d", today, "2025-01-01T00:00:00Z");
    expect(p.cur.days).toBe(90); expect(p.prev?.days).toBe(90); expect(p.bucket).toBe("week");
    expect(p.prev?.to).toBe("2026-08-21");
  });
  it("12 months: the last 12 calendar months, compared with a year earlier; monthly buckets", () => {
    const p = resolvePeriod("12m", today, "2020-01-01T00:00:00Z");
    expect([p.cur.from, p.cur.to]).toEqual(["2025-12-01", "2026-11-19"]); expect(p.prev?.from).toBe("2024-12-01"); expect(p.bucket).toBe("month");
  });
  it("all time starts the day the account was created, has no comparison, and never draws more than 60 months", () => {
    const young = resolvePeriod("all", today, "2026-11-10T21:30:00Z"); // 00:30 on the 11th in Riyadh
    expect([young.cur.from, young.prev]).toEqual(["2026-11-11", null]); expect(young.bucket).toBe("day");
    const old = resolvePeriod("all", today, "2010-05-05T00:00:00Z");
    expect(old.cur.from).toBe("2021-12-01"); expect(old.bucket).toBe("month");
    expect(resolvePeriod("all", today, "2027-01-01T00:00:00Z").cur.days).toBe(1); // a clock-skewed creation date cannot invert the window
  });
});

describe("canned replies, masks and small helpers", () => {
  it("every category has its own template first, then the three general ones; unknown categories get the general ones", () => {
    expect(cannedKeys("payment_issue")).toEqual(["dv3.canned_payment_issue", "dv3.canned_g_ack", "dv3.canned_g_need_info", "dv3.canned_g_thanks"]);
    expect(cannedKeys("something_new")).toEqual(["dv3.canned_g_ack", "dv3.canned_g_need_info", "dv3.canned_g_thanks"]);
    expect(new Set(CANNED_CATEGORIES).size).toBe(CANNED_CATEGORIES.length);
  });
  it("firstName", () => { expect(firstName("Sara  Al Ali")).toBe("Sara"); expect(firstName("  ")).toBe(""); expect(firstName(null)).toBe(""); });
  it("rate is null without a denominator", () => { expect(rate(1, 4)).toBe(0.25); expect(rate(0, 0)).toBeNull(); expect(rate(3, 0)).toBeNull(); });
  it("maskIp keeps the network, hides the host", () => {
    expect(maskIp("203.0.113.45")).toBe("203.0.113.•••"); expect(maskIp("2001:db8:85a3::8a2e:370:7334")).toBe("2001:db8:•••"); expect(maskIp("weird")).toBe("•••"); expect(maskIp(null)).toBeNull();
  });
  it("deviceOf names the browser and system, not the full user agent", () => {
    expect(deviceOf("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36")).toBe("Chrome · macOS");
    expect(deviceOf("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605 Version/17.0 Mobile Safari/604.1")).toBe("Safari · iOS");
    expect(deviceOf("okhttp/4.12 Android")).toBe("App · Android");
    expect(deviceOf("")).toBeNull();
  });
});
