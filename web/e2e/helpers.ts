import { expect, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";

/** Navigate and wait until React has hydrated (a click before that would trigger a native form reload). */
export async function gotoReady(page: Page, url: string) {
  await page.goto(url);
  await page.waitForSelector('html[data-hydrated="true"]');
}

// ── session reuse ─────────────────────────────────────────────────────────────────────────────────────────
// The server rate-limits sign-ins (staff: 10 per 15 min per email; OTP codes: 20 per 10 min per IP) and a full run signs in far more often than that.
// So the first sign-in of an account in a run is real (the login screens are exercised), later ones restore its cookies from disk. A restored session
// that the server no longer accepts (the test signed out, changed the password …) silently falls back to a real sign-in.
// `e2e/.auth` is wiped by global-setup at the start of every run, together with the database.
const BASE = "http://localhost:3100";
const AUTH_DIR = "e2e/.auth";
const fileFor = (id: string) => `${AUTH_DIR}/${id.replace(/[^a-z0-9]+/gi, "_")}.json`;
const HOME = (role: string) => (role === "admin" || role === "staff" ? "/admin" : `/${role}`);

async function restoreSession(page: Page, id: string): Promise<boolean> {
  const f = fileFor(id);
  if (!existsSync(f)) return false;
  try {
    await page.context().addCookies(JSON.parse(readFileSync(f, "utf8")));
    const me = await page.request.get(`${BASE}/api/v1/auth/me`);
    if (!me.ok()) { await page.context().clearCookies(); return false; }
    const role = (await me.json()).user?.role as string;
    await gotoReady(page, HOME(role));
    return true;
  } catch { await page.context().clearCookies().catch(() => {}); return false; }
}
async function saveSession(page: Page, id: string) {
  mkdirSync(AUTH_DIR, { recursive: true });
  writeFileSync(fileFor(id), JSON.stringify(await page.context().cookies()));
}

export async function otpLogin(page: Page, phone: string, opts: { fresh?: boolean } = {}) {
  if (!opts.fresh && (await restoreSession(page, phone))) return;
  await gotoReady(page, "/login");
  await page.getByLabel("Mobile number").fill(phone);
  await page.getByRole("button", { name: "Send code" }).click();
  const code = (await page.locator(".ltr-num.text-lg").textContent())!.trim();
  await page.getByLabel("Verification code").fill(code);
  await page.getByRole("button", { name: "Verify & continue" }).click();
  await page.waitForURL(/\/(business|driver|office|register|admin)/);
  await saveSession(page, phone);
}
export async function staffLogin(page: Page, email: string, password: string, opts: { fresh?: boolean } = {}) {
  if (!opts.fresh && (await restoreSession(page, email))) { await expect(page).toHaveURL(/\/admin/); return; }
  await gotoReady(page, "/staff/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/admin/);
  await saveSession(page, email);
}
/** A browser context signed in as `phone` through the OTP API (no UI); reuses the saved session of an earlier sign-in in this run. `o` are extra context options (geolocation …). */
export async function apiLogin(browser: Browser, phone: string, o: Parameters<Browser["newContext"]>[0] = {}): Promise<BrowserContext> {
  const ctx = await browser.newContext(o);
  const f = fileFor(phone);
  if (existsSync(f)) {
    try { await ctx.addCookies(JSON.parse(readFileSync(f, "utf8"))); if ((await ctx.request.get(`${BASE}/api/v1/auth/me`)).ok()) return ctx; } catch { /* fall through to a real sign-in */ }
    await ctx.clearCookies();
  }
  const post = (path: string, data: unknown) => ctx.request.fetch(`${BASE}/api/v1${path}`, { method: "POST", data, headers: { origin: BASE, "content-type": "application/json" } });
  const send = await post("/auth/otp/send", { phone });
  expect(send.status(), "otp send").toBeLessThan(300);
  const code = (await send.json()).demoCode;
  const verify = await post("/auth/otp/verify", { phone, code });
  expect(verify.status(), "otp verify").toBe(200);
  mkdirSync(AUTH_DIR, { recursive: true });
  writeFileSync(f, JSON.stringify(await ctx.cookies()));
  return ctx;
}
export const DEMO = { business: "0500000001", driver: "0500000011", office: "0500000002", staffPw: "Demo#Pass2026" };
