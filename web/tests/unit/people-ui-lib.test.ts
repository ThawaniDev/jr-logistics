/** The pure mapping helpers of the people report components (API response → chart props). No React, no database. */
import { describe, it, expect } from "vitest";
import { bandLabels, barRows, heat, histBuckets, intBuckets, keyLabel, monthLabel, paretoPoints, percentBuckets, retention, slicesOf, stars, walletBuckets } from "@/components/reports/people/people-lib";

const t = (k: string, v?: Record<string, string | number>) => (v ? `${k}(${Object.entries(v).map(([a, b]) => `${a}=${b}`).join(",")})` : k);
const hist = (edges: number[], counts: number[]) => [...edges, null].map((to, i) => ({ from: i === 0 ? null : edges[i - 1], to, count: counts[i] }));

describe("histogram labels", () => {
  it("integer bands: single values, ranges (the upper edge is exclusive) and open ends", () => {
    expect(intBuckets(hist([2, 5, 10, 20], [1, 2, 3, 4, 5])).map((b) => b.label)).toEqual(["< 2", "2–4", "5–9", "10–19", "20+"]);
    expect(intBuckets(hist([1, 2, 3], [0, 0, 0, 0])).map((b) => b.label)).toEqual(["< 1", "1", "2", "3+"]);
    expect(intBuckets(hist([20, 40], [3, 4, 5])).map((b) => b.count)).toEqual([3, 4, 5]);
  });
  it("percent bands from fractions, in the viewer's language", () => {
    const en = percentBuckets(hist([0.5, 0.7, 0.9, 0.97], [1, 1, 1, 1, 1]), "en").map((b) => b.label);
    expect(en).toEqual(["< 50%", "50% – 70%", "70% – 90%", "90% – 97%", "97%+"]);
    expect(percentBuckets(hist([0.5], [1, 1]), "ar")[0].label).toContain("٪"); // Arabic percent sign
  });
  it("bandLabels names the bands the edges make", () => { expect(bandLabels([0.5, 0.8, 0.95], "en")).toEqual(["< 50%", "50% – 80%", "80% – 95%", "95%+"]); });
  it("generic labels reuse the framework's wording", () => {
    expect(histBuckets(hist([10], [1, 2]), (n) => `${n}x`, t).map((b) => b.label)).toEqual(["rpf.hist_lt(to=10x)", "rpf.hist_gte(from=10x)"]);
    expect(histBuckets(hist([10, 20], [1, 2, 3]), (n) => `${n}`, t)[1].label).toBe("rpf.hist_range(from=10,to=20)");
  });
  it("wallet balances: overdrawn and empty get their own names, the rest are SAR ranges", () => {
    const labels = walletBuckets(hist([0, 1, 50_000, 200_000, 1_000_000], [1, 1, 1, 1, 1, 1]), "en", t).map((b) => b.label);
    expect(labels[0]).toBe("rpp.wal_overdrawn"); expect(labels[1]).toBe("rpp.wal_empty"); expect(labels[2]).toContain("500"); expect(labels[5]).toContain("rpf.hist_gte");
  });
});

describe("pareto, retention, colour strength", () => {
  it("one point per rank with the value and the running share", () => {
    expect(paretoPoints([{ value: 60, cumulative: 0.6 }, { value: 40, cumulative: 1 }])).toEqual([{ t: "1", value: 60, cumulative: 0.6 }, { t: "2", value: 40, cumulative: 1 }]);
  });
  it("retention is the share of the cohort, capped at 1, and null when it cannot be told", () => {
    expect(retention(5, 10)).toBe(0.5); expect(retention(12, 10)).toBe(1); expect(retention(0, 10)).toBe(0);
    expect(retention(null, 10)).toBeNull(); expect(retention(3, 0)).toBeNull();
  });
  it("a faint cell is still visible, an unobservable one has no colour, and strength never exceeds 1", () => {
    expect(heat(null)).toBe(0); expect(heat(0)).toBe(0.08); expect(heat(0.5)).toBe(0.5); expect(heat(3)).toBe(1);
  });
});

describe("labels and rows", () => {
  it("month labels follow the viewer's language and read the key as a calendar month", () => {
    expect(monthLabel("2026-03-01", "en")).toMatch(/Mar/); expect(monthLabel("2026-03-01", "en")).toMatch(/26/);
    expect(monthLabel("2026-12-01", "ar")).not.toBe(monthLabel("2026-12-01", "en"));
  });
  it("catalogue keys translate, an unknown key stays as it is, and an empty one reads 'Not specified'", () => {
    const tr = (k: string) => (k === "city.riyadh" ? "Riyadh" : k === "rpf.not_specified" ? "Not specified" : k);
    expect(keyLabel("city", "riyadh", tr)).toBe("Riyadh"); expect(keyLabel("city", "tabuk2", tr)).toBe("tabuk2"); expect(keyLabel("city", "", tr)).toBe("Not specified");
  });
  it("slices take their colour from the map or by position", () => {
    const s = slicesOf([{ key: "a", value: 2 }, { key: "b", value: 3 }], (k) => k.toUpperCase(), { a: "red" });
    expect(s[0]).toMatchObject({ key: "a", label: "A", value: 2, color: "red" }); expect(s[1].color).toBe("var(--rpf-c2)");
  });
  it("ranked rows carry the link, the change and the tone", () => {
    const r = barRows([{ id: "x", name: "X", value: 5, prev: 4, share: 0.5 }], (x) => `/admin/companies/${x.id}`, "cyan");
    expect(r).toEqual([{ key: "x", label: "X", value: 5, prev: 4, share: 0.5, href: "/admin/companies/x", tone: "cyan" }]);
  });
  it("a star rating has one decimal and no data is a dash", () => { expect(stars(4.25)).toBe("4.3"); expect(stars(4)).toBe("4.0"); expect(stars(null)).toBe("—"); });
});
