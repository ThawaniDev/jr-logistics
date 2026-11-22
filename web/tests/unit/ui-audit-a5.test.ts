import { describe, it, expect, vi } from "vitest";
import { createElement as h, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { I18nProvider } from "@/i18n/provider";
import en from "@/i18n/en";
import ar from "@/i18n/ar";
import { ApiError } from "@/lib/api";
import { blockedNavItem } from "@/components/layout/route-guard";
import { isChromeKey, CHROME_KEYS } from "@/lib/chrome-keys";
import { wantedTitle } from "@/components/layout/use-document-title";

/** Audit K / A5: shared UI pieces (render to static markup, no browser) and the route guard of the shell. */
let pathname = "/admin/staff";
vi.mock("next/navigation", () => ({ usePathname: () => pathname, useRouter: () => ({ replace() {}, push() {} }), useSearchParams: () => new URLSearchParams() }));
vi.mock("next/link", () => ({ default: ({ href, children, ...p }: Record<string, unknown> & { children?: unknown }) => h("a", { href: href as string, ...p }, children as never) }));

import { Skeleton, NoAccess, ErrorState, Table, Breadcrumbs, isForbidden } from "@/components/ui";

const esc = (t: string) => t.replaceAll("'", "&#x27;");
const render = (el: ReactElement, locale: "en" | "ar" = "en") => renderToStaticMarkup(h(I18nProvider, { locale, dict: locale === "en" ? en : ar, fallback: en, children: el }));

describe("Skeleton", () => {
  it("is a span, so it may sit inside a <p> (a <div> there is a React hydration error: /admin/reports/explorer)", () => {
    expect(render(h(Skeleton, { className: "h-4 w-24" }))).toMatch(/^<span /);
    const html = render(h("p", null, h(Skeleton, { className: "h-4 w-24" })));
    expect(html).not.toContain("<div");
    expect(html).toContain("block animate-pulse");
  });
});

describe("NoAccess / ErrorState for a refused permission", () => {
  it("NoAccess shows the page's own name as the <h1>, one calm sentence and a way back — no retry", () => {
    pathname = "/admin/staff";
    const html = render(h(NoAccess, { title: "Staff" }));
    expect(html).toMatch(/<h1[^>]*>Staff<\/h1>/);
    expect(html).toContain(esc(en["err.no_access_title"]));
    expect(html).toContain(esc(en["err.no_access_hint"]));
    expect(html).toContain('href="/admin"');
    expect(html).not.toMatch(/role="alert"/);
    expect(html).not.toContain(en["common.retry"]);
  });
  it("NoAccess without a title uses the sentence as the heading (not twice) and goes home of the current area", () => {
    pathname = "/business/wallet";
    const html = render(h(NoAccess, {}));
    expect(html).toMatch(/<h1[^>]*>You don&#x27;t have access to this page<\/h1>/);
    expect(html.split(esc(en["err.no_access_title"])).length - 1).toBe(1);
    expect(html).toContain('href="/business"');
  });
  it("is translated", () => {
    pathname = "/office/drivers";
    const html = render(h(NoAccess, { title: "السائقون" }), "ar");
    expect(html).toContain(ar["err.no_access_title"]); expect(html).toContain('href="/office"');
  });
  it("ErrorState turns a 403 FORBIDDEN into the calm no-access card without the 'Something went wrong' alert and the useless retry button", () => {
    const e = new ApiError("FORBIDDEN", "Missing permission", 403);
    expect(isForbidden(e)).toBe(true);
    const html = render(h(ErrorState, { error: e, retry: () => {} }));
    expect(html).toContain('data-testid="no-access"');
    expect(html).not.toContain(en["common.error_title"]); expect(html).not.toContain(en["common.retry"]); expect(html).not.toContain('role="alert"');
  });
  it("any other error keeps the alert and the retry button", () => {
    for (const e of [new ApiError("INTERNAL", "boom", 500), new ApiError("VERIFICATION_REQUIRED", "x", 403), new Error("net")]) {
      expect(isForbidden(e)).toBe(false);
      const html = render(h(ErrorState, { error: e, retry: () => {} }));
      expect(html).toContain('role="alert"'); expect(html).toContain(en["common.retry"]);
    }
  });
});

describe("Table and Breadcrumbs", () => {
  it("the scroll box is positioned, so a visually hidden header cell (position:absolute) is clipped by it instead of widening the page", () => {
    const html = render(h(Table, { head: ["A", { label: "Open", srOnly: true }], children: h("tr", null, h("td", null, "x"), h("td", null)) }));
    expect(html).toMatch(/class="relative overflow-x-auto/);
    expect(html).toContain('class="sr-only">Open');
  });
  it("breadcrumb links are at least 24 px tall (WCAG 2.5.8)", () => {
    const html = render(h(Breadcrumbs, { items: [{ label: "Requests", href: "/admin/requests" }, { label: "JR-1" }] }));
    expect(html).toMatch(/<a href="\/admin\/requests" class="[^"]*min-h-6/);
  });
});

describe("route guard of the shell (an area of the menu the role does not include is not mounted)", () => {
  const can = (...p: string[]) => (x: string) => p.includes(x);
  it("blocks the owner entry of a path the user cannot see, by longest prefix", () => {
    expect(blockedNavItem("staff", can("tickets.view"), "/admin/finance/ledger")?.href).toBe("/admin/finance/ledger");
    expect(blockedNavItem("staff", can("tickets.view"), "/admin/companies/abc/orders")?.href).toBe("/admin/companies");
    expect(blockedNavItem("staff", can("tickets.view"), "/admin/roles")?.href).toBe("/admin/roles");
    expect(blockedNavItem("staff", can("tickets.view"), "/admin/reports/drivers")?.href).toBe("/admin/reports/drivers");
  });
  it("lets through what the role may open", () => {
    expect(blockedNavItem("staff", can("tickets.view"), "/admin/cases/123")).toBeNull();
    expect(blockedNavItem("staff", can("finance.view"), "/admin/finance/cod")).toBeNull();
    expect(blockedNavItem("staff", can("finance.view"), "/admin/finance/invoices/9")).toBeNull();
    expect(blockedNavItem("admin", () => true, "/admin/roles")).toBeNull();
  });
  it("never blocks paths no entry owns (redirect pages, account pages) or the other portals", () => {
    expect(blockedNavItem("staff", can(), "/admin/cod")).toBeNull();
    expect(blockedNavItem("staff", can(), "/account/change-password")).toBeNull();
    expect(blockedNavItem("business", can(), "/business/requests/1")).toBeNull();
    expect(blockedNavItem("driver", can(), "/driver/jobs/1")).toBeNull();
    expect(blockedNavItem("unknown", can(), "/anything")).toBeNull();
  });
  it("the finance landing page and the dashboard choose their own landing for a user without their permission: never blocked", () => {
    expect(blockedNavItem("staff", can("cod.manage"), "/admin/finance")).toBeNull(); // redirects to /admin/finance/cod (e2e finance-views)
    expect(blockedNavItem("staff", can("cod.manage"), "/admin")).toBeNull();
    expect(blockedNavItem("staff", can("tickets.view"), "/admin/reports")?.href).toBe("/admin/reports");
  });
  it("the dashboard entry is exact: a user with no dashboard permission is not locked out of the other pages", () => {
    expect(blockedNavItem("staff", can("tickets.view"), "/admin/cases")).toBeNull();
  });
});

describe("chrome keys", () => {
  it("are exactly the SWR keys of the wallet chip, the bell and the counters", () => {
    for (const k of Object.values(CHROME_KEYS)) expect(isChromeKey(k)).toBe(true);
    for (const k of ["/requests", "/wallet?kind=x", undefined, ["/wallet"], 3]) expect(isChromeKey(k)).toBe(false);
  });
});

describe("tab title writer", () => {
  const full = "Wallet · JR Logistics";
  it("sets its title over Next's default and keeps an unread counter that the driver alerts put in front (two observers must not fight: the driver pages froze)", () => {
    expect(wantedTitle("JR Logistics", full)).toBe(full);
    expect(wantedTitle(full, full)).toBe(full);
    expect(wantedTitle("(3) JR Logistics", full)).toBe(`(3) ${full}`);
    expect(wantedTitle(`(99+) ${full}`, full)).toBe(`(99+) ${full}`);
  });
  it("is a fixed point: applying it twice changes nothing (the loop ends)", () => {
    for (const cur of ["", "JR Logistics", "(2) JR Logistics", full, `(12) ${full}`]) { const once = wantedTitle(cur, full); expect(wantedTitle(once, full)).toBe(once); }
  });
});
