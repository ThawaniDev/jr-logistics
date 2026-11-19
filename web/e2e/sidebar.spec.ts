import { test, expect, type Page } from "@playwright/test";
import { staffLogin, otpLogin, gotoReady, DEMO } from "./helpers";

const admin = (page: Page) => staffLogin(page, "admin@jrlogistics.test", "E2e!Password2026");
const nav = (page: Page) => page.getByRole("navigation", { name: "Main navigation" }).first();

test.describe("sidebar (F5)", () => {
  test("admin: Finance is a group of separate pages; the active page and group are marked", async ({ page }) => {
    await admin(page);
    for (const [name, href] of [["Overview", "/admin/finance"], ["Settlements", "/admin/finance/settlements"], ["Withdrawals", "/admin/finance/withdrawals"], ["Wallet ledger", "/admin/finance/ledger"], ["Invoices", "/admin/finance/invoices"], ["Cash on delivery", "/admin/finance/cod"], ["Pricing", "/admin/finance/pricing"]] as const) {
      await expect(nav(page).locator(`a[href="${href}"]`), name).toBeVisible();
    }
    await nav(page).locator('a[href="/admin/finance/ledger"]').click();
    await expect(page).toHaveURL(/\/admin\/finance\/ledger/);
    await expect(nav(page).locator('a[href="/admin/finance/ledger"]')).toHaveAttribute("aria-current", "page");
    await expect(nav(page).locator('a[href="/admin/finance"]')).not.toHaveAttribute("aria-current", "page");
    // the group holding the open page cannot be collapsed away
    await expect(page.getByRole("button", { name: /Show or hide Finance/ })).toBeDisabled();
  });

  test("groups collapse, the state survives a reload; the rail collapses to icons and back", async ({ page }) => {
    await admin(page);
    await gotoReady(page, "/admin/requests");
    const partners = page.getByRole("button", { name: /Show or hide Partners/ });
    await expect(partners).toHaveAttribute("aria-expanded", "true");
    await partners.click();
    await expect(partners).toHaveAttribute("aria-expanded", "false");
    await expect(nav(page).locator('a[href="/admin/companies"]')).toHaveCount(0);
    await page.reload(); await page.waitForSelector('html[data-hydrated="true"]');
    await expect(page.getByRole("button", { name: /Show or hide Partners/ })).toHaveAttribute("aria-expanded", "false");
    await page.getByRole("button", { name: /Show or hide Partners/ }).click();
    await expect(nav(page).locator('a[href="/admin/companies"]')).toBeVisible();

    await page.getByTestId("nav-collapse").click();
    await expect(page.getByTestId("nav-expand")).toBeVisible();
    await expect(nav(page).locator('a[href="/admin/requests"]')).toHaveAttribute("title", "Requests"); // icon-only entries keep a name
    await page.reload(); await page.waitForSelector('html[data-hydrated="true"]');
    await expect(page.getByTestId("nav-expand")).toBeVisible(); // the rail is remembered
    await page.getByTestId("nav-expand").click();
    await expect(page.getByTestId("nav-collapse")).toBeVisible();
  });

  test("Ctrl+K opens the page switcher: filter, arrow keys, Enter navigates; Esc closes", async ({ page }) => {
    await admin(page);
    await page.getByRole("main").click({ position: { x: 4, y: 4 } }); // a page without focus does not receive keystrokes
    await page.keyboard.press("Control+k");
    const input = page.getByTestId("jump-input");
    await expect(input).toBeFocused();
    await input.fill("zzzz");
    await expect(page.getByText("No page matches")).toBeVisible();
    await input.fill("settl");
    await expect(page.getByRole("option", { name: /Settlements/ })).toBeVisible();
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/\/admin\/finance\/settlements/);
    await page.keyboard.press("Control+k");
    await expect(page.getByTestId("jump-input")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("jump-input")).toHaveCount(0);
  });

  test("a restricted staff member only sees the pages they may open (support preset)", async ({ page }) => {
    await staffLogin(page, "support@jrlogistics.demo", DEMO.staffPw);
    for (const href of ["/admin/requests", "/admin/cases", "/admin/complaints", "/admin/users", "/admin/companies", "/admin/notifications"]) await expect(nav(page).locator(`a[href="${href}"]`), href).toBeVisible();
    for (const href of ["/admin/finance", "/admin/finance/settlements", "/admin/finance/withdrawals", "/admin/finance/cod", "/admin/finance/pricing", "/admin/staff", "/admin/settings", "/admin/audit", "/admin/reports", "/admin/offices"]) await expect(nav(page).locator(`a[href="${href}"]`), href).toHaveCount(0);
    await expect(page.getByRole("button", { name: /Show or hide Finance/ })).toHaveCount(0); // a group with nothing to show is dropped, not left empty
  });

  test("company and office portals have their regrouped sidebars", async ({ browser }) => {
    const biz = await (await browser.newContext()).newPage();
    await otpLogin(biz, DEMO.business);
    for (const href of ["/business", "/business/requests/new", "/business/requests", "/business/wallet", "/business/cash", "/business/profile", "/business/documents", "/business/integrations", "/business/api", "/business/support", "/business/notifications"]) await expect(nav(biz).locator(`a[href="${href}"]`), href).toBeVisible();
    const off = await (await browser.newContext()).newPage();
    await otpLogin(off, DEMO.office);
    for (const href of ["/office", "/office/drivers", "/office/opportunities", "/office/jobs", "/office/settlements", "/office/wallet", "/office/reports", "/office/agreement", "/office/documents", "/office/profile"]) await expect(nav(off).locator(`a[href="${href}"]`), href).toBeVisible();
  });

  test("phones: the menu opens as a drawer with the same entries and closes on navigation", async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const page = await ctx.newPage();
    await admin(page);
    await page.getByRole("button", { name: "Open menu" }).click();
    const drawer = page.locator("aside").filter({ has: page.getByRole("navigation") }).last();
    await expect(drawer.locator('a[href="/admin/requests"]')).toBeVisible();
    await drawer.locator('a[href="/admin/requests"]').click();
    await expect(page).toHaveURL(/\/admin\/requests/);
    await expect(drawer.locator('a[href="/admin/requests"]')).toBeHidden();
  });
});
