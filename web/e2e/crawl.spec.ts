import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { test, expect, type Page } from "@playwright/test";
import { BASE, FORBID, OUT, attach, coverage, crawl, setPrefs, signIn, visit, type Account, type Locale } from "./crawl-lib";
import { PREFIX } from "./crawl-routes";

/**
 * UI crawl (audit K / A5): signs in as every kind of user, walks every sidebar page plus every detail page reachable by links, in English / Arabic at 1360 and 390 px,
 * and records console errors, failed requests, hydration warnings, sideways overflow, missing <h1>, raw i18n keys, `undefined`/`NaN`, unnamed controls … per page.
 * It is read-only (navigation only) and runs against a LIVE server (dev DB), not the e2e test DB:
 *   CRAWL=1 npx playwright test -c playwright.crawl.config.ts                         (everything)
 *   CRAWL=1 CRAWL_ONLY=admin,business CRAWL_LOCALES=en CRAWL_VIEWPORTS=desktop npx playwright test -c playwright.crawl.config.ts
 *   CRAWL_THEME=light|dark sets the `jr_theme` cookie; CRAWL_STRICT=1 fails on high findings; CRAWL_BASE changes the server.
 * Results: .crawl/<theme>/<account>-<locale>-<viewport>.json (summarise with `npx tsx e2e/crawl-report.ts`).
 */
