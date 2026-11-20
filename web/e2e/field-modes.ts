import { expect, type Browser } from "@playwright/test";
import { staffLogin } from "./helpers";

/**
 * Platform update J2 / J3: `routingEnabled` and `b2bShipmentsEnabled` are OFF by default. Specs that drive route planning, "Approve route", the one-stop-at-a-time
 * lock, re-ordering or business-type parcels switch them on for their own run through the admin settings API and put the previous values back afterwards:
 *
 *   let saved: FieldModes;
 *   test.beforeAll(async ({ browser }) => { saved = await setFieldModes(browser, { routingEnabled: true, b2bShipmentsEnabled: true }); });
 *   test.afterAll(async ({ browser }) => { await setFieldModes(browser, saved); });
 */
const BASE = `http://localhost:${process.env.E2E_PORT ?? 3101}`; // not 3100: other projects on this machine use it
const ADMIN = { email: "admin@jrlogistics.test", password: "E2e!Password2026" };
export interface FieldModes { routingEnabled: boolean; b2bShipmentsEnabled: boolean }

/** PATCHes the platform settings as the super admin and returns the values as they were BEFORE the change. */
export async function setFieldModes(browser: Browser, patch: Partial<FieldModes>): Promise<FieldModes> {
  const ctx = await browser.newContext();
  try {
    const page = await ctx.newPage();
    await staffLogin(page, ADMIN.email, ADMIN.password); // reuses the saved session of an earlier sign-in in this run
    const call = (method: "GET" | "PATCH", data?: unknown) => ctx.request.fetch(`${BASE}/api/v1/admin/settings`, { method, data, headers: { origin: BASE, "content-type": "application/json" } });
    const before = await (await call("GET")).json();
    const res = await call("PATCH", patch);
    expect(res.status(), `PATCH /admin/settings ${JSON.stringify(patch)}`).toBe(200);
    return { routingEnabled: before.routingEnabled === true, b2bShipmentsEnabled: before.b2bShipmentsEnabled === true };
  } finally { await ctx.close(); }
}
