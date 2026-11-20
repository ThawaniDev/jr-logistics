import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { auditLogs, roles, users } from "@/db/schema";
import { STAFF_PRESETS } from "@/server/catalog";
import { resetDb, shutdown, mkAdmin, mkStaff, mkBusiness } from "../helpers/factories";
import { call, staffLogin, tokenOf } from "../helpers/api";

beforeEach(resetDb);
afterAll(shutdown);

const adminToken = async () => staffLogin((await mkAdmin()).email!);
const mkRole = async (token: string, name: string, permissions: string[], extra: Record<string, unknown> = {}) => {
  const r = await call("POST", "/admin/roles", { token, body: { name, permissions, ...extra } });
  expect(r.status, r.text).toBe(201);
  return r.json as { id: string; key: string; permissions: string[] };
};
const permsOf = async (id: string) => (await db.select({ p: users.permissions }).from(users).where(eq(users.id, id)))[0].p.slice().sort();
const auditOf = (action: string) => db.select().from(auditLogs).where(and(eq(auditLogs.entity, "role"), eq(auditLogs.action, action)));
const staffBody = (o: Record<string, unknown>) => ({ name: "New Person", email: `np${Math.random().toString(36).slice(2, 8)}@t.test`, password: "Temp0rary!Pass1", ...o });

describe("system roles", () => {
  it("lists the six factory roles with their permissions, member counts and the staff overview", async () => {
    const token = await adminToken();
    await mkStaff(STAFF_PRESETS.support); // no role set: a custom-permission account
    const r = await call("GET", "/admin/roles", { token });
    expect(r.status).toBe(200);
    expect(r.json.items.map((x: any) => x.key)).toEqual(Object.keys(STAFF_PRESETS));
    for (const x of r.json.items) {
      expect(x).toMatchObject({ isSystem: true, memberCount: 0, modified: false });
      expect([...x.permissions].sort()).toEqual([...STAFF_PRESETS[x.key]].sort());
      expect(x.factory).toEqual(STAFF_PRESETS[x.key]);
    }
    expect(r.json.stats).toEqual({ roles: 6, system: 6, custom: 0, staff: 1, customPermissions: 1 });
  });

  it("refuses to delete or rename a system role", async () => {
    const token = await adminToken();
    const del = await call("DELETE", "/admin/roles/support", { token });
    expect(del.status).toBe(409); expect(del.json.error.code).toBe("ROLE_SYSTEM");
    const ren = await call("PATCH", "/admin/roles/support", { token, body: { name: "Helpdesk" } });
    expect(ren.status).toBe(409); expect(ren.json.error.code).toBe("ROLE_SYSTEM");
    expect((await call("GET", "/admin/roles/support", { token })).json.name).toBe("Support");
  });

  it("changes the permissions of a system role for its members, then resets them to the factory defaults", async () => {
    const token = await adminToken();
    const made = await call("POST", "/admin/staff", { token, body: staffBody({ staffRole: "support" }) });
    expect(made.status, made.text).toBe(201);
    const member = made.json.id as string;
    expect(await permsOf(member)).toEqual([...STAFF_PRESETS.support].sort());

    const edit = await call("PATCH", "/admin/roles/support", { token, body: { permissions: ["users.view", "tickets.view", "audit.view"] } });
    expect(edit.status, edit.text).toBe(200);
    expect(edit.json).toMatchObject({ modified: true, memberCount: 1, changed: true });
    expect(await permsOf(member)).toEqual(["audit.view", "tickets.view", "users.view"]);

    const reset = await call("POST", "/admin/roles/support/reset", { token });
    expect(reset.status).toBe(200);
    expect(reset.json).toMatchObject({ modified: false, changed: true });
    expect(await permsOf(member)).toEqual([...STAFF_PRESETS.support].sort());
    const [log] = await auditOf("role.reset");
    expect(log.diff).toMatchObject({ key: "support", members: 1, removed: ["audit.view"] });
    expect((log.diff as any).added.sort()).toEqual(["complaints.manage", "integrations.view", "notes.manage", "requests.view", "tickets.manage"]);
    // nothing to reset any more
    expect((await call("POST", "/admin/roles/support/reset", { token })).json.changed).toBe(false);
    expect(await auditOf("role.reset")).toHaveLength(1);
  });

  it("only system roles have factory defaults", async () => {
    const token = await adminToken();
    const r = await mkRole(token, "Night desk", ["tickets.view"]);
    const reset = await call("POST", `/admin/roles/${r.id}/reset`, { token });
    expect(reset.status).toBe(422);
  });
});

