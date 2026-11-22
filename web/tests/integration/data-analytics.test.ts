/** Report correctness found by the data audit (audit K / A4): the cancellation-refund KPI sees both ledger key shapes. */
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { db } from "@/db";
import { sql } from "drizzle-orm";
import { driverAvailabilityLog, ledgerEntries, requests } from "@/db/schema";
import { cancelRequest } from "@/server/requests";
import { financeReport } from "@/server/analytics/finance";
import { clearAnalyticsCache } from "@/server/analytics/guard";
import { ensureAccount, platformAccount } from "@/server/wallet";
import { createSession } from "@/server/auth/session";
import { call } from "../helpers/api";
import { mkAdmin, mkBusiness, mkDriver, mkRule, publishedRequest, resetDb, shutdown } from "../helpers/factories";

beforeEach(async () => { await resetDb(); clearAnalyticsCache(); });
afterAll(shutdown);

describe("Finance › cancellation refunds", () => {
  it("counts a reserve released by a cancelled request whether the key is `cancel-release:…` (the app) or `hist:cancel-release:…` (the demo history), and nothing else", async () => {
    const admin = await mkAdmin(), biz = await mkBusiness();
    const acct = await ensureAccount(biz.id);
    const row = (key: string, delta: number, kind = "release_reserve") => ({ accountId: acct.id, kind, availableDeltaCents: delta, reservedDeltaCents: -delta, idempotencyKey: key });
    await db.insert(ledgerEntries).values([
      row("cancel-release:r1", 10_000), row("hist:cancel-release:r2", 2_500),
      row("expire-release:r3", 7_000), row("partial-release:r4", 3_000), row("hist:expire-release:r5", 900), // other ways a reserve comes back: not a cancellation
    ]);
    const r = (await financeReport(admin, new URLSearchParams({ preset: "today", compare: "none" }))) as { kpis: Array<{ key: string; value: number | null }> };
    expect(r.kpis.find((k) => k.key === "fin_cancel_refunds")?.value).toBe(12_500);
  });
});

describe("online time from the availability log", () => {
  it("counts the status a driver was in when the period began (a row far before it), stops at the period end and ignores later rows — in the report, the comparison period and the daily table", async () => {
    const admin = await mkAdmin();
    const [a, b, c, d, e] = [await mkDriver(), await mkDriver(), await mkDriver(), await mkDriver(), await mkDriver()];
    const S = Date.parse("2026-11-09T21:00:00Z"), DAY = 864e5, H = 36e5; // 10 Nov 2026 00:00 Riyadh = the start of the period (10 days)
    const row = (driverId: string, at: number, to: "available" | "unavailable") => ({ driverId, fromStatus: null, toStatus: to, source: "driver", at: new Date(at) });
    await db.insert(driverAvailabilityLog).values([
      row(a.id, S - 40 * DAY, "available"),                                                                                   // A: on since long before, never changes: the whole period
      row(b.id, S - 100 * DAY, "available"), row(b.id, S + 2 * DAY, "unavailable"), row(b.id, S + 5 * DAY, "available"), row(b.id, S + 9 * DAY, "unavailable"), // B: 2 d + 4 d
      row(c.id, S + 1 * DAY, "available"), row(c.id, S + 1 * DAY + 6 * H, "unavailable"), row(c.id, S + 11 * DAY, "available"),  // C: 6 h inside; a row after the period must not count
      row(d.id, S - 3 * DAY, "unavailable"),                                                                                  // D: never on
      row(e.id, S - 1000, "available"),                                                                                       // E: on from one second before the period
    ]);
    const token = (await createSession(admin.id, "web")).token;
    const get = (path: string) => call("GET", path, { token });
    const PERIOD = 10 * 86_400;
    const rep = await get("/admin/analytics/drivers?from=2026-11-10&to=2026-11-19&compare=prev");
    const kpi = rep.json.kpis.find((k: { key: string }) => k.key === "flt_online_hours");
    expect(kpi.value).toBe(PERIOD + 6 * 86_400 + 6 * 3_600 + PERIOD); // A 10 d + B 6 d + C 6 h + E 10 d + D nothing (the one second E was on before the period belongs to the comparison)
    // comparison period (the 10 days before): A 10 d, B 10 d, E only the last second
    expect(kpi.prev).toBe(2 * PERIOD + 1);
    // the daily table sums to the same number (its own call site of the same intervals)
    const daily = await get("/admin/analytics/drivers/table/daily?from=2026-11-10&to=2026-11-19&compare=none&pageSize=100&sort=date&dir=asc");
    const online = daily.json.rows.reduce((s: number, r: { online: number | null }) => s + (r.online ?? 0), 0);
    expect(daily.json.rows).toHaveLength(10);
    expect(online).toBe(PERIOD + 6 * 86_400 + 6 * 3_600 + PERIOD);
    void d;
  });
});

