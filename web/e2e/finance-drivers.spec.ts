import { test, expect, type APIRequestContext, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { staffLogin, gotoReady } from "./helpers";

/**
 * J7 — Finance › Drivers: the list (KPI strip, filters and sort in the URL, column picker, totals row, CSV / Excel), one driver's page (summary cards, five tabs, period, full statement)
 * and the same pages on a phone and in Arabic. Asserted relative to what the page shows (the specs share one database): Tariq belongs to Al Wajiha Courier Office (no wallet, paid
 * through the office), Omar is an independent driver.
 */
test.describe.configure({ mode: "serial" });
test.use({ actionTimeout: 20_000 });
const BASE = `http://localhost:${process.env.E2E_PORT ?? 3101}`; // not 3100: other projects on this machine use it
const ADMIN = { email: "admin@jrlogistics.test", password: "E2e!Password2026" };
const OFFICE = "Al Wajiha Courier Office";

async function api(ctx: APIRequestContext, path: string) {
  const res = await ctx.fetch(`${BASE}/api/v1${path}`, { headers: { origin: BASE } });
  return { status: res.status(), json: await res.json().catch(() => null) };
}
const rowOf = (page: Page, name: string) => page.getByTestId("fd-table").locator("tbody tr", { hasText: name });
const digits = (s: string) => s.replace(/[^\d.]/g, "");
const noSideScroll = async (page: Page) => expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1)).toBe(true);
async function idOf(page: Page, name: string): Promise<string> {
  const r = await api(page.request, `/admin/finance/drivers?q=${encodeURIComponent(name)}&pageSize=5`);
  expect(r.status).toBe(200);
  expect(r.json.rows.length, name).toBeGreaterThanOrEqual(1);
  return r.json.rows[0].id;
}

test("sidebar and overview lead to Finance › Drivers; KPI strip, table, office and independent drivers, totals row", async ({ page }) => {
  await staffLogin(page, ADMIN.email, ADMIN.password);
  await gotoReady(page, "/admin/finance");
  await page.getByTestId("fin-open-drivers").click(); // the overview links to the new page
  await expect(page).toHaveURL(/\/admin\/finance\/drivers$/);
  await expect(page.getByRole("heading", { name: "Drivers", exact: true })).toBeVisible();
  const link = page.locator('nav a[href="/admin/finance/drivers"]').first();
  await expect(link).toHaveAttribute("aria-current", "page");
  for (const id of ["fd-kpi-drivers", "fd-kpi-earned", "fd-kpi-paid", "fd-kpi-pending", "fd-kpi-cash", "fd-kpi-wallets"]) await expect(page.getByTestId(id)).toBeVisible();
  expect(Number(await page.getByTestId("fd-kpi-drivers").innerText())).toBeGreaterThanOrEqual(6);
  const tariq = rowOf(page, "Tariq Mahmood"), omar = rowOf(page, "Omar");
  await expect(tariq.first()).toBeVisible();
  await expect(tariq.first()).toContainText(OFFICE);
  await expect(tariq.first().getByTestId("fd-via-office")).toBeVisible(); // no wallet: "Paid via office"
  await expect(omar.first()).toContainText("Independent");
  await expect(omar.first().getByTestId("fd-via-office")).toHaveCount(0);
  await expect(page.getByTestId("fd-totals")).toContainText("Totals");
  await expect(page.getByTestId("fd-period-note")).toContainText("30 days");
  await page.screenshot({ path: "test-results/finance-drivers-list.png", fullPage: true });
});

