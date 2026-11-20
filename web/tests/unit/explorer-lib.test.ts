import { describe, it, expect } from "vitest";
import { activeFilters, addView, apiParams, datasetPatch, fillHref, MAX_VIEWS, parseState, rangeValue, readViews, removeView, splitRange, toggleIn, valueLabel, type CatalogDataset } from "@/components/reports/explorer/explorer-lib";

const DS = {
  key: "tickets", group: "support", time: "rpq.t_opened", keys: ["city"], defaultSort: { key: "createdAt", dir: "desc" }, hasSearchPii: false,
  columns: ["ref", "status", "createdAt", "priority"].map((key) => ({ key, type: "text", default: key !== "priority", masked: false, sortable: true, groupable: false, aggregable: false, temporal: false })),
  filters: [{ key: "status", kind: "enum", values: ["open", "resolved"], money: false, dateOnly: false }, { key: "unassigned", kind: "flag", money: false, dateOnly: false }],
} as unknown as CatalogDataset;
const sp = (s: string) => new URLSearchParams(s);

describe("the explorer's URL state", () => {
  it("parses every explorer parameter and ignores the rest", () => {
    const s = parseState(sp("ds=tickets&cols=ref,status&sort=createdAt&dir=asc&q=refund&all=1&group=status&agg=sum:totalCents,p90:x&ps=50&preset=7d&city=riyadh&f.status=open,resolved&f.unassigned=yes"));
    expect(s).toEqual({ ds: "tickets", cols: ["ref", "status"], sort: "createdAt", dir: "asc", q: "refund", all: true, group: "status", agg: ["sum:totalCents", "p90:x"], ps: 50, filters: { status: "open,resolved", unassigned: "yes" } });
    expect(parseState(sp(""))).toEqual({ ds: "", cols: [], sort: "", dir: "", q: "", all: false, filters: {}, group: "", agg: [], ps: 25 });
    expect(parseState(sp("ps=7&dir=sideways")).ps).toBe(25); expect(parseState(sp("ps=7&dir=sideways")).dir).toBe("");
  });
  it("builds the API query: only what differs from the defaults, only columns and filters the dataset has", () => {
    const s = parseState(sp("cols=ref,gone&sort=createdAt&dir=asc&q=x&all=1&f.status=open&f.gone=1&ps=50"));
    expect(apiParams(s, DS)).toBe("cols=ref&sort=createdAt&dir=asc&q=x&all=1&f.status=open&pageSize=50");
    expect(apiParams(s, DS, 3)).toContain("page=3");
    expect(apiParams(parseState(sp("")), DS)).toBe("pageSize=25");
    expect(apiParams(parseState(sp("sort=gone")), DS)).toBe("pageSize=25");
  });
  it("a grouped view sends the grouping instead of paging", () => {
    expect(apiParams(parseState(sp("group=status&agg=sum:x&ps=50")), DS)).toBe("group=status&agg=sum%3Ax");
    expect(apiParams(parseState(sp("group=gone")), DS)).toBe("pageSize=25");
    expect(apiParams(parseState(sp("group=createdAt~month")), DS)).toBe("group=createdAt%7Emonth");
  });
  it("switching dataset clears everything that belonged to the old one", () => {
    expect(datasetPatch("parcels", sp("ds=tickets&f.status=open&f.cod=yes&cols=ref&preset=7d"))).toEqual({ ds: "parcels", cols: "", sort: "", dir: "", q: "", group: "", agg: "", "f.status": "", "f.cod": "" });
  });
  it("counts the dataset filters in use", () => { expect(activeFilters(parseState(sp("f.status=open&q=x&f.unassigned=no")))).toBe(3); expect(activeFilters(parseState(sp("")))).toBe(0); });
});

