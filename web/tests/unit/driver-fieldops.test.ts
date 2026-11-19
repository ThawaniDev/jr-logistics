import { describe, it, expect } from "vitest";
import {
  arrivalOf, policyOf, loadingOf, haversineM, geofenceState, fmtMeters, tooFarDetails, decodePolyline, legPaths, legColor, LEG_COLORS, splitPlottable,
  movableStops, isPinnedStop, reorderPayload, moveStopBy, makeNextIds, sameOrder, reconcileDraft,
  evidenceNeeds, evidenceGate, failBlock, failNeedsNote, needsOtpOf, needsSignatureOf, receiptAllowed, codDueCents, deliverIssues, deliverBody,
  normalizeScanCode, createDeduper, findStopByScan, jobStats, fitWithin, offersHidden, pickNewOffers, trimSeen, SEEN_MAX,
} from "@/components/features/driver-fieldops-utils";

// tiny encoder (the inverse of decodePolyline) so the round trip covers negatives and multi-chunk deltas
function encode(points: Array<[number, number]>, precision = 5) {
  const f = 10 ** precision; let pLat = 0; let pLng = 0; let out = "";
  const enc = (v: number) => { let n = v < 0 ? ~(v << 1) : v << 1; let s = ""; while (n >= 0x20) { s += String.fromCharCode((0x20 | (n & 0x1f)) + 63); n >>= 5; } return s + String.fromCharCode(n + 63); };
  for (const [la, ln] of points) { const a = Math.round(la * f); const b = Math.round(ln * f); out += enc(a - pLat) + enc(b - pLng); pLat = a; pLng = b; }
  return out;
}

describe("polyline decoding (E6)", () => {
  it("decodes Google's documented example (precision 5)", () => {
    const pts = decodePolyline("_p~iF~ps|U_ulLnnqC_mqNvxq`@");
    expect(pts).toEqual([[38.5, -120.2], [40.7, -120.95], [43.252, -126.453]]);
  });
  it("round-trips real Riyadh coordinates, negatives and big jumps", () => {
    const route: Array<[number, number]> = [[24.71361, 46.67534], [24.71402, 46.67611], [24.70011, 46.69999], [-33.86882, 151.20929], [24.71361, 46.67534]];
    expect(decodePolyline(encode(route))).toEqual(route);
  });
  it("supports precision 6", () => {
    const route: Array<[number, number]> = [[24.713612, 46.675341], [24.714021, 46.676119]];
    expect(decodePolyline(encode(route, 6), 6)).toEqual(route);
  });
  it("never throws on empty / null / garbage and keeps what decoded before the damage", () => {
    expect(decodePolyline(null)).toEqual([]); expect(decodePolyline("")).toEqual([]); expect(decodePolyline(undefined)).toEqual([]);
    expect(() => decodePolyline("!!!! ~~~~ \u0000")).not.toThrow();
    const good = encode([[24.7, 46.6], [24.8, 46.7]]);
    expect(decodePolyline(good.slice(0, good.length - 1)).length).toBe(1); // truncated second point is dropped, first survives
  });
  it("draws a leg as its polyline, or a dashed straight line from→to when there is only an estimate", () => {
    const legs = [
      { stopId: "a", order: 1, from: { lat: 24.7, lng: 46.6 }, to: { lat: 24.71, lng: 46.61 }, polyline: encode([[24.7, 46.6], [24.705, 46.605], [24.71, 46.61]]), distanceM: 1, durationS: 1 },
      { stopId: "b", order: 2, from: { lat: 24.71, lng: 46.61 }, to: { lat: 24.72, lng: 46.62 }, polyline: null, distanceM: 1, durationS: 1 },
      { stopId: "c", order: 3, from: null, to: { lat: 24.73, lng: 46.63 }, polyline: null, distanceM: 1, durationS: 1 },
    ];
    const paths = legPaths(legs);
    expect(paths.map((p) => p.stopId)).toEqual(["a", "b"]); // c has nothing to draw
    expect(paths[0]).toMatchObject({ dashed: false }); expect(paths[0].path).toHaveLength(3);
    expect(paths[1]).toMatchObject({ dashed: true, path: [[24.71, 46.61], [24.72, 46.62]] });
    expect(paths[0].color).not.toBe(paths[1].color);
    expect(legPaths(null)).toEqual([]);
    expect(legColor(LEG_COLORS.length)).toBe(LEG_COLORS[0]); expect(legColor(-1)).toBe(LEG_COLORS[LEG_COLORS.length - 1]);
  });
  it("splits stops with and without coordinates", () => {
    const r = splitPlottable([{ id: "1", lat: 24.7, lng: 46.6 }, { id: "2", lat: null, lng: null }, { id: "3", lat: 24.7, lng: null }]);
    expect(r.plotted.map((s) => s.id)).toEqual(["1"]); expect(r.unplotted.map((s) => s.id)).toEqual(["2", "3"]);
  });
});

