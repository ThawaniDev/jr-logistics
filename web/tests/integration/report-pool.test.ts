import { afterAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { db, getReportDb, closeDb } from "@/db";
import { rows } from "@/server/analytics/guard";

afterAll(closeDb);

describe("analytics reports run on their own pool", () => {
  it("a report statement runs on the report pool (application_name), everything else on the API pool", async () => {
    const [r] = await rows<{ n: string }>(sql`select current_setting('application_name') as n`);
    expect(r.n).toBe("jr-reports");
    const api = await db.execute(sql`select current_setting('application_name') as n`);
    expect(api.rows[0].n).not.toBe("jr-reports");
  });

  it("report statements waiting for a connection never delay the API pool", async () => {
    // keep every report connection busy (REPORT_POOL_MAX, default 4) for a moment, then time a trivial statement on the API pool
    const busy = Array.from({ length: 6 }, () => getReportDb().execute(sql`select pg_sleep(0.7)`));
    await new Promise((r) => setTimeout(r, 100));
    const t0 = Date.now();
    await db.execute(sql`select 1`);
    expect(Date.now() - t0).toBeLessThan(300);
    await Promise.all(busy);
  });
});
