import { describe, it, expect } from "vitest";
import { normalizePhone, waNumber } from "@/lib/phone";
import { startSla, toCsv } from "@/server/ops";
import { haversine, heuristicRoute, whatsappLink, optimizeRoute } from "@/server/routing";
import { signPayload, assertSafeWebhookUrl } from "@/server/integrations";
import { pct } from "@/lib/money";
import { passwordProblem } from "@/server/auth/password";
import { can } from "@/server/auth/permissions";
import { signRegistrationToken, readRegistrationToken } from "@/server/auth/otp";
import { expectedUnitsFor, buildQuote } from "@/server/pricing";

describe("phone", () => {
  it("normalises Saudi formats", () => {
    expect(normalizePhone("0500000001")).toBe("+966500000001");
    expect(normalizePhone("500000001")).toBe("+966500000001");
    expect(normalizePhone("966500000001")).toBe("+966500000001");
    expect(normalizePhone("+966 50 000 0001")).toBe("+966500000001");
    expect(normalizePhone("٠٥٠٠٠٠٠٠٠١")).toBe("+966500000001");
    expect(normalizePhone("+923001234567")).toBe("+923001234567");
    expect(normalizePhone("12345")).toBeNull();
    expect(normalizePhone("abc")).toBeNull();
  });
  it("wa number is digits only", () => expect(waNumber("+966500000001")).toBe("966500000001"));
});

describe("SLA start status", () => {
  const startsAt = new Date("2026-01-01T08:00:00Z");
  const base = { startsAt, graceMin: 30, status: "accepted" };
  it("on time within grace, late after", () => {
    expect(startSla({ ...base, arrivedAt: new Date("2026-01-01T08:30:00Z") })).toMatchObject({ status: "on_time", delayMin: 30 });
    expect(startSla({ ...base, arrivedAt: new Date("2026-01-01T08:31:00Z") })).toMatchObject({ status: "late", delayMin: 31 });
    expect(startSla({ ...base, arrivedAt: new Date("2026-01-01T07:50:00Z") })).toMatchObject({ status: "on_time", delayMin: 0 });
  });
  it("at_risk / pending / missed", () => {
    expect(startSla({ ...base, arrivedAt: null, now: new Date("2026-01-01T08:31:00Z") }).status).toBe("at_risk");
    expect(startSla({ ...base, arrivedAt: null, now: new Date("2026-01-01T08:30:00Z") }).status).toBe("pending");
    expect(startSla({ ...base, arrivedAt: null, status: "no_show" }).status).toBe("missed");
    expect(startSla({ ...base, arrivedAt: null, status: "offered" }).status).toBe("pending");
  });
});

describe("CSV export", () => {
  it("escapes quotes/commas and neutralises formulas", () => {
    const csv = toCsv(["a", "b"], [{ a: '=SUM(A1)', b: 'he said "hi", ok' }, { a: "+1", b: null }]);
    expect(csv.split("\n")[1]).toBe(`'=SUM(A1),"he said ""hi"", ok"`);
    expect(csv.split("\n")[2]).toBe(`'+1,`);
  });
});

describe("routing", () => {
  const origin = { lat: 24.7136, lng: 46.6753 };
  it("haversine ~ known distance (Riyadh→Jeddah ≈ 846 km)", () => {
    const d = haversine(origin, { lat: 21.4858, lng: 39.1925 }) / 1000;
    expect(d).toBeGreaterThan(830); expect(d).toBeLessThan(870);
  });
  it("heuristic orders by nearest neighbour and is labelled", () => {
    const stops = [{ id: "far", lat: 24.9, lng: 46.9 }, { id: "near", lat: 24.72, lng: 46.68 }, { id: "mid", lat: 24.78, lng: 46.75 }];
    const r = heuristicRoute(origin, stops);
    expect(r.order).toEqual(["near", "mid", "far"]);
    expect(r.provider).toBe("local_heuristic");
    expect(r.legs).toHaveLength(3);
  });
  it("without a Google key it warns instead of pretending", async () => {
    const r = await optimizeRoute(origin, [{ id: "a", lat: 24.8, lng: 46.7 }, { id: "b", lat: 24.9, lng: 46.8 }]);
    expect(r.provider).toBe("local_heuristic");
    expect(r.warning).toBe("ROUTING_PROVIDER_NOT_CONFIGURED");
  });
  it("whatsapp link is localized, encoded, handoff-only", () => {
    const l = whatsappLink("en", "arriving", { name: "Ali", ref: "JR-000001", phone: "+966500000001" });
    expect(l.url.startsWith("https://wa.me/966500000001?text=")).toBe(true);
    expect(decodeURIComponent(l.url.split("text=")[1])).toBe(l.text);
    expect(l.text).toContain("JR-000001");
    expect(whatsappLink("ar", "contact", { name: "علي", ref: "X", phone: "+966500000001" }).text).toContain("علي");
    expect(whatsappLink("ur", "issue", { name: "A", ref: "X", phone: "+966500000001" }).text).toContain("X");
  });
});

