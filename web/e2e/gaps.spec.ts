import { test, expect } from "@playwright/test";
import { createHmac } from "node:crypto";
import { otpLogin, staffLogin, gotoReady, uiSignIn, DEMO } from "./helpers";

/** Minimal RFC 6238 so the test plays the role of the authenticator app. */
function totp(b32: string, offset = 0) {
  const A = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567"; let bits = 0, v = 0; const bytes: number[] = [];
  for (const c of b32) { v = (v << 5) | A.indexOf(c); bits += 5; if (bits >= 8) { bytes.push((v >>> (bits - 8)) & 255); bits -= 8; } }
  const msg = Buffer.alloc(8); msg.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30000) + offset));
  const h = createHmac("sha1", Buffer.from(bytes)).update(msg).digest(); const o = h[h.length - 1] & 15;
  return String((((h[o] & 127) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3]) % 1_000_000).padStart(6, "0");
}

/** Browser coverage for the flows added after auditing the rebuild against the old system. */
test.describe.configure({ mode: "serial" });
const ADMIN = { email: "admin@jrlogistics.test", password: "E2e!Password2026" };

test("public terms and privacy pages render; footer links to them; calculator never invents a price", async ({ page }) => {
  await gotoReady(page, "/");
  await expect(page.getByRole("link", { name: "Terms" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Privacy" })).toBeVisible();
  // the calculator shows an approved rate ("From SAR …") or asks for a request — never a made-up total
  const total = page.locator("#estimate");
  await expect(total.getByText(/From|Create a request to get your price/).first()).toBeVisible();
  await expect(total).not.toContainText("Includes platform fee");
  await page.goto("/terms");
  await expect(page.getByRole("heading", { name: "Terms of use" })).toBeVisible();
  await expect(page.getByText(/Version/)).toBeVisible();
  await page.goto("/privacy");
  await expect(page.getByRole("heading", { name: "Privacy" })).toBeVisible();
  await expect(page.getByText(/pending legal review/)).toBeVisible();
});

test("a staff member with a temporary password is forced to change it before anything else", async ({ page, browser, baseURL }) => {
  // The super admin creates the staff member (their password is temporary by design).
  await staffLogin(page, ADMIN.email, ADMIN.password);
  const email = `temp${Date.now()}@jrlogistics.demo`;
  const made = await page.request.post("/api/v1/admin/staff", { headers: { origin: baseURL! }, data: { name: "Temp Staff", email, password: "Temp0rary!Pass1", staffRole: "support" } });
  expect(made.status()).toBe(201);

  const ctx = await browser.newContext(); const p = await ctx.newPage();
  await uiSignIn(p, email, "Temp0rary!Pass1"); // the e-mail address works in the username box
  await expect(p).toHaveURL(/\/account\/change-password/);
  await expect(p.getByRole("heading", { name: "Choose a new password" })).toBeVisible();
  // the API itself refuses everything else
  const blocked = await p.request.get("/api/v1/admin/stats");
  expect(blocked.status()).toBe(403);
  expect((await blocked.json()).error.code).toBe("PASSWORD_CHANGE_REQUIRED");
  // a direct visit to the console bounces back to the change screen
  await p.goto("/admin");
  await expect(p).toHaveURL(/\/account\/change-password/);
  await p.getByTestId("cp-current").fill("Temp0rary!Pass1");
  await p.getByTestId("cp-new").fill("Temp0rary!Pass1");
  await expect(p.getByText("must be different from the current one")).toBeVisible();
  await p.getByTestId("cp-new").fill("Brand-New-Pass9");
  await p.getByTestId("cp-confirm").fill("Different-Pass9");
  await expect(p.getByText("The passwords do not match")).toBeVisible();
  await expect(p.getByTestId("cp-submit")).toBeDisabled();
  await p.getByTestId("cp-confirm").fill("Brand-New-Pass9");
  await p.getByTestId("cp-submit").click();
  await expect(p).toHaveURL(/\/admin$/); // the session stays: no second sign-in needed
  expect((await p.request.get("/api/v1/admin/stats")).status()).toBe(200);
  await ctx.close();
  // the old password is gone, the new one works
  const again = await browser.newContext(); const p2 = await again.newPage();
  await uiSignIn(p2, email, "Temp0rary!Pass1");
  await expect(p2.getByTestId("login-error")).toBeVisible();
  await uiSignIn(p2, email, "Brand-New-Pass9");
  await expect(p2).toHaveURL(/\/admin$/);
  await again.close();
});

test("an expired or missing session lands on the one sign-in (the old staff address redirects there)", async ({ page }) => {
  await staffLogin(page, ADMIN.email, ADMIN.password);
  await page.context().clearCookies();
  await page.goto("/admin/staff");
  await expect(page).toHaveURL(/\/login/);
  await expect(page.getByTestId("login-username")).toBeVisible();
});

test("finance is a group of separate pages — overview, settlements, withdrawals, ledger, invoices, cash on delivery, pricing — and no payout batches any more", async ({ page }) => {
  await staffLogin(page, ADMIN.email, ADMIN.password);
  await gotoReady(page, "/admin/finance");
  await expect(page.getByRole("heading", { name: "Finance", exact: true })).toBeVisible();
  const nav = page.getByRole("navigation", { name: "Main navigation" });
  for (const href of ["/admin/finance", "/admin/finance/settlements", "/admin/finance/withdrawals", "/admin/finance/ledger", "/admin/finance/invoices", "/admin/finance/cod", "/admin/finance/pricing"]) await expect(nav.locator(`a[href="${href}"]`)).toBeVisible(); // (Overview also exists under Reports, so go by the link target)
  await expect(page.getByRole("tab")).toHaveCount(0); // no tab bar switching between functions any more
  await expect(page.getByText("Payout batches")).toHaveCount(0); // E18: payments are released automatically — no batches to run
  for (const [link, url, heading] of [["Settlements", /\/admin\/finance\/settlements$/, "Settlements"], ["Withdrawals", /\/admin\/finance\/withdrawals$/, "Withdrawals"], ["Wallet ledger", /\/admin\/finance\/ledger$/, "Wallet ledger"], ["Invoices", /\/admin\/finance\/invoices$/, "Invoices"]] as const) {
    await nav.getByRole("link", { name: link }).click();
    await expect(page).toHaveURL(url);
    await expect(page.getByRole("heading", { name: heading, exact: true })).toBeVisible();
    await expect(nav.getByRole("link", { name: link })).toHaveAttribute("aria-current", "page");
  }
  for (const [path, heading] of [["/admin/ratings", "Ratings"], ["/admin/cancellations", "Cancellations"]] as const) {
    await page.goto(path);
    await expect(page.getByRole("heading", { name: heading, exact: true })).toBeVisible();
  }
});

test("office sees reports, an enriched settlements list, scoped jobs and notifications", async ({ page }) => {
  await otpLogin(page, DEMO.office);
  await page.goto("/office/reports");
  await expect(page.getByRole("heading", { name: "Reports", exact: true })).toBeVisible();
  await page.goto("/office/settlements");
  await expect(page.getByRole("heading", { name: /Settlements/ })).toBeVisible();
  await page.goto("/office/jobs");
  await expect(page.getByRole("button", { name: /^Active/ })).toHaveAttribute("aria-pressed", "true"); // the jobs filter is a pill group now, not a tab bar
  await page.goto("/office/notifications"); // cards link to where the user can act (or stay informational)
  await expect(page.getByRole("heading", { name: "Notifications" })).toBeVisible();
});

test("staff two-step verification: password alone is not enough; a wrong code is refused; the right one signs in", async ({ browser, baseURL }) => {
  const email = "support@jrlogistics.demo", password = DEMO.staffPw, origin = { origin: baseURL! };
  // 1) the staff member turns it on (as they would from the screen) — here through the API to keep the test about the sign-in
  const setupCtx = await browser.newContext();
  expect((await setupCtx.request.post("/api/v1/auth/staff/login", { headers: origin, data: { email, password } })).status()).toBe(200);
  const secret = (await (await setupCtx.request.post("/api/v1/auth/mfa/setup", { headers: origin, data: {} })).json()).secret as string;
  const enabled = await setupCtx.request.post("/api/v1/auth/mfa/enable", { headers: origin, data: { code: totp(secret) } });
  expect(enabled.status()).toBe(200);
  const recovery = (await enabled.json()).recoveryCodes as string[];
  expect(recovery.length).toBe(8);
  await setupCtx.close();

  // 2) a fresh browser: password step → code step
  const ctx = await browser.newContext(); const p = await ctx.newPage();
  await uiSignIn(p, email, password);
  await expect(p.getByText("Enter the code from your authenticator app")).toBeVisible();
  expect((await p.request.get("/api/v1/auth/me")).status()).toBe(401); // no session yet
  await p.getByLabel("Code or recovery code").fill("000000");
  await p.getByRole("button", { name: "Sign in" }).click();
  await expect(p.locator("form p[role=alert]")).toBeVisible(); // our error line (Next also renders an empty route-announcer alert)
  await expect(p).toHaveURL(/\/login/);
  await p.getByLabel("Code or recovery code").fill(totp(secret, 1)); // the enrolment code's window is burned → next window
  await p.getByRole("button", { name: "Sign in" }).click();
  await expect(p).toHaveURL(/\/admin$/);
  expect((await p.request.get("/api/v1/auth/me")).status()).toBe(200);
  // leave the shared demo account as it was (other specs sign in as support@ with the password alone): turn the second step off with a recovery code
  expect((await p.request.post("/api/v1/auth/mfa/disable", { headers: origin, data: { password, code: recovery[0] } })).status()).toBe(200);
  await ctx.close();
});
