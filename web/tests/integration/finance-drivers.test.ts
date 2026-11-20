/**
 * Finance › Drivers (J7): `GET /admin/finance/drivers` and `…/:id` + the five tables — permissions, phone masking, hand-computed figures for an office driver (no wallet) and an independent one,
 * filters, sorting, paging, the period (default 30 days, custom, all time), the totals row, and that every number ties to the existing sources: the fleet money table
 * (`GET /admin/analytics/drivers/table/money`) for the same period and the driver's `walletView`.
 */
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { users } from "@/db/schema";
import { resetDb, shutdown, mkStaff } from "../helpers/factories";
import { PERIOD, seedFinanceDriversWorld } from "../helpers/finance-drivers-world";
import { call } from "../helpers/api";
import { createSession } from "@/server/auth/session";
import { clearAnalyticsCache } from "@/server/analytics/guard";
import { walletView } from "@/server/wallet";

beforeEach(async () => { await resetDb(); clearAnalyticsCache(); });
afterAll(shutdown);
const tok = async (u: { id: string }) => (await createSession(u.id, "web")).token;
const get = async (u: { id: string }, path: string) => call("GET", path, { token: await tok(u) });
const BASE = "/admin/finance/drivers";
const byName = (rows: any[], name: string) => rows.find((r) => r.name === name);

describe("permissions", () => {
  it("every endpoint needs a back-office session with finance.view", async () => {
    const w = await seedFinanceDriversWorld();
    const paths = [BASE, `${BASE}/${w.d3.id}`, ...["statement", "settlements", "ledger", "withdrawals", "cash"].map((t) => `${BASE}/${w.d3.id}/${t}`)];
    const support = await mkStaff(["tickets.view", "reports.view", "reports.export", "drivers.view"]);
    for (const p of paths) {
      expect((await call("GET", p)).status, p).toBe(401);
      expect((await get(w.biz, p)).status, `${p} business`).toBe(403);
      expect((await get(w.d3, p)).status, `${p} driver`).toBe(403);
      expect((await get(support, p)).status, `${p} staff without finance.view`).toBe(403);
    }
    const viewer = await mkStaff(["finance.view"]);
    for (const p of paths) expect((await get(viewer, p)).status, p).toBe(200);
    expect((await get(w.admin, BASE)).status).toBe(200);
  });

  it("an unknown driver, an id that is not a driver, and a malformed id are 404", async () => {
    const w = await seedFinanceDriversWorld();
    for (const id of ["00000000-0000-4000-8000-000000000000", w.o1.id, w.biz.id, "not-a-uuid"]) {
      for (const t of ["", "/settlements", "/ledger", "/withdrawals", "/cash", "/statement"]) expect((await get(w.admin, `${BASE}/${id}${t}`)).status, `${id}${t}`).toBe(404);
    }
  });

  it("bad parameters are 422 with the field named", async () => {
    const w = await seedFinanceDriversWorld();
    const bad: Array<[string, string]> = [["sort=password", "sort"], ["sort=name&dir=up", "dir"], ["page=0", "page"], ["pageSize=101", "pageSize"], ["office=nope", "office"], ["status=gone", "status"], ["from=2026-05-01", "to"],
      ["to=2026-05-01", "from"], ["from=2026-05-05&to=2026-05-01", "from"], ["from=2015-01-01&to=2026-01-01", "to"], ["from=2026-13-01&to=2026-13-02", "from"]];
    for (const [q, field] of bad) { const r = await get(w.admin, `${BASE}?${q}`); expect(r.status, q).toBe(422); expect(r.json.error.details[field], q).toBeTruthy(); }
    const id = w.d3.id;
    for (const [t, q] of [["settlements", "status=weird"], ["withdrawals", "status=weird"], ["cash", "status=weird"], ["ledger", "kind=weird"], ["statement", "kind=weird"], ["ledger", "from=2026-05-01"]]) expect((await get(w.admin, `${BASE}/${id}/${t}?${q}`)).status, `${t}?${q}`).toBe(422);
  });
});

