import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import type { BrowserContext, Page } from "@playwright/test";
import en from "../src/i18n/en";
import { collectFacts, type DomFacts } from "./crawl-dom";
import { crawlKey, loadRoutes, matchRoute, type Route } from "./crawl-routes";

export const BASE = process.env.CRAWL_BASE ?? "http://localhost:3000";
export const OUT = ".crawl"; // NOT under test-results: any other Playwright run in this folder empties that directory
export type Sev = "high" | "medium" | "low" | "info";
export interface Issue { cat: string; sev: Sev; msg: string }
export interface PageResult { url: string; finalUrl: string; from: string; status: number; ms: number; h1: string; issues: Issue[] }
export interface Account { id: string; username: string; password: string; role: "admin" | "staff" | "business" | "driver" | "office" }
export type Locale = "en" | "ar" | "ur";

// ── sign-in (API, once per account; cookies kept on disk so repeated runs do not trip the rate limit) ────────────────────────────────
export async function signIn(ctx: BrowserContext, acc: Account) {
  const file = `${OUT}/.auth/${acc.id}.json`;
  if (existsSync(file)) {
    await ctx.addCookies(JSON.parse(readFileSync(file, "utf8")));
    if ((await ctx.request.get(`${BASE}/api/v1/auth/me`)).ok()) return;
    await ctx.clearCookies();
  }
  const res = await ctx.request.post(`${BASE}/api/v1/auth/login`, { data: { username: acc.username, password: acc.password }, headers: { origin: BASE } });
  if (res.status() !== 200) throw new Error(`sign-in as ${acc.username} failed: ${res.status()} ${(await res.text()).slice(0, 200)}`);
  mkdirSync(`${OUT}/.auth`, { recursive: true });
  writeFileSync(file, JSON.stringify(await ctx.cookies()));
}
export async function setPrefs(ctx: BrowserContext, locale: Locale, theme?: string) {
  const c: { name: string; value: string; url: string }[] = [{ name: "jr_lang", value: locale, url: BASE }];
  if (theme) c.push({ name: "jr_theme", value: theme, url: BASE });
  await ctx.addCookies(c);
}

// ── judging one page ───────────────────────────────────────────────────────────────────────────────────────────────────────────
const KEYS = new Set(Object.keys(en));
const PREFIXES = new Set(Array.from(KEYS, (k) => k.split(".")[0]));
const RAW_ROUTE = /\/raw(\/|$)|\/api$|\/scenarios/; // raw JSON viewers legitimately show null/undefined-looking text; the scenarios page is a static quiz
const BAD_VALUE = /\bundefined\b|\bNaN\b|\[object Object\]|Invalid Date|\bInfinity\b/;
export const FORBID = /forbidden|not allowed|no access|permission|don.t have|ليس لديك|غير مصرح|صلاحي|لا تملك|ممنوع|اجازت|مجاز/i;
const EN_VALUES = new Set(Object.values(en));

