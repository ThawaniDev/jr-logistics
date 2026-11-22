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
    expect(fin.items.map((i) => i.href)).toEqual(["/admin/finance", "/admin/finance/settlements", "/admin/finance/withdrawals", "/admin/finance/drivers", "/admin/finance/ledger", "/admin/finance/invoices", "/admin/finance/cod", "/admin/finance/pricing"]);
  });

  it("Reports is a main group with one page per report (admin), and the portals get their own report pages", () => {
    const rep = NAV.admin.find((g) => g.id === "reports")!;
    expect(rep.items.map((i) => i.href)).toEqual(expect.arrayContaining(["/admin/reports", "/admin/reports/operations", "/admin/reports/deliveries", "/admin/reports/finance", "/admin/reports/companies", "/admin/reports/drivers", "/admin/reports/offices", "/admin/reports/cod", "/admin/reports/support", "/admin/reports/geography", "/admin/reports/growth", "/admin/reports/explorer"]));
    expect(NAV.business.find((g) => g.id === "reports")!.items.map((i) => i.href)).toEqual(["/business/reports", "/business/reports/deliveries", "/business/reports/spending"]);
    expect(NAV.office.find((g) => g.id === "reports")!.items.map((i) => i.href)).toEqual(["/office/reports", "/office/reports/drivers", "/office/reports/earnings", "/office/reports/performance"]);
    // the finance report needs BOTH permissions
    const only = (...p: string[]) => visibleNav("staff", (x) => p.includes(x)).flatMap((g) => g.items.map((i) => i.href));
    expect(only("reports.view")).not.toContain("/admin/reports/finance");
    expect(only("finance.view")).not.toContain("/admin/reports/finance");
    expect(only("reports.view", "finance.view")).toContain("/admin/reports/finance");
    expect(only("reports.view")).not.toContain("/admin/reports/explorer"); // exports are a separate permission
    expect(only("reports.view", "reports.export")).toContain("/admin/reports/explorer");
  });

  it("staff share the admin sidebar, and permissions filter items and drop empty groups", () => {
    expect(NAV.staff).toBe(NAV.admin);
    expect(visibleNav("admin", all).flatMap((g) => g.items).length).toBe(NAV.admin.flatMap((g) => g.items).length);
    const onlyTickets = visibleNav("staff", (p) => p === "tickets.view");
    expect(flatNav(onlyTickets).map((x) => x.item.href)).toEqual(["/admin/cases", "/admin/notifications"]);
    expect(onlyTickets.some((g) => g.id === "finance")).toBe(false);
    const reviewer = visibleNav("staff", (p) => p === "settlements.review");
    expect(flatNav(reviewer).map((x) => x.item.href)).toContain("/admin/finance/settlements");
    expect(flatNav(reviewer).map((x) => x.item.href)).not.toContain("/admin/finance");
    expect(visibleNav("nobody", all)).toEqual([]);
    expect(flatNav(visibleNav("staff", none)).map((x) => x.item.href)).toEqual(["/admin/notifications"]);
    // the scenario bank is internal: it needs settings.view or settings.edit (same rule as /api/v1/scenarios)
    expect(flatNav(visibleNav("staff", (p) => p === "settings.view")).map((x) => x.item.href)).toContain("/scenarios");
    expect(flatNav(visibleNav("staff", (p) => p === "settings.edit")).map((x) => x.item.href)).toContain("/scenarios");
    expect(flatNav(visibleNav("staff", (p) => p === "tickets.view")).map((x) => x.item.href)).not.toContain("/scenarios");
  });

  it("Incoming orders sits next to Integrations (company and staff); staff need integrations.view or requests.view", () => {
    const company = NAV.business.find((g) => g.id === "company")!.items.map((i) => i.href);
    expect(company.indexOf("/business/integrations/orders")).toBe(company.indexOf("/business/integrations") + 1);
    const system = NAV.admin.find((g) => g.id === "system")!.items.map((i) => i.href);
    expect(system.indexOf("/admin/integrations/orders")).toBe(system.indexOf("/admin/integrations") + 1);
    const only = (...p: string[]) => flatNav(visibleNav("staff", (x) => p.includes(x))).map((x) => x.item.href);
    expect(only("integrations.view")).toContain("/admin/integrations/orders");
    expect(only("requests.view")).toContain("/admin/integrations/orders");
    expect(only("tickets.view")).not.toContain("/admin/integrations/orders");
    expect(activeItem(visibleNav("business", all), "/business/integrations/orders/abc")?.href).toBe("/business/integrations/orders");
    expect(activeItem(visibleNav("business", all), "/business/integrations/abc")?.href).toBe("/business/integrations");
    expect(activeItem(visibleNav("admin", all), "/admin/integrations/orders")?.href).toBe("/admin/integrations/orders");
  });

  it("Roles & permissions is a System page of its own right before Staff, for staff.view or staff.manage (J8)", () => {
    const system = NAV.admin.find((g) => g.id === "system")!.items;
    const hrefs = system.map((i) => i.href);
    expect(hrefs.indexOf("/admin/roles")).toBeGreaterThanOrEqual(0);
    expect(hrefs.indexOf("/admin/staff")).toBe(hrefs.indexOf("/admin/roles") + 1);
    expect(system[hrefs.indexOf("/admin/roles")]).toMatchObject({ key: "nav.roles", perm: ["staff.view", "staff.manage"] });
    const only = (...p: string[]) => flatNav(visibleNav("staff", (x) => p.includes(x))).map((x) => x.item.href);
    for (const perm of ["staff.view", "staff.manage"]) expect(only(perm), perm).toContain("/admin/roles");
    expect(only("tickets.view")).not.toContain("/admin/roles");
    expect(activeItem(visibleNav("admin", all), "/admin/roles")?.href).toBe("/admin/roles");
    expect(activeItem(visibleNav("admin", all), "/admin/staff")?.href).toBe("/admin/staff");
    expect(en["nav.roles"]).toBeTruthy();
  });

  it("the parcel search page is in the sidebar for anyone who may view requests (it was reachable only by typing the URL)", () => {
    const only = (...p: string[]) => flatNav(visibleNav("staff", (x) => p.includes(x))).map((x) => x.item.href);
    expect(only("requests.view")).toContain("/admin/parcels");
    expect(only("tickets.view")).not.toContain("/admin/parcels");
    expect(activeItem(visibleNav("admin", all), "/admin/parcels/some-parcel-id")?.href).toBe("/admin/parcels");
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