describe("geofence (E1)", () => {
  const wh = { lat: 24.7136, lng: 46.6753 };
  const north = (m: number) => ({ lat: wh.lat + m / 111_195, lng: wh.lng });
  it("haversine: ~1 km for 0.01° of longitude at Riyadh, zero for the same point", () => {
    expect(haversineM(wh, wh)).toBe(0);
    const d = haversineM(wh, { lat: wh.lat, lng: wh.lng + 0.01 });
    expect(d).toBeGreaterThan(1000); expect(d).toBeLessThan(1020);
    expect(haversineM(wh, north(500))).toBeGreaterThan(495); expect(haversineM(wh, north(500))).toBeLessThan(505);
  });
  it("340 m away with a 200 m radius is outside; 150 m is inside; no fix = unknown", () => {
    const arrival = { geofence: true, radiusM: 200, warehouse: wh };
    expect(geofenceState(arrival, north(340))).toMatchObject({ enforced: true, within: false, radiusM: 200 });
    const far = geofenceState(arrival, north(340)); expect(far.distanceM).toBeGreaterThan(335); expect(far.distanceM).toBeLessThan(345);
    expect(geofenceState(arrival, north(150)).within).toBe(true);
    expect(geofenceState(arrival, null)).toMatchObject({ enforced: true, distanceM: null, within: null });
  });
  it("is not enforced when the geofence is off or the warehouse pin is unknown", () => {
    expect(geofenceState({ geofence: false, radiusM: 200, warehouse: wh }, north(5000))).toMatchObject({ enforced: false, within: null });
    expect(geofenceState({ geofence: true, radiusM: 200, warehouse: null }, north(5000))).toMatchObject({ enforced: false, distanceM: null });
  });
  it("formats metres and kilometres in all three languages (Latin digits)", () => {
    expect(fmtMeters(340, "en")).toBe("340 m"); expect(fmtMeters(340, "ar")).toContain("340"); expect(fmtMeters(340, "ar")).toContain("م"); expect(fmtMeters(340, "ur")).toContain("میٹر");
    expect(fmtMeters(1200, "en")).toBe("1.2 km");
  });
  it("reads TOO_FAR_FROM_WAREHOUSE details, and nothing when the server sent none", () => {
    expect(tooFarDetails({ distanceM: 340.4, radiusM: 200 })).toEqual({ distanceM: 340, radiusM: 200 });
    expect(tooFarDetails({})).toBeNull(); expect(tooFarDetails(undefined)).toBeNull();
  });
  it("tolerates a job view without the new blocks", () => {
    expect(arrivalOf({})).toEqual({ geofence: false, radiusM: 200, warehouse: null });
    expect(arrivalOf({ arrival: { geofence: true, radiusM: 350, warehouse: { lat: 1, lng: 2 } } })).toEqual({ geofence: true, radiusM: 350, warehouse: { lat: 1, lng: 2 } });
    expect(arrivalOf({ arrival: { geofence: true, radiusM: 200, warehouse: { lat: "x" } } }).warehouse).toBeNull();
    expect(policyOf(null)).toEqual({ canReorderRoute: false, rescheduleEvidenceText: false, rescheduleEvidencePhoto: false, stopWaitMin: 0, failStrict: false });
    expect(policyOf({ policy: { canReorderRoute: true, stopWaitMin: 5, failStrict: true } })).toMatchObject({ canReorderRoute: true, stopWaitMin: 5, failStrict: true });
    expect(loadingOf({ loading: { mode: "driver_scan", assigned: 30, scanned: 12, finished: false } })).toEqual({ mode: "driver_scan", assigned: 30, scanned: 12, finished: false });
    expect(loadingOf({}).mode).toBe("warehouse");
  });
});

