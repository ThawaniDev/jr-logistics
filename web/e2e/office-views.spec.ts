import { test, expect, type APIRequestContext, type BrowserContext, type Page } from "@playwright/test";
import { otpLogin, gotoReady, DEMO, apiLogin } from "./helpers";

/**
 * The courier-office portal as views (decision F8): dashboard with KPIs and "needs attention", drivers list + driver view, opportunities with
 * filters and the assign flow, jobs list + job view, settlements, payouts, reports periods and the agreement — plus the driver portal's
 * filter pills. One sign-in per person for the whole file (OTP sends are rate limited); every count is judged against a baseline read through the API.
 */
test.describe.configure({ mode: "serial" });
test.use({ actionTimeout: 20_000 });
const BASE = `http://localhost:${process.env.E2E_PORT ?? 3101}`; // not 3100: other projects on this machine use it

async function api(ctx: APIRequestContext, method: "GET" | "POST" | "PUT", path: string, data?: unknown) {
  const res = await ctx.fetch(`${BASE}/api/v1${path}`, { method, data, headers: { origin: BASE, "content-type": "application/json" } });
  return { status: res.status(), json: await res.json().catch(() => null) };
}
const pill = (page: Page, name: RegExp) => page.getByRole("button", { name });

let ctx: BrowserContext; let page: Page;
let officeApi: APIRequestContext; // the office's session, for baselines
let driversBase: any[]; let invitesBase: number;
let published: { id: string; ref: string } | null = null;

test.beforeAll(async ({ browser }) => {
  ctx = await browser.newContext(); page = await ctx.newPage();
  await otpLogin(page, DEMO.office);
  officeApi = ctx.request;
  driversBase = (await api(officeApi, "GET", "/office/drivers")).json.items;
  invitesBase = (await api(officeApi, "GET", "/office/invites")).json.items.length;
});
test.afterAll(async () => { await ctx.close(); });

