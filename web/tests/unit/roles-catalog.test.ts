import { describe, it, expect } from "vitest";
import en from "@/i18n/en";
import ar from "@/i18n/ar";
import ur from "@/i18n/ur";
import { ALL_PERMISSIONS, STAFF_PRESETS } from "@/server/catalog";
import { PERM_GROUPS, PERM_REQUIRES, SENSITIVE_PERMS, SYSTEM_ROLE_INFO, catalogView, closeDependencies, dependentsOf, diffPerms, normalizePerms, roleKeyFrom, samePermSet, unknownPerms } from "@/server/roles-catalog";
import { csvOfMatrix, describeChange, matrixRows, searchPerms } from "@/components/features/admin-roles-lib";

describe("permission catalogue (J8)", () => {
  it("puts every permission into exactly one group and invents none", () => {
    const placed = PERM_GROUPS.flatMap((g) => [...g.perms]);
    expect(placed.length).toBe(new Set(placed).size);
    expect([...placed].sort()).toEqual([...ALL_PERMISSIONS].sort());
    expect(PERM_GROUPS.every((g) => g.perms.length > 0)).toBe(true);
  });

  it("has a label and a one-line description for every permission and a name for every group, in en / ar / ur", () => {
    for (const [lang, d] of Object.entries({ en, ar, ur })) {
      for (const p of ALL_PERMISSIONS) {
        expect(d[`rjp.${p}`]?.trim(), `${lang} rjp.${p}`).toBeTruthy();
        expect(d[`rjp.${p}.d`]?.trim(), `${lang} rjp.${p}.d`).toBeTruthy();
        expect(d[`rjp.${p}.d`].length, `${lang} description of ${p} is one line`).toBeLessThan(140);
      }
      for (const g of PERM_GROUPS) expect(d[`rj.group_${g.id}`]?.trim(), `${lang} group ${g.id}`).toBeTruthy();
      for (const k of Object.keys(STAFF_PRESETS)) expect(d[`rj.preset_${k}_d`]?.trim(), `${lang} preset description ${k}`).toBeTruthy();
    }
    expect(en["rjp.users.view"]).not.toBe(ar["rjp.users.view"]);
  });

  it("depends only on real permissions, never on itself, and without cycles", () => {
    for (const [p, needs] of Object.entries(PERM_REQUIRES)) {
      expect(ALL_PERMISSIONS as readonly string[], p).toContain(p);
      for (const n of needs ?? []) { expect(ALL_PERMISSIONS as readonly string[]).toContain(n); expect(n).not.toBe(p); expect(PERM_REQUIRES[n as keyof typeof PERM_REQUIRES]?.includes(p as never) ?? false, `${p} <-> ${n}`).toBe(false); }
    }
    for (const s of SENSITIVE_PERMS) expect(ALL_PERMISSIONS as readonly string[]).toContain(s);
    for (const p of ["wallet.adjust", "payouts.execute", "drivers.sensitive", "staff.manage", "settings.edit"]) expect(SENSITIVE_PERMS.has(p), p).toBe(true);
  });

  it("adds what a permission needs (and says what it added), keeps the catalogue order", () => {
    expect(closeDependencies(["users.edit"])).toEqual({ permissions: ["users.view", "users.edit"], added: ["users.view"] });
    expect(closeDependencies(["users.view", "users.edit"]).added).toEqual([]);
    expect(closeDependencies(["staff.manage", "payouts.execute"]).permissions).toEqual(expect.arrayContaining(["staff.view", "staff.manage", "settlements.review", "payouts.execute"]));
    expect(closeDependencies(["nonsense", "reports.export"]).permissions).toEqual(["reports.view", "reports.export"]);
    expect(closeDependencies([])).toEqual({ permissions: [], added: [] });
  });

  it("the factory roles already hold everything their permissions need (a reset never changes them again)", () => {
    for (const [k, perms] of Object.entries(STAFF_PRESETS)) expect(closeDependencies(perms).added, k).toEqual([]);
    expect(Object.keys(SYSTEM_ROLE_INFO).sort()).toEqual(Object.keys(STAFF_PRESETS).sort());
  });

  it("finds what depends on a permission, through other permissions too", () => {
    expect(dependentsOf("users.view")).toEqual(["users.edit"]);
    expect(dependentsOf("requests.view")).toEqual(expect.arrayContaining(["requests.edit", "requests.assign", "attendance.edit", "replacements.manage"]));
    expect(dependentsOf("settlements.review")).toEqual(expect.arrayContaining(["settlements.approve", "payouts.execute"]));
    expect(dependentsOf("audit.view")).toEqual([]);
  });

  it("normalises lists and compares them as sets", () => {
    expect(normalizePerms(["reports.view", "users.view", "users.view", "bogus"])).toEqual(["users.view", "reports.view"]);
    expect(unknownPerms(["users.view", "bogus", "bogus"])).toEqual(["bogus"]);
    expect(samePermSet(["a", "b"], ["b", "a"])).toBe(true); expect(samePermSet(["a"], ["a", "b"])).toBe(false);
    expect(diffPerms(["a", "b"], ["b", "c"])).toEqual({ added: ["c"], removed: ["a"] });
  });

  it("exposes the catalogue the way the API sends it", () => {
    const v = catalogView();
    expect(v.total).toBe(ALL_PERMISSIONS.length);
    expect(v.groups.flatMap((g) => g.permissions.map((p) => p.key))).toHaveLength(ALL_PERMISSIONS.length);
    const staffManage = v.groups.flatMap((g) => g.permissions).find((p) => p.key === "staff.manage")!;
    expect(staffManage).toEqual({ key: "staff.manage", sensitive: true, requires: ["staff.view"] });
  });
});

