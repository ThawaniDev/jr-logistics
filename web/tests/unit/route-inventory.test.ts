/** Audit K / A1 — the static route inventory (scripts/route-inventory.ts) must keep finding every route, and no backoffice route may be reachable without a permission/role check in its handler graph. */
import { describe, it, expect } from "vitest";
import { scan } from "../../scripts/route-inventory";

describe("route inventory", () => {
  const rows = scan();
  it("sees every route and every auth spec", () => {
    expect(rows.length).toBeGreaterThan(350);
    expect(new Set(rows.map((r) => r.auth))).toContain("backoffice");
    expect(rows.filter((r) => r.auth === "public").length).toBeLessThan(40);
  });
  it("no backoffice handler lacks a permission / role check (only the static permission catalogue does)", () => {
    expect(rows.filter((r) => r.flags.includes("backoffice-no-guard")).map((r) => `${r.method} ${r.path}`)).toEqual(["GET /admin/meta"]);
  });
  it("no GET route writes, and no request body is an open-ended record except the profile patch (whitelisted field by field in updateProfile)", () => {
    expect(rows.filter((r) => r.flags.includes("get-writes")).map((r) => `${r.method} ${r.path}`)).toEqual(["GET /admin/reports/:type"]); // the audit row of a CSV export
    expect(rows.filter((r) => r.flags.includes("loose-schema")).map((r) => `${r.method} ${r.path}`)).toEqual(["PATCH /profile"]);
  });
  it("no handler builds SQL from text", () => {
    expect(rows.filter((r) => r.flags.includes("sql.raw")).map((r) => r.path)).toEqual([]);
  });
});