test("dashboard: KPI row, readiness, needs-attention list and quick actions that lead to the right page", async () => {
  await gotoReady(page, "/office");
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Welcome");
  const main = page.locator("main");
  for (const href of ["/office/drivers", "/office/jobs", "/office/opportunities", "/office/settlements", "/office/wallet"]) await expect(main.locator(`a[href="${href}"]`).first(), href).toBeVisible();
  await expect(page.getByTestId("office-readiness")).toBeVisible();
  // either something needs attention (each item links to the page that fixes it) or the list says all clear
  await expect(page.getByTestId("office-attention").or(page.getByTestId("office-attention-clear"))).toBeVisible();
  const items = page.locator('[data-testid^="office-attention-"]:not([data-testid="office-attention-clear"])');
  for (const a of await items.all()) await expect(a.getByRole("link")).toHaveAttribute("href", /^\/office\//);
  await page.getByTestId("office-quick-opps").click();
  await expect(page).toHaveURL(/\/office\/opportunities$/);
  await expect(page.getByRole("heading", { level: 1, name: "Opportunities" })).toBeVisible();
});

test("drivers: KPI + state filter in the URL + search, the invite flow from ?invite=1, withdrawing an invitation, and the driver view", async () => {
  await gotoReady(page, "/office/drivers");
  await expect(page.getByTestId("office-driver-row")).toHaveCount(driversBase.length);
  await expect(pill(page, new RegExp(`^All\\s*${driversBase.length}$`))).toHaveAttribute("aria-pressed", "true");
  const name = driversBase[0].name as string;
  await page.getByLabel("Search by name, phone or city").fill(name.split(" ")[0].toLowerCase());
  await expect(page.getByTestId("office-driver-row").first()).toContainText(name);
  await page.getByLabel("Search by name, phone or city").fill("zzz-no-such-driver");
  await expect(page.getByText("No driver matches your search or filter.")).toBeVisible();
  await page.getByRole("button", { name: "Clear filters" }).click();
  await expect(page.getByTestId("office-driver-row")).toHaveCount(driversBase.length);
  // a state filter is part of the URL, so a dashboard tile or a copied link opens it filtered
  await pill(page, /^Not verified/).click();
  await expect(page).toHaveURL(/[?&]state=unverified/);
  await expect(pill(page, /^Not verified/)).toHaveAttribute("aria-pressed", "true");
  await page.goto("/office/drivers?state=available");
  await expect(pill(page, /^Available/)).toHaveAttribute("aria-pressed", "true");

  // invite by phone: the dialog opens from the URL; a new number appears under "Invited" and can be withdrawn
  const phone = `05${Math.floor(1e7 + Math.random() * 9e7)}`;
  await gotoReady(page, "/office/drivers?invite=1");
  const dialog = page.getByRole("dialog", { name: "Invite driver" });
  await expect(dialog).toBeVisible();
  await expect(page.getByTestId("office-invite-send")).toBeDisabled();
  await dialog.getByLabel("Mobile number").fill(phone);
  await page.getByTestId("office-invite-send").click();
  await expect(page.getByText("Invitation sent")).toBeVisible();
  await expect(dialog).toBeHidden();
  await expect(page).not.toHaveURL(/invite=/);
  await pill(page, /^Invited/).click();
  await expect(page).toHaveURL(/[?&]state=invited/);
  const row = page.getByTestId("office-invite-row").filter({ hasText: phone.slice(1) });
  await expect(row).toHaveCount(1);
  await expect(page.getByTestId("office-invite-row")).toHaveCount(invitesBase + 1);
  await row.getByRole("button", { name: "Withdraw invitation" }).click();
  await expect(page.getByTestId("office-invite-row")).toHaveCount(invitesBase);

  // the driver view: breadcrumbs, KPI, his jobs and earnings, and the unlink confirmation (cancelled here)
  await gotoReady(page, "/office/drivers");
  await page.getByTestId("office-driver-row").first().getByRole("link", { name: "Open" }).click();
  await expect(page).toHaveURL(/\/office\/drivers\/[0-9a-f-]{36}$/);
  await expect(page.getByRole("navigation", { name: "Breadcrumb" }).getByRole("link", { name: "Drivers" })).toHaveAttribute("href", "/office/drivers");
  await expect(page.getByRole("heading", { level: 1 })).toContainText(name);
  await expect(page.getByRole("heading", { name: "Earnings" })).toBeVisible();
  await page.getByTestId("office-driver-unlink").click();
  await expect(page.getByRole("dialog", { name: "Unlink" })).toBeVisible();
  await page.getByRole("button", { name: "Cancel" }).click();
  await expect(page.getByRole("dialog")).toBeHidden();
});

test("opportunities: a published request shows as a card with KPI + filters; its drivers can be assigned from the page", async ({ browser }) => {
  test.setTimeout(120_000);
  const biz = await apiLogin(browser, DEMO.business);
  const shipments = Array.from({ length: 3 }, (_, i) => ({ recipientName: `Office View ${i + 1}`, recipientPhone: `05300000${String(i + 20)}`, address: `${i + 1} Olaya St, Riyadh` }));
  const pub = await api(biz.request, "POST", "/requests", { service: "delivery_driver", quantity: 1, shipmentsPerDriver: 10, vehicleType: "sedan", pickupCity: "riyadh", deliveryCity: "riyadh", pickupAddress: "Warehouse 4, Industrial Area", durationDays: 1,
    startsAt: new Date(Date.now() + 9 * 864e5).toISOString(), publish: true, termsAccepted: true, shipments });
  expect(pub.status).toBe(201);
  published = { id: pub.json.id, ref: pub.json.ref };
  const opp = (await api(officeApi, "GET", "/office/opportunities")).json.items.find((o: any) => o.id === published!.id);
  expect(opp, "the published request is an opportunity of the office").toBeTruthy();
  const eligible = opp.eligibleDrivers.length as number;

  await gotoReady(page, "/office/opportunities");
  const card = page.locator(`[data-testid="office-opp"][data-ref="${published.ref}"]`);
  await expect(card).toBeVisible();
  await expect(page.getByRole("group", { name: "Filter opportunities" })).toBeVisible();
  // filter + URL: "Ready to assign" and "No eligible driver" are complementary
  await pill(page, /^Ready to assign/).click();
  await expect(page).toHaveURL(/[?&]filter=ready/);
  await expect(card).toHaveCount(eligible > 0 ? 1 : 0);
  await page.goto("/office/opportunities?filter=none");
  await expect(card).toHaveCount(eligible > 0 ? 0 : 1);
  await page.getByLabel("Search by reference, business or city").fill(published.ref);
  await pill(page, /^All/).click();
  await expect(card).toHaveCount(1);

  if (eligible > 0) {
    await expect(card.getByTestId("office-assign")).toBeDisabled(); // nothing picked yet
    await card.getByLabel("Choose a driver").selectOption({ index: 1 });
    await card.getByTestId("office-assign").click();
    await expect(page.getByText("Driver assigned")).toBeVisible();
    await expect(card).toHaveCount(0); // the only slot is filled: the request leaves the list
    // …and the job is in the Jobs list, one click from its view
    await gotoReady(page, `/office/jobs?status=all&q=${published.ref}`);
    const job = page.getByTestId("office-job-row").filter({ has: page.locator(`a:has-text("${published.ref}")`) }).first();
    await expect(job).toBeVisible();
    await job.getByRole("link", { name: new RegExp(`^Job ${published.ref}`) }).click();
    await expect(page).toHaveURL(/\/office\/jobs\/[0-9a-f-]{36}$/);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(published.ref);
    await expect(page.getByRole("navigation", { name: "Breadcrumb" }).getByRole("link", { name: "Jobs" })).toHaveAttribute("href", "/office/jobs");
    await expect(page.getByText("Job chat", { exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Timeline" })).toBeVisible();
    expect(await page.evaluate(() => window.scrollY)).toBeLessThan(80); // the chat must not scroll the page to the bottom
  }
});

test("jobs: filter pills with counts in the URL, search, KPI, and the job view for a finished job", async () => {
  const all = (await api(officeApi, "GET", "/office/jobs?scope=all")).json as { total: number; items: Array<{ offerId: string; ref: string; status: string }> };
  await gotoReady(page, "/office/jobs");
  await expect(pill(page, /^Active/)).toHaveAttribute("aria-pressed", "true"); // the default filter
  await pill(page, /^All/).click();
  await expect(page).toHaveURL(/[?&]status=all/);
  await expect(pill(page, new RegExp(`^All\\s*${all.total}$`))).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByTestId("office-job-row")).toHaveCount(Math.min(all.total, 20)); // 20 per page
  await page.getByLabel("Search reference, business, driver").fill("zzz-nothing");
  await expect(page.getByText("No job matches your search or filter.")).toBeVisible();
  await page.getByRole("button", { name: "Clear filters" }).click();
  await expect(page).toHaveURL(/status=all|\/office\/jobs$/);
  // old links keep working: scope=all and ref=… from the settlements list
  const done = all.items.find((j) => j.status === "completed");
  if (done) {
    await gotoReady(page, `/office/jobs?scope=all&ref=${done.ref}`);
    await expect(pill(page, /^All/)).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator(`[data-testid="office-job-row"][data-ref="${done.ref}"]`).first()).toBeVisible();
    await gotoReady(page, `/office/jobs/${done.offerId}`);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(done.ref);
    await expect(page.getByText("Parcel progress")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Job details" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Replace driver" })).toHaveCount(0); // only a job that has not started can be replaced
  }
  // a job id that is not this office's: a clear not-found with a way back (not a broken page)
  await gotoReady(page, "/office/jobs/00000000-0000-4000-8000-000000000000");
  await expect(page.getByText("Job not found")).toBeVisible();
  await expect(page.getByRole("link", { name: "Jobs", exact: true }).last()).toBeVisible();
});

