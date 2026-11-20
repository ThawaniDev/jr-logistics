/** Finance › Drivers on screen: URL state ↔ API query, the sort toggle, the saved column choice and the period presets. Pure. */
import { describe, it, expect } from "vitest";
import { DEFAULT_COLS, listQuery, nextSort, parseCols, pickerGroups, sortOfUrl, UI_COLS, type DriversUrl } from "@/components/features/admin-finance-drivers-lib";
import { activePreset, effectiveRange, presetParams } from "@/components/features/fin-period-lib";
import { periodString } from "@/components/features/admin-finance-driver-detail";

const url: DriversUrl = { q: "", office: "", city: "", status: "", hasCash: false, hasPending: false, sort: "", dir: "", page: 1, from: "", to: "", period: "" };

describe("list query", () => {
  it("default state sends only the page size; filters, sort and period are added when set", () => {
    expect(listQuery(url)).toBe("?pageSize=25");
    const full = listQuery({ ...url, q: " ali ", office: "independent", city: "riyadh", status: "active", hasCash: true, hasPending: true, sort: "cashHeldCents", dir: "asc", page: 3, from: "2026-11-01", to: "2026-11-20" });
    const p = new URLSearchParams(full);
    expect(Object.fromEntries(p)).toEqual({ q: "ali", office: "independent", city: "riyadh", status: "active", hasCash: "1", hasPending: "1", sort: "cashHeldCents", dir: "asc", from: "2026-11-01", to: "2026-11-20", page: "3", pageSize: "25" });
  });
  it("all time, an unknown sort column, and a half range", () => {
    expect(new URLSearchParams(listQuery({ ...url, period: "all", from: "2026-01-01", to: "2026-02-01" })).get("period")).toBe("all");
    expect(new URLSearchParams(listQuery({ ...url, period: "all" })).has("from")).toBe(false);
    expect(new URLSearchParams(listQuery({ ...url, sort: "hacker", dir: "asc" })).has("sort")).toBe(false);
    expect(new URLSearchParams(listQuery({ ...url, from: "2026-01-01" })).has("from")).toBe(false);
  });
  it("a download is the whole selection: no page, plus format and language", () => {
    const p = new URLSearchParams(listQuery({ ...url, page: 4, hasCash: true }, { format: "xlsx", lang: "ar" }));
    expect(Object.fromEntries(p)).toEqual({ hasCash: "1", format: "xlsx", lang: "ar" });
  });
});

describe("sorting", () => {
  it("defaults to earnings, newest first", () => expect(sortOfUrl("", "")).toEqual({ key: "earnedCents", dir: "desc" }));
  it("keeps a known column and direction, drops an unknown one", () => {
    expect(sortOfUrl("name", "asc")).toEqual({ key: "name", dir: "asc" });
    expect(sortOfUrl("zzz", "asc")).toEqual({ key: "earnedCents", dir: "desc" });
  });
  it("a new column starts descending for numbers and ascending for text; the same column flips", () => {
    expect(nextSort({ key: "earnedCents", dir: "desc" }, "cashHeldCents")).toEqual({ key: "cashHeldCents", dir: "desc" });
    expect(nextSort({ key: "earnedCents", dir: "desc" }, "name")).toEqual({ key: "name", dir: "asc" });
    expect(nextSort({ key: "name", dir: "asc" }, "name")).toEqual({ key: "name", dir: "desc" });
    expect(nextSort({ key: "name", dir: "desc" }, "name")).toEqual({ key: "name", dir: "asc" });
  });
});

describe("column choice", () => {
  it("defaults are the compact set; the picker lists every on-screen column once", () => {
    expect(DEFAULT_COLS.length).toBeLessThanOrEqual(10);
    expect(DEFAULT_COLS).toEqual(expect.arrayContaining(["name", "officeName", "earnedCents", "cashHeldCents"]));
    const g = pickerGroups((k) => k, (x) => x);
    expect(g.flatMap((x) => x.items.map((i) => i.key)).sort()).toEqual(UI_COLS.map((c) => c.key).sort());
  });
  it("parses the saved choice: unknown keys are dropped, order follows the table, garbage falls back to the defaults", () => {
    expect(parseCols(JSON.stringify(["cashHeldCents", "nope", "name"]))).toEqual(["name", "cashHeldCents"]);
    for (const bad of [null, "", "{", "[]", JSON.stringify(["nope"]), JSON.stringify({ a: 1 })]) expect(parseCols(bad), String(bad)).toEqual(DEFAULT_COLS);
  });
});

describe("period presets", () => {
  const today = "2026-11-20";
  it("no parameters = 30 days; a matching range is that preset; anything else is custom; all time", () => {
    expect(activePreset({ from: "", to: "", period: "" }, today)).toBe("30d");
    expect(activePreset({ from: "2026-11-14", to: "2026-11-20", period: "" }, today)).toBe("7d");
    expect(activePreset({ from: "2026-11-01", to: "2026-11-20", period: "" }, today)).toBe("mtd");
    expect(activePreset({ from: "2026-01-01", to: "2026-11-20", period: "" }, today)).toBe("ytd");
    expect(activePreset({ from: "2026-11-03", to: "2026-11-09", period: "" }, today)).toBe("custom");
    expect(activePreset({ from: "", to: "", period: "all" }, today)).toBe("all");
  });
  it("a preset becomes URL parameters (30 days = none); custom keeps the current range", () => {
    expect(presetParams("30d", today, { from: "x", to: "y" })).toEqual({ from: "", to: "", period: "" });
    expect(presetParams("7d", today, { from: "", to: "" })).toEqual({ from: "2026-11-14", to: "2026-11-20", period: "" });
    expect(presetParams("all", today, { from: "", to: "" })).toEqual({ from: "", to: "", period: "all" });
    expect(presetParams("custom", today, { from: "2026-11-01", to: "2026-11-05" })).toEqual({ from: "2026-11-01", to: "2026-11-05", period: "" });
    expect(effectiveRange({ from: "", to: "", period: "" }, today)).toEqual({ from: "2026-10-22", to: "2026-11-20" });
    expect(effectiveRange({ from: "2026-11-01", to: "2026-11-02", period: "" }, today)).toEqual({ from: "2026-11-01", to: "2026-11-02" });
  });
  it("the detail page sends the period as one query part", () => {
    expect(periodString({ from: "2026-11-01", to: "2026-11-05", period: "" })).toBe("from=2026-11-01&to=2026-11-05");
    expect(periodString({ from: "", to: "", period: "all" })).toBe("period=all");
    expect(periodString({ from: "", to: "", period: "" })).toBe("");
    expect(periodString({ from: "2026-11-01", to: "", period: "" })).toBe("");
  });
});
