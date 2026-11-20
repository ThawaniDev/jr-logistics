import { describe, expect, it } from "vitest";
import {
  AUDIT_ENTITIES, actionParts, auditFrom, caseStats, complaintStats, connectionFilter, diffRows, distinctActors, entityHref, filterStaff, groupPermissions, handlerOf, healthOf, isLocked, loadAllPages,
  matchAssignee, matchCaseQuery, notifFamily, paginate, permArea, ratingSummary, riyadhDayStart, samePerms, sortCases, staffStats, statusesFor, type CaseRow, type StaffRow,
} from "@/components/features/admin-system-lib";

const NOW = Date.parse("2026-11-19T12:00:00Z");
const row = (o: Partial<CaseRow>): CaseRow => ({ id: "x", ref: "TK-1", status: "open", category: "other", createdAt: "2026-11-19T08:00:00Z", updatedAt: "2026-11-19T08:00:00Z", ...o });

describe("loadAllPages", () => {
  it("reads pages until everything is loaded", async () => {
    const all = Array.from({ length: 5 }, (_, i) => i);
    const calls: number[] = [];
    const r = await loadAllPages(async (p) => { calls.push(p); return { items: all.slice((p - 1) * 2, p * 2), total: 5 }; });
    expect(r).toEqual({ items: all, total: 5, capped: false }); expect(calls).toEqual([1, 2, 3]);
  });
  it("stops at the cap and says so", async () => {
    const r = await loadAllPages(async (p) => ({ items: [p * 10, p * 10 + 1], total: 100 }), 3);
    expect(r.items).toHaveLength(6); expect(r.capped).toBe(true);
  });
  it("stops when a page comes back empty", async () => {
    const r = await loadAllPages(async (p) => ({ items: p === 1 ? [1] : [], total: 9 }));
    expect(r).toEqual({ items: [1], total: 9, capped: true });
  });
  it("paginate is one-based and tolerates page 0", () => {
    expect(paginate([1, 2, 3, 4, 5], 2, 2)).toEqual([3, 4]); expect(paginate([1, 2, 3], 0, 2)).toEqual([1, 2]); expect(paginate([1], 3, 2)).toEqual([]);
  });
});

describe("case filters", () => {
  const a = row({ id: "a", assignedTo: "me" }), b = row({ id: "b" }), c = row({ id: "c", handlerId: "h1" });
  it("reads the handler from assignedTo (tickets) or handlerId (complaints)", () => {
    expect(handlerOf(a)).toBe("me"); expect(handlerOf(c)).toBe("h1"); expect(handlerOf(b)).toBeNull();
  });
  it("matches the assignee filter", () => {
    expect([a, b, c].filter((x) => matchAssignee(x, "", "me")).map((x) => x.id)).toEqual(["a", "b", "c"]);
    expect([a, b, c].filter((x) => matchAssignee(x, "me", "me")).map((x) => x.id)).toEqual(["a"]);
    expect([a, b, c].filter((x) => matchAssignee(x, "unassigned", "me")).map((x) => x.id)).toEqual(["b"]);
    expect([a, b, c].filter((x) => matchAssignee(x, "h1", "me")).map((x) => x.id)).toEqual(["c"]);
  });
  it("searches reference, subject, description and the person's name", () => {
    const t = row({ ref: "TK-000042", subject: "Wallet top-up missing", openedByName: "Sara Alharbi", description: "paid twice" });
    expect(matchCaseQuery(t, "000042")).toBe(true); expect(matchCaseQuery(t, "top-up")).toBe(true); expect(matchCaseQuery(t, "alharbi")).toBe(true);
    expect(matchCaseQuery(t, "PAID")).toBe(true); expect(matchCaseQuery(t, "nothing")).toBe(false); expect(matchCaseQuery(t, "  ")).toBe(true);
  });
  it("sorts urgent first, then the most recently updated", () => {
    const rows = [row({ id: "old", updatedAt: "2026-11-01T00:00:00Z" }), row({ id: "new", updatedAt: "2026-11-18T00:00:00Z" }), row({ id: "urg", priority: "urgent", updatedAt: "2026-10-01T00:00:00Z" })];
    expect(sortCases(rows).map((r) => r.id)).toEqual(["urg", "new", "old"]);
    expect(rows[0].id).toBe("old"); // the input is not mutated
  });
  it("turns a status filter into the statuses to read", () => {
    expect(statusesFor("tickets", "active")).toEqual(["open", "in_review"]); expect(statusesFor("complaints", "active")).toEqual(["open", "in_progress"]);
    expect(statusesFor("tickets", "all")).toEqual([""]); expect(statusesFor("tickets", "")).toEqual([""]); expect(statusesFor("tickets", "resolved")).toEqual(["resolved"]);
  });
});