describe("the list", () => {
  it("one row per driver with identity and the hand-computed figures (period = the world's three days)", async () => {
    const w = await seedFinanceDriversWorld();
    const r = await get(w.admin, `${BASE}?${PERIOD}`);
    expect(r.status).toBe(200);
    expect(r.json.total).toBe(3);
    expect(r.json.period).toMatchObject({ mode: "range", from: "2026-05-10", to: "2026-05-12", days: 3, isDefault: false });
    const [d1, d2, d3] = ["Driver One", "Driver Two", "Driver Three"].map((n) => byName(r.json.rows, n));
    expect(d1).toMatchObject({ id: w.d1.id, username: "drv.one", city: "riyadh", status: "active", verification: "verified", officeId: w.o1.id, independent: false, paidViaOffice: true });
    expect(d1.officeName).toMatch(/^Off /);
    expect(d3).toMatchObject({ officeId: null, officeName: null, independent: true, paidViaOffice: false });
    // D1 (office): earnings and cash are shown, the wallet is not
    expect(d1).toMatchObject({ walletAvailableCents: null, walletHeldCents: null, walletPendingCents: null, jobs: 2, delivered: 4, failed: 1, returned: 1, earnedCents: 3500, paidCents: 2100, pendingCents: 1400, payoutFailedCents: 0, refundCents: 100, adjustCents: 50,
      cashCollectedCents: 5000, cashRemittedCents: 3000, cashHeldCents: 2000, periodJobs: 2, periodParcels: 4, periodEarnedCents: 3500, periodPaidCents: 2100, periodCashCollectedCents: 5000, periodCashRemittedCents: 3000, wdRequestedCents: 0 });
    expect(d2).toMatchObject({ walletAvailableCents: null, jobs: 2, delivered: 3, earnedCents: 2450, paidCents: 1750, pendingCents: 700, cashCollectedCents: 8000, cashRemittedCents: 0, cashHeldCents: 8000 });
    // D3 (independent): wallet, withdrawals, penalties
    expect(d3).toMatchObject({ walletAvailableCents: 250, walletHeldCents: 100, walletPendingCents: 0, jobs: 1, delivered: 2, failed: 1, returned: 0, earnedCents: 1050, paidCents: 1050, pendingCents: 0, cashHeldCents: 0,
      wdRequestedCents: 650, wdRequestedN: 3, wdPaidCents: 500, wdPaidN: 1, wdPendingCents: 100, wdPendingN: 1, wdRejectedCents: 50, wdRejectedN: 1, walletAdjustCents: -200, penaltiesCents: 200 });
    expect(d1.lastPayoutAt).toBe("2026-05-11T09:00:00.000Z"); // the paid settlement's paid_at
    expect(d3.lastPayoutAt).toBe("2026-05-12T12:00:00.000Z");
    expect(d1.lastJobAt).toBe("2026-05-10T12:00:00.000Z"); // the later job's final report
    expect(r.json.offices.map((o: any) => o.id)).toEqual([w.o1.id]); // only offices with drivers
    expect(r.json.cities).toEqual(["riyadh"]);
  });

  it("the totals row sums every driver of the selection; wallet balances count only drivers with a wallet", async () => {
    const w = await seedFinanceDriversWorld();
    const { totals, rows } = (await get(w.admin, `${BASE}?${PERIOD}`)).json;
    expect(totals).toMatchObject({ drivers: 3, earnedCents: 3500 + 2450 + 1050, paidCents: 2100 + 1750 + 1050, pendingCents: 2100, cashHeldCents: 10000, cashCollectedCents: 13000, cashRemittedCents: 3000, walletAvailableCents: 250, walletHeldCents: 100, jobs: 5, delivered: 9, wdRequestedCents: 650 });
    for (const k of ["earnedCents", "paidCents", "pendingCents", "cashHeldCents", "jobs", "periodEarnedCents"]) expect(rows.reduce((n: number, r: any) => n + r[k], 0), k).toBe(totals[k]);
  });

  it("default period is the last 30 days: period columns are empty for old work, lifetime columns are not", async () => {
    const w = await seedFinanceDriversWorld();
    const { json } = await get(w.admin, BASE);
    expect(json.period).toMatchObject({ mode: "range", days: 30, isDefault: true });
    const d1 = byName(json.rows, "Driver One");
    expect(d1).toMatchObject({ earnedCents: 3500, periodEarnedCents: 0, periodJobs: 0, periodCashCollectedCents: 0 });
    const all = (await get(w.admin, `${BASE}?period=all`)).json;
    expect(all.period).toMatchObject({ mode: "all", from: null, to: null });
    expect(byName(all.rows, "Driver One")).toMatchObject({ earnedCents: 3500, periodEarnedCents: 3500, periodJobs: 2 });
  });

  it("a narrower period only counts what happened inside it (each measure on its own date)", async () => {
    const w = await seedFinanceDriversWorld();
    const tenth = (await get(w.admin, `${BASE}?from=2026-05-10&to=2026-05-10`)).json.rows;
    expect(byName(tenth, "Driver One")).toMatchObject({ periodEarnedCents: 3500, periodPaidCents: 0, periodCashCollectedCents: 5000, periodCashRemittedCents: 0, periodJobs: 2 });
    expect(byName(tenth, "Driver Two")).toMatchObject({ periodEarnedCents: 0, periodJobs: 0 });
    const eleventh = (await get(w.admin, `${BASE}?from=2026-05-11&to=2026-05-11`)).json.rows;
    expect(byName(eleventh, "Driver One")).toMatchObject({ periodEarnedCents: 0, periodPaidCents: 2100, periodCashRemittedCents: 3000 });
    expect(byName(eleventh, "Driver Two")).toMatchObject({ periodEarnedCents: 2450, periodCashCollectedCents: 8000 });
  });

  it("filters: search, office, independent, city, status, holds cash, pending payout", async () => {
    const w = await seedFinanceDriversWorld();
    const names = async (q: string) => (await get(w.admin, `${BASE}?${PERIOD}&${q}`)).json.rows.map((r: any) => r.name).sort();
    expect(await names("q=three")).toEqual(["Driver Three"]);
    expect(await names("q=DRV.TWO")).toEqual(["Driver Two"]);
    expect(await names(`q=${encodeURIComponent(w.d1.phone!.slice(-6))}`)).toEqual(["Driver One"]);
    expect(await names("q=nobody")).toEqual([]);
    expect(await names(`office=${w.o1.id}`)).toEqual(["Driver One", "Driver Two"]);
    expect(await names(`office=${w.o2.id}`)).toEqual([]);
    expect(await names("office=independent")).toEqual(["Driver Three"]);
    expect(await names("city=riyadh")).toHaveLength(3);
    expect(await names("city=jeddah")).toEqual([]);
    expect(await names("hasCash=1")).toEqual(["Driver One", "Driver Two"]);
    expect(await names("hasPending=1")).toEqual(["Driver One", "Driver Two"]);
    expect(await names("hasCash=1&office=independent")).toEqual([]);
    await db.update(users).set({ status: "suspended" }).where(eq(users.id, w.d3.id));
    expect(await names("status=suspended")).toEqual(["Driver Three"]);
    expect(await names("status=active")).toEqual(["Driver One", "Driver Two"]);
    // the totals follow the filter, the KPI strip too
    expect((await get(w.admin, `${BASE}?${PERIOD}&hasCash=1`)).json.totals).toMatchObject({ drivers: 2, cashHeldCents: 10000, walletAvailableCents: 0 });
  });

  it("sorting by any column (nulls last) and paging with the right total", async () => {
    const w = await seedFinanceDriversWorld();
    const order = async (q: string) => (await get(w.admin, `${BASE}?${PERIOD}&${q}`)).json.rows.map((r: any) => r.name);
    expect(await order("")).toEqual(["Driver One", "Driver Two", "Driver Three"]); // default: gross earnings, biggest first
    expect(await order("sort=cashHeldCents&dir=desc")).toEqual(["Driver Two", "Driver One", "Driver Three"]);
    expect(await order("sort=name&dir=asc")).toEqual(["Driver One", "Driver Three", "Driver Two"]);
    expect(await order("sort=walletAvailableCents&dir=desc")).toEqual(["Driver Three", "Driver One", "Driver Two"]); // office drivers have no wallet: last either way
    expect(await order("sort=walletAvailableCents&dir=asc")).toEqual(["Driver Three", "Driver One", "Driver Two"]);
    const p1 = (await get(w.admin, `${BASE}?${PERIOD}&pageSize=2&page=1`)).json, p2 = (await get(w.admin, `${BASE}?${PERIOD}&pageSize=2&page=2`)).json, p3 = (await get(w.admin, `${BASE}?${PERIOD}&pageSize=2&page=3`)).json;
    expect([p1.rows.length, p2.rows.length, p3.rows.length]).toEqual([2, 1, 0]);
    expect([p1.total, p2.total, p3.total]).toEqual([3, 3, 3]);
    expect(p3.totals.drivers).toBe(3);
    expect(new Set([...p1.rows, ...p2.rows].map((r: any) => r.id)).size).toBe(3);
  });

  it("the wallet columns tie to the driver's wallet view", async () => {
    const w = await seedFinanceDriversWorld();
    const row = byName((await get(w.admin, `${BASE}?${PERIOD}`)).json.rows, "Driver Three");
    const view = await walletView(w.d3.id);
    expect(row.walletAvailableCents).toBe(view.account.availableCents);
    expect(row.walletHeldCents).toBe(view.account.heldCents);
    expect(row.walletAvailableCents).toBe(row.paidCents + row.walletAdjustCents - row.wdRequestedCents + row.wdRejectedCents); // 1050 − 200 − 650 + 50
  });
});