const DEMO = "Demo#Pass2026";
const env = (k: string) => { try { return readFileSync(".env.local", "utf8").match(new RegExp(`^${k}=(.*)$`, "m"))?.[1].trim().replace(/^["']|["']$/g, ""); } catch { return undefined; } };
const ACCOUNTS: Account[] = [
  { id: "admin", username: "admin", password: process.env.CRAWL_ADMIN_PASSWORD ?? env("SUPER_ADMIN_PASSWORD") ?? "", role: "admin" },
  { id: "support", username: "demo.support", password: DEMO, role: "staff" },
  { id: "finance1", username: "demo.finance1", password: DEMO, role: "staff" },
  { id: "business", username: "demo.business", password: DEMO, role: "business" },
  { id: "driver", username: "demo.driver", password: DEMO, role: "driver" },
  { id: "driver5", username: "demo.driver5", password: DEMO, role: "driver" },
  { id: "office", username: "demo.office", password: DEMO, role: "office" },
];
const LOCALES = (process.env.CRAWL_LOCALES ?? "en,ar").split(",") as Locale[];
const VIEWPORTS = (process.env.CRAWL_VIEWPORTS ?? "desktop,mobile").split(",");
const ONLY = process.env.CRAWL_ONLY?.split(",");
const THEME = process.env.CRAWL_THEME ?? "default";
const PUBLIC = ["/", "/login", "/register", "/track", "/track/JR-NOPE-0000", "/terms", "/privacy", "/scenarios", "/staff/login", "/staff/mfa", "/no-such-page"];
const HOME = (a: Account) => (a.role === "admin" || a.role === "staff" ? "/admin" : `/${a.role}`);

test.skip(!process.env.CRAWL, "set CRAWL=1 (and run with playwright.crawl.config.ts) — the crawl targets a live server, not the e2e test DB");

async function newPage(browser: import("@playwright/test").Browser, vp: string, locale: Locale) {
  const ctx = await browser.newContext(vp === "mobile" ? { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2, colorScheme: "dark" } : { viewport: { width: 1360, height: 900 }, colorScheme: "dark" });
  await setPrefs(ctx, locale, THEME === "default" ? undefined : THEME);
  return { ctx, page: await ctx.newPage() };
}
const save = (name: string, data: unknown) => { mkdirSync(`${OUT}/${THEME}`, { recursive: true }); writeFileSync(`${OUT}/${THEME}/${name}.json`, JSON.stringify(data, null, 1)); };
const sidebar = (page: Page) => page.evaluate(() => Array.from(new Set(Array.from(document.querySelectorAll("aside nav a[href]")).map((a) => a.getAttribute("href") ?? "")))).then((l) => l.filter((h) => h.startsWith("/")));
const staticNav = () => [...readFileSync("src/components/layout/nav.ts", "utf8").matchAll(/href: "(\/(?:admin|scenarios)[^"]*)"/g)].map((m) => m[1]);

// matrix order: every account in English/desktop first, then Arabic/desktop, then the two phone runs (so a partial run is still useful)
const MATRIX = [["en", "desktop"], ["ar", "desktop"], ["en", "mobile"], ["ar", "mobile"], ["ur", "desktop"], ["ur", "mobile"]].filter(([l, v]) => LOCALES.includes(l as Locale) && VIEWPORTS.includes(v));
for (const [locale, vp] of MATRIX as [Locale, string][]) for (const acc of ACCOUNTS) {
  if (ONLY && !ONLY.includes(acc.id)) continue;
  {
    test(`crawl ${acc.id} ${locale} ${vp}`, async ({ browser }) => {
      test.setTimeout(3 * 3600_000);
      const { ctx, page } = await newPage(browser, vp, locale);
      await signIn(ctx, acc); await setPrefs(ctx, locale, THEME === "default" ? undefined : THEME);
      await page.goto(BASE + HOME(acc)); await page.waitForSelector('html[data-hydrated="true"]', { timeout: 60_000 });
      const side = await sidebar(page);
      const OLD_URLS = ["/admin/cod", "/admin/pricing", "/admin/shipments", "/admin/finance?tab=withdrawals", "/admin/verification?tab=documents"]; // F11: old URLs still work (redirect pages)
      const seeds = [...new Set([...side, "/account/change-password", ...(acc.role === "admin" ? [...staticNav(), ...OLD_URLS] : [])])];
      if (acc.role === "admin") for (const h of staticNav()) if (!side.includes(h)) process.stderr.write(`  NOTE nav.ts has ${h} but the admin sidebar does not\n`);
      const tag = `[${acc.id} ${locale} ${vp}]`;
      process.stderr.write(`${tag} ${seeds.length} sidebar routes\n`);
      const prefix = PREFIX[acc.role];
      const dump = (pages: unknown[], unvisited: string[] = []) => save(`${acc.id}-${locale}-${vp}`, { account: acc.id, locale, vp, theme: THEME, sidebar: side, pages, unvisited });
      const perRoute = Number(process.env.CRAWL_PER_ROUTE ?? (locale === "en" && vp === "desktop" ? 2 : 1));
      const { results, routes, visitedKeys } = await crawl(page, { prefix, seeds, perRoute, maxPages: Number(process.env.CRAWL_MAX ?? 450), locale, mobile: vp === "mobile", theme: THEME }, (s) => process.stderr.write(`${tag}${s}\n`), (r) => dump(r));
      dump(results, coverage(routes, visitedKeys, prefix));
      await ctx.close();
      const high = results.flatMap((r) => r.issues.filter((i) => i.sev === "high").map((i) => `${r.url}: ${i.cat} ${i.msg}`));
      process.stderr.write(`${tag} done: ${results.length} pages, ${high.length} high findings\n`);
      if (process.env.CRAWL_STRICT) expect(high, "high-severity findings").toEqual([]);
    });
  }
}

// signed-out pages
for (const locale of LOCALES) for (const vp of VIEWPORTS) {
  if (ONLY && !ONLY.includes("public")) continue;
  test(`crawl public ${locale} ${vp}`, async ({ browser }) => {
    const { ctx, page } = await newPage(browser, vp, locale);
    const buf = attach(page); const results = [];
    for (const u of PUBLIC) results.push((await visit(page, buf, u, "list", locale, vp === "mobile", THEME)).r);
    save(`public-${locale}-${vp}`, { account: "public", locale, vp, theme: THEME, pages: results });
    await ctx.close();
  });
}

// restricted staff: admin pages they do NOT have in their sidebar, opened by URL — does the UI explain, or does it render a half-broken page?
for (const acc of ACCOUNTS.filter((a) => a.role === "staff")) {
  if (ONLY && !ONLY.includes(acc.id)) continue;
  test(`probe forbidden pages ${acc.id}`, async ({ browser }) => {
    test.setTimeout(3600_000);
    const { ctx, page } = await newPage(browser, "desktop", "en");
    await signIn(ctx, acc); await setPrefs(ctx, "en");
    await page.goto(BASE + "/admin"); await page.waitForSelector('html[data-hydrated="true"]', { timeout: 60_000 });
    const mine = new Set(await sidebar(page));
    const buf = attach(page); const rows = [];
    for (const u of staticNav().filter((h) => !mine.has(h))) {
      const { r } = await visit(page, buf, u, "probe", "en", false);
      const text = await page.locator("main").first().innerText().catch(() => ""); // the page itself — the sidebar says "Roles & permissions" on every page
      rows.push({ url: u, finalUrl: r.finalUrl, status: r.status, h1: r.h1, explained: r.finalUrl.split("?")[0] !== u || FORBID.test(text), generic: /something went wrong|حدث خطأ|try again|إعادة المحاولة/i.test(text), h1Count: await page.locator("h1:visible").count(), api4xx: r.issues.filter((i) => i.cat === "http-4xx").map((i) => i.msg), shows: text.replace(/\s+/g, " ").slice(0, 300) });
    }
    save(`probe-${acc.id}`, { account: acc.id, rows });
    await ctx.close();
    expect(BASE).toBeTruthy();
  });
}

// dialogs: focus goes in, Tab cycles inside, Esc closes, focus returns to the opener, the dialog has a name — for the ⌘K page switcher and a form dialog
for (const locale of ["en", "ar"] as Locale[]) {
  if (ONLY && !ONLY.includes("dialogs")) continue;
  test(`dialogs focus handling ${locale}`, async ({ browser }) => {
    const { ctx, page } = await newPage(browser, "desktop", locale);
    const report: Record<string, unknown> = {};
    const probe = async (name: string, open: () => Promise<void>, opener?: string) => {
      await open();
      const dlg = page.locator("dialog[open]").first();
      await expect(dlg, `${name}: a dialog opens`).toBeVisible();
      const inDialog = () => page.evaluate(() => !!document.activeElement?.closest("dialog[open]"));
      const first = await inDialog();
      const label = await dlg.getAttribute("aria-label");
      const seen = new Set<string>(); let escaped = false; const outside = new Set<string>();
      for (let i = 0; i < 14; i++) { await page.keyboard.press("Tab"); if (!(await inDialog())) { escaped = true; outside.add(await page.evaluate(() => { const a = document.activeElement as HTMLElement | null; return a ? a.tagName + (a.closest("main,aside,header") ? " (page behind!)" : "") : "none"; })); } seen.add(await page.evaluate(() => (document.activeElement as HTMLElement | null)?.outerHTML.slice(0, 60) ?? "")); }
      await page.keyboard.press("Escape");
      const closed = await page.locator("dialog[open]").count() === 0;
      const back = opener ? await page.evaluate((sel) => document.activeElement === document.querySelector(sel), opener) : null;
      report[name] = { focusInsideOnOpen: first, name: label, tabEscaped: escaped, outside: [...outside], distinctStops: seen.size, escCloses: closed, focusReturned: back };
    };
    await signIn(ctx, ACCOUNTS.find((a) => a.id === "business")!); await setPrefs(ctx, locale);
    await page.goto(BASE + "/business/wallet"); await page.waitForSelector('html[data-hydrated="true"]');
    await probe("topup", async () => { await page.getByTestId("wallet-topup").focus(); await page.getByTestId("wallet-topup").click(); }, '[data-testid="wallet-topup"]');
    await probe("jump", async () => { await page.getByTestId("jump-open").first().click(); }, '[data-testid="jump-open"]');
    await probe("jump-shortcut", async () => { await page.locator("main").click({ position: { x: 5, y: 5 } }); await page.keyboard.press("Control+k"); });
    save(`dialogs-${locale}`, report);
    await ctx.close();
    for (const [k, v] of Object.entries(report)) process.stderr.write(`dialogs ${locale} ${k}: ${JSON.stringify(v)}\n`);
  });
}