describe("manual route order (E5)", () => {
  const s = (id: string, o: Partial<{ status: string; arrivedAt: string | null; stopOrder: number; seq: number }> = {}) => ({ id, status: "loaded", arrivedAt: null, stopOrder: Number(id.slice(1)), seq: Number(id.slice(1)), ...o });
  const list = [s("s1", { status: "delivered" }), s("s2", { status: "failed" }), s("s3", { arrivedAt: "2026-11-19T10:00:00Z" }), s("s4"), s("s5"), s("s6")];
  it("the order payload holds exactly the unresolved, not-pinned stops in route order", () => {
    expect(movableStops(list).map((x) => x.id)).toEqual(["s4", "s5", "s6"]);
    expect(isPinnedStop(list[2])).toBe(true); expect(isPinnedStop(list[3])).toBe(false); expect(isPinnedStop(list[0])).toBe(false);
    expect(reorderPayload(["s6", "s4", "s5"])).toEqual({ order: ["s6", "s4", "s5"] });
  });
  it("a current stop the driver has NOT arrived at is movable (it is part of the order)", () => {
    expect(movableStops([s("s1", { status: "delivered" }), s("s2"), s("s3")]).map((x) => x.id)).toEqual(["s2", "s3"]);
  });
  it("sorts by stopOrder then seq even when the server sends them shuffled", () => {
    expect(movableStops([s("s9", { stopOrder: 1, seq: 9 }), s("s2", { stopOrder: 1, seq: 2 }), s("s3", { stopOrder: 0, seq: 3 })]).map((x) => x.id)).toEqual(["s3", "s2", "s9"]);
  });
  it("moves a stop up / down, never past the ends, without mutating the input", () => {
    const ids = ["a", "b", "c"];
    expect(moveStopBy(ids, "b", -1)).toEqual(["b", "a", "c"]); expect(moveStopBy(ids, "b", 1)).toEqual(["a", "c", "b"]);
    expect(moveStopBy(ids, "a", -1)).toBe(ids); expect(moveStopBy(ids, "c", 1)).toBe(ids); expect(moveStopBy(ids, "zzz", 1)).toBe(ids);
    expect(ids).toEqual(["a", "b", "c"]);
  });
  it("make next puts the stop first and keeps the rest in order", () => {
    expect(makeNextIds(["a", "b", "c", "d"], "c")).toEqual(["c", "a", "b", "d"]); expect(makeNextIds(["a", "b"], "x")).toEqual(["a", "b"]);
    expect(sameOrder(["a", "b"], ["a", "b"])).toBe(true); expect(sameOrder(["a", "b"], ["b", "a"])).toBe(false); expect(sameOrder(["a"], ["a", "b"])).toBe(false);
  });
  it("a draft survives a refresh: vanished stops drop out, new ones go last", () => {
    expect(reconcileDraft(["c", "a", "b"], ["a", "b", "d"])).toEqual(["a", "b", "d"]); // c vanished, d is new
    expect(reconcileDraft(["b", "d", "a"], ["a", "b", "d"])).toEqual(["b", "d", "a"]); // the driver's order wins
    expect(reconcileDraft(["b", "a"], ["a", "b"])).toEqual(["b", "a"]);
  });
});

