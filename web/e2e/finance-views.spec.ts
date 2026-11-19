import { test, expect, type APIRequestContext } from "@playwright/test";
import { staffLogin, gotoReady, DEMO, apiLogin } from "./helpers";

/**
 * Admin finance as a group of separate pages (UI redesign F1–F12): overview, settlements, withdrawals, ledger, invoices, cash on delivery, pricing.
 * Everything is asserted relative to what is on the page at the start (the specs share one database), and the money it moves is its own:
 * the withdrawals / adjustment / price rule below are created here and identified by id or a unique reference.
 */
test.describe.configure({ mode: "serial" });

const BASE = "http://localhost:3100";
const ADMIN = { email: "admin@jrlogistics.test", password: "E2e!Password2026" };
const UUID0 = "11111111-1111-4111-8111-111111111111";
const RULE_REF = "E2E-FIN-RULE";

async function api(ctx: APIRequestContext, method: "GET" | "POST", path: string, data?: unknown) {
  const res = await ctx.fetch(`${BASE}/api/v1${path}`, { method, data, headers: { origin: BASE, "content-type": "application/json" } });
  return { status: res.status(), json: await res.json().catch(() => null) };
}
/** The number inside a Segmented option ("Paid 4" → 4). */
const countOf = async (btn: import("@playwright/test").Locator) => Number(((await btn.innerText()).match(/(\d+)\s*$/) ?? [])[1]);

// A price rule created below must not outlive a failed run: it would shadow nothing (it is company-specific) but would stay in the list.
test.afterAll(async ({ browser }) => {
  const ctx = await browser.newContext();
  if ((await api(ctx.request, "POST", "/auth/staff/login", ADMIN)).status === 200) {
    const rules = await api(ctx.request, "GET", "/admin/pricing?service=car_without_driver");
    for (const r of (rules.json?.items ?? []) as Array<{ id: string; agreementRef: string | null }>) if (r.agreementRef === RULE_REF) await api(ctx.request, "POST", `/admin/pricing/${r.id}/retire`);
  }
  await ctx.close();
});

test("old finance URLs keep working: they land on the page that replaced them and keep their filters", async ({ page }) => {
  await staffLogin(page, ADMIN.email, ADMIN.password);
  await gotoReady(page, "/admin/pricing");
  await expect(page).toHaveURL(/\/admin\/finance\/pricing$/);
  await expect(page.getByRole("heading", { name: "Pricing", exact: true })).toBeVisible();
  await gotoReady(page, "/admin/finance?tab=withdrawals&status=paid");
  await expect(page).toHaveURL(/\/admin\/finance\/withdrawals\?status=paid$/);
  await expect(page.getByRole("button", { name: /^Paid/ })).toHaveAttribute("aria-pressed", "true");
  await gotoReady(page, `/admin/finance?tab=ledger&request=${UUID0}`);
  await expect(page).toHaveURL(new RegExp(`/admin/finance/ledger\\?request=${UUID0}$`));
  await expect(page.getByTestId("fin-ledger-request-chip")).toBeVisible();
  await gotoReady(page, "/admin/finance?tab=invoices");
  await expect(page).toHaveURL(/\/admin\/finance\/invoices$/);
  await expect(page.getByRole("heading", { name: "Invoices", exact: true })).toBeVisible();
  await gotoReady(page, "/admin/finance?tab=settlements");
  await expect(page).toHaveURL(/\/admin\/finance\/settlements$/);
  await gotoReady(page, `/admin/cod?driverId=${UUID0}`);
  await expect(page).toHaveURL(new RegExp(`/admin/finance/cod\\?driverId=${UUID0}$`));
  await expect(page.getByRole("heading", { name: "Cash on delivery", exact: true })).toBeVisible();
  await gotoReady(page, "/admin/finance"); // the overview itself stays at /admin/finance
  await expect(page).toHaveURL(/\/admin\/finance$/);
});

