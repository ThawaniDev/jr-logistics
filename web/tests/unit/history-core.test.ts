import { describe, it, expect } from "vitest";
import { Rng, unit, hashStr } from "@/server/demo-history/prng";
import { hid, isHistId, histIdSql, refOf, personPhone, recipientPhone, IdGen, HIST_PREFIX, HIST_LO, HIST_HI, KIND } from "@/server/demo-history/ids";
import { ksa, ksaDayStart, parseKsaDay, isWeekend, holidayFactor, monthEndFactor, sampleMoment, DAY, HOUR, HOUR_WEIGHTS, DOW_FACTOR } from "@/server/demo-history/calendar";
import { parseHistoryArgs, assertSafe, describeDatabase, DEFAULT_OPTIONS } from "@/server/demo-history/options";
import { Tl } from "@/server/demo-history/timeline";
import { RuleBook, type RuleRow } from "@/server/demo-history/load";
import { placeholderPng } from "@/server/demo-history/placeholder";
import { windowOf } from "@/server/demo-history/run";
import { demandFactor } from "@/server/demo-history/days";
import { normalizePhone } from "@/lib/phone";

describe("prng: deterministic, well-behaved", () => {
  it("same seed → same stream; different seed → different stream", () => {
    const a = new Rng(42), b = new Rng(42), c = new Rng(43);
    const xs = Array.from({ length: 50 }, () => a.next()), ys = Array.from({ length: 50 }, () => b.next()), zs = Array.from({ length: 50 }, () => c.next());
    expect(xs).toEqual(ys);
    expect(xs).not.toEqual(zs);
    expect(xs.every((x) => x >= 0 && x < 1)).toBe(true);
  });
  it("fork gives an independent stream that does not depend on how much the parent consumed", () => {
    const a = new Rng(7), b = new Rng(7);
    for (let i = 0; i < 100; i++) a.next();
    expect(a.fork("x").next()).toBe(b.fork("x").next());
    expect(a.fork("x").next()).not.toBe(a.fork("y").next());
  });
  it("int / pick / weighted / shuffle / sample stay in range and respect weights", () => {
    const r = new Rng(1);
    for (let i = 0; i < 500; i++) { const v = r.int(3, 6); expect(v >= 3 && v <= 6 && Number.isInteger(v)).toBe(true); }
    const counts = { a: 0, b: 0 };
    for (let i = 0; i < 4000; i++) counts[r.weighted([["a", 9], ["b", 1]] as const)]++;
    expect(counts.a / 4000).toBeGreaterThan(0.86);
    expect(counts.a / 4000).toBeLessThan(0.94);
    expect([...r.shuffle([1, 2, 3, 4, 5])].sort()).toEqual([1, 2, 3, 4, 5]);
    expect(r.sample([1, 2, 3, 4, 5], 3)).toHaveLength(3);
    expect(r.pick(["only"])).toBe("only");
  });
  it("poisson / logNormal / normal have the right centre", () => {
    const r = new Rng(5);
    const mean = (f: () => number, n = 6000) => Array.from({ length: n }, f).reduce((a, b) => a + b, 0) / n;
    expect(mean(() => r.poisson(4))).toBeGreaterThan(3.8);
    expect(mean(() => r.poisson(4))).toBeLessThan(4.2);
    expect(mean(() => r.poisson(80))).toBeGreaterThan(78);
    expect(r.poisson(0)).toBe(0);
    const med = Array.from({ length: 4001 }, () => r.logNormal(10, 0.8)).sort((a, b) => a - b)[2000];
    expect(med).toBeGreaterThan(9);
    expect(med).toBeLessThan(11);
    expect(mean(() => r.normal(5, 2))).toBeGreaterThan(4.9);
  });
  it("unit() is a stateless deterministic hash in [0,1)", () => {
    expect(unit(1, "a", 2)).toBe(unit(1, "a", 2));
    expect(unit(1, "a", 2)).not.toBe(unit(2, "a", 2));
    expect(unit(9, "x")).toBeLessThan(1);
    expect(hashStr("abc")).toBe(hashStr("abc"));
  });
});

