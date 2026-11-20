/**
 * Platform update J1: everybody signs in with a username + password. Pins the contract of POST /auth/login (and its /auth/staff/login alias), the hardening
 * (indistinguishable failures, lockout, rate limit, suspended accounts, two-step verification), registration without a code, username availability,
 * change-password for every role, staff-managed credentials (reset password, rename), the must-change-password gate, accounts staff create, and the demo list.
 */
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { auditLogs, loginEvents, sessions, users } from "@/db/schema";
import { resetDb, shutdown, mkAdmin, mkBusiness, mkDriver, mkOffice, mkStaff, TEST_PASSWORD, STAFF_PASSWORD, usernameOfPhone } from "../helpers/factories";
import { call, login, tokenOf } from "../helpers/api";
import { base32Decode, stepOf, totpAt } from "@/server/auth/mfa";
import { hashPassword, passwordProblem } from "@/server/auth/password";
import { backfillAuth, DEMO_PASSWORD } from "@/server/demo-credentials";

beforeEach(resetDb);
afterAll(shutdown);

const env = process.env as Record<string, string | undefined>;
/** Runs `fn` with the platform NOT in demo mode (the sign-in limits are strict there; demo / test deployments get roomy ones). */
async function strict<T>(fn: () => Promise<T>) {
  const prev = env.DEMO_MODE; env.DEMO_MODE = "false";
  try { return await fn(); } finally { if (prev === undefined) delete env.DEMO_MODE; else env.DEMO_MODE = prev; }
}
const audits = (action: string, entityId: string) => db.select().from(auditLogs).where(and(eq(auditLogs.action, action), eq(auditLogs.entityId, entityId)));
const row = async (id: string) => (await db.select().from(users).where(eq(users.id, id)))[0];
const reg = (o: Record<string, unknown> = {}) => ({ role: "business", username: "new.person", password: TEST_PASSWORD, name: "New Person", phone: "0500000601", companyName: "Acme", city: "riyadh", termsAccepted: true, ...o });
const makers = { business: () => mkBusiness(), driver: () => mkDriver(), office: () => mkOffice() };

