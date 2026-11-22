// Dev tool: sign in as the demo accounts and screenshot key pages of a RUNNING dev server (demo mode, `npm run db:seed` done).
// Usage: node scripts/shots.mjs <outDir> [locale=ar] [baseUrl=http://localhost:3000]
// The super admin signs in as `admin` with SUPER_ADMIN_PASSWORD from .env.local (skipped when that password was changed); every other account uses the published demo password.
import { chromium } from "playwright";
import { config } from "dotenv";
import { mkdirSync } from "node:fs";
config({ path: ".env.local", quiet: true });
const out = process.argv[2], locale = process.argv[3] ?? "ar", base = process.argv[4] ?? "http://localhost:3000";
if (!out) { console.error("usage: node scripts/shots.mjs <outDir> [locale] [baseUrl]"); process.exit(2); }
mkdirSync(out, { recursive: true });
const DEMO = "Demo#Pass2026";
const browser = await chromium.launch();
const shots = {
  public: [null, ["/", "/login", "/register", "/track"]],
  business: [["demo.business", DEMO], ["/business", "/business/requests", "/business/wallet", "/business/cash", "/business/api"]],
  driver: [["demo.driver", DEMO], ["/driver", "/driver/opportunities", "/driver/jobs", "/driver/wallet", "/driver/documents"]],
  office: [["demo.office", DEMO], ["/office", "/office/drivers", "/office/opportunities", "/office/settlements"]],
  staff: [["demo.ops", DEMO], ["/admin", "/admin/operations", "/admin/requests", "/admin/verification"]],
  admin: [["admin", process.env.SUPER_ADMIN_PASSWORD ?? ""], ["/admin", "/admin/finance", "/admin/reports", "/admin/pricing", "/admin/settings", "/admin/roles"]],
};
for (const [name, [login, paths]] of Object.entries(shots)) {
  const ctx = await browser.newContext({ viewport: { width: 1360, height: 860 } });
  await ctx.addCookies([{ name: "jr_lang", value: locale, url: base }]);
  const page = await ctx.newPage();
  if (login) {
    const r = await page.request.post(`${base}/api/v1/auth/login`, { data: { username: login[0], password: login[1] }, headers: { origin: base } });
    if (!r.ok()) { console.log(name, "SKIPPED: sign-in answered", r.status()); await ctx.close(); continue; }
  }
  for (const p of paths) {
    const errors = [];
    page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
    await page.goto(base + p, { waitUntil: "networkidle" }).catch(() => {});
    await page.waitForTimeout(500);
    await page.screenshot({ path: `${out}/${locale}-${name}-${p.replace(/\//g, "_") || "root"}.png`, fullPage: false });
    console.log(name, p, page.url().replace(base, ""), errors.length ? "ERR: " + errors.slice(0, 2).join(" | ") : "ok");
    page.removeAllListeners("console");
  }
  await ctx.close();
}
await browser.close();
