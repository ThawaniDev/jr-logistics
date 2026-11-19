import { describe, expect, it } from "vitest";
import { ACTIVE_STATUSES, LOW_BALANCE_CENTS, dayNumber, docProgress, isLive, ledgerGroups, ledgerKinds, orderFilterCount, orderFilterParams, parseOrderFilter, slotsPct, sumParcels, visibleOrderFilters, walletTone } from "@/components/features/business-views-lib";

describe("orders list filter", () => {
  it("reads ?status= and the older ?needsAction=1 links", () => {
    expect(parseOrderFilter(null)).toBe("");
    expect(parseOrderFilter("action")).toBe("action");
    expect(parseOrderFilter(null, "1")).toBe("action");
    expect(parseOrderFilter("", "1")).toBe("action");
    expect(parseOrderFilter("completed", "1")).toBe("completed"); // an explicit status wins
    expect(parseOrderFilter("active")).toBe("active");
    expect(parseOrderFilter("in_progress")).toBe("in_progress"); // a single raw status from an older link still filters
    expect(parseOrderFilter("<script>")).toBe("");
    expect(parseOrderFilter("nonsense")).toBe("");
  });
  it("maps a filter to the API query", () => {
    expect(orderFilterParams("")).toEqual({});
    expect(orderFilterParams("action")).toEqual({ needsAction: "1" });
    expect(orderFilterParams("active")).toEqual({ status: "published,filling,assigned,confirmed,in_progress" });
    expect(orderFilterParams("draft")).toEqual({ status: "draft" });
    expect(ACTIVE_STATUSES.every((s) => isLive(s))).toBe(true);
    expect(isLive("draft") || isLive("completed") || isLive("cancelled")).toBe(false);
  });
  it("counts the orders behind a filter", () => {
    const by = { draft: 2, published: 1, filling: 1, in_progress: 3, completed: 5, cancelled: 1 };
    expect(orderFilterCount("", by, 2)).toBe(13);
    expect(orderFilterCount("active", by, 2)).toBe(5);
    expect(orderFilterCount("action", by, 2)).toBe(2);
    expect(orderFilterCount("draft", by, 2)).toBe(2);
    expect(orderFilterCount("expired", by, 2)).toBe(0);
    expect(orderFilterCount("draft", undefined, undefined)).toBeUndefined();
    expect(orderFilterCount("action", undefined, 4)).toBe(4);
  });
  it("shows empty filters only when selected (so a deep link is visible and can be cleared)", () => {
    const count = (k: string) => ({ "": 4, active: 1, draft: 0, completed: 3, action: 0, cancelled: 1, expired: 0 } as Record<string, number>)[k];
    expect(visibleOrderFilters("", count)).toEqual(["", "active", "draft", "completed", "cancelled"]);
    expect(visibleOrderFilters("action", count)).toContain("action");
    expect(visibleOrderFilters("in_progress", count).at(-1)).toBe("in_progress");
  });
});

describe("wallet statement groups", () => {
  const KINDS = ["topup", "reserve", "release_reserve", "refund", "payout", "platform_fee", "withdrawal_hold", "withdrawal_paid", "withdrawal_release", "adjustment", "charge"];
  it("every ledger kind belongs to exactly one group, for companies and for earners", () => {
    for (const earner of [false, true]) {
      const groups = ledgerGroups(earner);
      for (const k of KINDS) expect(groups.filter((g) => g.kinds.includes(k)).map((g) => g.key), `${earner ? "earner" : "company"} ${k}`).toHaveLength(1);
    }
  });
  it("resolves a group to its kinds; an unknown group means no filter", () => {
    expect(ledgerKinds(false, "topups")).toEqual(["topup"]);
    expect(ledgerKinds(true, "withdrawals")).toContain("withdrawal_paid");
    expect(ledgerKinds(false, "")).toEqual([]);
    expect(ledgerKinds(false, "nope")).toEqual([]);
  });
  it("tones the available balance", () => {
    expect(walletTone(-1)).toBe("danger");
    expect(walletTone(LOW_BALANCE_CENTS - 1)).toBe("gold");
    expect(walletTone(LOW_BALANCE_CENTS)).toBe("accent");
  });
});

describe("documents progress", () => {
  const types = [{ key: "cr", required: true }, { key: "tax", required: true }, { key: "other", required: false }];
  const today = dayNumber("2026-11-19");
  it("counts approved, in review, rejected and missing required documents", () => {
    const p = docProgress(types, [{ type: "cr", status: "approved" }, { type: "tax", status: "rejected" }], today);
    expect(p).toMatchObject({ total: 2, approved: 1, rejected: 1, missing: 0, review: 0 });
    expect(docProgress(types, [], today)).toMatchObject({ total: 2, missing: 2, approved: 0 });
    expect(docProgress(types, [{ type: "cr", status: "submitted" }, { type: "tax", status: "info_requested" }], today)).toMatchObject({ review: 1, rejected: 1 });
  });
  it("uses the newest upload of a type and flags expiries (also of optional documents)", () => {
    const items = [{ type: "cr", status: "approved", expiresOn: "2026-12-01" }, { type: "cr", status: "rejected" }, { type: "tax", status: "approved", expiresOn: "2026-11-01" }, { type: "other", status: "approved", expiresOn: "2027-06-01" }];
    const p = docProgress(types, items, today);
    expect(p).toMatchObject({ approved: 2, rejected: 0, expiring: 1, expired: 1 });
    expect(dayNumber("2026-11-20") - dayNumber("2026-11-19")).toBe(1);
  });
});

describe("order progress helpers", () => {
  it("slotsPct never produces NaN or more than 100", () => {
    expect(slotsPct(1, 4)).toBe(25);
    expect(slotsPct(0, 0)).toBe(0);
    expect(slotsPct(5, 4)).toBe(100);
    expect(slotsPct(null, 3)).toBe(0);
  });
  it("sums the parcel counts of every driver", () => {
    const s = sumParcels([{ parcels: { total: 10, delivered: 6, failed: 1, pending: 2, loaded: 1 } }, { parcels: { total: 5, delivered: 5 } }, { parcels: null }, {}]);
    expect(s).toMatchObject({ total: 15, delivered: 11, failed: 1, pending: 2, loaded: 1, returned: 0, missing: 0 });
  });
});