test("settlements, payouts, reports and agreement", async () => {
  // settlements: status pills with counts in the URL, KPI money, totals row
  const sets = (await api(officeApi, "GET", "/office/settlements")).json as { total: number; items: Array<{ status: string }> };
  await gotoReady(page, "/office/settlements");
  await expect(pill(page, new RegExp(`^All\\s*${sets.total}$`))).toBeVisible();
  await expect(page.getByTestId("office-settlement-row")).toHaveCount(Math.min(sets.total, 25));
  const paid = sets.items.filter((s) => s.status === "paid").length;
  await pill(page, /^Paid/).click();
  await expect(page).toHaveURL(/[?&]status=paid/);
  await expect(page.getByTestId("office-settlement-row")).toHaveCount(paid);
  await expect(page.locator("main").locator('a[href="/office/settlements?status=failed"]')).toBeVisible(); // KPI tiles link to the filtered list

  // payouts = the shared wallet with the settlement pipeline right under its header
  await gotoReady(page, "/office/wallet");
  await expect(page.getByRole("region", { name: "Settlements behind your payouts" })).toBeVisible();
  await expect(page.getByTestId("wallet-withdraw")).toBeVisible();

  // reports: the shared report filter bar (period preset in the URL), KPI cards and the CSV export
  await gotoReady(page, "/office/reports");
  await expect(page.getByRole("heading", { name: "Reports", exact: true })).toBeVisible();
  await expect(page.getByTestId("kpi-grid").first()).toBeVisible();
  await page.getByRole("button", { name: "7 days", exact: true }).click();
  await expect(page).toHaveURL(/[?&]preset=7d/);
  await expect(page.getByTestId("kpi-grid").first()).toBeVisible();
  await expect(page.getByRole("button", { name: /Export CSV/ }).first()).toBeVisible();

  // agreement: status KPI, the active terms and, when more than one version exists, the history
  const agreements = (await api(officeApi, "GET", "/office/agreements")).json.items as Array<{ version: number; status: string }>;
  await gotoReady(page, "/office/agreement");
  await expect(page.getByRole("heading", { level: 1, name: "Agreement" })).toBeVisible();
  const accepted = agreements.find((a) => a.status === "accepted");
  if (accepted) await expect(page.getByRole("heading", { name: `Agreement v${accepted.version}` })).toBeVisible();
  if (agreements.find((a) => a.status === "pending_acceptance")) await expect(page.getByTestId("office-agreement-accept")).toBeVisible();
  if (agreements.length > 1) await expect(page.getByTestId("office-agreement-row")).toHaveCount(agreements.length);
});

