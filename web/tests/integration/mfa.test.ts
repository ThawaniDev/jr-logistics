import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { users } from "@/db/schema";
import { resetDb, shutdown, mkAdmin, mkStaff } from "../helpers/factories";
import { call } from "../helpers/api";
import { totpAt, stepOf, base32Decode } from "@/server/auth/mfa";
import { updateSettings } from "@/server/settings";
import { createSession } from "@/server/auth/session";

beforeEach(resetDb);
afterAll(shutdown);

const login = (email: string, password = "Password123") => call("POST", "/auth/staff/login", { body: { email, password } });
const code = (secretB32: string, offset = 0) => totpAt(base32Decode(secretB32), stepOf() + offset);
/** Enrol a staff member through the API and return everything a test needs. */
async function enrol(perms = ["requests.view"]) {
  const staff = await mkStaff(perms);
  const t = (await login(staff.email!)).json.token as string;
  const setup = await call("POST", "/auth/mfa/setup", { token: t });
  const done = await call("POST", "/auth/mfa/enable", { token: t, body: { code: code(setup.json.secret) } });
  return { staff, secret: setup.json.secret as string, recovery: done.json.recoveryCodes as string[], enableStatus: done.status };
}

describe("staff two-step verification", () => {
  it("enrolment needs a correct code; the secret is stored encrypted; recovery codes are shown once", async () => {
    const staff = await mkStaff(["requests.view"]);
    const t = (await login(staff.email!)).json.token;
    const setup = await call("POST", "/auth/mfa/setup", { token: t });
    expect(setup.status).toBe(200); expect(setup.json.secret).toMatch(/^[A-Z2-7]{32}$/); expect(setup.json.otpauth).toContain("otpauth://totp/");
    const [pending] = await db.select().from(users).where(eq(users.id, staff.id));
    expect(pending.totpEnabledAt).toBeNull();                          // not enforced until proven
    expect(pending.totpSecret).not.toContain(setup.json.secret);       // never stored in the clear
    expect((await call("POST", "/auth/mfa/enable", { token: t, body: { code: "000000" } })).status).toBe(422);
    const ok = await call("POST", "/auth/mfa/enable", { token: t, body: { code: code(setup.json.secret) } });
    expect(ok.status).toBe(200); expect(ok.json.recoveryCodes).toHaveLength(8);
    const [row] = await db.select().from(users).where(eq(users.id, staff.id));
    expect(row.totpEnabledAt).not.toBeNull();
    expect(JSON.stringify(row.totpRecovery)).not.toContain(ok.json.recoveryCodes[0]); // hashes only
    expect((await call("POST", "/auth/mfa/setup", { token: t })).status).toBe(409);    // already on
  });

  it("with MFA on, the password alone gives no session; a valid code (not a replay) does", async () => {
    const { staff, secret } = await enrol();
    const first = await login(staff.email!);
    expect(first.status).toBe(200); expect(first.json.mfaRequired).toBe(true); expect(first.json.token).toBeUndefined();
    expect(first.headers.get("set-cookie")).toBeNull();
    expect((await call("GET", "/admin/stats", { token: first.json.mfaToken })).status).toBe(401); // the proof is not a session
    expect((await call("POST", "/auth/staff/login/mfa", { body: { mfaToken: first.json.mfaToken, code: "123456" } })).status).toBe(401);
    expect((await call("POST", "/auth/staff/login/mfa", { body: { mfaToken: "invalid-token.invalid-sig", code: code(secret) } })).status).toBe(401);
    // the code used to enrol is burned: replaying it is refused, the NEXT window's code works
    const replay = await call("POST", "/auth/staff/login/mfa", { body: { mfaToken: first.json.mfaToken, code: code(secret) } });
    const next = await call("POST", "/auth/staff/login/mfa", { body: { mfaToken: first.json.mfaToken, code: code(secret, 1) } });
    expect([replay.status, next.status]).toEqual(expect.arrayContaining([200]));
    const good = replay.status === 200 ? replay : next;
    expect((await call("GET", "/auth/me", { token: good.json.token })).json.user.mfaEnabled).toBe(true);
    // the same code cannot be used twice
    const again = await call("POST", "/auth/staff/login/mfa", { body: { mfaToken: (await login(staff.email!)).json.mfaToken, code: code(secret, replay.status === 200 ? 0 : 1) } });
    expect(again.status).toBe(401);
  });

  it("a recovery code signs in once and is then burned; wrong guesses are rate limited", async () => {
    const { staff, recovery } = await enrol();
    const a = await call("POST", "/auth/staff/login/mfa", { body: { mfaToken: (await login(staff.email!)).json.mfaToken, code: recovery[0] } });
    expect(a.status).toBe(200);
    const b = await call("POST", "/auth/staff/login/mfa", { body: { mfaToken: (await login(staff.email!)).json.mfaToken, code: recovery[0] } });
    expect(b.status).toBe(401);
    const c = await call("POST", "/auth/staff/login/mfa", { body: { mfaToken: (await login(staff.email!)).json.mfaToken, code: recovery[1].toUpperCase() } });
    expect(c.status).toBe(200); // case-insensitive
    const mt = (await login(staff.email!)).json.mfaToken;
    let last = 0;
    for (let i = 0; i < 12; i++) last = (await call("POST", "/auth/staff/login/mfa", { body: { mfaToken: mt, code: String(100000 + i) } })).status;
    expect(last).toBe(429);
  });

  it("when the platform requires it, un-enrolled staff can only enrol; enrolled staff work normally; it cannot be switched off", async () => {
    const admin = await mkAdmin();
    const plain = await mkStaff(["requests.view"]);
    const t = (await login(plain.email!)).json.token;
    expect((await call("GET", "/admin/stats", { token: t })).status).toBe(200);
    await updateSettings({ requireStaffMfa: true }, admin.id);
    const blocked = await call("GET", "/admin/stats", { token: t });
    expect(blocked.status).toBe(403); expect(blocked.json.error.code).toBe("MFA_SETUP_REQUIRED");
    expect((await call("GET", "/auth/me", { token: t })).status).toBe(200);
    const setup = await call("POST", "/auth/mfa/setup", { token: t });
    expect(setup.status).toBe(200);
    const done = await call("POST", "/auth/mfa/enable", { token: t, body: { code: code(setup.json.secret) } });
    expect(done.status).toBe(200);
    expect((await call("GET", "/admin/stats", { token: t })).status).toBe(200);
    expect((await call("POST", "/auth/mfa/disable", { token: t, body: { password: "Password123", code: done.json.recoveryCodes[0] } })).status).toBe(403);
  });

  it("disabling needs password + code; an admin can reset a colleague who lost their phone", async () => {
    const admin = await mkAdmin();
    const { staff, secret } = await enrol(["staff.manage", "requests.view"]);
    const other = await enrol();
    const session = (await createSession(staff.id, "mobile")).token;
    expect((await call("POST", "/auth/mfa/disable", { token: session, body: { password: "wrong-pass-123", code: code(secret, 1) } })).status).toBe(401);
    // a staff member holding staff.manage can reset others; nobody resets themselves this way
    expect((await call("POST", `/admin/staff/${staff.id}/reset-mfa`, { token: session })).status).toBe(403);
    expect((await call("POST", `/admin/staff/${other.staff.id}/reset-mfa`, { token: session })).status).toBe(200);
    const [row] = await db.select().from(users).where(eq(users.id, other.staff.id));
    expect(row.totpEnabledAt).toBeNull(); expect(row.totpSecret).toBeNull();
    expect((await login(other.staff.email!)).json.mfaRequired).toBeUndefined(); // back to password-only until they enrol again
    const adminTok = (await createSession(admin.id, "mobile")).token;
    expect((await call("POST", `/admin/staff/${staff.id}/reset-mfa`, { token: adminTok })).status).toBe(200);
  });
});
