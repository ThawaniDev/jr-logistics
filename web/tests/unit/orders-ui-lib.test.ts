import { describe, it, expect } from "vitest";
import { NO_PARCEL_FILTERS, ORDER_TABS, journeyFacts, journeyParams, kpiCards, lateText, orderTabHref, orderTabs, parcelFiltersActive, parcelQuery } from "@/components/features/admin-order-lib";
import { ar, en, ur } from "@/i18n/fragments/rd-detail-1";
import { MORE } from "@/i18n/fragments/rd-detail-1-b";
import { translate } from "@/i18n/core";

const t = (k: string, v?: Record<string, string | number>) => translate(en, {}, k, v);
const kpis = (over: Record<string, unknown> = {}) => ({
  slots: { filled: 1, needed: 3 }, parcels: { total: 10, delivered: 6, failed: 1, returned: 1, pending: 2, missing: 0, cancelled: 0 }, successRate: 0.75, firstAttemptRate: 0.5,
  start: { deltaMin: -12, late: 0, arrived: 1, graceMin: 30 }, timeToFirstOfferS: 90, timeToFirstAcceptS: 300, timeToFillS: null, executionS: 5400, executionRunning: true,
  rating: { avg: 4.5, count: 2 }, support: { open: 1, total: 3 }, money: null, cod: null, ...over,
});
const keys = (k: ReturnType<typeof kpis>) => kpiCards(k, "en", t).map((c) => c.key);

describe("order tabs", () => {
  const all = (p: string) => ["finance.view"].includes(p);
  it("shows money only with finance.view and parcels only for orders with a manifest", () => {
    expect(orderTabs(() => false, true)).toEqual(["overview", "drivers", "parcels", "communication", "activity"]);
    expect(orderTabs(all, true)).toEqual([...ORDER_TABS]);
    expect(orderTabs(all, false)).not.toContain("parcels");
  });
  it("links every tab to its own route", () => {
    expect(orderTabHref("abc", "overview")).toBe("/admin/requests/abc");
    expect(orderTabHref("abc", "parcels")).toBe("/admin/requests/abc/parcels");
    expect(orderTabHref("abc", "communication")).toBe("/admin/requests/abc/communication");
  });
});

describe("manifest filters", () => {
  it("drops empty values and never writes page 1", () => {
    expect(parcelQuery(NO_PARCEL_FILTERS)).toBe("");
    expect(parcelQuery({ ...NO_PARCEL_FILTERS, status: "failed", q: "  Ali ", cod: true, page: 2 })).toBe("?status=failed&q=Ali&cod=1&page=2");
    expect(parcelQuery({ ...NO_PARCEL_FILTERS, offerId: "none", incomplete: true }, { pageSize: 50 })).toBe("?offerId=none&incomplete=1&pageSize=50");
  });
  it("knows when a filter narrows the list (page alone does not)", () => {
    expect(parcelFiltersActive(NO_PARCEL_FILTERS)).toBe(false);
    expect(parcelFiltersActive({ ...NO_PARCEL_FILTERS, page: 4 })).toBe(false);
    expect(parcelFiltersActive({ ...NO_PARCEL_FILTERS, q: " " })).toBe(false);
    expect(parcelFiltersActive({ ...NO_PARCEL_FILTERS, city: "riyadh" })).toBe(true);
    expect(parcelFiltersActive({ ...NO_PARCEL_FILTERS, cod: true })).toBe(true);
  });
});

describe("KPI cards", () => {
  it("builds the delivery and timing cards from the overview payload", () => {
    expect(keys(kpis())).toEqual(["slots", "parcels", "success", "first_attempt", "start", "first_offer", "fill", "execution", "rating", "support"]);
    const c = Object.fromEntries(kpiCards(kpis(), "en", t).map((x) => [x.key, x]));
    expect(c.slots.value).toBe("1/3");
    expect(c.slots.tone).toBe("gold");
    expect(c.slots.hint).toBe("2 still open");
    expect(c.success.value).toBe("75%");
    expect(c.success.hint).toBe("6 of 8 resolved parcels");
    expect(c.start.value).toBe("12 min early");
    expect(c.start.tone).toBe("accent");
    expect(c.fill.value).toBe("—"); // slots not filled yet: no time to fill, never 0
    expect(c.execution.hint).toBe("Still running");
    expect(c.support.tone).toBe("danger");
  });
  it("shows no rate for an order without outcomes and no parcel cards for an order without a manifest", () => {
    const c = Object.fromEntries(kpiCards(kpis({ successRate: null, firstAttemptRate: null }), "en", t).map((x) => [x.key, x]));
    expect(c.success.value).toBe("—");
    expect(c.success.tone).toBe("muted");
    expect(keys(kpis({ parcels: { total: 0, delivered: 0, failed: 0, returned: 0, pending: 0 } }))).not.toContain("parcels");
  });
  it("marks a late start and an open slot problem", () => {
    const c = Object.fromEntries(kpiCards(kpis({ start: { deltaMin: 45, late: 1, arrived: 2, graceMin: 30 } }), "en", t).map((x) => [x.key, x]));
    expect(c.start.value).toBe("45 min late");
    expect(c.start.tone).toBe("danger");
    expect(c.start.hint).toBe("1 of 2 drivers late");
  });
  it("adds money and cash cards only when the payload carries them", () => {
    expect(keys(kpis())).not.toContain("price");
    expect(keys(kpis())).not.toContain("cod_due");
    const k = keys(kpis({ money: { totalCents: 3000, providerCents: 2100, marginCents: 900, reservedCents: 0 }, cod: { dueCents: 19500, collectedCents: 19500, remittedCents: 0, outstandingCents: 19500 } }));
    expect(k).toEqual(expect.arrayContaining(["price", "provider", "margin", "cod_due", "cod_collected", "cod_outstanding"]));
    const c = Object.fromEntries(kpiCards(kpis({ money: { totalCents: 3000, providerCents: 2100, marginCents: 900, reservedCents: 0 }, cod: null }), "en", t).map((x) => [x.key, x]));
    expect(c.margin.hint).toBe("30% of the price");
    // a viewer who sees the price but not provider cost / margin (pricing hidden in the snapshot) gets the price card only
    expect(keys(kpis({ money: { totalCents: 3000, providerCents: null, marginCents: null, reservedCents: 0 } }))).not.toContain("margin");
  });
});

