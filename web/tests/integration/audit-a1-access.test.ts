/**
 * Audit K / A1 — access control regression suite (see memory/audit/security.md).
 *  1. a staff member holding NO permission is refused by every `backoffice` route (the handlers are called directly with real ids, so a lookup that
 *     runs before the permission check shows up as a non-FORBIDDEN answer);
 *  2. a second business / driver / courier office, a staff member with unrelated permissions and one with none cannot read or change another party's
 *     request, job, parcel, invoice, ticket, document, API key, partner connection, invitation ... through ANY route that takes an `:id`;
 *  3. positive controls: the real owner is let in (so the matrix is not green merely because every id 404s).
 */
import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from "vitest";
import bcrypt from "bcryptjs";
import { and, eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { writeFileSync } from "node:fs";
import "@/server/api/routes";
import { routeTable, dispatch, type Ctx } from "@/server/api/router";
import { db } from "@/db";
import { driverProfiles, invoices, loginEvents, officeProfiles, offers, pricingRules, requests, shipmentMedia, shipments, users, type User } from "@/db/schema";
import { resetDbWithFieldModes } from "../helpers/field-modes";
import { shutdown, mkAdmin, mkBusiness, mkDriver, mkOffice, mkRule, mkStaff, mkShipments, publishedRequest, reqInput, WAREHOUSE } from "../helpers/factories";
import { work } from "../helpers/work";
import { setStorage, type StorageAdapter } from "@/server/storage";
import { isBackoffice } from "@/server/auth/permissions";
import * as jobs from "@/server/jobs";
import { handoverCustody, createTicket, fileComplaint, uploadTicketAttachment } from "@/server/support";
import { submitDocument, loginWithPassword } from "@/server/accounts";
import { createSession } from "@/server/auth/session";
import { call, TEST_PASSWORD } from "../helpers/api";
import { createApiKey } from "@/server/integrations";
import { createConnection } from "@/server/partners/service";
import { inviteDriver, createAgreement } from "@/server/office";
import { addNote } from "@/server/notes";
import { REPORT_TYPES } from "@/server/ops";
import { ALL_PERMISSIONS } from "@/server/catalog";
import { listTables } from "@/server/analytics/registry";
import { listPortalTables } from "@/server/analytics/portal-registry";
import { allDatasets } from "@/server/analytics/explorer-registry";
import { PORTAL_KEYS } from "@/server/analytics/portal-scope";

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
const mem = new Map<string, Buffer>();
const memoryStorage: StorageAdapter = { name: "mem", put: async (k, d) => { mem.set(k, d); }, get: async (k) => { const b = mem.get(k); if (!b) throw Object.assign(new Error("nf"), { code: "NOT_FOUND" }); return b; }, remove: async (k) => { mem.delete(k); } };

interface World {
  admin: User; bizA: User; bizB: User; drvA: User; drvB: User; drvC: User; drvD: User; drvOA: User; offA: User; offB: User; staffZ: User; staffFin: User; staffOps: User;
  ids: Record<string, string>;
}
let w: World;

type Route = ReturnType<typeof routeTable>[number];
const roleOk = (r: Route, u: User) => r.auth === "public" || r.auth === "user" || (r.auth === "backoffice" ? isBackoffice(u) : Array.isArray(r.auth) && r.auth.includes(u.role as never));

async function invoke(r: Route, user: User, params: Record<string, string>, input: unknown = {}, q: unknown = {}, form?: () => FormData) {
  const ctx = {
    req: new Request("http://localhost/api/v1" + r.path, { method: r.method }), user, maybeUser: user, params, query: new URLSearchParams(), body: input, input, q,
    ip: "127.0.0.1", token: "t", viaCookie: false, correlationId: "c", setCookie() {}, clearCookie() {}, raw: { formData: async () => (form ? form() : new FormData()) },
  } as unknown as Ctx & { input: unknown; q: unknown };
  try { const v = await r.handler(ctx); return { ok: true as const, code: "OK", detail: v instanceof Response ? `Response ${v.status}` : "json" }; }
  catch (e) { const x = e as { code?: string; name?: string; message?: string }; return { ok: false as const, code: x.code ?? x.name ?? "ERR", detail: String(x.message).slice(0, 80) }; }
}

beforeAll(async () => {
  await resetDbWithFieldModes();
  setStorage(memoryStorage);
  const admin = await mkAdmin(); await mkRule(admin);
  const [bizA, bizB] = [await mkBusiness({ fundsCents: 5000_00 }), await mkBusiness({ fundsCents: 1000_00 })];
  const offA = await mkOffice(), offB = await mkOffice();
  const [drvA, drvB, drvC, drvD] = [await mkDriver(), await mkDriver(), await mkDriver(), await mkDriver()];
  const drvOA = await mkDriver({ officeId: offA.id });
  const staffZ = await mkStaff([]), staffFin = await mkStaff(["finance.view", "reports.view", "users.view"]), staffOps = await mkStaff(["requests.view", "requests.edit", "tickets.view", "tickets.manage", "notes.manage", "users.view", "drivers.view"]);
  const ids: Record<string, string> = {};
  const offerOf = async (requestId: string, driverId: string) => (await db.select().from(offers).where(and(eq(offers.requestId, requestId), eq(offers.driverId, driverId))))[0];
  const toWarehouse = async (biz: User, d: User, n: number) => {
    const r = await publishedRequest(biz, { shipments: mkShipments(n, { withRefs: true }), shipmentsPerDriver: n });
    const off = await offerOf(r.id, d.id);
    await jobs.acceptOffer(d, off.id, true);
    await db.update(requests).set({ startsAt: new Date(Date.now() + 3600_000) }).where(eq(requests.id, r.id));
    await jobs.checkIn(d, off.id, WAREHOUSE);
    if ((await db.select().from(offers).where(eq(offers.id, off.id)))[0].status === "arrived") await jobs.confirmAttendance(biz, off.id, true);
    return { r, off };
  };
  // a finished job (invoice) by drvD, then the live one by drvA
  const done = await toWarehouse(bizA, drvD, 2);
  await work(bizA, drvD, done.off.id);
  ids.invoice = (await db.select().from(invoices).where(eq(invoices.requestId, done.r.id)))[0]?.id ?? randomUUID();
  const live = await toWarehouse(bizA, drvA, 3);
  const parcel = (await db.select().from(shipments).where(eq(shipments.requestId, live.r.id)))[0];
  Object.assign(ids, { request: live.r.id, offer: live.off.id, shipment: parcel.id, code: parcel.code });
  ids.custody = (await handoverCustody(bizA, live.off.id, [{ itemType: "phone" }]))[0].id;
  ids.ticket = (await createTicket(bizA, { category: "other", subject: "Parcel question" })).id;
  ids.complaint = (await fileComplaint(bizA, { category: "delay", description: "The driver was very late today" })).id;
  ids.attachment = (await uploadTicketAttachment(bizA, { name: "a.png", mime: "image/png", data: PNG })).id;
  ids.document = (await submitDocument(drvA, { type: "national_id", fileName: "id.png", mime: "image/png", data: PNG })).id;
  ids.apiKey = (await createApiKey(bizA, "k1")).id;
  ids.connection = (await createConnection(bizA, { provider: "webhook", name: "Custom" })).id;
  ids.invite = (await inviteDriver(offA, drvC.phone!)).id;
  ids.agreement = (await createAgreement(admin, offA.id, {})).id;
  ids.note = (await addNote(staffOps, "request", live.r.id, "internal")).id;
  const media = (await db.insert(shipmentMedia).values({ shipmentId: ids.shipment, requestId: live.r.id, offerId: live.off.id, kind: "fail", storageKey: "m/test.png", mime: "image/png", usedAt: new Date(), uploadedBy: drvA.id }).returning())[0];
  mem.set("m/test.png", PNG); ids.media = media.id;
  mem.set("p/proof.png", PNG); await db.update(shipments).set({ proofKey: "p/proof.png" }).where(eq(shipments.id, ids.shipment));
  w = { admin, bizA, bizB, drvA, drvB, drvC, drvD, drvOA, offA, offB, staffZ, staffFin, staffOps, ids };
}, 120_000);
afterAll(async () => { setStorage(null); await shutdown(); });

/** Which real record each `:param` of each path means. */
function paramsFor(r: Route): Record<string, string> {
  const { ids, drvOA } = w, p = r.path;
  const pick = (key: string): string => {
    if (key === "sid") return ids.shipment;
    if (key === "mid") return ids.media;
    if (key === "noteId") return ids.note;
    if (key === "type") return REPORT_TYPES[0];
    if (key === "entity") return "request";
    if (key === "driverId") return w.drvA.id;
    if (key === "code") return "JR-000001-001";
    if (key !== "id") return randomUUID();
    if (/^\/admin\/(activity|notes)\//.test(p)) return ids.request;
    if (/^\/admin\/(drivers|offices|companies|users|accounts|staff|finance\/drivers)\//.test(p)) return /unlink-office/.test(p) ? drvOA.id : /offices|companies/.test(p) ? w.offA.id : w.drvA.id;
    if (/^\/admin\/(requests|offers|shipments|parcels|orders)\//.test(p)) return /offers/.test(p) ? ids.offer : ids.request;
    if (/^\/admin\/tickets/.test(p)) return ids.ticket;
    if (/^\/admin\/complaints/.test(p)) return ids.complaint;
    if (/^\/(requests)\/:id/.test(p) || /^\/driver\/requests\/:id/.test(p) || /^\/office\/opportunities\/:id/.test(p)) return ids.request;
    if (/^\/(offers|driver\/jobs|office\/jobs)\/:id/.test(p)) return ids.offer;
    if (/^\/shipments\/:id/.test(p)) return ids.shipment;
    if (/^\/custody\/:id/.test(p)) return ids.custody;
    if (/^\/tickets\/attachments/.test(p)) return ids.attachment;
    if (/^\/tickets\/:id/.test(p)) return ids.ticket;
    if (/^\/complaints\/:id/.test(p)) return ids.complaint;
    if (/^\/documents\/:id/.test(p)) return ids.document;
    if (/^\/business\/invoices\/:id/.test(p)) return ids.invoice;
    if (/api-keys\/:id/.test(p)) return ids.apiKey;
    if (/connections\/:id/.test(p)) return ids.connection;
    if (/^\/office\/invites/.test(p) || /^\/driver\/invites/.test(p)) return ids.invite;
    if (/^\/office\/drivers\/:id/.test(p)) return drvOA.id;
    if (/^\/office\/agreements/.test(p)) return ids.agreement;
    return randomUUID();
  };
  return Object.fromEntries(r.keys.map((k) => [k, pick(k)]));
}

describe("1 · a staff member with no permission is refused by every backoffice route", () => {
  // Static catalogue the staff pages need to render the role editor (no data of anyone).
  const OPEN = new Set(["GET /admin/meta"]);
  // Existence is masked (404) instead of 403 (a note of an entity the viewer cannot open; a driver of an office the viewer may not manage): no information, same result.
  const MASKED = new Set(["DELETE /admin/notes/:noteId", "POST /admin/drivers/:id/unlink-office"]);
  it("every route answers FORBIDDEN", async () => {
    const bad: string[] = []; let n = 0;
    for (const r of routeTable()) {
      if (r.auth !== "backoffice") continue;
      const key = `${r.method} ${r.path}`; n++;
      const got = await invoke(r, w.staffZ, paramsFor(r), r.method === "POST" && /cod\/receive/.test(r.path) ? { offerId: w.ids.offer, amountCents: 100 } : {});
      if (got.code === "FORBIDDEN" || (MASKED.has(key) && got.code === "NOT_FOUND")) continue;
      if (OPEN.has(key) && got.ok) continue;
      bad.push(`${key} -> ${got.code} ${got.detail}`);
    }
    expect(n).toBeGreaterThan(150);
    expect(bad).toEqual([]);
  });
});

describe("1b · the public surface is exactly the reviewed list", () => {
  // Every public route authenticates with something else (credentials in the body, a secret key / token / signed link) or serves non-private facts. A NEW public route
  // must be added here deliberately — which is the moment to ask what it can read or write.
  const REVIEWED = [
    "GET /health", "GET /catalog", "GET /pricing/indicative", "GET /track/:code (code + last 4 digits of the recipient's phone, rate limited)",
    "GET /auth/demo-accounts (404 unless demo mode)", "GET /auth/username-available (rate limited)", "POST /auth/login", "POST /auth/staff/login", "POST /auth/register", "POST /auth/staff/login/mfa",
    "POST /cron/tick (CRON_SECRET)",
    "GET|POST /jobs, GET /jobs/:id, /jobs/:id/shipments, /jobs/:id/events (X-API-Key)",
    "POST /integrations/hooks/... (connection token)", "GET /integrations/labels/:awb/:sig/label.pdf (signed link)",
    "/carriers/omniful/... (connection key / access token)",
  ];
  it("lists them", () => {
    const pub = routeTable().filter((r) => r.auth === "public").map((r) => `${r.method} ${r.path}`);
    const unexpected = pub.filter((x) => !/^(GET \/(health|catalog|pricing\/indicative|track\/:code|auth\/demo-accounts|auth\/username-available|jobs(\/:id(\/shipments|\/events)?)?|integrations\/labels\/:awb\/:sig\/label\.pdf)|POST \/(auth\/(login|staff\/login|register|staff\/login\/mfa)|cron\/tick|jobs|integrations\/hooks\/.*)|(GET|POST) \/carriers\/omniful\/.*)$/.test(x));
    expect(unexpected).toEqual([]);
    expect(pub.some((x) => x.includes("/scenarios"))).toBe(false);
    expect(REVIEWED.length).toBeGreaterThan(10);
  });
});

/** Valid input for the routes whose service validates the body before it looks at who is asking (an empty body would answer 422 and prove nothing): with it the answer must come from the access check. */
const photo = () => { const f = new FormData(); f.set("file", new File([PNG], "a.png", { type: "image/png" })); f.set("kind", "defer"); return f; };
const VALID: Record<string, { input?: () => unknown; form?: () => FormData }> = {
  "POST /tickets/:id/replies": { input: () => ({ body: "hello there" }) },
  "POST /complaints/:id/notes": { input: () => ({ body: "a note on the case" }) },
  "PATCH /requests/:id": { input: () => reqInput() },
  "POST /requests/:id/cancel": { input: () => ({ reason: "not needed any more" }) },
  "PATCH /requests/:id/shipments": { input: () => ({ rows: [{ id: w.ids.shipment, address: "1 New Street, Riyadh" }] }) },
  "POST /shipments/:id/cancel": { input: () => ({ reason: "wrong parcel" }) },
  "POST /offers/:id/rate": { input: () => ({ stars: 5 }) },
  "POST /offers/:id/loading/scan": { input: () => ({ code: w.ids.code }) },
  "POST /offers/:id/loading/unscan": { input: () => ({ code: w.ids.code }) },
  "POST /offers/:id/stops/:sid/fail": { input: () => ({ reason: "refused" }) },
  "POST /offers/:id/stops/:sid/media": { form: photo },
  "POST /offers/:id/stops/:sid/proof": { form: photo },
  "POST /offers/:id/end-route": { input: () => ({ reason: "breakdown" }) },
  "POST /offers/:id/cancel": { input: () => ({ reason: "I am ill" }) },
  "POST /office/jobs/:id/replace": { input: () => ({ reason: "the driver is ill" }) },
};

describe("2 · cross-tenant: nobody reads or changes another party's records by id", () => {
  // Legitimate by design: any eligible driver may apply for / any office may assign onto an open request (the opportunity feed), `:name` tables are report names.
  const BY_DESIGN = new Set(["POST /driver/requests/:id/apply", "POST /office/opportunities/:id/assign", "GET /business/analytics/table/:name", "GET /office/analytics/table/:name"]);
  const GONE = new Set(["FORBIDDEN", "NOT_FOUND", "UNAUTHENTICATED"]);

  it("every :id route refuses the other business / driver / office / unrelated staff", async () => {
    const attackers: Array<[string, User]> = [["bizB", w.bizB], ["drvB", w.drvB], ["offB", w.offB], ["staffZ", w.staffZ], ["staffFin", w.staffFin]];
    const failures: string[] = []; const unclear: string[] = []; let calls = 0;
    for (const r of routeTable()) {
      if (r.auth === "public" || r.auth === "backoffice" || !r.keys.length || BY_DESIGN.has(`${r.method} ${r.path}`)) continue;
      const params = paramsFor(r), valid = VALID[`${r.method} ${r.path}`];
      for (const [name, who] of attackers) {
        if (!roleOk(r, who)) continue; // the router answers 403 before the handler
        const got = await invoke(r, who, params, valid?.input?.() ?? {}, {}, valid?.form); calls++;
        const row = `${name} ${r.method} ${r.path} -> ${got.code} ${got.detail}`;
        if (got.ok) failures.push(row); else if (!GONE.has(got.code)) unclear.push(row);
      }
    }
    expect(calls).toBeGreaterThan(120);
    expect(failures).toEqual([]);
    expect(unclear).toEqual([]);
  });

  it("the invited driver may answer the invitation, a bystander may not", async () => {
    const r = routeTable().find((x) => x.method === "POST" && x.path === "/driver/invites/:id/respond")!;
    const bystander = await invoke(r, w.drvB, { id: w.ids.invite }, { accept: true }, {});
    expect(bystander.code).toBe("NOT_FOUND");
  });
});

describe("3 · positive controls (the records exist and their owners can reach them)", () => {
  const route = (m: string, p: string) => routeTable().find((r) => r.method === m && r.path === p)!;
  const ok = async (m: string, p: string, who: User) => { const r = route(m, p); const got = await invoke(r, who, paramsFor(r)); expect(got, `${who.role} ${m} ${p}`).toMatchObject({ ok: true }); };
  it("owners read their own", async () => {
    await ok("GET", "/requests/:id", w.bizA);
    await ok("GET", "/requests/:id", w.staffOps);
    await ok("GET", "/shipments/:id", w.bizA);
    await ok("GET", "/shipments/:id/proof", w.bizA);
    await ok("GET", "/shipments/:id/proof", w.drvA);
    await ok("GET", "/shipments/:id/media/:mid", w.bizA);
    await ok("GET", "/offers/:id/timeline", w.drvA);
    await ok("GET", "/offers/:id/timeline", w.bizA);
    await ok("GET", "/offers/:id/custody", w.drvA);
    await ok("GET", "/driver/jobs/:id", w.drvA);
    await ok("GET", "/tickets/:id", w.bizA);
    await ok("GET", "/tickets/:id", w.staffOps);
    await ok("GET", "/tickets/attachments/:id", w.bizA);
    await ok("GET", "/complaints/:id", w.bizA);
    await ok("GET", "/documents/:id/file", w.drvA);
    await ok("GET", "/business/invoices/:id", w.bizA);
    await ok("GET", "/integrations/connections/:id", w.bizA);
  });
  it("the office sees only its own driver's job", async () => {
    const r = route("GET", "/office/jobs/:id");
    expect((await invoke(r, w.offA, { id: w.ids.offer })).code).toBe("NOT_FOUND");
  });
  it("a staff member without requests.view cannot read the request that a colleague with it can", async () => {
    const r = route("GET", "/requests/:id");
    expect((await invoke(r, w.staffFin, { id: w.ids.request })).code).toBe("FORBIDDEN");
  });
});

describe("4 · sign-in hardening", () => {
  afterEach(() => { process.env.DEMO_MODE = "true"; vi.restoreAllMocks(); }); // the test environment is a demo deployment
  const hasRealHash = (h: unknown) => typeof h === "string" && h.length === 60 && bcrypt.getRounds(h) >= 4;

  it("an unknown name — or an account without a password — costs a real bcrypt comparison (no timing oracle for usernames)", async () => {
    const spy = vi.spyOn(bcrypt, "compare");
    await expect(loginWithPassword("nobody.here", "Whatever#1234", "198.51.100.1")).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
    expect(spy).toHaveBeenCalledTimes(1);
    expect(hasRealHash(spy.mock.calls[0][1])).toBe(true);
    const [noPw] = await db.update(users).set({ passwordHash: null }).where(eq(users.id, w.drvC.id)).returning();
    spy.mockClear();
    await expect(loginWithPassword(noPw.username!, "Whatever#1234", "198.51.100.2")).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
    expect(spy).toHaveBeenCalledTimes(1);
    expect(hasRealHash(spy.mock.calls[0][1])).toBe(true);
  });

  it("a password typed into the username box is never written to the sign-in history", async () => {
    await loginWithPassword("Demo#Pass2026 oops", "x", "198.51.100.3").catch(() => {});
    await loginWithPassword("typo.name", "x", "198.51.100.3").catch(() => {});
    const rows = await db.select().from(loginEvents).where(eq(loginEvents.ip, "198.51.100.3"));
    expect(rows.map((r) => r.identifier).sort()).toEqual(["[invalid]", "typo.name"]);
  });

  it("one address cannot spray guesses over many accounts: its 61st failed sign-in is refused, even with the right password", async () => {
    process.env.DEMO_MODE = "false";
    const ip = "203.0.113.77";
    for (let i = 0; i < 60; i++) await loginWithPassword(`ghost${i}.user`, "Nope#12345678", ip).catch(() => {});
    await expect(loginWithPassword(w.bizB.username!, TEST_PASSWORD, ip)).rejects.toMatchObject({ code: "RATE_LIMITED" });
    await expect(loginWithPassword(w.bizB.username!, TEST_PASSWORD, "203.0.113.78")).resolves.toMatchObject({ mfaRequired: false }); // another address is not affected
    await expect(loginWithPassword(w.bizB.username!, "wrong", "unknown")).rejects.toMatchObject({ code: "UNAUTHENTICATED" }); // an unattributable address never counts (it would lock everybody out)
  });

  it("a state-changing request from another site's page is refused even without a session (login / register CSRF); servers and the app send no Origin", async () => {
    const post = (headers: Record<string, string>, path = "/auth/login") => dispatch(new Request(`http://localhost/api/v1${path}`, { method: "POST", headers: { host: "localhost", "content-type": "application/json", ...headers }, body: JSON.stringify({ username: "nobody.here", password: "x" }) }));
    expect((await post({ origin: "https://evil.example" })).status).toBe(403);
    expect((await post({ origin: "null" })).status).toBe(403);
    expect((await post({ origin: "https://evil.example" }, "/auth/register")).status).toBe(403);
    expect((await post({ origin: "http://localhost" })).status).toBe(401); // our own page: reaches the handler (wrong credentials)
    expect((await post({})).status).toBe(401); // the mobile app / a server: no Origin
    expect((await post({ origin: "https://partner.example", "x-api-key": "jrk_nope" })).status).toBe(401); // a custom header cannot be sent cross-site without a CORS preflight (which this API never grants), so such a request is not a form-post CSRF: the origin rule leaves it to the credential check
  });

  it("a mangled session cookie means 'no session', not a 500", async () => {
    const res = await dispatch(new Request("http://localhost/api/v1/health", { headers: { host: "localhost", cookie: "jr_session=%E0%A4%A" } }));
    expect(res.status).toBe(200);
    const me = await dispatch(new Request("http://localhost/api/v1/auth/me", { headers: { host: "localhost", cookie: "jr_session=%E0%A4%A" } }));
    expect(me.status).toBe(401);
  });
});

describe("5 · the scenario bank is internal: no anonymous read or write, in any mode", () => {
  afterEach(() => { process.env.DEMO_MODE = "true"; });
  const calls: Array<[string, string, unknown?]> = [
    ["GET", "/scenarios"], ["GET", "/scenarios/export?format=csv"],
    ["POST", "/scenarios/1/answer", { selectedIndex: 1 }], ["POST", "/scenarios/1/custom-response", { customResponse: "Our answer" }],
  ];
  it.each(["true", "false"])("DEMO_MODE=%s: anonymous 401, a business 403, staff without settings permission 403, settings.view reads, only settings.edit writes", async (mode) => {
    process.env.DEMO_MODE = mode;
    const tok = async (u: User) => (await createSession(u.id, "mobile")).token;
    const [biz, none, viewer, editor] = [await tok(w.bizA), await tok(w.staffZ), await tok(await mkStaff(["settings.view"])), await tok(await mkStaff(["settings.edit"]))];
    for (const [m, path, body] of calls) {
      const write = m === "POST";
      expect((await call(m, path, { body })).status, `anon ${m} ${path}`).toBe(401);
      expect((await call(m, path, { token: biz, body })).status, `business ${m} ${path}`).toBe(403);
      expect((await call(m, path, { token: none, body })).status, `no perm ${m} ${path}`).toBe(403);
      if (write) expect((await call(m, path, { token: viewer, body })).status, `viewer ${m} ${path}`).toBe(403);
      else expect((await call(m, path, { token: viewer })).status, `viewer ${m} ${path}`).toBe(200);
      // the editor passes the permission check: GETs answer 200, the POSTs reach the handler (404: this test database has no scenario 1)
      expect((await call(m, path, { token: editor, body })).status, `editor ${m} ${path}`).toBe(write ? 404 : 200);
    }
  });
  it("the landing page no longer advertises the bank, and the page itself redirects the signed-out", async () => {
    const fs = await import("node:fs");
    expect(fs.readFileSync("src/app/page.tsx", "utf8")).not.toContain('"/scenarios"');
    const page = fs.readFileSync("src/app/scenarios/page.tsx", "utf8");
    expect(page).toContain('redirect("/staff/login")');
    expect(page).toContain("settings.view");
  });
});

describe("6 · PII masking: staff without drivers.sensitive never receive a full phone, IBAN, bank or national id", () => {
  const IBAN = "SA0380000000608010167519", NATIONAL_ID = "1098765432", BANK = "Zxqbank";
  const PARTS = ["ledger", "settlements", "withdrawals", "cod", "remittances"];
  it("no backoffice GET (JSON or CSV) leaks them", async () => {
    await db.update(driverProfiles).set({ nationalId: NATIONAL_ID, bankName: BANK, iban: IBAN }).where(eq(driverProfiles.userId, w.drvA.id));
    await db.update(officeProfiles).set({ bankName: BANK }).where(eq(officeProfiles.userId, w.offA.id));
    const staff = await mkStaff(ALL_PERMISSIONS.filter((p) => p !== "drivers.sensitive"));
    const token = (await createSession(staff.id, "mobile")).token;
    const [rule] = await db.select().from(pricingRules).limit(1);
    const needles: Array<[string, string]> = [["drvA phone", w.drvA.phone!], ["drvA phone digits (= username)", w.drvA.phone!.slice(1)], ["drvOA phone digits", w.drvOA.phone!.slice(1)], ["bizA phone digits", w.bizA.phone!.slice(1)], ["offA phone digits", w.offA.phone!.slice(1)], ["national id", NATIONAL_ID], ["bank", BANK], ["iban", IBAN]];
    const U = w.ids, d = [w.drvA.id, w.drvOA.id], b = [w.bizA.id], o = [w.offA.id];
    const idsFor = (path: string): string[][] => { // every parameter set worth calling for this path: [id, part?]
      if (/^\/admin\/activity|^\/admin\/notes\/:entity/.test(path)) return [["user", w.drvA.id], ["user", w.bizA.id], ["user", w.offA.id], ["request", U.request], ["offer", U.offer], ["shipment", U.shipment], ["ticket", U.ticket], ["complaint", U.complaint]];
      const one = (ids: string[]) => ids.flatMap((i) => (/money\/:part/.test(path) ? PARTS.map((x) => [i, x]) : [[i]]));
      if (/^\/admin\/drivers\/|^\/admin\/finance\/drivers\/|^\/admin\/location-history/.test(path)) return one(d);
      if (/^\/admin\/offices\//.test(path)) return one(o);
      if (/^\/admin\/(companies|businesses)\//.test(path)) return one(b);
      if (/^\/admin\/(users|accounts)\//.test(path)) return one([...d, ...b, ...o]);
      if (/^\/admin\/requests\//.test(path)) return [[U.request]];
      if (/^\/admin\/shipments\//.test(path)) return [[U.shipment]];
      if (/^\/admin\/tickets\//.test(path)) return [[U.ticket]];
      if (/^\/admin\/complaints\//.test(path)) return [[U.complaint]];
      if (/^\/admin\/finance\/invoices\//.test(path)) return [[U.invoice]];
      if (/^\/admin\/pricing\//.test(path)) return [[rule.id]];
      if (/^\/admin\/roles\//.test(path)) return [["support"]];
      if (/^\/admin\/analytics\/workbook/.test(path)) return [["driver", w.drvA.id], ["office", w.offA.id]];
      return [[]];
    };
    const urls: string[] = [];
    for (const r of routeTable()) {
      if (r.auth !== "backoffice" || r.method !== "GET" || /analytics\/:report|analytics\/explorer|activity\/:entity\/:id\/export|^\/admin\/reports\/:type/.test(r.path)) continue;
      for (const set of idsFor(r.path)) { let i = 0; urls.push(r.path.replace(/:[a-zA-Z]+/g, () => set[i++] ?? randomUUID())); }
    }
    for (const t of REPORT_TYPES) urls.push(`/admin/reports/${t}`);
    for (const t of listTables()) urls.push(`/admin/analytics/${t.report}/table/${t.name}`);
    for (const ds of allDatasets()) urls.push(`/admin/analytics/explorer/${ds.key}?pageSize=100`);
    const leaks: string[] = []; let okCount = 0; const notOk: string[] = [];
    for (const u of urls) for (const suffix of ["", u.includes("?") ? "&format=csv" : "?format=csv"]) {
      const res = await call("GET", u + suffix, { token });
      if (res.status === 200) okCount++; else if (!suffix) notOk.push(`${res.status} ${u}`);
      for (const [label, n] of needles) { const at = res.text.indexOf(n); if (at >= 0) leaks.push(`${u + suffix} leaks ${label}: …${res.text.slice(Math.max(0, at - 40), at + n.length + 5).replace(/\s+/g, " ")}`); }
    }
    writeFileSync(process.env.A1_SCAN_OUT ?? "/dev/null", `urls=${urls.length} ok=${okCount}\n${notOk.join("\n")}\nLEAKS\n${leaks.join("\n")}`);
    expect(okCount).toBeGreaterThan(150);
    expect([...new Set(leaks)]).toEqual([]);
  }, 300_000);
});

describe("7 · portal reports are scoped to the signed-in account whatever the query says", () => {
  it("another company / office cannot pull the data of bizA / offA by passing its id as a filter", async () => {
    const reqRef = (await db.select().from(requests).where(eq(requests.id, w.ids.request)))[0].ref;
    const tok = async (u: User) => (await createSession(u.id, "mobile")).token;
    const forge = (keys: readonly string[], ids: string[]) => keys.map((k) => `${k}=${ids.join(",")}`).join("&");
    const ids = [w.bizA.id, w.offA.id, w.drvA.id, w.drvOA.id, w.ids.request];
    const markers = [w.bizA.id, w.offA.id, w.drvA.id, w.drvOA.id, w.drvA.name, w.drvOA.name, reqRef];
    for (const [portal, attacker, owner] of [["business", w.bizB, w.bizA], ["office", w.offB, w.offA]] as const) {
      const keys = [...PORTAL_KEYS[portal], "company", "office", "driver", "business", "businessId", "officeId", "driverId", "request"];
      const qs = forge(keys, ids);
      let ownerSees = 0;
      for (const t of listPortalTables(portal)) {
        const mine = await call("GET", `/${portal}/analytics/table/${t.name}?${qs}`, { token: await tok(attacker) });
        expect([200, 422], `${portal}/${t.name}`).toContain(mine.status); // a forged filter is either ignored (200) or refused (422) — never honoured
        for (const m of markers) expect(mine.text.includes(m!), `${portal}/${t.name} leaked ${String(m).slice(0, 8)} to another account`).toBe(false);
        const csv = await call("GET", `/${portal}/analytics/table/${t.name}?${qs}&format=csv`, { token: await tok(attacker) });
        for (const m of markers) expect(csv.text.includes(m!), `${portal}/${t.name}.csv leaked ${String(m).slice(0, 8)}`).toBe(false);
        const own = await call("GET", `/${portal}/analytics/table/${t.name}`, { token: await tok(owner) });
        if (markers.some((m) => m && own.text.includes(m))) ownerSees++;
      }
      expect(ownerSees, `${portal}: the owner's own tables do contain the markers (so the check above is meaningful)`).toBeGreaterThan(0);
    }
  }, 120_000);
});