describe("ties to the fleet money table", () => {
  const moneyRows = async (admin: { id: string }, q: string) => new Map<string, any>(((await get(admin, `/admin/analytics/drivers/table/money?${q}&compare=none&pageSize=100`)).json.rows as any[]).map((r) => [r.id, r]));
  for (const range of [["the whole world", "from=2026-05-10&to=2026-05-12"], ["the 10th", "from=2026-05-10&to=2026-05-10"], ["the 11th and 12th", "from=2026-05-11&to=2026-05-12"], ["a quiet week", "from=2026-04-01&to=2026-04-07"]]) {
    it(`earned, paid, pending, jobs, parcels and cash equal drivers/money — ${range[0]}`, async () => {
      const w = await seedFinanceDriversWorld();
      const money = await moneyRows(w.admin, range[1]);
      const list = (await get(w.admin, `${BASE}?${range[1]}`)).json.rows as any[];
      expect(list).toHaveLength(3);
      for (const r of list) {
        const m = money.get(r.id) ?? {}; // a driver with nothing in the period has no money row: all zero
        expect(r.periodEarnedCents, `${r.name} earned`).toBe(m.earnCents ?? 0);
        expect(r.periodPaidCents, `${r.name} paid`).toBe(m.paidCents ?? 0);
        expect(r.periodJobs, `${r.name} jobs`).toBe(m.jobs ?? 0);
        expect(r.periodParcels, `${r.name} parcels`).toBe(m.delivered ?? 0);
        expect(r.periodCashCollectedCents, `${r.name} collected`).toBe(m.codCollectedCents ?? 0);
        expect(r.periodCashRemittedCents, `${r.name} remitted`).toBe(m.codRemittedCents ?? 0);
        if (money.has(r.id)) { expect(r.pendingCents, `${r.name} pending`).toBe(m.pendingCents); expect(r.cashHeldCents, `${r.name} held`).toBe(m.codHeldCents); }
      }
    });
  }
});

