/**
 * Detail views of a company, a user, a support ticket and a complaint (decisions G6–G7): the stats / profile / money / parcels / integrations / security / support / raw
 * endpoints of a company, the user detail, security and raw endpoints, and the ticket and complaint context endpoints. Pins permissions (money needs finance.view, personal
 * data follows drivers.sensitive, sections are absent without their permission), 404 for unknown ids and the numbers themselves.
 */
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { apiKeys, apiLogs, auditLogs, businessProfiles, loginEvents, partnerConnections, tickets, users, webhookDeliveries } from "@/db/schema";
import { resetDb, shutdown, mkAdmin, mkBusiness, mkDriver, mkOffice, mkRule, mkStaff, publishedRequest } from "../helpers/factories";
import { call } from "../helpers/api";
import { createSession } from "@/server/auth/session";
import { createTicket, fileComplaint, replyTicket } from "@/server/support";

beforeEach(resetDb);
afterAll(shutdown);
const tok = async (u: { id: string }) => (await createSession(u.id, "web")).token;
const get = async (u: { id: string }, path: string) => call("GET", path, { token: await tok(u) });
const patch = async (u: { id: string }, path: string, body: unknown) => call("PATCH", path, { token: await tok(u), body });
const NONE = "00000000-0000-4000-8000-000000000000";

/** An admin with a price rule, a funded company and one published order (10 parcels). */
async function world() {
  const admin = await mkAdmin(); await mkRule(admin);
  const biz = await mkBusiness({ fundsCents: 1000_00, name: "Alpha Owner" });
  const order = await publishedRequest(biz);
  return { admin, biz, order };
}

describe("permissions and unknown ids", () => {
  it("every company endpoint is back-office only, needs a company view permission and answers 404 for anything that is not a company", async () => {
    const { admin, biz } = await world(); const driver = await mkDriver(), office = await mkOffice();
    const paths = ["stats", "profile", "money", "parcels", "integrations", "security", "support", "raw"];
    for (const p of paths) {
      const url = `/admin/companies/${biz.id}/${p}`;
      expect((await call("GET", url)).status, `anonymous ${p}`).toBe(401);
      expect((await get(biz, url)).status, `business ${p}`).toBe(403);
      expect((await get(driver, url)).status, `driver ${p}`).toBe(403);
      expect((await get(await mkStaff(["finance.view", "tickets.view"]), url)).status, `no people permission ${p}`).toBe(403);
      for (const id of [NONE, "not-a-uuid", driver.id, office.id, admin.id]) expect((await get(admin, `/admin/companies/${id}/${p}`)).status, `${p} ${id}`).toBe(404);
      expect((await get(admin, url)).status, `admin ${p}`).toBe(200);
    }
  });
  it("user, ticket and complaint endpoints: 401 / 403 / 404", async () => {
    const { admin, biz } = await world();
    const t = await createTicket(biz, { category: "payment_issue", subject: "Where is my refund" });
    const c = await fileComplaint(biz, { category: "delay", description: "The driver was two hours late" });
    for (const [url, perm] of [[`/admin/users/${biz.id}/detail`, "users.view"], [`/admin/users/${biz.id}/security`, "users.view"], [`/admin/users/${biz.id}/raw`, "users.view"], [`/admin/tickets/${t.id}/context`, "tickets.view"], [`/admin/complaints/${c.id}/context`, "complaints.manage"]] as const) {
      expect((await call("GET", url)).status, url).toBe(401);
      expect((await get(biz, url)).status, url).toBe(403);
      expect((await get(await mkStaff(["reports.view"]), url)).status, `${url} without ${perm}`).toBe(403);
      expect((await get(await mkStaff([perm]), url)).status, `${url} with ${perm}`).toBe(200);
    }
    for (const url of ["/admin/users/NONE/detail", "/admin/users/NONE/security", "/admin/users/NONE/raw", "/admin/tickets/NONE/context", "/admin/complaints/NONE/context"]) {
      for (const id of [NONE, "not-a-uuid"]) expect((await get(admin, url.replace("NONE", id))).status, `${url} ${id}`).toBe(404);
    }
  });
});