describe("custom roles: create, update, audit", () => {
  it("creates a role (key from the name, dependencies added, permissions in catalogue order) and audits it", async () => {
    const token = await adminToken();
    const r = await call("POST", "/admin/roles", { token, body: { name: "  Night   Shift Support ", description: "After hours", permissions: ["tickets.manage", "users.edit"] } });
    expect(r.status).toBe(201);
    expect(r.json).toMatchObject({ key: "night_shift_support", name: "Night Shift Support", description: "After hours", isSystem: false, memberCount: 0 });
    expect(r.json.permissions).toEqual(["users.view", "users.edit", "tickets.view", "tickets.manage"]);
    expect(r.json.autoAdded).toEqual(["users.view", "tickets.view"]);
    const [log] = await auditOf("role.create");
    expect(log).toMatchObject({ entityId: r.json.id, actorRole: "admin" });
    expect(log.diff).toMatchObject({ key: "night_shift_support", name: "Night Shift Support", copyFrom: null, permissions: r.json.permissions });
    // readable by id and by key
    expect((await call("GET", `/admin/roles/${r.json.id}`, { token })).json.key).toBe("night_shift_support");
    expect((await call("GET", "/admin/roles/night_shift_support", { token })).json.members).toEqual([]);
  });

  it("copies another role, makes unique keys and refuses a repeated name", async () => {
    const token = await adminToken();
    const copy = await call("POST", "/admin/roles", { token, body: { name: "Support (night)", copyFrom: "support" } });
    expect(copy.status).toBe(201);
    expect([...copy.json.permissions].sort()).toEqual([...STAFF_PRESETS.support].sort());
    expect(copy.json.key).toBe("support_night");
    const twin = await call("POST", "/admin/roles", { token, body: { name: "Support  (Night)", permissions: ["audit.view"] } });
    expect(twin.status).toBe(409); expect(twin.json.error.details.field).toBe("name");
    expect((await call("POST", "/admin/roles", { token, body: { name: "support", permissions: ["audit.view"] } })).status).toBe(409); // a system role has that name
    const arabic = await call("POST", "/admin/roles", { token, body: { name: "مشرف الدعم", permissions: ["audit.view"] } });
    expect(arabic.json.key).toBe("role");
    expect((await call("POST", "/admin/roles", { token, body: { name: "مشرف المبيعات", permissions: ["audit.view"] } })).json.key).toBe("role_2");
  });

  it("refuses an empty role, unknown permissions and bad names", async () => {
    const token = await adminToken();
    const empty = await call("POST", "/admin/roles", { token, body: { name: "Nothing", permissions: [] } });
    expect(empty.status).toBe(422); expect(empty.json.error.details.field).toBe("permissions");
    expect((await call("POST", "/admin/roles", { token, body: { name: "Nothing" } })).status).toBe(422);
    const bogus = await call("POST", "/admin/roles", { token, body: { name: "Bogus", permissions: ["users.view", "teleport.anywhere"] } });
    expect(bogus.status).toBe(422); expect(bogus.json.error.details.unknown).toEqual(["teleport.anywhere"]);
    expect((await call("POST", "/admin/roles", { token, body: { name: "x", permissions: ["audit.view"] } })).status).toBe(422);
    const r = await mkRole(token, "Reader", ["audit.view"]);
    const strip = await call("PATCH", `/admin/roles/${r.id}`, { token, body: { permissions: [] } });
    expect(strip.status).toBe(422);
    expect((await call("GET", `/admin/roles/${r.id}`, { token })).json.permissions).toEqual(["audit.view"]);
  });

  it("updates name, description and permissions; a no-op changes and audits nothing", async () => {
    const token = await adminToken();
    const r = await mkRole(token, "Desk", ["tickets.view"]);
    const edit = await call("PATCH", `/admin/roles/${r.key}`, { token, body: { name: "Front desk", description: "Counter", permissions: ["tickets.view", "reports.export"] } });
    expect(edit.status, edit.text).toBe(200);
    expect(edit.json).toMatchObject({ key: "desk", name: "Front desk", description: "Counter", changed: true }); // the key never changes
    expect(edit.json.permissions).toEqual(["tickets.view", "reports.view", "reports.export"]);
    const [log] = await auditOf("role.update");
    expect(log.diff).toMatchObject({ key: "desk", name: { from: "Desk", to: "Front desk" }, added: ["reports.view", "reports.export"], removed: [], members: 0, autoAdded: ["reports.view"] });
    const again = await call("PATCH", `/admin/roles/${r.key}`, { token, body: { name: "Front desk", permissions: edit.json.permissions } });
    expect(again.json.changed).toBe(false);
    expect(await auditOf("role.update")).toHaveLength(1);
    // another role's name is taken
    expect((await call("PATCH", `/admin/roles/${r.key}`, { token, body: { name: "Finance" } })).status).toBe(409);
  });

  it("returns 404 for a role that does not exist", async () => {
    const token = await adminToken();
    for (const [m, p] of [["GET", "/admin/roles/ghost"], ["PATCH", "/admin/roles/ghost"], ["DELETE", "/admin/roles/ghost"], ["POST", "/admin/roles/ghost/reset"], ["GET", "/admin/roles/00000000-0000-4000-8000-000000000000"]] as const)
      expect((await call(m, p, { token, body: m === "PATCH" ? { name: "Whatever" } : undefined })).status, `${m} ${p}`).toBe(404);
  });

  it("serves the catalogue (static path) before the role detail path", async () => {
    const token = await adminToken();
    const r = await call("GET", "/admin/roles/catalog", { token });
    expect(r.status).toBe(200);
    expect(r.json.groups.length).toBeGreaterThan(5);
    expect(r.json.groups.flatMap((g: any) => g.permissions.map((p: any) => p.key))).toHaveLength(r.json.total);
  });
});

