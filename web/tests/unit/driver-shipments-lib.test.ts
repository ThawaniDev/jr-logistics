import { describe, it, expect } from "vitest";
import {
  SHIP_FILTERS, addressText, cardDate, cashCollected, cashToCollect, codOf, countFor, filterShips, matchesFilter, matchesSearch, nextShip, paymentModeOf, piecesOf,
  routingEnabledOf, shipAccess, shipCounters, shipGroup, sortShips, statusChip, telHref, type ShipLike,
} from "@/components/features/driver-shipments-lib";

const s = (n: number, o: Partial<ShipLike> = {}): ShipLike => ({
  id: `s${n}`, seq: n, stopOrder: n, code: `JR-000012-${String(n).padStart(3, "0")}`, status: "loaded", address: `${n} Olaya St, Riyadh`, city: "riyadh", contents: null,
  recipientName: `Customer ${n}`, recipientPhone: `05500000${String(n).padStart(2, "0")}`, current: false, arrivedAt: null, deferCount: 0, codCents: 0, ...o,
});
const run = [s(1, { status: "delivered", deliveredAt: "2026-11-20T09:00:00Z", codCents: 5000 }), s(2, { status: "failed" }), s(3, { current: true, codCents: 12050 }), s(4), s(5, { status: "returned" }), s(6, { deferCount: 1 }), s(7, { status: "missing" })];