export function rawKeys(text: string): string[] {
  const hit = new Set<string>();
  for (const tok of text.split(/[\s,;:()[\]"'<>|=]+/)) {
    const t = tok.replace(/[.…]+$/, "");
    if (!/^[a-z][a-z0-9_]*(\.[A-Za-z0-9_-]+)+$/.test(t)) continue;
    if (KEYS.has(t) || (PREFIXES.has(t.split(".")[0]) && !/^(status|role)\.(json|js|html)$/.test(t))) hit.add(t);
  }
  return [...hit];
}

export function judge(f: DomFacts, path: string, locale: Locale, mobile: boolean, theme?: string): Issue[] {
  const out: Issue[] = [];
  const add = (cat: string, sev: Sev, msg: string) => out.push({ cat, sev, msg });
  const raw = RAW_ROUTE.test(path);
  if (f.h1.length === 0) add("no-h1", "medium", "no visible <h1>"); else if (f.h1.length > 1) add("multi-h1", "low", `${f.h1.length} <h1>: ${f.h1.join(" | ").slice(0, 100)}`);
  if (f.mains !== 1 && !/^\/(login|register|track|terms|privacy|staff|account|$)/.test(path)) add("landmark", "low", `${f.mains} <main> landmarks`);
  if (f.scrollW > f.vw + 1) add("overflow", "medium", `page scrolls sideways (${f.scrollW}px > ${f.vw}px): ${f.overflowers.slice(0, 4).join(" ; ")}`);
  if (!raw) {
    const keys = rawKeys(f.text); if (keys.length) add("raw-key", "high", `raw i18n key(s) on screen: ${keys.slice(0, 6).join(", ")}`);
    const bad = BAD_VALUE.exec(f.text); if (bad) { const i = bad.index; add("bad-value", "high", `"${bad[0]}" in text: …${f.text.slice(Math.max(0, i - 40), i + 30).replace(/\s+/g, " ")}…`); }
    const ph = /\{[a-zA-Z_]{2,}\}/.exec(f.text); if (ph) add("placeholder-left", "medium", `unreplaced placeholder ${ph[0]}`);
  }
  if (/[٠-٩۰-۹]/.test(f.text)) add("eastern-digits", "low", "Eastern Arabic/Persian digits on screen (policy: Latin digits `nu-latn`)");
  if (f.lang !== locale) add("lang-dir", "medium", `<html lang="${f.lang}"> but locale is ${locale}`);
  if (f.dir !== (locale === "en" ? "ltr" : "rtl")) add("lang-dir", "medium", `<html dir="${f.dir}"> for ${locale}`);
  if (theme && theme !== "default" && f.theme !== theme) add("theme", "medium", `<html data-theme="${f.theme}"> but the ${theme} theme was requested`);
  if (f.devOverlay) add("dev-overlay", "high", `Next dev error overlay: ${f.devOverlay}`);
  for (const a of f.alerts) if (a) add("alert", /wrong|خطأ|error|failed|فشل|ناکام|گڑبڑ/i.test(a) ? "medium" : "info", `role=alert visible: ${a}`);
  if (f.busy > 0) add("still-loading", "medium", `${f.busy} skeleton/busy element(s) still on screen after the wait`);
  if (!f.title || f.title.trim() === "JR Logistics") add("title", "low", `generic tab title "${f.title}"`);
  if (f.unnamed.length) add("unnamed-control", "medium", `${f.unnamed.length} control(s) without an accessible name: ${f.unnamed.slice(0, 3).join(" ; ")}`);
  if (f.unlabeled.length) add("unlabeled-input", "medium", `${f.unlabeled.length} form control(s) without a label: ${f.unlabeled.slice(0, 3).join(" ; ")}`);
  if (f.placeholderOnly.length) add("placeholder-only", "low", `${f.placeholderOnly.length} control(s) named only by their placeholder: ${f.placeholderOnly.slice(0, 3).join(" ; ")}`);
  if (f.imgNoAlt.length) add("img-alt", "low", `${f.imgNoAlt.length} <img> without alt: ${f.imgNoAlt.slice(0, 2).join(" ; ")}`);
  if (f.dupIds.length) add("dup-id", "low", `duplicate ids: ${f.dupIds.slice(0, 6).join(", ")}`);
  if (f.positiveTabindex.length) add("tabindex", "low", `positive tabindex: ${f.positiveTabindex.slice(0, 2).join(" ; ")}`);
  if (f.headingJumps.length) add("heading-order", "low", `heading levels skipped: ${f.headingJumps.slice(0, 3).join(" ; ")}`);
  if (f.tableNoHead > 0) add("table-head", "low", `${f.tableNoHead} table(s) without <th>`);
  if (mobile && f.smallTargets.length) add("small-target", "low", `${f.smallTargets.length} touch target(s) under 24px: ${f.smallTargets.slice(0, 3).join(" ; ")}`);
  const one = /(^|[\s(])1 (drivers|parcels|orders|requests|settlements|items|jobs|days|hours|minutes|stops|shipments|offers|accounts|documents|units|stars|ratings|cases|complaints|companies|offices|users|rows|slots|attempts|notes|results)\b/.exec(f.text);
  if (one && locale === "en" && !raw) add("plural", "low", `"1 ${one[2]}" — no singular form: …${f.text.slice(Math.max(0, one.index - 20), one.index + 40).replace(/\s+/g, " ")}…`);
  if (locale !== "en" && !raw) {
    // names and codes are data; flag English *sentences* (4+ words) and exact English dictionary values, which are copy a translator never saw
    const latin = [...new Set(f.latinNodes)].filter((s) => s.split(/\s+/).length >= 4 || EN_VALUES.has(s));
    if (latin.length) add("english-in-rtl", "low", `${latin.length} English-only text(s) in ${locale}: ${latin.slice(0, 5).map((s) => `"${s.slice(0, 50)}"`).join(", ")}`);
  }
  return out;
}

// ── visiting ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
interface Buf { console: string[]; hydration: string[]; pageErrors: string[]; http: { s: number; m: string; u: string }[]; failed: { u: string; why: string; ext: boolean }[] }
const newBuf = (): Buf => ({ console: [], hydration: [], pageErrors: [], http: [], failed: [] });
const pathOf = (u: string) => { try { const x = new URL(u); return x.pathname + x.search; } catch { return u; } };
const same = (u: string) => u.startsWith(BASE);

export function attach(page: Page): { reset: () => void; get: () => Buf } {
  let b = newBuf();
  page.on("console", (m) => {
    if (m.type() !== "error" && m.type() !== "warning") return;
    const t = m.text().replace(/\s+/g, " ").slice(0, 300);
    if (/Download the React DevTools|\[Fast Refresh\]|Failed to load resource/.test(t)) return; // the failed-resource lines are covered by the response/requestfailed listeners
    if (/hydrat|did not match|server rendered HTML/i.test(t)) b.hydration.push(t); else b.console.push(`${m.type()}: ${t}`);
  });
  page.on("pageerror", (e) => b.pageErrors.push(String(e.message ?? e).slice(0, 300)));
  page.on("response", (r) => { if (r.status() >= 400 && same(r.url()) && !r.url().includes("/_next/")) b.http.push({ s: r.status(), m: r.request().method(), u: pathOf(r.url()) }); });
  page.on("requestfailed", (r) => { const why = r.failure()?.errorText ?? ""; if (/ERR_ABORTED/.test(why)) return; b.failed.push({ u: pathOf(r.url()).slice(0, 120), why, ext: !same(r.url()) }); });
  page.on("dialog", (d) => d.dismiss().catch(() => {}));
  return { reset: () => { b = newBuf(); }, get: () => b };
}

export async function visit(page: Page, buf: ReturnType<typeof attach>, url: string, from: string, locale: Locale, mobile: boolean, theme?: string): Promise<{ r: PageResult; links: string[] }> {
  buf.reset();
  const t0 = Date.now();
  const issues: Issue[] = [];
  let status = 0;
  try {
    const resp = await page.goto(BASE + url, { waitUntil: "domcontentloaded", timeout: 90_000 });
    status = resp?.status() ?? 0;
  } catch (e) { issues.push({ cat: "navigation", sev: "high", msg: `goto failed: ${String(e).slice(0, 160)}` }); }
  await page.waitForSelector('html[data-hydrated="true"]', { timeout: 25_000 }).catch(() => issues.push({ cat: "hydration", sev: "high", msg: "page never reported hydration (data-hydrated)" }));
  await page.waitForFunction(() => Array.from(document.querySelectorAll("[aria-busy='true'], .animate-pulse")).every((e) => { const r = e.getBoundingClientRect(); return (r.width === 0 && r.height === 0) || (!!e.closest("details:not([open])") && !e.closest("summary")); }), null, { timeout: 15_000 }).catch(() => {});
  await page.waitForLoadState("networkidle", { timeout: 4_000 }).catch(() => {});
  await page.waitForTimeout(250);
  const finalPath = pathOf(page.url());
  let facts: DomFacts | null = null;
  try { facts = await page.evaluate(collectFacts, { checkTargets: mobile }); } catch (e) { issues.push({ cat: "evaluate", sev: "medium", msg: String(e).slice(0, 160) }); }
  const b = buf.get();
  for (const m of b.console) issues.push({ cat: "console", sev: m.startsWith("error") ? "high" : "low", msg: m });
  for (const m of b.hydration) issues.push({ cat: "hydration", sev: "high", msg: m });
  for (const m of b.pageErrors) issues.push({ cat: "pageerror", sev: "high", msg: m });
  for (const h of b.http) issues.push({ cat: h.s >= 500 ? "http-5xx" : "http-4xx", sev: h.s >= 500 ? "high" : "medium", msg: `${h.m} ${h.u} → ${h.s}` });
  for (const f of b.failed) issues.push({ cat: f.ext ? "external-failed" : "request-failed", sev: f.ext ? "info" : "medium", msg: `${f.u} (${f.why})` });
  if (status === 404) issues.push({ cat: "not-found", sev: "medium", msg: `404 for ${url} (linked from ${from})` });
  if (/^\/(login|staff\/login)/.test(finalPath) && !/^\/(login|staff|register)/.test(url)) issues.push({ cat: "redirect-login", sev: "high", msg: `${url} redirected to ${finalPath}` });
  if (facts) issues.push(...judge(facts, finalPath.split("?")[0], locale, mobile, theme));
  return { r: { url, finalUrl: finalPath, from, status, ms: Date.now() - t0, h1: facts?.h1[0] ?? "", issues }, links: facts?.links ?? [] };
}

// ── crawling ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
export interface CrawlCfg { prefix: string; seeds: string[]; perRoute: number; maxPages: number; locale: Locale; mobile: boolean; theme?: string }
const SKIP = /^\/(api|_next|login|register|staff|terms|privacy|track)(\/|$|\?)|format=|\.(csv|xlsx|pdf|png|jpg)$/;
const shared = /^\/(account|scenarios)(\/|$)/;

export async function crawl(page: Page, cfg: CrawlCfg, log: (s: string) => void, onProgress?: (results: PageResult[]) => void) {
  const routes = loadRoutes();
  const buf = attach(page);
  const results: PageResult[] = [];
  const seen = new Set<string>(); const perKey = new Map<string, number>();
  const queue: { url: string; from: string; seed: boolean }[] = cfg.seeds.map((url) => ({ url, from: "sidebar", seed: true }));
  while (queue.length && results.length < cfg.maxPages) {
    const q = queue.shift()!;
    const key = crawlKey(routes, q.url);
    if (seen.has(q.url)) continue;
    if (!q.seed && (perKey.get(key) ?? 0) >= cfg.perRoute) continue;
    seen.add(q.url); perKey.set(key, (perKey.get(key) ?? 0) + 1);
    const { r, links } = await visit(page, buf, q.url, q.from, cfg.locale, cfg.mobile, cfg.theme);
    results.push(r);
    if (results.length % 15 === 0) { log(`  ${results.length} pages (${queue.length} queued) …`); onProgress?.(results); }
    if (r.finalUrl.split("?")[0] !== q.url.split("?")[0] && !r.finalUrl.startsWith(cfg.prefix)) continue; // bounced elsewhere: do not follow its links
    for (const h of links) {
      if (!h.startsWith("/") || h.startsWith("//")) continue;
      const clean = h.split("#")[0]; if (!clean || SKIP.test(clean)) continue;
      const p = clean.split("?")[0];
      if (!p.startsWith(cfg.prefix + "/") && p !== cfg.prefix && !shared.test(p)) continue;
      if (!seen.has(clean)) queue.push({ url: clean, from: q.url, seed: false });
    }
  }
  return { results, routes, visitedKeys: [...perKey.keys()] };
}

export function coverage(routes: Route[], visited: string[], prefix: string): string[] {
  const got = new Set(visited.map((k) => k.split("?")[0]));
  return routes.map((r) => r.pattern).filter((p) => p.startsWith(prefix + "/") || p === prefix).filter((p) => !got.has(p)).sort();
}
export { matchRoute };
