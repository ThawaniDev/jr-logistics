import { test, expect, type Page } from "@playwright/test";
import { otpLogin, gotoReady, DEMO } from "./helpers";

/**
 * Incoming orders (warehouse-system integrations v2): a custom ("webhook") system posts orders to JR, the company sees them under Incoming orders,
 * turns two of them into one JR delivery request (the request form is pre-filled from the orders), and they then show as "In JR".
 * A third order is set aside (the partner is NOT told) and restored from its detail page.
 *
 * Shares the database with the other specs: everything is scoped to a connection created here (unique name + references) and the
 * connection is deleted at the end (its incoming orders go with it; the draft's parcels stay, unlinked). A business may hold 5 connections.
 */

const BASE = `http://localhost:${process.env.E2E_PORT ?? 3101}`; // not 3100: other projects on this machine use it
const TAG = Date.now().toString(36).toUpperCase();
const REFS = [`E2E-${TAG}-1`, `E2E-${TAG}-2`];
const LATER = `E2E-${TAG}-3`;
const NAME = `E2E Orders ${TAG}`;

const api = (page: Page, method: string, path: string, data?: unknown) =>
  page.request.fetch(`${BASE}/api/v1${path}`, { method, data, headers: { origin: BASE, "content-type": "application/json" } });
const order = (reference: string, i: number) => ({
  type: "order", reference, recipient: { name: `E2E Customer ${i}`, phone: `05550009${String(10 + i).slice(-2)}`, address: `King Fahd Rd ${100 + i}, Al Olaya`, city: "Riyadh" }, cod: 25,
});

test.describe.configure({ mode: "serial" });

