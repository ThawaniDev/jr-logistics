import { describe, it, expect } from "vitest";
import {
  ACTIVITY_ENTITIES, ACTIVITY_KINDS, ENTITY_PERMS, RELEVANT_GROUPS, SOURCE_GROUPS, canOpenEntity, canSeeSensitive, clampPaging, csvRows, groupPerms, isActivityEntity, mergeFeeds, pageOf, redactDeep, redactItem, sumCounts, visibleGroups,
  type ActivityItem,
} from "@/server/activity-core";
import { ALL_PERMISSIONS, STAFF_PRESETS } from "@/server/catalog";

const item = (id: string, at: string, o: Partial<ActivityItem> = {}): ActivityItem => ({ id, at, kind: "event", source: "events", table: "job_events", titleKey: "event.x", params: {}, actor: null, refs: [], details: null, ...o });
const admin = { role: "admin", permissions: [] as string[] } as never;
const staff = (...p: string[]) => ({ role: "staff", permissions: p }) as never;

describe("activity core: merging, paging, counting", () => {
  it("merges feeds newest first, breaks ties by id (stable page boundaries) and drops repeats of the same row", () => {
    const a = [item("1", "2026-01-01T10:00:00.000Z"), item("3", "2026-01-01T12:00:00.000Z")];
    const b = [item("2", "2026-01-01T11:00:00.000Z"), item("9", "2026-01-01T12:00:00.000Z"), item("1", "2026-01-01T10:00:00.000Z")];
    expect(mergeFeeds([a, b]).map((i) => i.id)).toEqual(["9", "3", "2", "1"]);
    // the same id in a different table is a different row
    expect(mergeFeeds([[item("1", "2026-01-01T10:00:00.000Z")], [item("1", "2026-01-01T10:00:00.000Z", { table: "shipment_events" })]])).toHaveLength(2);
    expect(mergeFeeds([])).toEqual([]);
  });
  it("pages without gaps and clamps paging input", () => {
    const xs = Array.from({ length: 23 }, (_, i) => i);
    expect([1, 2, 3].flatMap((p) => pageOf(xs, p, 10))).toEqual(xs);
    expect(pageOf(xs, 4, 10)).toEqual([]);
    expect(clampPaging(undefined, undefined)).toEqual({ page: 1, pageSize: 30 });
    expect(clampPaging(0, 0)).toEqual({ page: 1, pageSize: 30 });
    expect(clampPaging(99, 500)).toEqual({ page: 20, pageSize: 100 });
    expect(clampPaging(2.9, 7.7)).toEqual({ page: 2, pageSize: 7 });
    expect(clampPaging(Number.NaN, Number.NaN)).toEqual({ page: 1, pageSize: 30 });
  });
  it("adds per-source counts into per-kind counts and omits empty kinds", () => {
    expect(sumCounts([{ kind: "event", n: 3 }, { kind: "event", n: 4 }, { kind: "chat", n: 0 }, { kind: "money", n: 2 }])).toEqual({ event: 7, money: 2 });
  });
  it("knows its entities", () => {
    expect(ACTIVITY_ENTITIES.every(isActivityEntity)).toBe(true);
    expect(isActivityEntity("spaceship")).toBe(false); expect(isActivityEntity(undefined)).toBe(false);
  });
});

