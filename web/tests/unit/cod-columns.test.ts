/** J6: the warehouse and office columns of the cash pages — the pure shaping (`server/cod-columns.ts`). */
import { describe, it, expect } from "vitest";
import { firstLine, officeRef, warehouseOf } from "@/server/cod-columns";

describe("warehouse of an order", () => {
  it("is the first line of the pickup address plus the pickup city", () => {
    expect(warehouseOf({ pickupAddress: "Warehouse 4, Industrial Area\nGate 2", companyName: "Acme", pickupCity: "riyadh" })).toEqual({ label: "Warehouse 4, Industrial Area", city: "riyadh" });
    expect(warehouseOf({ pickupAddress: "\n  \r\n  Olaya St  \nsecond", companyName: "Acme", pickupCity: "jeddah" }).label).toBe("Olaya St");
  });
  it("falls back to the company name when there is no address; a missing city is null", () => {
    expect(warehouseOf({ pickupAddress: null, companyName: "  Acme Foods ", pickupCity: null })).toEqual({ label: "Acme Foods", city: null });
    expect(warehouseOf({ pickupAddress: "   ", companyName: "Acme", pickupCity: "" })).toEqual({ label: "Acme", city: null });
    expect(warehouseOf({})).toEqual({ label: "", city: null });
  });
  it("clips a very long line", () => {
    const l = firstLine("x".repeat(300));
    expect(l.length).toBe(80);
    expect(l.endsWith("…")).toBe(true);
    expect(firstLine("short")).toBe("short");
    expect(firstLine(undefined)).toBe("");
  });
});

describe("office of an order", () => {
  it("is the office at the time of the job; no office id = an independent driver whatever the name says", () => {
    expect(officeRef("o1", " Al Noor ")).toEqual({ officeId: "o1", officeName: "Al Noor" });
    expect(officeRef("o1", null)).toEqual({ officeId: "o1", officeName: null });
    expect(officeRef(null, "Ghost")).toEqual({ officeId: null, officeName: null });
    expect(officeRef(undefined, undefined)).toEqual({ officeId: null, officeName: null });
  });
});