describe("Finance: cancellation refunds follow the application's own key", () => {
  it("a request cancelled through the application shows its released reserve in fin_cancel_refunds (renaming the ledger key would zero the KPI and fail here)", async () => {
    const admin = await mkAdmin(); await mkRule(admin);
    const biz = await mkBusiness({ fundsCents: 500_000 });
    const r = await publishedRequest(biz);
    const [{ reservedCents }] = await db.select({ reservedCents: requests.reservedCents }).from(requests).where(sql`id = ${r.id}`);
    expect(reservedCents).toBeGreaterThan(0);
    await cancelRequest(biz, r.id, "changed my mind");
    const rep = (await financeReport(admin, new URLSearchParams({ preset: "today", compare: "none" }))) as { kpis: Array<{ key: string; value: number | null }> };
    expect(rep.kpis.find((k) => k.key === "fin_cancel_refunds")?.value).toBe(reservedCents);
  });
});

describe("Finance: driverless rental revenue", () => {
  it("is the VAT-inclusive platform_fee of car_without_driver requests, separate from settlement-based revenue, and ignores every other platform fee", async () => {
    const admin = await mkAdmin(), biz = await mkBusiness();
    const plat = await platformAccount(db);
    const mk = (service: string, ref: string) => db.insert(requests).values({ ref, businessId: biz.id, service, quantity: 1, pickupCity: "riyadh", deliveryCity: "riyadh", startsAt: new Date(), status: "completed" }).returning().then((x) => x[0]);
    const rental = await mk("car_without_driver", "RENT-1"), parcel = await mk("delivery_driver", "DLV-1"), rental2 = await mk("car_without_driver", "RENT-2");
    const fee = (key: string, requestId: string, delta: number) => ({ accountId: plat.id, kind: "platform_fee", availableDeltaCents: delta, requestId, idempotencyKey: key });
    await db.insert(ledgerEntries).values([fee("rental:a:fee", rental.id, 5_750), fee("rental:b:fee", rental2.id, 1_250), fee("settle:c:fee", parcel.id, 999)]);
    const rep = (await financeReport(admin, new URLSearchParams({ preset: "today", compare: "none" }))) as { kpis: Array<{ key: string; value: number | null; unfiltered?: string[] }> };
    const k = (key: string) => rep.kpis.find((x) => x.key === key)!;
    expect(k("fin_rental_revenue").value).toBe(7_000);
    expect(k("fin_revenue").value).toBe(0);   // revenue counts settlements only: the rental is reconciled by its own KPI
    expect(k("fin_billed").value).toBe(0);
    // narrowed by a request filter it follows the request (service), and says it ignores office / driver
    const onlyParcels = (await financeReport(admin, new URLSearchParams({ preset: "today", compare: "none", service: "delivery_driver" }))) as { kpis: Array<{ key: string; value: number | null }> };
    expect(onlyParcels.kpis.find((x) => x.key === "fin_rental_revenue")?.value).toBe(0);
  });
});
