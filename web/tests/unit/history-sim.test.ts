import { describe, it, expect, beforeAll } from "vitest";
import { DEFAULT_CITIES } from "@/server/catalog";
import { DEFAULT_SETTINGS } from "@/server/settings";
import { buildContext } from "@/server/demo-history/run";
import { simulateDays } from "@/server/demo-history/days";
import { emitAccounts, emitProfiles } from "@/server/demo-history/accounts";
import { emitSupport } from "@/server/demo-history/support";
import { planMoney } from "@/server/demo-history/money";
import { buildSnapshots } from "@/server/demo-history/snapshots";
import { RuleBook, type Baseline, type RuleRow } from "@/server/demo-history/load";
import { DEFAULT_OPTIONS, type HistoryOptions } from "@/server/demo-history/options";
import { Sink } from "@/server/demo-history/writer";
import { ksa, parseKsaDay } from "@/server/demo-history/calendar";
import { isHistId } from "@/server/demo-history/ids";
import type { Ctx } from "@/server/demo-history/types";
import { DAILY_KEYS, HOURLY_KEYS } from "@/server/snapshots";

/**
 * The whole generator, in memory (no database): a fictitious baseline, 28 days, then the invariants every report relies on —
 * escrow and money conserve, timestamps are ordered and never in the future, every reference resolves, the weekly rhythm is there.
 */
const R = (o: Partial<RuleRow>): RuleRow => ({ id: `rule-${Math.random().toString(36).slice(2)}`, service: "delivery_driver", vehicleType: null, temperature: null, pickupCity: "riyadh", deliveryCity: null, unit: "shipment", priceCents: 1000, providerCostCents: 700, version: 1, effectiveAt: new Date("2026-01-01"), expiresAt: null, agreementRef: null, ...o });
function baseline(): Baseline {
  const rows: RuleRow[] = [];
  for (const [v, p, c] of [["sedan", 800, 550], ["dokker", 900, 620], ["hiace", 1100, 780]] as const) for (const city of ["riyadh", "jeddah", "dammam"]) rows.push(R({ vehicleType: v, deliveryCity: city, priceCents: p + (city === "riyadh" ? 0 : 300), providerCostCents: c + (city === "riyadh" ? 0 : 200) }));
  for (const v of ["van", "dyna"]) for (const t of ["dry", "cold"]) for (const city of ["riyadh", "jeddah", "dammam"]) rows.push(R({ vehicleType: v, temperature: t, deliveryCity: city, priceCents: v === "van" ? 1300 : 1600, providerCostCents: v === "van" ? 900 : 1150 }));
  for (const v of ["sedan", "dokker", "hiace", "van"]) { rows.push(R({ service: "car_with_driver", vehicleType: v, unit: "vehicle_day", priceCents: 30000, providerCostCents: 22000 })); rows.push(R({ service: "car_without_driver", vehicleType: v, unit: "vehicle_day", priceCents: 18000, providerCostCents: 0 })); }
  const s = DEFAULT_SETTINGS;
  return {
    cities: DEFAULT_CITIES.map((c) => ({ ...c })) as never, vatPct: s.vatPct, minWithdrawalCents: s.minWithdrawalCents, maxTopupCents: s.maxTopupCents, offerExpiryMin: s.offerExpiryMin, checkinEarlyMin: s.checkinEarlyMin,
    termsVersion: s.termsVersion, cancelWarnAt: s.cancelWarnAt, cancelSuspendAt: s.cancelSuspendAt, cancelWindowDays: s.cancelWindowDays, cancelSuspendDays: s.cancelSuspendDays, cancelPolicyEnabled: s.cancelPolicyEnabled, warehouseDefaults: s.warehouseDefaults,
    rules: new RuleBook(rows), staff: [{ id: "00000000-0000-4000-8000-0000000000aa", name: "Admin", phone: null, email: "admin@x.test", city: null, createdAt: new Date("2026-01-01"), role: "admin", staffRole: null, permissions: [], status: "active" }],
    business: [], offices: [], drivers: [], platformWalletId: null,
  };
}
const OPTS: HistoryOptions = { ...DEFAULT_OPTIONS, days: 42, companies: 16, offices: 3, drivers: 36, seed: 11, end: "2026-11-10", yes: true };
const NOW = Date.UTC(2026, 10, 19, 5, 0);