describe("ids: every generated row is recognisable and parses like the platform's own", () => {
  it("uuids are valid, deterministic and carry the marker", () => {
    const id = hid("request", 12);
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(id.startsWith(HIST_PREFIX)).toBe(true);
    expect(isHistId(id)).toBe(true);
    expect(id).toBe(hid("request", 12));
    expect(hid("request", 12)).not.toBe(hid("offer", 12));
    expect(id >= HIST_LO && id <= HIST_HI).toBe(true);
    expect(histIdSql("r.id")).toContain("5eed1157");
  });
  it("random v4 uuids are never mistaken for generated ones", () => {
    for (let i = 0; i < 2000; i++) expect(isHistId(crypto.randomUUID())).toBe(false);
    expect(isHistId(null)).toBe(false);
    expect(isHistId("5eed1157-0004-4000-8000-00000000000g")).toBe(false);
  });
  it("the id generator counts per kind, and kinds do not clash", () => {
    const g = new IdGen();
    expect(g.next("user")).toBe(hid("user", 1));
    expect(g.next("user")).toBe(hid("user", 2));
    expect(g.next("offer")).toBe(hid("offer", 1));
    expect(g.count("user")).toBe(2);
    expect(g.seq("x")).toBe(1);
    expect(g.seq("x")).toBe(2);
    expect(new Set(Object.values(KIND)).size).toBe(Object.values(KIND).length);
  });
  it("references use a tagged pattern that the platform's parcel-code parser still accepts", () => {
    expect(refOf("request", 12)).toBe("JRH-000012");
    expect(refOf("ticket", 3)).toBe("TKH-000003");
    expect(refOf("complaint", 3)).toBe("CPH-000003");
    expect(refOf("remittance", 3)).toBe("CODH-000003");
    expect(refOf("invoice", 3)).toBe("INVH-000003");
    // components/features/admin-common.tsx splitParcelCode(): /^([A-Za-z]+-\d+)-(\d{1,4})$/
    expect(/^([A-Za-z]+-\d+)-(\d{1,4})$/.exec(`${refOf("request", 12)}-007`)?.[1]).toBe("JRH-000012");
  });
  it("phones are valid Saudi mobiles inside the fictitious blocks (people +966 5001…, recipients +966 5002…)", () => {
    for (const p of [personPhone(1), personPhone(99999), recipientPhone(7), recipientPhone(123456)]) expect(normalizePhone(p)).toBe(p);
    expect(personPhone(5)).toBe("+966500100005");
    expect(recipientPhone(5).startsWith("+9665002")).toBe(true);
  });
});

describe("calendar: Riyadh time, Saudi weekend, seasonality", () => {
  it("converts to Riyadh local time (UTC+3)", () => {
    const t = Date.UTC(2026, 10, 19, 21, 30); // Thu 19 Nov 2026 21:30 UTC = Fri 20 Nov 00:30 Riyadh
    const p = ksa(t);
    expect([p.y, p.m, p.d, p.hour, p.min, p.dow]).toEqual([2026, 11, 20, 0, 30, 5]);
    expect(ksaDayStart(t)).toBe(Date.UTC(2026, 10, 19, 21, 0));
    expect(parseKsaDay("2026-11-20")).toBe(Date.UTC(2026, 10, 19, 21, 0));
    expect(parseKsaDay("2026-13-40x")).toBeNull();
    expect(isWeekend(t)).toBe(true);
    expect(isWeekend(t + 2 * DAY)).toBe(false);
  });
  it("holidays quiet the platform, White Friday lifts it, the salary week peaks", () => {
    expect(holidayFactor(parseKsaDay("2026-05-27")!)).toBeLessThan(0.5); // Eid al-Adha
    expect(holidayFactor(parseKsaDay("2026-09-23")!)).toBeLessThan(0.6); // National Day
    expect(holidayFactor(parseKsaDay("2026-11-28")!)).toBeGreaterThan(1.2); // White Friday
    expect(holidayFactor(parseKsaDay("2026-08-12")!)).toBe(1);
    expect(monthEndFactor(parseKsaDay("2026-08-28")!)).toBeGreaterThan(monthEndFactor(parseKsaDay("2026-08-14")!) * 1.25);
  });
  it("weekend demand is lower, growth raises later days, quiet days exist", () => {
    expect(DOW_FACTOR[5]).toBeLessThan(DOW_FACTOR[0] * 0.5);
    expect(DOW_FACTOR[6]).toBeLessThan(DOW_FACTOR[1]);
    const noise = new Rng(1);
    const day = (i: number) => parseKsaDay("2026-06-01")! + i * DAY;
    const early = Array.from({ length: 28 }, (_, i) => demandFactor(42, i, day(i), noise.fork(i))).reduce((a, b) => a + b, 0);
    const late = Array.from({ length: 28 }, (_, i) => demandFactor(42, 140 + i, day(140 + i), noise.fork(i))).reduce((a, b) => a + b, 0);
    expect(late).toBeGreaterThan(early * 1.4);
    const quiet = Array.from({ length: 2000 }, (_, i) => unit(42, "quiet", i) < 0.014).filter(Boolean).length;
    expect(quiet).toBeGreaterThan(10);
    expect(quiet).toBeLessThan(60);
  });
  it("requests are created in two daily peaks: 09–13 and 16–21", () => {
    const r = new Rng(3), day = parseKsaDay("2026-06-02")!;
    const byHour = new Array(24).fill(0);
    for (let i = 0; i < 20_000; i++) byHour[ksa(sampleMoment(r, day, HOUR_WEIGHTS)).hour]++;
    const peakA = byHour.slice(9, 13).reduce((a, b) => a + b, 0), trough = byHour.slice(13, 16).reduce((a, b) => a + b, 0) / 3 * 4, night = byHour.slice(0, 6).reduce((a, b) => a + b, 0);
    expect(peakA).toBeGreaterThan(trough * 1.3);
    expect(byHour.slice(16, 21).reduce((a, b) => a + b, 0)).toBeGreaterThan(night * 15);
    expect(byHour[10] + byHour[19]).toBeGreaterThan(byHour[3] * 40);
    for (const t of [day, day + HOUR]) expect(ksaDayStart(t)).toBe(day);
  });
  it("the window ends today (hour precision) or on the requested past day", () => {
    const now = Date.UTC(2026, 10, 19, 5, 40);
    const a = windowOf({ days: 180, end: null }, now);
    expect(a.asOf).toBe(Date.UTC(2026, 10, 19, 5, 0));
    expect(ksa(a.windowStart).d).toBe(24);
    expect((ksaDayStart(now) - a.windowStart) / DAY).toBe(179);
    const b = windowOf({ days: 14, end: "2026-11-10" }, now);
    expect(b.asOf).toBe(parseKsaDay("2026-11-10")! + DAY - 1);
    expect((parseKsaDay("2026-11-10")! - b.windowStart) / DAY).toBe(13);
  });
});

