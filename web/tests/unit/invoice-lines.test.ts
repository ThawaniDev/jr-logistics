import { describe, it, expect } from "vitest";
import { chargedSum, deriveLines, emptyParcels, normalizeTotals, parcelCounts, type LineInput } from "@/server/invoice-detail";

const base: LineInput = { service: "delivery_driver", totalCents: 11500, finalUnits: 10, expectedUnits: 10, refundCents: 0, unitPriceCents: 1150, unit: "shipment" };
const sum = (i: LineInput) => chargedSum(deriveLines(i));

describe("invoice lines: units × unit price", () => {
  it("a fully delivered job is one billed line that equals the invoice total", () => {
    const lines = deriveLines(base);
    expect(lines).toEqual([{ kind: "billed", qty: 10, unit: "shipment", unitPriceCents: 1150, amountCents: 11500 }]);
    expect(chargedSum(lines)).toBe(base.totalCents);
  });
  it("parcels that were not delivered are an informational line that charges nothing and says what went back to the wallet", () => {
    const i = { ...base, totalCents: 8050, finalUnits: 7, refundCents: 3450 };
    const lines = deriveLines(i);
    expect(lines.map((l) => l.kind)).toEqual(["billed", "released"]);
    expect(lines[0]).toMatchObject({ qty: 7, amountCents: 8050 });
    expect(lines[1]).toMatchObject({ qty: 3, unitPriceCents: 1150, amountCents: null, releasedCents: 3450 });
    expect(chargedSum(lines)).toBe(8050);
  });
  it("per-day services bill vehicle-days", () => {
    const i: LineInput = { service: "car_with_driver", totalCents: 75000, finalUnits: 3, expectedUnits: 3, refundCents: 0, unitPriceCents: 25000, unit: "vehicle_day" };
    expect(deriveLines(i)).toEqual([{ kind: "billed", qty: 3, unit: "vehicle_day", unitPriceCents: 25000, amountCents: 75000 }]);
  });
  it("a day service that ended early releases the unused days", () => {
    const i: LineInput = { service: "car_without_driver", totalCents: 50000, finalUnits: 2, expectedUnits: 5, refundCents: 75000, unitPriceCents: 25000, unit: "vehicle_day" };
    const lines = deriveLines(i);
    expect(lines[1]).toMatchObject({ kind: "released", qty: 3, unit: "vehicle_day", releasedCents: 75000 });
    expect(chargedSum(lines)).toBe(50000);
  });
  it("the unit comes from the service catalogue when the snapshot has none", () => {
    expect(deriveLines({ ...base, unit: null })[0].unit).toBe("shipment");
    expect(deriveLines({ ...base, service: "car_with_driver", unit: null })[0].unit).toBe("vehicle_day");
    expect(deriveLines({ ...base, service: "something_new", unit: null })[0].unit).toBeNull();
  });
});

describe("invoice lines reconcile with the total, always", () => {
  it("a remainder becomes a rounding line (positive or negative)", () => {
    const up = deriveLines({ ...base, totalCents: 11501 });
    expect(up.at(-1)).toMatchObject({ kind: "rounding", amountCents: 1 });
    expect(chargedSum(up)).toBe(11501);
    const down = deriveLines({ ...base, totalCents: 11495 });
    expect(down.at(-1)).toMatchObject({ kind: "rounding", amountCents: -5 });
    expect(chargedSum(down)).toBe(11495);
  });
  it("no rounding line when the arithmetic is exact", () => expect(deriveLines(base).some((l) => l.kind === "rounding")).toBe(false));
  it("without a settlement or a locked price the invoice is one service line for the whole total", () => {
    for (const i of [{ ...base, finalUnits: null, expectedUnits: null, refundCents: null }, { ...base, unitPriceCents: null }]) {
      const lines = deriveLines(i);
      expect(lines).toEqual([{ kind: "service", qty: 1, unit: null, unitPriceCents: 11500, amountCents: 11500 }]);
    }
  });
  it("zero parcels delivered: a zero line, everything released, nothing charged", () => {
    const i: LineInput = { ...base, totalCents: 0, finalUnits: 0, refundCents: 11500 };
    const lines = deriveLines(i);
    expect(lines[0]).toMatchObject({ kind: "billed", qty: 0, amountCents: 0 });
    expect(lines[1]).toMatchObject({ kind: "released", qty: 10, releasedCents: 11500 });
    expect(chargedSum(lines)).toBe(0);
  });
  it("a free price never divides by zero", () => {
    const lines = deriveLines({ ...base, totalCents: 0, unitPriceCents: 0, expectedUnits: null, refundCents: 500 });
    expect(lines[1]).toMatchObject({ kind: "released", qty: 0 });
    expect(chargedSum(lines)).toBe(0);
  });
  it("more units than were reserved is simply billed (nothing to release)", () => {
    const lines = deriveLines({ ...base, totalCents: 13800, finalUnits: 12, refundCents: -2300 });
    expect(lines.map((l) => l.kind)).toEqual(["billed"]);
    expect(chargedSum(lines)).toBe(13800);
  });
  it("holds for many combinations, including totals that do not match the units", () => {
    let seed = 7; const rnd = (n: number) => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed % n; };
    for (let k = 0; k < 400; k++) {
      const price = rnd(5) === 0 ? 0 : 1 + rnd(30000), expected = rnd(40), final = rnd(45);
      const i: LineInput = { service: "delivery_driver", totalCents: rnd(4) === 0 ? rnd(900000) : price * final, finalUnits: rnd(9) === 0 ? null : final, expectedUnits: rnd(3) === 0 ? null : expected, refundCents: rnd(3) === 0 ? null : price * (expected - final), unitPriceCents: rnd(9) === 0 ? null : price, unit: "shipment" };
      expect(sum(i), JSON.stringify(i)).toBe(i.totalCents);
    }
  });
});

describe("totals and parcel counts", () => {
  it("keeps stored totals that add up and repairs a legacy row that does not", () => {
    expect(normalizeTotals({ subtotalCents: 10000, vatCents: 1500, totalCents: 11500 })).toEqual({ subtotalCents: 10000, vatCents: 1500, totalCents: 11500 });
    expect(normalizeTotals({ subtotalCents: 9999, vatCents: 1500, totalCents: 11500 })).toEqual({ subtotalCents: 10000, vatCents: 1500, totalCents: 11500 });
  });
  it("VAT-inclusive prices: subtotal + VAT always equals the total", () => {
    for (const total of [1, 99, 1150, 8050, 11500, 123457]) {
      const vat = Math.round((total * 15) / 115);
      const t = normalizeTotals({ subtotalCents: total - vat, vatCents: vat, totalCents: total });
      expect(t.subtotalCents + t.vatCents).toBe(total);
    }
  });
  it("counts parcels by status", () => {
    expect(parcelCounts([{ status: "delivered", n: 7 }, { status: "failed", n: "2" }, { status: "returned", n: 1 }, { status: "missing", n: 1 }, { status: "cancelled", n: 1 }, { status: "pending", n: 3 }]))
      .toEqual({ total: 15, delivered: 7, failed: 2, returned: 1, missing: 1, cancelled: 1 });
    expect(parcelCounts([])).toEqual(emptyParcels());
  });
  it("chargedSum ignores informational lines", () => {
    expect(chargedSum([{ kind: "billed", qty: 1, unit: null, unitPriceCents: 5, amountCents: 5 }, { kind: "released", qty: 2, unit: null, unitPriceCents: 5, amountCents: null, releasedCents: 10 }])).toBe(5);
  });
});
