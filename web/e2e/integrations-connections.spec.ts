import { test, expect, type Page } from "@playwright/test";
import { otpLogin, staffLogin, gotoReady, DEMO } from "./helpers";

/**
 * Connection pages v2 (company portal + staff console share them):
 *  - the company adds an Omniful (carrier-mode) connection and sees JR's base URL, API key, client ID and client secret exactly once;
 *  - its Setup tab explains how Omniful reaches JR without showing the key again;
 *  - Sync & statuses: one JR event → Omniful status mapping is changed and saved, and survives a reload;
 *  - staff open /admin/integrations, open that connection (/admin/integrations/:id) and see the company and the changed mapping.
 * The connection is deleted at the end (the demo company is shared with other specs and may hold at most 5 connections).
 */
const BASE = `http://localhost:${process.env.E2E_PORT ?? 3101}`; // not 3100: other projects on this machine use it
const ADMIN = { email: "admin@jrlogistics.test", password: "E2e!Password2026" };
const NAME = `E2E Omniful ${Date.now().toString(36)}`;
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/;

test.describe.configure({ mode: "serial" });
let connId = ""; let apiKey = "";

const sections = (p: Page) => p.getByRole("navigation", { name: "Connection sections" });

test("company: add Omniful, see the credentials once, change one status mapping on Sync & statuses", async ({ page }) => {
  test.setTimeout(120_000);
  await otpLogin(page, DEMO.business);
  await gotoReady(page, "/business/integrations");
  await page.getByTestId("add-connection").click();

  // Systems are grouped by mode; Omniful is a carrier.
  await expect(page.getByTestId("provider-group-carrier").getByTestId("provider-omniful")).toBeVisible();
  await page.getByTestId("provider-omniful").click();
  await page.getByTestId("conn-name").fill(NAME);
  await page.getByTestId("create-connection").click();

  // Shown once: base URL, API key, client ID and client secret (the secret is the same value as the key).
  const fresh = page.getByTestId("fresh-token");
  await expect(fresh).toBeVisible();
  await expect(fresh.getByText("You will not see these credentials again")).toBeVisible();
  await expect(fresh.getByTestId("fresh-base-url")).toContainText("/api/v1/carriers/omniful");
  apiKey = ((await fresh.getByTestId("fresh-api-key").textContent()) ?? "").trim();
  expect(apiKey).toMatch(/^jrh_/);
  await expect(fresh.getByTestId("fresh-client-secret")).toHaveText(apiKey);
  connId = ((await fresh.getByTestId("fresh-client-id").textContent()) ?? "").trim();
  expect(connId).toMatch(UUID);
  await expect(fresh.getByTestId("carrier-auth-modes")).toContainText("access_token");
  await fresh.getByTestId("token-saved").click();
  await expect(fresh).toHaveCount(0);

  // The card: mode badge and the link to the connection's incoming orders.
  const card = page.getByTestId("connection-card").filter({ hasText: NAME });
  await expect(card.getByTestId("conn-mode")).toHaveText("Carrier");
  await expect(card.getByTestId("card-open-orders")).toHaveAttribute("href", `/business/integrations/orders?connectionId=${connId}`);
  await card.getByTestId("manage-connection").click();
  await expect(page).toHaveURL(new RegExp(`/business/integrations/${connId}$`));

  // Setup: how Omniful reaches JR. The key itself is never shown again.
  await expect(page.getByTestId("conn-mode-hint")).toContainText("JR reports every status back");
  const carrier = page.getByTestId("carrier-section");
  await expect(carrier.getByTestId("carrier-base-url")).toContainText("/api/v1/carriers/omniful");
  await expect(carrier.getByTestId("carrier-client-id")).toHaveText(connId);
  await expect(carrier.getByTestId("carrier-runtime")).toContainText("Not yet");
  await expect(page.getByText(apiKey)).toHaveCount(0);
  await expect(sections(page).getByRole("link", { name: /^Orders/ })).toHaveAttribute("href", `/business/integrations/orders?connectionId=${connId}`);

  // Sync & statuses: "Picked up" sends Omniful's documented default (dispatched) until changed.
  await sections(page).getByRole("link", { name: "Sync & statuses" }).click();
  await expect(page).toHaveURL(new RegExp(`/business/integrations/${connId}/sync$`));
  const select = page.getByTestId("status-out-picked_up");
  await expect(select).toHaveValue("__default");
  await expect(page.getByTestId("status-eff-picked_up")).toContainText("dispatched");
  await expect(page.getByTestId("save-outbound")).toBeDisabled();
  await select.selectOption("in_transit");
  await expect(page.getByTestId("status-eff-picked_up")).toContainText("in_transit");
  await expect(page.getByText("Unsaved changes")).toBeVisible();
  await page.getByTestId("save-outbound").click();
  await expect(page.getByText("Unsaved changes")).toHaveCount(0);
  await expect(page.getByTestId("save-outbound")).toBeDisabled();
  // Carrier partners always land in Incoming orders; the automatic-cancel switch moved here from Setup.
  await expect(page.getByTestId("import-always")).toBeVisible();
  await expect(page.getByTestId("set-autoCancel")).toBeVisible();
  await expect(page.getByTestId("set-sync-picked_up")).toHaveAttribute("aria-checked", "true");

  await gotoReady(page, `/business/integrations/${connId}/sync`);
  await expect(page.getByTestId("status-out-picked_up")).toHaveValue("in_transit");
  await expect(page.getByTestId("status-eff-picked_up")).toContainText("in_transit");
});