describe("options and safety gates", () => {
  it("defaults match the brief", () => {
    expect(DEFAULT_OPTIONS).toMatchObject({ days: 180, companies: 30, offices: 6, drivers: 70, seed: 42, reset: false, dryRun: false, yes: false });
    expect(parseHistoryArgs([])).toMatchObject({ days: 180, companies: 30, offices: 6, drivers: 70, seed: 42, help: false });
  });
  it("parses flags (space and = forms, after npm's --)", () => {
    const o = parseHistoryArgs(["--", "--days", "90", "--companies=12", "--offices", "3", "--drivers", "40", "--seed", "7", "--end", "2026-11-01", "--dry-run", "--yes"]);
    expect(o).toMatchObject({ days: 90, companies: 12, offices: 3, drivers: 40, seed: 7, end: "2026-11-01", dryRun: true, yes: true, reset: false });
    expect(parseHistoryArgs(["--reset", "-y"])).toMatchObject({ reset: true, yes: true });
    expect(parseHistoryArgs(["--help"]).help).toBe(true);
  });
  it("rejects nonsense", () => {
    for (const bad of [["--days", "0"], ["--days", "abc"], ["--days", "5000"], ["--companies", "-1"], ["--drivers", "1"], ["--end", "yesterday"], ["--seed", "1.5"], ["--nope"], ["--days"]])
      expect(() => parseHistoryArgs(bad), bad.join(" ")).toThrow();
  });
  it("refuses to run unless demo mode is on, never in production, and never writes without --yes", () => {
    const ok = { NODE_ENV: "development", DEMO_MODE: "true" };
    expect(() => assertSafe({ dryRun: false, yes: true, reset: false }, ok)).not.toThrow();
    expect(() => assertSafe({ dryRun: false, yes: true, reset: true }, ok)).not.toThrow();
    expect(() => assertSafe({ dryRun: true, yes: false, reset: false }, ok)).not.toThrow(); // a dry run writes nothing
    expect(() => assertSafe({ dryRun: false, yes: false, reset: false }, ok)).toThrow(/--yes/);
    expect(() => assertSafe({ dryRun: false, yes: false, reset: true }, ok)).toThrow(/--yes/);
    expect(() => assertSafe({ dryRun: false, yes: true, reset: false }, { NODE_ENV: "development" })).toThrow(/DEMO_MODE/);
    expect(() => assertSafe({ dryRun: false, yes: true, reset: false }, { NODE_ENV: "development", DEMO_MODE: "false" })).toThrow(/DEMO_MODE/);
    expect(() => assertSafe({ dryRun: false, yes: true, reset: false }, { NODE_ENV: "production", DEMO_MODE: "true" })).toThrow(/production/);
    // the long "demo deployment in production" acknowledgement the app honours is deliberately NOT honoured here
    expect(() => assertSafe({ dryRun: true, yes: true, reset: false }, { NODE_ENV: "production", DEMO_MODE: "true", ALLOW_DEMO_IN_PRODUCTION: "yes-this-is-a-demo-deployment" })).toThrow(/production/);
  });
  it("describes the target database without credentials", () => {
    expect(describeDatabase("postgres://user:secret@db.internal:5432/jr_logistics?sslmode=require")).toEqual({ host: "db.internal:5432", name: "jr_logistics", label: "jr_logistics @ db.internal:5432" });
    expect(describeDatabase("postgres://user:secret@db.internal:5432/x").label).not.toContain("secret");
    expect(describeDatabase(undefined).label).toContain("not set");
  });
});

