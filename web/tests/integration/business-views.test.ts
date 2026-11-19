/**
 * Company-portal redesign: the data its new views read — the wallet statement's kind filter, the company's invoices,
 * the dashboard's delivered-parcel counts and the orders list's "any of these statuses" filter.
 */
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { invoices, shipments } from "@/db/schema";
import { resetDb, shutdown, mkAdmin, mkBusiness, mkRule, publishedRequest, reqInput } from "../helpers/factories";
import { call } from "../helpers/api";
import { createSession } from "@/server/auth/session";
import { createDraft } from "@/server/requests";

beforeEach(resetDb);
afterAll(shutdown);

const tok = async (u: { id: string }) => (await createSession(u.id, "web")).token;
async function setup() { const admin = await mkAdmin(); await mkRule(admin); const biz = await mkBusiness({ fundsCents: 5000_00 }); return { admin, biz, token: await tok(biz) }; }

describe("wallet statement filter (?kind=)", () => {
  it("narrows the entries and the total to the given ledger kinds; no filter = everything", async () => {
    const { biz, token } = await setup();
    await publishedRequest(biz); // topup (seed) + reserve
    const all = await call("GET", "/wallet", { token });
    expect(all.status).toBe(200);
    const kinds = new Set((all.json.entries as Array<{ kind: string }>).map((e) => e.kind));
    expect(kinds).toEqual(new Set(["topup", "reserve"]));
    const only = await call("GET", "/wallet?kind=reserve", { token });
    expect(only.json.entries.every((e: { kind: string }) => e.kind === "reserve")).toBe(true);
    expect(only.json.total).toBe(1);
    expect(only.json.entries[0].requestRef).toMatch(/^JR-/); // the statement links the entry to its request
    const both = await call("GET", "/wallet?kind=topup,reserve", { token });
    expect(both.json.total).toBe(all.json.total);
    const none = await call("GET", "/wallet?kind=refund", { token });
    expect(none.json.entries).toEqual([]); expect(none.json.total).toBe(0);
    // balances are the account's, whatever the filter
    expect(none.json.availableCents).toBe(all.json.availableCents);
  });
  it("ignores blanks and cannot be used to read another account", async () => {
    const { biz, token } = await setup();
    const other = await mkBusiness({ fundsCents: 100_00 });
    await publishedRequest(biz);
    const r = await call("GET", "/wallet?kind=,,topup,", { token });
    expect(r.status).toBe(200); expect(r.json.entries.every((e: { kind: string }) => e.kind === "topup")).toBe(true);
    const o = await call("GET", "/wallet?kind=topup", { token: await tok(other) });
    expect(o.json.total).toBe(1); expect(o.json.availableCents).toBe(100_00);
  });
});

describe("GET /business/invoices", () => {
  it("lists only the caller's invoices, newest first, with totals", async () => {
    const { biz, token } = await setup();
    const other = await mkBusiness({ fundsCents: 5000_00 });
    const r1 = await publishedRequest(biz); const r2 = await publishedRequest(biz); const ro = await publishedRequest(other);
    const mk = (businessId: string, requestId: string, n: string, total: number, at: Date) => db.insert(invoices).values({ number: n, requestId, businessId, subtotalCents: Math.round(total / 1.15), vatCents: total - Math.round(total / 1.15), totalCents: total, vatPct: 15, createdAt: at });
    await mk(biz.id, r1.id, "INV-A", 11500, new Date(Date.now() - 86_400_000)); await mk(biz.id, r2.id, "INV-B", 23000, new Date()); await mk(other.id, ro.id, "INV-X", 999_00, new Date());
    const res = await call("GET", "/business/invoices", { token });
    expect(res.status).toBe(200);
    expect(res.json.items.map((i: { number: string }) => i.number)).toEqual(["INV-B", "INV-A"]);
    expect(res.json.total).toBe(2);
    expect(res.json.totals).toEqual({ totalCents: 34500, vatCents: 4500 });
    expect(res.json.items[0]).toMatchObject({ requestId: r2.id, requestRef: r2.ref, vatPct: 15 });
    expect((await call("GET", "/business/invoices?page=2", { token })).json.items).toEqual([]);
  });
  it("is for companies only", async () => {
    const admin = await mkAdmin();
    expect((await call("GET", "/business/invoices", { token: await tok(admin) })).status).toBe(403);
    expect((await call("GET", "/business/invoices")).status).toBe(401);
  });
});

describe("dashboard: delivered parcels", () => {
  it("/business/overview reports parcels delivered today and in the last 7 days", async () => {
    const { biz, token } = await setup();
    const r = await publishedRequest(biz, reqInput({ quantity: 1, shipmentsPerDriver: 10 }));
    const rows = await db.select().from(shipments).where(eq(shipments.requestId, r.id));
    expect(rows.length).toBeGreaterThanOrEqual(5);
    const at = (daysAgo: number) => new Date(Date.now() - daysAgo * 86_400_000);
    const set = (i: number, status: string, deliveredAt: Date | null) => db.update(shipments).set({ status, deliveredAt }).where(eq(shipments.id, rows[i].id));
    await set(0, "delivered", new Date()); await set(1, "delivered", new Date()); await set(2, "delivered", at(3)); await set(3, "delivered", at(30)); await set(4, "failed", new Date());
    const ov = await call("GET", "/business/overview", { token });
    expect(ov.status).toBe(200);
    expect(ov.json.parcels).toEqual({ deliveredToday: 2, deliveredWeek: 3 });
    // another company's parcels never count
    const other = await mkBusiness({ fundsCents: 1000_00 });
    expect((await call("GET", "/business/overview", { token: await tok(other) })).json.parcels).toEqual({ deliveredToday: 0, deliveredWeek: 0 });
  });
});

describe("GET /requests?status=a,b", () => {
  it("accepts a comma separated list of statuses (the 'Active' filter) next to a single status", async () => {
    const { biz, token } = await setup();
    const draft = await createDraft(biz, reqInput());
    const live = await publishedRequest(biz);
    const ids = async (q: string) => ((await call("GET", `/requests?${q}`, { token })).json.items as Array<{ id: string }>).map((x) => x.id).sort();
    expect(await ids("status=draft")).toEqual([draft.id]);
    expect(await ids("status=published,filling,assigned,confirmed,in_progress")).toEqual([live.id]);
    expect(await ids("status=draft,published")).toEqual([draft.id, live.id].sort());
    expect(await ids("status=completed,cancelled")).toEqual([]);
  });
});