describe("evidence gating (E7, E14)", () => {
  it("asks for what the policy asks for, plus whatever the server says is missing", () => {
    expect(evidenceNeeds({ rescheduleEvidenceText: true, rescheduleEvidencePhoto: true })).toEqual({ note: true, photo: true });
    expect(evidenceNeeds({ rescheduleEvidenceText: false, rescheduleEvidencePhoto: false })).toEqual({ note: false, photo: false });
    expect(evidenceNeeds({ rescheduleEvidenceText: false, rescheduleEvidencePhoto: false }, { note: true, photo: false })).toEqual({ note: true, photo: false });
  });
  it("blocks until the required note (≥ 3 chars) and photo are there", () => {
    const needs = { note: true, photo: true };
    expect(evidenceGate(needs, { note: "", hasPhoto: false })).toEqual({ ok: false, missingNote: true, missingPhoto: true });
    expect(evidenceGate(needs, { note: "  ab ", hasPhoto: true })).toMatchObject({ ok: false, missingNote: true, missingPhoto: false });
    expect(evidenceGate(needs, { note: "closed", hasPhoto: false })).toMatchObject({ ok: false, missingPhoto: true });
    expect(evidenceGate(needs, { note: "closed", hasPhoto: true }).ok).toBe(true);
    expect(evidenceGate({ note: false, photo: false }, { note: "", hasPhoto: false }).ok).toBe(true);
    expect(evidenceGate({ note: false, photo: true }, { note: "", hasPhoto: true }).ok).toBe(true);
  });
  it("can't-deliver: every reason is selectable at any time unless the platform is strict; the wait exists only with a door timer", () => {
    const lenient = { strict: false, arrived: false, waitMin: 0, remainingSec: 0 };
    for (const r of ["unreachable", "refused", "closed", "no_otp", "damaged", "gate_access", "wrong_address", "out_of_zone", "other"]) expect(failBlock(r, lenient)).toBeNull();
    const strict = { strict: true, arrived: false, waitMin: 0, remainingSec: 0 };
    expect(failBlock("refused", strict)).toBe("arrival"); expect(failBlock("out_of_zone", strict)).toBeNull(); expect(failBlock("unreachable", strict)).toBe("arrival");
    expect(failBlock("unreachable", { ...strict, arrived: true, remainingSec: 90 })).toBe("wait"); expect(failBlock("unreachable", { ...strict, arrived: true })).toBeNull();
    expect(failBlock("unreachable", { strict: false, arrived: true, waitMin: 5, remainingSec: 120 })).toBe("wait"); // door timer on
    expect(failBlock("unreachable", { strict: false, arrived: true, waitMin: 0, remainingSec: 120 })).toBeNull(); // timer removed: a stale countdown never blocks
    expect(failBlock("refused", { strict: false, arrived: false, waitMin: 5, remainingSec: 0 })).toBeNull();
  });
  it("a note is mandatory only under the strict rules (or when the server asked for one)", () => {
    expect(failNeedsNote("other", false)).toBe(false); expect(failNeedsNote("other", true)).toBe(true); expect(failNeedsNote("refused", true)).toBe(false); expect(failNeedsNote("refused", false, true)).toBe(true);
  });
});

describe("delivery proof, signature and cash (E9, E10, E17)", () => {
  const base = { code: "JR-1", otp: "", mode: "code" as const, receiverName: "", hasReceiptPhoto: false, cashConfirmed: false, hasSignature: false };
  it("with the delivery code switched off nothing but the parcel code is needed, and no OTP is sent", () => {
    const stop = { proofMode: "scan", needsOtp: false };
    expect(needsOtpOf(stop)).toBe(false); expect(deliverIssues(stop, base)).toEqual([]);
    expect(deliverBody(stop, { ...base, otp: "1234" })).toEqual({ code: "JR-1" });
    expect(deliverIssues(stop, { ...base, code: "  " })).toEqual(["code"]);
  });
  it("an older server (no needsOtp) still means 'code required' unless proofMode is scan", () => {
    expect(needsOtpOf({ proofMode: "code" })).toBe(true); expect(needsOtpOf({})).toBe(true); expect(needsOtpOf({ proofMode: "scan" })).toBe(false); expect(needsOtpOf({ needsOtp: true, proofMode: "scan" })).toBe(true);
  });
  it("code mode needs a 4-digit OTP; the business receipt alternative needs a photo and a receiver name", () => {
    const stop = { proofMode: "code_or_receipt", needsOtp: true };
    expect(receiptAllowed(stop)).toBe(true); expect(receiptAllowed({ proofMode: "code", needsOtp: true })).toBe(false); expect(receiptAllowed({ proofMode: "code_or_receipt", needsOtp: false })).toBe(false);
    expect(deliverIssues(stop, base)).toEqual(["otp"]); expect(deliverIssues(stop, { ...base, otp: "12a4" })).toEqual(["otp"]); expect(deliverIssues(stop, { ...base, otp: "1234" })).toEqual([]);
    expect(deliverIssues(stop, { ...base, mode: "receipt" })).toEqual(["photo", "name"]);
    expect(deliverIssues(stop, { ...base, mode: "receipt", hasReceiptPhoto: true, receiverName: "Sara" })).toEqual([]);
    expect(deliverBody(stop, { ...base, mode: "receipt", hasReceiptPhoto: true, receiverName: " Sara " })).toEqual({ code: "JR-1", proof: "receipt", receiverName: "Sara" });
    expect(deliverBody(stop, { ...base, otp: "1234" })).toEqual({ code: "JR-1", otp: "1234" });
  });
  it("a signature is required when the warehouse asks for it, and travels as signatureMediaId", () => {
    const stop = { proofMode: "scan", needsOtp: false, needsSignature: true };
    expect(needsSignatureOf(stop)).toBe(true); expect(deliverIssues(stop, base)).toEqual(["signature"]);
    expect(deliverIssues(stop, { ...base, hasSignature: true })).toEqual([]);
    expect(deliverBody(stop, { ...base, hasSignature: true }, "media-1")).toEqual({ code: "JR-1", signatureMediaId: "media-1" });
    expect(deliverBody({ needsSignature: false, needsOtp: false }, base, "media-1")).toEqual({ code: "JR-1" });
  });
  it("cash on delivery: the confirmation is required and the amount sent is always exactly what is due", () => {
    const stop = { proofMode: "scan", needsOtp: false, codCents: 25_000 };
    expect(codDueCents(stop)).toBe(25_000); expect(codDueCents({ codCents: 0 })).toBe(0); expect(codDueCents({ codCents: null })).toBe(0); expect(codDueCents({ codCents: -5 })).toBe(0);
    expect(deliverIssues(stop, base)).toEqual(["cash"]); expect(deliverIssues(stop, { ...base, cashConfirmed: true })).toEqual([]);
    expect(deliverBody(stop, { ...base, cashConfirmed: true })).toEqual({ code: "JR-1", cashCollectedCents: 25_000 });
    expect(deliverBody({ proofMode: "scan", needsOtp: false, codCents: 0 }, base)).not.toHaveProperty("cashCollectedCents");
  });
  it("reports every problem at once", () => {
    expect(deliverIssues({ needsOtp: true, needsSignature: true, codCents: 100 }, { ...base, code: "" })).toEqual(["code", "otp", "signature", "cash"]);
  });
});