describe("webhook signing & SSRF", () => {
  it("signs deterministically", () => expect(signPayload("s", 1, "{}")).toBe(signPayload("s", 1, "{}")));
  it("signature changes with payload/time/secret", () => {
    const a = signPayload("s", 1, "{}");
    expect(signPayload("s", 2, "{}")).not.toBe(a); expect(signPayload("s", 1, "{ }")).not.toBe(a); expect(signPayload("t", 1, "{}")).not.toBe(a);
  });
  it("rejects bad URLs", async () => {
    await expect(assertSafeWebhookUrl("not a url", false)).rejects.toMatchObject({ code: "VALIDATION" });
    await expect(assertSafeWebhookUrl("ftp://x.com/a", false)).rejects.toMatchObject({ code: "VALIDATION" });
    await expect(assertSafeWebhookUrl("https://user:pw@x.com/", false)).rejects.toMatchObject({ code: "VALIDATION" });
  });
});

describe("misc", () => {
  it("pct rounds half-up", () => { expect(pct(1000, 15)).toBe(150); expect(pct(333, 15)).toBe(50); });
  it("password policy", () => { expect(passwordProblem("short1")).toBe("PASSWORD_TOO_SHORT"); expect(passwordProblem("longpasswordonly")).toBe("PASSWORD_WEAK"); expect(passwordProblem("Password12345")).toBeNull(); });
  it("permissions: admin all, staff explicit, others none", () => {
    expect(can({ role: "admin", permissions: [] }, "finance.view")).toBe(true);
    expect(can({ role: "staff", permissions: ["finance.view"] }, "finance.view")).toBe(true);
    expect(can({ role: "staff", permissions: [] }, "finance.view")).toBe(false);
    expect(can({ role: "business", permissions: ["finance.view"] }, "finance.view")).toBe(false);
  });
  it("registration token round-trips and detects tampering", () => {
    const t = signRegistrationToken("+966500000001");
    expect(readRegistrationToken(t)).toBe("+966500000001");
    const [b, s] = t.split(".");
    expect(() => readRegistrationToken(`${b}x.${s}`)).toThrow();
    expect(() => readRegistrationToken("garbage")).toThrow();
  });
});

describe("pricing math", () => {
  const rule = { id: "r", version: 2, agreementRef: null, currency: "SAR", unit: "shipment", priceCents: 800, providerCostCents: 550, effectiveAt: new Date(), expiresAt: null } as never;
  it("delivery is per shipment × drivers; vehicle services per day", () => {
    const q = buildQuote(rule, { service: "delivery_driver", quantity: 3, shipmentsPerDriver: 20, durationDays: 1 });
    expect(q.totalCents).toBe(800 * 3 * 20); expect(q.providerTotalCents).toBe(550 * 3 * 20); expect(q.marginCents).toBe(250 * 60);
    const v = buildQuote(rule, { service: "car_with_driver", quantity: 2, durationDays: 7 });
    expect(v.expectedUnits).toBe(7); expect(v.totalCents).toBe(800 * 2 * 7);
  });
  it("rejects invalid inputs", () => {
    expect(() => expectedUnitsFor({ service: "delivery_driver", quantity: 1, durationDays: 1 })).toThrow();
    expect(() => buildQuote(rule, { service: "car_with_driver", quantity: 0, durationDays: 1 })).toThrow();
  });
});

describe("production secrets", () => {
  it("refuses to sign registration tokens in production without AUTH_SECRET", () => {
    const env = process.env as Record<string, string | undefined>;
    const prev = { n: env.NODE_ENV, s: env.AUTH_SECRET };
    try {
      env.NODE_ENV = "production"; delete env.AUTH_SECRET;
      expect(() => signRegistrationToken("+966500000001")).toThrow(/AUTH_SECRET/);
      env.AUTH_SECRET = "short";
      expect(() => signRegistrationToken("+966500000001")).toThrow(/AUTH_SECRET/);
      env.AUTH_SECRET = "a-long-enough-production-secret";
      expect(readRegistrationToken(signRegistrationToken("+966500000001"))).toBe("+966500000001");
    } finally { env.NODE_ENV = prev.n; if (prev.s === undefined) delete env.AUTH_SECRET; else env.AUTH_SECRET = prev.s; }
  });
  it("demo mode cannot be enabled in production without the explicit acknowledgement", async () => {
    const { env: e } = await import("@/lib/env");
    const env = process.env as Record<string, string | undefined>;
    const prev = { n: env.NODE_ENV, d: env.DEMO_MODE, a: env.ALLOW_DEMO_IN_PRODUCTION };
    try {
      env.NODE_ENV = "production"; env.DEMO_MODE = "true"; delete env.ALLOW_DEMO_IN_PRODUCTION;
      expect(e.demoMode).toBe(false);
      env.ALLOW_DEMO_IN_PRODUCTION = "true"; expect(e.demoMode).toBe(false); // must be the exact phrase
      env.ALLOW_DEMO_IN_PRODUCTION = "yes-this-is-a-demo-deployment"; expect(e.demoMode).toBe(true);
      env.NODE_ENV = "development"; delete env.ALLOW_DEMO_IN_PRODUCTION; expect(e.demoMode).toBe(true);
      env.DEMO_MODE = "false"; expect(e.demoMode).toBe(false);
    } finally { env.NODE_ENV = prev.n; env.DEMO_MODE = prev.d; if (prev.a === undefined) delete env.ALLOW_DEMO_IN_PRODUCTION; else env.ALLOW_DEMO_IN_PRODUCTION = prev.a; }
  });
});
