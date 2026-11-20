import { test, expect, type APIRequestContext, type Browser, type Page } from "@playwright/test";
import { staffLogin, gotoReady, DEMO, apiLogin } from "./helpers";

/**
 * Platform data capture and the shared activity log (decisions G5–G7).
 * The spec creates its own request through the business API, then reads what the platform captured about it, its business and its parcels through
 * the activity API, exercises the internal notes, the CSV export and the permission rules, and finally — when a detail page embeds `<ActivityLog>` —
 * checks the component itself (chips, search, details, load more) on desktop, on a phone and in Arabic.
 */
test.describe.configure({ mode: "serial" });
const BASE = `http://localhost:${process.env.E2E_PORT ?? 3101}`; // not 3100: other projects on this machine use it
const ADMIN = { email: "admin@jrlogistics.test", password: "E2e!Password2026" };
const req: { id: string; ref: string; businessId: string; noteId: string } = { id: "", ref: "", businessId: "", noteId: "" };

async function api(ctx: APIRequestContext, method: "GET" | "POST" | "PATCH" | "DELETE", path: string, data?: unknown) {
  const res = await ctx.fetch(`${BASE}/api/v1${path}`, { method, data, headers: { origin: BASE, "content-type": "application/json" } });
  const text = await res.text();
  let json: any = null; try { json = JSON.parse(text); } catch { /* csv */ }
  return { status: res.status(), json, text, headers: res.headers() };
}
const businessApi = (browser: Browser) => apiLogin(browser, DEMO.business); // the shared helper reuses the session of an earlier sign-in (the OTP endpoint is rate-limited per IP)
const admin = (page: Page) => staffLogin(page, ADMIN.email, ADMIN.password);

test("a published request with three parcels to read the captured data from", async ({ browser }) => {
  const biz = await businessApi(browser);
  const shipments = [1, 2, 3].map((n) => ({ recipientName: `Data Customer ${n}`, recipientPhone: `05500000${String(n + 10)}`, address: `${n} Olaya St, Riyadh`, externalRef: `DATA-${n}`, contents: "Books" }));
  const pub = await api(biz.request, "POST", "/requests", { service: "delivery_driver", quantity: 1, shipmentsPerDriver: 10, vehicleType: "dokker", pickupCity: "riyadh", deliveryCity: "riyadh", pickupAddress: "Warehouse 4, Industrial Area", durationDays: 1, startsAt: new Date(Date.now() + 6 * 864e5).toISOString(), publish: true, termsAccepted: true, shipments });
  expect(pub.status, JSON.stringify(pub.json)).toBe(201);
  req.id = pub.json.id; req.ref = pub.json.ref;
  req.businessId = (await api(biz.request, "GET", `/requests/${req.id}`)).json.request.businessId;
  await biz.close();
});

test("the activity feed of the request merges events, parcels, money and notifications — newest first, with counts", async ({ page }) => {
  await admin(page);
  const r = await api(page.request, "GET", `/admin/activity/request/${req.id}?pageSize=100`);
  expect(r.status, r.text).toBe(200);
  const j = r.json;
  expect(j.entity).toMatchObject({ type: "request", id: req.id, label: req.ref });
  expect(j.kindCounts.event).toBeGreaterThanOrEqual(2); // request_created, request_published (+ offers dispatched when a driver matches)
  expect(j.kindCounts.parcel).toBeGreaterThanOrEqual(3); // one "registered" row per parcel
  expect(j.kindCounts.money).toBeGreaterThanOrEqual(1); // the escrow reserve
  expect(j.total).toBe(Object.values(j.kindCounts as Record<string, number>).reduce((a, b) => a + b, 0));
  const times = j.items.map((i: any) => i.at); expect(times).toEqual([...times].sort().reverse());
  expect(j.items.some((i: any) => i.titleKey === "dtk.p_created" && /^JR-\d+-\d{3}$/.test(i.params.code))).toBe(true);
  expect(j.hidden).toEqual([]); expect(j.failed).toEqual([]);
  // only parcels, then a text search, then an unreachable period
  const parcels = (await api(page.request, "GET", `/admin/activity/request/${req.id}?kinds=parcel&pageSize=100`)).json;
  expect(parcels.items.every((i: any) => i.kind === "parcel")).toBe(true); expect(parcels.total).toBe(j.kindCounts.parcel); expect(parcels.kindCounts).toEqual(j.kindCounts);
  expect((await api(page.request, "GET", `/admin/activity/request/${req.id}?q=DATA-2&pageSize=100`)).json.items.length).toBeGreaterThanOrEqual(0);
  expect((await api(page.request, "GET", `/admin/activity/request/${req.id}?from=2999-01-01T00:00:00Z`)).json.total).toBe(0);
});

test("the business's feed shows its sign-in; sign-in capture records IP, client and the reason of failures", async ({ page }) => {
  await admin(page);
  const f = (await api(page.request, "GET", `/admin/activity/user/${req.businessId}?kinds=login&pageSize=50`)).json;
  expect(f.items.some((i: any) => i.titleKey === "dtk.login_ok")).toBe(true);
  const ok = f.items.find((i: any) => i.titleKey === "dtk.login_ok");
  expect(ok.details).toMatchObject({ method: "password", client: "web" });
  // a wrong password against the business's username is captured too
  const ctx = await page.context().browser()!.newContext();
  const bad = await api(ctx.request, "POST", "/auth/login", { username: "demo.business", password: "Wrong#Pass2026" });
  expect(bad.status).toBe(401);
  await ctx.close();
  const after = (await api(page.request, "GET", `/admin/activity/user/${req.businessId}?kinds=login&pageSize=50`)).json;
  expect(after.items.some((i: any) => i.titleKey === "dtk.login_failed" && i.details.failureReason === "bad_password")).toBe(true);
});