test("incoming orders: pushed by a custom system → one delivery request (prefilled) → In JR; set aside and restore", async ({ page, request }) => {
  test.setTimeout(150_000);
  await otpLogin(page, DEMO.business);

  // ── a custom ("webhook") connection, created with the company's session; its inbound token is shown once ──
  const made = await api(page, "POST", "/integrations/connections", { provider: "webhook", name: NAME });
  expect(made.status(), await made.text()).toBe(201);
  const conn = (await made.json()) as { id: string; inboundToken: string | null };
  expect(conn.inboundToken).toBeTruthy();
  const push = async (items: unknown[]) => {
    // the partner's call: no session, the connection's token as a bearer
    const r = await request.post(`${BASE}/api/v1/integrations/hooks/${conn.id}`, { headers: { authorization: `Bearer ${conn.inboundToken}`, "content-type": "application/json" }, data: { items } });
    expect(r.status(), await r.text()).toBeLessThan(300);
    return r.json();
  };

  try {
    const res = await push(REFS.map((r, i) => order(r, i + 1)));
    expect(res.orders.map((o: { status: string }) => o.status)).toEqual(["created", "created"]);

    // ── Incoming orders, filtered to this connection (the connection pages link here with ?connectionId=) ──
    await gotoReady(page, `/business/integrations/orders?connectionId=${conn.id}`);
    await expect(page.getByRole("heading", { level: 1, name: "Incoming orders" })).toBeVisible();
    await expect(page.getByRole("navigation", { name: "Main navigation" }).first().locator('a[href="/business/integrations/orders"]')).toHaveAttribute("aria-current", "page");
    const rows = page.getByTestId("orders-row");
    await expect(rows).toHaveCount(2);
    for (const r of REFS) await expect(rows.filter({ hasText: r })).toHaveCount(1);
    await expect(rows.first()).toHaveAttribute("data-state", "open");
    await expect(rows.first()).toContainText("Riyadh");
    await expect(rows.first().getByTestId("cod-unknown")).toHaveCount(0); // the partner stated the cash to collect

    // ── select both → Create delivery order → the request form, pre-filled ──
    await page.getByTestId("orders-select-page").check();
    await expect(page.getByTestId("orders-selected-count")).toHaveText("2 selected");
    await page.getByTestId("orders-create").click();
    await expect(page).toHaveURL(/\/business\/requests\/new\?fromOrders=/);
    await expect(page.getByTestId("orders-prefill")).toContainText("Incoming orders added: 2");
    await expect(page.getByTestId("orders-prefill")).toContainText("Delivery city set to Riyadh");
    await expect(page.getByRole("button", { name: /Delivery driver/ })).toHaveAttribute("aria-pressed", "true"); // the per-parcel service is chosen
    await page.getByLabel(/^Vehicle/).selectOption("sedan");
    await page.getByRole("button", { name: "Next", exact: true }).click();
    await expect(page.getByLabel(/^Delivery city/)).toHaveValue("riyadh");
    await page.getByLabel(/Pickup address/).fill("Olaya St, Riyadh");
    const d = new Date(Date.now() + 2 * 864e5 + 3 * 3600e3).toISOString().slice(0, 11) + "09:00";
    await page.getByLabel(/Start date/).fill(d);
    await page.getByRole("button", { name: "Next", exact: true }).click();

    // Shipments step: the two parcels are there, linked to their orders (reference + "imported from" the connection), COD carried over.
    const parcels = page.getByTestId("manifest-row");
    await expect(parcels).toHaveCount(2);
    await expect(page.getByTestId("parcel-count")).toHaveText("2");
    const refs = await parcels.getByLabel(/^Order reference/).evaluateAll((els) => els.map((e) => (e as HTMLInputElement).value));
    expect(refs.sort()).toEqual([...REFS].sort());
    await expect(parcels.first().getByTestId("partner-origin")).toContainText(NAME);
    await expect(parcels.first().getByTestId("manifest-cod")).toHaveValue("25");
    // The import panel offers the incoming-orders source too; both orders are already in this list.
    await page.getByTestId("import-from-orders").click();
    await expect(page.getByTestId("orders-picker")).toBeVisible();
    for (const r of REFS) await expect(page.getByTestId("orders-picker-row").filter({ hasText: r })).toContainText("Already in this list");
    await page.getByTestId("orders-picker").getByRole("button", { name: "Close" }).click();

    await page.getByRole("button", { name: "Next", exact: true }).click();
    await expect(page.getByTestId("manifest-row")).toHaveCount(0); // review step
    await page.getByRole("button", { name: "Save draft" }).click();
    await expect(page).toHaveURL(/\/business\/requests\/[0-9a-f-]{36}$/);

    // ── the orders are now in JR (a draft's parcels count), linked to the request ──
    await gotoReady(page, `/business/integrations/orders?connectionId=${conn.id}&state=in_jr`);
    await expect(rows).toHaveCount(2);
    for (const r of REFS) {
      const row = rows.filter({ hasText: r });
      await expect(row.getByTestId("order-state")).toHaveText("In JR");
      await expect(row.getByTestId("order-request-link")).toBeVisible();
    }
    await gotoReady(page, `/business/integrations/orders?connectionId=${conn.id}`);
    await expect(rows).toHaveCount(0);
    await expect(page.getByText("No orders under “Open”")).toBeVisible();

    // ── one more order: set aside (the partner is not told), then restored from its page ──
    await push([order(LATER, 3)]);
    await page.reload(); await page.waitForSelector('html[data-hydrated="true"]');
    await expect(rows).toHaveCount(1);
    await rows.first().getByTestId("order-pick").check();
    await page.getByTestId("orders-dismiss").click();
    await expect(page.getByTestId("dismiss-warning")).toContainText("The order stays open in");
    await page.getByTestId("dismiss-reason").fill("Customer collects in store");
    await page.getByTestId("dismiss-confirm").click();
    await expect(page.getByText("Orders set aside: 1")).toBeVisible();
    await expect(rows).toHaveCount(0);

    await page.getByRole("group", { name: "Order state" }).getByRole("button", { name: /^Cancelled/ }).click();
    await expect(page).toHaveURL(/state=cancelled/);
    await expect(rows).toHaveCount(1);
    await expect(rows.first().getByTestId("order-state")).toHaveText("Cancelled");
    await rows.first().getByRole("link", { name: LATER, exact: true }).click();
    await expect(page).toHaveURL(/\/business\/integrations\/orders\/[0-9a-f-]{36}$/);
    await expect(page.getByRole("heading", { level: 1, name: LATER })).toBeVisible();
    await expect(page.getByTestId("order-set-aside")).toContainText("Customer collects in store");
    await expect(page.getByTestId("order-timeline")).toContainText("Set aside");
    await expect(page.getByText("Recipient & address")).toBeVisible();
    await page.getByTestId("order-restore").click();
    await expect(page.getByText("Orders restored: 1")).toBeVisible();
    await expect(page.getByTestId("order-state").first()).toHaveText("Open");
    await expect(page.getByTestId("order-dismiss")).toBeVisible();
    await expect(page.getByTestId("order-create")).toBeVisible();

    await page.getByRole("link", { name: "Incoming orders" }).last().click();
    await expect(page).toHaveURL(/\/business\/integrations\/orders(\?|$)/);
  } finally {
    // Its incoming orders go with it; the draft keeps its parcels (unlinked).
    await api(page, "DELETE", `/integrations/connections/${conn.id}`);
  }
});
