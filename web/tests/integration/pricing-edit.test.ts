/**
 * Editing price rules (`PUT /admin/pricing/:id`) and their version history (`GET /admin/pricing/:id/history`).
 * A rule is an immutable record: an edit saves the NEXT VERSION of the same scope and retires the active one; applied to a retired rule it restores that version.
 */
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { auditLogs, pricingRules } from "@/db/schema";
import { resetDb, shutdown, mkAdmin, mkBusiness, mkRule, mkStaff, publishedRequest } from "../helpers/factories";
import { call } from "../helpers/api";
import { createSession } from "@/server/auth/session";
import { listRules } from "@/server/pricing";

beforeEach(resetDb);
afterAll(shutdown);
const tok = async (u: { id: string }) => (await createSession(u.id, "web")).token;
const send = async (u: { id: string }, method: string, path: string, body?: unknown) => call(method, path, { token: await tok(u), ...(body !== undefined ? { body } : {}) });

describe("PUT /admin/pricing/:id", () => {
  it("saves the next version of the same scope, retires the old one and records what changed", async () => {
    const admin = await mkAdmin(); const v1 = await mkRule(admin);
    const r = await send(admin, "PUT", `/admin/pricing/${v1.id}`, { priceCents: 1200, providerCostCents: 800, agreementRef: "AGR-7", notes: "Q4 tariff" });
    expect(r.status, r.text).toBe(200);
    expect(r.json).toMatchObject({ version: 2, priceCents: 1200, providerCostCents: 800, agreementRef: "AGR-7", notes: "Q4 tariff", status: "approved", service: "delivery_driver", vehicleType: "sedan", pickupCity: "riyadh", deliveryCity: "riyadh", businessId: null });
    const [old] = await db.select().from(pricingRules).where(eq(pricingRules.id, v1.id));
    expect(old.status).toBe("retired"); expect(old.priceCents).toBe(1000); // the old record is untouched
    const active = (await listRules({ service: "delivery_driver" }));
    expect(active).toHaveLength(1); expect(active[0]).toMatchObject({ id: r.json.id, priceCents: 1200 });
    const [a] = await db.select().from(auditLogs).where(and(eq(auditLogs.action, "pricing.edit"), eq(auditLogs.entityId, r.json.id)));
    expect(a.diff).toMatchObject({ from: v1.id, fromVersion: 1, version: 2, changes: { priceCents: { from: 1000, to: 1200 }, providerCostCents: { from: 700, to: 800 }, agreementRef: { from: null, to: "AGR-7" } } });
  });

  it("changes only what was sent and keeps the rest", async () => {
    const admin = await mkAdmin(); const v1 = await mkRule(admin, { agreementRef: "AGR-1", notes: "keep" });
    const r = await send(admin, "PUT", `/admin/pricing/${v1.id}`, { priceCents: 1100 });
    expect(r.json).toMatchObject({ version: 2, priceCents: 1100, providerCostCents: 700, agreementRef: "AGR-1", notes: "keep" });
    const cleared = await send(admin, "PUT", `/admin/pricing/${r.json.id}`, { agreementRef: null, expiresAt: new Date(Date.now() + 30 * 864e5).toISOString() });
    expect(cleared.json).toMatchObject({ version: 3, agreementRef: null, priceCents: 1100 }); expect(cleared.json.expiresAt).toBeTruthy();
  });

  it("refuses an edit that changes nothing, a cost above the price, and an expiry in the past", async () => {
    const admin = await mkAdmin(); const v1 = await mkRule(admin);
    expect((await send(admin, "PUT", `/admin/pricing/${v1.id}`, {})).status).toBe(422);
    expect((await send(admin, "PUT", `/admin/pricing/${v1.id}`, { priceCents: 1000, providerCostCents: 700 })).status).toBe(422);
    expect((await send(admin, "PUT", `/admin/pricing/${v1.id}`, { providerCostCents: 1500 })).status).toBe(422);
    const past = await send(admin, "PUT", `/admin/pricing/${v1.id}`, { expiresAt: new Date(Date.now() - 864e5).toISOString() });
    expect(past.status).toBe(422); expect(JSON.stringify(past.json)).toContain("expiresAt");
    expect((await listRules({ service: "delivery_driver" }))[0].id).toBe(v1.id); // nothing was saved by the refused calls
  });

  it("only touches its own scope: a company price and the global price are separate rules", async () => {
    const admin = await mkAdmin(); const biz = await mkBusiness({ fundsCents: 1000_00 });
    const global = await mkRule(admin); const own = await mkRule(admin, { businessId: biz.id, priceCents: 900, providerCostCents: 600 });
    const r = await send(admin, "PUT", `/admin/pricing/${own.id}`, { priceCents: 950 });
    expect(r.json).toMatchObject({ version: 2, businessId: biz.id, priceCents: 950 });
    const active = await listRules({ service: "delivery_driver" });
    expect(active).toHaveLength(2); expect(active.find((x) => x.id === global.id)).toMatchObject({ priceCents: 1000, status: "approved" });
  });

  it("restores a retired version as the newest one", async () => {
    const admin = await mkAdmin(); const v1 = await mkRule(admin);
    const v2 = (await send(admin, "PUT", `/admin/pricing/${v1.id}`, { priceCents: 1300 })).json;
    const back = await send(admin, "PUT", `/admin/pricing/${v1.id}`, {});
    expect(back.status, back.text).toBe(200);
    expect(back.json).toMatchObject({ version: 3, priceCents: 1000, providerCostCents: 700, status: "approved" });
    const [r2] = await db.select().from(pricingRules).where(eq(pricingRules.id, v2.id)); expect(r2.status).toBe("retired");
    const [a] = await db.select().from(auditLogs).where(and(eq(auditLogs.action, "pricing.restore"), eq(auditLogs.entityId, back.json.id)));
    expect(a.diff).toMatchObject({ from: v1.id, fromVersion: 1, version: 3 });
  });

  it("needs pricing.edit; unknown and malformed ids are 404", async () => {
    const admin = await mkAdmin(); const v1 = await mkRule(admin); const biz = await mkBusiness({ fundsCents: 100_00 });
    const viewer = await mkStaff(["pricing.view"]); const editor = await mkStaff(["pricing.edit"]);
    expect((await call("PUT", `/admin/pricing/${v1.id}`, { body: { priceCents: 1100 } })).status).toBe(401);
    expect((await send(biz, "PUT", `/admin/pricing/${v1.id}`, { priceCents: 1100 })).status).toBe(403);
    expect((await send(viewer, "PUT", `/admin/pricing/${v1.id}`, { priceCents: 1100 })).status).toBe(403);
    expect((await send(editor, "PUT", `/admin/pricing/${v1.id}`, { priceCents: 1100 })).status).toBe(200);
    for (const id of ["11111111-1111-4111-8111-111111111111", "not-a-uuid"]) {
      expect((await send(admin, "PUT", `/admin/pricing/${id}`, { priceCents: 1100 })).status, id).toBe(404);
      expect((await send(admin, "GET", `/admin/pricing/${id}/history`)).status, id).toBe(404);
    }
  });
});