test("filters live in the URL: search, office, independent, status, cash and pending chips, clear", async ({ page }) => {
  await staffLogin(page, ADMIN.email, ADMIN.password);
  await gotoReady(page, "/admin/finance/drivers");
  await page.getByTestId("fd-search").fill("Tariq");
  await expect(page).toHaveURL(/[?&]q=Tariq/);
  await expect(page.getByTestId("fd-table").locator("tbody tr")).toHaveCount(1);
  await expect(page.getByTestId("fd-kpi-drivers")).toHaveText("1");
  await page.getByTestId("fd-search").fill("");
  await expect(page).not.toHaveURL(/q=/);
  const officeSelect = page.getByTestId("fd-office");
  await officeSelect.selectOption({ label: OFFICE });
  await expect(page).toHaveURL(/office=[0-9a-f-]{36}/);
  await expect(rowOf(page, "Tariq Mahmood").first()).toBeVisible();
  await expect(page.getByTestId("fd-via-office").first()).toBeVisible();
  await expect(page.getByTestId("fd-table").locator("tbody tr", { hasNotText: OFFICE })).toHaveCount(0); // retried until the filtered rows have replaced the previous ones
  await officeSelect.selectOption("independent");
  await expect(page).toHaveURL(/office=independent/);
  await expect(rowOf(page, "Omar").first()).toBeVisible();
  await expect(rowOf(page, "Tariq Mahmood")).toHaveCount(0);
  await expect(page.getByTestId("fd-via-office")).toHaveCount(0);
  await officeSelect.selectOption("");
  await page.getByTestId("fd-has-cash").click();
  await expect(page).toHaveURL(/hasCash=1/);
  await expect(page.getByTestId("fd-has-cash")).toHaveAttribute("aria-pressed", "true");
  await page.getByTestId("fd-has-pending").click();
  await expect(page).toHaveURL(/hasPending=1/);
  await page.getByTestId("fd-status").selectOption("suspended");
  await expect(page).toHaveURL(/status=suspended/);
  await expect(page.getByTestId("fd-clear")).toBeVisible(); // nobody is suspended and holds cash: the empty state offers a way out
  await page.getByTestId("fd-clear").click();
  await expect(page).not.toHaveURL(/hasCash|hasPending|status=|office=/);
  await expect(rowOf(page, "Tariq Mahmood").first()).toBeVisible();
  // a link with filters opens the list already filtered (and survives a reload)
  await gotoReady(page, "/admin/finance/drivers?office=independent&sort=name&dir=asc");
  await expect(page.getByTestId("fd-office")).toHaveValue("independent");
  await expect(page.locator('th[aria-sort="ascending"]')).toContainText("Driver");
});

test("sortable columns, column picker (saved in the browser), period presets", async ({ page }) => {
  await staffLogin(page, ADMIN.email, ADMIN.password);
  await gotoReady(page, "/admin/finance/drivers");
  const names = async () => (await page.getByTestId("fd-table").locator("tbody tr td:first-child a").allInnerTexts()).map((x) => x.toLowerCase());
  await page.getByTestId("sort-name").click();
  await expect(page).toHaveURL(/sort=name&dir=asc/);
  await expect(page.locator('th[aria-sort="ascending"]')).toContainText("Driver");
  const sortedBy = (dir: 1 | -1) => async () => { const n = await names(); return n.length > 1 && JSON.stringify(n) === JSON.stringify([...n].sort((a, b) => dir * (a < b ? -1 : a > b ? 1 : 0))); };
  await expect.poll(sortedBy(1)).toBe(true); // the previous rows stay until the sorted ones arrive
  await page.getByTestId("sort-name").click();
  await expect(page).toHaveURL(/sort=name&dir=desc/);
  await expect.poll(sortedBy(-1)).toBe(true);
  await page.getByTestId("sort-cashHeldCents").click();
  await expect(page.locator('th[aria-sort="descending"]')).toContainText("Cash held");
  // columns: add Username + Phone, keep them after a reload, reset
  await expect(page.getByTestId("fd-table").locator("th", { hasText: /^Phone/ })).toHaveCount(0);
  await page.getByTestId("fd-columns").click();
  await page.getByTestId("fd-columns-phone").check();
  await page.getByTestId("fd-columns-wdPaidCents").check();
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("fd-table").locator("th", { hasText: /^Phone/ })).toBeVisible();
  await expect(page.getByTestId("fd-table").locator("th", { hasText: /^Withdrawals paid/ })).toBeVisible();
  await page.reload(); await page.waitForSelector('html[data-hydrated="true"]');
  await expect(page.getByTestId("fd-table").locator("th", { hasText: /^Phone/ })).toBeVisible();
  await page.getByTestId("fd-columns").click();
  await page.getByTestId("fd-columns-reset").click();
  await expect(page.getByTestId("fd-table").locator("th", { hasText: /^Phone/ })).toHaveCount(0);
  await page.keyboard.press("Escape");
  // period presets: 7 days = dates in the URL; All time = period=all; custom shows two date inputs; 30 days = a clean URL again
  await page.getByTestId("fd-period-presets-7d").click();
  await expect(page).toHaveURL(/from=\d{4}-\d{2}-\d{2}&to=\d{4}-\d{2}-\d{2}/);
  await expect(page.getByTestId("fd-period-note")).toContainText("7 days");
  await page.getByTestId("fd-period-presets-all").click();
  await expect(page).toHaveURL(/period=all/);
  await expect(page.getByTestId("fd-period-note")).toContainText("all time");
  await page.getByTestId("fd-period-presets-custom").click();
  await expect(page.getByTestId("fd-period-from")).toBeVisible();
  await page.getByTestId("fd-period-presets-30d").click();
  await expect(page).not.toHaveURL(/period=|from=/);
});