describe("sign in with username + password — every role", () => {
  it("business, driver, office, staff and admin all get a session from /auth/login", async () => {
    const all = [await mkBusiness(), await mkDriver(), await mkOffice(), await mkStaff(["requests.view"]), await mkAdmin()];
    for (const u of all) {
      const r = await login(u.username!, u.role === "staff" || u.role === "admin" ? STAFF_PASSWORD : TEST_PASSWORD);
      expect(r.status, u.role).toBe(200);
      expect(r.json.user).toMatchObject({ id: u.id, role: u.role, username: u.username, mustChangePassword: false });
      expect(JSON.stringify(r.json)).not.toContain("passwordHash");
      expect((await call("GET", "/auth/me", { token: r.json.token })).json.user.username).toBe(u.username);
    }
  });

  it("the username is case-insensitive and trimmed; staff may type their e-mail address instead; /auth/staff/login is an alias", async () => {
    const biz = await mkBusiness(); const staff = await mkStaff(["requests.view"]);
    expect((await login(`  ${biz.username!.toUpperCase()}  `)).status).toBe(200);
    expect((await login(staff.email!.toUpperCase(), STAFF_PASSWORD)).status).toBe(200);
    expect((await call("POST", "/auth/staff/login", { body: { email: staff.email, password: STAFF_PASSWORD } })).status).toBe(200);
    expect((await call("POST", "/auth/staff/login", { body: { username: staff.username, password: STAFF_PASSWORD } })).status).toBe(200);
    expect((await call("POST", "/auth/staff/login", { body: { password: STAFF_PASSWORD } })).status).toBe(422); // neither a username nor an e-mail
  });

  it("sets the session cookie for the web client only; a successful sign-in is recorded with method 'password' and the username", async () => {
    const biz = await mkBusiness();
    const web = await login(biz.username!);
    expect(web.headers.get("set-cookie")).toContain("jr_session=");
    const mobile = await call("POST", "/auth/login", { body: { username: biz.username, password: TEST_PASSWORD }, headers: { "x-client": "mobile" } });
    expect(mobile.status).toBe(200); expect(mobile.headers.get("set-cookie")).toBeNull();
    const ev = await db.select().from(loginEvents).where(eq(loginEvents.userId, biz.id));
    expect(ev.map((e) => [e.method, e.success, e.identifier, e.client]).sort()).toEqual([["password", true, biz.username, "mobile"], ["password", true, biz.username, "web"]].sort());
    const u = await row(biz.id); expect(u.loginCount).toBe(2);
  });

  it("an unknown username and a wrong password are indistinguishable (same status, code, message, shape)", async () => {
    const biz = await mkBusiness();
    const wrong = await login(biz.username!, "Wrong#Pass2026"); const unknown = await login("nobody.here", "Wrong#Pass2026");
    expect(wrong.status).toBe(401); expect(unknown.status).toBe(401);
    const shape = (r: { json: { error: Record<string, unknown> } }) => ({ ...r.json.error, correlation_id: undefined });
    expect(shape(wrong)).toEqual(shape(unknown));
    expect(wrong.json.error).toMatchObject({ code: "UNAUTHENTICATED", message: "Invalid credentials" });
    const why = (await db.select().from(loginEvents).orderBy(loginEvents.createdAt)).map((e) => e.failureReason);
    expect(why).toEqual(["bad_password", "unknown_user"]); // the log knows, the caller does not
  });

  it("an account without a password cannot sign in until staff set one", async () => {
    const biz = await mkBusiness(); await db.update(users).set({ passwordHash: null }).where(eq(users.id, biz.id));
    const r = await login(biz.username!, TEST_PASSWORD);
    expect(r.status).toBe(401); expect(r.json.error.message).toBe("Invalid credentials");
  });

  it("5 wrong passwords lock the account for 15 minutes, even for the right password; the lock then expires", async () => {
    const d = await mkDriver();
    for (let i = 0; i < 5; i++) expect((await login(d.username!, "Wrong#Pass2026")).status).toBe(401);
    const locked = await login(d.username!, TEST_PASSWORD);
    expect(locked.status).toBe(429); expect(locked.json.error).toMatchObject({ code: "RATE_LIMITED", message: "Account temporarily locked" });
    const u = await row(d.id); expect(u.failedLogins).toBe(5);
    expect(u.lockedUntil!.getTime()).toBeGreaterThan(Date.now() + 14 * 60_000); expect(u.lockedUntil!.getTime()).toBeLessThan(Date.now() + 16 * 60_000);
    await db.update(users).set({ lockedUntil: new Date(Date.now() - 1000) }).where(eq(users.id, d.id));
    expect((await login(d.username!, TEST_PASSWORD)).status).toBe(200);
    expect((await row(d.id)).failedLogins).toBe(0);
  });

  it("is rate limited per ip + username (10 / 15 min) outside demo mode, and the limit is roomy in demo / test deployments", async () => {
    await strict(async () => {
      const h = { "x-forwarded-for": "10.7.7.7" };
      for (let i = 0; i < 10; i++) expect((await login("ghost.user", "Wrong#Pass2026", { headers: h })).status, `attempt ${i + 1}`).toBe(401);
      const eleventh = await login("ghost.user", "Wrong#Pass2026", { headers: h });
      expect(eleventh.status).toBe(429); expect(eleventh.json.error.code).toBe("RATE_LIMITED");
      expect((await login("another.ghost", "Wrong#Pass2026", { headers: h })).status).toBe(401); // another name from the same address is counted separately
      expect((await login("ghost.user", "Wrong#Pass2026", { headers: { "x-forwarded-for": "10.8.8.8" } })).status).toBe(401); // and so is another address
    });
    for (let i = 0; i < 15; i++) expect((await login("ghost.user", "Wrong#Pass2026", { headers: { "x-forwarded-for": "10.9.9.9" } })).status).toBe(401); // demo mode: no limit hit
  });

  it("a suspended account is refused once the password is right (403), and no session is created", async () => {
    const biz = await mkBusiness(); await db.update(users).set({ status: "suspended" }).where(eq(users.id, biz.id));
    expect((await login(biz.username!, "Wrong#Pass2026")).status).toBe(401); // a wrong password tells nothing about the account
    const r = await login(biz.username!);
    expect(r.status).toBe(403); expect(r.json.error).toMatchObject({ code: "FORBIDDEN", message: "Account suspended" });
    expect(r.json.token).toBeUndefined();
    expect(await db.select().from(sessions).where(eq(sessions.userId, biz.id))).toHaveLength(0);
    expect((await db.select().from(loginEvents).where(eq(loginEvents.userId, biz.id))).map((e) => e.failureReason)).toEqual(["bad_password", "suspended"]);
  });
});

describe("two-step verification (staff) still works through /auth/login", () => {
  it("the password alone gives no session; the code from the authenticator completes it (also via the alias)", async () => {
    const staff = await mkStaff(["requests.view"]);
    const t = (await login(staff.username!, STAFF_PASSWORD)).json.token as string;
    const setup = await call("POST", "/auth/mfa/setup", { token: t });
    const code = (offset = 0) => totpAt(base32Decode(setup.json.secret), stepOf() + offset);
    expect((await call("POST", "/auth/mfa/enable", { token: t, body: { code: code() } })).status).toBe(200);
    for (const first of [await login(staff.username!, STAFF_PASSWORD), await call("POST", "/auth/staff/login", { body: { email: staff.email, password: STAFF_PASSWORD } })]) {
      expect(first.status).toBe(200); expect(first.json).toMatchObject({ mfaRequired: true }); expect(first.json.token).toBeUndefined(); expect(first.headers.get("set-cookie")).toBeNull();
    }
    const step1 = await login(staff.email!, STAFF_PASSWORD);
    expect((await call("POST", "/auth/staff/login/mfa", { body: { mfaToken: step1.json.mfaToken, code: "123456" } })).status).toBe(401);
    const done = await call("POST", "/auth/staff/login/mfa", { body: { mfaToken: step1.json.mfaToken, code: code(1) } });
    expect(done.status).toBe(200); expect(done.json.user.username).toBe(staff.username); expect(done.headers.get("set-cookie")).toContain("jr_session=");
  });

  it("customers (business / driver / office) never get a second step", async () => {
    for (const make of Object.values(makers)) { const u = await make(); const r = await login(u.username!); expect(r.json.mfaRequired).toBeUndefined(); expect(r.json.token).toBeTruthy(); }
  });
});