describe("queue KPIs", () => {
  it("counts tickets: totals from the API, unassigned / urgent / resolved-this-week from the rows", () => {
    const s = caseStats({
      open: { total: 3, items: [row({}), row({ assignedTo: "u" }), row({ priority: "urgent" })] },
      in_review: { total: 2, items: [row({ status: "in_review", priority: "urgent", assignedTo: "u" }), row({ status: "in_review", assignedTo: "u" })] },
      resolved: { total: 9, items: [row({ status: "resolved", resolvedAt: "2026-11-17T00:00:00Z" }), row({ status: "resolved", resolvedAt: "2026-11-01T00:00:00Z" }), row({ status: "resolved", resolvedAt: null, updatedAt: "2026-11-18T00:00:00Z" })] },
    }, NOW);
    expect(s).toEqual({ open: 3, inReview: 2, active: 5, unassigned: 2, urgent: 2, resolvedWeek: 2, capped: false });
  });
  it("is all zeros for an empty queue and flags a capped one", () => {
    expect(caseStats({}, NOW)).toEqual({ open: 0, inReview: 0, active: 0, unassigned: 0, urgent: 0, resolvedWeek: 0, capped: false });
    expect(caseStats({ open: { total: 900, items: [], capped: true } }, NOW).capped).toBe(true);
  });
  it("counts complaints, including the ones holding a payment", () => {
    const s = complaintStats({
      open: { total: 2, items: [row({ holdsSettlement: true }), row({ priority: "urgent" })] }, in_progress: { total: 1, items: [row({ handlerId: "h", holdsSettlement: true })] },
      resolved: { total: 4, items: [row({ resolvedAt: "2026-11-18T10:00:00Z" })] },
    }, NOW);
    expect(s).toEqual({ open: 2, inProgress: 1, active: 3, holding: 2, urgent: 1, unassigned: 2, resolvedWeek: 1, capped: false });
  });
});

describe("account links", () => {
  it("points each role at its account page and nothing else", () => {
    expect(entityHref("business", "b1")).toBe("/admin/companies/b1"); expect(entityHref("office", "o1")).toBe("/admin/offices/o1"); expect(entityHref("driver", "d1")).toBe("/admin/drivers/d1");
    expect(entityHref("staff", "s1")).toBe("/admin/users/s1"); expect(entityHref("admin", "a1")).toBe("/admin/users/a1"); expect(entityHref("system", "x")).toBeNull(); expect(entityHref("business", null)).toBeNull(); expect(entityHref(undefined, "x")).toBeNull();
  });
});