test("downloads: CSV and Excel of the selection, the whole file not the page", async ({ page }) => {
  await staffLogin(page, ADMIN.email, ADMIN.password);
  await gotoReady(page, "/admin/finance/drivers");
  await page.getByTestId("fd-search").fill("Tariq");
  await expect(page.getByTestId("fd-table").locator("tbody tr")).toHaveCount(1);
  await page.getByTestId("fd-download").click();
  const [csvDl] = await Promise.all([page.waitForEvent("download"), page.getByTestId("fd-download-csv").click()]);
  expect(csvDl.suggestedFilename()).toMatch(/^finance-drivers-\d{4}-\d{2}-\d{2}_\d{4}-\d{2}-\d{2}\.csv$/);
  const csv = readFileSync((await csvDl.path())!, "utf8");
  expect(csv.charCodeAt(0)).toBe(0xfeff);
  const lines = csv.slice(1).trim().split("\n");
  expect(lines[0].startsWith("Driver,Username,Phone,City,Status,Verification,Office,Paid via office,Wallet available (SAR)")).toBe(true); // readable headers, never raw keys
  expect(lines[0]).toContain("Withdrawals requested (SAR)"); expect(lines[0]).not.toContain("Cents");
  expect(lines).toHaveLength(2); // the search narrowed the file too
  expect(lines[1]).toContain("Tariq Mahmood");
  expect(lines[1]).toContain(OFFICE);
  expect(lines[1]).toContain(",Yes,"); // paid via office, in words
  await page.getByTestId("fd-download").click();
  const [xlDl] = await Promise.all([page.waitForEvent("download"), page.getByTestId("fd-download-xlsx").click()]);
  expect(xlDl.suggestedFilename()).toMatch(/\.xlsx$/);
  expect(readFileSync((await xlDl.path())!).subarray(0, 2).toString()).toBe("PK"); // a zip: a real .xlsx
});

