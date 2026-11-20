import { describe, it, expect } from "vitest";
import { COMPANY_STATES, companiesQuery, companyActions, companyFlags, companyTabHref, companyTabs, isCompanyKey, isCompanyState, ownerHref, pct, verificationTabTarget } from "@/components/features/admin-companies-lib";
import { visibleNav } from "@/components/layout/nav";

const perms = (...p: string[]) => (x: string) => p.includes(x);
const ALL = () => true;

describe("companies list query", () => {
  it("drops empty and 'all' values so URLs and cache keys stay clean", () => {
    expect(companiesQuery({})).toBe("");
    expect(companiesQuery({ q: "  ", state: "all", warehouse: "", page: 1 })).toBe("");
    expect(companiesQuery({ q: " Nakheel ", state: "pending", warehouse: "missing", page: 3, pageSize: 25 })).toBe("?q=Nakheel&state=pending&warehouse=missing&page=3&pageSize=25");
  });
  it("ignores unknown warehouse filters and encodes search text", () => {
    expect(companiesQuery({ warehouse: "everything" })).toBe("");
    expect(companiesQuery({ q: "a&b=c" })).toBe("?q=a%26b%3Dc");
  });
  it("knows the verification states", () => {
    expect(COMPANY_STATES).toEqual(["all", "pending", "verified", "rejected", "info_requested", "suspended"]);
    expect(isCompanyState("verified")).toBe(true);
    expect(isCompanyState("bogus")).toBe(false);
    expect(isCompanyState(null)).toBe(false);
  });
});

describe("company warnings", () => {
  it("flags suspended and unverified companies, nothing for a healthy one", () => {
    expect(companyFlags({ status: "active", verificationStatus: "verified" })).toEqual([]);
    expect(companyFlags({ status: "active", verificationStatus: "pending" })).toEqual(["pending"]);
    expect(companyFlags({ status: "active", verificationStatus: "info_requested" })).toEqual(["info_requested"]);
    expect(companyFlags({ status: "active", verificationStatus: "rejected" })).toEqual(["rejected"]);
    expect(companyFlags({ status: "active", verificationStatus: "suspended" })).toEqual(["verification_suspended"]);
  });
  it("reports an account suspension first and both suspensions together", () => {
    expect(companyFlags({ status: "suspended", verificationStatus: "verified" })).toEqual(["account_suspended"]);
    expect(companyFlags({ status: "suspended", verificationStatus: "suspended" })).toEqual(["account_suspended", "verification_suspended"]);
    expect(companyFlags({ status: "suspended", verificationStatus: "pending" })).toEqual(["account_suspended", "pending"]);
  });
});

describe("company tabs follow the permissions the tab's API needs", () => {
  it("everyone gets the overview; the rest depends on permissions", () => {
    expect(companyTabs(perms("verification.manage"))).toEqual(["overview", "documents"]);
    expect(companyTabs(perms("users.view", "requests.view"))).toEqual(["overview", "orders", "parcels", "warehouse", "integrations", "security", "activity", "notes", "raw"]);
    expect(companyTabs(perms("wallets.view"))).toEqual(["overview", "finance"]);
    expect(companyTabs(perms("cod.manage"))).toEqual(["overview", "finance"]);
    expect(companyTabs(perms("documents.review"))).toEqual(["overview", "documents"]);
    expect(companyTabs(perms("tickets.view"))).toEqual(["overview", "support"]);
    expect(companyTabs(perms("complaints.manage"))).toEqual(["overview", "support"]);
    expect(companyTabs(perms("offices.view"))).toEqual(["overview", "activity", "notes"]);
    expect(companyTabs(perms())).toEqual(["overview"]);
    expect(companyTabs(ALL)).toEqual(["overview", "orders", "parcels", "finance", "warehouse", "integrations", "documents", "support", "security", "activity", "notes", "raw"]);
  });
  it("builds route hrefs", () => {
    expect(companyTabHref("abc", "overview")).toBe("/admin/companies/abc");
    expect(companyTabHref("abc", "finance")).toBe("/admin/companies/abc/finance");
    expect(companyTabHref("abc", "parcels")).toBe("/admin/companies/abc/parcels");
    expect(companyTabHref("abc", "raw")).toBe("/admin/companies/abc/raw");
  });
});