describe("late text", () => {
  it("says on time, late or early with a readable duration", () => {
    expect(lateText(0, t, "en")).toBe("On time");
    expect(lateText(12, t, "en")).toBe("12 min late");
    expect(lateText(-180, t, "en")).toBe("3h 0m early");
    expect(lateText(null, t, "en")).toBe("—");
  });
});

describe("parcel journey wording", () => {
  const tt = (k: string, v?: Record<string, string | number>) => ({ "stopfail.refused": "Recipient refused", "shipadm.ev_distance": "{n} m from the pin", "dv1.via_scan": "Loaded by scan" }[k]?.replace(/\{(\w+)\}/g, (_m, x) => String(v?.[x])) ?? k);
  it("fills the title params from the event payload", () => {
    expect(journeyParams({ type: "failed", payload: { reason: "refused" } }, "JR-1-001", tt, "en")).toMatchObject({ code: "JR-1-001", reason: "Recipient refused" });
    expect(journeyParams({ type: "unassigned", payload: { why: "driver_unavailable", code: "X-9" } }, "JR-1-001", tt, "en")).toMatchObject({ code: "X-9", why: "driver unavailable" });
    expect(journeyParams({ type: "cod_collected", payload: { amountCents: 15000 } }, "C", tt, "en").amount).toContain("150.00");
    expect(journeyParams({ type: "arrived" }, "C", tt, "en")).toMatchObject({ reason: "—", stopOrder: "—", amount: "—" });
  });
  it("lists the short facts", () => {
    expect(journeyFacts({ type: "delivered", payload: { distanceM: 42.4, note: "left at gate", via: "scan" } }, tt, "en")).toEqual(["“left at gate”", "42 m from the pin", "Loaded by scan"]);
    expect(journeyFacts({ type: "arrived" }, tt, "en")).toEqual([]);
  });
});

describe("dv1 translations", () => {
  const ph = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(",");
  it("has the same keys and placeholders in English, Arabic and Urdu, with real translations", () => {
    const keysEn = Object.keys(en);
    expect(keysEn.length).toBeGreaterThan(300);
    for (const r of MORE) expect(en[r[0]], r[0]).toBe(r[1]); // part 2 is merged
    for (const k of keysEn) {
      expect(k.startsWith("dv1."), k).toBe(true);
      expect(ar[k]?.trim(), `ar ${k}`).toBeTruthy();
      expect(ur[k]?.trim(), `ur ${k}`).toBeTruthy();
      expect(ph(ar[k]), `ar ${k}`).toBe(ph(en[k]));
      expect(ph(ur[k]), `ur ${k}`).toBe(ph(en[k]));
    }
    expect(Object.keys(ar).sort()).toEqual(keysEn.slice().sort());
    expect(Object.keys(ur).sort()).toEqual(keysEn.slice().sort());
    for (const k of ["dv1.tab_drivers", "dv1.kpi_success", "dv1.alert_no_coords", "dv1.journey_title", "dv1.settle_title"]) { expect(ar[k]).not.toBe(en[k]); expect(ur[k]).not.toBe(en[k]); }
  });
  it("has a label and a definition for every KPI card", () => {
    for (const k of ["slots", "parcels", "success", "first_attempt", "start", "first_offer", "fill", "execution", "price", "provider", "margin", "cod_due", "cod_collected", "cod_outstanding", "rating", "support"]) {
      expect(en[`dv1.kpi_${k}`], k).toBeTruthy(); expect(en[`dv1.def_${k}`], k).toBeTruthy();
    }
  });
});