describe("members follow their role", () => {
  it("rewrites the permissions of every member at once, and the member's access changes on the very next request", async () => {
    const token = await adminToken();
    const role = await mkRole(token, "Auditor", ["audit.view"]);
    const a = await call("POST", "/admin/staff", { token, body: staffBody({ staffRole: role.key }) });
    const b = await call("POST", "/admin/staff", { token, body: staffBody({ staffRole: role.key }) });
    const outsider = await mkStaff(["audit.view"]); // custom permissions: not a member
    const member = await db.select().from(users).where(eq(users.id, a.json.id)).then((r) => r[0]);
    await db.update(users).set({ mustChangePassword: false }).where(eq(users.role, "staff"));
    const memberToken = await tokenOf(member, "Temp0rary!Pass1");
    expect((await call("GET", "/admin/audit", { token: memberToken })).status).toBe(200);
    expect((await call("GET", "/admin/pricing", { token: memberToken })).status).toBe(403);

    const edit = await call("PATCH", `/admin/roles/${role.id}`, { token, body: { permissions: ["pricing.view", "tickets.view"] } });
    expect(edit.status, edit.text).toBe(200);
    expect(edit.json.memberCount).toBe(2);
    // same session, no new sign-in
    expect((await call("GET", "/admin/audit", { token: memberToken })).status).toBe(403);
    expect((await call("GET", "/admin/pricing", { token: memberToken })).status).toBe(200);
    expect(await permsOf(a.json.id)).toEqual(["pricing.view", "tickets.view"]);
    expect(await permsOf(b.json.id)).toEqual(["pricing.view", "tickets.view"]);
    expect(await permsOf(outsider.id)).toEqual(["audit.view"]);
    const [log] = await auditOf("role.update");
    expect(log.diff).toMatchObject({ members: 2, added: ["tickets.view", "pricing.view"], removed: ["audit.view"] });
    // the detail lists the members
    const detail = await call("GET", `/admin/roles/${role.id}`, { token });
    expect(detail.json.members.map((m: any) => m.id).sort()).toEqual([a.json.id, b.json.id].sort());
    expect(detail.json.members.every((m: any) => m.differs === false)).toBe(true);
  });

  it("marks members whose own permissions differ from the role's (legacy customised accounts)", async () => {
    const token = await adminToken();
    const odd = await mkStaff([...STAFF_PRESETS.support, "audit.view"]);
    await db.update(users).set({ staffRole: "support" }).where(eq(users.id, odd.id));
    const detail = await call("GET", "/admin/roles/support", { token });
    expect(detail.json.members).toMatchObject([{ id: odd.id, differs: true }]);
    expect((await call("GET", "/admin/roles", { token })).json.items[0].memberCount).toBe(1);
  });
});