describe("role keys", () => {
  it("makes a slug from the name and numbers it when taken", () => {
    expect(roleKeyFrom("Night Shift Support", new Set())).toBe("night_shift_support");
    expect(roleKeyFrom("  Café — Ops!! ", new Set())).toBe("cafe_ops");
    expect(roleKeyFrom("Support", new Set(["support"]))).toBe("support_2");
    expect(roleKeyFrom("Support", new Set(["support", "support_2"]))).toBe("support_3");
  });
  it("falls back to `role` for names without Latin letters and never takes a reserved key", () => {
    expect(roleKeyFrom("مشرف الدعم", new Set())).toBe("role");
    expect(roleKeyFrom("مشرف", new Set(["role"]))).toBe("role_2");
    expect(roleKeyFrom("Custom", new Set())).toBe("custom_2");
    expect(roleKeyFrom("ALL", new Set())).toBe("all_2");
  });
  it("keeps keys short enough for users.staff_role validation (40)", () => {
    const k = roleKeyFrom("x".repeat(60), new Set(["x".repeat(32)]));
    expect(k.length).toBeLessThanOrEqual(40);
  });
});

describe("roles pages helpers", () => {
  const roles = [
    { key: "support", name: "Support", isSystem: true, permissions: ["users.view", "tickets.view"] },
    { key: "=evil", name: "=HYPERLINK(\"x\")", isSystem: false, permissions: ["users.view"] },
  ];
  it("lays out the matrix with one row per permission and one flag per role", () => {
    const rows = matrixRows(roles);
    expect(rows).toHaveLength(ALL_PERMISSIONS.length);
    expect(rows.find((r) => r.key === "users.view")!.has).toEqual([true, true]);
    expect(rows.find((r) => r.key === "tickets.view")!.has).toEqual([true, false]);
  });
  it("exports the matrix as a formula-safe CSV with a BOM and a group column", () => {
    const csv = csvOfMatrix(roles.map((r) => ({ ...r, label: r.name })), (g) => g.toUpperCase(), (p) => `label ${p}`);
    expect(csv.startsWith("﻿")).toBe(true);
    const lines = csv.slice(1).split("\n");
    expect(lines[0]).toBe(`Group,Permission,Key,Support,"'=HYPERLINK(""x"")"`);
    expect(lines).toContain("PEOPLE,label users.view,users.view,1,1");
    expect(lines).toHaveLength(ALL_PERMISSIONS.length + 1);
  });
  it("summarises an unsaved change", () => {
    expect(describeChange(["users.view"], ["users.view"])).toEqual({ added: [], removed: [], changed: false });
    expect(describeChange(["users.view", "tickets.view"], ["users.view", "reports.view"])).toEqual({ added: ["reports.view"], removed: ["tickets.view"], changed: true });
  });
  it("searches by label, key and description", () => {
    const label = (p: string) => (p === "users.view" ? "View users" : p === "tickets.view" ? "View cases" : p);
    expect(searchPerms(["users.view", "tickets.view", "audit.view"], "cases", label, () => "")).toEqual(["tickets.view"]);
    expect(searchPerms(["users.view", "audit.view"], "AUDIT", label, () => "")).toEqual(["audit.view"]);
    expect(searchPerms(["users.view", "audit.view"], "", label, () => "")).toEqual(["users.view", "audit.view"]);
  });
});
