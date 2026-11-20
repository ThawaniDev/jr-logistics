import { describe, it, expect } from "vitest";
import { translate } from "@/i18n/core";
import * as rpo from "@/i18n/fragments/rd-reports-o";
import * as rpf from "@/i18n/fragments/rd-reports-f";
import { OPS_GROUPS, OPS_HEADLINE, OPS_KPI_GROUPS } from "@/server/analytics/ops-kinds";
import { makeKpi } from "@/server/analytics/kpi";
import "@/server/analytics/ops-defs";
import { demandPoints, dimKey, durationBuckets, execPoints, kindSlices, kpisOf, lateBuckets, leadBuckets, outcomeSlices, partySlices, pickKpis, reasonLabel, reasonRows, sectionFailed, SECTION_QUERIES, stageSlices } from "@/components/reports/ops/ops-lib";
import { citySeriesDefs, crossSlices, failureRows, MIN_RESOLVED, parcelSlices, zoneBarRows } from "@/components/reports/ops/geo-lib";
import { blankCity, zonesOf } from "@/server/analytics/geo-lib";

const base = { ...rpf.en, ...rpo.en, "city.riyadh": "Riyadh", "city.jeddah": "Jeddah", "svc.delivery_driver": "Delivery driver", "vehicle.van": "Van" };
const t = (k: string, v?: Record<string, string | number>) => translate(base, base, k, v);
const tAr = (k: string, v?: Record<string, string | number>) => translate({ ...rpf.ar, ...rpo.ar }, base, k, v);

describe("ops page mapping", () => {
  it("groups the KPIs per section, in order, without repeating the headline cards", () => {
    const all = Object.values(OPS_KPI_GROUPS).flat().map((k) => makeKpi(k, 1, 1));
    for (const g of OPS_GROUPS) {
      const keys = kpisOf(all, g).map((k) => k.key);
      expect(keys).toEqual((OPS_KPI_GROUPS[g] as readonly string[]).filter((k) => !(OPS_HEADLINE as readonly string[]).includes(k)));
      expect(keys.some((k) => (OPS_HEADLINE as readonly string[]).includes(k))).toBe(false);
    }
    expect(pickKpis(all, OPS_HEADLINE).map((k) => k.key)).toEqual([...OPS_HEADLINE]);
    expect(kpisOf([], "demand")).toEqual([]); // a section whose facts failed has no KPIs, not zeros
  });
  it("knows which sections lost a query", () => {
    expect(sectionFailed(undefined, "demand")).toBe(false); expect(sectionFailed([], "demand")).toBe(false);
    expect(sectionFailed(["speed"], "demand")).toBe(true); expect(sectionFailed(["speed"], "execution")).toBe(false);
    expect(sectionFailed(["cancelRankings"], "cancellations")).toBe(true); expect(sectionFailed(["drivers"], "groups")).toBe(true);
    expect(Object.keys(SECTION_QUERIES).sort()).toEqual([...OPS_GROUPS, "groups"].sort());
  });
  it("adds the fill rate and on-time rate lines, with gaps (null) where nothing was asked or due", () => {
    const pt = (t: string, o: Record<string, number>) => ({ t, created: 0, published: 0, completed: 0, active: 0, cancelled: 0, expired: 0, slots: 0, filled: 0, ...o });
    const d = demandPoints({ points: [pt("2026-11-01", { created: 4, slots: 10, filled: 7 }), pt("2026-11-02", {})], prev: [pt("2026-10-01", { slots: 4, filled: 4 })] });
    expect(d.data.map((p) => p.fill_rate)).toEqual([0.7, null]); expect(d.prev![0].fill_rate).toBe(1);
    expect(demandPoints({ points: [], prev: null }).prev).toBeNull();
    const e = execPoints({ points: [{ t: "a", due: 10, on_time: 7, no_show: 1 }, { t: "b", due: 0, on_time: 0, no_show: 0 }], prev: null });
    expect(e.data.map((p) => [p.late, p.on_time_rate])).toEqual([[2, 0.7], [0, null]]);
  });
  it("labels the duration histograms in the viewer's language", () => {
    const h = [{ from: null, to: 60, count: 1 }, { from: 60, to: 300, count: 2 }, { from: 7200, to: null, count: 3 }];
    expect(durationBuckets(h, t, "en").map((b) => b.label)).toEqual(["Under 1 min", "1 min – 5 min", "2 h or more"]);
    const late = lateBuckets([{ from: null, to: 1, count: 5 }, { from: 1, to: 300, count: 2 }, { from: 300, to: 900, count: 1 }, { from: 7200, to: null, count: 1 }], t, "en");
    expect(late.map((b) => b.label)).toEqual(["On or before the start", "Under 5 min", "5 min – 15 min", "2 h or more"]); expect(late.map((b) => b.count)).toEqual([5, 2, 1, 1]);
    const lead = leadBuckets([{ from: null, to: 0, count: 1 }, { from: 0, to: 3600, count: 2 }, { from: 259_200, to: null, count: 4 }], t, "en");
    expect(lead.map((b) => b.label)).toEqual(["After the start time", "Under 1 h", "3 d or more"]);
    expect(lateBuckets([{ from: null, to: 1, count: 5 }], tAr, "ar")[0].label).toBe(rpo.ar["rpo.late_none"]);
  });
  it("names outcomes, parties, stages and kinds, keeping zero slices so the legend is stable", () => {
    const o = outcomeSlices([{ key: "completed", count: 4 }, { key: "rejected", count: 2 }], t);
    expect(o).toHaveLength(8); expect(o[0]).toMatchObject({ key: "completed", label: "Work delivered", value: 4 }); expect(o.find((s) => s.key === "no_show")).toMatchObject({ value: 0, label: "No-show" });
    expect(new Set(o.map((s) => s.color)).size).toBe(8); // every outcome has its own colour
    expect(partySlices([{ key: "business", count: 3 }, { key: "platform", count: 1 }], t).map((s) => [s.label, s.value])).toEqual([["Business", 3], ["Platform", 1]]);
    expect(stageSlices([{ key: "before_accept", count: 1 }, { key: "mid_route", count: 2 }], t).map((s) => s.label)).toEqual(["Before any driver accepted", "While on the route"]);
    expect(kindSlices([{ key: "no_show", count: 2 }], t)[0].label).toBe("Driver no-show");
  });
  it("shows a reason code as a sentence, free text as typed, and a missing reason as such", () => {
    expect(reasonLabel("not_fully_staffed", t)).toBe("Not enough drivers were found"); expect(reasonLabel("", t)).toBe("No reason given"); expect(reasonLabel("Customer changed plans", t)).toBe("Customer changed plans");
    expect(reasonRows([{ reason: "", count: 3 }, { reason: "x", count: 1 }], t).map((r) => [r.label, r.value])).toEqual([["No reason given", 3], ["x", 1]]);
    expect(new Set(reasonRows([{ reason: "a", count: 1 }, { reason: "a ", count: 1 }], t).map((r) => r.key)).size).toBe(2); // stable, unique keys
  });
  it("labels dimension values with the dictionary, a custom city name, or 'Not specified'", () => {
    expect(dimKey("city", "riyadh", t)).toBe("Riyadh"); expect(dimKey("service", "delivery_driver", t)).toBe("Delivery driver"); expect(dimKey("vehicle", "van", t)).toBe("Van");
    expect(dimKey("vehicle", "", t)).toBe("Not specified"); expect(dimKey("city", "neom", t)).toBe("neom"); expect(dimKey("city", "neom", t, (k) => (k === "neom" ? "NEOM" : undefined))).toBe("NEOM");
  });
});

