/**
 * `scripts/migrate.ts` (audit K / A4): the whole chain applies to an EMPTY database, and two replicas starting at the same moment (docker-entrypoint runs the migrator on every
 * start) both succeed — the advisory lock makes the second one wait and find nothing to do. Without the lock the loser repeats non-idempotent DDL (`CREATE TABLE` without IF NOT EXISTS)
 * and the container crash-loops. Uses its own scratch database, never the shared test database.
 */
import { describe, it, expect, afterAll } from "vitest";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { Pool } from "pg";
import { migrateWithLock } from "../../scripts/migrate";

const base = new URL(process.env.DATABASE_URL!);
const NAME = "jr_migrate_lock_test";
const urlOf = (db: string) => { const u = new URL(base); u.pathname = `/${db}`; return u.toString(); };
const journalLength = () => (JSON.parse(readFileSync(path.resolve(__dirname, "../../drizzle/meta/_journal.json"), "utf8")) as { entries: unknown[] }).entries.length;

afterAll(async () => {
  const admin = new Pool({ connectionString: urlOf("postgres"), max: 1 });
  await admin.query(`drop database if exists ${NAME} with (force)`).catch(() => {});
  await admin.end();
});

describe("migrator", () => {
  it("applies every migration to an empty database, even when two instances start together", async () => {
    const admin = new Pool({ connectionString: urlOf("postgres"), max: 1 });
    await admin.query(`drop database if exists ${NAME} with (force)`);
    await admin.query(`create database ${NAME}`);
    await admin.end();

    const url = urlOf(NAME);
    const results = await Promise.allSettled([migrateWithLock(url), migrateWithLock(url), migrateWithLock(url)]);
    expect(results.map((r) => (r.status === "rejected" ? String(r.reason) : "ok"))).toEqual(["ok", "ok", "ok"]);

    const pool = new Pool({ connectionString: url, max: 1 });
    const applied = Number((await pool.query(`select count(*)::int as n from drizzle.__drizzle_migrations`)).rows[0].n);
    const tables = Number((await pool.query(`select count(*)::int as n from pg_tables where schemaname = 'public'`)).rows[0].n);
    // the lock was released: a fourth run is a no-op that does not hang
    await migrateWithLock(url);
    const again = Number((await pool.query(`select count(*)::int as n from drizzle.__drizzle_migrations`)).rows[0].n);
    await pool.end();
    expect(applied).toBe(journalLength());
    expect(again).toBe(applied);
    expect(tables).toBeGreaterThan(35);
  }, 120_000);

  it("a migration that cannot get its table lock fails fast (lock_timeout) and releases the advisory lock", async () => {
    const url = urlOf(NAME);
    const dir = mkdtempSync(path.join(tmpdir(), "jr-mig-"));
    mkdirSync(path.join(dir, "meta"));
    writeFileSync(path.join(dir, "9999_probe.sql"), `ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "_probe" text;`);
    writeFileSync(path.join(dir, "meta/_journal.json"), JSON.stringify({ version: "7", dialect: "postgresql", entries: [{ idx: 0, version: "7", when: 1999999999999, tag: "9999_probe", breakpoints: true }] }));
    const holder = new Pool({ connectionString: url, max: 1 });
    const c = await holder.connect();
    let failure = "";
    const t0 = Date.now();
    try {
      await c.query("begin");
      await c.query("lock table users in access exclusive mode");
      await migrateWithLock(url, dir, 300).catch((e: { message?: string; cause?: { message?: string } }) => { failure = `${e.message} ${e.cause?.message ?? ""}`; });
    } finally { await c.query("rollback").catch(() => {}); c.release(); await holder.end(); }
    expect(failure).toMatch(/lock timeout/i); // Drizzle wraps the Postgres message ("canceling statement due to lock timeout") in `cause`
    expect(Date.now() - t0).toBeLessThan(10_000);
    // the failed run left no half-applied state and no lock behind: the same migration now goes through
    await migrateWithLock(url, dir, 5000);
    const pool = new Pool({ connectionString: url, max: 1 });
    expect((await pool.query(`select count(*)::int as n from information_schema.columns where table_name = 'users' and column_name = '_probe'`)).rows[0].n).toBe(1);
    await pool.end();
    rmSync(dir, { recursive: true, force: true });
  }, 60_000);
});
