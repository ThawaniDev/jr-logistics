import { test, expect, type Page } from "@playwright/test";
import { gotoReady, otpLogin, staffLogin, DEMO } from "./helpers";

/**
 * Light theme on a phone and on the real pages (L1): the top bar never overflows at 390 / 360 px with the longest wallet balance (language and theme live in the drawer there),
 * and the light palette leaves no low-contrast text on the main screens. The Theme menu itself is covered by theme.spec.ts.
 */
const theme = (page: Page) => page.evaluate(() => document.documentElement.getAttribute("data-theme"));
const noSideScroll = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);

test.describe("phones: the top bar never overflows", () => {
  const BASE = `http://localhost:${process.env.E2E_PORT ?? 3101}`;
  const ROLES: Array<[string, string, (page: Page) => Promise<void>]> = [
    ["business", "/business", (p) => otpLogin(p, DEMO.business)],
    ["driver", "/driver", (p) => otpLogin(p, DEMO.driver)],
    ["office", "/office", (p) => otpLogin(p, DEMO.office)],
    ["admin", "/admin", (p) => staffLogin(p, "admin@jrlogistics.test", "E2e!Password2026")],
  ];

  test("390 and 360 px, English and Arabic, with the longest wallet balance: no sideways scroll, the bell stays on screen, language and theme live in the drawer", async ({ page }) => {
    test.setTimeout(240_000);
    const WALLET = "**/api/v1/wallet*";
    // the widest balance a wallet chip can show: SAR 100,000,000.00 (only the top bar is judged with it: a page body may legitimately need more room for such a number)
    const hugeBalance = async (route: import("@playwright/test").Route) => {
      try {
        const res = await route.fetch(); const j = await res.json().catch(() => null);
        if (j && typeof j.availableCents === "number") j.availableCents = 10_000_000_000;
        await route.fulfill({ response: res, json: j ?? undefined });
      } catch { /* the page navigated away or closed while the request was in flight */ }
    };
    for (const [role, home, login] of ROLES) {
      await login(page);
      for (const lang of ["en", "ar"]) {
        await page.context().addCookies([{ name: "jr_lang", value: lang, url: BASE }]);
        for (const w of [390, 360]) {
          await page.setViewportSize({ width: w, height: 844 });
          const where = `${role} ${lang} @${w}`;
          await gotoReady(page, home); // the page as the demo data has it
          expect(await noSideScroll(page), `${where} ${home}: page scrolls sideways`).toBe(true);
          await page.route(WALLET, hugeBalance);
          await gotoReady(page, `${home}/notifications`); // the top bar with the longest balance, over a page whose body has no money in it
          expect(await noSideScroll(page), `${where}: page scrolls sideways with a huge balance`).toBe(true);
          await page.unroute(WALLET, hugeBalance);
          await expect(page.locator('header a[href$="/notifications"]'), `${where}: the top bar rendered`).toBeVisible({ timeout: 30_000 });
          const bell = await page.locator('header a[href$="/notifications"]').boundingBox();
          expect(bell && bell.x >= 0 && bell.x + bell.width <= w, `${where}: the bell is on screen`).toBe(true);
          await expect(page.getByTestId("theme-menu"), where).toBeHidden(); // not in the top bar on a phone …
          await expect(page.getByTestId("lang-switch"), where).toBeHidden();
          await page.locator("header > button").first().click(); // … but in the drawer
          await expect(page.getByTestId("lang-switch-drawer")).toBeVisible();
          await expect(page.getByTestId("theme-drawer-dark")).toBeVisible();
          await page.keyboard.press("Escape");
        }
      }
      // the drawer's switch really changes the theme (once per role is enough)
      await page.context().addCookies([{ name: "jr_lang", value: "en", url: BASE }]);
      await gotoReady(page, home);
      await page.locator("header > button").first().click();
      await page.getByTestId("theme-drawer-light").click();
      expect(await theme(page), role).toBe("light");
      await page.getByTestId("theme-drawer-system").click(); // leave the saved choice as it was for the next role / spec
    }
  });
});

test.describe("light palette on the real pages", () => {
  test.use({ colorScheme: "light" });

  /** Every visible text node on the page: contrast against the colour it is actually painted on (flat backgrounds only; gradients, images and disabled controls are skipped). */
  async function lowContrast(page: Page) {
    return page.evaluate(() => {
      const cv = document.createElement("canvas"); cv.width = cv.height = 1; const cx = cv.getContext("2d", { willReadFrequently: true })!;
      const rgba = (css: string) => { cx.clearRect(0, 0, 1, 1); cx.fillStyle = "#000"; cx.fillStyle = css; cx.fillRect(0, 0, 1, 1); const d = cx.getImageData(0, 0, 1, 1).data; return [d[0], d[1], d[2], d[3] / 255]; };
      const over = (f: number[], b: number[]) => [0, 1, 2].map((i) => f[i] * f[3] + b[i] * (1 - f[3])).concat(1);
      const lin = (c: number) => { c /= 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
      const L = (c: number[]) => 0.2126 * lin(c[0]) + 0.7152 * lin(c[1]) + 0.0722 * lin(c[2]);
      const out: string[] = [];
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      const seen = new Set<Element>();
      for (let n = walker.nextNode(); n; n = walker.nextNode()) {
        const el = n.parentElement; if (!el || !n.textContent?.trim() || seen.has(el)) continue; seen.add(el);
        if (el.closest("script,style,[disabled],[aria-disabled=true],[aria-hidden=true],.sr-only,.leaflet-container,svg")) continue;
        const r = el.getBoundingClientRect(); if (r.width < 1 || r.height < 1) continue;
        const cs = getComputedStyle(el); if (cs.visibility === "hidden") continue;
        let opacity = 1, skip = false; const layers: number[][] = [];
        for (let e: Element | null = el; e; e = e.parentElement) {
          const s = getComputedStyle(e); opacity *= Number(s.opacity);
          if (s.backgroundImage !== "none") { skip = true; break; }
          const c = rgba(s.backgroundColor); if (c[3] > 0) layers.push(c); if (c[3] >= 1) break;
        }
        const fgc = rgba(cs.color); if (skip || fgc[3] === 0 || opacity < 0.99) continue;
        let base = [246, 248, 251, 1]; for (const c of layers.reverse()) base = over(c, base);
        const fg = over(fgc, base); const a = L(fg), b = L(base);
        const ratio = (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
        const size = parseFloat(cs.fontSize); const large = size >= 24 || (size >= 18.66 && parseInt(cs.fontWeight) >= 700);
        if (ratio < (large ? 3 : 4.5)) out.push(`${ratio.toFixed(2)}:1 "${n.textContent.trim().slice(0, 40)}" (${el.tagName.toLowerCase()}.${String(el.className).slice(0, 60)})`);
      }
      return out;
    });
  }

  test("sign-in, registration, the landing page and a business dashboard have no low-contrast text", async ({ page }) => {
    for (const p of ["/login", "/register", "/"]) { await gotoReady(page, p); const bad = await lowContrast(page); expect(bad, `${p}\n${bad.join("\n")}`).toEqual([]); }
    await otpLogin(page, DEMO.business);
    for (const p of ["/business", "/business/requests", "/business/wallet"]) { await gotoReady(page, p); const bad = await lowContrast(page); expect(bad, `${p}\n${bad.join("\n")}`).toEqual([]); }
  });
});