describe("filter and column helpers", () => {
  it("ranges round-trip and an empty range clears the parameter", () => {
    expect(rangeValue("5", "")).toBe("5.."); expect(rangeValue("", "9")).toBe("..9"); expect(rangeValue(" 1 ", " 2 ")).toBe("1..2"); expect(rangeValue("", " ")).toBe("");
    expect(splitRange("5..")).toEqual(["5", ""]); expect(splitRange("..9")).toEqual(["", "9"]); expect(splitRange("2026-01-01..2026-01-31")).toEqual(["2026-01-01", "2026-01-31"]); expect(splitRange(undefined)).toEqual(["", ""]); expect(splitRange("nope")).toEqual(["", ""]);
  });
  it("toggling keeps the dataset's own order", () => {
    const order = ["a", "b", "c", "d"];
    expect(toggleIn(["a", "c"], "b", order)).toEqual(["a", "b", "c"]); expect(toggleIn(["a", "b", "c"], "b", order)).toEqual(["a", "c"]); expect(toggleIn([], "d", order)).toEqual(["d"]);
  });
  it("links fill their fields and escape them", () => {
    expect(fillHref("/admin/requests/{requestId}", { requestId: "a/b c" })).toBe("/admin/requests/a%2Fb%20c"); expect(fillHref("/x/{id}", {})).toBe("/x/");
  });
  it("value words: the column's namespace, then the explorer's own, then the raw value", () => {
    const dict: Record<string, string> = { "status.open": "Open", "rpq.v_sms": "SMS" };
    const t = (k: string) => dict[k] ?? k;
    expect(valueLabel(t, "status", "open")).toBe("Open"); expect(valueLabel(t, undefined, "sms")).toBe("SMS"); expect(valueLabel(t, "status", "sms")).toBe("SMS"); expect(valueLabel(t, "status", "weird")).toBe("weird");
  });
});

describe("saved views", () => {
  it("add a named view (newest first), replace one of the same name, never keep the page", () => {
    let v = addView([], "  Late tickets ", "ds=tickets&page=4&f.status=open", 1000);
    expect(v).toHaveLength(1); expect(v[0]).toMatchObject({ name: "Late tickets", qs: "ds=tickets&f.status=open", savedAt: 1000 });
    v = addView(v, "Other", "ds=parcels", 2000);
    expect(v.map((x) => x.name)).toEqual(["Other", "Late tickets"]);
    v = addView(v, "Late tickets", "ds=tickets&f.status=resolved", 3000);
    expect(v.map((x) => x.name)).toEqual(["Late tickets", "Other"]); expect(v[0].qs).toBe("ds=tickets&f.status=resolved");
    expect(addView(v, "   ", "ds=x")).toBe(v);
    expect(new Set(v.map((x) => x.id)).size).toBe(v.length);
  });
  it("keep at most MAX_VIEWS and the name at 60 characters", () => {
    let v = [] as ReturnType<typeof addView>;
    for (let i = 0; i < MAX_VIEWS + 5; i++) v = addView(v, `view ${i}`, "ds=x", i);
    expect(v).toHaveLength(MAX_VIEWS); expect(v[0].name).toBe(`view ${MAX_VIEWS + 4}`);
    expect(addView([], "x".repeat(100), "ds=x")[0].name).toHaveLength(60);
  });
  it("remove by id", () => { const v = addView(addView([], "a", "ds=x", 1), "b", "ds=y", 2); expect(removeView(v, v[0].id).map((x) => x.name)).toEqual(["a"]); expect(removeView(v, "nope")).toHaveLength(2); });
  it("reading survives empty, corrupted or foreign storage", () => {
    expect(readViews(null)).toEqual([]); expect(readViews("")).toEqual([]); expect(readViews("{not json")).toEqual([]); expect(readViews('{"a":1}')).toEqual([]);
    expect(readViews(JSON.stringify([{ id: "1", name: "ok", qs: "ds=x", savedAt: 1 }, { id: 2 }, null, "x"]))).toEqual([{ id: "1", name: "ok", qs: "ds=x", savedAt: 1 }]);
  });
});
