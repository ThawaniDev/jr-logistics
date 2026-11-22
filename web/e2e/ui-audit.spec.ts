import { test, expect, type Page } from "@playwright/test";
import { otpLogin, staffLogin, gotoReady, DEMO } from "./helpers";
import en from "../src/i18n/en";

/**
 * UI audit K / A5 regressions (production build): tab titles, the top-bar wallet chip after an action, page-wide sideways scroll,
 * duplicate ids, the explorer's hydration error, and what a restricted staff member sees on a page his role does not include.
 */
test.describe.configure({ mode: "serial" });
const ADMIN = { email: "admin@jrlogistics.test", password: "E2e!Password2026" };
const nav = (page: Page) => page.getByRole("navigation", { name: "Main navigation" }).first();
const noSideways = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
const apiJson = (page: Page, path: string, method = "GET", data?: unknown) => page.evaluate(async ([p, m, d]) => {
  const r = await fetch(p as string, { method: m as string, headers: { "content-type": "application/json" }, body: d ? JSON.stringify(d) : undefined });
  return { status: r.status, json: (await r.json().catch(() => null)) as any };
}, [path, method, data] as const);

let reqId = "";

test("setup: a published delivery request (its cost is reserved from the wallet)", async ({ page }) => {
  await otpLogin(page, DEMO.business);
  const r = await apiJson(page, "/api/v1/requests", "POST", {
    service: "delivery_driver", quantity: 1, shipmentsPerDriver: 10, vehicleType: "sedan", pickupCity: "riyadh", deliveryCity: "riyadh", pickupAddress: "Warehouse 4, Industrial Area",
    durationDays: 1, startsAt: new Date(Date.now() + 2 * 864e5).toISOString(), publish: true, termsAccepted: true,
    shipments: [{ recipientName: "Audit Customer", recipientPhone: "0555000222", address: "1 Olaya St, Riyadh", externalRef: "AUDIT-1" }],
  });
  expect(r.status, JSON.stringify(r.json)).toBe(201);
  reqId = r.json.id;
});

test("the browser tab names the page: on a full load and after clicking through the sidebar (W-4)", async ({ page }) => {
  await otpLogin(page, DEMO.business);
  await gotoReady(page, "/business/wallet");
  await expect(page).toHaveTitle(`${en["nav.wallet"]} · JR Logistics`);
  await nav(page).locator('a[href="/business/cash"]').click();
  await expect(page).toHaveTitle(`${en["nav.cash"]} · JR Logistics`);
  await nav(page).locator('a[href="/business/requests"]').click();
  await expect(page).toHaveTitle(`${en["nav.requests"]} · JR Logistics`);
  await gotoReady(page, `/business/requests/${reqId}`); // a detail page belongs to its sidebar entry
  await expect(page).toHaveTitle(`${en["nav.requests"]} · JR Logistics`);
  // still right a moment later (Next swaps its own <title> in after mount)
  await page.waitForTimeout(1500);
  await expect(page).toHaveTitle(`${en["nav.requests"]} · JR Logistics`);
});

test("driver pages: the title writers (page name and the unread counter of the alert banner) settle instead of freezing the tab", async ({ page }) => {
  await otpLogin(page, DEMO.driver);
  await gotoReady(page, "/driver/jobs");
  await page.waitForTimeout(2500); // the banner polls and may prefix "(n) "
  await expect(page).toHaveTitle(new RegExp(`^(\\(\\d+\\+?\\) )?${en["nav.my_jobs"]} · JR Logistics$`));
  expect(await page.evaluate(() => 40 + 2), "the page still runs scripts").toBe(42);
  await nav(page).locator('a[href="/driver/wallet"]').click();
  await expect(page).toHaveURL(/\/driver\/wallet$/);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  expect(await page.evaluate(() => 1 + 1)).toBe(2);
});

test("the sidebar renders twice (desktop + drawer) without duplicate ids (W-10)", async ({ page }) => {
  await otpLogin(page, DEMO.business);
  await gotoReady(page, "/business");
  const dup = await page.evaluate(() => { const seen = new Map<string, number>(); document.querySelectorAll("[id]").forEach((e) => seen.set(e.id, (seen.get(e.id) ?? 0) + 1)); return [...seen].filter(([, n]) => n > 1).map(([id]) => id); });
  expect(dup).toEqual([]);
  // every group toggle still points at a panel that exists
  const broken = await page.evaluate(() => Array.from(document.querySelectorAll("nav button[aria-controls]")).filter((b) => !document.getElementById(b.getAttribute("aria-controls")!)).length);
  expect(broken).toBe(0);
});

