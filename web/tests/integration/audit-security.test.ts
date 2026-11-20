/**
 * Server audit — security & robustness. Each test pins a defect found in the audit (see memory/DECISIONS.md → "Audit fixes").
 */
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import { mkdtempSync, existsSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { db } from "@/db";
import { users, offers, businessProfiles, rateLimits, sessions, otpCodes, apiIdempotency, tickets } from "@/db/schema";
import { resetDb, shutdown, mkAdmin, mkStaff, mkBusiness, mkDriver, mkRule, mkOffice, publishedRequest, mkShipments } from "../helpers/factories";
import { call } from "../helpers/api";
import { createSession } from "@/server/auth/session";
import { resetStaffPassword, updateStaff, unlockStaff, loginWithPassword } from "@/server/accounts";
import { resetStaffMfa } from "@/server/auth/mfa";
import { setStorage, storage } from "@/server/storage";
import { isPrivateIp, resolveWebhookTarget, setWebhook, createExternalJob } from "@/server/integrations";
import { runMaintenance } from "@/server/maintenance";
import { createTicket } from "@/server/support";
import * as jobs from "@/server/jobs";

beforeEach(resetDb);
afterAll(shutdown);
const tok = async (u: { id: string }) => (await createSession(u.id, "mobile")).token;
const env = process.env as Record<string, string | undefined>;

describe("staff privilege escalation through account management", () => {
  it("staff.manage cannot take over (password / 2FA / unlock / suspend / re-permission) a colleague who holds permissions they lack", async () => {
    const admin = await mkAdmin();
    const mgr = await mkStaff(["staff.manage", "staff.view"]);
    const finance = await mkStaff(["finance.view", "payouts.execute"]);
    await expect(resetStaffPassword(mgr, finance.id, "Passw0rdPassw0rd")).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(resetStaffMfa(mgr, finance.id)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(unlockStaff(mgr, finance.id)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(updateStaff(mgr, finance.id, { status: "suspended" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(updateStaff(mgr, finance.id, { permissions: [] })).rejects.toMatchObject({ code: "FORBIDDEN" });
    const [still] = await db.select().from(users).where(eq(users.id, finance.id));
    expect(still.mustChangePassword).toBe(false); expect(still.status).toBe("active"); expect(still.permissions).toContain("payouts.execute");
    // a colleague whose permissions are a subset of the actor's can be managed; an admin can manage anyone
    const junior = await mkStaff(["staff.view"]);
    await resetStaffPassword(mgr, junior.id, "Passw0rdPassw0rd");
    await resetStaffPassword(admin, finance.id, "Passw0rdPassw0rd");
  });
});

describe("secrets never leave the server", () => {
  it("the webhook signing secret is not part of /auth/me, /profile or the staff user view", async () => {
    const biz = await mkBusiness();
    await db.update(businessProfiles).set({ webhookUrl: "https://example.com/hook", webhookSecret: "whsec_supersecretvalue" }).where(eq(businessProfiles.userId, biz.id));
    const t = await tok(biz);
    for (const p of ["/auth/me", "/profile"]) {
      const r = await call("GET", p, { token: t });
      expect(JSON.stringify(r.json), p).not.toContain("whsec_supersecretvalue");
      expect(r.json.profile.webhookUrl).toBe("https://example.com/hook");
    }
    const staff = await mkStaff(["users.view"]);
    const view = await call("GET", `/admin/users/${biz.id}`, { token: await tok(staff) });
    expect(view.status).toBe(200);
    expect(JSON.stringify(view.json)).not.toContain("whsec_supersecretvalue");
  });
});

describe("request pipeline hardening", () => {
  it("malformed path encoding, a 'null' Origin and hostile correlation ids are 4xx with a clean id — never a 500", async () => {
    const broken = await call("GET", "/requests/%E0%A4%A");
    expect(broken.status).toBeLessThan(500);
    const biz = await mkBusiness(); const t = await tok(biz);
    const nullOrigin = await call("POST", "/requests/estimate", { headers: { cookie: `jr_session=${t}`, origin: "null" }, body: {} });
    expect(nullOrigin.status).toBe(403);
    const hostile = await call("GET", "/requests", { headers: { "x-correlation-id": "<script>alert(1)</script>" + "a".repeat(300) } });
    expect(hostile.status).toBe(401);
    expect(hostile.headers.get("x-correlation-id")).toMatch(/^[A-Za-z0-9_.-]{1,64}$/);
    expect(hostile.json.error.correlation_id).toBe(hostile.headers.get("x-correlation-id"));
    const fine = await call("GET", "/requests", { headers: { "x-correlation-id": "client-trace-42" } });
    expect(fine.headers.get("x-correlation-id")).toBe("client-trace-42");
  });

  it("oversized JSON bodies are refused (413) before they are parsed", async () => {
    const biz = await mkBusiness();
    const r = await call("POST", "/requests/estimate", { token: await tok(biz), body: { notes: "x".repeat(4_600_000) } });
    expect(r.status).toBe(413);
    expect(r.json.error.code).toBe("PAYLOAD_TOO_LARGE");
  });
});

describe("SSRF: every spelling of a private address is private", () => {
  it("IPv4-mapped IPv6 in hex form, NAT64, 6to4 and IPv4-compatible forms are blocked, public addresses are not", () => {
    for (const ip of ["::ffff:7f00:1", "::ffff:a00:1", "::ffff:c0a8:101", "::ffff:a9fe:a9fe", "64:ff9b::7f00:1", "64:ff9b::a00:1", "2002:7f00:1::", "2002:a00:1::1", "::7f00:1", "fec0::1", "::ffff:0:7f00:1",
      "192.0.0.1", "192.0.2.5", "198.51.100.7", "203.0.113.9", "240.0.0.1", "255.255.255.255"]) expect(isPrivateIp(ip), ip).toBe(true);
    for (const ip of ["::ffff:808:808", "64:ff9b::808:808", "2002:808:808::1", "2606:4700:4700::1111"]) expect(isPrivateIp(ip), ip).toBe(false);
  });

  it("production refuses a webhook URL that spells loopback in IPv6-hex", async () => {
    const prev = env.NODE_ENV; env.NODE_ENV = "production";
    try {
      await expect(resolveWebhookTarget("https://[::ffff:7f00:1]/hook")).rejects.toMatchObject({ code: "VALIDATION" });
      await expect(resolveWebhookTarget("https://[::1]/hook")).rejects.toMatchObject({ code: "VALIDATION" });
    } finally { env.NODE_ENV = prev; }
  });
});

describe("local storage cannot be escaped", () => {
  it("a key that resolves to a sibling directory sharing the upload folder's name prefix is refused", async () => {
    const base = mkdtempSync(path.join(os.tmpdir(), "jr-up-"));
    const root = path.join(base, "uploads"); const evil = path.join(base, "uploads-evil");
    const prevDir = env.UPLOAD_DIR, prevDrv = env.STORAGE_DRIVER;
    env.UPLOAD_DIR = root; env.STORAGE_DRIVER = "local"; setStorage(null);
    try {
      await expect(storage().put("../uploads-evil/x.bin", Buffer.from("x"))).rejects.toMatchObject({ code: "VALIDATION" });
      expect(existsSync(path.join(evil, "x.bin"))).toBe(false);
      await storage().put("ok/file.bin", Buffer.from("x"));
      expect((await storage().get("ok/file.bin")).toString()).toBe("x");
    } finally {
      if (prevDir === undefined) delete env.UPLOAD_DIR; else env.UPLOAD_DIR = prevDir;
      if (prevDrv === undefined) delete env.STORAGE_DRIVER; else env.STORAGE_DRIVER = prevDrv;
      setStorage(null); rmSync(base, { recursive: true, force: true });
    }
  });
});

describe("authentication", () => {
  it("parallel wrong-password guesses cannot dodge the lockout counter", async () => {
    const s = await mkStaff(["requests.view"]);
    await Promise.all(Array.from({ length: 5 }, () => loginWithPassword(s.email!, "wrong-password", "10.0.0.9").catch(() => null)));
    const [after] = await db.select().from(users).where(eq(users.id, s.id));
    expect(after.failedLogins).toBe(5);
    expect(after.lockedUntil).not.toBeNull();
  });

  it("a lock that has run out starts a fresh count (one more typo does not lock the account again)", async () => {
    const s = await mkStaff(["requests.view"]);
    await db.update(users).set({ failedLogins: 5, lockedUntil: new Date(Date.now() - 60_000) }).where(eq(users.id, s.id));
    await expect(loginWithPassword(s.email!, "wrong-password", "10.0.0.10")).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
    const [after] = await db.select().from(users).where(eq(users.id, s.id));
    expect(after.failedLogins).toBe(1); expect(after.lockedUntil).toBeNull();
    expect((await loginWithPassword(s.email!, "Password123", "10.0.0.10")).mfaRequired).toBe(false);
  });

  it("public tracking cannot be brute-forced by spreading guesses over many addresses", async () => {
    const admin = await mkAdmin(); await mkRule(admin);
    const biz = await mkBusiness({ fundsCents: 500_00 });
    const r = await publishedRequest(biz, { shipments: mkShipments(2) });
    const { shipments } = await import("@/db/schema");
    const [s] = await db.select().from(shipments).where(eq(shipments.requestId, r.id));
    let blocked = 0;
    for (let i = 0; i < 40; i++) {
      const res = await call("GET", `/track/${s.code}?p=${String(1000 + i)}`, { headers: { "x-forwarded-for": `203.0.113.${i + 1}` } });
      if (res.status === 429) blocked++;
    }
    expect(blocked).toBeGreaterThan(0);
  });
});

describe("abuse limits and bounds", () => {
  it("money amounts are bounded (no integer overflow reaching Postgres)", async () => {
    const admin = await mkAdmin(); const staff = await mkStaff(["wallet.adjust"]);
    const biz = await mkBusiness({ fundsCents: 1000_00 }); const d = await mkDriver();
    const huge = 3_000_000_000;
    expect((await call("POST", "/wallet/topup", { token: await tok(biz), body: { amountCents: huge, idempotencyKey: "k-12345678" } })).status).toBe(422);
    expect((await call("POST", "/withdrawals", { token: await tok(d), body: { amountCents: huge } })).status).toBe(422);
    expect((await call("POST", "/admin/finance/adjustments", { token: await tok(staff), body: { userId: biz.id, amountCents: huge, reason: "too much", idempotencyKey: "adj-12345678" } })).status).toBe(422);
    expect((await call("POST", "/admin/pricing", { token: await tok(admin), body: { service: "delivery_driver", priceCents: huge, providerCostCents: 1 } })).status).toBe(422);
    expect((await call("POST", "/driver/location", { token: await tok(d), body: { lat: 999, lng: 0 } })).status).toBe(422);
  });

  it("profile text and list fields have length caps", async () => {
    const biz = await mkBusiness();
    const r = await call("PATCH", "/profile", { token: await tok(biz), body: { name: "n".repeat(5000) } });
    expect(r.status).toBe(422);
  });

  it("job chat is rate limited per user and a bad `since` is a 422, not a 500", async () => {
    const admin = await mkAdmin(); await mkRule(admin);
    const biz = await mkBusiness({ fundsCents: 500_00 }); const d = await mkDriver();
    const rq = await publishedRequest(biz);
    const [o] = await db.select().from(offers).where(eq(offers.requestId, rq.id));
    await jobs.acceptOffer(d, o.id, true);
    expect((await call("GET", `/offers/${o.id}/messages?since=not-a-date`, { token: await tok(d) })).status).toBe(422);
    let last = 0;
    for (let i = 0; i < 40; i++) last = (await call("POST", `/offers/${o.id}/messages`, { token: await tok(d), body: { body: `hello ${i}` } })).status;
    expect(last).toBe(429);
  });

  it("a ticket tied to an offer is tied to that offer's request, whatever request id the client also sent", async () => {
    const admin = await mkAdmin(); await mkRule(admin);
    const biz = await mkBusiness({ fundsCents: 500_00 }); const other = await mkBusiness({ fundsCents: 500_00 }); const d = await mkDriver();
    const mine = await publishedRequest(biz); const theirs = await publishedRequest(other);
    const [o] = await db.select().from(offers).where(eq(offers.requestId, mine.id));
    await jobs.acceptOffer(d, o.id, true);
    const t = await createTicket(d, { category: "other", subject: "hello there", offerId: o.id, requestId: theirs.id });
    expect(t.requestId).toBe(mine.id);
    const [row] = await db.select().from(tickets).where(eq(tickets.id, t.id));
    expect(row.requestId).toBe(mine.id);
  });

  it("drivers and offices never see the customer's price in a job timeline", async () => {
    const admin = await mkAdmin(); await mkRule(admin);
    const biz = await mkBusiness({ fundsCents: 500_00 }); const d = await mkDriver();
    const rq = await publishedRequest(biz);
    const [o] = await db.select().from(offers).where(eq(offers.requestId, rq.id));
    await jobs.acceptOffer(d, o.id, true);
    const tl = await call("GET", `/offers/${o.id}/timeline`, { token: await tok(d) });
    expect(tl.status).toBe(200);
    expect(JSON.stringify(tl.json)).not.toMatch(/totalCents|ruleVersion/);
    const owner = await call("GET", `/offers/${o.id}/timeline`, { token: await tok(biz) });
    expect(JSON.stringify(owner.json)).toMatch(/totalCents/);
  });

  it("housekeeping purges stale rate-limit counters, expired sessions / codes and abandoned idempotency claims", async () => {
    const biz = await mkBusiness();
    const old = new Date(Date.now() - 3 * 864e5);
    await db.insert(rateLimits).values([{ key: "old:key", count: 3, windowStart: old }, { key: "fresh:key", count: 1, windowStart: new Date() }]);
    await db.insert(sessions).values({ userId: biz.id, tokenHash: "h-old", expiresAt: old });
    await db.insert(otpCodes).values({ phone: "+966500000000", codeHash: "x", expiresAt: old });
    await db.insert(apiIdempotency).values({ businessId: biz.id, key: "stale-claim", requestHash: "h", response: {} as never, status: 0, createdAt: new Date(Date.now() - 3600_000) });
    await runMaintenance();
    const keys = (await db.select().from(rateLimits)).map((r) => r.key);
    expect(keys).toContain("fresh:key"); expect(keys).not.toContain("old:key");
    expect(await db.select().from(sessions).where(eq(sessions.tokenHash, "h-old"))).toHaveLength(0);
    expect(await db.select().from(otpCodes)).toHaveLength(0);
    expect(await db.select().from(apiIdempotency)).toHaveLength(0);
  });

  it("an idempotency claim abandoned by a crashed request does not block that key forever", async () => {
    const admin = await mkAdmin(); await mkRule(admin);
    const biz = await mkBusiness({ fundsCents: 500_00 });
    await db.insert(apiIdempotency).values({ businessId: biz.id, key: "crashed-1", requestHash: "whatever", response: {} as never, status: 0, createdAt: new Date(Date.now() - 10 * 60_000) });
    const { reqInput } = await import("../helpers/factories");
    const r = await createExternalJob(biz, reqInput(), "crashed-1");
    expect(r.status).toBe(201);
  });
});

void [mkOffice, setWebhook];