describe("registration (no code)", () => {
  it("creates the account, returns a session, and stores the username lower-cased with a hashed password", async () => {
    const r = await call("POST", "/auth/register", { body: reg({ username: "New.Person" }) });
    expect(r.status).toBe(201);
    expect(r.json.user).toMatchObject({ role: "business", username: "new.person", phone: "+966500000601", name: "New Person" });
    const u = await row(r.json.user.id);
    expect(u.username).toBe("new.person"); expect(u.passwordHash).toMatch(/^\$2[aby]\$/); expect(u.passwordHash).not.toContain(TEST_PASSWORD); expect(u.mustChangePassword).toBe(false);
    expect((await call("GET", "/auth/me", { token: r.json.token })).status).toBe(200);
    expect((await login("new.person")).status).toBe(200); // and the same person can sign in afterwards
    expect((await audits("user.register", u.id))).toHaveLength(1);
  });

  it("every role registers the same way", async () => {
    const d = await call("POST", "/auth/register", { body: { role: "driver", username: "drv.one", password: TEST_PASSWORD, name: "Drv One", phone: "0500000602", vehicleType: "sedan", services: ["delivery_driver"], termsAccepted: true } });
    const o = await call("POST", "/auth/register", { body: reg({ role: "office", username: "off.one", phone: "0500000603", companyName: "Off One" }) });
    expect([d.status, o.status]).toEqual([201, 201]);
  });

  it("409 says in details.field which of username / phone / email is taken", async () => {
    expect((await call("POST", "/auth/register", { body: reg({ email: "first@x.com" }) })).status).toBe(201);
    const byName = await call("POST", "/auth/register", { body: reg({ phone: "0500000604", email: "other@x.com", username: "NEW.PERSON" }) });
    const byPhone = await call("POST", "/auth/register", { body: reg({ username: "someone.else", email: "other@x.com" }) });
    const byEmail = await call("POST", "/auth/register", { body: reg({ username: "someone.else", phone: "0500000604", email: "FIRST@x.com" }) });
    expect([byName.status, byPhone.status, byEmail.status]).toEqual([409, 409, 409]);
    expect([byName, byPhone, byEmail].map((r) => [r.json.error.code, r.json.error.details.field])).toEqual([["CONFLICT", "username"], ["CONFLICT", "phone"], ["CONFLICT", "email"]]);
    expect(await db.select().from(users)).toHaveLength(1);
  });

  it("username rules: 3–30 characters of a-z 0-9 . _ - starting with a letter or digit; reserved words refused", async () => {
    const bad = ["ab", "x".repeat(31), "has space", "-lead", ".lead", "_lead", "emoji😀name", "name@host", "عربي.name", "a/b"];
    let n = 700;
    for (const username of bad) { const r = await call("POST", "/auth/register", { body: reg({ username, phone: `0500000${++n}` }) }); expect([r.status, r.json.error.details.field], username).toEqual([422, "username"]); }
    for (const username of ["admin", "Administrator", "root", "support", "jrlogistics"]) { const r = await call("POST", "/auth/register", { body: reg({ username, phone: `0500000${++n}` }) }); expect([r.status, r.json.error.details.reason], username).toEqual([422, "reserved"]); }
    for (const username of ["abc", "x".repeat(30), "9lives", "a.b_c-d", "demo.shop"]) { const r = await call("POST", "/auth/register", { body: reg({ username, phone: `0500000${++n}` }) }); expect(r.status, username).toBe(201); }
  });

  it("password policy is the shared one (≥ 10 characters, a letter and a digit); terms and phone are required", async () => {
    expect((await call("POST", "/auth/register", { body: reg({ password: "short1" }) })).json.error).toMatchObject({ code: "VALIDATION", message: "PASSWORD_TOO_SHORT", details: { field: "password" } });
    expect((await call("POST", "/auth/register", { body: reg({ password: "onlyletterspassword" }) })).json.error.message).toBe("PASSWORD_WEAK");
    expect((await call("POST", "/auth/register", { body: reg({ termsAccepted: false }) })).json.error.code).toBe("TERMS_REQUIRED");
    expect((await call("POST", "/auth/register", { body: reg({ phone: "12" }) })).status).toBe(422);
    expect((await call("POST", "/auth/register", { body: { ...reg(), phone: undefined } })).status).toBe(422);
    expect((await call("POST", "/auth/register", { body: reg({ role: "admin" }) })).status).toBe(422);
    expect(await db.select().from(users)).toHaveLength(0);
  });

  it("is rate limited per address (5 an hour outside demo mode)", async () => {
    await strict(async () => {
      const h = { "x-forwarded-for": "10.5.5.5" };
      for (let i = 0; i < 5; i++) expect((await call("POST", "/auth/register", { body: reg({ username: `rate.${i}`, phone: `050000070${i}` }), headers: h })).status).toBe(201);
      expect((await call("POST", "/auth/register", { body: reg({ username: "rate.6", phone: "0500000706" }), headers: h })).status).toBe(429);
    });
  });

  it("the one-time-code endpoints are gone", async () => {
    for (const p of ["/auth/otp/send", "/auth/otp/verify"]) expect((await call("POST", p, { body: { phone: "0500000611", code: "123456" } })).status).toBe(404);
  });
});