describe("GET /admin/companies/:id/stats", () => {
  it("a company without orders: counts are 0, ratios and the health score are 'no data' (null), never 0%", async () => {
    const admin = await mkAdmin(); const biz = await mkBusiness({ fundsCents: 500_00 });
    const s = (await get(admin, `/admin/companies/${biz.id}/stats`)).json;
    const k = (key: string) => s.kpis.find((x: any) => x.key === key);
    expect(s.period).toMatchObject({ key: "30d", days: 30, bucket: "day" }); expect(s.period.prevFrom).not.toBeNull();
    expect(k("orders").value).toBe(0); expect(k("parcels").value).toBe(0);
    for (const key of ["success", "cancellation", "on_time", "aov"]) expect(k(key).value, key).toBeNull();
    expect(k("health").value).toBeNull(); expect(s.health).toMatchObject({ score: null, band: null });
    expect(s.facts).toMatchObject({ lastOrderAt: null, daysSinceLastOrder: null, openNow: 0, ordersAll: 0 });
    expect(s.wallet).toMatchObject({ availableCents: 500_00, creditLimitCents: 0, creditUse: null });
    expect(s.charts.orders).toHaveLength(30); expect(s.charts.orders.every((p: any) => p.orders === 0)).toBe(true);
    expect(s.moneyHidden).toBe(false); expect(s.hidden).toEqual([]);
  });
  it("counts orders and parcels, the open order, the last order and the zero-filled daily series", async () => {
    const { admin, biz } = await world();
    const s = (await get(admin, `/admin/companies/${biz.id}/stats?period=30d`)).json;
    const k = (key: string) => s.kpis.find((x: any) => x.key === key);
    expect(k("orders")).toMatchObject({ value: 1, prev: 0, good: "higher" }); expect(k("parcels").value).toBe(10);
    expect(s.facts).toMatchObject({ openNow: 1, ordersAll: 1, daysSinceLastOrder: 0 });
    expect(s.charts.orders.reduce((a: number, p: any) => a + p.orders, 0)).toBe(1); expect(s.charts.orders.reduce((a: number, p: any) => a + p.parcels, 0)).toBe(10);
    expect(s.charts.cities).toEqual([{ key: "riyadh", value: 1 }]);
    expect(k("support").value).toBe(0); expect(k("cod").value).toBe(0);
  });
  it("periods: 90 days has weekly buckets, 12 months monthly, all time has no comparison; a bad period is a 422", async () => {
    const { admin, biz } = await world();
    const p = async (q: string) => (await get(admin, `/admin/companies/${biz.id}/stats?period=${q}`)).json;
    expect((await p("90d")).period).toMatchObject({ days: 90, bucket: "week" });
    expect((await p("12m")).period).toMatchObject({ bucket: "month" });
    const all = await p("all"); expect(all.period).toMatchObject({ bucket: "day", prevFrom: null }); expect(all.kpis.find((x: any) => x.key === "orders")).toMatchObject({ value: 1, prev: null });
    expect((await get(admin, `/admin/companies/${biz.id}/stats?period=week`)).status).toBe(422);
  });
  it("money is absent (not 0) without finance.view; sections follow requests.view / wallets.view / support permissions", async () => {
    const { biz } = await world();
    const bare = (await get(await mkStaff(["users.view"]), `/admin/companies/${biz.id}/stats`)).json;
    expect(bare.kpis).toEqual([]); expect(bare.hidden).toEqual(["orders", "money", "wallet", "cod", "support"]); expect(bare.wallet).toBeNull(); expect(bare.charts).toBeNull(); expect(bare.moneyHidden).toBe(true);
    const ops = (await get(await mkStaff(["users.view", "requests.view", "tickets.view"]), `/admin/companies/${biz.id}/stats`)).json;
    const keys = ops.kpis.map((x: any) => x.key);
    expect(keys).toEqual(expect.arrayContaining(["orders", "parcels", "support"])); for (const m of ["spend", "aov", "cod"]) expect(keys).not.toContain(m);
    expect(ops.charts.spendByService).toBeNull(); expect(ops.hidden).toEqual(["money", "wallet", "cod"]);
    const fin = (await get(await mkStaff(["users.view", "requests.view", "finance.view"]), `/admin/companies/${biz.id}/stats`)).json;
    expect(fin.kpis.map((x: any) => x.key)).toEqual(expect.arrayContaining(["spend", "aov", "cod"])); expect(fin.wallet.availableCents + fin.wallet.reservedCents).toBe(1000_00);
  });
  it("raises alerts from plain rules: a verified account that never ordered, and a wallet below the average order", async () => {
    const admin = await mkAdmin();
    const old = await mkBusiness(); await db.update(users).set({ createdAt: new Date(Date.now() - 20 * 864e5) }).where(eq(users.id, old.id));
    const a = (await get(admin, `/admin/companies/${old.id}/stats`)).json.alerts;
    expect(a.map((x: any) => x.key)).toEqual(["never_ordered"]); expect(a[0].params.days).toBeGreaterThanOrEqual(20);
    const fresh = await mkBusiness();
    expect((await get(admin, `/admin/companies/${fresh.id}/stats`)).json.alerts).toEqual([]);
  });
});