describe("ratings", () => {
  it("rebuilds the distribution, the average and the low-rating share from cumulative counts", () => {
    // 1★ 1, 2★ 1, 3★ 2, 4★ 3, 5★ 3  (10 ratings, sum 1+2+6+12+15 = 36)
    const s = ratingSummary({ 1: 1, 2: 2, 3: 4, 4: 7, 5: 10 });
    expect(s.dist).toEqual([1, 1, 2, 3, 3]); expect(s.total).toBe(10); expect(s.avg).toBe(3.6); expect(s.low).toBe(2); expect(s.lowShare).toBeCloseTo(0.2); expect(s.fiveShare).toBeCloseTo(0.3);
  });
  it("has no average when there are no ratings and never goes negative", () => {
    expect(ratingSummary({ 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 })).toMatchObject({ total: 0, avg: null, low: 0, lowShare: 0, fiveShare: 0 });
    expect(ratingSummary({ 1: 2, 2: 1, 3: 1, 4: 1, 5: 1 }).dist.every((n) => n >= 0)).toBe(true);
  });
});

describe("audit log", () => {
  it("finds the start of the Riyadh day (UTC+3)", () => {
    expect(riyadhDayStart(Date.parse("2026-11-19T02:00:00Z"))).toBe("2026-11-18T21:00:00.000Z"); // 05:00 Riyadh on the 19th
    expect(riyadhDayStart(Date.parse("2026-11-19T21:00:00Z"))).toBe("2026-11-19T21:00:00.000Z"); // 00:00 Riyadh on the 20th
    expect(riyadhDayStart(Date.parse("2026-11-19T20:59:59Z"))).toBe("2026-11-18T21:00:00.000Z");
  });
  it("turns a period into a lower bound", () => {
    const now = Date.parse("2026-11-19T12:00:00Z");
    expect(auditFrom("today", now)).toBe("2026-11-18T21:00:00.000Z"); expect(auditFrom("7d", now)).toBe("2026-11-12T21:00:00.000Z"); expect(auditFrom("30d", now)).toBe("2026-10-20T21:00:00.000Z");
    expect(auditFrom("all", now)).toBeUndefined(); expect(auditFrom("", now)).toBeUndefined();
  });
  it("shows a settings change as before / after rows and leaves other shapes alone", () => {
    expect(diffRows({ vatPct: { from: 15, to: 12 }, cities: { from: [], to: [{ key: "a" }] } })).toEqual([{ key: "vatPct", from: "15", to: "12" }, { key: "cities", from: "[]", to: '[{"key":"a"}]' }]);
    expect(diffRows({ status: "resolved" })).toBeNull(); expect(diffRows(null)).toBeNull(); expect(diffRows([1])).toBeNull(); expect(diffRows({})).toBeNull();
    expect(diffRows({ k: { from: "x".repeat(200), to: 1 } })![0].from.length).toBeLessThanOrEqual(80);
  });
  it("splits an action into area and verb and counts distinct people", () => {
    expect(actionParts("settings.update")).toEqual({ area: "settings", verb: "update" }); expect(actionParts("broadcast")).toEqual({ area: "broadcast", verb: "" }); expect(actionParts("a.b.c")).toEqual({ area: "a", verb: "b.c" });
    expect(distinctActors([{ actorId: "a" }, { actorId: "a" }, { actorId: null }, { actorId: "b" }, {}])).toBe(2);
    expect(AUDIT_ENTITIES).toContain("settings");
  });
});

