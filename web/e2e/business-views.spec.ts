import { test, expect, type Page } from "@playwright/test";
import { otpLogin, gotoReady, DEMO } from "./helpers";

/**
 * The redesigned company portal: dashboard KPIs that deep-link into the filtered list, the requests list (URL-synced status filter),
 * one request as a header + section routes (overview · shipments · money · activity), the wallet's kind filter + invoices, the cash page and
 * the integrations connection routes. Asserts relative to what exists (the shared demo business is used by other specs too).
 */
test.describe.configure({ mode: "serial" });

/** Same-origin fetch from the logged-in page (the API refuses cross-origin writes, which is what a bare request context looks like). */
const apiJson = (page: Page, path: string, method = "GET", data?: unknown) => page.evaluate(async ([p, m, d]) => {
  const r = await fetch(p as string, { method: m as string, headers: { "content-type": "application/json" }, body: d ? JSON.stringify(d) : undefined });
  return { status: r.status, json: (await r.json().catch(() => null)) as any };
}, [path, method, data] as const);

let reqId = ""; let ref = "";

test("setup: a published delivery request with one cash-on-delivery parcel", async ({ page }) => {
  await otpLogin(page, DEMO.business);
  const r = await apiJson(page, "/api/v1/requests", "POST", {
    service: "delivery_driver", quantity: 1, shipmentsPerDriver: 10, vehicleType: "sedan", pickupCity: "riyadh", deliveryCity: "riyadh", pickupAddress: "Warehouse 4, Industrial Area",
    durationDays: 1, startsAt: new Date(Date.now() + 2 * 864e5).toISOString(), publish: true, termsAccepted: true,
    shipments: [{ recipientName: "View Customer", recipientPhone: "0555000111", address: "1 Olaya St, Riyadh", externalRef: "VIEW-1", codCents: 5000 }],
  });
  expect(r.status, JSON.stringify(r.json)).toBe(201);
  reqId = r.json.id; ref = r.json.ref;
  expect(reqId).toBeTruthy();
});

test("dashboard: KPI tiles link into the filtered requests list", async ({ page }) => {
  await otpLogin(page, DEMO.business);
  await gotoReady(page, "/business");
  await expect(page.getByRole("heading", { level: 1, name: /^Welcome,/ })).toBeVisible();
  const active = page.locator('a[href="/business/requests?status=active"]');
  await expect(active).toBeVisible();
  await expect(page.locator('a[href="/business/wallet"]').first()).toBeVisible();
  await expect(page.getByTestId("dash-cash")).toBeVisible();
  await active.click();
  await expect(page).toHaveURL(/\/business\/requests\?status=active/);
  await expect(page.getByRole("button", { name: /^Active/ })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByTestId("order-row").filter({ hasText: ref })).toBeVisible(); // the new request is open for drivers → active
});

test("requests list: the status filter lives in the URL, old needsAction links still work, search finds a reference", async ({ page }) => {
  await otpLogin(page, DEMO.business);
  await gotoReady(page, "/business/requests?needsAction=1");
  await expect(page.getByRole("button", { name: /^Needs action/ })).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: /^All/ }).click();
  await expect(page).not.toHaveURL(/needsAction|status=/);
  await page.getByRole("button", { name: /^Completed/ }).click();
  await expect(page).toHaveURL(/status=completed/);
  await page.reload();
  await page.waitForSelector('html[data-hydrated="true"]');
  await expect(page.getByRole("button", { name: /^Completed/ })).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: /^All/ }).click();
  await page.getByRole("textbox", { name: "Search by reference" }).fill(ref);
  await expect(page.getByTestId("order-row")).toHaveCount(1);
  await expect(page.getByTestId("order-row")).toContainText(ref);
  await page.getByTestId("order-row").getByRole("link", { name: ref }).first().click();
  await expect(page).toHaveURL(new RegExp(`/business/requests/${reqId}$`));
});