describe("GET /admin/companies/:id/profile, /raw, /money", () => {
  it("profile: registration and VAT numbers, how the account came to exist, and the verification history only for those who may read it", async () => {
    const { admin, biz } = await world();
    await db.update(businessProfiles).set({ crNumber: "1010555666", taxNumber: "310122393500003", industry: "Food" }).where(eq(businessProfiles.userId, biz.id));
    await db.update(users).set({ source: "admin", createdBy: admin.id, language: "en" }).where(eq(users.id, biz.id));
    expect((await call("POST", `/admin/users/${biz.id}/verification`, { token: await tok(admin), body: { action: "request_info", note: "Send your VAT certificate" } })).status).toBe(200);
    const p = (await get(admin, `/admin/companies/${biz.id}/profile`)).json;
    expect(p).toMatchObject({ crNumber: "1010555666", taxNumber: "310122393500003", industry: "Food", source: "admin", language: "en", createdBy: { id: admin.id } });
    expect(p.history[0]).toMatchObject({ action: "account.request_info", note: "Send your VAT certificate", actor: { id: admin.id } });
    const viewer = (await get(await mkStaff(["users.view"]), `/admin/companies/${biz.id}/profile`)).json;
    expect(viewer.taxNumber).toBe("310122393500003"); expect(viewer.history).toBeNull(); expect(viewer.contact.phone).toContain("•••");
    expect((await get(await mkStaff(["users.view", "audit.view"]), `/admin/companies/${biz.id}/profile`)).json.history).toHaveLength(1);
  });
  it("raw: the record as stored with ids and counts, no secrets", async () => {
    const { admin, biz } = await world();
    await db.update(businessProfiles).set({ webhookUrl: "https://erp.example.com/hook", webhookSecret: "whsec_super_secret" }).where(eq(businessProfiles.userId, biz.id));
    const r = await get(admin, `/admin/companies/${biz.id}/raw`);
    expect(r.json).toMatchObject({ id: biz.id, role: "business", status: "active", counts: { requests: 1, shipments: 10, tickets: 0 } });
    expect(r.json.profile).toMatchObject({ webhookHost: "erp.example.com", hasWebhookSecret: true }); expect(r.json.wallet.id).toBeTruthy();
    for (const secret of ["whsec_super_secret", "passwordHash", "totpSecret", "tokenHash"]) expect(r.text, secret).not.toContain(secret);
    expect((await get(await mkStaff(["users.view"]), `/admin/companies/${biz.id}/raw`)).json.phone).toContain("•••");
  });
  it("money: credit line use, 12 monthly points, ledger by kind and invoice totals — wallet needs wallets.view, the rest finance.view", async () => {
    const { admin, biz } = await world();
    expect((await call("POST", "/admin/finance/credit-limit", { token: await tok(admin), body: { userId: biz.id, creditLimitCents: 500_00 } })).status).toBe(200);
    const m = (await get(admin, `/admin/companies/${biz.id}/money`)).json;
    expect(m.wallet).toMatchObject({ creditLimitCents: 500_00, creditUsedCents: 0, creditUse: 0 }); expect(m.months).toHaveLength(12);
    expect(m.ledgerKinds.map((k: any) => k.kind)).toEqual(expect.arrayContaining(["topup"])); expect(m.invoices).toMatchObject({ count: 0, totalCents: 0 }); expect(m.moneyHidden).toBe(false);
    const w = (await get(await mkStaff(["users.view", "wallets.view"]), `/admin/companies/${biz.id}/money`)).json;
    expect(w.wallet.creditLimitCents).toBe(500_00); expect(w.months).toBeNull(); expect(w.ledgerKinds).toBeNull(); expect(w.invoices).toBeNull(); expect(w.moneyHidden).toBe(true); expect(w.walletHidden).toBe(false);
    const none = (await get(await mkStaff(["users.view"]), `/admin/companies/${biz.id}/money`)).json;
    expect(none).toMatchObject({ wallet: null, months: null, moneyHidden: true, walletHidden: true });
  });
});