describe("activity core: permissions (G10)", () => {
  it("every entity lists only known groups and every group has at least one permission that exists", () => {
    for (const e of ACTIVITY_ENTITIES) {
      expect(ENTITY_PERMS[e].length).toBeGreaterThan(0);
      for (const g of RELEVANT_GROUPS[e]) { expect(SOURCE_GROUPS).toContain(g); const p = groupPerms(g, e); expect(p.length).toBeGreaterThan(0); p.forEach((x) => expect(ALL_PERMISSIONS).toContain(x)); }
      ENTITY_PERMS[e].forEach((x) => expect(ALL_PERMISSIONS).toContain(x));
    }
  });
  it("an admin sees every group; a limited staff member loses exactly the groups they hold no permission for, and is told which", () => {
    expect(visibleGroups(admin, "request").hidden).toEqual([]);
    const v = visibleGroups(staff("requests.view"), "request");
    expect(v.hidden.sort()).toEqual(["audit", "finance", "support"]);
    expect([...v.allowed].sort()).toEqual(["chat", "events", "integration", "messages", "notes", "notifications", "ratings"]);
    const u = visibleGroups(staff("users.view"), "user");
    expect(u.hidden).toEqual(expect.arrayContaining(["events", "chat", "finance", "audit"]));
    expect([...u.allowed]).toEqual(expect.arrayContaining(["logins", "documents", "availability", "notifications", "messages"]));
    expect(visibleGroups(staff("finance.view"), "withdrawal").hidden).toEqual(["audit"]);
  });
  it("opening an entity needs one of its permissions", () => {
    expect(canOpenEntity(staff("tickets.view"), "ticket")).toBe(true);
    expect(canOpenEntity(staff("tickets.view"), "request")).toBe(false);
    expect(canOpenEntity(staff("complaints.manage"), "complaint")).toBe(true);
    expect(canOpenEntity(staff(), "user")).toBe(false);
    expect(canOpenEntity({ role: "driver", permissions: [] } as never, "request")).toBe(false);
    expect(canOpenEntity(admin, "withdrawal")).toBe(true);
  });
  it("the staff presets that work with customers can write notes", () => {
    for (const p of ["support", "operations", "hr_verification"]) expect(STAFF_PRESETS[p]).toContain("notes.manage");
    expect(ALL_PERMISSIONS).toContain("notes.manage");
  });
  it("only drivers.sensitive reveals IPs, devices and coordinates — at any depth, in arrays too", () => {
    expect(canSeeSensitive(staff("drivers.sensitive"))).toBe(true); expect(canSeeSensitive(staff("users.view"))).toBe(false); expect(canSeeSensitive(admin)).toBe(true);
    const d = { ip: "1.2.3.4", nested: { userAgent: "UA", lat: 24.7, keep: 1, list: [{ lng: 46.7, ok: "x" }] }, ipless: null, ip2: "kept" };
    expect(redactDeep(d)).toEqual({ ip: "•••", nested: { userAgent: "•••", lat: "•••", keep: 1, list: [{ lng: "•••", ok: "x" }] }, ipless: null, ip2: "kept" });
    expect(redactDeep({ ip: null })).toEqual({ ip: null });
    const it = item("1", "2026-01-01T00:00:00.000Z", { params: { lat: 1 }, details: { ip: "9.9.9.9" } });
    expect(redactItem(it, true)).toBe(it);
    expect(redactItem(it, false)).toMatchObject({ params: { lat: "•••" }, details: { ip: "•••" } });
  });
});

describe("activity core: CSV rows", () => {
  it("flattens an item: stable event name, scalar params only, readable actor and links", () => {
    const rows = csvRows([item("1", "2026-01-01T10:00:00.000Z", { kind: "parcel", titleKey: "dtk.p_delivered", params: { code: "JR-1-001", nested: { a: 1 }, none: null, n: 2 }, actor: { id: "u1", name: "Sam", role: "driver" }, refs: [{ type: "request", id: "r1", label: "JR-000001" }, { type: "ticket", id: "t1" }] })]);
    expect(rows).toEqual([{ at: "2026-01-01T10:00:00.000Z", kind: "parcel", source: "job_events", event: "dtk.p_delivered", actor: "Sam", actorRole: "driver", summary: "code=JR-1-001; n=2", refs: "request:JR-000001 ticket:t1" }]);
    expect(csvRows([item("2", "2026-01-01T10:00:00.000Z")])[0]).toMatchObject({ actor: "", actorRole: "", summary: "", refs: "" });
    expect(ACTIVITY_KINDS).toContain("parcel");
  });
});