describe("scan codes (E3, E4)", () => {
  it("normalises like the server: trim, no inner spaces, upper-case", () => {
    expect(normalizeScanCode("  jr-ab12 007 ")).toBe("JR-AB12007"); expect(normalizeScanCode("007")).toBe("007"); expect(normalizeScanCode(null)).toBe(""); expect(normalizeScanCode(undefined)).toBe("");
  });
  it("drops control characters scanners inject (GS, CR/LF, tabs, zero-width, BOM)", () => {
    expect(normalizeScanCode("JR-1\u001d\r\n")).toBe("JR-1"); expect(normalizeScanCode("﻿JR-​1")).toBe("JR-1"); expect(normalizeScanCode("JR\t1")).toBe("JR1");
  });
  it("understands a QR code that holds a tracking link", () => {
    expect(normalizeScanCode("https://jr.example/track/jr-9k2x?p=1234")).toBe("JR-9K2X");
    expect(normalizeScanCode("https://jr.example/t?code=jr-77")).toBe("JR-77");
    expect(normalizeScanCode("https://[broken")).toBe("HTTPS://[BROKEN");
  });
  it("collapses repeated reads of the same label inside the window, but not a different label or a later read", () => {
    const d = createDeduper(2000);
    expect(d.accept("A", 0)).toBe(true); expect(d.accept("A", 500)).toBe(false); expect(d.accept("B", 600)).toBe(true); expect(d.accept("A", 1999)).toBe(false); expect(d.accept("A", 2600)).toBe(true);
    expect(d.accept("", 5000)).toBe(false);
    d.reset(); expect(d.accept("A", 2700)).toBe(true);
  });
  it("jump-to-parcel finds a stop by code, order reference or manifest number", () => {
    const stops = [{ code: "JR-AAA-001", seq: 1, externalRef: "ORD-77" }, { code: "JR-AAA-002", seq: 2, externalRef: null }, { code: "JR-AAA-012", seq: 12 }];
    expect(findStopByScan(stops, "jr-aaa-002")?.seq).toBe(2); expect(findStopByScan(stops, " ord-77 ")?.seq).toBe(1); expect(findStopByScan(stops, "12")?.seq).toBe(12); expect(findStopByScan(stops, "012")?.seq).toBe(12);
    expect(findStopByScan(stops, "nope")).toBeNull(); expect(findStopByScan(stops, "")).toBeNull(); expect(findStopByScan(stops, "99")).toBeNull();
  });
});