test("a successful action refreshes the wallet chip in the top bar at once, not a minute later (W-7)", async ({ page }) => {
  await otpLogin(page, DEMO.business);
  await gotoReady(page, `/business/requests/${reqId}`);
  const chip = page.locator("header").getByRole("link", { name: /^Wallet:/ });
  await expect(chip).toBeVisible();
  const before = await chip.getAttribute("aria-label");
  await page.getByTestId("order-cancel").click();
  await page.getByLabel("Reason").fill("Audit: the balance must move (e2e)");
  await page.getByTestId("order-cancel-confirm").click();
  await expect(page.getByText("Cancelled").first()).toBeVisible();
  await expect.poll(() => chip.getAttribute("aria-label"), { timeout: 8_000, message: "the refund shows in the top bar without waiting for the 60 s poll" }).not.toBe(before);
});

test("tables with a visually hidden header cell do not widen the page (W-6)", async ({ page }) => {
  await page.setViewportSize({ width: 1360, height: 900 });
  await staffLogin(page, ADMIN.email, ADMIN.password);
  for (const url of ["/admin/offices", "/admin/requests", "/admin/companies", "/admin/drivers"]) {
    await gotoReady(page, url);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await page.waitForTimeout(800);
    expect(await noSideways(page), `${url} scrolls sideways`).toBe(true);
  }
  await otpLogin(page, DEMO.business);
  await gotoReady(page, `/business/requests/${reqId}/parcels`);
  await page.waitForTimeout(800);
  expect(await noSideways(page), "the parcels table scrolls sideways").toBe(true);
});

test("the data explorer loads without a hydration error (a Skeleton <div> inside a <p>) (W-2)", async ({ page }) => {
  const problems: string[] = [];
  page.on("console", (m) => { if (m.type() === "error") problems.push(m.text().slice(0, 200)); });
  page.on("pageerror", (e) => problems.push(String(e).slice(0, 200)));
  await staffLogin(page, ADMIN.email, ADMIN.password);
  await gotoReady(page, "/admin/reports/explorer");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await page.waitForTimeout(1500);
  expect(problems).toEqual([]);
});

test("a restricted staff member who opens a page his role does not include sees a calm explanation, not 'Something went wrong' (W-3)", async ({ page }) => {
  const forbidden: string[] = [];
  page.on("response", (r) => { if (r.status() === 403 && r.url().includes("/api/v1/")) forbidden.push(r.url()); });
  await staffLogin(page, "support@jrlogistics.demo", DEMO.staffPw);
  for (const [url, name] of [["/admin/finance/ledger", en["nav.fin_ledger"]], ["/admin/roles", en["nav.roles"]], ["/admin/audit", en["nav.audit"]]]) {
    forbidden.length = 0;
    await gotoReady(page, url);
    await expect(page.getByRole("heading", { level: 1, name })).toBeVisible();
    await expect(page.getByTestId("no-access")).toBeVisible();
    await expect(page.getByTestId("no-access")).toContainText(en["err.no_access_hint"]);
    await expect(page.locator("main").getByRole("alert")).toHaveCount(0); // not the route announcer Next puts outside <main>
    await expect(page.locator("main").getByText(en["common.error_title"])).toHaveCount(0);
    await expect(page.getByRole("button", { name: en["common.retry"] })).toHaveCount(0);
    expect(forbidden, `${url} fired requests that can only answer 403`).toEqual([]);
    await expect(page).toHaveTitle(`${name} · JR Logistics`);
  }
  // the way back works, and an allowed page still opens normally
  await page.getByRole("link", { name: en["err.no_access_home"] }).click();
  await expect(page).toHaveURL(/\/admin$/);
  await gotoReady(page, "/admin/cases");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await expect(page.getByTestId("no-access")).toHaveCount(0);
});

test("the same page in Arabic is translated and mirrored", async ({ page }) => {
  await staffLogin(page, "support@jrlogistics.demo", DEMO.staffPw);
  await page.context().addCookies([{ name: "jr_lang", value: "ar", url: `http://localhost:${process.env.E2E_PORT ?? 3101}` }]);
  await gotoReady(page, "/admin/roles");
  await expect(page.getByTestId("no-access")).toContainText("دورك لا يتضمن");
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
});