describe("GET /admin/companies/:id/parcels", () => {
  it("lists parcels with analytics, filters by status / city / text, pages, and masks the recipient without drivers.sensitive", async () => {
    const { admin, biz } = await world();
    const r = (await get(admin, `/admin/companies/${biz.id}/parcels?pageSize=4`)).json;
    expect(r).toMatchObject({ total: 10, page: 1, pageSize: 4 }); expect(r.items).toHaveLength(4); expect(r.cities.length).toBeGreaterThan(0);
    const city = r.cities[0] as string;
    expect(r.analytics).toMatchObject({ total: 10, byStatus: { pending: 10 }, successRate: null }); expect(r.items[0]).toMatchObject({ status: "pending", request: { id: expect.any(String), ref: expect.stringMatching(/^JR-/) } });
    expect(r.items[0].recipientPhone).not.toContain("•••");
    expect((await get(admin, `/admin/companies/${biz.id}/parcels?page=3&pageSize=4`)).json.items).toHaveLength(2);
    expect((await get(admin, `/admin/companies/${biz.id}/parcels?status=delivered`)).json.total).toBe(0);
    expect((await get(admin, `/admin/companies/${biz.id}/parcels?status=pending&city=${city}`)).json.total).toBe(10);
    expect((await get(admin, `/admin/companies/${biz.id}/parcels?city=nowhere`)).json.total).toBe(0);
    expect((await get(admin, `/admin/companies/${biz.id}/parcels?q=Customer%203`)).json.total).toBe(1);
    expect((await get(admin, `/admin/companies/${biz.id}/parcels?q=%25`)).json.total).toBe(0); // wildcards are literal
    expect((await get(admin, `/admin/companies/${biz.id}/parcels?pageSize=101`)).status).toBe(422);
    const masked = (await get(await mkStaff(["users.view", "requests.view"]), `/admin/companies/${biz.id}/parcels`)).json;
    expect(masked.items[0].recipientPhone).toContain("•••"); expect(masked.items[0].address).toBeNull(); expect(masked.items[0].codCents).toBeNull(); expect(masked.moneyHidden).toBe(true);
    expect((await get(await mkStaff(["users.view"]), `/admin/companies/${biz.id}/parcels`)).status).toBe(403); // parcels need requests.view
  });
  it("another company's parcels never show up", async () => {
    const { admin, biz } = await world(); const other = await mkBusiness({ fundsCents: 1000_00 }); await publishedRequest(other);
    expect((await get(admin, `/admin/companies/${biz.id}/parcels`)).json.total).toBe(10);
    expect((await get(admin, `/admin/companies/${other.id}/parcels`)).json.total).toBe(10);
  });
  it("CSV needs reports.export, is a UTF-8 file with the filtered rows and is audited", async () => {
    const { biz } = await world();
    const plain = await mkStaff(["users.view", "requests.view"]);
    expect((await get(plain, `/admin/companies/${biz.id}/parcels?format=csv`)).status).toBe(403);
    const exporter = await mkStaff(["users.view", "requests.view", "reports.export"]);
    const r = await get(exporter, `/admin/companies/${biz.id}/parcels?format=csv&q=Customer%203`);
    expect(r.status).toBe(200); expect(r.headers.get("content-type")).toContain("text/csv"); expect(r.headers.get("content-disposition")).toContain("company-parcels-");
    const lines = r.text.replace(/^\uFEFF/, "").split("\n"); expect(lines[0]).toContain("code,externalRef,status,recipientName"); expect(lines).toHaveLength(2);
    expect(lines[1]).toContain("Customer 3"); expect(lines[1]).toContain("•••"); // masked without drivers.sensitive
    const a = await db.select().from(auditLogs).where(and(eq(auditLogs.action, "report.export"), eq(auditLogs.entityId, biz.id)));
    expect(a).toHaveLength(1); expect(a[0].actorId).toBe(exporter.id);
  });
});