describe("timeline: state = base + the patches that happened by asOf", () => {
  it("applies patches in time order whatever order they were added, and drops the future", () => {
    const tl = new Tl<{ status: string; n: number; updatedAt?: Date }>({ status: "a", n: 0 });
    tl.at(30, { status: "c" }).at(10, { status: "b" }).at(20, (s) => ({ n: s.n + 1 })).at(25, (s) => ({ n: s.n + 10 }));
    expect(tl.state(5)).toMatchObject({ status: "a", n: 0 });
    expect(tl.state(15)).toMatchObject({ status: "b", n: 0 });
    expect(tl.state(22)).toMatchObject({ status: "b", n: 1 });
    expect(tl.state(26)).toMatchObject({ n: 11 });
    expect(tl.state(1000)).toMatchObject({ status: "c", n: 11 });
    expect(tl.state(1000).updatedAt).toEqual(new Date(30));
    expect(tl.lastT(22)).toBe(20);
    expect(tl.pending(22)).toBe(true);
    expect(tl.pending(100)).toBe(false);
  });
});

describe("price book resolves like the platform's resolveRule()", () => {
  const rule = (o: Partial<RuleRow>): RuleRow => ({ id: Math.random().toString(), service: "delivery_driver", vehicleType: null, temperature: null, pickupCity: null, deliveryCity: null, unit: "shipment", priceCents: 100, providerCostCents: 60, version: 1, effectiveAt: new Date(0), expiresAt: null, agreementRef: null, ...o });
  it("more matched dimensions beat fewer, then the newer version", () => {
    const book = new RuleBook([rule({ id: "any", priceCents: 1 }), rule({ id: "sedan", vehicleType: "sedan", priceCents: 2 }), rule({ id: "sedan-jed", vehicleType: "sedan", deliveryCity: "jeddah", priceCents: 3 }), rule({ id: "sedan-jed-v2", vehicleType: "sedan", deliveryCity: "jeddah", priceCents: 4, version: 2 })]);
    expect(book.resolve({ service: "delivery_driver", vehicleType: "sedan", deliveryCity: "jeddah" })?.id).toBe("sedan-jed-v2");
    expect(book.resolve({ service: "delivery_driver", vehicleType: "sedan", deliveryCity: "riyadh" })?.id).toBe("sedan");
    expect(book.resolve({ service: "delivery_driver", vehicleType: "dokker", deliveryCity: "riyadh" })?.id).toBe("any");
    expect(book.resolve({ service: "car_with_driver", vehicleType: "sedan" })).toBeNull();
  });
  it("temperature only matters for van / dyna", () => {
    const book = new RuleBook([rule({ id: "van-cold", vehicleType: "van", temperature: "cold" }), rule({ id: "van-dry", vehicleType: "van", temperature: "dry" }), rule({ id: "sedan", vehicleType: "sedan" })]);
    expect(book.resolve({ service: "delivery_driver", vehicleType: "van", temperature: "cold" })?.id).toBe("van-cold");
    expect(book.resolve({ service: "delivery_driver", vehicleType: "van", temperature: "dry" })?.id).toBe("van-dry");
    expect(book.resolve({ service: "delivery_driver", vehicleType: "sedan", temperature: "cold" })?.id).toBe("sedan");
    expect(book.resolve({ service: "delivery_driver", vehicleType: "van" })).toBeNull();
  });
});

describe("placeholder image", () => {
  it("is a valid PNG (documents, proofs and attachments of generated history all point at it)", () => {
    const png = placeholderPng();
    expect([...png.subarray(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    expect(png.subarray(12, 16).toString("ascii")).toBe("IHDR");
    expect(png.subarray(png.length - 8, png.length - 4).toString("ascii")).toBe("IEND");
    expect(png.length).toBeGreaterThan(100);
    expect(png.length).toBeLessThan(20_000);
  });
});