describe("masking", () => {
  it("phone numbers are masked without drivers.sensitive, in the list and on the detail page", async () => {
    const w = await seedFinanceDriversWorld();
    const plain = await mkStaff(["finance.view"]), sensitive = await mkStaff(["finance.view", "drivers.sensitive"]);
    const row = async (u: { id: string }) => byName((await get(u, `${BASE}?${PERIOD}`)).json.rows, "Driver One");
    expect((await row(plain)).phone).toBe(w.d1.phone!.slice(0, 4) + "•••" + w.d1.phone!.slice(-2));
    expect((await row(sensitive)).phone).toBe(w.d1.phone);
    expect((await row(w.admin)).phone).toBe(w.d1.phone);
    expect((await get(plain, `${BASE}/${w.d1.id}`)).json.driver.phone).toContain("•••");
    // searching a number must not reveal what the mask hides: without drivers.sensitive the search ignores phones
    const tail = w.d1.phone!.slice(-6);
    expect((await get(plain, `${BASE}?${PERIOD}&q=${encodeURIComponent(tail)}`)).json.rows).toHaveLength(0);
    expect((await get(sensitive, `${BASE}?${PERIOD}&q=${encodeURIComponent(tail)}`)).json.rows.map((r: any) => r.name)).toEqual(["Driver One"]);
    expect((await get(sensitive, `${BASE}/${w.d1.id}`)).json.driver.phone).toBe(w.d1.phone);
  });
});