describe("staff", () => {
  const rows: StaffRow[] = [
    { id: "1", name: "Ann Support", email: "ann@x.test", staffRole: "support", permissions: ["tickets.view"], status: "active", totpEnabledAt: "2026-01-01T00:00:00Z" },
    { id: "2", name: "Bob Finance", email: "bob@x.test", staffRole: "finance", permissions: [], status: "active", lockedUntil: "2026-11-19T13:00:00Z", mustChangePassword: true },
    { id: "3", name: "Cy Ops", email: null, staffRole: null, permissions: [], status: "suspended", lockedUntil: "2026-11-18T13:00:00Z" },
  ];
  it("knows who is locked right now", () => {
    expect(isLocked(rows[1], NOW)).toBe(true); expect(isLocked(rows[2], NOW)).toBe(false); expect(isLocked(rows[0], NOW)).toBe(false);
  });
  it("counts staff for the KPI row", () => {
    expect(staffStats(rows, NOW)).toEqual({ total: 3, active: 2, suspended: 1, locked: 1, mfa: 1, noMfa: 2 });
    expect(staffStats([], NOW)).toEqual({ total: 0, active: 0, suspended: 0, locked: 0, mfa: 0, noMfa: 0 });
  });
  it("filters by state and by name / email", () => {
    expect(filterStaff(rows, "active", "", NOW).map((s) => s.id)).toEqual(["1", "2"]); expect(filterStaff(rows, "suspended", "", NOW).map((s) => s.id)).toEqual(["3"]);
    expect(filterStaff(rows, "locked", "", NOW).map((s) => s.id)).toEqual(["2"]); expect(filterStaff(rows, "no_mfa", "", NOW).map((s) => s.id)).toEqual(["2", "3"]);
    expect(filterStaff(rows, "all", "BOB@", NOW).map((s) => s.id)).toEqual(["2"]); expect(filterStaff(rows, "all", "cy", NOW).map((s) => s.id)).toEqual(["3"]);
  });
  it("groups permissions by area in a fixed order", () => {
    expect(permArea("tickets.manage")).toBe("support"); expect(permArea("wallet.adjust")).toBe("finance"); expect(permArea("broadcast.send")).toBe("admin"); expect(permArea("mystery.thing")).toBe("other");
    const g = groupPermissions(["settings.view", "requests.view", "finance.view", "users.view", "tickets.view", "reports.view", "zzz.other", "requests.edit"]);
    expect(g.map((x) => x.area)).toEqual(["people", "orders", "support", "finance", "insights", "admin", "other"]);
    expect(g.find((x) => x.area === "orders")!.perms).toEqual(["requests.view", "requests.edit"]);
    expect(groupPermissions([])).toEqual([]);
  });
  it("compares permission lists without regard to order", () => {
    expect(samePerms(["a", "b"], ["b", "a"])).toBe(true); expect(samePerms(["a"], ["a", "b"])).toBe(false); expect(samePerms([], [])).toBe(true);
  });
});

describe("integrations", () => {
  const c = { status: "active" as const, lastError: null, stuckUpdates: 0, lastOkAt: "2026-11-19T00:00:00Z", lastEventAt: null };
  it("rates the health of a connection", () => {
    expect(healthOf(c)).toBe("ok"); expect(healthOf({ ...c, lastError: "boom" })).toBe("attention"); expect(healthOf({ ...c, stuckUpdates: 2 })).toBe("attention");
    expect(healthOf({ ...c, lastOkAt: null })).toBe("new"); expect(healthOf({ ...c, status: "disabled", lastError: "boom" })).toBe("paused");
  });
  it("maps a view to the API filter (problems = switched-on connections with a problem)", () => {
    expect(connectionFilter("problems")).toEqual({ status: "active", problemsOnly: "1" }); expect(connectionFilter("active")).toEqual({ status: "active" });
    expect(connectionFilter("disabled")).toEqual({ status: "disabled" }); expect(connectionFilter("all")).toEqual({}); expect(connectionFilter("")).toEqual({});
  });
});

describe("notifications", () => {
  it("sorts notification types into families", () => {
    expect(notifFamily("ticket_reply")).toBe("support"); expect(notifFamily("complaint_filed")).toBe("support"); expect(notifFamily("payout_paid")).toBe("money"); expect(notifFamily("wallet_adjusted")).toBe("money");
    expect(notifFamily("cod_received")).toBe("money"); expect(notifFamily("document_rejected")).toBe("documents"); expect(notifFamily("verification_verified")).toBe("documents");
    expect(notifFamily("driver_cancelled")).toBe("alert"); expect(notifFamily("no_show_recorded")).toBe("alert"); expect(notifFamily("offer_new")).toBe("work"); expect(notifFamily("request_completed")).toBe("work");
    expect(notifFamily("broadcast")).toBe("other"); expect(notifFamily("mfa_enabled")).toBe("other");
  });
});