describe("GET /auth/username-available", () => {
  it("reports available / taken / invalid / reserved, case-insensitively, without a session", async () => {
    const biz = await mkBusiness();
    const ask = async (u: string) => (await call("GET", `/auth/username-available?username=${encodeURIComponent(u)}`)).json;
    expect(await ask("fresh.name")).toEqual({ available: true });
    expect(await ask(biz.username!)).toEqual({ available: false, reason: "taken" });
    expect(await ask(biz.username!.toUpperCase())).toEqual({ available: false, reason: "taken" });
    expect(await ask("a")).toEqual({ available: false, reason: "invalid" });
    expect(await ask("has space")).toEqual({ available: false, reason: "invalid" });
    expect(await ask("ADMIN")).toEqual({ available: false, reason: "reserved" });
    expect((await call("GET", "/auth/username-available")).status).toBe(422); // the parameter is required
  });
  it("is rate limited per address", async () => {
    await strict(async () => {
      const h = { "x-forwarded-for": "10.6.6.6" };
      for (let i = 0; i < 60; i++) expect((await call("GET", "/auth/username-available?username=abc", { headers: h })).status).toBe(200);
      expect((await call("GET", "/auth/username-available?username=abc", { headers: h })).status).toBe(429);
    });
  });
});

describe("POST /auth/change-password — every role", () => {
  for (const [role, make] of [...Object.entries(makers), ["staff", () => mkStaff(["requests.view"])], ["admin", () => mkAdmin()]] as Array<[string, () => Promise<{ id: string; username: string | null; role: string }>]>) {
    it(`${role}: needs the current password, enforces the policy, ends the OTHER sessions, keeps this one, audits`, async () => {
      const u = await make(); const pw = role === "staff" || role === "admin" ? STAFF_PASSWORD : TEST_PASSWORD; const next = "Brand-New#2027x";
      const here = (await login(u.username!, pw)).json.token as string, other = (await login(u.username!, pw)).json.token as string;
      const post = (body: unknown, token = here) => call("POST", "/auth/change-password", { token, body });
      expect((await post({ currentPassword: "not-the-password", newPassword: next })).status).toBe(401);
      const weak = await post({ currentPassword: pw, newPassword: "abcdefghijkl" });
      expect([weak.status, weak.json.error.details.field, weak.json.error.message]).toEqual([422, "newPassword", "PASSWORD_WEAK"]);
      expect((await post({ currentPassword: pw, newPassword: "short1" })).status).toBe(422);
      const same = await post({ currentPassword: pw, newPassword: pw });
      expect([same.status, same.json.error.message]).toEqual([422, "SAME_PASSWORD"]);
      expect((await call("POST", "/auth/change-password", { body: { currentPassword: pw, newPassword: next } })).status).toBe(401); // signed in only
      const ok = await post({ currentPassword: pw, newPassword: next });
      expect(ok.status).toBe(200); expect(ok.json).toEqual({ ok: true });
      expect((await call("GET", "/auth/me", { token: here })).status).toBe(200);     // the device that changed it stays signed in
      expect((await call("GET", "/auth/me", { token: other })).status).toBe(401);    // every other session ended
      expect((await db.select().from(sessions).where(and(eq(sessions.userId, u.id), eq(sessions.revokeReason, "password_changed")))).length).toBeGreaterThanOrEqual(1);
      expect((await login(u.username!, pw)).status).toBe(401);
      expect((await login(u.username!, next)).status).toBe(200);
      expect(await audits("auth.change_password", u.id)).toHaveLength(1);
    });
  }

  it("clears the 'choose a new password' flag", async () => {
    const biz = await mkBusiness(); await db.update(users).set({ mustChangePassword: true }).where(eq(users.id, biz.id));
    const token = await tokenOf(biz);
    expect((await call("POST", "/auth/change-password", { token, body: { currentPassword: TEST_PASSWORD, newPassword: "Chosen#By2027me" } })).status).toBe(200);
    expect((await row(biz.id)).mustChangePassword).toBe(false);
    expect((await call("GET", "/wallet", { token })).status).toBe(200);
  });

  it("the current password cannot be guessed through a stolen session (10 tries / 15 min outside demo mode)", async () => {
    const biz = await mkBusiness(); const token = await tokenOf(biz);
    await strict(async () => {
      for (let i = 0; i < 10; i++) expect((await call("POST", "/auth/change-password", { token, body: { currentPassword: `guess-${i}-xx`, newPassword: "Brand-New#2027x" } })).status).toBe(401);
      expect((await call("POST", "/auth/change-password", { token, body: { currentPassword: TEST_PASSWORD, newPassword: "Brand-New#2027x" } })).status).toBe(429);
    });
  });
});