describe("delete", () => {
  it("deletes an unused custom role and audits it", async () => {
    const token = await adminToken();
    const r = await mkRole(token, "Temp role", ["audit.view"]);
    const del = await call("DELETE", `/admin/roles/${r.id}`, { token });
    expect(del.status).toBe(200); expect(del.json).toMatchObject({ ok: true, members: 0 });
    expect(await db.select().from(roles).where(eq(roles.id, r.id))).toHaveLength(0);
    expect((await auditOf("role.delete"))[0].diff).toMatchObject({ key: "temp_role", members: 0, reassignedTo: null });
  });

  it("refuses while staff hold the role (ROLE_IN_USE) unless the members are reassigned", async () => {
    const token = await adminToken();
    const doomed = await mkRole(token, "Doomed", ["audit.view"]);
    const m = await call("POST", "/admin/staff", { token, body: staffBody({ staffRole: doomed.key }) });
    const refused = await call("DELETE", `/admin/roles/${doomed.id}`, { token });
    expect(refused.status).toBe(409); expect(refused.json.error).toMatchObject({ code: "ROLE_IN_USE", details: { members: 1 } });
    expect(await db.select().from(roles).where(eq(roles.id, doomed.id))).toHaveLength(1);

    const moved = await call("DELETE", `/admin/roles/${doomed.id}`, { token, body: { reassignTo: "support" } });
    expect(moved.status, moved.text).toBe(200); expect(moved.json).toMatchObject({ members: 1, reassignedTo: "support" });
    const row = (await db.select().from(users).where(eq(users.id, m.json.id)))[0];
    expect(row.staffRole).toBe("support"); expect([...row.permissions].sort()).toEqual([...STAFF_PRESETS.support].sort());
    expect((await auditOf("role.delete"))[0].diff).toMatchObject({ key: "doomed", members: 1, reassignedTo: "support" });
  });

  it("can detach the members instead (they keep what they have, without a role) and refuses a pointless target", async () => {
    const token = await adminToken();
    const r = await mkRole(token, "Short lived", ["audit.view", "tickets.view"]);
    const m = await call("POST", "/admin/staff", { token, body: staffBody({ staffRole: r.key }) });
    expect((await call("DELETE", `/admin/roles/${r.id}`, { token, body: { reassignTo: r.id } })).status).toBe(422);
    expect((await call("DELETE", `/admin/roles/${r.id}`, { token, body: { reassignTo: "nowhere" } })).status).toBe(404);
    const done = await call("DELETE", `/admin/roles/${r.id}`, { token, body: { reassignTo: "custom" } });
    expect(done.json).toMatchObject({ members: 1, reassignedTo: "custom" });
    const row = (await db.select().from(users).where(eq(users.id, m.json.id)))[0];
    expect(row.staffRole).toBeNull(); expect([...row.permissions].sort()).toEqual(["audit.view", "tickets.view"]);
  });
});

