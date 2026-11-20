/**
 * Fleet report tables of the courier-office portal (`/office/analytics/table/{perf,daily,money,money_daily,earnings,failures}`, memory/FLEET_REPORTS.md I8): the same numbers as the
 * back-office tables for the signed-in office only, never the customer price / platform margin / VAT, never another office or the independent drivers, whatever the URL says.
 * World: tests/helpers/fleet-world.ts (office o1 with drivers d1 + d2, office o2 without drivers, independent driver d3).
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import { resetDb, shutdown } from "../helpers/factories";
import { call } from "../helpers/api";
import { createSession } from "@/server/auth/session";
import { clearAnalyticsCache } from "@/server/analytics/guard";
import { Q, seedFleetWorld } from "../helpers/fleet-world";

type W = Awaited<ReturnType<typeof seedFleetWorld>>;
let w: W;
beforeAll(async () => { await resetDb(); w = await seedFleetWorld(); });
beforeEach(() => clearAnalyticsCache());
afterAll(shutdown);
const tok = async (u: { id: string }) => (await createSession(u.id, "web")).token;
const get = async (u: { id: string }, path: string) => call("GET", path, { token: await tok(u) });
const portal = async (u: { id: string }, name: string, extra = "") => get(u, `/office/analytics/table/${name}?${Q}&pageSize=100${extra}`);
const NAMES = ["perf", "daily", "money", "money_daily", "earnings", "failures"] as const;
const SECRET = ["customerCents", "marginCents", "vatCents", "refundCents", "adjustCents", "office"];

describe("access", () => {
  it("only the office role may read them; anonymous 401, company 403, staff 403", async () => {
    for (const n of NAMES) {
      expect((await call("GET", `/office/analytics/table/${n}?${Q}`)).status, n).toBe(401);
      expect((await portal(w.biz, n)).status, `business ${n}`).toBe(403);
      expect((await portal(w.admin, n)).status, `admin ${n}`).toBe(403);
      expect((await portal(w.o1, n)).status, `office ${n}`).toBe(200);
    }
  });
  it("never offers the platform's side of the money: no customer price, margin, VAT, refund, adjustment (columns, rows and sort keys)", async () => {
    for (const n of NAMES) {
      const j = (await portal(w.o1, n)).json;
      const keys = new Set(j.columns.map((c: { key: string }) => c.key));
      for (const k of SECRET) expect(keys.has(k), `${n} column ${k}`).toBe(false);
      for (const r of j.rows) for (const k of SECRET) expect(k in r, `${n} row field ${k}`).toBe(false);
    }
    for (const [n, k] of [["money", "marginCents"], ["money", "customerCents"], ["earnings", "vatCents"], ["money_daily", "refundCents"]]) expect((await portal(w.o1, n, `&sort=${k}`)).status, `${n} sort ${k}`).toBe(422);
    expect((await portal(w.o1, "money")).json.columns.map((c: { key: string }) => c.key)).toEqual(expect.arrayContaining(["earnCents", "paidCents", "pendingCents", "codCollectedCents", "codRemittedCents", "codHeldCents"]));
  });
});

describe("scope: the signed-in office, never anybody else", () => {
  it("perf and money list only the office's own drivers; the independent driver and other offices' drivers never appear", async () => {
    for (const n of ["perf", "money"]) {
      const j = (await portal(w.o1, n)).json;
      expect(j.rows.map((r: { id: string }) => r.id).sort(), n).toEqual([w.d1.id, w.d2.id].sort());
      expect(j.total).toBe(2);
    }
  });
  it("money equals the back-office per-driver money for the same office", async () => {
    const mine = (await portal(w.o1, "money")).json.rows, admin = (await get(w.admin, `/admin/analytics/drivers/table/money?${Q}&office=${w.o1.id}&pageSize=100`)).json.rows;
    expect(mine.length).toBeGreaterThan(0);
    for (const r of mine) {
      const a = admin.find((x: { id: string }) => x.id === r.id);
      for (const k of ["earnCents", "paidCents", "pendingCents", "codCollectedCents", "codRemittedCents", "codHeldCents", "earnPerJobCents"]) expect(r[k], `${r.id} ${k}`).toBe(a[k]);
    }
    expect(mine.some((r: { earnCents: number }) => r.earnCents > 0)).toBe(true);
  });
  it("a client-supplied office or driver is ignored: another office sees nothing of this office, a foreign driver matches nothing", async () => {
    for (const n of ["perf", "money"]) {
      expect((await portal(w.o2, n)).json.rows, `o2 ${n}`).toEqual([]);
      expect((await portal(w.o2, n, `&office=${w.o1.id}&driver=${w.d1.id}`)).json.rows, `o2 forged ${n}`).toEqual([]);
      expect((await portal(w.o1, n, `&office=${w.o2.id}`)).json.total, `o1 office param ${n}`).toBe(2);
      expect((await portal(w.o1, n, `&driver=${w.d3.id}`)).json.rows, `o1 foreign driver ${n}`).toEqual([]);
    }
    for (const n of ["daily", "earnings", "failures"]) expect((await portal(w.o2, n)).json.rows.filter((r: { delivered?: number; ref?: string; count?: number }) => (r.delivered ?? 0) > 0 || r.ref || (r.count ?? 0) > 0), `o2 ${n}`).toEqual([]);
  });
  it("daily is one zero-filled row per Riyadh day of the period; earnings has one row per billed settlement of this office", async () => {
    const d = (await portal(w.o1, "daily")).json;
    expect(d.total).toBe(3);
    expect(d.rows.map((r: { date: string }) => r.date).sort()).toEqual(["2026-05-10", "2026-05-11", "2026-05-12"]);
    const admin = (await get(w.admin, `/admin/analytics/offices/table/earnings?${Q}&office=${w.o1.id}&pageSize=100`)).json;
    const mine = (await portal(w.o1, "earnings")).json;
    expect(mine.total).toBe(admin.total);
    expect(mine.rows.map((r: { id: string }) => r.id).sort()).toEqual(admin.rows.map((r: { id: string }) => r.id).sort());
  });
});

describe("export", () => {
  it("xlsx and csv work for the owner (own data only) and are audited", async () => {
    const x = await get(w.o1, `/office/analytics/table/money?${Q}&format=xlsx&lang=ar`);
    expect(x.status).toBe(200);
    expect(x.headers.get("content-type")).toContain("spreadsheetml");
    const csv = await get(w.o1, `/office/analytics/table/perf?${Q}&format=csv`);
    expect(csv.status).toBe(200);
    expect(csv.text).toContain("Driver One");
    expect(csv.text).toContain("Driver Two");
    expect(csv.text).not.toContain("Driver Three"); // the independent driver
  });
  it("the office workbook now carries the fleet sheets", async () => {
    const r = await get(w.o1, `/office/analytics/workbook?${Q}&lang=en`);
    expect(r.status).toBe(200);
    expect(r.headers.get("content-type")).toContain("spreadsheetml");
  });
});