describe("the must-change-password gate (temporary passwords)", () => {
  for (const [role, make, path] of [["business", makers.business, "/wallet"], ["driver", makers.driver, "/driver/overview"], ["office", makers.office, "/wallet"], ["staff", () => mkStaff(["requests.view"]), "/admin/stats"]] as const) {
    it(`${role}: everything but /auth/me, /auth/change-password and logout answers 403 PASSWORD_CHANGE_REQUIRED`, async () => {
      const u = await make(); await db.update(users).set({ mustChangePassword: true }).where(eq(users.id, u.id));
      const token = await tokenOf(u, role === "staff" ? STAFF_PASSWORD : TEST_PASSWORD);
      const blocked = await call("GET", path, { token });
      expect([blocked.status, blocked.json.error.code]).toEqual([403, "PASSWORD_CHANGE_REQUIRED"]);
      expect((await call("GET", "/auth/me", { token })).json.user.mustChangePassword).toBe(true);
      expect((await call("POST", "/auth/logout", { token })).status).toBe(200);
    });
  }
});

describe("staff reset a password — POST /admin/users/:id/reset-password", () => {
  const as = async (u: { id: string }, p: string) => call("POST", `/admin/users/${u.id}/reset-password`, { token: await adminTok(), body: p === "" ? {} : { password: p } });
  let adminTok: () => Promise<string>;
  beforeEach(async () => { const a = await mkAdmin(); adminTok = () => tokenOf(a, STAFF_PASSWORD); });

  it("without a password it generates a strong one and returns it ONCE; the person must change it; sessions end; a lockout is lifted; audited without the secret", async () => {
    for (const make of Object.values(makers)) {
      const u = await make(); const old = await tokenOf(u);
      await db.update(users).set({ failedLogins: 5, lockedUntil: new Date(Date.now() + 3600_000) }).where(eq(users.id, u.id));
      const r = await as(u, "");
      expect(r.status).toBe(200);
      expect(r.json).toMatchObject({ id: u.id, username: u.username, mustChangePassword: true, generated: true });
      expect(passwordProblem(r.json.password)).toBeNull(); expect(r.json.password).toMatch(/^[A-Za-z0-9]{4}-[A-Za-z0-9]{4}-[A-Za-z0-9]{4}$/);
      expect(r.json.passwordHash).toBeUndefined();
      expect((await call("GET", "/auth/me", { token: old })).status).toBe(401);
      const after = await row(u.id);
      expect(after).toMatchObject({ mustChangePassword: true, failedLogins: 0, lockedUntil: null }); expect(JSON.stringify(after)).not.toContain(r.json.password);
      const signIn = await login(u.username!, r.json.password);
      expect(signIn.status).toBe(200); expect(signIn.json.user.mustChangePassword).toBe(true);
      expect((await login(u.username!, TEST_PASSWORD)).status).toBe(401);
      const [a] = await audits("user.password_reset", u.id);
      expect(a.diff).toEqual({ role: u.role, generated: true }); expect(JSON.stringify(a)).not.toContain(r.json.password);
      const again = await as(u, ""); expect(again.json.password).not.toBe(r.json.password); // a new one every time
    }
  });

  it("accepts a password staff typed (policy enforced) and does not echo it back", async () => {
    const d = await mkDriver();
    const weak = await as(d, "short1"); expect([weak.status, weak.json.error.details.field]).toEqual([422, "password"]);
    const ok = await as(d, "Typed#By2027staff");
    expect(ok.status).toBe(200); expect(ok.json).toEqual({ id: d.id, username: d.username, mustChangePassword: true, generated: false });
    expect((await login(d.username!, "Typed#By2027staff")).status).toBe(200);
  });

  it("is for people with accounts.edit (customers) or staff.manage (colleagues); never for administrators or yourself", async () => {
    const biz = await mkBusiness(); const colleague = await mkStaff(["requests.view"]);
    const post = (token: string, id: string) => call("POST", `/admin/users/${id}/reset-password`, { token, body: {} });
    const editor = await tokenOf(await mkStaff(["accounts.edit"]), STAFF_PASSWORD);
    expect((await post(editor, biz.id)).status).toBe(200);
    expect((await post(editor, colleague.id)).status).toBe(403);                       // colleagues need staff.manage
    const noPerm = await tokenOf(await mkStaff(["users.view"]), STAFF_PASSWORD);
    expect((await post(noPerm, biz.id)).status).toBe(403);
    expect((await post(await tokenOf(await mkBusiness()), biz.id)).status).toBe(403);   // customers cannot
    expect((await call("POST", `/admin/users/${biz.id}/reset-password`, { body: {} })).status).toBe(401);
    const manager = await mkStaff(["staff.manage", "requests.view"]); const mt = await tokenOf(manager, STAFF_PASSWORD);
    expect((await post(mt, colleague.id)).status).toBe(200);
    expect((await post(mt, manager.id)).status).toBe(403);                              // not your own (use Change password)
    const admin = await mkAdmin(); expect((await post(mt, admin.id)).status).toBe(404);
    expect((await post(await adminTok(), admin.id)).status).toBe(404);
    expect((await post(await adminTok(), "not-a-uuid")).status).toBe(404);
  });
});

