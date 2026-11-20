import { expect, request as pwRequest, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";

/** Navigate and wait until React has hydrated (a click before that would trigger a native form reload). */
export async function gotoReady(page: Page, url: string) {
  await page.goto(url);
  await page.waitForSelector('html[data-hydrated="true"]');
}

// ── session reuse ─────────────────────────────────────────────────────────────────────────────────────────
// Everybody signs in with a username + password (`/login`). The server rate-limits sign-ins per address + username (10 / 15 min outside demo mode; the e2e server runs in
// demo mode, which is far roomier) and a full run signs in far more often than a person would. So the first sign-in of an account in a run is real (the login screens are
// exercised), later ones restore its cookies from disk. A restored session that the server no longer accepts (the test signed out, changed the password …) silently falls
// back to a real sign-in. `e2e/.auth` is wiped by global-setup at the start of every run, together with the database.
const BASE = `http://localhost:${process.env.E2E_PORT ?? 3101}`; // not 3100: other projects on this machine use it
const AUTH_DIR = "e2e/.auth";
const fileFor = (id: string) => `${AUTH_DIR}/${id.replace(/[^a-z0-9]+/gi, "_")}.json`;
const HOME = (role: string) => (role === "admin" || role === "staff" ? "/admin" : `/${role}`);

// ── who signs in with what ────────────────────────────────────────────────────────────────────────────────
// The helpers keep taking a PHONE NUMBER (otpLogin / apiLogin) or an e-mail (staffLogin), as the specs always did, and resolve the username + password themselves:
//  1. the demo accounts (global-setup seeds them): `demo.business`, `demo.driver` … with the published demo password;
//  2. accounts a spec taught us with `rememberLogin(phone, username, password)` (kept in e2e/.auth, so it survives from one spec file to the next);
//  3. the default of every account made without choosing: username `u` + the digits of the phone, password `Test#Pass2026` (what the registration and create-account specs use);
//  4. anything else (an account staff created through the API without a password): the admin resets its password and the helper replaces the temporary one.
export const DEMO_PASSWORD = "Demo#Pass2026";
export const TEST_PASSWORD = "Test#Pass2026";
const DEMO_USERNAMES: Record<string, string> = {
  "966500000001": "demo.business", "966500000002": "demo.office", "966500000011": "demo.driver", "966500000012": "demo.driver2", "966500000013": "demo.driver3",
  "966500000014": "demo.driver4", "966500000015": "demo.driver5", "966500000016": "demo.driver6",
};
const E2E_ADMIN = { username: "admin@jrlogistics.test", password: "E2e!Password2026" };
/** `0501234567` / `+966501234567` / `966501234567` → `966501234567`. */
export const phoneDigits = (phone: string) => { const d = phone.replace(/\D/g, ""); return /^05\d{8}$/.test(d) ? `966${d.slice(1)}` : /^5\d{8}$/.test(d) ? `966${d}` : d; };
export const defaultUsername = (phone: string) => `u${phoneDigits(phone)}`;
type Creds = { username: string; password: string };
const CREDS_FILE = `${AUTH_DIR}/_creds.json`;
const readCreds = (): Record<string, Creds> => { try { return JSON.parse(readFileSync(CREDS_FILE, "utf8")); } catch { return {}; } };
/** Teach the helpers the username + password of an account a spec created (by phone number), so `otpLogin(page, phone)` / `apiLogin(browser, phone)` can sign in as it. */
export function rememberLogin(phone: string, username: string, password: string) {
  mkdirSync(AUTH_DIR, { recursive: true });
  writeFileSync(CREDS_FILE, JSON.stringify({ ...readCreds(), [phoneDigits(phone)]: { username, password } }));
}

async function tryApiLogin(api: Awaited<ReturnType<typeof pwRequest.newContext>>, c: Creds) {
  const r = await api.post(`${BASE}/api/v1/auth/login`, { data: { username: c.username, password: c.password }, headers: { "x-client": "mobile" } }); // "mobile": a bearer token, no cookie / origin rules
  return r.status() === 200 ? ((await r.json()) as { token: string; user: { mustChangePassword?: boolean } }) : null;
}
/** The username + password to sign in as the account with this phone number (see the list above). */
async function credsFor(phone: string): Promise<Creds> {
  const d = phoneDigits(phone);
  if (DEMO_USERNAMES[d]) return { username: DEMO_USERNAMES[d], password: DEMO_PASSWORD };
  const saved = readCreds()[d]; if (saved) return saved;
  const api = await pwRequest.newContext();
  try {
    const guess = { username: defaultUsername(phone), password: TEST_PASSWORD };
    if (await tryApiLogin(api, guess)) return guess;
    // not a default account: the admin finds it and sets a password the helper then makes its own
    const admin = await tryApiLogin(api, E2E_ADMIN);
    expect(admin, "the e2e admin can sign in").toBeTruthy();
    const auth = { authorization: `Bearer ${admin!.token}` };
    const found = await (await api.get(`${BASE}/api/v1/admin/users?q=${d}&pageSize=5`, { headers: auth })).json();
    const u = (found.items ?? []).find((x: { phone: string | null }) => x.phone && x.phone.replace(/\D/g, "") === d);
    expect(u, `an account with phone ${phone} exists`).toBeTruthy();
    const tmp = `Tmp#${Date.now()}aZ`;
    const reset = await api.post(`${BASE}/api/v1/admin/users/${u.id}/reset-password`, { data: { password: tmp }, headers: auth });
    expect(reset.status(), "reset the password").toBe(200);
    const username = (await reset.json()).username as string;
    const first = await tryApiLogin(api, { username, password: tmp });
    const change = await api.post(`${BASE}/api/v1/auth/change-password`, { data: { currentPassword: tmp, newPassword: TEST_PASSWORD }, headers: { authorization: `Bearer ${first!.token}` } });
    expect(change.status(), "replace the temporary password").toBe(200);
    rememberLogin(phone, username, TEST_PASSWORD);
    return { username, password: TEST_PASSWORD };
  } finally { await api.dispose(); }
}

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

/** Types a username and password into the sign-in card and submits (no expectations — for specs that test the screen itself). */
export async function uiSignIn(page: Page, username: string, password: string) {
  await gotoReady(page, "/login");
  await page.getByTestId("login-username").fill(username);
  await page.getByTestId("login-password").fill(password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
}

/** Signs a customer account in through the real sign-in screen (username + password), as the person with this phone number. Name kept from the days of one-time codes. */
export async function otpLogin(page: Page, phone: string, opts: { fresh?: boolean } = {}) {
  if (!opts.fresh && (await restoreSession(page, phone))) return;
  const c = await credsFor(phone);
  await uiSignIn(page, c.username, c.password);
  await page.waitForURL(/\/(business|driver|office|admin)/);
  await saveSession(page, phone);
}
/** Signs a staff member / administrator in (e-mail address and password — the sign-in box takes either a username or an e-mail). */
export async function staffLogin(page: Page, email: string, password: string, opts: { fresh?: boolean } = {}) {
  if (!opts.fresh && (await restoreSession(page, email))) { await expect(page).toHaveURL(/\/admin/); return; }
  await uiSignIn(page, email, password);
  await expect(page).toHaveURL(/\/admin/);
  await saveSession(page, email);
}
/** A browser context signed in as the person with this `phone` through the sign-in API (no UI); reuses the saved session of an earlier sign-in in this run. `o` are extra context options (geolocation …). */
export async function apiLogin(browser: Browser, phone: string, o: Parameters<Browser["newContext"]>[0] = {}): Promise<BrowserContext> {
  const ctx = await browser.newContext(o);
  const f = fileFor(phone);
  if (existsSync(f)) {
    try { await ctx.addCookies(JSON.parse(readFileSync(f, "utf8"))); if ((await ctx.request.get(`${BASE}/api/v1/auth/me`)).ok()) return ctx; } catch { /* fall through to a real sign-in */ }
    await ctx.clearCookies();
  }
  const c = await credsFor(phone);
  const res = await ctx.request.fetch(`${BASE}/api/v1/auth/login`, { method: "POST", data: { username: c.username, password: c.password }, headers: { origin: BASE, "content-type": "application/json" } });
  expect(res.status(), `sign in as ${c.username}`).toBe(200);
  mkdirSync(AUTH_DIR, { recursive: true });
  writeFileSync(f, JSON.stringify(await ctx.cookies()));
  return ctx;
}
export const DEMO = { business: "0500000001", driver: "0500000011", office: "0500000002", staffPw: "Demo#Pass2026" };
