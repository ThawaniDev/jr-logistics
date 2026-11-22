import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

/**
 * A business day is a RIYADH day. `current_date`, `now()::date` and a bare `date_trunc` use the database SESSION time zone: a UTC database is a day behind from 00:00 to
 * 03:00 Riyadh (the dev database runs in Asia/Riyadh, so a test on it cannot see the difference). Reports must derive days through `bucketSql` / `... at time zone 'Asia/Riyadh'`
 * (audit K / A4). This test reads the report sources instead of the database for exactly that reason.
 */
const DIRS = ["analytics", "export"].map((d) => path.resolve(__dirname, "../../src/server", d));
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

describe("analytics / export SQL never uses the session's calendar day", () => {
  const files = DIRS.flatMap((d) => readdirSync(d).filter((f) => f.endsWith(".ts")).map((f) => path.join(d, f)));
  it("has no current_date / current_timestamp / localtimestamp / now()::date", () => {
    const hits: string[] = [];
    for (const f of files) {
      const src = strip(readFileSync(f, "utf8"));
      for (const m of src.matchAll(/\bcurrent_date\b|\bcurrent_timestamp\b|\blocaltimestamp\b|\bnow\(\)\s*::\s*date\b/gi)) hits.push(`${path.basename(f)}: ${m[0]}`);
    }
    expect(hits).toEqual([]);
  });
  it("every date_trunc / extract(dow|hour) on a timestamp names the Riyadh zone (or runs on an epoch difference)", () => {
    const bad: string[] = [];
    for (const f of files) {
      const src = strip(readFileSync(f, "utf8"));
      for (const m of src.matchAll(/date_trunc\(\s*'(day|week|month|hour)'\s*,\s*([^)]*)\)/gi)) {
        const arg = m[2];
        if (!/Asia\/Riyadh|\blocal\b|\$\{local\}|sl\.h|c\.s|generate_series/.test(arg) && !/at time zone/.test(src.slice(m.index!, m.index! + 160))) bad.push(`${path.basename(f)}: ${m[0]}`);
      }
    }
    expect(bad).toEqual([]);
  });
});
