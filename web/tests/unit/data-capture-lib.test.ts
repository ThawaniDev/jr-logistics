import { describe, it, expect } from "vitest";
import { hostOf, jsonSafe, loginFailureReason, maskPhone, milestonesFor } from "@/server/data-capture";
import { JOB_TO_PARCEL, MIRRORED_JOB_EVENTS, SHIPMENT_EVENT_TYPES, batchOf, parcelRowsFromJobEvent } from "@/server/shipment-events";
import { DAILY_KEYS, DAY_MS, HOURLY_KEYS, RETENTION_DAYS, foldByCity, hourStart, riyadhDayStart, zeroFill } from "@/server/snapshots";
import { err } from "@/lib/errors";

describe("capture helpers", () => {
  it("masks phones to the last four digits and webhook URLs to their host", () => {
    expect(maskPhone("+966501234567")).toBe("••••4567"); expect(maskPhone("0501234567")).toBe("••••4567"); expect(maskPhone("12")).toBe("••••"); expect(maskPhone(null)).toBeNull(); expect(maskPhone("")).toBeNull();
    expect(hostOf("https://hooks.example.com:8443/a/b?token=x")).toBe("hooks.example.com:8443"); expect(hostOf("not a url")).toBeNull(); expect(hostOf(null)).toBeNull();
  });
  it("scrubs NUL characters and caps oversized payloads", () => {
    expect(jsonSafe({ a: "x\u0000y" })).toEqual({ a: "xy" }); expect(jsonSafe(null)).toBeNull(); expect(jsonSafe(5)).toBe(5);
    const big = jsonSafe({ a: "z".repeat(10_000) }, 100) as unknown as { truncated: boolean; preview: string };
    expect(big.truncated).toBe(true); expect(big.preview.length).toBe(100);
  });
  it("maps sign-in errors to a stored failure reason", () => {
    expect(loginFailureReason(err("VALIDATION", "Invalid or expired code"))).toBe("invalid_code");
    expect(loginFailureReason(err("RATE_LIMITED", "Account temporarily locked"))).toBe("locked");
    expect(loginFailureReason(err("RATE_LIMITED", "Too many requests"))).toBe("rate_limited");
    expect(loginFailureReason(err("FORBIDDEN", "Account suspended"))).toBe("suspended");
    expect(loginFailureReason(err("FORBIDDEN", "Use the staff login"))).toBe("wrong_portal");
    expect(loginFailureReason(err("UNAUTHENTICATED", "Invalid credentials"), "bad_password")).toBe("bad_password");
    expect(loginFailureReason(new Error("boom"))).toBe("invalid_credentials");
  });
  it("knows which job events complete which request milestone", () => {
    expect(milestonesFor("offers_dispatched", { count: 3 })).toEqual(["first_offer"]); expect(milestonesFor("offers_dispatched", { count: 0 })).toEqual([]);
    expect(milestonesFor("driver_accepted", { requestStatus: "filling" })).toEqual(["first_offer", "first_accepted"]);
    expect(milestonesFor("driver_accepted", { requestStatus: "assigned" })).toEqual(["first_offer", "first_accepted", "filled"]);
    expect(milestonesFor("route_approved")).toEqual(["started"]); expect(milestonesFor("stop_arrived")).toEqual(["started"]);
    expect(milestonesFor("loading_recorded", { manifest: true })).toEqual([]); expect(milestonesFor("loading_recorded", { units: 4 })).toEqual(["started"]);
    expect(milestonesFor("request_published")).toEqual([]);
  });
});