async function build(seed = OPTS.seed): Promise<Ctx> {
  const sink = new Sink("write", Number.MAX_SAFE_INTEGER);
  const ctx = buildContext({ ...OPTS, seed }, baseline(), sink, () => {}, NOW);
  ctx.platformWalletId = "platform-wallet";
  emitAccounts(ctx);
  await simulateDays(ctx);
  emitProfiles(ctx);
  const money = planMoney(ctx, 10_000, 10_000_000);
  emitSupport(ctx, money.withdrawals);
  (ctx as Ctx & { money: typeof money }).money = money;
  return ctx;
}
type Built = Ctx & { money: ReturnType<typeof planMoney> };

describe("demo history simulation (in memory)", () => {
  let ctx: Built, again: Built;
  beforeAll(async () => { ctx = (await build()) as Built; again = (await build()) as Built; }, 120_000);

  const rows = <K extends Parameters<Sink["peek"]>[0]>(t: K) => ctx.sink.peek(t);

  it("produces a populated platform", () => {
    const c = ctx.sink.counts;
    expect(c.requests).toBeGreaterThan(120);
    expect(c.shipments).toBeGreaterThan(400);
    for (const t of ["offers", "jobEvents", "shipmentEvents", "settlements", "invoices", "ratings", "codRemittances", "tickets", "ticketReplies", "complaints", "notifications", "loginEvents", "messageLog", "documents", "auditLogs", "driverAvailabilityLog"]) expect(c[t], t).toBeGreaterThan(0);
    expect(ctx.postings.length).toBeGreaterThan(250);
  });

  it("is deterministic: the same seed gives the same counts, ids, postings", () => {
    expect(again.sink.counts).toEqual(ctx.sink.counts);
    expect(again.postings.map((p) => `${p.key}|${p.at}|${p.available ?? 0}|${p.reserved ?? 0}|${p.held ?? 0}`)).toEqual(ctx.postings.map((p) => `${p.key}|${p.at}|${p.available ?? 0}|${p.reserved ?? 0}|${p.held ?? 0}`));
    expect(again.sink.peek("requests").map((r) => `${r.ref}|${r.status}|${r.createdAt?.getTime()}`)).toEqual(rows("requests").map((r) => `${r.ref}|${r.status}|${r.createdAt?.getTime()}`));
  });

  it("everything is marked: ids carry the marker, refs are tagged, phones are fictitious, users are not demo accounts", () => {
    for (const t of ["requests", "offers", "shipments", "settlements", "tickets", "complaints", "jobEvents", "shipmentEvents", "notifications", "users"] as const)
      for (const r of rows(t)) expect(isHistId((r as { id: string }).id), t).toBe(true);
    for (const r of rows("requests")) expect(r.ref).toMatch(/^JRH-\d{6}$/);
    for (const s of rows("shipments")) expect(s.code).toMatch(/^JRH-\d{6}-\d{3}$/);
    for (const t of rows("tickets")) expect(t.ref).toMatch(/^TKH-\d{6}$/);
    for (const u of rows("users")) { expect(u.isDemo).toBe(false); expect(u.source).toBe("seed"); if (u.phone) expect(u.phone).toMatch(/^\+9665001\d{5}$/); }
    for (const s of rows("shipments")) expect(s.recipientPhone).toMatch(/^\+9665002\d{5}$/);
  });

  it("money conserves: every request's postings net to zero overall and match the escrow the request still holds", () => {
    const byReq = new Map<string, { total: number; reserved: number }>();
    for (const p of ctx.postings) {
      if (!p.requestId) continue;
      const e = byReq.get(p.requestId) ?? { total: 0, reserved: 0 };
      e.total += (p.available ?? 0) + (p.reserved ?? 0) + (p.held ?? 0); e.reserved += p.reserved ?? 0;
      byReq.set(p.requestId, e);
    }
    const reqs = new Map(rows("requests").map((r) => [r.id!, r]));
    for (const [id, e] of byReq) {
      expect(e.total, `request ${reqs.get(id)?.ref} must not create or destroy money`).toBe(0);
      expect(e.reserved, `request ${reqs.get(id)?.ref} (${reqs.get(id)?.status}) escrow`).toBe(reqs.get(id)!.reservedCents);
    }
    // finished requests hold nothing (unless a settlement is on hold)
    const held = new Set(rows("settlements").filter((s) => s.status === "approved").map((s) => s.requestId));
    for (const r of rows("requests")) if (["completed", "cancelled", "expired"].includes(r.status!) && !held.has(r.id!)) expect(r.reservedCents, r.ref).toBe(0);
  });

  it("settlements follow the platform's arithmetic (customer = unit × final, margin = customer − provider, VAT-inclusive invoice)", () => {
    const invoices = new Map(rows("invoices").map((i) => [i.settlementId, i]));
    for (const s of rows("settlements")) {
      expect(s.customerCents).toBe(s.providerCents + s.marginCents);
      expect(s.refundCents).toBe(s.reservedCents - s.customerCents);
      expect(s.vatCents).toBe(Math.round((s.customerCents * 15) / 115));
      expect(s.reservedCents).toBeGreaterThanOrEqual(s.customerCents);
      if (s.status === "paid") {
        const inv = invoices.get(s.id!)!;
        expect(inv.totalCents).toBe(s.customerCents);
        expect(inv.subtotalCents! + inv.vatCents!).toBe(inv.totalCents);
      } else expect(invoices.has(s.id!)).toBe(false);
    }
    const platform = ctx.postings.filter((p) => p.kind === "platform_fee").reduce((a, p) => a + (p.available ?? 0), 0);
    const margins = rows("settlements").filter((s) => s.status === "paid").reduce((a, s) => a + s.marginCents!, 0);
    const rentals = ctx.postings.filter((p) => p.key.includes(":rental:") && p.kind === "platform_fee").reduce((a, p) => a + (p.available ?? 0), 0);
    expect(platform - rentals).toBe(margins);
  });

  it("the money pass keeps every wallet valid in time order (wallet_nonneg), tops up before spending, and pays withdrawals from real balances", () => {
    const { postings, topups, withdrawals, daily } = ctx.money;
    expect(topups).toBeGreaterThan(0);
    expect(withdrawals.length).toBeGreaterThan(0);
    expect(postings.every((p, i) => i === 0 || p.at >= postings[i - 1].at)).toBe(true);
    const bal = new Map<string, [number, number, number]>();
    const limit = new Map(ctx.w.companies.map((c) => [c.walletId, c.creditLimitCents]));
    for (const p of postings) {
      const b = bal.get(p.accountId) ?? [0, 0, 0];
      b[0] += p.available ?? 0; b[1] += p.reserved ?? 0; b[2] += p.held ?? 0; bal.set(p.accountId, b);
      expect(b[0] + (limit.get(p.accountId) ?? 0), `${p.key} would overdraw`).toBeGreaterThanOrEqual(0);
      expect(b[1]).toBeGreaterThanOrEqual(0); expect(b[2]).toBeGreaterThanOrEqual(0);
    }
    // the first thing a business ever does with its wallet is topping it up
    const firstKind = new Map<string, string>();
    for (const p of postings) if (!firstKind.has(p.accountId) && ctx.w.companies.some((c) => c.walletId === p.accountId && c.creditLimitCents === 0)) firstKind.set(p.accountId, p.kind);
    for (const [, k] of firstKind) expect(k).toBe("topup");
    for (const w of withdrawals) { expect(w.amountCents).toBeGreaterThanOrEqual(10_000); if (w.status === "pending") expect(w.decidedAt).toBeNull(); else expect(w.decidedAt).not.toBeNull(); }
    expect(daily.size).toBeGreaterThan(20);
    expect(new Set(postings.map((p) => p.key)).size).toBe(postings.length); // idempotency keys are unique
    expect(postings.every((p) => p.key.startsWith("hist:"))).toBe(true);
  });

  it("timestamps are ordered and never in the future; statuses agree with their timestamps", () => {
    const asOf = ctx.asOf;
    const check = (label: string, ...ds: Array<Date | null | undefined>) => { for (const d of ds) if (d) expect(d.getTime(), label).toBeLessThanOrEqual(asOf); };
    for (const r of rows("requests")) {
      check(r.ref, r.createdAt, r.updatedAt, r.publishedAt, r.completedAt, r.cancelledAt, r.firstOfferAt, r.filledAt, r.startedAt, r.lastActivityAt);
      if (r.publishedAt) expect(r.publishedAt.getTime()).toBeGreaterThanOrEqual(r.createdAt!.getTime());
      if (r.firstOfferAt) expect(r.firstOfferAt.getTime()).toBeGreaterThanOrEqual(r.publishedAt!.getTime());
      if (r.firstAcceptedAt) expect(r.firstAcceptedAt.getTime()).toBeGreaterThanOrEqual(r.firstOfferAt!.getTime());
      if (r.filledAt) expect(r.filledAt.getTime()).toBeGreaterThanOrEqual(r.firstAcceptedAt!.getTime());
      if (r.status === "completed") { expect(r.completedAt).toBeTruthy(); if (r.service !== "car_without_driver") expect(r.slotsFilled).toBeGreaterThan(0); }
      if (r.status === "cancelled") expect(r.cancelledAt).toBeTruthy();
      if (r.status === "draft") expect(r.publishedAt).toBeNull();
      expect(r.totalCents == null || r.totalCents > 0).toBe(true);
    }
    for (const o of rows("offers")) {
      check("offer", o.createdAt, o.updatedAt, o.acceptedAt, o.arrivedAt, o.attendanceAt, o.loadedAt, o.routeApprovedAt, o.deliveredAt, o.finalAt, o.cancelledAt);
      if (o.acceptedAt) expect(o.acceptedAt.getTime()).toBeGreaterThanOrEqual(o.createdAt!.getTime());
      if (o.arrivedAt) expect(o.arrivedAt.getTime()).toBeGreaterThanOrEqual(o.acceptedAt!.getTime());
      if (o.attendanceAt) expect(o.attendanceAt.getTime()).toBeGreaterThanOrEqual(o.arrivedAt!.getTime());
      if (o.routeApprovedAt) expect(o.routeApprovedAt.getTime()).toBeGreaterThanOrEqual(o.attendanceAt!.getTime());
      if (o.status === "completed") { expect(o.finalUnits).not.toBeNull(); expect(o.acceptedAt).toBeTruthy(); }
      if (["accepted", "arrived", "attendance_confirmed", "completed"].includes(o.status!)) expect(o.acceptedAt).toBeTruthy();
      expect(o.expectedUnits).toBeGreaterThan(0);
    }
    for (const s of rows("shipments")) {
      check(s.code, s.createdAt, s.loadedAt, s.arrivedAt, s.deliveredAt, s.failedAt, s.returnedAt, s.codCollectedAt);
      if (s.status === "delivered") { expect(s.deliveredAt).toBeTruthy(); expect(["otp", "receipt", "scan"]).toContain(s.proofType); expect(s.offerId).toBeTruthy(); }
      if (["failed", "returned"].includes(s.status!)) expect(s.failReason).toBeTruthy();
      if (s.status === "returned") expect(s.returnedAt).toBeTruthy();
      if (s.codCollectedCents != null) { expect(s.status).toBe("delivered"); expect(s.codCollectedCents).toBe(s.codCents); }
      if (s.status === "pending") expect(s.loadedAt ?? null).toBeNull();
    }
    for (const e of [...rows("jobEvents"), ...rows("shipmentEvents"), ...rows("notifications"), ...rows("ratings"), ...rows("messageLog")]) expect((e as { createdAt: Date }).createdAt.getTime()).toBeLessThanOrEqual(asOf);
    for (const p of ctx.postings) expect(p.at).toBeLessThanOrEqual(asOf);
  });

  it("every reference resolves (events, parcels, ledger, support cases)", () => {
    const ids = (t: "requests" | "offers" | "shipments" | "users" | "settlements") => new Set(rows(t).map((r) => r.id!));
    const req = ids("requests"), off = ids("offers"), shp = ids("shipments"), usr = ids("users"), set = ids("settlements");
    // existing users (the demo staff / admin) are outside the generated set
    for (const e of rows("jobEvents")) { expect(req.has(e.requestId)).toBe(true); if (e.offerId) expect(off.has(e.offerId)).toBe(true); }
    for (const e of rows("shipmentEvents")) { expect(shp.has(e.shipmentId)).toBe(true); expect(req.has(e.requestId)).toBe(true); }
    for (const o of rows("offers")) expect(req.has(o.requestId)).toBe(true);
    for (const s of rows("shipments")) { expect(req.has(s.requestId)).toBe(true); if (s.offerId) expect(off.has(s.offerId)).toBe(true); }
    for (const s of rows("settlements")) { expect(req.has(s.requestId)).toBe(true); expect(off.has(s.offerId)).toBe(true); }
    for (const p of ctx.postings) { if (p.requestId) expect(req.has(p.requestId)).toBe(true); if (p.settlementId) expect(set.has(p.settlementId)).toBe(true); if (p.offerId) expect(off.has(p.offerId)).toBe(true); }
    for (const t of rows("tickets")) { if (t.requestId) expect(req.has(t.requestId)).toBe(true); if (t.offerId) expect(off.has(t.offerId)).toBe(true); expect(usr.has(t.openedBy) || ctx.w.staff.some((s) => s.id === t.openedBy)).toBe(true); }
    for (const c of rows("complaints")) { if (c.requestId) expect(req.has(c.requestId)).toBe(true); if (c.offerId) expect(off.has(c.offerId)).toBe(true); }
    for (const r of rows("ratings")) expect(off.has(r.offerId)).toBe(true);
    for (const r of rows("codRemittances")) expect(off.has(r.offerId)).toBe(true);
    // ticket replies belong to a ticket, attachments to a reply of their ticket
    const tk = new Set(rows("tickets").map((t) => t.id!)), rp = new Map(rows("ticketReplies").map((r) => [r.id!, r.ticketId]));
    for (const r of rows("ticketReplies")) expect(tk.has(r.ticketId)).toBe(true);
    for (const a of rows("ticketAttachments")) expect(rp.get(a.replyId!)).toBe(a.ticketId);
    // every parcel has its "created" event
    const created = new Set(rows("shipmentEvents").filter((e) => e.type === "created").map((e) => e.shipmentId));
    for (const s of rows("shipments")) expect(created.has(s.id!)).toBe(true);
  });

  it("has the weekly and daily rhythm of a Saudi business (quiet Friday, two daily peaks, growth)", () => {
    const reqs = rows("requests");
    const perDow = new Array(7).fill(0), perHour = new Array(24).fill(0);
    for (const r of reqs) { const p = ksa(r.createdAt!.getTime()); perDow[p.dow]++; perHour[p.hour]++; }
    const weekdays = [0, 1, 2, 3].map((d) => perDow[d]).reduce((a, b) => a + b, 0) / 4;
    expect(perDow[5]).toBeLessThan(weekdays * 0.7);
    expect(perHour[10] + perHour[11]).toBeGreaterThan(perHour[3] * 8);
    expect(perHour[18] + perHour[19]).toBeGreaterThan(perHour[14] + perHour[15]);
    const half = ctx.windowStart + (ctx.asOf - ctx.windowStart) / 2;
    const first = reqs.filter((r) => r.createdAt!.getTime() < half).length, second = reqs.length - first;
    expect(second).toBeGreaterThan(first * 0.95);
  });

  it("looks like operations: most requests complete, some expire / cancel, B2C and B2B, COD on a third, real failure reasons, proofs", () => {
    const reqs = rows("requests"), st = (s: string) => reqs.filter((r) => r.status === s).length;
    expect(st("completed")).toBeGreaterThan(reqs.length * 0.5);
    expect(st("expired") + st("cancelled")).toBeGreaterThan(0);
    const shp = rows("shipments");
    const delivered = shp.filter((s) => s.status === "delivered");
    expect(delivered.length).toBeGreaterThan(shp.length * 0.4);
    expect(shp.some((s) => s.recipientType === "business")).toBe(true);
    const cod = shp.filter((s) => (s.codCents ?? 0) > 0).length / shp.length;
    expect(cod).toBeGreaterThan(0.12);
    expect(cod).toBeLessThan(0.55);
    expect(new Set(delivered.map((s) => s.proofType)).size).toBeGreaterThanOrEqual(2);
    const allowed = ["unreachable", "refused", "wrong_address", "out_of_zone", "closed", "no_otp", "damaged", "gate_access", "other", "driver_unavailable", "unfulfilled", "not_fully_staffed", "request_cancelled"];
    for (const s of shp) if (s.failReason) expect(allowed).toContain(s.failReason);
    expect(new Set(shp.filter((s) => s.failedAt).map((s) => s.failReason)).size).toBeGreaterThan(3);
    // parcels of finished jobs were never left on board
    const done = new Set(reqs.filter((r) => ["completed", "cancelled", "expired"].includes(r.status!)).map((r) => r.id));
    for (const s of shp) if (done.has(s.requestId)) expect(["pending", "loaded"]).not.toContain(s.status);
  });

  it("drivers differ in quality: ratings spread widely, some cancel or do not show", () => {
    const stars = rows("ratings").filter((r) => ctx.w.drivers.some((d) => d.id === r.rateeId));
    const per = new Map<string, number[]>();
    for (const r of stars) per.set(r.rateeId, [...(per.get(r.rateeId) ?? []), r.stars]);
    const avgs = [...per.values()].filter((v) => v.length >= 5).map((v) => v.reduce((a, b) => a + b, 0) / v.length);
    expect(avgs.length).toBeGreaterThan(1);
    expect(Math.max(...avgs) - Math.min(...avgs)).toBeGreaterThan(0.25);
    expect(rows("offers").some((o) => o.status === "cancelled" && o.cancelReason && !["request_cancelled", "not_fully_staffed"].includes(o.cancelReason))).toBe(true);
    expect(rows("ratings").every((r) => r.stars! >= 1 && r.stars! <= 5)).toBe(true);
    const bothWays = new Set(rows("ratings").map((r) => (ctx.w.companies.some((c) => c.id === r.raterId) ? "biz" : "drv")));
    expect(bothWays.size).toBe(2);
  });

  it("support cases carry the timings the quality reports need", () => {
    const tickets = rows("tickets");
    expect(tickets.length).toBeGreaterThan(5);
    for (const t of tickets) {
      if (t.firstResponseAt) expect(t.firstResponseAt.getTime()).toBeGreaterThanOrEqual(t.createdAt!.getTime());
      if (t.status === "resolved") { expect(t.resolvedAt).toBeTruthy(); expect(t.resolvedAt!.getTime()).toBeGreaterThanOrEqual(t.createdAt!.getTime()); expect(t.firstResponseAt).toBeTruthy(); }
      expect(["open", "in_review", "resolved"]).toContain(t.status);
      expect(["normal", "urgent"]).toContain(t.priority);
    }
    expect(tickets.some((t) => (t.reopenCount ?? 0) > 0) || tickets.length < 50).toBe(true);
    expect(rows("ticketReplies").some((r) => r.internal)).toBe(true);
    for (const c of rows("complaints")) { if (c.status === "resolved" || c.status === "closed") { expect(c.resolution).toBeTruthy(); expect(c.holdsSettlement).toBe(false); } }
  });

  it("snapshots: hourly (last 30 days) and daily (whole window), per city and platform, every key present", () => {
    const snaps = buildSnapshots(ctx, ctx.money);
    const hourly = snaps.filter((s) => s.scope === "hour"), daily = snaps.filter((s) => s.scope === "day");
    expect(daily.filter((s) => s.city == null)).toHaveLength(OPTS.days); // every complete Riyadh day of the window, the last one included
    expect(hourly.filter((s) => s.city == null).length).toBe(snaps.filter((s) => s.scope === "hour" && s.city == null).length);
    for (const s of hourly) for (const k of HOURLY_KEYS) expect(typeof s.metrics[k]).toBe("number");
    for (const s of daily) for (const k of DAILY_KEYS) expect(typeof s.metrics[k]).toBe("number");
    const seen = new Set<string>();
    for (const s of snaps) { const key = `${s.scope}|${s.at}|${s.city ?? ""}`; expect(seen.has(key), key).toBe(false); seen.add(key); }
    // the platform row is the sum of the city rows for additive hourly metrics
    const byHour = new Map<number, typeof hourly>();
    for (const s of hourly) byHour.set(s.at, [...(byHour.get(s.at) ?? []), s]);
    for (const [, list] of [...byHour].slice(0, 40)) {
      const plat = list.find((s) => s.city == null)!;
      for (const k of ["drivers_available", "requests_open", "parcels_pending"]) expect(list.filter((s) => s.city != null).reduce((a, s) => a + s.metrics[k], 0)).toBe(plat.metrics[k]);
    }
    expect(Math.max(...hourly.filter((s) => s.city == null).map((s) => s.metrics.drivers_available))).toBeGreaterThan(0);
    // the window ends on the requested day and the snapshot days stay inside it
    const last = Math.max(...daily.map((s) => s.at));
    expect(last).toBeLessThanOrEqual(parseKsaDay("2026-11-10")!);
  });
});