describe("geography mapping", () => {
  it("builds one series per busiest city plus 'other', each with its own colour", () => {
    const d = citySeriesDefs(["riyadh", "jeddah"], t);
    expect(d.map((x) => x.key)).toEqual(["c0", "c1", "other"]); expect(d.map((x) => x.label)).toEqual(["Riyadh", "Jeddah", "Other cities"]); expect(new Set(d.map((x) => x.color)).size).toBe(3);
    expect(citySeriesDefs([], t).map((x) => x.key)).toEqual(["other"]);
  });
  it("ranks cities by failure rate only when enough parcels were resolved", () => {
    const c = (key: string, delivered: number, failed: number, returned = 0) => ({ ...blankCity(key), delivered, failed, returned, failureRate: delivered + failed + returned ? (failed + returned) / (delivered + failed + returned) : null, parcels: delivered + failed + returned });
    const rows = failureRows([c("riyadh", 90, 10), c("jeddah", 8, 2), c("dammam", MIN_RESOLVED - 1, 0), c("tabuk", 2, 3, 1)], t);
    expect(rows.map((r) => r.key)).toEqual(["tabuk", "jeddah", "riyadh"]); expect(rows[0].value).toBeCloseTo(4 / 6, 6); expect(rows[1].sub).toBe("2 of 10 parcels");
    expect(failureRows([], t)).toEqual([]);
  });
  it("splits requests into same-city and between-city, and lists parcels by city", () => {
    expect(crossSlices([{ requests: 6, crossCity: false }, { requests: 2, crossCity: true }, { requests: 1, crossCity: true }], t).map((s) => s.value)).toEqual([6, 3]);
    expect(parcelSlices([{ ...blankCity("riyadh"), parcels: 5 }, { ...blankCity("jeddah"), parcels: 0 }], t).map((s) => s.key)).toEqual(["riyadh"]);
  });
  it("lists the busiest zones with their city and share, coordinates isolated from right-to-left text", () => {
    const rows = zoneBarRows(zonesOf([{ gy: 494, gx: 933, parcels: 8, delivered: 5, failed: 1, city: "riyadh" }, { gy: 1, gx: 2, parcels: 2, delivered: 0, failed: 0, city: null }]), t);
    expect(rows[0]).toMatchObject({ value: 8, share: 0.8, sub: "Riyadh" }); expect(rows[0].label).toBe("…24.725, 46.675⁩".replace("…", "⁦")); expect(rows[1].sub).toBeUndefined();
  });
});