test("a driver's page: header, office link, summary cards that match the list, five tabs, period, downloads; the wallet tab links here", async ({ page }) => {
  test.setTimeout(120_000);
  await staffLogin(page, ADMIN.email, ADMIN.password);
  const tariqId = await idOf(page, "Tariq"), omarId = await idOf(page, "Omar");
  const summary = (await api(page.request, `/admin/finance/drivers/${tariqId}`)).json;
  // from the list: the name opens the page
  await gotoReady(page, "/admin/finance/drivers?q=Tariq");
  await page.getByTestId(`fd-open-${tariqId}`).click();
  await expect(page).toHaveURL(new RegExp(`/admin/finance/drivers/${tariqId}$`));
  await expect(page.getByTestId("fdd-header")).toContainText("Tariq Mahmood");
  await expect(page.getByTestId("fdd-office")).toContainText(OFFICE);
  await expect(page.getByTestId("fdd-via-office")).toContainText(OFFICE);
  await expect(page.getByTestId("fdd-cards")).toContainText("Paid via office");
  await expect(page.getByTestId("fdd-open-driver")).toHaveAttribute("href", `/admin/drivers/${tariqId}`);
  // the cards are the figures of the API / list row
  const d = summary.driver;
  for (const [id, cents] of [["fdd-earned", d.earnedCents], ["fdd-paid", d.paidCents], ["fdd-pending", d.pendingCents], ["fdd-cash-held", d.cashHeldCents]] as const) expect(digits(await page.getByTestId(id).innerText()), id).toBe(((cents as number) / 100).toFixed(2));
  // five tabs, each with its count and a table (or its empty state), no error
  for (const tab of ["statement", "settlements", "ledger", "withdrawals", "cash"] as const) {
    await page.locator(`[data-tab="${tab}"]`).click();
    if (tab !== "statement") await expect(page).toHaveURL(new RegExp(`tab=${tab}`));
    await expect(page.getByTestId(`fdd-table-${tab}`)).toBeVisible();
    await expect(page.getByText("Something went wrong")).toHaveCount(0);
    await expect(page.locator(`[data-tab="${tab}"]`)).toContainText(String(summary.counts[tab]));
  }
  // all time, then the settlements filter and a CSV of that tab
  await page.getByTestId("fdd-period-presets-all").click();
  await expect(page).toHaveURL(/period=all/);
  await expect(page.getByTestId("fdd-cards")).toContainText("All time");
  await page.locator('[data-tab="settlements"]').click();
  await expect(page.getByTestId("fdd-table-settlements")).toBeVisible();
  const all = (await api(page.request, `/admin/finance/drivers/${tariqId}/settlements?period=all`)).json;
  if (all.total > 0) {
    await expect(page.getByTestId("fdd-set-earned")).toContainText(((all.totals.earnedCents as number) / 100).toLocaleString("en-GB", { minimumFractionDigits: 2 }));
    await page.getByRole("button", { name: "Paid", exact: true }).click();
    await expect(page.getByTestId("fdd-table-settlements").locator("tbody tr").first()).toBeVisible();
  }
  await page.getByTestId("fdd-download-settlements").click();
  const [csvDl] = await Promise.all([page.waitForEvent("download"), page.getByTestId("fdd-download-settlements-csv").click()]);
  expect(csvDl.suggestedFilename()).toMatch(/\.csv$/);
  expect(readFileSync((await csvDl.path())!, "utf8").charCodeAt(0)).toBe(0xfeff);
  // the full statement workbook
  const [full] = await Promise.all([page.waitForEvent("download"), page.getByTestId("fdd-download-full").click()]);
  expect(full.suggestedFilename()).toMatch(/^finance-driver-statement-.*\.xlsx$/);
  expect(readFileSync((await full.path())!).subarray(0, 2).toString()).toBe("PK");
  // an independent driver: a wallet, no "paid via office"
  await gotoReady(page, `/admin/finance/drivers/${omarId}`);
  await expect(page.getByTestId("fdd-via-office")).toHaveCount(0);
  await expect(page.getByTestId("fdd-wallet-available")).toBeVisible();
  await expect(page.getByTestId("fdd-office")).toContainText("Independent");
  // the driver's wallet tab links to the finance page
  await gotoReady(page, `/admin/drivers/${omarId}/wallet`);
  await page.getByTestId("fdr-open-finance").click();
  await expect(page).toHaveURL(new RegExp(`/admin/finance/drivers/${omarId}$`));
  // an unknown driver is a clear error, not a blank page
  await gotoReady(page, "/admin/finance/drivers/00000000-0000-4000-8000-000000000000");
  await expect(page.getByTestId("fdd-header")).toHaveCount(0);
  await expect(page.getByText("We couldn't find what you were looking for.")).toBeVisible();
  await page.screenshot({ path: "test-results/finance-driver-detail.png", fullPage: true });
});

test("phone: cards instead of a wide table, nothing scrolls sideways; Arabic is right to left", async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();
  await staffLogin(page, ADMIN.email, ADMIN.password);
  await gotoReady(page, "/admin/finance/drivers");
  await expect(rowOf(page, "Tariq Mahmood").first()).toBeVisible();
  await noSideScroll(page);
  await expect(rowOf(page, "Tariq Mahmood").first().locator('td[data-label="Gross earnings"]')).toBeVisible(); // every cell carries its label
  await expect(page.getByTestId("fd-search")).toBeVisible();
  await page.screenshot({ path: "test-results/finance-drivers-390.png" });
  const id = await idOf(page, "Tariq");
  await gotoReady(page, `/admin/finance/drivers/${id}`);
  await expect(page.getByTestId("fdd-header")).toBeVisible();
  await noSideScroll(page);
  await page.locator('[data-tab="cash"]').click();
  await expect(page.getByTestId("fdd-table-cash")).toBeVisible();
  await noSideScroll(page);
  await ctx.addCookies([{ name: "jr_lang", value: "ar", url: BASE }]);
  await gotoReady(page, "/admin/finance/drivers");
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  await expect(page.getByRole("heading", { name: "السائقون", exact: true })).toBeVisible();
  await noSideScroll(page);
  await gotoReady(page, `/admin/finance/drivers/${id}`);
  await expect(page.getByTestId("fdd-cards")).toContainText("يُصرف عبر المكتب");
  await noSideScroll(page);
  await ctx.addCookies([{ name: "jr_lang", value: "en", url: BASE }]);
  await ctx.close();
});
