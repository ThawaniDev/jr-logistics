import { describe, it, expect } from "vitest";
import { NAV, activeItem, flatNav, visibleNav } from "@/components/layout/nav";
import en from "@/i18n/en";

const all = () => true;
const none = () => false;

describe("sidebar navigation (F-series)", () => {
  it("every role has a sidebar and every label / group key exists in the dictionary", () => {
    for (const [role, groups] of Object.entries(NAV)) {
      expect(groups.length, role).toBeGreaterThan(0);
      for (const g of groups) {
        if (g.key) expect(en[g.key], `${role}: group ${g.id} → ${g.key}`).toBeTruthy();
        for (const i of g.items) expect(en[i.key], `${role}: ${i.href} → ${i.key}`).toBeTruthy();
      }
    }
  });

  it("group ids are unique per role and every href is unique and absolute", () => {
    for (const [role, groups] of Object.entries(NAV)) {
      expect(new Set(groups.map((g) => g.id)).size, `${role}: group ids`).toBe(groups.length);
      const hrefs = groups.flatMap((g) => g.items.map((i) => i.href));
      expect(new Set(hrefs).size, `${role}: hrefs`).toBe(hrefs.length);
      for (const h of hrefs) expect(h.startsWith("/"), h).toBe(true);
    }
  });

  it("finance is a group of separate pages, not one page with tabs (admin)", () => {
    const fin = NAV.admin.find((g) => g.id === "finance")!;
    expect(fin.items.map((i) => i.href)).toEqual(["/admin/finance", "/admin/finance/settlements", "/admin/finance/withdrawals", "/admin/finance/ledger", "/admin/finance/invoices", "/admin/finance/cod", "/admin/finance/pricing"]);
  });

  it("staff share the admin sidebar, and permissions filter items and drop empty groups", () => {
    expect(NAV.staff).toBe(NAV.admin);
    expect(visibleNav("admin", all).flatMap((g) => g.items).length).toBe(NAV.admin.flatMap((g) => g.items).length);
    const onlyTickets = visibleNav("staff", (p) => p === "tickets.view");
    expect(flatNav(onlyTickets).map((x) => x.item.href)).toEqual(["/admin/cases", "/scenarios", "/admin/notifications"]);
    expect(onlyTickets.some((g) => g.id === "finance")).toBe(false);
    const reviewer = visibleNav("staff", (p) => p === "settlements.review");
    expect(flatNav(reviewer).map((x) => x.item.href)).toContain("/admin/finance/settlements");
    expect(flatNav(reviewer).map((x) => x.item.href)).not.toContain("/admin/finance");
    expect(visibleNav("nobody", all)).toEqual([]);
    expect(flatNav(visibleNav("staff", none)).map((x) => x.item.href)).toEqual(["/scenarios", "/admin/notifications"]);
  });

  it("the longest matching entry is the active one; dashboards match only themselves", () => {
    const g = visibleNav("admin", all);
    expect(activeItem(g, "/admin/finance")?.href).toBe("/admin/finance");
    expect(activeItem(g, "/admin/finance/ledger")?.href).toBe("/admin/finance/ledger");
    expect(activeItem(g, "/admin/finance/ledger/anything")?.href).toBe("/admin/finance/ledger");
    expect(activeItem(g, "/admin/companies/abc/orders")?.href).toBe("/admin/companies");
    expect(activeItem(g, "/admin/drivers/123")?.href).toBe("/admin/drivers");
    expect(activeItem(g, "/admin")?.href).toBe("/admin");
    expect(activeItem(g, "/admin/unknown-page")).toBeNull();
    expect(activeItem(g, "/administrator")).toBeNull();
    const b = visibleNav("business", all);
    expect(activeItem(b, "/business/requests/new")?.href).toBe("/business/requests/new");
    expect(activeItem(b, "/business/requests/abc")?.href).toBe("/business/requests");
    expect(activeItem(b, "/business")?.href).toBe("/business");
  });
});
