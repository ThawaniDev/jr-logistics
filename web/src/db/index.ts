import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema";

declare global {
  // eslint-disable-next-line no-var
  var __jrPool: Pool | undefined;
}

function pool(): Pool {
  if (!globalThis.__jrPool) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("DATABASE_URL is not set");
    globalThis.__jrPool = new Pool({ connectionString: url, max: Number(process.env.DB_POOL_MAX ?? 10) });
  }
  return globalThis.__jrPool;
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
  if (globalThis.__jrPool) {
    await globalThis.__jrPool.end();
    globalThis.__jrPool = undefined;
    _db = undefined;
  }
}

export { schema };