describe("staff rename an account — PATCH /admin/users/:id/username", () => {
  it("renames (lower-cased), audits from → to, keeps the person signed in, and the old name stops working", async () => {
    const a = await mkAdmin(); const t = await tokenOf(a, STAFF_PASSWORD); const biz = await mkBusiness(); const old = biz.username!; const session = await tokenOf(biz);
    const r = await call("PATCH", `/admin/users/${biz.id}/username`, { token: t, body: { username: "  New.Shop_1 " } });
    expect(r.status).toBe(200); expect(r.json).toEqual({ id: biz.id, username: "new.shop_1", changed: true });
    expect((await call("GET", "/auth/me", { token: session })).json.user.username).toBe("new.shop_1");
    expect((await login(old)).status).toBe(401); expect((await login("NEW.shop_1")).status).toBe(200);
    const [log] = await audits("user.username_change", biz.id); expect(log).toMatchObject({ actorId: a.id }); expect(log.diff).toEqual({ role: "business", from: old, to: "new.shop_1" });
    expect((await call("PATCH", `/admin/users/${biz.id}/username`, { token: t, body: { username: "new.shop_1" } })).json).toEqual({ id: biz.id, username: "new.shop_1", changed: false });
    expect(await audits("user.username_change", biz.id)).toHaveLength(1);
  });

  it("stays unique (409 with details.field), keeps the format rules (422) and the reserved words", async () => {
    const t = await tokenOf(await mkAdmin(), STAFF_PASSWORD); const [a, b] = [await mkDriver(), await mkDriver()];
    const clash = await call("PATCH", `/admin/users/${a.id}/username`, { token: t, body: { username: b.username!.toUpperCase() } });
    expect([clash.status, clash.json.error.code, clash.json.error.details.field]).toEqual([409, "CONFLICT", "username"]);
    for (const bad of ["ab", "has space", "x".repeat(40)]) expect((await call("PATCH", `/admin/users/${a.id}/username`, { token: t, body: { username: bad } })).status, bad).toBe(422);
    expect((await call("PATCH", `/admin/users/${a.id}/username`, { token: t, body: { username: "admin" } })).json.error.details.reason).toBe("reserved");
    expect((await row(a.id)).username).toBe(a.username);
  });

  it("needs accounts.edit (customers) or staff.manage (colleagues); administrators are untouchable", async () => {
    const biz = await mkBusiness(); const colleague = await mkStaff(["requests.view"]); const admin = await mkAdmin();
    const patch = (token: string, id: string, username: string) => call("PATCH", `/admin/users/${id}/username`, { token, body: { username } });
    const editor = await tokenOf(await mkStaff(["accounts.edit"]), STAFF_PASSWORD);
    expect((await patch(editor, biz.id, "ok.name1")).status).toBe(200);
    expect((await patch(editor, colleague.id, "ok.name2")).status).toBe(403);
    expect((await patch(await tokenOf(await mkStaff(["users.view"]), STAFF_PASSWORD), biz.id, "ok.name3")).status).toBe(403);
    expect((await patch(await tokenOf({ username: "ok.name1" }), biz.id, "ok.name4")).status).toBe(403);   // customers cannot rename anybody (this one was renamed just above)
    expect((await call("PATCH", `/admin/users/${biz.id}/username`, { body: { username: "ok.name4" } })).status).toBe(401);
    expect((await patch(await tokenOf(await mkStaff(["staff.manage", "requests.view"]), STAFF_PASSWORD), colleague.id, "ok.name5")).status).toBe(200);
    expect((await patch(await tokenOf(await mkStaff(["staff.manage"]), STAFF_PASSWORD), colleague.id, "ok.name7")).status).toBe(403); // …but not one who holds permissions they do not
    expect((await patch(await tokenOf(admin, STAFF_PASSWORD), admin.id, "ok.name6")).status).toBe(404);
  });

  it("GET /admin/users/:id/credentials shows the username and the state of the password (never the hash)", async () => {
    const t = await tokenOf(await mkAdmin(), STAFF_PASSWORD); const biz = await mkBusiness();
    await db.update(users).set({ mustChangePassword: true, failedLogins: 5, lockedUntil: new Date(Date.now() + 600_000) }).where(eq(users.id, biz.id));
    const r = await call("GET", `/admin/users/${biz.id}/credentials`, { token: t });
    expect(r.status).toBe(200); expect(r.json).toMatchObject({ id: biz.id, username: biz.username, hasPassword: true, mustChangePassword: true, failedLogins: 5 }); expect(r.json.lockedUntil).toBeTruthy();
    expect(JSON.stringify(r.json)).not.toMatch(/\$2[aby]\$/);
    expect((await call("GET", `/admin/users/${biz.id}/credentials`, { token: await tokenOf(await mkStaff(["users.view"]), STAFF_PASSWORD) })).status).toBe(403);
  });
});

