import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";

/** Every page route of the app, read from `src/app/**\/page.tsx` ((groups) dropped, `[id]` → `:id`), so the crawl can say which routes it never reached. */
export interface Route { pattern: string; re: RegExp; statics: number }

export function loadRoutes(appDir = join(process.cwd(), "src/app")): Route[] {
  const out: Route[] = [];
  const walk = (dir: string, segs: string[]) => {
    for (const f of readdirSync(dir)) {
      const p = join(dir, f);
      if (statSync(p).isDirectory()) { if (f === "api") continue; walk(p, /^\(.*\)$/.test(f) ? segs : [...segs, f]); }
      else if (f === "page.tsx") {
        const pattern = "/" + segs.map((s) => (s.startsWith("[") ? ":" + s.replace(/[[\]]/g, "") : s)).join("/");
        const re = new RegExp("^" + segs.map((s) => "/" + (s.startsWith("[") ? "[^/]+" : s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))).join("") + "/?$");
        out.push({ pattern: pattern === "/" ? "/" : pattern, re: segs.length ? re : /^\/?$/, statics: segs.filter((s) => !s.startsWith("[")).length });
      }
    }
  };
  walk(appDir, []);
  return out;
}

/** The most specific route a path belongs to (more fixed segments wins), or null when no page exists for it (a dead link). */
export function matchRoute(routes: Route[], path: string): Route | null {
  let best: Route | null = null;
  for (const r of routes) if (r.re.test(path) && (!best || r.statics > best.statics)) best = r;
  return best;
}

/** Key used to de-duplicate the crawl: the route pattern, plus `?view=` (the one query switch that changes the whole page). */
export function crawlKey(routes: Route[], url: string): string {
  const u = new URL(url, "http://x");
  const r = matchRoute(routes, u.pathname);
  const v = u.searchParams.get("view");
  return (r ? r.pattern : "404:" + u.pathname) + (v ? `?view=${v}` : "");
}

/** Roles' route prefixes, for coverage ("which admin routes were never visited"). */
export const PREFIX: Record<string, string> = { admin: "/admin", staff: "/admin", business: "/business", driver: "/driver", office: "/office" };