describe("one driver", () => {
  it("the summary has the same figures as the list row, the period and how many rows each tab has", async () => {
    const w = await seedFinanceDriversWorld();
    const list = byName((await get(w.admin, `${BASE}?${PERIOD}`)).json.rows, "Driver One");
    const { json } = await get(w.admin, `${BASE}/${w.d1.id}?${PERIOD}`);
    expect(json.driver).toEqual(list);
    expect(json.period).toMatchObject({ from: "2026-05-10", to: "2026-05-12" });
    expect(json.counts).toEqual({ statement: 4, settlements: 2, ledger: 0, withdrawals: 0, cash: 1 });
    expect((await get(w.admin, `${BASE}/${w.d3.id}?${PERIOD}`)).json.counts).toEqual({ statement: 2, settlements: 1, ledger: 1, withdrawals: 0, cash: 0 }); // only the payout of the 12th is inside
    expect((await get(w.admin, `${BASE}/${w.d3.id}?period=all`)).json.counts).toEqual({ statement: 8, settlements: 1, ledger: 7, withdrawals: 3, cash: 0 });
  });

  it("settlements: totals over the whole selection, status filter, payee office, period, paging", async () => {
    const w = await seedFinanceDriversWorld();
    const t = (q = "") => get(w.admin, `${BASE}/${w.d1.id}/settlements?${PERIOD}${q}`);
    const all = (await t()).json;
    expect(all.total).toBe(2);
    expect(all.totals).toEqual({ earnedCents: 3500, paidCents: 2100, pendingCents: 1400 });
    expect(all.paidViaOffice).toBe(true);
    expect(all.rows.map((r: any) => [r.status, r.earnedCents, r.officeId === w.o1.id, r.payeeOffice?.startsWith("Off ")])).toEqual([["approved", 1400, true, true], ["paid", 2100, true, true]]); // newest first
    expect(all.rows[0]).toMatchObject({ adjustmentCents: 50, refundCents: 100, finalUnits: 4 });
    expect((await t("&status=paid")).json.rows).toHaveLength(1);
    expect((await t("&status=pending")).json.totals.pendingCents).toBe(1400);
    expect((await t("&status=rejected")).json.total).toBe(0);
    expect((await get(w.admin, `${BASE}/${w.d1.id}/settlements?from=2026-05-11&to=2026-05-12`)).json.total).toBe(0); // both were created on the 10th
    const page = (await t("&pageSize=1&page=2")).json;
    expect([page.total, page.rows.length, page.totals.earnedCents]).toEqual([2, 1, 3500]);
    expect((await get(w.admin, `${BASE}/${w.d3.id}/settlements?${PERIOD}`)).json.rows[0]).toMatchObject({ officeId: null, payeeOffice: null });
  });

  it("wallet ledger: every entry with the running balance after it, credit / debit totals, kind filter; an office driver has none", async () => {
    const w = await seedFinanceDriversWorld();
    const l = (await get(w.admin, `${BASE}/${w.d3.id}/ledger?period=all`)).json;
    expect(l.total).toBe(7);
    const chrono = [...l.rows].reverse();
    expect(chrono.map((r: any) => [r.kind, r.availableDeltaCents, r.balanceCents])).toEqual([["payout", 1050, 1050], ["withdrawal_hold", -500, 550], ["withdrawal_paid", 0, 550], ["adjustment", -200, 350], ["withdrawal_hold", -100, 250], ["withdrawal_hold", -50, 200], ["withdrawal_release", 50, 250]]);
    expect(l.rows[0].balanceCents).toBe((await walletView(w.d3.id)).account.availableCents);
    expect(l.totals).toEqual({ creditCents: 1100, debitCents: 850 });
    expect(chrono[3]).toMatchObject({ creditCents: 0, debitCents: 200, note: "fine for damaged parcel", actor: expect.stringContaining("Admin") });
    expect((await get(w.admin, `${BASE}/${w.d3.id}/ledger?period=all&kind=adjustment`)).json.total).toBe(1);
    // the balance after an entry does not depend on the period filter
    const late = (await get(w.admin, `${BASE}/${w.d3.id}/ledger?from=2026-05-15&to=2026-05-16`)).json;
    expect(late.rows.map((r: any) => r.balanceCents)).toEqual([250, 200, 250]);
    expect((await get(w.admin, `${BASE}/${w.d1.id}/ledger?period=all`)).json).toMatchObject({ total: 0, paidViaOffice: true, rows: [] });
  });

  it("withdrawals: rows, totals by status, open filter, period", async () => {
    const w = await seedFinanceDriversWorld();
    const wd = (await get(w.admin, `${BASE}/${w.d3.id}/withdrawals?period=all`)).json;
    expect(wd.total).toBe(3);
    expect(wd.totals).toEqual({ requestedCents: 650, paidCents: 500, pendingCents: 100, rejectedCents: 50 });
    expect(wd.rows.map((r: any) => [r.status, r.amountCents])).toEqual([["rejected", 50], ["pending", 100], ["paid", 500]]);
    expect(wd.rows[2]).toMatchObject({ bank: "Test Bank", ibanTail: "•••• 7519", paymentRef: "TRF-1" });
    expect(JSON.stringify(wd)).not.toContain("SA0380000000608010167519"); // never the full IBAN
    expect((await get(w.admin, `${BASE}/${w.d3.id}/withdrawals?period=all&status=open`)).json.total).toBe(1);
    expect((await get(w.admin, `${BASE}/${w.d3.id}/withdrawals?from=2026-05-13&to=2026-05-14`)).json.total).toBe(1);
  });

  it("cash on delivery: per order with warehouse and the office at the time of the job; period figures vs outstanding now", async () => {
    const w = await seedFinanceDriversWorld();
    const c = (await get(w.admin, `${BASE}/${w.d1.id}/cash?${PERIOD}`)).json;
    expect(c.total).toBe(1);
    expect(c.rows[0]).toMatchObject({ ref: expect.stringMatching(/^FL-/), collectedCents: 5000, remittedCents: 3000, outstandingCents: 2000, parcels: 1, officeId: w.o1.id, warehouseCity: "riyadh" });
    expect(c.rows[0].officeName).toMatch(/^Off /);
    expect(c.rows[0].warehouse).toBe(`Co ${w.biz.name}`); // no pickup address: the company name
    expect(c.totals).toEqual({ collectedCents: 5000, remittedCents: 3000, outstandingCents: 2000 });
    // only the 11th: no collection that day, the 3 000 hand-over is inside; what the driver still holds is "now", not "that day"
    const day11 = (await get(w.admin, `${BASE}/${w.d1.id}/cash?from=2026-05-11&to=2026-05-11`)).json;
    expect(day11.rows[0]).toMatchObject({ collectedCents: 0, remittedCents: 3000, outstandingCents: 2000 });
    expect((await get(w.admin, `${BASE}/${w.d1.id}/cash?from=2026-05-12&to=2026-05-12`)).json.total).toBe(0);
    expect((await get(w.admin, `${BASE}/${w.d2.id}/cash?${PERIOD}&status=outstanding`)).json.totals.outstandingCents).toBe(8000);
    expect((await get(w.admin, `${BASE}/${w.d3.id}/cash?period=all`)).json.total).toBe(0);
  });

  it("statement: one chronological journal of settlements, wallet entries and cash; the balance only on wallet rows; filter by source", async () => {
    const w = await seedFinanceDriversWorld();
    const s1 = (await get(w.admin, `${BASE}/${w.d1.id}/statement?${PERIOD}`)).json;
    expect(s1.total).toBe(4);
    expect(s1.rows.map((r: any) => r.source).sort()).toEqual(["cod_collected", "cod_remitted", "settlement", "settlement"]);
    const times = s1.rows.map((r: any) => Date.parse(r.at)); expect(times).toEqual([...times].sort((a, b) => b - a));
    expect(s1.totals).toMatchObject({ settlementCents: 3500, cashInCents: 5000, cashOutCents: 3000, walletInCents: 0, walletOutCents: 0 });
    expect(s1.rows.filter((r: any) => r.balanceCents !== null)).toEqual([]);
    expect(s1.rows.find((r: any) => r.source === "cod_remitted")).toMatchObject({ amountCents: -3000, inCents: 0, outCents: 3000 });
    expect(s1.rows.find((r: any) => r.source === "settlement" && r.kind === "paid").office).toMatch(/^Off /);
    const s3 = (await get(w.admin, `${BASE}/${w.d3.id}/statement?period=all`)).json;
    expect(s3.total).toBe(8);
    expect(s3.totals).toMatchObject({ settlementCents: 1050, walletInCents: 1100, walletOutCents: 850, walletN: 7 });
    expect(s3.rows.filter((r: any) => r.source === "wallet").every((r: any) => typeof r.balanceCents === "number")).toBe(true);
    expect((await get(w.admin, `${BASE}/${w.d3.id}/statement?period=all&kind=wallet`)).json.total).toBe(7);
    expect((await get(w.admin, `${BASE}/${w.d1.id}/statement?${PERIOD}&kind=cod_collected&pageSize=1`)).json.rows).toHaveLength(1);
    // cash collected in one order on one day is ONE row, and a period boundary never splits it
    expect((await get(w.admin, `${BASE}/${w.d1.id}/statement?from=2026-05-11&to=2026-05-12`)).json.rows.map((r: any) => r.source)).toEqual(["cod_remitted"]);
  });
});