describe("stat cards (E13)", () => {
  const sum = { total: 30, pending: 0, loaded: 18, delivered: 8, failed: 2, returned: 1, missing: 1 };
  it("shipments · to deliver (loaded) · delivered · not delivered (failed + returned + missing)", () => {
    expect(jobStats(sum)).toEqual({ total: 30, toDeliver: 18, delivered: 8, notDelivered: 4, cod: null });
    expect(jobStats(null)).toBeNull();
  });
  it("shows cash cards only when some parcel carries cash", () => {
    expect(jobStats(sum, { toCollectCents: 123_000, collectedCents: 40_000, parcels: 5 })?.cod).toEqual({ toCollectCents: 123_000, collectedCents: 40_000, parcels: 5 });
    expect(jobStats(sum, { toCollectCents: 0, collectedCents: 0, parcels: 0 })?.cod).toBeNull(); expect(jobStats(sum, undefined)?.cod).toBeNull();
    expect(jobStats(sum, { toCollectCents: 0, collectedCents: 500, parcels: 0 })?.cod).toEqual({ toCollectCents: 0, collectedCents: 500, parcels: 0 });
    expect(jobStats(sum, { toCollectCents: -5 as number, collectedCents: Number.NaN, parcels: 1 })?.cod).toEqual({ toCollectCents: 0, collectedCents: 0, parcels: 1 });
  });
});

describe("photos, offers hidden, new-offer alerts", () => {
  it("downscale target: never enlarged, longest side ≤ 1600, aspect kept", () => {
    expect(fitWithin(4000, 3000)).toEqual({ width: 1600, height: 1200, scale: 0.4 }); expect(fitWithin(3000, 4000)).toMatchObject({ width: 1200, height: 1600 });
    expect(fitWithin(800, 600)).toEqual({ width: 800, height: 600, scale: 1 }); expect(fitWithin(0, 0)).toMatchObject({ width: 1, height: 1 });
  });
  it("reads {items, hidden, activeJob}", () => {
    const active = { offerId: "o1", requestId: "r1", ref: "JR-1", status: "accepted" };
    expect(offersHidden({ hidden: true, activeJob: active })).toEqual({ hidden: true, activeJob: active });
    expect(offersHidden({ hidden: false, activeJob: null })).toEqual({ hidden: false, activeJob: null });
    expect(offersHidden(undefined)).toEqual({ hidden: false, activeJob: null }); expect(offersHidden({ hidden: "yes" })).toEqual({ hidden: false, activeJob: null });
  });
  it("alerts only for unseen, recent offer_new notifications; everything unseen is marked as seen", () => {
    const now = Date.parse("2026-11-19T12:00:00Z");
    const items = [
      { id: "n1", type: "offer_new", createdAt: "2026-11-19T11:59:00Z" }, { id: "n2", type: "offer_new", createdAt: "2026-11-19T09:00:00Z" },
      { id: "n3", type: "chat_message", createdAt: "2026-11-19T11:59:30Z" }, { id: "n4", type: "offer_new", createdAt: "2026-11-19T11:58:00Z" },
    ];
    const r = pickNewOffers(items, new Set(["n4"]), now);
    expect(r.alert.map((n) => n.id)).toEqual(["n1"]); expect(r.mark).toEqual(["n1", "n2"]);
    expect(pickNewOffers(items, new Set(["n1", "n2", "n4"]), now)).toEqual({ alert: [], mark: [] });
    expect(pickNewOffers(null, new Set(), now)).toEqual({ alert: [], mark: [] });
    expect(pickNewOffers([{ id: "x", type: "offer_new" }], new Set(), now).alert).toHaveLength(1); // no timestamp = treat as fresh
  });
  it("keeps the seen list bounded (newest ids win)", () => {
    const ids = Array.from({ length: SEEN_MAX + 25 }, (_, i) => `n${i}`);
    const t = trimSeen(ids); expect(t).toHaveLength(SEEN_MAX); expect(t[t.length - 1]).toBe(`n${SEEN_MAX + 24}`); expect(trimSeen(["a"])).toEqual(["a"]);
  });
});
