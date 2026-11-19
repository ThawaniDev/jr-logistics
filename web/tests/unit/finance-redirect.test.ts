import { describe, it, expect } from "vitest";
import { FINANCE_TABS, financeRedirect, withQuery } from "@/components/features/admin-finance-redirect";

const ID = "6f1c2d3e-4a5b-4c6d-8e7f-0a1b2c3d4e5f";

describe("withQuery", () => {
  it("keeps every parameter, in order, URL-encoded", () => {
    expect(withQuery("/admin/finance/cod", { offerId: ID, businessId: "b 1", q: "a&b" })).toBe(`/admin/finance/cod?offerId=${ID}&businessId=b+1&q=a%26b`);
  });
  it("returns the bare path when there is nothing to carry", () => {
    expect(withQuery("/admin/finance/pricing", {})).toBe("/admin/finance/pricing");
    expect(withQuery("/admin/finance/pricing", { service: undefined, all: "" })).toBe("/admin/finance/pricing");
  });
  it("keeps repeated parameters and drops the named ones", () => {
    expect(withQuery("/x", { a: ["1", "2"], tab: "ledger", b: "3" }, ["tab"])).toBe("/x?a=1&a=2&b=3");
  });
});

describe("financeRedirect (old /admin/finance?tab=… links)", () => {
  it("sends each old tab to its page and keeps the other parameters", () => {
    for (const tab of FINANCE_TABS) expect(financeRedirect({ tab })).toBe(`/admin/finance/${tab}`);
    expect(financeRedirect({ tab: "ledger", request: ID })).toBe(`/admin/finance/ledger?request=${ID}`);
    expect(financeRedirect({ tab: "withdrawals", status: "paid" })).toBe("/admin/finance/withdrawals?status=paid");
  });
  it("a request filter without a tab meant the ledger of that request", () => {
    expect(financeRedirect({ request: ID })).toBe(`/admin/finance/ledger?request=${ID}`);
    expect(financeRedirect({ requestId: ID })).toBe(`/admin/finance/ledger?requestId=${ID}`);
  });
  it("renders the overview for everything else (no tab, unknown tab, empty parameters)", () => {
    expect(financeRedirect({})).toBeNull();
    expect(financeRedirect({ tab: "batches" })).toBeNull();
    expect(financeRedirect({ tab: "zzz", request: ID })).toBeNull();
    expect(financeRedirect({ request: "" })).toBeNull();
  });
  it("uses the first value when a parameter is repeated", () => {
    expect(financeRedirect({ tab: ["invoices", "ledger"] })).toBe("/admin/finance/invoices");
  });
});
