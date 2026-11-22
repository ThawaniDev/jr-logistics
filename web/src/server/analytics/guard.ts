import { sql, type SQL } from "drizzle-orm";
import { getReportDb, type Tx } from "@/db";
import { err } from "@/lib/errors";
import { can } from "../auth/permissions";
import type { User } from "@/db/schema";

/**
 * Reliability guards of every report query (decision G11).
 *
 * 1. `timed()` runs one query in its own READ ONLY transaction with `statement_timeout` set LOCAL to it (15 s by default), so a runaway report is cancelled by
 *    Postgres and answered with a 503 `DEPENDENCY_UNAVAILABLE` (`details.reason = "timeout"`) instead of holding a connection. Each query has its own transaction, so
 *    queries still run in parallel on different pool connections and the setting never leaks into the pool.
 * 2. `cached()` keeps a finished report for 30 s in memory, keyed by permission class + report + canonical filters. Identical requests that arrive while the
 *    first is still running share its promise (a dashboard opened in five tabs runs the SQL once). The cache is per server process; it is a shield against
 *    repeated identical loads, not a source of truth — a 30 s old number is always acceptable for a report, and `meta.generatedAt` says how old it is.
 */
export const STATEMENT_TIMEOUT_MS = 15_000;
export const CACHE_TTL_MS = Number(process.env.ANALYTICS_CACHE_TTL_MS ?? 30_000);
const CACHE_MAX = 200;

export async function timed<T>(fn: (tx: Tx) => Promise<T>, ms = STATEMENT_TIMEOUT_MS): Promise<T> {
  try {
    return await getReportDb().transaction(async (tx) => { // the reports' own small pool: a heavy report load never starves the API's pool
      await tx.execute(sql`select set_config('statement_timeout', ${String(ms)}, true)`);
      return fn(tx);
    }, { accessMode: "read only" });
  } catch (e) {
    const code = (e as { cause?: { code?: string } })?.cause?.code ?? (e as { code?: string })?.code;
    if (code === "57014") throw err("DEPENDENCY_UNAVAILABLE", "The report took too long to compute. Narrow the period or the filters.", { reason: "timeout" });
    throw e;
  }
}
/** Rows of a raw query run inside `timed`. Aggregates come back as strings from `pg` for bigint/numeric: cast in SQL (`::int`, `::float8`) or wrap with Number(). */
export async function rows<T = Record<string, unknown>>(q: SQL, ms?: number): Promise<T[]> {
  return timed(async (tx) => (await tx.execute(q)).rows as T[], ms);
}
export const num = (v: unknown): number => { const n = Number(v ?? 0); return Number.isFinite(n) ? n : 0; };
export const numOrNull = (v: unknown): number | null => (v == null ? null : Number.isFinite(Number(v)) ? Number(v) : null);

/**
 * What a user may see, as a short string for cache keys: reports are identical for everybody with the same class. Add a permission here when a report starts
 * to depend on it (finance → money columns, drivers.sensitive → personal data, reports.export → CSV links).
 */
export function permClass(u: Pick<User, "role" | "permissions">): string {
  return (["finance.view", "reports.export", "drivers.sensitive", "wallets.view"] as const).map((p) => (can(u, p) ? "1" : "0")).join("");
}

const store = new Map<string, { at: number; value: unknown }>();
const inflight = new Map<string, Promise<unknown>>();
export interface Cached<T> { value: T; cached: boolean; at: number }
export async function cached<T>(key: string, fn: () => Promise<T>, ttl = CACHE_TTL_MS): Promise<Cached<T>> {
  const hit = store.get(key);
  if (ttl > 0 && hit && Date.now() - hit.at < ttl) return { value: hit.value as T, cached: true, at: hit.at };
  let p = inflight.get(key) as Promise<{ value: T; at: number }> | undefined;
  const joined = !!p;
  if (!p) {
    p = fn().then((value) => ({ value, at: Date.now() }));
    inflight.set(key, p);
    p.then(() => { if (inflight.get(key) === p) inflight.delete(key); }, () => { if (inflight.get(key) === p) inflight.delete(key); });
  }
  const done = await p;
  if (!joined && ttl > 0) {
    store.set(key, { at: done.at, value: done.value });
    if (store.size > CACHE_MAX) for (const k of [...store.keys()].slice(0, store.size - CACHE_MAX)) store.delete(k);
  }
  return { value: done.value, cached: false, at: done.at };
}
export const clearAnalyticsCache = () => { store.clear(); inflight.clear(); };