describe("who may do what", () => {
  it("lets staff.view read the roles but not change them; staff without it get nothing", async () => {
    const admin = await adminToken();
    const role = await mkRole(admin, "Readable", ["audit.view"]);
    const viewer = await staffLogin((await mkStaff(["staff.view"])).email!);
    const nobody = await staffLogin((await mkStaff(["requests.view"])).email!);
    for (const p of ["/admin/roles", "/admin/roles/catalog", `/admin/roles/${role.id}`]) {
      expect((await call("GET", p, { token: viewer })).status, p).toBe(200);
      expect((await call("GET", p, { token: nobody })).status, p).toBe(403);
    }
    const writes: Array<[string, string, unknown]> = [["POST", "/admin/roles", { name: "Sneaky", permissions: ["audit.view"] }], ["PATCH", `/admin/roles/${role.id}`, { permissions: ["audit.view", "tickets.view"] }], ["DELETE", `/admin/roles/${role.id}`, {}], ["POST", "/admin/roles/support/reset", {}]];
    for (const [m, p, body] of writes) expect((await call(m, p, { token: viewer, body })).status, `${m} ${p}`).toBe(403);
    expect((await call("GET", "/admin/roles", { token: admin })).json.items.find((r: any) => r.key === role.key).permissions).toEqual(["audit.view"]);
  });

  it("is closed to people who are not staff, and to anonymous requests", async () => {
    const biz = await mkBusiness();
    const token = await tokenOf(biz);
    expect((await call("GET", "/admin/roles", { token })).status).toBe(403);
    expect((await call("GET", "/admin/roles")).status).toBe(401);
  });

  it("does not let staff.manage hand out permissions the person does not hold", async () => {
    const admin = await adminToken();
    const manager = await staffLogin((await mkStaff(["staff.manage", "staff.view", "tickets.view"])).email!);
    const bad = await call("POST", "/admin/roles", { token: manager, body: { name: "Too much", permissions: ["tickets.view", "payouts.execute"] } });
    expect(bad.status).toBe(403); expect(bad.json.error.details.missing).toEqual(expect.arrayContaining(["payouts.execute"]));
    const ok = await call("POST", "/admin/roles", { token: manager, body: { name: "Just tickets", permissions: ["tickets.view"] } });
    expect(ok.status, ok.text).toBe(201);
    // adding a permission the manager lacks to an existing role is refused, taking one away is fine
    const grow = await call("PATCH", `/admin/roles/${ok.json.id}`, { token: manager, body: { permissions: ["tickets.view", "audit.view"] } });
    expect(grow.status).toBe(403);
    const fin = await call("PATCH", "/admin/roles/finance", { token: manager, body: { permissions: STAFF_PRESETS.finance.filter((p) => p !== "refunds.manage") } });
    expect(fin.status, fin.text).toBe(200);
    expect((await call("GET", "/admin/roles/finance", { token: admin })).json.permissions).not.toContain("refunds.manage");
    // a reset would grant refunds.manage again: refused for the manager, fine for the super admin
    expect((await call("POST", "/admin/roles/finance/reset", { token: manager })).status).toBe(403);
    expect((await call("POST", "/admin/roles/finance/reset", { token: admin })).status).toBe(200);
  });
});

describe("no self lock-out", () => {
  it("refuses to take staff.manage from the acting user's own role (update, reset, reassign) but lets the super admin do anything", async () => {
    const admin = await adminToken();
    const boss = await mkRole(admin, "Role managers", ["staff.manage", "tickets.view"]);
    const me = await call("POST", "/admin/staff", { token: admin, body: staffBody({ staffRole: boss.key }) });
    const row = (await db.select().from(users).where(eq(users.id, me.json.id)))[0];
    await db.update(users).set({ mustChangePassword: false }).where(eq(users.id, row.id));
    const token = await tokenOf(row, "Temp0rary!Pass1");
    const lock = await call("PATCH", `/admin/roles/${boss.id}`, { token, body: { permissions: ["tickets.view"] } });
    expect(lock.status).toBe(409); expect(lock.json.error.code).toBe("SELF_LOCKOUT");
    // moving to a role without it is the same thing
    const del = await call("DELETE", `/admin/roles/${boss.id}`, { token, body: { reassignTo: "support" } });
    expect(del.status).toBe(409); expect(del.json.error.code).toBe("SELF_LOCKOUT");
    expect(await permsOf(row.id)).toEqual(["staff.manage", "staff.view", "tickets.view"]);
    // allowed: keeping staff.manage while changing the rest (only removals: nothing to grant)
    const fine = await call("PATCH", `/admin/roles/${boss.id}`, { token, body: { permissions: ["staff.manage"] } });
    expect(fine.status, fine.text).toBe(200); // keeping staff.manage while dropping the rest is fine
    // the super admin may take it away (they are not locked out by a role)
    const byAdmin = await call("PATCH", `/admin/roles/${boss.id}`, { token: admin, body: { permissions: ["audit.view"] } });
    expect(byAdmin.status).toBe(200);
    expect((await call("GET", "/admin/roles", { token })).status).toBe(403); // the member really lost it
  });
});