test("overview: KPI cards that link to the lists, what needs attention, the notices and the recent activity", async ({ page }) => {
  await staffLogin(page, ADMIN.email, ADMIN.password);
  await gotoReady(page, "/admin/finance");
  await expect(page.getByRole("heading", { name: "Finance", exact: true })).toBeVisible();
  for (const label of ["Platform revenue", "Escrow held", "Owed to users", "Cash with drivers"]) await expect(page.getByText(label, { exact: true }).first()).toBeVisible();
  await expect(page.getByTestId("foa-fin-auto-notice")).toBeVisible();
  await expect(page.getByTestId("foa-fin-on-hold")).toBeVisible();
  await expect(page.getByText(/Payments are recorded in an internal ledger/)).toBeVisible();
  await expect(page.getByRole("heading", { name: "Needs attention" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Recent settlements" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Recent wallet movements" })).toBeVisible();
  await page.getByRole("link", { name: "View all" }).first().click(); // recent settlements → the settlements page
  await expect(page).toHaveURL(/\/admin\/finance\/settlements$/);
  await gotoReady(page, "/admin/finance");
  await page.getByRole("link", { name: /Withdrawals pending/ }).click(); // a KPI card is a link to its list
  await expect(page).toHaveURL(/\/admin\/finance\/withdrawals$/);
  await expect(page.getByRole("heading", { name: "Withdrawals", exact: true })).toBeVisible();
});

test("settlements: the status filter lives in the URL, its counts match the rows, search and clear work", async ({ page }) => {
  await staffLogin(page, ADMIN.email, ADMIN.password);
  await gotoReady(page, "/admin/finance/settlements");
  const paidBtn = page.getByRole("button", { name: /^Paid\s*\d+/ });
  await expect(paidBtn).toBeVisible();
  const paid = await countOf(paidBtn); const total = await countOf(page.getByRole("button", { name: /^All\s*\d+/ }));
  expect(total).toBeGreaterThanOrEqual(paid);
  await expect(page.locator("tbody tr")).toHaveCount(Math.min(total, 25));
  const ref = (await page.locator("tbody tr").first().locator("a").first().innerText()).trim(); // the order reference of the newest settlement
  await paidBtn.click();
  await expect(page).toHaveURL(/status=paid/);
  await expect(page.getByRole("button", { name: /^Paid/ })).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("tbody tr")).toHaveCount(Math.min(paid, 25));
  await expect(page.getByTestId("foa-settle-status-hold")).toHaveCount(0);
  await page.getByRole("button", { name: /^On hold/ }).click();
  await expect(page).toHaveURL(/status=hold/);
  await expect(page.getByTestId("foa-settle-status-paid")).toHaveCount(0);
  await page.getByRole("button", { name: /^All/ }).click();
  await expect(page).not.toHaveURL(/status=/);
  await page.getByPlaceholder("Order, driver or parcel code").fill(ref);
  await expect(page.locator("tbody tr").first()).toContainText(ref);
  await expect(page.getByTestId("fin-clear-filters")).toBeVisible();
  await page.getByTestId("fin-clear-filters").click();
  await expect(page.getByPlaceholder("Order, driver or parcel code")).toHaveValue("");
  await expect(page.locator("tbody tr")).toHaveCount(Math.min(total, 25));
  // each row links to the request, the company and the driver
  const firstRow = page.locator("tbody tr").first();
  await expect(firstRow.locator('a[href^="/admin/requests/"]')).toHaveCount(1);
  await expect(firstRow.locator('a[href^="/admin/companies/"]')).toHaveCount(1);
  await expect(firstRow.locator('a[href^="/admin/drivers/"]')).toHaveCount(1);
});

