import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { users } from "@/db/schema";
import { resetDb, shutdown, mkAdmin, mkStaff } from "../helpers/factories";
import { call, staffLogin } from "../helpers/api";

beforeEach(resetDb);
afterAll(shutdown);

/** `GET /admin/staff` feeds the staff page's KPI row (locked / two-step / temporary password), so it must carry those fields — and stay permission-gated. */
describe("staff list for the staff page", () => {
  it("reports the lock, two-step and temporary-password state of every staff member", async () => {
    const admin = await mkAdmin();
    const plain = await mkStaff(["requests.view"]); const locked = await mkStaff(["requests.view"]); const mfa = await mkStaff(["requests.view"]);
    const until = new Date(Date.now() + 3_600_000);
    await db.update(users).set({ lockedUntil: until, failedLogins: 5 }).where(eq(users.id, locked.id));
    await db.update(users).set({ totpEnabledAt: new Date() }).where(eq(users.id, mfa.id));
    await db.update(users).set({ mustChangePassword: true }).where(eq(users.id, plain.id));
    const token = await staffLogin(admin.email!);
    const r = await call("GET", "/admin/staff", { token });
    expect(r.status).toBe(200);
    const by = new Map<string, any>(r.json.items.map((s: any) => [s.id, s]));
    expect(by.size).toBe(3); // staff only: the admin is not listed
    expect(by.get(plain.id)).toMatchObject({ mustChangePassword: true, lockedUntil: null, totpEnabledAt: null });
    expect(new Date(by.get(locked.id).lockedUntil).getTime()).toBe(until.getTime());
    expect(by.get(mfa.id).totpEnabledAt).not.toBeNull();
    for (const s of by.values()) expect(Object.keys(s)).toEqual(expect.arrayContaining(["id", "name", "email", "staffRole", "permissions", "status", "lockedUntil", "totpEnabledAt", "mustChangePassword", "createdAt"]));
  });

  it("never exposes secrets, and is closed to staff without staff.view / staff.manage", async () => {
    const admin = await mkAdmin(); const nosy = await mkStaff(["requests.view"]); const hr = await mkStaff(["staff.view"]);
    await db.update(users).set({ totpSecret: "enc:secret", totpRecovery: ["hash"] }).where(eq(users.id, hr.id));
    const ok = await call("GET", "/admin/staff", { token: await staffLogin(admin.email!) });
    const text = JSON.stringify(ok.json);
    for (const leak of ["passwordHash", "password_hash", "totpSecret", "totpRecovery", "enc:secret", "hash"]) expect(text, leak).not.toContain(leak);
    expect((await call("GET", "/admin/staff", { token: await staffLogin(nosy.email!) })).status).toBe(403);
    expect((await call("GET", "/admin/staff", { token: await staffLogin(hr.email!) })).status).toBe(200); // view-only access is enough to read the list
  });

  it("the unlock action the page offers clears the lock the KPI counts", async () => {
    const admin = await mkAdmin(); const locked = await mkStaff(["requests.view"]);
    await db.update(users).set({ lockedUntil: new Date(Date.now() + 3_600_000), failedLogins: 5 }).where(eq(users.id, locked.id));
    const token = await staffLogin(admin.email!);
    expect((await call("POST", `/admin/staff/${locked.id}/unlock`, { token })).status).toBe(200);
    const row = (await call("GET", "/admin/staff", { token })).json.items.find((s: any) => s.id === locked.id);
    expect(row.lockedUntil).toBeNull();
  });
});
