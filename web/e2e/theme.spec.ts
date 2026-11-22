import { test, expect, type Page } from "@playwright/test";
import { gotoReady, otpLogin, staffLogin, DEMO } from "./helpers";

/**
 * Light / dark / system (L1). The server paints `<html data-theme>` from the `jr_theme` cookie (no flash), `system` is a CSS media query on the OS setting,
 * the Theme menu (top bar, public header) and the Appearance card (profile) change it, and the choice lives in a cookie + localStorage.
 * The suite runs with a dark OS (playwright.config `colorScheme: "dark"`, i.e. exactly what every other spec has always seen); light cases say so explicitly.
 */
const LIGHT_BG = "rgb(246, 248, 251)", DARK_BG = "rgb(11, 19, 43)";
const bodyBg = (page: Page) => page.evaluate(() => getComputedStyle(document.body).backgroundColor);
const theme = (page: Page) => page.evaluate(() => document.documentElement.getAttribute("data-theme"));
const colorScheme = (page: Page) => page.evaluate(() => getComputedStyle(document.documentElement).colorScheme);
const noSideScroll = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
const stored = (page: Page) => page.evaluate(() => localStorage.getItem("jr_theme"));
const cookie = async (page: Page) => (await page.context().cookies()).find((c) => c.name === "jr_theme")?.value;
async function pick(page: Page, mode: "system" | "light" | "dark") {
  await page.getByTestId("theme-menu").click();
  await page.getByTestId(`theme-${mode}`).click();
}
/** Collects hydration warnings and console errors (a theme-dependent attribute mismatch would show up here). */
function watch(page: Page): string[] {
  const bad: string[] = [];
  page.on("console", (m) => { if (m.type() === "error" || /hydrat/i.test(m.text())) bad.push(m.text().slice(0, 300)); });
  page.on("pageerror", (e) => bad.push(`pageerror ${e.message}`.slice(0, 300)));
  return bad;
}

test.describe("the server paints the theme (no flash)", () => {
  test("data-theme and the browser-chrome colour come from the cookie in the very first HTML", async ({ request }) => {
    const html = async (cookieHeader?: string) => (await request.get("/login", { headers: cookieHeader ? { cookie: cookieHeader } : {} })).text();
    const light = await html("jr_theme=light");
    expect(light).toMatch(/<html[^>]*data-theme="light"[^>]*data-theme-src="cookie"/);
    expect(light).toContain('<meta name="theme-color" content="#f6f8fb"/>');
    const dark = await html("jr_theme=dark");
    expect(dark).toMatch(/<html[^>]*data-theme="dark"/);
    expect(dark).toContain('<meta name="theme-color" content="#0b132b"/>');
    for (const c of [undefined, "jr_theme=banana", "jr_theme="]) { // nothing / garbage: the default, which follows the OS
      const sys = await html(c);
      expect(sys).toMatch(/<html[^>]*data-theme="system"[^>]*data-theme-src="default"/);
      expect(sys).toContain('media="(prefers-color-scheme: light)"');
      expect(sys).toContain('media="(prefers-color-scheme: dark)"');
    }
  });

  test("a stored choice repairs a missing cookie before the first paint", async ({ page }) => {
    await gotoReady(page, "/login");
    await page.evaluate(() => localStorage.setItem("jr_theme", "light"));
    await page.context().clearCookies({ name: "jr_theme" });
    await page.goto("/login");
    expect(await theme(page)).toBe("light"); // set by the head script, not by React
    await page.waitForSelector('html[data-hydrated="true"]');
    await expect.poll(() => cookie(page)).toBe("light"); // and the cookie is written back so the server agrees next time
    expect(await bodyBg(page)).toBe(LIGHT_BG);
  });
});

test.describe("system follows the OS", () => {
  test("default is system: a light OS gets light, a dark OS gets dark, and it flips live", async ({ page }) => {
    await page.emulateMedia({ colorScheme: "light" });
    await gotoReady(page, "/login");
    expect(await theme(page)).toBe("system");
    expect(await bodyBg(page)).toBe(LIGHT_BG);
    expect(await colorScheme(page)).toBe("light");
    await page.emulateMedia({ colorScheme: "dark" });
    await expect.poll(() => bodyBg(page)).toBe(DARK_BG);
    expect(await colorScheme(page)).toBe("dark");
    await page.emulateMedia({ colorScheme: "light" });
    await expect.poll(() => bodyBg(page)).toBe(LIGHT_BG);
  });

  test("an explicit choice ignores the OS", async ({ page }) => {
    await page.emulateMedia({ colorScheme: "light" });
    await gotoReady(page, "/login");
    await pick(page, "dark");
    expect(await bodyBg(page)).toBe(DARK_BG);
    await page.emulateMedia({ colorScheme: "dark" });
    await pick(page, "light");
    expect(await bodyBg(page)).toBe(LIGHT_BG);
  });
});