test("one request: header, overview, shipments, money and activity are separate routes; cancelling stays in the header", async ({ page }) => {
  await otpLogin(page, DEMO.business);
  await gotoReady(page, `/business/requests/${reqId}`);
  await expect(page.getByRole("heading", { level: 1, name: ref })).toBeVisible();
  await expect(page.getByText("Open for drivers").first()).toBeVisible();
  const tabs = page.getByRole("navigation", { name: "Request sections" });
  await expect(tabs.getByRole("link", { name: "Overview" })).toHaveAttribute("aria-current", "page");
  await expect(page.getByRole("button", { name: "Cancel request" })).toBeVisible();

  await tabs.getByRole("link", { name: /^Shipments/ }).click();
  await expect(page).toHaveURL(new RegExp(`/requests/${reqId}/parcels$`));
  await expect(page.getByTestId("shipment-row")).toHaveCount(1);
  await expect(page.getByTestId("shipment-row")).toContainText("View Customer");
  await expect(page.getByTestId("parcel-cod")).toContainText("50.00");
  // the shipment status filter is a URL filter too: a status with no parcels shows the empty state and can be cleared
  await gotoReady(page, `/business/requests/${reqId}/parcels?status=failed`);
  await expect(page.getByText("No results found")).toBeVisible();
  await page.getByRole("button", { name: "Clear filters" }).click();
  await expect(page.getByTestId("shipment-row")).toHaveCount(1);

  await tabs.getByRole("link", { name: "Money" }).click();
  await expect(page).toHaveURL(new RegExp(`/requests/${reqId}/money$`));
  await expect(page.getByTestId("order-price")).toContainText("SAR 8.00");
  await expect(page.getByRole("heading", { name: "Invoices" })).toBeVisible();

  await tabs.getByRole("link", { name: "Activity" }).click();
  await expect(page).toHaveURL(new RegExp(`/requests/${reqId}/activity$`));
  await expect(page.getByTestId("order-chat")).toContainText("No driver to chat with yet"); // nobody accepted yet
  await expect(page.getByText("Request published")).toBeVisible(); // the timeline

  // cancel from the header (any section): reserved funds go back and the status changes
  await page.getByTestId("order-cancel").click();
  await page.getByLabel("Reason").fill("Changed my mind (e2e)");
  await page.getByTestId("order-cancel-confirm").click();
  await expect(page.getByText("Cancelled").first()).toBeVisible();
  await expect(page.getByTestId("order-cancel")).toHaveCount(0);
});

test("wallet: KPIs, a URL-synced kind filter on the transactions, and the invoices section", async ({ page }) => {
  await otpLogin(page, DEMO.business);
  await gotoReady(page, "/business/wallet");
  await expect(page.getByRole("heading", { level: 1, name: "Wallet" })).toBeVisible();
  await expect(page.getByText("Credit limit").first()).toBeVisible();
  await expect(page.getByText("Available balance").first()).toBeVisible();
  const all = await apiJson(page, "/api/v1/wallet");
  const orders = await apiJson(page, "/api/v1/wallet?kind=reserve,release_reserve,charge,refund,platform_fee,payout");
  expect(orders.status).toBe(200);
  expect(orders.json.total).toBeLessThanOrEqual(all.json.total);
  expect((orders.json.entries as Array<{ kind: string }>).every((e) => ["reserve", "release_reserve", "charge", "refund", "platform_fee", "payout"].includes(e.kind))).toBe(true);
  await page.getByRole("group", { name: "Filter transactions" }).getByRole("button", { name: "Requests" }).click();
  await expect(page).toHaveURL(/kind=orders/);
  await expect(page.getByRole("button", { name: "Requests", exact: true })).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("group", { name: "Filter transactions" }).getByRole("button", { name: "All" }).click();
  await expect(page).not.toHaveURL(/kind=/);
  // invoices have their own section, fed by their own endpoint
  await expect(page.locator("#invoices").getByRole("heading", { name: "Invoices" })).toBeVisible();
  const inv = await apiJson(page, "/api/v1/business/invoices");
  expect(inv.status).toBe(200);
  expect(inv.json).toMatchObject({ page: 1, totals: { totalCents: expect.any(Number), vatCents: expect.any(Number) } });
  expect(Array.isArray(inv.json.items)).toBe(true);
});

test("cash page keeps its totals, driver list and history; the dashboard shows the cash tile", async ({ page }) => {
  await otpLogin(page, DEMO.business);
  await gotoReady(page, "/business/cash");
  for (const id of ["cod-total-collected", "cod-total-received", "cod-total-outstanding", "cod-total-holders"]) await expect(page.getByTestId(id)).toBeVisible();
  await expect(page.getByTestId("cod-receive-open")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Cash received" })).toBeVisible();
});

test("integrations: an unknown connection id opens its own route (older ?c= links redirect there)", async ({ page }) => {
  await otpLogin(page, DEMO.business);
  const ghost = "00000000-0000-4000-8000-000000000000";
  await gotoReady(page, `/business/integrations?c=${ghost}`);
  await expect(page).toHaveURL(new RegExp(`/business/integrations/${ghost}$`));
  await expect(page.getByText("This connection no longer exists.")).toBeVisible();
  await page.getByRole("button", { name: "Back to connections" }).click();
  await expect(page).toHaveURL(/\/business\/integrations$/);
  await expect(page.getByRole("heading", { level: 1, name: "Integrations" })).toBeVisible();
});

test("profile & warehouse: the KPI row, the form and the warehouse card sit on one page", async ({ page }) => {
  await otpLogin(page, DEMO.business);
  await gotoReady(page, "/business/profile");
  await expect(page.getByRole("heading", { level: 1, name: "Profile & warehouse" })).toBeVisible();
  await expect(page.getByTestId("profile-form")).toBeVisible();
  await expect(page.getByTestId("warehouse-card")).toBeVisible();
  await expect(page.getByTestId("warehouse-ops")).toBeVisible();
  await expect(page.getByRole("button", { name: "Save changes" })).toBeDisabled(); // nothing edited yet
});