test("staff: open the connection from /admin/integrations and see the changed mapping", async ({ browser }) => {
  test.skip(!connId, "the company test did not create the connection");
  test.setTimeout(90_000);
  const ctx = await browser.newContext(); const ap = await ctx.newPage();
  await staffLogin(ap, ADMIN.email, ADMIN.password);
  await gotoReady(ap, `/admin/integrations?q=${encodeURIComponent(NAME)}`);
  await expect(ap.getByRole("heading", { level: 1, name: "Integrations" })).toBeVisible();
  await expect(ap.getByTestId("admin-add-connection")).toBeVisible();
  const row = ap.getByTestId(`rdb-int-row-${connId}`);
  await expect(row.getByTestId("conn-mode")).toHaveText("Carrier");
  await row.getByTestId(`int-open-${connId}`).click();
  await expect(ap).toHaveURL(new RegExp(`/admin/integrations/${connId}$`));
  await expect(ap.getByRole("heading", { level: 1, name: NAME })).toBeVisible();
  await expect(ap.getByTestId("conn-company")).toHaveAttribute("href", /^\/admin\/companies\/[0-9a-f-]{36}$/);
  await expect(ap.getByTestId("carrier-client-id")).toHaveText(connId);

  await sections(ap).getByRole("link", { name: "Sync & statuses" }).click();
  await expect(ap).toHaveURL(new RegExp(`/admin/integrations/${connId}/sync$`));
  await expect(ap.getByTestId("status-out-picked_up")).toHaveValue("in_transit");
  await expect(ap.getByTestId("status-eff-picked_up")).toContainText("in_transit");
  // The activity log filters by direction too.
  await sections(ap).getByRole("link", { name: "Activity" }).click();
  await expect(ap.getByRole("group", { name: "Direction" })).toBeVisible();
  await ctx.close();
});

test.afterAll(async ({ browser }) => {
  if (!connId) return;
  const ctx = await browser.newContext(); const p = await ctx.newPage();
  await otpLogin(p, DEMO.business);
  const res = await p.request.fetch(`${BASE}/api/v1/integrations/connections/${connId}`, { method: "DELETE", headers: { origin: BASE } });
  expect(res.status(), "delete the test connection").toBeLessThan(300);
  await ctx.close();
});
