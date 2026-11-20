/** J6: the flat "all orders" table of the company cash page — flatten, search, sort, CSV (`components/features/business-cod-lib.ts`). */
import { describe, it, expect } from "vitest";
import type { CodOverview } from "@/components/features/business-cod";
import { COD_SORT_DEFAULT, csvCell, filterOrders, flattenOrders, ordersCsv, parseSortKey, sortOrders, type CodRow } from "@/components/features/business-cod-lib";

const fig = (c: number, r: number) => ({ collectedCents: c, receivedCents: r, outstandingCents: c - r });
const data: CodOverview = {
  totals: { collectedCents: 0, receivedCents: 0, outstandingCents: 0 },
  drivers: [
    { driverId: "d1", driverName: "Khalid", phoneMasked: null, outstandingCents: 0, officeId: "o1", officeName: "Al Noor", orders: [
      { offerId: "f1", requestId: "r1", ref: "JR-10", ...fig(10000, 4000), warehouse: { label: "Olaya depot", city: "riyadh" }, officeId: "o1", officeName: "Al Noor", lastCollectedAt: "2026-11-02T10:00:00Z" },
      { offerId: "f2", requestId: "r2", ref: "JR-2", ...fig(5000, 5000), warehouse: { label: "Industrial Area", city: "jeddah" }, officeId: null, officeName: "stale", lastCollectedAt: "2026-11-03T10:00:00Z" },
    ] },
    { driverId: "d2", driverName: "Ahmed", phoneMasked: null, outstandingCents: 0, orders: [{ offerId: "f3", requestId: "r3", ref: "JR-1", ...fig(2500, 0) }] },
  ],
};

describe("flattenOrders", () => {
  it("one row per order with its driver; an independent order has no office even if a name is present; old servers give an empty warehouse", () => {
    const rows = flattenOrders(data);
    expect(rows.map((r) => [r.ref, r.driverName, r.officeId, r.officeName])).toEqual([["JR-10", "Khalid", "o1", "Al Noor"], ["JR-2", "Khalid", null, null], ["JR-1", "Ahmed", null, null]]);
    expect(rows[2].warehouse).toEqual({ label: "", city: null });
    expect(flattenOrders(undefined)).toEqual([]);
  });
});

describe("filterOrders", () => {
  const rows = flattenOrders(data);
  it("searches order, driver, warehouse, city and office; every word must match", () => {
    const f = (q: string, only = false) => filterOrders(rows, q, only, (k) => ({ riyadh: "Riyadh", jeddah: "Jeddah" })[k] ?? k).map((r) => r.ref);
    expect(f("")).toEqual(["JR-10", "JR-2", "JR-1"]);
    expect(f("ahmed")).toEqual(["JR-1"]);
    expect(f("olaya")).toEqual(["JR-10"]);
    expect(f("jeddah")).toEqual(["JR-2"]);
    expect(f("al noor")).toEqual(["JR-10"]);
    expect(f("khalid depot")).toEqual(["JR-10"]);
    expect(f("zzz")).toEqual([]);
    expect(f("  KHALID  ")).toEqual(["JR-10", "JR-2"]);
  });
  it("outstanding only drops settled orders", () => {
    expect(filterOrders(rows, "", true).map((r) => r.ref)).toEqual(["JR-10", "JR-1"]);
  });
});

describe("sortOrders", () => {
  const rows = flattenOrders(data);
  const by = (key: string, dir: "asc" | "desc") => sortOrders(rows, { key: key as never, dir }).map((r) => r.ref);
  it("sorts numbers, and text numerically (JR-2 before JR-10)", () => {
    expect(by("collected", "desc")).toEqual(["JR-10", "JR-2", "JR-1"]);
    expect(by("outstanding", "desc")).toEqual(["JR-10", "JR-1", "JR-2"]);
    expect(by("received", "asc")).toEqual(["JR-1", "JR-10", "JR-2"]);
    expect(by("ref", "asc")).toEqual(["JR-1", "JR-2", "JR-10"]);
    expect(by("driver", "asc")).toEqual(["JR-1", "JR-2", "JR-10"]); // same driver: newest collection first
    expect(by("warehouse", "asc")).toEqual(["JR-2", "JR-10", "JR-1"]); // blank warehouse last
  });
  it("independent drivers sort last in the Office column, in either direction; the input is not mutated", () => {
    expect(by("office", "asc")[0]).toBe("JR-10");
    expect(by("office", "desc")[0]).toBe("JR-10");
    expect(rows.map((r) => r.ref)).toEqual(["JR-10", "JR-2", "JR-1"]);
  });
  it("default sort is outstanding first; unknown sort keys fall back to it", () => {
    expect(COD_SORT_DEFAULT).toEqual({ key: "outstanding", dir: "desc" });
    expect(parseSortKey("office")).toBe("office");
    expect(parseSortKey("nope")).toBe("outstanding");
    expect(parseSortKey(null)).toBe("outstanding");
  });
});

describe("CSV", () => {
  it("neutralises formulas and quotes what needs it", () => {
    expect(csvCell("=1+1")).toBe("'=1+1");
    expect(csvCell("-5")).toBe("'-5");
    expect(csvCell("@x")).toBe("'@x");
    expect(csvCell('a "b", c')).toBe('"a ""b"", c"');
    expect(csvCell(null)).toBe("");
    expect(csvCell(12.5)).toBe("12.5");
  });
  it("starts with a BOM, localized headers, SAR with two decimals, and 'independent' for no office", () => {
    const head = { ref: "Order", warehouse: "Warehouse", city: "City", office: "Office", driver: "Driver", collected: "Collected", received: "Received", outstanding: "Outstanding" };
    const rows: CodRow[] = flattenOrders(data);
    const csv = ordersCsv(rows, head, "Independent", (k) => k.toUpperCase());
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    const lines = csv.slice(1).split("\n");
    expect(lines[0]).toBe("Order,Warehouse,City,Office,Driver,Collected,Received,Outstanding");
    expect(lines[1]).toBe("JR-10,Olaya depot,RIYADH,Al Noor,Khalid,100.00,40.00,60.00");
    expect(lines[2]).toBe("JR-2,Industrial Area,JEDDAH,Independent,Khalid,50.00,50.00,0.00");
    expect(lines[3]).toBe("JR-1,,,Independent,Ahmed,25.00,0.00,25.00");
    expect(ordersCsv([{ ...rows[0], driverName: "=cmd()" }], head, "Independent").split("\n")[1]).toContain("'=cmd()");
  });
});
