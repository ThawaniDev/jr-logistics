import { describe, it, expect } from "vitest";
import en from "@/i18n/en";
import { translate } from "@/i18n/core";
import type { ActivityItem } from "@/server/activity-core";
import {
  KIND_TONE, KINDS, NO_FILTERS, activeFilters, dayKey, dayLabel, diffRows, exportPath, feedPath, feedQuery, groupByDay, hasDetails, itemTone, nextDay, prettyJson, refHref, renderTitle, scalarRows, titleVars,
} from "@/components/features/activity-lib";

const t = (k: string, v?: Record<string, string | number>) => translate(en, en, k, v);
const item = (o: Partial<ActivityItem> = {}): ActivityItem => ({ id: "1", at: "2026-11-19T10:00:00.000Z", kind: "parcel", source: "events", table: "shipment_events", titleKey: "dtk.p_delivered", params: {}, actor: null, refs: [], details: null, ...o });

describe("activity UI helpers", () => {
  it("every kind has a tone and problems are red whatever their kind", () => {
    for (const k of KINDS) expect(KIND_TONE[k]).toBeTruthy();
    expect(itemTone(item())).toBe("accent");
    for (const key of ["dtk.p_failed", "dtk.p_otp_failed", "dtk.login_failed", "dtk.message_failed", "dtk.webhook_dead_letter", "dtk.document_rejected", "dtk.p_cancelled", "dtk.p_missing", "dtk.session_revoked", "event.driver_no_show", "event.request_cancelled"]) expect(itemTone(item({ titleKey: key })), key).toBe("danger");
    expect(itemTone(item({ kind: "chat", titleKey: "dtk.chat_message" }))).toBe("cyan");
  });
  it("groups by Riyadh calendar day (not UTC) and labels today / yesterday", () => {
    expect(dayKey("2026-11-19T21:30:00.000Z")).toBe("2026-11-20"); expect(dayKey("2026-11-19T20:30:00.000Z")).toBe("2026-11-19");
    const g = groupByDay([{ at: "2026-11-20T01:00:00Z" }, { at: "2026-11-19T22:00:00Z" }, { at: "2026-11-19T10:00:00Z" }, { at: "2026-11-18T10:00:00Z" }]);
    expect(g.map((x) => [x.day, x.items.length])).toEqual([["2026-11-20", 2], ["2026-11-19", 1], ["2026-11-18", 1]]);
    const now = new Date("2026-11-19T12:00:00Z");
    expect(dayLabel("2026-11-19", t, "en", now)).toBe("Today"); expect(dayLabel("2026-11-18", t, "en", now)).toBe("Yesterday"); expect(dayLabel("2026-11-01", t, "en", now)).toMatch(/1 Nov 2026/);
    expect(groupByDay([])).toEqual([]);
  });
  it("formats amounts, translates reasons and never leaves a raw placeholder in a title", () => {
    const v = titleVars({ titleKey: "dtk.p_cod_collected", params: { code: "JR-1-001", amountCents: 12_550, reason: "refused", method: "otp", nested: undefined } }, t, "en");
    expect(v.amount).toMatch(/125\.50/); expect(v.reason).toBe(en["stopfail.refused"]); expect(v.method).toBe("SMS code"); expect(v.code).toBe("JR-1-001");
    expect(renderTitle(item({ titleKey: "dtk.p_cod_collected", params: { code: "JR-1-001", amountCents: 5000 } }), t, "en")).toMatch(/^Cash collected for JR-1-001: .*50\.00/);
    expect(renderTitle(item({ titleKey: "dtk.p_delivered", params: {} }), t, "en")).toBe("— delivered");
    expect(renderTitle(item({ titleKey: "dtk.p_failed", params: { code: "A", reason: "weird_reason" } }), t, "en")).toBe("Delivery of A failed (weird reason)");
    expect(renderTitle(item({ kind: "event", titleKey: "dtk.brand_new_thing" }), t, "en")).toBe("Event: brand new thing");
    expect(renderTitle(item({ kind: "notification", titleKey: "notif.never_seen" }), t, "en")).toBe(en["ubz.notif_generic"]);
    expect(renderTitle(item({ kind: "event", titleKey: "event.request_published" }), t, "en")).toBe(en["event.request_published"]);
    expect(renderTitle(item({ kind: "money", titleKey: "dtk.act.settings.update", params: {} }), t, "en")).toBe("Platform settings changed");
  });
  it("links every reference to its admin page, or to nothing when there is none", () => {
    expect(refHref({ type: "request", id: "r1" })).toBe("/admin/requests/r1"); expect(refHref({ type: "ticket", id: "t1" })).toBe("/admin/cases/t1"); expect(refHref({ type: "complaint", id: "c1" })).toBe("/admin/complaints/c1");
    expect(refHref({ type: "user", id: "u1", role: "business" })).toBe("/admin/companies/u1"); expect(refHref({ type: "user", id: "u1", role: "driver" })).toBe("/admin/drivers/u1"); expect(refHref({ type: "user", id: "u1", role: "office" })).toBe("/admin/offices/u1");
    expect(refHref({ type: "user", id: "u1", role: "staff" })).toBe("/admin/users/u1"); expect(refHref({ type: "user", id: "u1" })).toBe("/admin/users/u1");
    expect(refHref({ type: "shipment", id: "s1", label: "JR 1/2" })).toBe("/admin/parcels/s1"); expect(refHref({ type: "shipment", id: "s1" })).toBe("/admin/parcels/s1"); expect(refHref({ type: "offer", id: "o" })).toBeNull();
  });
  it("builds feed and export URLs from the filters (Riyadh days; `to` includes the whole day)", () => {
    expect(feedQuery(NO_FILTERS)).toBe(""); expect(activeFilters(NO_FILTERS)).toBe(0);
    const f = { kinds: ["chat", "money"], q: " late ", actorId: "u1", from: "2026-11-01", to: "2026-11-30" };
    expect(activeFilters(f)).toBe(5);
    const q = new URLSearchParams(feedQuery(f, { page: 2, pageSize: 30 }));
    expect(q.get("kinds")).toBe("chat,money"); expect(q.get("q")).toBe("late"); expect(q.get("actorId")).toBe("u1"); expect(q.get("page")).toBe("2");
    expect(q.get("from")).toBe("2026-10-31T21:00:00.000Z"); expect(q.get("to")).toBe("2026-11-30T21:00:00.000Z"); expect(nextDay("2026-12-31")).toBe("2027-01-01");
    expect(feedPath("request", "r1", NO_FILTERS, 1, 30)).toBe("/admin/activity/request/r1?page=1&pageSize=30");
    expect(exportPath("user", "u1", { ...NO_FILTERS, kinds: ["login"] })).toBe("/api/v1/admin/activity/user/u1/export?kinds=login");
  });
  it("shows audit diffs as before / after rows and leaves other shapes to the JSON view", () => {
    expect(diffRows({ vatPct: { from: 15, to: 16 }, name: { to: "x" } })).toEqual([{ key: "vatPct", from: "15", to: "16" }, { key: "name", from: "—", to: "\"x\"" }]);
    expect(diffRows({ a: 1 })).toBeNull(); expect(diffRows(null)).toBeNull(); expect(diffRows([])).toBeNull(); expect(diffRows({})).toBeNull();
    expect(diffRows({ k: { from: "y".repeat(300), to: 1 } })![0].from.length).toBeLessThanOrEqual(120);
  });
  it("details helpers", () => {
    expect(hasDetails(null)).toBe(false); expect(hasDetails({})).toBe(false); expect(hasDetails({ a: 1 })).toBe(true); expect(hasDetails("")).toBe(false); expect(hasDetails("x")).toBe(true);
    expect(scalarRows({ a: 1, b: "x", c: null, d: { e: 1 }, f: false })).toEqual([{ key: "a", value: "1" }, { key: "b", value: "x" }, { key: "f", value: "false" }]); expect(scalarRows(null)).toEqual([]);
    expect(prettyJson({ a: 1 })).toBe('{\n  "a": 1\n}');
  });
});