test("wallet adjustment, then withdrawals decided on their own page, then the ledger of that account", async ({ page, browser }) => {
  test.setTimeout(120_000);
  await staffLogin(page, ADMIN.email, ADMIN.password);
  // a manual credit is balanced against the platform account, which holds little in a fresh database: move SAR 700 there first (a debit on the demo company)
  const bizCtx = await apiLogin(browser, DEMO.business);
  const bizId = (await api(bizCtx.request, "GET", "/auth/me")).json.user.id as string;
  const fund = await api(page.context().request, "POST", "/admin/finance/adjustments", { userId: bizId, amountCents: -70_000, reason: "e2e: fund the platform account", idempotencyKey: `e2e-fin-fund-${Date.now()}` });
  expect(fund.status, JSON.stringify(fund.json)).toBeLessThan(300);
  // the adjustment dialog is on the overview; it credits a driver who then asks for two withdrawals
  await gotoReady(page, "/admin/finance");
  await page.getByTestId("fin-adjust-open").click();
  const adj = page.getByRole("dialog", { name: "Adjust a wallet" });
  await adj.getByLabel("Find account").fill("Yusuf");
  await adj.getByRole("button", { name: /Yusuf Khan/ }).click();
  await expect(adj.getByTestId("fin-adjust-submit")).toBeDisabled(); // needs an amount and a reason
  await adj.getByTestId("fin-adjust-amount").fill("500");
  await adj.getByTestId("fin-adjust-reason").fill("e2e finance views top-up");
  await adj.getByTestId("fin-adjust-submit").click();
  await expect(page.getByText("Saved").first()).toBeVisible();
  await expect(adj).toHaveCount(0);

  const drv = await apiLogin(browser, "0500000013"); // Yusuf (hiace)
  const userId = (await api(drv.request, "GET", "/auth/me")).json.user.id as string;
  const w1 = await api(drv.request, "POST", "/withdrawals", { amountCents: 15_000 }); expect(w1.status, JSON.stringify(w1.json)).toBe(201);
  const w2 = await api(drv.request, "POST", "/withdrawals", { amountCents: 12_000 }); expect(w2.status, JSON.stringify(w2.json)).toBe(201);

  await gotoReady(page, "/admin/finance/withdrawals");
  await expect(page.getByRole("button", { name: /^Pending/ })).toHaveAttribute("aria-pressed", "true"); // the queue is the default view
  await expect(page.getByTestId(`fin-wd-row-${w1.json.id}`)).toBeVisible();
  await expect(page.getByTestId("fin-wd-pending-n")).not.toHaveText("0");
  // pay the first one: the dialog needs the bank reference
  await page.getByTestId(`fin-wd-pay-${w1.json.id}`).click();
  const pay = page.getByRole("dialog", { name: "Mark paid" });
  await expect(pay.getByTestId("fin-wd-pay-confirm")).toBeDisabled();
  await pay.getByTestId("fin-wd-ref").fill("E2E-REF-1");
  await pay.getByTestId("fin-wd-pay-confirm").click();
  await expect(page.getByTestId(`fin-wd-row-${w1.json.id}`)).toHaveCount(0); // left the queue
  await page.getByRole("button", { name: /^Paid/ }).click();
  await expect(page).toHaveURL(/status=paid/);
  await expect(page.getByTestId(`fin-wd-row-${w1.json.id}`)).toContainText("E2E-REF-1");
  // reject the second one with a reason
  await page.getByRole("button", { name: /^Pending/ }).click();
  await expect(page).not.toHaveURL(/status=/);
  await page.getByTestId(`fin-wd-reject-${w2.json.id}`).click();
  const rej = page.getByRole("dialog", { name: "Reject" });
  await rej.getByLabel("Reason").fill("IBAN does not match");
  await rej.getByRole("button", { name: "Confirm" }).click();
  await expect(page.getByTestId(`fin-wd-row-${w2.json.id}`)).toHaveCount(0);
  await page.getByRole("button", { name: /^Rejected/ }).click();
  await expect(page).toHaveURL(/status=rejected/);
  await expect(page.getByTestId(`fin-wd-row-${w2.json.id}`)).toContainText("IBAN does not match");
  const mine = (await api(drv.request, "GET", "/withdrawals")).json.items as Array<{ id: string; status: string }>;
  expect(mine.find((x) => x.id === w1.json.id)?.status).toBe("paid"); expect(mine.find((x) => x.id === w2.json.id)?.status).toBe("rejected");

  // the ledger of that account, opened from the URL: adjustment, hold, payment and the returned (rejected) amount
  await gotoReady(page, `/admin/finance/ledger?userId=${userId}`);
  await expect(page.getByTestId("fin-ledger-account")).toContainText("Yusuf Khan");
  for (const kind of ["Adjustment", "Withdrawal paid", "Withdrawal returned"]) await expect(page.getByRole("cell", { name: new RegExp(kind) }).first()).toBeVisible();
  await page.getByTestId("fin-ledger-kind").selectOption("adjustment");
  await expect(page).toHaveURL(/kind=adjustment/);
  await expect(page.locator("tbody tr")).toHaveCount(1);
  await expect(page.locator("tbody tr")).toContainText("500.00");
  await page.getByTestId("fin-ledger-account").getByRole("button", { name: "Clear" }).click(); // removing the account chip widens the list again
  await expect(page).not.toHaveURL(/userId=/);
  await expect(page).toHaveURL(/kind=adjustment/);
  await drv.close();
});

