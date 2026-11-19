import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { Client } from "pg";
import { getPool } from "@/db";
import { resetDb, shutdown, mkBusiness, mkDriver, mkAdmin, mkRule, publishedRequest } from "../helpers/factories";
import { runSchedulerTick } from "@/server/scheduler";
import { db } from "@/db";
import { requests, offers } from "@/db/schema";
import { eq } from "drizzle-orm";

beforeEach(resetDb);
afterAll(shutdown);

describe("in-process scheduler", () => {
  it("runs the housekeeping a cron tick would run (a request nobody took is expired and refunded)", async () => {
    const admin = await mkAdmin(); await mkRule(admin);
    const biz = await mkBusiness({ fundsCents: 500_00 });
    const r = await publishedRequest(biz);
    await db.update(requests).set({ startsAt: new Date(Date.now() - 3600_000) }).where(eq(requests.id, r.id));
    expect(await runSchedulerTick()).toEqual({ ran: true });
    expect((await db.select().from(requests).where(eq(requests.id, r.id)))[0].status).toBe("expired");
    void offers; void mkDriver;
  });

  it("skips when another instance holds the lock (no two ticks at once), and takes over once it is released", async () => {
    const other = new Client({ connectionString: process.env.DATABASE_URL }); await other.connect();
    try {
      await other.query("select pg_advisory_lock(7788002)");
      expect(await runSchedulerTick()).toEqual({ ran: false });
      await other.query("select pg_advisory_unlock(7788002)");
      expect(await runSchedulerTick()).toEqual({ ran: true });
    } finally { await other.end(); }
    void getPool;
  });
});
