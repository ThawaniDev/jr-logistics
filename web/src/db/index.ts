import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { logError } from "@/lib/log";
import * as schema from "./schema";

declare global {
  var __jrPool: Pool | undefined;
  var __jrReportPool: Pool | undefined;
}

function pool(): Pool {
  if (!globalThis.__jrPool) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("DATABASE_URL is not set");
    // connectionTimeoutMillis: when every connection is busy (or the database is unreachable) a request fails after 20 s instead of waiting for ever.
    const p = new Pool({ connectionString: url, max: Number(process.env.DB_POOL_MAX ?? 10), connectionTimeoutMillis: 20_000 });
    // An idle connection that drops (database restart, failover, network) emits "error" on the pool; without a listener Node reports an
    // uncaught exception and prints the whole client object. The pool replaces the connection by itself: just log one scrubbed line.
    p.on("error", (e) => logError(e, { correlationId: "db:pool" }));
    globalThis.__jrPool = p;
  }
  return globalThis.__jrPool;
}

export const getPool = pool;

/**
 * A second, small pool used ONLY by the analytics reports (`server/analytics/guard.ts` `timed`). A report load fires ~35 statements at once; on the shared pool six of them
 * at the same time delayed a trivial `select 1` by up to 1 s (audit A4, finding 19). Here they queue among themselves. `REPORT_POOL_MAX` (default 4) — the instance
 * opens at most DB_POOL_MAX + REPORT_POOL_MAX connections.
 */
let _reportDb: NodePgDatabase<typeof schema> | undefined;
export function getReportDb() {
  if (!_reportDb) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("DATABASE_URL is not set");
    const max = Math.max(1, Math.floor(Number(process.env.REPORT_POOL_MAX ?? 4)) || 4);
    const p = new Pool({ connectionString: url, max, connectionTimeoutMillis: 20_000, application_name: "jr-reports" });
    p.on("error", (e) => logError(e, { correlationId: "db:report-pool" }));
    globalThis.__jrReportPool = p;
    _reportDb = drizzle(p, { schema });
  }
  return _reportDb;
}

let _db: NodePgDatabase<typeof schema> | undefined;
export function getDb() {
  return (_db ??= drizzle(pool(), { schema }));
}

/** Lazily-initialised proxy so importing never opens a connection at build time. */
export const db = new Proxy({} as NodePgDatabase<typeof schema>, {
  get(_t, prop) {
    const real = getDb() as unknown as Record<string | symbol, unknown>;
    const v = real[prop];
    return typeof v === "function" ? (v as (...a: unknown[]) => unknown).bind(real) : v;
  },
});

export type DB = NodePgDatabase<typeof schema>;
export type Tx = Parameters<Parameters<DB["transaction"]>[0]>[0];
/** Either the root db or a transaction — services accept this so they compose. */
export type Exec = DB | Tx;

export async function closeDb() {
  if (globalThis.__jrReportPool) {
    await globalThis.__jrReportPool.end();
    globalThis.__jrReportPool = undefined;
    _reportDb = undefined;
  }
  if (globalThis.__jrPool) {
    await globalThis.__jrPool.end();
    globalThis.__jrPool = undefined;
    _db = undefined;
  }
}

export { schema };