describe("groups, counters and filters", () => {
  it("maps every status to one of three groups", () => {
    expect(["pending", "loaded"].map(shipGroup)).toEqual(["todo", "todo"]);
    expect(shipGroup("delivered")).toBe("delivered");
    expect(["failed", "returned", "missing", "cancelled"].map(shipGroup)).toEqual(["failed", "failed", "failed", "failed"]);
  });
  it("counts total / to deliver / delivered / not delivered and the progress", () => {
    const c = shipCounters(run);
    expect(c).toMatchObject({ total: 7, todo: 3, delivered: 1, failed: 3, done: 4, pct: 57 });
    expect(shipCounters([])).toMatchObject({ total: 0, pct: 0 });
    expect(SHIP_FILTERS.map((f) => countFor(c, f))).toEqual([7, 3, 1, 3]);
  });
  it("filters by group and keeps the route order", () => {
    expect(filterShips(run, "all", "").map((x) => x.seq)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(filterShips(run, "todo", "").map((x) => x.seq)).toEqual([3, 4, 6]);
    expect(filterShips(run, "delivered", "").map((x) => x.seq)).toEqual([1]);
    expect(filterShips(run, "failed", "").map((x) => x.seq)).toEqual([2, 5, 7]);
    expect(matchesFilter({ status: "loaded" }, "all")).toBe(true);
  });
});

describe("order", () => {
  it("lists the unfinished parcels first and keeps the route order inside each group", () => {
    expect(sortShips(run).map((x) => x.seq)).toEqual([3, 4, 6, 1, 2, 5, 7]);
    expect(sortShips([s(2, { stopOrder: 9 }), s(1, { stopOrder: 5 })]).map((x) => x.seq)).toEqual([1, 2]);
  });
});

describe("search", () => {
  it("matches the code, manifest number, name, address, city and contents (case and spacing blind)", () => {
    expect(matchesSearch(run[2], "jr-000012-003")).toBe(true);
    expect(matchesSearch(run[2], "  CUSTOMER   3 ")).toBe(true);
    expect(matchesSearch(run[2], "olaya")).toBe(true);
    expect(matchesSearch(run[2], "RIYADH")).toBe(true);
    expect(matchesSearch(s(9, { contents: "Fragile glass" }), "glass")).toBe(true);
    expect(matchesSearch(run[2], "3")).toBe(true); // the manifest number
    expect(matchesSearch(run[2], "003")).toBe(true);
    expect(matchesSearch(run[2], "jeddah")).toBe(false);
    expect(matchesSearch(run[2], "")).toBe(true);
  });
  it("matches a phone number whatever the formatting, and ignores very short digit runs", () => {
    const p = s(1, { recipientPhone: "+966 55 000 0001" });
    expect(matchesSearch(p, "0550000001")).toBe(true); // the local form finds the +966 form
    expect(matchesSearch(p, "0550000002")).toBe(false);
    expect(matchesSearch(p, "55 000")).toBe(true);
    expect(matchesSearch(p, "966-55")).toBe(true);
    expect(matchesSearch(s(1, { recipientPhone: null }), "555")).toBe(false);
    expect(matchesSearch(s(30, { recipientPhone: "0550000099" }), "99")).toBe(false); // 2 digits are not a phone search
  });
  it("combines the filter and the search", () => {
    expect(filterShips(run, "todo", "customer 4").map((x) => x.seq)).toEqual([4]);
    expect(filterShips(run, "delivered", "customer 4")).toEqual([]);
  });
});

describe("status chip", () => {
  it("says Out for delivery (green) for a loaded stop and colours the rest by status", () => {
    expect(statusChip({ status: "loaded", deferCount: 0 })).toEqual({ key: "out", tone: "success" });
    expect(statusChip({ status: "loaded" })).toEqual({ key: "out", tone: "success" });
    expect(statusChip({ status: "loaded", deferCount: 1 })).toEqual({ key: "postponed", tone: "warn" });
    expect(statusChip({ status: "delivered" })).toEqual({ key: "delivered", tone: "success" });
    expect(statusChip({ status: "failed" })).toEqual({ key: "failed", tone: "danger" });
    expect(statusChip({ status: "returned" })).toEqual({ key: "returned", tone: "info" });
    expect(statusChip({ status: "missing" })).toEqual({ key: "missing", tone: "danger" });
    expect(statusChip({ status: "pending" })).toEqual({ key: "pending", tone: "neutral" });
    expect(statusChip({ status: "cancelled" })).toEqual({ key: "cancelled", tone: "neutral" });
  });
});

describe("payment mode, pieces, cash and date", () => {
  it("uses the server's payment mode, else derives it from the cash amount", () => {
    expect(paymentModeOf({ paymentMode: "cod", codCents: 0 })).toBe("cod");
    expect(paymentModeOf({ paymentMode: "prepaid", codCents: 500 })).toBe("prepaid");
    expect(paymentModeOf({ codCents: 12050 })).toBe("cod");
    expect(paymentModeOf({ codCents: 0 })).toBe("prepaid");
    expect(paymentModeOf({ paymentMode: "weird", codCents: null })).toBe("prepaid");
  });
  it("reads cash and pieces defensively", () => {
    expect(codOf({ codCents: 12050.7 })).toBe(12050); expect(codOf({ codCents: -5 })).toBe(0); expect(codOf({ codCents: null })).toBe(0);
    expect(piecesOf({ pieces: 3 })).toBe(3); expect(piecesOf({})).toBe(1); expect(piecesOf({ pieces: 0 })).toBe(1); expect(piecesOf({ pieces: null })).toBe(1);
  });
  it("sums the cash still to collect over the unfinished parcels only", () => {
    expect(cashToCollect(run)).toBe(12050); // the delivered 50.00 is already collected
    expect(cashToCollect([])).toBe(0);
    expect(cashCollected([{ codCollectedCents: 5000 }, { codCollectedCents: null }, { codCollectedCents: 150.9 }, {}])).toBe(5150);
  });
  it("shows the delivery time once delivered, else the creation date", () => {
    expect(cardDate({ status: "delivered", deliveredAt: "d", createdAt: "c" })).toEqual({ kind: "delivered", at: "d" });
    expect(cardDate({ status: "loaded", deliveredAt: null, createdAt: "c" })).toEqual({ kind: "created", at: "c" });
    expect(cardDate({ status: "loaded", createdAt: null })).toBeNull();
  });
});

describe("who may act (routing on / off)", () => {
  it("routing flag: an older server (no flag) keeps the original route flow", () => {
    expect(routingEnabledOf({ policy: { routingEnabled: false } })).toBe(false);
    expect(routingEnabledOf({ policy: { routingEnabled: true } })).toBe(true);
    expect(routingEnabledOf({ policy: {} })).toBe(true);
    expect(routingEnabledOf(null)).toBe(true);
  });
  it("routing off: every stop on the vehicle accepts actions, finished ones are done", () => {
    expect(run.map((x) => shipAccess(x, false))).toEqual(["done", "done", "act", "act", "done", "act", "done"]);
    expect(shipAccess({ status: "pending", current: false }, false)).toBe("locked"); // not loaded yet
  });
  it("routing on: only the current stop accepts actions, the others are locked", () => {
    expect(run.map((x) => shipAccess(x, true))).toEqual(["done", "done", "act", "locked", "done", "locked", "done"]);
  });
  it("the next stop is the one already arrived at, else the current one, else the first on the vehicle", () => {
    expect(nextShip(run, true)?.seq).toBe(3);
    expect(nextShip(run, false)?.seq).toBe(3);
    expect(nextShip([s(1, { status: "delivered" }), s(2), s(3)], false)?.seq).toBe(2);
    expect(nextShip([s(1), s(2, { arrivedAt: "2026-11-20T09:00:00Z" }), s(3)], false)?.seq).toBe(2);
    expect(nextShip([s(1), s(2)], true)).toBeNull(); // routing on but the server marks no current stop
    expect(nextShip([s(1, { status: "delivered" })], false)).toBeNull();
  });
});

describe("contact helpers", () => {
  it("builds a tel: link without punctuation and refuses numbers that are too short", () => {
    expect(telHref("+966 55 000-0001")).toBe("tel:+966550000001");
    expect(telHref("0550000001")).toBe("tel:0550000001");
    expect(telHref("12")).toBeNull(); expect(telHref(null)).toBeNull(); expect(telHref("")).toBeNull();
  });
  it("copies the address with the city", () => {
    expect(addressText({ address: "1 Olaya St", city: "riyadh" }, "Riyadh")).toBe("1 Olaya St, Riyadh");
    expect(addressText({ address: "1 Olaya St", city: null })).toBe("1 Olaya St");
  });
});
