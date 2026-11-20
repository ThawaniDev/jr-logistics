import { test, expect } from "@playwright/test";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { otpLogin, gotoReady, DEMO } from "./helpers";

/**
 * Business-side warehouse-system integration: connect LogesTech (pointed at a stub this spec starts), test it, import a barcode in the
 * request wizard, see the flagged row, finish the details, then delete the connection.
 *
 * ASSUMPTION (needs a one-line server/config change that this spec cannot make): the app under test runs `next start`, i.e. NODE_ENV=production,
 * where partner URLs must be https and may not point at private/loopback addresses (resolveWebhookTarget in src/server/integrations.ts).
 * The stub is plain http on 127.0.0.1, so the e2e server must be told to allow it (see the report: PARTNER_ALLOW_LOCAL in playwright.config.ts + resolveWebhookTarget).
 * Without it the "create connection" step fails with an explicit message below instead of timing out.
 */

const KEY = "psk_integration_e2e_key_0123456789";
const BARCODE = "6001234567";

let stub: http.Server; let base = ""; const seen: Array<{ path: string; query: string; key: string | undefined }> = [];
test.beforeAll(async () => {
  stub = http.createServer((req, res) => {
    const u = new URL(req.url!, "http://stub");
    seen.push({ path: u.pathname, query: u.search, key: req.headers["x-api-key"] as string | undefined });
    const send = (status: number, body: unknown) => { res.writeHead(status, { "content-type": "application/json" }); res.end(JSON.stringify(body)); };
    if (req.headers["x-api-key"] !== KEY) return send(401, { message: "bad key" });
    if (req.method === "GET" && u.pathname === "/api/secure/integration/address/cities") return send(200, [{ id: 1, name: "Riyadh" }, { id: 2, name: "Jeddah" }]);
    if (req.method === "GET" && u.pathname === "/api/secure/integration/packages/status") {
      const barcode = u.searchParams.get("barcode");
      if (barcode === BARCODE) return send(200, { barcode, receiverName: "Test", receiverPhone: "0555123456", statusKey: "READY" }); // no address on purpose: the row must be flagged
      return send(404, { message: "not found" });
    }
    return send(404, {});
  });
  await new Promise<void>((ok) => stub.listen(0, "127.0.0.1", ok));
  base = `http://127.0.0.1:${(stub.address() as AddressInfo).port}/api`;
});
test.afterAll(() => new Promise<void>((ok) => stub.close(() => ok())));

test.describe.configure({ mode: "serial" });