test.describe("the Theme menu", () => {
  test("public header: pick Light, it persists across reload and navigation; pick System to go back", async ({ page }) => {
    const bad = watch(page);
    await gotoReady(page, "/login");
    expect(await bodyBg(page)).toBe(DARK_BG);
    const btn = page.getByTestId("theme-menu");
    await expect(btn).toHaveAttribute("aria-label", "Theme: System");
    await pick(page, "light");
    expect(await theme(page)).toBe("light");
    expect(await bodyBg(page)).toBe(LIGHT_BG);
    expect(await stored(page)).toBe("light");
    expect(await cookie(page)).toBe("light");
    await expect(btn).toHaveAttribute("aria-label", "Theme: Light");
    await page.reload(); await page.waitForSelector('html[data-hydrated="true"]');
    expect(await theme(page)).toBe("light");
    expect(await bodyBg(page)).toBe(LIGHT_BG);
    await gotoReady(page, "/register");
    expect(await theme(page)).toBe("light");
    await gotoReady(page, "/");
    expect(await theme(page)).toBe("light");
    expect(await noSideScroll(page)).toBe(true);
    await pick(page, "system");
    expect(await theme(page)).toBe("system");
    expect(await bodyBg(page)).toBe(DARK_BG); // the OS is dark
    expect(await cookie(page)).toBe("system");
    expect(bad, bad.join("\n")).toEqual([]);
  });

  test("a radio-style menu: three items, the current one checked, arrow keys and Escape work", async ({ page }) => {
    await gotoReady(page, "/login");
    const btn = page.getByTestId("theme-menu");
    await btn.focus(); await page.keyboard.press("Enter");
    await expect(page.getByRole("menu", { name: "Theme" })).toBeVisible();
    const items = page.getByRole("menuitemradio");
    await expect(items).toHaveCount(3);
    await expect(items.nth(0)).toHaveAttribute("aria-checked", "true"); // System
    await expect(items.nth(0)).toBeFocused();
    await page.keyboard.press("ArrowDown"); await expect(items.nth(1)).toBeFocused(); // Light
    await page.keyboard.press("Enter");
    await expect(page.getByRole("menu")).toHaveCount(0);
    await expect(btn).toBeFocused();
    expect(await theme(page)).toBe("light");
    await btn.click(); await expect(items.nth(1)).toHaveAttribute("aria-checked", "true");
    await page.keyboard.press("Escape");
    await expect(page.getByRole("menu")).toHaveCount(0); await expect(btn).toBeFocused();
    await btn.click(); await page.mouse.click(5, 300); // outside click closes too
    await expect(page.getByRole("menu")).toHaveCount(0);
  });

  test("Arabic: the menu reads in Arabic and opens inside the screen", async ({ page }) => {
    await page.context().addCookies([{ name: "jr_lang", value: "ar", url: `http://localhost:${process.env.E2E_PORT ?? 3101}` }]);
    await gotoReady(page, "/login");
    await page.getByTestId("theme-menu").click();
    await expect(page.getByTestId("theme-light")).toContainText("فاتح");
    const box = await page.getByRole("menu").boundingBox();
    expect(box && box.x >= 0 && box.x + box.width <= page.viewportSize()!.width).toBe(true);
  });

  test("no hydration warnings or console errors in either theme on the public pages", async ({ page }) => {
    for (const mode of ["light", "dark", "system"]) {
      await page.context().clearCookies();
      await page.context().addCookies([{ name: "jr_theme", value: mode, url: `http://localhost:${process.env.E2E_PORT ?? 3101}` }]);
      const bad = watch(page);
      for (const path of ["/", "/login", "/register", "/track"]) { await gotoReady(page, path); expect(await theme(page)).toBe(mode); }
      expect(bad, `${mode}: ${bad.join("\n")}`).toEqual([]);
      page.removeAllListeners("console"); page.removeAllListeners("pageerror");
    }
  });
});