describe("staff accounts use roles (backwards compatible)", () => {
  it("creating staff with a preset key gives the role's permissions, as before; an edited system role is what counts", async () => {
    const token = await adminToken();
    const plain = await call("POST", "/admin/staff", { token, body: staffBody({ staffRole: "finance" }) });
    expect(plain.status, plain.text).toBe(201);
    const row = (await db.select().from(users).where(eq(users.id, plain.json.id)))[0];
    expect(row.staffRole).toBe("finance"); expect([...row.permissions].sort()).toEqual([...STAFF_PRESETS.finance].sort()); expect(row.mustChangePassword).toBe(true);
    await call("PATCH", "/admin/roles/reports", { token, body: { permissions: ["reports.view"] } });
    const edited = await call("POST", "/admin/staff", { token, body: staffBody({ staffRole: "reports" }) });
    expect(await permsOf(edited.json.id)).toEqual(["reports.view"]);
  });

  it("a role key can be a custom role; individual permissions still work without a role; unknown roles and mixed input are refused", async () => {
    const token = await adminToken();
    const custom = await mkRole(token, "Cashiers", ["cod.manage"]);
    const c = await call("POST", "/admin/staff", { token, body: staffBody({ staffRole: custom.key }) });
    expect(c.status).toBe(201);
    expect((await db.select().from(users).where(eq(users.id, c.json.id)))[0]).toMatchObject({ staffRole: "cashiers", permissions: ["cod.manage"] });
    const solo = await call("POST", "/admin/staff", { token, body: staffBody({ permissions: ["tickets.view", "audit.view"] }) });
    expect(solo.status).toBe(201);
    expect((await db.select().from(users).where(eq(users.id, solo.json.id)))[0]).toMatchObject({ staffRole: null });
    expect(await permsOf(solo.json.id)).toEqual(["audit.view", "tickets.view"]);
    const unknownRole = await call("POST", "/admin/staff", { token, body: staffBody({ staffRole: "no_such_role" }) });
    expect(unknownRole.status).toBe(422); expect(unknownRole.json.error.details.field).toBe("staffRole");
    const mixed = await call("POST", "/admin/staff", { token, body: staffBody({ staffRole: "support", permissions: ["audit.view"] }) });
    expect(mixed.status).toBe(422); expect(mixed.json.error.details.field).toBe("permissions");
    expect((await call("POST", "/admin/staff", { token, body: staffBody({ staffRole: "support", permissions: STAFF_PRESETS.support }) })).status).toBe(201); // the role's own list is harmless
  });

  it("changing the role of an account swaps its permissions; `staffRole: null` makes it custom and keeps them; editing only permissions detaches it", async () => {
    const token = await adminToken();
    const m = (await call("POST", "/admin/staff", { token, body: staffBody({ staffRole: "support" }) })).json.id as string;
    const fin = await call("PATCH", `/admin/staff/${m}`, { token, body: { staffRole: "finance" } });
    expect(fin.status, fin.text).toBe(200);
    expect(await permsOf(m)).toEqual([...STAFF_PRESETS.finance].sort());
    expect((await call("GET", "/admin/roles/finance", { token })).json.memberCount).toBe(1);

    const custom = await call("PATCH", `/admin/staff/${m}`, { token, body: { staffRole: null } });
    expect(custom.status).toBe(200);
    expect((await db.select().from(users).where(eq(users.id, m)))[0].staffRole).toBeNull();
    expect(await permsOf(m)).toEqual([...STAFF_PRESETS.finance].sort());

    await call("PATCH", `/admin/staff/${m}`, { token, body: { staffRole: "support" } });
    const tweak = await call("PATCH", `/admin/staff/${m}`, { token, body: { permissions: ["tickets.view"] } }); // only permissions: no longer described by the role
    expect(tweak.status).toBe(200);
    expect((await db.select().from(users).where(eq(users.id, m)))[0]).toMatchObject({ staffRole: null, permissions: ["tickets.view"] });
    expect((await call("GET", "/admin/roles/support", { token })).json.memberCount).toBe(0);
    // sending the role's own list keeps the role
    await call("PATCH", `/admin/staff/${m}`, { token, body: { staffRole: "reports" } });
    await call("PATCH", `/admin/staff/${m}`, { token, body: { permissions: STAFF_PRESETS.reports } });
    expect((await db.select().from(users).where(eq(users.id, m)))[0].staffRole).toBe("reports");
    expect((await call("PATCH", `/admin/staff/${m}`, { token, body: { staffRole: "ghost" } })).status).toBe(422);
    expect((await auditOf("role.update"))).toHaveLength(0); // staff changes are audited as staff.update, not as role changes
    expect((await db.select().from(auditLogs).where(eq(auditLogs.action, "staff.update"))).length).toBeGreaterThanOrEqual(4);
  });
});