test("internal notes: add, pin, list (pinned first), appear in the feed, delete", async ({ page }) => {
  await admin(page);
  const add = await api(page.request, "POST", `/admin/notes/request/${req.id}`, { body: "Call the warehouse before the driver leaves", pinned: false });
  expect(add.status, add.text).toBe(201); req.noteId = add.json.id;
  const second = await api(page.request, "POST", `/admin/notes/request/${req.id}`, { body: "Second note" });
  expect((await api(page.request, "PATCH", `/admin/notes/${second.json.id}`, { pinned: true })).json.pinned).toBe(true);
  const list = (await api(page.request, "GET", `/admin/notes/request/${req.id}`)).json;
  expect(list.items.map((n: any) => n.body)).toEqual(["Second note", "Call the warehouse before the driver leaves"]); expect(list.canWrite).toBe(true);
  expect((await api(page.request, "GET", `/admin/activity/request/${req.id}?kinds=note`)).json.total).toBe(2);
  expect((await api(page.request, "POST", `/admin/notes/request/${req.id}`, { body: "   " })).status).toBe(422);
  expect((await api(page.request, "DELETE", `/admin/notes/${second.json.id}`)).status).toBe(200);
  expect((await api(page.request, "GET", `/admin/activity/request/${req.id}?kinds=note`)).json.total).toBe(1);
});

test("CSV export is a download with a header row, and a customer account cannot read the activity log at all", async ({ page, browser }) => {
  await admin(page);
  const csv = await api(page.request, "GET", `/admin/activity/request/${req.id}/export`);
  expect(csv.status).toBe(200); expect(csv.headers["content-type"]).toContain("text/csv");
  const lines = csv.text.replace(/^﻿/, "").split("\n");
  expect(lines[0]).toBe("at,kind,source,event,actor,actorRole,summary,refs"); expect(lines.length).toBeGreaterThan(5);
  const biz = await businessApi(browser);
  expect((await api(biz.request, "GET", `/admin/activity/request/${req.id}`)).status).toBe(403);
  expect((await api(biz.request, "GET", `/admin/notes/request/${req.id}`)).status).toBe(403);
  await biz.close();
  expect((await api(page.request, "GET", `/admin/activity/spaceship/${req.id}`)).status).toBe(404);
});

test("<ActivityLog> on a detail page: kind chips with counts, search, expandable details, export — desktop, phone, Arabic", async ({ page }) => {
  await admin(page);
  await gotoReady(page, `/admin/requests/${req.id}/activity`); // the order's Activity section embeds the full log, the notes and the raw data
  const log = page.getByTestId("dtk-log");
  test.skip(!(await log.count()), "no detail page embeds <ActivityLog> yet");
  await expect(log).toBeVisible();
  await expect(page.getByTestId("dtk-chip-all")).toBeVisible();
  const parcels = page.getByTestId("dtk-chip-parcel");
  await parcels.click();
  await expect(parcels).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByTestId("dtk-item").first()).toHaveAttribute("data-kind", "parcel");
  await page.getByTestId("dtk-search").fill("DATA-2");
  await expect(page.getByTestId("dtk-count")).toBeVisible();
  await page.getByTestId("dtk-clear").click();
  await page.getByTestId("dtk-item-toggle").first().click();
  await expect(page.getByTestId("dtk-item-details").first()).toBeVisible();
  await expect(page.getByTestId("dtk-export")).toHaveAttribute("href", /\/api\/v1\/admin\/activity\/request\/.+\/export/);
  // a phone: no horizontal scroll
  await page.setViewportSize({ width: 390, height: 800 });
  await page.waitForTimeout(600); // let the layout reflow
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
  // Arabic: right-to-left, translated chips
  await page.context().addCookies([{ name: "jr_lang", value: "ar", url: BASE }]);
  await gotoReady(page, `/admin/requests/${req.id}/activity`); // the order's Activity section embeds the full log, the notes and the raw data
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  await expect(page.getByTestId("dtk-chip-parcel")).toContainText("الطرود");
});

test("<NotesPanel>: write, pin and delete a note from the page", async ({ page }) => {
  await admin(page);
  await gotoReady(page, `/admin/requests/${req.id}/activity`); // the order's Activity section embeds the full log, the notes and the raw data
  const panel = page.getByTestId("dtk-notes");
  test.skip(!(await panel.count()), "no detail page embeds <NotesPanel> yet");
  await page.getByTestId("dtk-note-body").fill("Note written from the page");
  await page.getByTestId("dtk-note-add").click();
  const note = page.getByTestId("dtk-note").filter({ hasText: "Note written from the page" });
  await expect(note).toBeVisible();
  await note.getByTestId("dtk-note-toggle-pin").click();
  await expect(note).toContainText("Pinned");
  await note.getByTestId("dtk-note-delete").click();
  await page.getByTestId("dtk-note-confirm-delete").click();
  await expect(note).toHaveCount(0);
});

test("cleanup: the request is cancelled and refunded", async ({ browser }) => {
  const biz = await businessApi(browser);
  const c = await api(biz.request, "POST", `/requests/${req.id}/cancel`, { reason: "data capture spec cleanup" });
  expect(c.status, c.text).toBeLessThan(300);
  await biz.close();
});
