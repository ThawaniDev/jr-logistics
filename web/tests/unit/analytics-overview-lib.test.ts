import { describe, it, expect } from "vitest";
import en from "@/i18n/en";
import { translate } from "@/i18n/core";
import { breakdownRows, breakdownSlices, dimLabel, fillBuckets, funnelSteps, statusSeries } from "@/components/reports/overview-lib";
import { bucketLabel, fmtDur, formatValue, fmtSignedPct, fmtSignedPp } from "@/components/reports/chartTheme";

const t = (k: string, v?: Record<string, string | number>) => translate(en, en, k, v);
const row = (o: Partial<Parameters<typeof breakdownRows>[0][number]> = {}) => ({ key: "riyadh", requests: 8, prevRequests: 4, completed: 5, cancelled: 1, gmv: null, prevGmv: null, revenue: null, share: 0.8, ...o });

describe("overview mapping helpers", () => {
  it("labels breakdown keys in the dictionary, with fallbacks", () => {
    expect(dimLabel("city", "riyadh", t)).toBe("Riyadh");
    expect(dimLabel("service", "delivery_driver", t)).toBe("Delivery driver");
    expect(dimLabel("vehicle", "", t)).toBe("Not specified");
    expect(dimLabel("channel", "mobile", t)).toBe("Mobile app");
    expect(dimLabel("city", "custom_city", t)).toBe("custom_city");
    expect(dimLabel("city", "custom_city", t, (k) => (k === "custom_city" ? "Custom City" : undefined))).toBe("Custom City");
  });
  it("breakdown rows carry value, previous value, share and the billed amount only when known", () => {
    const [a, b] = breakdownRows([row(), row({ key: "jeddah", gmv: 12345, requests: 2, prevRequests: null, share: 0.2 })], "city", t, "en");
    expect(a).toMatchObject({ key: "riyadh", label: "Riyadh", value: 8, prev: 4, share: 0.8, sub: undefined });
    expect(b.prev).toBeNull(); expect(b.sub).toContain("123.45");
    expect(breakdownSlices([row(), row({ key: "jeddah", gmv: 500 })], "city", t, "gmv").map((s) => s.value)).toEqual([0, 500]);
  });
  it("builds funnel steps and histogram labels from the server's edges", () => {
    expect(funnelSteps([{ key: "published", count: 5 }], t)).toEqual([{ key: "published", label: "Published", count: 5 }]);
    const h = fillBuckets([{ from: null, to: 900, count: 1 }, { from: 900, to: 1800, count: 2 }, { from: 86400, to: null, count: 3 }], t, "en");
    expect(h.map((b) => b.label)).toEqual(["Under 15 min", "15 min – 30 min", "24 h or more"]);
    expect(statusSeries(["completed", "cancelled"], t).map((s) => s.label)).toEqual(["Completed", "Cancelled"]);
  });
});

describe("chart formatters", () => {
  it("formats every value kind and never invents a number", () => {
    expect(formatValue(null, "money", "en")).toBe("—"); expect(formatValue(NaN, "number", "en")).toBe("—");
    expect(formatValue(12345, "money", "en")).toMatch(/SAR\s?123\.45/); expect(formatValue(0.1234, "percent", "en")).toBe("12.3%"); expect(formatValue(1234, "number", "en")).toBe("1,234");
    expect(formatValue(1234567, "number", "en", true)).toBe("1.2m"); expect(formatValue(2.345, "rate", "en")).toBe("2.3");
    expect(fmtDur(45, "en")).toBe("45 s"); expect(fmtDur(600, "en")).toBe("10 min"); expect(fmtDur(3 * 3600 + 1200, "en")).toBe("3 h 20 min"); expect(fmtDur(50 * 3600, "en")).toBe("2 d 2 h");
    expect(fmtSignedPct(0.123, "en")).toBe("+12.3%"); expect(fmtSignedPct(-0.5, "en")).toBe("−50%"); expect(fmtSignedPp(0.021, "en")).toBe("+2.1"); expect(fmtSignedPp(-0.004, "en")).toBe("−0.4");
  });
  it("formats Riyadh bucket keys without any time-zone shift, in each language", () => {
    expect(bucketLabel("2026-11-19", "day", "en")).toMatch(/19 Nov/); expect(bucketLabel("2026-11-19", "day", "en", true)).toMatch(/19 Nov 2026/);
    expect(bucketLabel("2026-11-19T00", "hour", "en")).toBe("00:00"); expect(bucketLabel("2026-11-19T23", "hour", "en", true)).toMatch(/19 Nov.*23:00/);
    expect(bucketLabel("2026-11-15", "week", "en", true)).toMatch(/15 Nov.*21 Nov 2026/); // Sunday to Saturday
    expect(bucketLabel("2026-11-01", "month", "en", true)).toMatch(/November 2026/);
    expect(bucketLabel("2026-11-19", "day", "ar")).toMatch(/19/); expect(bucketLabel("2026-11-19", "day", "ur")).toMatch(/19/);
  });
});