test("connect LogesTech, test it, import a barcode into a request, complete the flagged row, delete the connection", async ({ page }) => {
  test.setTimeout(120_000);
  await otpLogin(page, DEMO.business);

  // ── Integrations page: empty state → add flow ──
  await gotoReady(page, "/business/integrations");
  await expect(page.getByRole("heading", { level: 1, name: "Integrations" })).toBeVisible();
  await expect(page.getByText("What each system can and cannot do")).toBeVisible();
  await expect(page.getByText(/cannot give JR a list of your packages/)).toBeVisible(); // honest LogesTech limits box
  await page.getByTestId("add-connection").click();
  await page.getByTestId("provider-logestechs").click();
  // The form is generated from the provider's field list: password input for the secret, url input for the address.
  // Fields the provider marks `advanced` (the API address, the time zone) sit under a collapsed "Advanced" group.
  await expect(page.getByTestId("field-apiKey")).toHaveAttribute("type", "password");
  await expect(page.getByTestId("field-baseUrl")).toHaveCount(0);
  await page.getByTestId("advanced-toggle").click();
  await expect(page.getByTestId("field-baseUrl")).toHaveAttribute("type", "url");
  await page.getByTestId("conn-name").fill("E2E LogesTech");
  await page.getByTestId("create-connection").click();
  await expect(page.getByText("This field is required").first()).toBeVisible(); // API key is required
  await page.getByTestId("field-apiKey").fill(KEY);
  await page.getByTestId("field-baseUrl").fill(base);
  await page.getByTestId("create-connection").click();

  const fresh = page.getByTestId("fresh-token");
  const refused = page.getByText(/This address cannot be used/);
  await expect(fresh.or(refused)).toBeVisible();
  if (await refused.isVisible()) throw new Error("The server refused the http://127.0.0.1 stub. The e2e server must allow local partner URLs (see the header of this spec).");

  // One-time token panel: warning, automatic connect for providers that support it, manual instructions otherwise.
  await expect(fresh.getByText("You will not see this token again")).toBeVisible();
  await expect(fresh.getByTestId("connect-auto")).toBeVisible();
  await fresh.getByText("Set it up manually instead").click();
  await expect(fresh.getByTestId("inbound-token")).toContainText(/^jrh_/);
  await expect(fresh.getByTestId("webhook-url")).toContainText("/api/v1/integrations/hooks/");
  await expect(fresh.getByText("x-api-key")).toBeVisible(); // header names listed for the partner portal
  await fresh.getByTestId("token-saved").click();
  await expect(fresh).toHaveCount(0);

  // ── card: health + test connection ──
  const card = page.getByTestId("connection-card").filter({ hasText: "E2E LogesTech" });
  await expect(card).toBeVisible();
  await expect(card.getByText("Not tested yet")).toBeVisible();
  await card.getByTestId("card-test").click();
  await expect(card.getByTestId("test-result")).toContainText("accepted the key");
  expect(seen.some((s) => s.path === "/api/secure/integration/address/cities" && s.key === KEY)).toBe(true);
  await expect(card.getByText(/Working\. Last successful check/)).toBeVisible();

  // ── request wizard: import by barcode ──
  await page.getByRole("link", { name: "New request" }).first().click();
  await page.getByRole("button", { name: /Delivery driver/ }).click();
  await page.getByLabel(/^Vehicle/).selectOption("sedan");
  await page.getByRole("button", { name: "Next", exact: true }).click();
  await page.getByLabel(/Pickup address/).fill("Olaya St, Riyadh");
  const d = new Date(Date.now() + 2 * 864e5 + 3 * 3600e3).toISOString().slice(0, 11) + "09:00";
  await page.getByLabel(/Start date/).fill(d);
  await page.getByRole("button", { name: "Next", exact: true }).click();

  await page.getByRole("button", { name: "Import from E2E LogesTech" }).click();
  await page.getByTestId("import-ids").fill(`${BARCODE}\nNOPE-404`);
  await page.getByRole("button", { name: /Look up parcels/ }).click();
  await expect(page.getByTestId("import-result-ready")).toHaveCount(1);
  await expect(page.getByTestId("import-result-ready")).toContainText(BARCODE);
  await expect(page.getByTestId("import-result-ready")).toContainText("Complete after adding"); // address was not returned: never guessed
  await expect(page.getByTestId("import-result-missing")).toContainText("NOPE-404"); // not silently dropped
  expect(seen.some((s) => s.path === "/api/secure/integration/packages/status" && s.query.includes(`barcode=${BARCODE}`))).toBe(true);
  await page.getByTestId("import-add").click();

  // The imported row: provider badge, prefilled recipient, externalRef = barcode, visibly flagged until the address is filled.
  const row = page.getByTestId("manifest-row");
  await expect(row).toHaveCount(1);
  await expect(row.getByTestId("partner-origin")).toContainText("E2E LogesTech");
  await expect(row.getByText("Complete these details")).toBeVisible();
  await expect(row.getByLabel(/^Recipient name/)).toHaveValue("Test");
  await expect(row.getByLabel(/^Order reference/)).toHaveValue(BARCODE);
  await expect(page.getByText("Imported parcels that need details: 1")).toBeVisible();

  // Blocked until completed.
  await page.getByRole("button", { name: "Next", exact: true }).click();
  await expect(page.getByTestId("manifest-row")).toHaveCount(1); // still on the shipments step
  await row.getByLabel(/^Delivery address/).fill("King Fahd Rd 120, Riyadh");
  await expect(row.getByText("Complete these details")).toHaveCount(0);
  await page.getByRole("button", { name: "Next", exact: true }).click();
  await expect(page.getByTestId("manifest-row")).toHaveCount(0); // moved on to the review step

  // ── delete the connection (parcels stay) ──
  await gotoReady(page, "/business/integrations");
  await page.getByTestId("connection-card").filter({ hasText: "E2E LogesTech" }).getByTestId("manage-connection").click();
  await expect(page.getByRole("heading", { level: 1, name: "E2E LogesTech" })).toBeVisible();
  await expect(page).toHaveURL(/\/business\/integrations\/[0-9a-f-]{36}$/); // a connection is its own page; setup / activity are routes under it
  const sections = page.getByRole("navigation", { name: "Connection sections" });
  await expect(sections.getByRole("link", { name: "Setup" })).toHaveAttribute("aria-current", "page");
  await sections.getByRole("link", { name: "Activity" }).click();
  await expect(page).toHaveURL(/\/activity$/);
  await sections.getByRole("link", { name: "Setup" }).click();
  await page.getByTestId("delete-connection").click();
  await expect(page.getByText(/Your parcels and requests stay exactly as they are/)).toBeVisible();
  await page.getByTestId("confirm-delete").click();
  await expect(page.getByTestId("connection-card").filter({ hasText: "E2E LogesTech" })).toHaveCount(0);
});