test.describe("signed in", () => {
  test.use({ colorScheme: "light" });

  test("business: top-bar menu + Appearance card on the profile; the choice follows every page and survives a reload", async ({ page }) => {
    const bad = watch(page);
    await otpLogin(page, DEMO.business);
    await gotoReady(page, "/business");
    expect(await theme(page)).toBe("system");
    expect(await bodyBg(page)).toBe(LIGHT_BG);
    await expect(page.getByTestId("theme-menu")).toBeVisible();
    await gotoReady(page, "/business/profile");
    const card = page.getByTestId("theme-choice");
    await expect(card.getByRole("radiogroup", { name: "Appearance" })).toBeVisible();
    await expect(card.getByRole("radio", { name: "System" })).toHaveAttribute("aria-checked", "true");
    await card.getByRole("radio", { name: "Dark" }).click();
    await expect(card.getByRole("radio", { name: "Dark" })).toHaveAttribute("aria-checked", "true");
    expect(await bodyBg(page)).toBe(DARK_BG);
    await expect(page.getByTestId("theme-menu")).toHaveAttribute("aria-label", "Theme: Dark"); // the top bar follows
    await page.reload(); await page.waitForSelector('html[data-hydrated="true"]');
    expect(await theme(page)).toBe("dark");
    await page.getByRole("navigation", { name: "Main navigation" }).first().locator('a[href="/business/requests"]').click();
    await expect(page).toHaveURL(/\/business\/requests/);
    expect(await theme(page)).toBe("dark");
    expect(await bodyBg(page)).toBe(DARK_BG);
    await pick(page, "light");
    expect(await bodyBg(page)).toBe(LIGHT_BG);
    expect(bad, bad.join("\n")).toEqual([]);
  });

  test("the theme also restyles dialogs: the modal backdrop is a light scrim in light and the dark one in dark", async ({ page }) => {
    await otpLogin(page, DEMO.business);
    await gotoReady(page, "/business");
    const backdrop = async () => {
      await page.getByTestId("jump-open").first().click();
      const c = await page.evaluate(() => getComputedStyle(document.querySelector("dialog.jr-modal[open]")!, "::backdrop").backgroundColor);
      await page.keyboard.press("Escape");
      return (c.match(/[\d.]+/g) ?? []).map(Number);
    };
    expect((await backdrop()).slice(0, 3)).toEqual([15, 23, 42]);
    await pick(page, "dark");
    expect((await backdrop()).slice(0, 3)).toEqual([5, 10, 25]);
  });

  test("light pages fit the screen at desktop and phone width (business and admin)", async ({ page, browser }) => {
    await otpLogin(page, DEMO.business);
    const pages = ["/business", "/business/requests", "/business/wallet", "/business/profile"];
    for (const w of [1360, 390]) {
      await page.setViewportSize({ width: w, height: 900 });
      for (const p of pages) { await gotoReady(page, p); expect(await bodyBg(page), p).toBe(LIGHT_BG); expect(await noSideScroll(page), `${p} @${w}`).toBe(true); }
    }
    const ctx = await browser.newContext({ colorScheme: "light", viewport: { width: 390, height: 844 } });
    const admin = await ctx.newPage();
    await staffLogin(admin, "admin@jrlogistics.test", "E2e!Password2026");
    for (const p of ["/admin", "/admin/finance", "/admin/reports"]) { await gotoReady(admin, p); expect(await noSideScroll(admin), `${p} @390`).toBe(true); }
    await ctx.close();
  });
});

test.describe("print is always light paper", () => {
  test("a dark-theme visitor's printout uses the light tokens (dark text on white)", async ({ page }) => {
    await page.context().addCookies([{ name: "jr_theme", value: "dark", url: `http://localhost:${process.env.E2E_PORT ?? 3101}` }]);
    await gotoReady(page, "/login");
    expect(await bodyBg(page)).toBe(DARK_BG);
    await page.emulateMedia({ media: "print" });
    expect(await bodyBg(page)).toBe(LIGHT_BG);
    expect(await page.evaluate(() => getComputedStyle(document.body).color)).toBe("rgb(15, 23, 42)");
    expect(await colorScheme(page)).toBe("light");
  });
});