describe("integrations, security and support of a company", () => {
  it("integrations: connections with their last error, API keys with usage, webhook failure rate and API usage — and never a secret", async () => {
    const { admin, biz } = await world();
    const [key] = await db.insert(apiKeys).values({ businessId: biz.id, name: "ERP", prefix: "jr_ab12", keyHash: "hash-should-never-leak" }).returning();
    await db.insert(apiLogs).values([
      { businessId: biz.id, keyId: key.id, method: "GET", path: `/api/v1/jobs/${NONE}`, status: 200, latencyMs: 40 }, { businessId: biz.id, keyId: key.id, method: "GET", path: `/api/v1/jobs/${biz.id}`, status: 500, latencyMs: 400 },
    ]);
    await db.insert(webhookDeliveries).values([
      { businessId: biz.id, event: "job.completed", url: "https://erp.example.com/h", payload: {}, status: "delivered", attempts: 1, deliveredAt: new Date() },
      { businessId: biz.id, event: "job.completed", url: "https://erp.example.com/h", payload: {}, status: "delivered", attempts: 1, deliveredAt: new Date() },
      { businessId: biz.id, event: "job.cancelled", url: "https://erp.example.com/h", payload: {}, status: "dead_letter", attempts: 5, lastStatusCode: 503, lastError: "upstream down" },
    ]);
    await db.insert(partnerConnections).values({ businessId: biz.id, provider: "custom_x", name: "Main warehouse", lastError: "401 from the partner" });
    const r = await get(admin, `/admin/companies/${biz.id}/integrations`);
    expect(r.json.partners[0]).toMatchObject({ name: "Main warehouse", status: "active", lastError: "401 from the partner", events30: { ok: 0, ignored: 0, error: 0 } });
    expect(r.json.apiKeys[0]).toMatchObject({ name: "ERP", prefix: "jr_ab12", calls: 2, errors: 1, revokedAt: null });
    expect(r.json.webhook).toMatchObject({ configured: false, delivered: 2, failed: 1, waiting: 0 }); expect(r.json.webhook.failureRate).toBeCloseTo(1 / 3, 5);
    expect(r.json.webhook.recent[0]).toMatchObject({ event: "job.cancelled", statusCode: 503, error: "upstream down" }); expect(r.json.webhook.series).toHaveLength(30);
    expect(r.json.api).toMatchObject({ calls: 2, serverErrors: 1, clientErrors: 0 }); expect(r.json.api.paths[0].path).toBe("/api/v1/jobs/:id"); expect(r.json.api.paths[0].calls).toBe(2);
    for (const secret of ["hash-should-never-leak", "secretsEnc", "keyHash"]) expect(r.text, secret).not.toContain(secret);
    expect((await get(admin, `/admin/companies/${biz.id}/stats`)).json.alerts.map((a: any) => a.key)).toContain("integration_errors");
    const lite = (await get(await mkStaff(["users.view"]), `/admin/companies/${biz.id}/integrations`)).json; // keys yes, traffic no
    expect(lite.apiKeys).toHaveLength(1); expect(lite.partners).toBeNull(); expect(lite.webhook).toBeNull(); expect(lite.api).toBeNull(); expect(lite.hidden).toEqual(["traffic"]);
    expect((await get(await mkStaff(["requests.view", "offices.view"]), `/admin/companies/${biz.id}/integrations`)).json.apiKeys).toBeNull();
  });
  it("security: sign-in attempts and sessions of the account, addresses masked without drivers.sensitive; users.view is required", async () => {
    const { admin, biz } = await world();
    await db.insert(loginEvents).values([
      { userId: biz.id, identifier: biz.phone, method: "otp", success: true, ip: "203.0.113.45", userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Chrome/126.0 Safari/537.36", client: "web" },
      { userId: null, identifier: biz.phone, method: "otp", success: false, failureReason: "invalid_code", ip: "198.51.100.7", client: "web" },
    ]);
    await createSession(biz.id, "web", "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0) Safari/604.1", "203.0.113.45");
    const full = (await get(admin, `/admin/companies/${biz.id}/security`)).json;
    expect(full.stats).toMatchObject({ ok30: 1, failed30: 1 }); expect(full.events.map((e: any) => [e.success, e.failureReason])).toEqual(expect.arrayContaining([[true, null], [false, "invalid_code"]]));
    expect(full.events.find((e: any) => e.success).ip).toBe("203.0.113.45"); expect(full.events.find((e: any) => e.success).device).toBe("Chrome · macOS");
    expect(full.sessions.length).toBeGreaterThanOrEqual(1); expect(full.sensitiveHidden).toBe(false);
    const masked = (await get(await mkStaff(["users.view"]), `/admin/companies/${biz.id}/security`)).json;
    expect(masked.events.find((e: any) => e.success).ip).toBe("203.0.113.•••"); expect(masked.events.find((e: any) => e.success).device).toBeNull(); expect(masked.sensitiveHidden).toBe(true); expect(masked.stats.ips30).toBeNull();
    expect((await get(await mkStaff(["offices.view"]), `/admin/companies/${biz.id}/security`)).status).toBe(403);
  });
  it("support: tickets and complaints opened by the company or about its orders, each with its SLA state", async () => {
    const { admin, biz, order } = await world();
    const own = await createTicket(biz, { category: "payment_issue", subject: "Where is my refund" });
    await fileComplaint(biz, { category: "delay", description: "The driver was two hours late", requestId: order.id });
    const r = (await get(admin, `/admin/companies/${biz.id}/support`)).json;
    expect(r.tickets).toHaveLength(1); expect(r.tickets[0]).toMatchObject({ id: own.id, about: false, sla: { worst: "on_track" } }); expect(r.complaints).toHaveLength(1); expect(r.complaints[0]).toMatchObject({ about: false, request: { id: order.id } });
    expect(r.summary).toMatchObject({ open: 2, breached: 0, total: 2 });
    await db.update(tickets).set({ createdAt: new Date(Date.now() - 5 * 3600e3) }).where(eq(tickets.id, own.id)); // 5 h without an answer: past the 4 h target
    const late = (await get(admin, `/admin/companies/${biz.id}/support`)).json;
    expect(late.tickets[0].sla.worst).toBe("breached"); expect(late.summary.breached).toBe(1);
    expect((await get(admin, `/admin/companies/${biz.id}/stats`)).json.alerts.map((a: any) => a.key)).toContain("sla_breached");
    const some = (await get(await mkStaff(["users.view", "tickets.view"]), `/admin/companies/${biz.id}/support`)).json;
    expect(some.complaints).toBeNull(); expect(some.tickets).toHaveLength(1); expect(some.hidden).toEqual(["complaints"]);
  });
});

describe("GET /admin/users/:id/detail", () => {
  it("a driver: identity, source, role-specific summary with the link to the driver view, masked phone without drivers.sensitive", async () => {
    const admin = await mkAdmin(); const driver = await mkDriver({ name: "Omar Driver" });
    const d = (await get(admin, `/admin/users/${driver.id}/detail`)).json;
    expect(d).toMatchObject({ id: driver.id, role: "driver", name: "Omar Driver", status: "active", source: "self", phone: driver.phone, staff: null });
    expect(d.entity).toMatchObject({ type: "driver", href: `/admin/drivers/${driver.id}`, verificationStatus: "verified" }); expect(d.entity.facts).toMatchObject({ vehicleType: "sedan", availability: "available" });
    const m = (await get(await mkStaff(["users.view"]), `/admin/users/${driver.id}/detail`)).json;
    expect(m.phone).toContain("•••"); expect(m.entity.facts.vehiclePlate).toBeNull(); expect(m.counts).toMatchObject({ tickets: null, complaints: null, notes: 0 });
    expect((await get(await mkStaff(["drivers.view"]), `/admin/users/${driver.id}/detail`)).status).toBe(200);
  });
  it("a company or office links to its own full view; created-by is the staff member for accounts made in the admin", async () => {
    const admin = await mkAdmin(); const biz = await mkBusiness(); const off = await mkOffice();
    await db.update(users).set({ source: "admin", createdBy: admin.id }).where(eq(users.id, biz.id));
    const b = (await get(admin, `/admin/users/${biz.id}/detail`)).json; expect(b.entity).toMatchObject({ type: "business", href: `/admin/companies/${biz.id}` }); expect(b).toMatchObject({ source: "admin", createdBy: { id: admin.id, name: "Admin" } });
    expect((await get(admin, `/admin/users/${off.id}/detail`)).json.entity).toMatchObject({ type: "office", href: `/admin/offices/${off.id}` });
  });
  it("a staff account: role, permissions, two-step and lock state, and the actions it performed (audit.view)", async () => {
    const admin = await mkAdmin(); const staff = await mkStaff(["users.view", "tickets.view", "tickets.manage"]);
    await db.update(users).set({ lockedUntil: new Date(Date.now() + 3600e3), failedLogins: 5 }).where(eq(users.id, staff.id));
    await db.insert(auditLogs).values([{ actorId: staff.id, actorRole: "staff", action: "ticket.update", entity: "ticket", entityId: NONE }, { actorId: staff.id, actorRole: "staff", action: "ticket.update", entity: "ticket", entityId: NONE }]);
    const s = (await get(admin, `/admin/users/${staff.id}/detail`)).json;
    expect(s.staff).toMatchObject({ permissions: ["tickets.manage", "tickets.view", "users.view"], mfaEnabled: false, locked: true, failedLogins: 5, allPermissions: false });
    expect(s.actions).toMatchObject({ total: 2, byAction: [{ action: "ticket.update", n: 2 }] }); expect(s.actions.latest[0]).toMatchObject({ action: "ticket.update", entity: "ticket" });
    expect((await get(admin, `/admin/users/${admin.id}/detail`)).json.staff).toMatchObject({ allPermissions: true });
    // staff accounts need the staff permissions; audited actions need audit.view
    expect((await get(await mkStaff(["users.view"]), `/admin/users/${staff.id}/detail`)).status).toBe(403);
    const lister = (await get(await mkStaff(["staff.view"]), `/admin/users/${staff.id}/detail`)).json;
    expect(lister.actions).toBeNull(); expect(lister.auditHidden).toBe(true); expect(lister.staff.permissions).toHaveLength(3);
    expect((await get(await mkStaff(["staff.view", "audit.view"]), `/admin/users/${staff.id}/detail`)).json.actions.total).toBe(2);
  });
  it("security and raw: sign-ins and sessions of any account; no secrets in the raw record", async () => {
    const admin = await mkAdmin(); const driver = await mkDriver();
    await db.insert(loginEvents).values({ userId: driver.id, identifier: driver.phone, method: "otp", success: true, ip: "203.0.113.9", client: "mobile" });
    const s = (await get(admin, `/admin/users/${driver.id}/security`)).json; expect(s.stats.ok30).toBe(1); expect(s.events[0]).toMatchObject({ method: "otp", success: true, client: "mobile", ip: "203.0.113.9" });
    expect((await get(await mkStaff(["users.view"]), `/admin/users/${driver.id}/security`)).json.events[0].ip).toBe("203.0.113.•••");
    expect((await get(await mkStaff(["drivers.view"]), `/admin/users/${driver.id}/security`)).status).toBe(403);
    const raw = await get(admin, `/admin/users/${admin.id}/raw`);
    expect(raw.json).toMatchObject({ id: admin.id, role: "admin" }); for (const secret of ["passwordHash", "totpSecret", "totpRecovery"]) expect(raw.text, secret).not.toContain(secret);
  });
});

describe("GET /admin/tickets/:id/context", () => {
  it("SLA clocks, requester card with support history, related cards, handling history and how similar tickets ended", async () => {
    const { admin, biz, order } = await world();
    const t = await createTicket(biz, { category: "payment_issue", subject: "Where is my refund", requestId: order.id });
    const prior = await createTicket(biz, { category: "payment_issue", subject: "Earlier question" });
    const c = (await get(admin, `/admin/tickets/${t.id}/context`)).json;
    expect(c).toMatchObject({ id: t.id, ref: t.ref, category: "payment_issue" }); expect(c.sla).toMatchObject({ worst: "on_track", targets: { firstResponseSec: 14_400, resolutionSec: 172_800 }, firstResponse: { state: "on_track" }, resolution: { state: "on_track" } });
    expect(c.requester).toMatchObject({ id: biz.id, role: "business", href: `/admin/companies/${biz.id}`, userHref: `/admin/users/${biz.id}` }); expect(c.requester.stats).toMatchObject({ tickets: { total: 2, open: 2 }, orders: 1 }); expect(c.requester.stats.lastTickets.map((x: any) => x.id)).toEqual([prior.id]);
    expect(c.related.request).toMatchObject({ id: order.id, status: "published" }); expect(typeof c.related.request.totalCents).toBe("number"); expect(c.related.company).toMatchObject({ id: biz.id, orders: 1 }); expect(c.related.offer).toBeNull();
    expect(c.outcomes).toMatchObject({ total: 1, open: 1, resolved: 0 }); expect(c.milestones).toMatchObject({ firstResponseAt: null, reopenCount: 0 }); expect(c.history).toEqual([]);
    // handling: assign, priority, a public reply (first response) and resolve
    expect((await patch(admin, `/admin/tickets/${t.id}`, { status: "in_review", priority: "urgent", assignToMe: true })).status).toBe(200);
    await replyTicket(admin, t.id, "We are looking into it");
    expect((await patch(admin, `/admin/tickets/${t.id}`, { status: "resolved" })).status).toBe(200);
    const after = (await get(admin, `/admin/tickets/${t.id}/context`)).json;
    expect(after.history.map((h: any) => h.kind)).toEqual(expect.arrayContaining(["status", "priority", "assign"])); expect(after.history.find((h: any) => h.kind === "assign")).toMatchObject({ to: "Admin", actor: { id: admin.id } });
    expect(after.history.filter((h: any) => h.kind === "status").map((h: any) => h.to).sort()).toEqual(["in_review", "resolved"]);
    expect(after.milestones.firstResponseAt).not.toBeNull(); expect(after.milestones.firstResponseBy).toMatchObject({ id: admin.id }); expect(after.sla.firstResponse.state).toBe("met"); expect(after.sla.resolution.state).toBe("met");
    expect((await get(admin, `/admin/tickets/${prior.id}/context`)).json.outcomes).toMatchObject({ total: 1, resolved: 1 });
  });
  it("cards the viewer may not open are absent and named; amounts need finance or pricing; the phone follows drivers.sensitive", async () => {
    const { biz, order } = await world();
    const t = await createTicket(biz, { category: "other", subject: "Question about an order", requestId: order.id });
    const viewer = (await get(await mkStaff(["tickets.view"]), `/admin/tickets/${t.id}/context`)).json;
    expect(viewer.related.request).toBeNull(); expect(viewer.related.company).toBeNull(); expect(viewer.related.hidden).toEqual(["request"]);
    expect(viewer.requester.phone).toContain("•••"); expect(viewer.requester.stats.orders).toBeNull(); expect(viewer.requester.stats.complaints).toBeNull();
    const ops = (await get(await mkStaff(["tickets.view", "requests.view", "users.view"]), `/admin/tickets/${t.id}/context`)).json;
    expect(ops.related.request.totalCents).toBeNull(); expect(ops.related.company).not.toBeNull(); expect(ops.requester.stats.orders).toBe(1);
  });
});

describe("GET /admin/complaints/:id/context", () => {
  it("parties, evidence, the settlement hold, handling history and outcome stats", async () => {
    const { admin, biz, order } = await world();
    const c = await fileComplaint(biz, { category: "delay", description: "The driver was two hours late", requestId: order.id });
    const r = (await get(admin, `/admin/complaints/${c.id}/context`)).json;
    expect(r).toMatchObject({ id: c.id, ref: c.ref, category: "delay" }); expect(r.filer).toMatchObject({ id: biz.id, role: "business" }); expect(r.respondents).toMatchObject({ basis: "request", items: [] });
    expect(r.evidence).toMatchObject({ offerStatus: null, lateMinutes: null }); expect(r.evidence.startsAt).not.toBeNull(); expect(r.related.request.id).toBe(order.id);
    expect(r.settlement).toMatchObject({ holds: false, active: false, items: [], moneyHidden: false }); expect(r.sla.worst).toBe("on_track");
    expect((await patch(admin, `/admin/complaints/${c.id}`, { assignToMe: true })).status).toBe(200);
    expect((await patch(admin, `/admin/complaints/${c.id}`, { holdsSettlement: true })).status).toBe(200);
    const held = (await get(admin, `/admin/complaints/${c.id}/context`)).json;
    expect(held.settlement).toMatchObject({ holds: true, active: true }); expect(held.history.map((h: any) => h.kind)).toEqual(expect.arrayContaining(["assign", "hold"])); expect(held.milestones.firstResponseAt).not.toBeNull(); expect(held.milestones.handler).toMatchObject({ id: admin.id });
    expect((await patch(admin, `/admin/complaints/${c.id}`, { status: "resolved", resolution: "Late fee credited" })).status).toBe(200);
    const done = (await get(admin, `/admin/complaints/${c.id}/context`)).json;
    expect(done.settlement).toMatchObject({ holds: false, active: false }); expect(done.history.find((h: any) => h.kind === "status")).toMatchObject({ to: "resolved", note: "Late fee credited" }); expect(done.sla.resolution.state).toBe("met");
    const other = await fileComplaint(biz, { category: "delay", description: "Another late delivery please" });
    const oc = (await get(admin, `/admin/complaints/${other.id}/context`)).json;
    expect(oc.outcomes).toMatchObject({ total: 1, resolved: 1 }); expect(oc.similar[0]).toMatchObject({ id: c.id, status: "resolved", resolution: "Late fee credited" });
  });
  it("the job's records and the money need their own permissions", async () => {
    const { biz, order } = await world();
    const c = await fileComplaint(biz, { category: "delay", description: "The driver was two hours late", requestId: order.id });
    const handler = (await get(await mkStaff(["complaints.manage"]), `/admin/complaints/${c.id}/context`)).json;
    expect(handler.evidence).toBeNull(); expect(handler.evidenceHidden).toBe(true); expect(handler.related.request).toBeNull(); expect(handler.settlement.moneyHidden).toBe(true);
    const ops = (await get(await mkStaff(["complaints.manage", "requests.view"]), `/admin/complaints/${c.id}/context`)).json;
    expect(ops.evidence).not.toBeNull(); expect(ops.evidenceHidden).toBe(false); expect(ops.related.request.totalCents).toBeNull();
  });
});
