import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

/**
 * Migration integrity (audit K / A4). `drizzle-kit migrate` applies a migration only when its journal `when` is newer than the last applied one, so a
 * `when` that is not strictly increasing is silently SKIPPED on every database that already ran a later one. The SQL files and the journal must also list the same set.
 */
const DIR = path.resolve(__dirname, "../../drizzle");
const journal = JSON.parse(readFileSync(path.join(DIR, "meta/_journal.json"), "utf8")) as { entries: Array<{ idx: number; when: number; tag: string; breakpoints: boolean }> };
const files = readdirSync(DIR).filter((f) => f.endsWith(".sql")).map((f) => f.replace(/\.sql$/, ""));

describe("drizzle journal", () => {
  it("has strictly increasing `when` and consecutive idx", () => {
    journal.entries.forEach((e, i) => {
      expect(e.idx, `idx of ${e.tag}`).toBe(i);
      if (i > 0) expect(e.when, `${e.tag} must be newer than ${journal.entries[i - 1].tag}`).toBeGreaterThan(journal.entries[i - 1].when);
    });
  });
  it("lists exactly the SQL files on disk, and every tag is unique", () => {
    const tags = journal.entries.map((e) => e.tag);
    expect(new Set(tags).size).toBe(tags.length);
    expect([...tags].sort()).toEqual([...files].sort());
  });
  it("new migrations (0023 and later) never use CREATE INDEX CONCURRENTLY (the migrator runs them in one transaction) and set a lock_timeout when they take table locks", () => {
    for (const e of journal.entries.filter((x) => x.idx >= 23)) {
      const sql = readFileSync(path.join(DIR, `${e.tag}.sql`), "utf8").replace(/--.*$/gm, "");
      expect(/create\s+(unique\s+)?index\s+concurrently/i.test(sql), `${e.tag} uses CONCURRENTLY inside the migrator transaction`).toBe(false);
      if (/\balter\s+table\b|\bcreate\s+(unique\s+)?index\b|\bdrop\s+index\b/i.test(sql)) expect(/set\s+local\s+lock_timeout/i.test(sql), `${e.tag} should SET LOCAL lock_timeout`).toBe(true);
    }
  });
});
