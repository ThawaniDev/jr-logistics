import { sql } from "drizzle-orm";
import type { User } from "@/db/schema";
import { err } from "@/lib/errors";
import { logError } from "@/lib/log";
import { filtersMeta, parseFilters, type ResolvedFilters } from "./filters";
import { cached, rows } from "./guard";
import type { MultiKey } from "./keys";

/**
 * Scope of the company / courier-office portal reports (decision G12). THE security rule of this module: the owner is derived from the SESSION, never from the request.
 * `portalCtx()` parses the shared filter model and then overwrites the ownership filters — `company` (business) or `office` (office) is forced to the caller's own id and any
 * client-supplied `company` / `office` / `driver` value is dropped (an office's `driver` filter is kept only for drivers that worked for it; a foreign driver id matches nothing).
 * The resulting `ResolvedFilters` goes through the unchanged framework helpers (`scope()`, `twinSelect()` …), so every query is narrowed to the owner by construction.
 */
export type PortalRole = "business" | "office";
/** The multi-value filters each portal may use. Everything else in the URL is ignored (and listed in `meta.ignored`). */
export const PORTAL_KEYS: Record<PortalRole, readonly MultiKey[]> = {
  business: ["city", "service", "vehicle", "status", "channel"],
  office: ["city", "service", "vehicle", "driver"],
};
/** Matches no row: what a filter on somebody else's driver becomes. */
export const NIL_ID = "00000000-0000-0000-0000-000000000000";
const ALL: readonly MultiKey[] = ["city", "service", "vehicle", "company", "office", "driver", "status", "channel"];

export interface PortalCtx { user: User; role: PortalRole; me: string; f: ResolvedFilters; ignored: MultiKey[] }

/** Drivers (of the given ids) that belong to the office now or did work for it. */
export async function ownDriverIds(officeId: string, ids: string[]): Promise<Set<string>> {
  if (!ids.length) return new Set();
  const list = sql.join(ids.map((i) => sql`${i}::uuid`), sql`, `);
  const r = await rows<{ id: string }>(sql`
    select driver_profiles.user_id::text as id from driver_profiles where driver_profiles.office_id = ${officeId} and driver_profiles.user_id in (${list})
    union select distinct offers.driver_id::text from offers where offers.office_id = ${officeId} and offers.driver_id in (${list})`);
  return new Set(r.map((x) => x.id));
}

export async function portalCtx(user: User, query: URLSearchParams, role: PortalRole): Promise<PortalCtx> {
  if (user.role !== role) throw err("FORBIDDEN", "Role not allowed");
  const p = parseFilters(query);
  const allowed = new Set(PORTAL_KEYS[role]);
  const ignored: MultiKey[] = ALL.filter((k) => p[k].length > 0 && !allowed.has(k));
  const lists = Object.fromEntries(ALL.map((k) => [k, allowed.has(k) ? p[k] : []])) as Record<MultiKey, string[]>;
  if (role === "business") lists.company = [user.id];
  else {
    lists.office = [user.id];
    if (p.driver.length) {
      const own = await ownDriverIds(user.id, p.driver);
      const keep = p.driver.filter((d) => own.has(d));
      if (keep.length < p.driver.length) ignored.push("driver");
      lists.driver = keep.length ? keep : [NIL_ID];
    }
  }
  const active = (["city", "service", "vehicle", "driver", "status", "channel"] as const).filter((k) => lists[k].length > 0);
  const canonical = [role, user.id, `${p.cur.from}..${p.cur.to}`, p.bucket, p.compare, ...active.map((k) => `${k}=${[...lists[k]].sort().join(",")}`)].join("|");
  return { user, role, me: user.id, f: { ...p, ...lists, active, canonical }, ignored };
}

/** `meta` of a portal response: the shared filter echo, minus the ownership filters (the owner is implied) and the "matches nothing" sentinel. */
export function portalMeta(c: PortalCtx, extra: { empty: boolean; failed: string[]; generatedAt: number; cached: boolean }) {
  const m = filtersMeta(c.f);
  const values = { ...m.values, company: [], office: [], driver: m.values.driver.filter((d) => d !== NIL_ID) };
  return { ...m, values, empty: extra.empty, moneyHidden: false, ignored: c.ignored, failed: extra.failed, generatedAt: new Date(extra.generatedAt).toISOString(), cached: extra.cached };
}

/** Thrown inside `cached()` so a report with a failed section is returned to the caller but never stored. */
class PartialResult<T> extends Error { constructor(readonly value: T, readonly failed: string[]) { super("partial report"); } }

/**
 * The sections of one report run. `part(name, fn)` isolates a failing section (timeout, bug): it becomes `null`, its name lands in `meta.failed` and the page shows that
 * section as unavailable while the rest still renders (decision G11). When EVERY section failed the first error is rethrown (the page shows its error state with Retry).
 */
export class Parts {
  failed: string[] = [];
  private total = 0;
  private first: unknown;
  async part<T>(name: string, fn: () => Promise<T>): Promise<T | null> {
    this.total++;
    try { return await fn(); }
    catch (e) { this.failed.push(name); this.first ??= e; logError(e, { correlationId: `portal:${name}` }); return null; }
  }
  finish<T>(value: T): T {
    if (this.failed.length && this.failed.length >= this.total) throw this.first;
    if (this.failed.length) throw new PartialResult(value, [...this.failed]);
    return value;
  }
}

/** Runs one report for one owner: cached 30 s per owner + filters (never when a section failed), shaped as `{ ...body, meta }`. */
export async function runPortalReport<B extends object>(c: PortalCtx, name: string, compute: (p: Parts) => Promise<{ body: B; empty: boolean }>) {
  const run = async () => { const p = new Parts(); const r = await compute(p); return p.finish(r); };
  let value: { body: B; empty: boolean }, at = Date.now(), hit = false, failed: string[] = [];
  try { const r = await cached(`portal-${name}|${c.f.canonical}`, run); value = r.value; at = r.at; hit = r.cached; }
  catch (e) { if (e instanceof PartialResult) { value = e.value as { body: B; empty: boolean }; failed = e.failed; } else throw e; }
  return { ...value.body, meta: portalMeta(c, { empty: value.empty, failed, generatedAt: at, cached: hit }) };
}