test("cash on delivery: two pages of one function (orders, remittances) and a by-driver view, all filters in the URL", async ({ page }) => {
  await staffLogin(page, ADMIN.email, ADMIN.password);
  await gotoReady(page, "/admin/finance/cod");
  await expect(page.getByRole("heading", { name: "Cash on delivery", exact: true })).toBeVisible();
  for (const id of ["foa-cod-total-collected", "foa-cod-total-received", "foa-cod-total-outstanding", "fin-cod-drivers-holding"]) await expect(page.getByTestId(id)).toBeVisible();
  const tabs = page.getByRole("navigation", { name: "Cash on delivery" });
  await expect(tabs.getByRole("link", { name: /Orders with cash/ })).toHaveAttribute("aria-current", "page");
  await page.getByRole("button", { name: "By driver" }).click();
  await expect(page).toHaveURL(/view=drivers/);
  await expect(page.getByRole("button", { name: "By driver" })).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: /^All/ }).click(); // outstanding → every order with cash
  await expect(page).toHaveURL(/show=all/);
  await tabs.getByRole("link", { name: "Remittances" }).click();
  await expect(page).toHaveURL(/\/admin\/finance\/cod\/remittances$/);
  await expect(tabs.getByRole("link", { name: "Remittances" })).toHaveAttribute("aria-current", "page");
  await expect(page.getByTestId("foa-cod-total-outstanding")).toBeVisible(); // the KPI row is shared by both pages
  await tabs.getByRole("link", { name: /Orders with cash/ }).click();
  await expect(page).toHaveURL(/\/admin\/finance\/cod$/);
});

test("pricing: the service filter is in the URL; a company price rule is created and retired", async ({ page }) => {
  await staffLogin(page, ADMIN.email, ADMIN.password);
  await gotoReady(page, "/admin/finance/pricing");
  await expect(page.getByRole("button", { name: "Delivery driver" })).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "Car without driver" }).click();
  await expect(page).toHaveURL(/service=car_without_driver/);
  await page.getByTestId("fin-pricing-new").click();
  const dlg = page.getByRole("dialog", { name: "New price rule" });
  await expect(dlg.getByTestId("fin-pricing-save")).toBeDisabled();
  await dlg.getByLabel("Business override").fill("Sara");
  await dlg.getByRole("option", { name: /Sara Alharbi/ }).click();
  await dlg.getByTestId("fin-pricing-price").fill("77.77");
  await dlg.getByTestId("fin-pricing-cost").fill("55.55");
  await dlg.getByLabel("Agreement reference").fill(RULE_REF);
  await expect(dlg.getByText(/22\.22/)).toBeVisible(); // the margin preview
  await dlg.getByTestId("fin-pricing-save").click();
  const row = page.locator("tr", { hasText: "77.77" });
  await expect(row).toBeVisible();
  await expect(row.locator('a[href^="/admin/companies/"]')).toBeVisible(); // the company the rule is for, linked to its page
  await row.getByRole("button", { name: "Retire" }).click();
  await page.getByRole("dialog", { name: "Retire" }).getByRole("button", { name: "Retire" }).click();
  await expect(page.locator("tr", { hasText: "77.77" })).toHaveCount(0); // gone from "Active only"
  await page.getByRole("button", { name: "Including retired" }).click();
  await expect(page).toHaveURL(/all=1/);
  await expect(page.locator("tr", { hasText: "77.77" }).getByText("Retired")).toBeVisible();
});

test("a staff member with only the cash-on-delivery permission sees only that page and never triggers a 403", async ({ browser }) => {
  const page = await (await browser.newContext()).newPage();
  const denied: string[] = [];
  page.on("response", (r) => { if (r.status() === 403 && /\/api\/v1\/admin\/(finance|cod|pricing)/.test(r.url())) denied.push(r.url()); }); // the finance pages' own requests
  await staffLogin(page, "ops@jrlogistics.demo", DEMO.staffPw); // the operations preset: cod.manage, no finance.view
  await gotoReady(page, "/admin/finance"); // the overview needs finance.view: they land on the first finance page they may open
  await expect(page).toHaveURL(/\/admin\/finance\/cod$/);
  const nav = page.getByRole("navigation", { name: "Main navigation" });
  await expect(nav.getByRole("link", { name: "Cash on delivery" })).toBeVisible();
  for (const name of ["Overview", "Settlements", "Withdrawals", "Wallet ledger", "Invoices", "Pricing"]) await expect(nav.getByRole("link", { name })).toHaveCount(0);
  await expect(page.getByTestId("foa-cod-total-outstanding")).toBeVisible();
  await expect(page.getByTestId("foa-cod-receive-generic")).toBeVisible(); // cod.manage may record receipts
  for (const path of ["/admin/finance/withdrawals", "/admin/finance/settlements", "/admin/finance/ledger", "/admin/finance/invoices", "/admin/finance/pricing"]) {
    await gotoReady(page, path); // a typed URL shows a plain "no permission" note instead of a page full of failed requests
    await expect(page.getByText("You don't have permission to do that.")).toBeVisible();
    await expect(page.locator("tbody tr")).toHaveCount(0);
  }
  expect(denied).toEqual([]);
});