describe("staff find accounts by username", () => {
  it("the user list returns the username and the search box matches it", async () => {
    const t = await tokenOf(await mkAdmin(), STAFF_PASSWORD); const biz = await mkBusiness(); await mkDriver();
    const r = await call("GET", `/admin/users?q=${encodeURIComponent(biz.username!.slice(0, 8))}&pageSize=50`, { token: t });
    expect(r.status).toBe(200);
    expect(r.json.items.find((x: { id: string }) => x.id === biz.id)).toMatchObject({ username: biz.username, role: "business" });
    await call("PATCH", `/admin/users/${biz.id}/username`, { token: t, body: { username: "searchable.shop" } });
    const byName = await call("GET", "/admin/users?q=searchable&pageSize=50", { token: t });
    expect(byName.json.items.map((x: { id: string }) => x.id)).toEqual([biz.id]);
  });
});

describe("accounts staff create sign in with the credentials they were given", () => {
  const body = (o: Record<string, unknown> = {}) => ({ kind: "business", name: "Sara Ali", phone: "0501110001", city: "riyadh", companyName: "Alpha Trading", ...o });
  const creator = async () => tokenOf(await mkStaff(["accounts.create", "accounts.edit"]), STAFF_PASSWORD);

  it("username + password given: the person signs in with them, must change the password first, and the password is never echoed", async () => {
    const r = await call("POST", "/admin/accounts", { token: await creator(), body: body({ username: "Alpha.Trading", password: "Temp#By2027staff" }) });
    expect(r.status).toBe(201); expect(r.json.credentials).toEqual({ username: "alpha.trading", mustChangePassword: true }); expect(JSON.stringify(r.json)).not.toContain("Temp#By2027staff");
    const signIn = await login("ALPHA.trading", "Temp#By2027staff");
    expect(signIn.status).toBe(200); expect(signIn.json.user).toMatchObject({ id: r.json.user.id, role: "business", mustChangePassword: true });
    expect((await call("GET", "/wallet", { token: signIn.json.token })).json.error.code).toBe("PASSWORD_CHANGE_REQUIRED");
    expect((await call("POST", "/auth/change-password", { token: signIn.json.token, body: { currentPassword: "Temp#By2027staff", newPassword: "Chosen#By2027me" } })).status).toBe(200);
    expect((await call("GET", "/wallet", { token: signIn.json.token })).status).toBe(200);
  });

  it("nothing given: the username is u + the digits of the phone and a strong password is generated and returned once", async () => {
    const r = await call("POST", "/admin/accounts", { token: await creator(), body: body({ kind: "driver", companyName: undefined, vehicleType: "sedan", services: ["delivery_driver"] }) });
    expect(r.status).toBe(201); expect(r.json.credentials.username).toBe(usernameOfPhone("+966501110001"));
    expect(passwordProblem(r.json.credentials.generatedPassword)).toBeNull();
    expect((await login(r.json.credentials.username, r.json.credentials.generatedPassword)).status).toBe(200);
    const [a] = await audits("account.create", r.json.user.id); expect(a.diff).toMatchObject({ username: "u966501110001", passwordGenerated: true }); expect(JSON.stringify(a)).not.toContain(r.json.credentials.generatedPassword);
  });

  it("refuses a taken / invalid / reserved username and a weak password (keyed by field) and creates nothing", async () => {
    const t = await creator(); const taken = await mkBusiness();
    const dup = await call("POST", "/admin/accounts", { token: t, body: body({ username: taken.username!.toUpperCase() }) });
    expect([dup.status, dup.json.error.details.field]).toEqual([409, "username"]);
    expect((await call("POST", "/admin/accounts", { token: t, body: body({ username: "a b" }) })).json.error.details.username).toBeTruthy();
    expect((await call("POST", "/admin/accounts", { token: t, body: body({ username: "admin" }) })).json.error.details.username).toBeTruthy();
    expect((await call("POST", "/admin/accounts", { token: t, body: body({ password: "weak" }) })).json.error.details.password).toBeTruthy();
    expect(await db.select().from(users).where(eq(users.phone, "+966501110001"))).toHaveLength(0);
  });

  it("a derived username that is already used gets a number (-2, -3 …)", async () => {
    const t = await creator();
    await db.insert(users).values({ role: "business", name: "Squatter", phone: "+966599999999", username: "u966501110001", passwordHash: await hashPassword(TEST_PASSWORD) });
    const r = await call("POST", "/admin/accounts", { token: t, body: body() });
    expect(r.json.credentials.username).toBe("u966501110001-2");
  });

  it("POST /admin/staff takes a username too (default: the part of the e-mail before the @, numbered when taken)", async () => {
    const t = await tokenOf(await mkAdmin(), STAFF_PASSWORD);
    const post = (o: Record<string, unknown>) => call("POST", "/admin/staff", { token: t, body: { name: "New Staff", password: "Temp0rary!Pass1", staffRole: "support", ...o } });
    const a = await post({ email: "Zed.Ops@jr.test" }); expect([a.status, a.json.username]).toEqual([201, "zed.ops"]);
    const b = await post({ email: "zed.ops@other.test" }); expect(b.json.username).toBe("zed.ops-2");
    const c = await post({ email: "c@jr.test", username: "chosen.name" }); expect(c.json.username).toBe("chosen.name");
    const d = await post({ email: "d@jr.test", username: "Chosen.Name" }); expect([d.status, d.json.error.details.field]).toEqual([409, "username"]);
    expect((await post({ email: "e@jr.test", username: "root" })).status).toBe(422);
    const si = await login("chosen.name", "Temp0rary!Pass1");
    expect(si.status).toBe(200); expect(si.json.user).toMatchObject({ role: "staff", mustChangePassword: true });
    expect((await login("zed.ops@jr.test", "Temp0rary!Pass1")).status).toBe(200); // the e-mail works as well
  });
});