describe("GET /admin/pricing/:id/history", () => {
  it("lists every version of the scope newest first with who saved it and how many orders were quoted with it", async () => {
    const admin = await mkAdmin(); const biz = await mkBusiness({ fundsCents: 5000_00 });
    const v1 = await mkRule(admin);
    await publishedRequest(biz); await publishedRequest(biz); // quoted with v1
    const v2 = (await send(admin, "PUT", `/admin/pricing/${v1.id}`, { priceCents: 1400 })).json;
    await publishedRequest(biz); // quoted with v2
    const h = await send(admin, "GET", `/admin/pricing/${v2.id}/history`);
    expect(h.status, h.text).toBe(200);
    expect(h.json.current).toBe(v2.id); expect(h.json.scope).toMatchObject({ service: "delivery_driver", vehicleType: "sedan", businessId: null });
    expect(h.json.items.map((x: any) => [x.version, x.status, x.usedBy])).toEqual([[2, "approved", 1], [1, "retired", 2]]);
    expect(h.json.items[0].createdByName).toBe("Admin");
    // the history of an old version shows the same scope
    expect((await send(admin, "GET", `/admin/pricing/${v1.id}/history`)).json.items).toHaveLength(2);
    // other scopes are not mixed in
    await mkRule(admin, { vehicleType: "van", temperature: "dry" });
    expect((await send(admin, "GET", `/admin/pricing/${v2.id}/history`)).json.items).toHaveLength(2);
  });

  it("is open to pricing.view and refused to everyone else", async () => {
    const admin = await mkAdmin(); const v1 = await mkRule(admin); const biz = await mkBusiness({ fundsCents: 100_00 });
    expect((await send(await mkStaff(["pricing.view"]), "GET", `/admin/pricing/${v1.id}/history`)).status).toBe(200);
    expect((await send(await mkStaff(["requests.view"]), "GET", `/admin/pricing/${v1.id}/history`)).status).toBe(403);
    expect((await send(biz, "GET", `/admin/pricing/${v1.id}/history`)).status).toBe(403);
  });
});