describe("company header actions", () => {
  it("offers verify / reject / request info only to reviewers, and hides what already applies", () => {
    expect(companyActions({ status: "active", verificationStatus: "pending" }, perms("users.view"))).toEqual({ verify: false, requestInfo: false, reject: false, suspendVerification: false, suspendAccount: false, activateAccount: false });
    const a = companyActions({ status: "active", verificationStatus: "pending" }, perms("verification.manage"));
    expect(a).toMatchObject({ verify: true, requestInfo: true, reject: true, suspendVerification: false, suspendAccount: false });
    expect(companyActions({ status: "active", verificationStatus: "verified" }, perms("offices.manage"))).toMatchObject({ verify: false, requestInfo: true, reject: true, suspendVerification: true });
    expect(companyActions({ status: "active", verificationStatus: "info_requested" }, ALL)).toMatchObject({ verify: true, requestInfo: false, reject: true });
    expect(companyActions({ status: "active", verificationStatus: "rejected" }, ALL)).toMatchObject({ reject: false, requestInfo: true });
  });
  it("account suspend / activate needs users.edit and depends on the account state", () => {
    expect(companyActions({ status: "active", verificationStatus: "verified" }, perms("users.edit"))).toMatchObject({ suspendAccount: true, activateAccount: false });
    expect(companyActions({ status: "suspended", verificationStatus: "verified" }, perms("users.edit"))).toMatchObject({ suspendAccount: false, activateAccount: true });
    expect(companyActions({ status: "suspended", verificationStatus: "verified" }, perms("verification.manage"))).toMatchObject({ suspendAccount: false, activateAccount: false });
  });
});

describe("old verification tab URLs", () => {
  it("map every old ?tab= onto a route of the workspace", () => {
    expect(verificationTabTarget("docs")).toBe("/admin/verification/documents");
    expect(verificationTabTarget("business")).toBe("/admin/verification?kind=business");
    expect(verificationTabTarget("offices")).toBe("/admin/verification?kind=office");
    expect(verificationTabTarget("drivers")).toBe("/admin/verification/drivers");
    expect(verificationTabTarget("accounts")).toBe("/admin/companies");
  });
  it("leaves anything else alone (no redirect loop)", () => {
    expect(verificationTabTarget(undefined)).toBeNull();
    expect(verificationTabTarget("")).toBeNull();
    expect(verificationTabTarget("nonsense")).toBeNull();
    for (const t of ["docs", "business", "offices", "drivers", "accounts"]) expect(verificationTabTarget(t)).not.toMatch(/[?&]tab=/);
  });
});

describe("links to the owner of a document or account", () => {
  it("only links to a view the viewer may open", () => {
    expect(ownerHref("business", "1", perms("users.view"))).toBe("/admin/companies/1");
    expect(ownerHref("business", "1", perms("tickets.view"))).toBeNull();
    expect(ownerHref("office", "2", perms("offices.view"))).toBe("/admin/offices/2");
    expect(ownerHref("office", "2", perms("users.view"))).toBeNull();
    expect(ownerHref("driver", "3", perms("drivers.view"))).toBe("/admin/drivers/3");
    expect(ownerHref("driver", "3", perms("users.view"))).toBeNull();
    expect(ownerHref("staff", "4", ALL)).toBeNull();
  });
});

describe("misc helpers", () => {
  it("pct rounds and never divides by zero", () => { expect(pct(1, 3)).toBe(33); expect(pct(2, 3)).toBe(67); expect(pct(5, 0)).toBe(0); });
  it("isCompanyKey matches the keys one action must refresh", () => {
    for (const k of ["/admin/companies", "/admin/companies/summary", "/admin/companies/x/overview", "/admin/verification/summary", "/admin/verification-queue", "/admin/documents?kind=business", "/admin/users/1", "/admin/offices/1/agreements"]) expect(isCompanyKey(k), k).toBe(true);
    for (const k of ["/admin/finance/ledger", "/admin/requests?x=1", null, 4]) expect(isCompanyKey(k), String(k)).toBe(false);
  });
});

describe("the sidebar entries these views hang from", () => {
  it("shows Companies and Verification to the staff the pages are built for", () => {
    const keys = (can: (p: string) => boolean) => visibleNav("staff", can).flatMap((g) => g.items.map((i) => i.key));
    expect(keys(perms("users.view"))).toContain("nav.companies");
    expect(keys(perms("verification.manage"))).toEqual(expect.arrayContaining(["nav.companies", "nav.verification"]));
    expect(keys(perms("documents.review"))).toContain("nav.verification");
    expect(keys(perms("documents.review"))).not.toContain("nav.companies");
    expect(keys(perms("finance.view"))).not.toContain("nav.companies");
  });
});