describe("demo accounts list (demo mode only)", () => {
  it("lists username + published password for the demo accounts, with the readable demo usernames; 404 outside demo mode", async () => {
    const u = await mkBusiness(); await db.update(users).set({ isDemo: true, phone: "+966500000001", username: null }).where(eq(users.id, u.id));
    await backfillAuth();
    const r = await call("GET", "/auth/demo-accounts");
    expect(r.status).toBe(200);
    expect(r.json.items).toContainEqual(expect.objectContaining({ role: "business", username: "demo.business", password: DEMO_PASSWORD }));
    expect((await login("demo.business", DEMO_PASSWORD)).status).toBe(200);
    expect(JSON.stringify(r.json)).not.toMatch(/\$2[aby]\$/);
    await strict(async () => expect((await call("GET", "/auth/demo-accounts")).status).toBe(404));
  });
});

describe("backfill: usernames for existing accounts and demo credentials (npm run db:backfill:auth)", () => {
  it("gives every account without a username one, makes demo accounts readable with the published password, never gives a real account a password, and is idempotent", async () => {
    const mk = async (v: Partial<typeof users.$inferInsert> & { role: string; name: string }) => (await db.insert(users).values({ username: null, ...v }).returning())[0];
    const demoBiz = await mk({ role: "business", name: "Demo Biz", phone: "+966500000001", isDemo: true, passwordHash: null });
    const demoStaff = await mk({ role: "staff", name: "Demo Ops", email: "ops@jrlogistics.demo", isDemo: true, passwordHash: null });
    const real = await mk({ role: "driver", name: "Real Driver", phone: "+966555000111", passwordHash: null });
    const realStaff = await mk({ role: "staff", name: "Real Staff", email: "Jane.Doe@jr.com" });
    const first = await backfillAuth();
    expect(first.usernamesFilled).toBe(4);
    expect((await row(demoBiz.id)).username).toBe("demo.business"); expect((await row(demoStaff.id)).username).toBe("demo.ops");
    expect((await row(real.id)).username).toBe("u966555000111"); expect((await row(realStaff.id)).username).toBe("jane.doe");
    expect((await row(real.id)).passwordHash).toBeNull();
    expect((await login("demo.business", DEMO_PASSWORD)).status).toBe(200); expect((await login("demo.ops", DEMO_PASSWORD)).status).toBe(200);
    expect((await login("u966555000111", DEMO_PASSWORD)).status).toBe(401);
    expect((await row(demoBiz.id)).mustChangePassword).toBe(false);
    const second = await backfillAuth(); expect(second.usernamesFilled).toBe(0);
    expect((await row(demoBiz.id)).username).toBe("demo.business");
  });

  it("migration 0021 backfill rule: staff → e-mail local part (-2, -3 on a clash), everyone else → u + the digits of the phone", async () => {
    const sqlText = readFileSync(path.join(process.cwd(), "drizzle/0021_username_login.sql"), "utf8");
    const block = sqlText.split("--> statement-breakpoint").find((p) => p.includes("DO $$"))!;
    const mk = async (v: Partial<typeof users.$inferInsert> & { role: string; name: string }) => (await db.insert(users).values({ username: null, ...v }).returning())[0];
    const t0 = Date.now();
    const a = await mk({ role: "staff", name: "A", email: "Ops@x.com", createdAt: new Date(t0) });
    const b = await mk({ role: "staff", name: "B", email: "ops@y.com", createdAt: new Date(t0 + 1000) });
    const c = await mk({ role: "admin", name: "C", email: "Weird+Tag!@z.com", createdAt: new Date(t0 + 2000) });
    const d = await mk({ role: "driver", name: "D", phone: "+966500000011", createdAt: new Date(t0 + 3000) });
    const e = await mk({ role: "staff", name: "E", email: "ab@z.com", createdAt: new Date(t0 + 4000) });
    await db.execute(sql.raw(block));
    expect((await row(a.id)).username).toBe("ops"); expect((await row(b.id)).username).toBe("ops-2"); expect((await row(c.id)).username).toBe("weirdtag");
    expect((await row(d.id)).username).toBe("u966500000011"); expect((await row(e.id)).username).toBe("abuser"); // under 3 characters → padded
  });
});