describe("parcel journey mapping", () => {
  const base = { requestId: "r1", offerId: "o1", actor: { id: "d1", name: "Sam", role: "driver" } };
  it("ignores events without a parcel id or that are not parcel-level", () => {
    expect(parcelRowsFromJobEvent({ ...base, type: "shipment_delivered", payload: { code: "x" } })).toEqual([]);
    expect(parcelRowsFromJobEvent({ ...base, type: "request_published", payload: { shipmentId: "s1" } })).toEqual([]);
    expect(parcelRowsFromJobEvent({ ...base, type: "stop_arrived" })).toEqual([]);
  });
  it("a code-verified delivery with cash is three journey steps in order; a scan load carries its channel", () => {
    const rows = parcelRowsFromJobEvent({ ...base, type: "shipment_delivered", payload: { shipmentId: "s1", code: "JR-1-001", proofType: "otp", distanceM: 12, codCents: 5000 } });
    expect(rows.map((r) => r.type)).toEqual(["otp_verified", "delivered", "cod_collected"]);
    expect(rows[1].payload).toMatchObject({ proofType: "otp", distanceM: 12, code: "JR-1-001" }); expect(rows[1].payload).not.toHaveProperty("shipmentId");
    expect(rows[2].payload).toEqual({ code: "JR-1-001", amountCents: 5000 });
    expect(parcelRowsFromJobEvent({ ...base, type: "shipment_delivered", payload: { shipmentId: "s1", proofType: "scan" } }).map((r) => r.type)).toEqual(["delivered"]);
    expect(parcelRowsFromJobEvent({ ...base, type: "loading_scanned", payload: { shipmentId: "s1", code: "c" } })[0]).toMatchObject({ type: "loaded", payload: { via: "scan", code: "c" }, shipmentId: "s1", requestId: "r1", offerId: "o1" });
    expect(parcelRowsFromJobEvent({ ...base, type: "recipient_notified", payload: { shipmentId: "s1" } })[0].payload).toMatchObject({ channel: "sms" });
  });
  it("every mapped type is a known journey type and every mirrored job event maps", () => {
    for (const t of Object.values(JOB_TO_PARCEL)) expect(SHIPMENT_EVENT_TYPES).toContain(t);
    expect(MIRRORED_JOB_EVENTS.sort()).toEqual(Object.keys(JOB_TO_PARCEL).sort());
    for (const t of ["created", "edited", "details_completed", "assigned", "unassigned", "loaded", "unscanned", "route_positioned", "arrived", "otp_sent", "otp_failed", "otp_verified", "deferred", "failed", "delivered", "cod_collected", "returned", "missing", "cancelled", "reshipped"]) expect(SHIPMENT_EVENT_TYPES).toContain(t);
    expect(batchOf(["a", "b"], "r", "returned", { offerId: "o" })).toEqual([{ shipmentId: "a", requestId: "r", type: "returned", offerId: "o", actor: null, payload: undefined }, { shipmentId: "b", requestId: "r", type: "returned", offerId: "o", actor: null, payload: undefined }]);
  });
});

describe("snapshots: time buckets, folding, retention", () => {
  it("hour buckets are UTC hours; a day starts at Riyadh midnight (UTC+3, no daylight saving)", () => {
    expect(hourStart(new Date("2026-11-19T10:59:59.999Z")).toISOString()).toBe("2026-11-19T10:00:00.000Z");
    expect(riyadhDayStart(new Date("2026-11-19T20:59:59Z")).toISOString()).toBe("2026-11-18T21:00:00.000Z");
    expect(riyadhDayStart(new Date("2026-11-19T21:00:00Z")).toISOString()).toBe("2026-11-19T21:00:00.000Z");
    expect(riyadhDayStart(new Date("2026-06-21T00:30:00Z")).toISOString()).toBe("2026-06-20T21:00:00.000Z");
    expect(DAY_MS).toBe(86_400_000);
  });
  it("folds rows into per-city metrics and a platform total that includes rows without a city", () => {
    const m = foldByCity([{ city: "riyadh", a: 1, b: "2" }, { city: null, a: 10 }, { city: "jeddah", a: 4 }, { city: "riyadh", a: 1 }]);
    expect(m.get("")).toEqual({ a: 16, b: 2 }); expect(m.get("riyadh")).toEqual({ a: 2, b: 2 }); expect(m.get("jeddah")).toEqual({ a: 4 }); expect(m.has("null")).toBe(false);
  });
  it("zero-fills every key and always has a platform row", () => {
    const m = zeroFill(new Map([["riyadh", { drivers_busy: 2 }]]), HOURLY_KEYS);
    expect(m.get("")).toBeDefined(); expect(Object.keys(m.get("")!).sort()).toEqual([...HOURLY_KEYS].sort()); expect(m.get("riyadh")).toMatchObject({ drivers_busy: 2, drivers_available: 0 });
    expect(DAILY_KEYS).toEqual(expect.arrayContaining(["wallet_liability_cents", "cash_with_drivers_cents", "settlements_pending", "withdrawals_pending", "tickets_open", "complaints_open"]));
  });
  it("retention windows match the documented policy", () => {
    expect(RETENTION_DAYS).toEqual({ driver_location_history: 90, login_events: 400, message_log: 400 });
  });
});