test("phone width: no sideways scrolling, tables become cards; Arabic: the page mirrors", async () => {
  await page.setViewportSize({ width: 390, height: 844 });
  for (const path of ["/office", "/office/drivers", "/office/jobs?status=all", "/office/settlements", "/office/opportunities", "/office/reports"]) {
    await gotoReady(page, path);
    await page.waitForTimeout(600);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow, `${path} must not scroll sideways`).toBeLessThanOrEqual(1);
  }
  await gotoReady(page, "/office/drivers");
  await expect(page.getByTestId("office-driver-row").first().locator("td[data-label]").first()).toBeVisible(); // each cell carries its label for the card layout
  await page.setViewportSize({ width: 1440, height: 900 });
  await ctx.addCookies([{ name: "jr_lang", value: "ar", url: BASE }]);
  await gotoReady(page, "/office/jobs");
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("المهام");
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
  await ctx.addCookies([{ name: "jr_lang", value: "en", url: BASE }]);
});

test("driver portal: dashboard KPI tiles keep their test ids; jobs and opportunities use filter pills that live in the URL", async ({ browser }) => {
  const drv = await (await apiLogin(browser, DEMO.driver)).newPage();
  await gotoReady(drv, "/driver");
  await expect(drv.getByTestId("cash-card")).toHaveAttribute("data-value", /^\d+$/);
  await expect(drv.locator("main").locator('a[href="/driver/opportunities"]').first()).toBeVisible();
  await gotoReady(drv, "/driver/jobs");
  await expect(pill(drv, /^Active/)).toHaveAttribute("aria-pressed", "true");
  await pill(drv, /^History/).click();
  await expect(drv).toHaveURL(/[?&]scope=history/);
  await expect(pill(drv, /^History/)).toHaveAttribute("aria-pressed", "true");
  await drv.reload();
  await expect(pill(drv, /^History/)).toHaveAttribute("aria-pressed", "true"); // survives a reload
  await gotoReady(drv, "/driver/opportunities");
  await expect(pill(drv, /^Offers for you/)).toHaveAttribute("aria-pressed", "true");
  await pill(drv, /^Open requests/).click();
  await expect(drv).toHaveURL(/[?&]view=open/);
  await expect(pill(drv, /^Open requests/)).toHaveAttribute("aria-pressed", "true");
  await gotoReady(drv, "/driver/cash");
  await expect(drv.getByTestId("cash-total-outstanding")).toHaveAttribute("data-value", /^\d+$/);
  await drv.context().close();
});
