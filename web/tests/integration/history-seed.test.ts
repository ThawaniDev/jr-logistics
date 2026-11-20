import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { users, driverProfiles, businessProfiles, walletAccounts, ledgerEntries, requests, settings } from "@/db/schema";
import { resetDb, shutdown, mkAdmin, mkBusiness, mkDriver, mkOffice, mkRule } from "../helpers/factories";
import { moneyViolations } from "../helpers/invariants";
import { runHistory, verifyHistory, countHistory, isHistoryPresent, MARKER_KEY, DEFAULT_OPTIONS, type HistoryOptions } from "@/server/demo-history";
import { ensureAccount } from "@/server/wallet";

/**
 * End to end on the TEST database: a small history (14 days) is generated on top of a few "existing demo accounts", then checked for integrity,
 * idempotency and a clean reset that leaves the original rows exactly as they were.
 */
const OPTS: HistoryOptions = { ...DEFAULT_OPTIONS, days: 14, companies: 5, offices: 2, drivers: 24, seed: 7, end: "2026-11-18", yes: true };
const quiet = { log: () => {} };

async function priceList() {
  const admin = await mkAdmin();
  const lanes: Array<[string, number, number]> = [["sedan", 800, 550], ["dokker", 900, 620], ["hiace", 1100, 780]];
  for (const [v, price, cost] of lanes) for (const city of ["riyadh", "jeddah", "dammam"]) await mkRule(admin, { vehicleType: v, deliveryCity: city, priceCents: price + (city === "riyadh" ? 0 : 300), providerCostCents: cost + (city === "riyadh" ? 0 : 200) });
  for (const v of ["van", "dyna"]) for (const t of ["dry", "cold"]) for (const city of ["riyadh", "jeddah", "dammam"]) await mkRule(admin, { vehicleType: v, temperature: t, deliveryCity: city, priceCents: (v === "van" ? 1300 : 1600) + (t === "cold" ? 200 : 0), providerCostCents: (v === "van" ? 900 : 1150) + (t === "cold" ? 150 : 0) });
  for (const [v, price, cost] of [["sedan", 28000, 20000], ["dokker", 32000, 23000], ["hiace", 40000, 29000], ["van", 45000, 33000]] as const) {
    await mkRule(admin, { service: "car_with_driver", vehicleType: v, deliveryCity: null, priceCents: price, providerCostCents: cost });
    await mkRule(admin, { service: "car_without_driver", vehicleType: v, deliveryCity: null, priceCents: Math.round(price * 0.6), providerCostCents: 0 });
  }
  return admin;
}

/** The demo accounts that "already exist" before the history is generated. */
async function existingDemo() {
  const biz = await mkBusiness({ fundsCents: 20_000_00, name: "Demo Business" });
  const office = await mkOffice();
  const d1 = await mkDriver({ vehicle: "sedan" }), d2 = await mkDriver({ vehicle: "dokker", officeId: office.id }), d3 = await mkDriver({ vehicle: "van", temp: "dry" });
  const ids = [biz.id, office.id, d1.id, d2.id, d3.id];
  await db.update(users).set({ isDemo: true, source: "seed" }).where(sql`${users.id} in (${sql.join(ids.map((i) => sql`${i}`), sql`, `)})`);
  return { biz, office, drivers: [d1, d2, d3], ids };
}

/** Every column of the rows that must survive untouched. */
async function snapshotOriginal(ids: string[]) {
  const q = (t: string, col: string) => db.execute(sql`select to_jsonb(x) j from ${sql.raw(t)} x where ${sql.raw(col)} in (${sql.join(ids.map((i) => sql`${i}`), sql`, `)}) order by ${sql.raw(col)}`).then((r) => r.rows.map((x) => x.j));
  return {
    users: await q("users", "id"), drivers: await q("driver_profiles", "user_id"), businesses: await q("business_profiles", "user_id"), offices: await q("office_profiles", "user_id"),
    wallets: await db.execute(sql`select to_jsonb(w) j from wallet_accounts w where owner_id in (${sql.join(ids.map((i) => sql`${i}`), sql`, `)}) order by owner_id`).then((r) => r.rows.map((x) => x.j)),
    ledger: await db.execute(sql`select count(*)::int n, coalesce(sum(available_delta_cents),0)::int a from ledger_entries`).then((r) => r.rows[0]),
  };
}

