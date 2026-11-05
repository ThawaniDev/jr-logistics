// Dev tool: log in as demo users and screenshot key pages. Usage: node scripts/shots.mjs <outDir> [locale]
import { chromium } from "playwright";
const out = process.argv[2], locale = process.argv[3] ?? "ar", base = "http://localhost:3000";
const browser = await chromium.launch();
async function ctxFor(login) {
  const ctx = await browser.newContext({ viewport: { width: 1360, height: 860 } });
  await ctx.addCookies([{ name: "jr_lang", value: locale, url: base }]);
  const page = await ctx.newPage();
  const origin = { origin: base };
  if (login.phone) {
    const s = await (await page.request.post(`${base}/api/v1/auth/otp/send`, { data: { phone: login.phone }, headers: origin })).json();
    await page.request.post(`${base}/api/v1/auth/otp/verify`, { data: { phone: login.phone, code: s.demoCode }, headers: origin });
  } else await page.request.post(`${base}/api/v1/auth/staff/login`, { data: login, headers: origin });
  return page;
}
const shots = {
  public: [[null, ["/", "/login", "/staff/login"]]],
  business: [[{ phone: "+966500000001" }, ["/business", "/business/requests/new", "/business/requests", "/business/wallet", "/business/api"]]],
  driver: [[{ phone: "+966500000011" }, ["/driver", "/driver/opportunities", "/driver/jobs", "/driver/documents"]]],
  office: [[{ phone: "+966500000002" }, ["/office", "/office/drivers", "/office/opportunities"]]],
  admin: [[{ email: "admin@jrlogistics.local", password: "ChangeMe!2026" }, ["/admin", "/admin/operations", "/admin/pricing", "/admin/finance", "/admin/verification", "/admin/settings", "/admin/staff"]]],
};
for (const [name, [[login, paths]]] of Object.entries(shots)) {
  const page = login ? await ctxFor(login) : await (await browser.newContext({ viewport: { width: 1360, height: 860 } })).newPage();
  if (!login) await page.context().addCookies([{ name: "jr_lang", value: locale, url: base }]);
  for (const p of paths) {
    const errors = [];
    page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
    await page.goto(base + p, { waitUntil: "networkidle" }).catch(() => {});
    await page.waitForTimeout(500);
    await page.screenshot({ path: `${out}/${locale}-${name}-${p.replace(/\//g, "_") || "root"}.png`, fullPage: false });
    console.log(name, p, page.url().replace(base, ""), errors.length ? "ERR: " + errors.slice(0, 2).join(" | ") : "ok");
    page.removeAllListeners("console");
  }
}
await browser.close();