describe("demo history generator (integration)", () => {
  let original: Awaited<ReturnType<typeof snapshotOriginal>>;
  let existing: Awaited<ReturnType<typeof existingDemo>>;
  let first: Awaited<ReturnType<typeof runHistory>>;

  beforeAll(async () => {
    await resetDb();
    await priceList();
    existing = await existingDemo();
    original = await snapshotOriginal(existing.ids);
    first = await runHistory(OPTS, quiet);
  }, 240_000);
  afterAll(shutdown);

  it("generates a populated, integrity-checked history (reconciliation PASS)", async () => {
    expect(first.mode).toBe("write");
    expect(first.verify?.ok, JSON.stringify(first.verify?.checks.filter((c) => !c.ok))).toBe(true);
    const c = first.counts;
    for (const t of ["users", "requests", "offers", "shipments", "shipments", "shipment_events", "job_events", "settlements", "invoices", "ledger_entries", "tickets", "login_events", "message_log", "driver_availability_log", "metric_snapshots", "notifications", "audit_logs", "documents"])
      expect(c[t], t).toBeGreaterThan(0);
    expect((await moneyViolations())).toEqual([]);
    expect((await verifyHistory(db)).ok).toBe(true);
    const marker = await db.select().from(settings).where(eq(settings.key, MARKER_KEY));
    expect(marker).toHaveLength(1);
  });

  it("marks everything it creates: generated users stay off the demo card, use the fictitious phone block, refs are tagged", async () => {
    const gen = await db.execute(sql`select count(*)::int n, count(*) filter (where is_demo)::int demo, count(*) filter (where source <> 'seed')::int notseed, count(*) filter (where phone is not null and phone not like '+9665001%')::int badphone
      from users where id::text like '5eed1157-%-4000-8000-%'`);
    const row = gen.rows[0] as { n: number; demo: number; notseed: number; badphone: number };
    expect(row.n).toBeGreaterThan(20);
    expect([row.demo, row.notseed, row.badphone]).toEqual([0, 0, 0]);
    const refs = await db.execute(sql`select count(*)::int n from requests where id::text like '5eed1157-%' and ref !~ '^JRH-[0-9]{6}$'`);
    expect((refs.rows[0] as { n: number }).n).toBe(0);
    const keys = await db.execute(sql`select count(*)::int n from ledger_entries where idempotency_key like 'hist:%'`);
    expect((keys.rows[0] as { n: number }).n).toBe(first.counts.ledger_entries);
  });

  it("gives the existing demo accounts history without rewriting their rows", async () => {
    const mine = await db.execute(sql`select count(*)::int n from requests where business_id = ${existing.biz.id} and id::text like '5eed1157-%'`);
    expect((mine.rows[0] as { n: number }).n).toBeGreaterThan(0);
    const drivers = await db.execute(sql`select count(distinct o.driver_id)::int n from offers o where o.driver_id in (${sql.join(existing.drivers.map((d) => sql`${d.id}`), sql`, `)}) and o.id::text like '5eed1157-%'`);
    expect((drivers.rows[0] as { n: number }).n).toBeGreaterThan(0);
    // original user rows are byte-identical
    const now = await snapshotOriginal(existing.ids);
    expect(now.users).toEqual(original.users);
    expect(now.offices).toEqual(original.offices);
  });

  it("books money the platform's way: every wallet = its ledger, margin booked on the platform account, top-ups come first", async () => {
    const plat = await db.execute(sql`select available_cents::int a from wallet_accounts where kind = 'platform'`);
    expect((plat.rows[0] as { a: number }).a).toBeGreaterThan(0);
    const first = await db.execute(sql`select count(*)::int n from (select account_id, min(created_at) m, (array_agg(kind order by created_at))[1] k from ledger_entries where idempotency_key like 'hist:%' group by account_id) x where k not in ('topup','payout','withdrawal_hold','platform_fee')`);
    expect((first.rows[0] as { n: number }).n).toBe(0);
    const biz = await db.execute(sql`select count(*)::int n from wallet_accounts w join ledger_entries l on l.account_id = w.id where w.owner_id = ${existing.biz.id} and l.idempotency_key like 'hist:%'`);
    expect((biz.rows[0] as { n: number }).n).toBeGreaterThan(0);
  });

  it("looks like a real platform: realistic status mix, weekday pattern, COD, proofs, failures with real reasons", async () => {
    const st = Object.fromEntries((await db.execute(sql`select status, count(*)::int n from requests where id::text like '5eed1157-%' group by 1`)).rows.map((r) => [(r as { status: string }).status, (r as { n: number }).n]));
    expect(st.completed ?? 0).toBeGreaterThan(5);
    const sh = (await db.execute(sql`select status, proof_type, fail_reason, (cod_cents > 0) cod from shipments where id::text like '5eed1157-%'`)).rows as Array<{ status: string; proof_type: string | null; fail_reason: string | null; cod: boolean }>;
    expect(sh.filter((s) => s.status === "delivered").length).toBeGreaterThan(sh.length * 0.2);
    expect(sh.some((s) => s.cod)).toBe(true);
    expect(new Set(sh.filter((s) => s.status === "delivered").map((s) => s.proof_type)).has("otp")).toBe(true);
    const reasons = new Set(sh.map((s) => s.fail_reason).filter(Boolean));
    for (const r of reasons) expect(["unreachable", "refused", "wrong_address", "out_of_zone", "closed", "no_otp", "damaged", "gate_access", "other", "driver_unavailable", "unfulfilled", "not_fully_staffed", "driver_cancelled", "request_cancelled"]).toContain(r);
    const dow = (await db.execute(sql`select extract(dow from created_at at time zone 'Asia/Riyadh')::int d, count(*)::int n from requests where id::text like '5eed1157-%' group by 1`)).rows as Array<{ d: number; n: number }>;
    const byDow = new Map(dow.map((r) => [r.d, r.n]));
    expect((byDow.get(5) ?? 0) + (byDow.get(6) ?? 0)).toBeLessThan(([0, 1, 2, 3, 4].reduce((a, d) => a + (byDow.get(d) ?? 0), 0)) * 0.6);
  });

  it("is idempotent: running again without --reset changes nothing", async () => {
    const before = await countHistory(db);
    const again = await runHistory(OPTS, quiet);
    expect(again.mode).toBe("skipped");
    expect(await countHistory(db)).toEqual(before);
    expect((await isHistoryPresent(db)).present).toBe(true);
  });

  it("--reset removes only the generated history and restores every original row", async () => {
    const res = await runHistory({ ...OPTS, reset: true }, quiet);
    expect(res.mode).toBe("reset");
    const left = await countHistory(db);
    for (const [t, n] of Object.entries(left)) expect(n, t).toBe(0);
    expect((await isHistoryPresent(db)).present).toBe(false);
    const now = await snapshotOriginal(existing.ids);
    expect(now).toEqual(original);
    expect(await moneyViolations()).toEqual([]);
    expect((await db.select().from(requests))).toHaveLength(0);
  });

  it("--dry-run reads but never writes (also when combined with --reset); it refuses to run outside demo mode", async () => {
    const dry = await runHistory({ ...OPTS, dryRun: true, yes: false }, quiet);
    expect(dry.mode).toBe("dry-run");
    expect(dry.counts.requests).toBeGreaterThan(0);
    expect(dry.counts.ledger_entries).toBeGreaterThan(0);
    for (const n of Object.values(await countHistory(db))) expect(n).toBe(0);
    await runHistory(OPTS, quiet);
    const before = await countHistory(db);
    const preview = await runHistory({ ...OPTS, dryRun: true, reset: true, yes: false }, quiet);
    expect(preview.mode).toBe("dry-run");
    expect(preview.counts).toEqual(before);
    expect(await countHistory(db)).toEqual(before);
    await runHistory({ ...OPTS, reset: true }, quiet);
    // the gates also hold for the library entry point
    const demo = process.env.DEMO_MODE;
    process.env.DEMO_MODE = "false";
    await expect(runHistory(OPTS, quiet)).rejects.toThrow(/DEMO_MODE/);
    process.env.DEMO_MODE = demo;
    await expect(runHistory({ ...OPTS, yes: false }, quiet)).rejects.toThrow(/--yes/);
    for (const n of Object.values(await countHistory(db))) expect(n).toBe(0);
  }, 240_000);

  it("is deterministic: the same seed produces the same data", async () => {
    const a = await runHistory(OPTS, quiet);
    const fp = async () => (await db.execute(sql`select md5(string_agg(ref || status || coalesce(total_cents::text,'') || created_at::text, ',' order by ref)) h, count(*)::int n from requests where id::text like '5eed1157-%'`)).rows[0] as { h: string; n: number };
    const f1 = await fp(), ledger1 = (await db.execute(sql`select md5(string_agg(idempotency_key || available_delta_cents::text || reserved_delta_cents::text, ',' order by idempotency_key)) h from ledger_entries where idempotency_key like 'hist:%'`)).rows[0];
    await runHistory({ ...OPTS, reset: true }, quiet);
    const b = await runHistory(OPTS, quiet);
    expect(b.counts).toEqual(a.counts);
    expect(await fp()).toEqual(f1);
    expect((await db.execute(sql`select md5(string_agg(idempotency_key || available_delta_cents::text || reserved_delta_cents::text, ',' order by idempotency_key)) h from ledger_entries where idempotency_key like 'hist:%'`)).rows[0]).toEqual(ledger1);
    await runHistory({ ...OPTS, reset: true }, quiet);
    // a different seed gives a different world
    const c = await runHistory({ ...OPTS, seed: 8 }, quiet);
    expect(c.counts.requests).not.toBe(undefined);
    expect(JSON.stringify(c.counts)).not.toEqual(JSON.stringify(a.counts));
    await runHistory({ ...OPTS, seed: 8, reset: true }, quiet);
  }, 240_000);

  it("never touches rows it did not create (a real order made before the history survives the reset)", async () => {
    const { mkBusiness: mb } = await import("../helpers/factories");
    const real = await mb({ fundsCents: 5_000_00, name: "Real customer" });
    const acct = await ensureAccount(real.id);
    await runHistory(OPTS, quiet);
    await runHistory({ ...OPTS, reset: true }, quiet);
    const [u] = await db.select().from(users).where(eq(users.id, real.id));
    expect(u?.name).toBe("Real customer");
    const [w] = await db.select().from(walletAccounts).where(eq(walletAccounts.id, acct.id));
    expect(w.availableCents).toBe(5_000_00);
    const led = await db.select().from(ledgerEntries).where(eq(ledgerEntries.accountId, acct.id));
    expect(led).toHaveLength(1);
    const [bp] = await db.select().from(businessProfiles).where(eq(businessProfiles.userId, real.id));
    expect(bp.companyName).toBe("Co Real customer");
    const dp = await db.select().from(driverProfiles).where(eq(driverProfiles.userId, existing.drivers[0].id));
    expect(dp[0].ratingCount).toBe(0);
  }, 240_000);
});
