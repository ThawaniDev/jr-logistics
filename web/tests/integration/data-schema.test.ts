/**
 * Data-layer guards (audit K / A4): the integrity constraints of migration 0023 really refuse bad rows, no new redundant index sneaks in, and everything `schema.ts` declares
 * (indexes, CHECKs) exists in the migrated database.
 */
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { is, sql } from "drizzle-orm";
import { getTableConfig, PgTable } from "drizzle-orm/pg-core";
import { db } from "@/db";
import * as schema from "@/db/schema";
import { invoices, ledgerEntries, loginEvents, notifications, requests, shipments, users, walletAccounts } from "@/db/schema";
import { ensureAccount, platformAccount, post } from "@/server/wallet";
import { NOTIFICATION_RETENTION, pruneCaptureData, pruneNotifications, redactUnknownLoginIdentifiers, UNKNOWN_LOGIN_IDENTIFIER_DAYS } from "@/server/snapshots";
import { mkAdmin, mkBusiness, publishedRequest, mkRule, resetDb, shutdown } from "../helpers/factories";

beforeEach(resetDb);
afterAll(shutdown);

/** The Postgres error code behind a Drizzle query failure. */
const pgCode = async (p: Promise<unknown>) => { try { await p; return null; } catch (e) { return (e as { cause?: { code?: string } })?.cause?.code ?? (e as { code?: string }).code ?? "unknown"; } };
const CHECK_VIOLATION = "23514", UNIQUE_VIOLATION = "23505";

describe("migration 0023 constraints", () => {
  it("refuses a second platform wallet, a user wallet without an owner and a platform wallet with one", async () => {
    const biz = await mkBusiness();
    await db.insert(walletAccounts).values({ kind: "platform" });
    expect(await pgCode(db.insert(walletAccounts).values({ kind: "platform" }))).toBe(UNIQUE_VIOLATION);
    expect(await pgCode(db.insert(walletAccounts).values({ kind: "user" }))).toBe(CHECK_VIOLATION);
    expect(await pgCode(db.insert(walletAccounts).values({ kind: "platform", ownerId: biz.id }))).toBe(CHECK_VIOLATION);
    expect(await pgCode(db.insert(walletAccounts).values({ kind: "bank", ownerId: null }))).toBe(CHECK_VIOLATION);
  });

  it("refuses upper-case sign-in names (the unique index is case-sensitive, every lookup lower-cases) but does not constrain e-mail: legacy rows may hold mixed-case addresses", async () => {
    const base = { role: "driver", name: "X", passwordHash: "x" };
    expect(await pgCode(db.insert(users).values({ ...base, phone: "+966500009001", username: "Mixed.Case" }))).toBe(CHECK_VIOLATION);
    expect(await pgCode(db.insert(users).values({ ...base, phone: "+966500009003", username: "fine.name", email: "Legacy.Mixed@B.com" }))).toBeNull();
    expect(await pgCode(db.update(users).set({ username: "Fine.Name" }).where(sql`username = 'fine.name'`))).toBe(CHECK_VIOLATION);
    expect(await pgCode(db.update(users).set({ lastSeenAt: new Date() }).where(sql`username = 'fine.name'`))).toBeNull(); // updates of such a row keep working
  });

  it("invoices must add up and be non-negative; settlements may not record negative VAT or refunds; parcels may not carry negative cash", async () => {
    const admin = await mkAdmin(); await mkRule(admin);
    const biz = await mkBusiness({ fundsCents: 5000_00 });
    const r = await publishedRequest(biz);
    const inv = { number: "T-1", requestId: r.id, businessId: biz.id, subtotalCents: 8696, vatCents: 1304, totalCents: 10000, vatPct: 15 };
    expect(await pgCode(db.insert(invoices).values(inv))).toBeNull();
    expect(await pgCode(db.insert(invoices).values({ ...inv, number: "T-2", subtotalCents: 8000 }))).toBe(CHECK_VIOLATION); // 8000 + 1304 ≠ 10000
    expect(await pgCode(db.insert(invoices).values({ ...inv, number: "T-3", subtotalCents: 10500, vatCents: -500, totalCents: 10000 }))).toBe(CHECK_VIOLATION);

    const [sh] = await db.select().from(shipments).where(sql`request_id = ${r.id}`).limit(1);
    if (sh) {
      expect(await pgCode(db.update(shipments).set({ codCents: -1 }).where(sql`id = ${sh.id}`))).toBe(CHECK_VIOLATION);
      expect(await pgCode(db.update(shipments).set({ codCollectedCents: -5 }).where(sql`id = ${sh.id}`))).toBe(CHECK_VIOLATION);
    }
    expect(await pgCode(db.update(requests).set({ totalCents: -1 }).where(sql`id = ${r.id}`))).toBe(CHECK_VIOLATION);
    expect(await pgCode(db.update(requests).set({ unitPriceCents: -1 }).where(sql`id = ${r.id}`))).toBe(CHECK_VIOLATION);
    // settlements: the existing columns have their own check; the two added ones are vat and refund
    const settleCheck = await db.execute(sql`select pg_get_constraintdef(oid) as d from pg_constraint where conname = 'settlements_vat_refund_chk'`);
    expect((settleCheck.rows[0] as { d: string }).d).toMatch(/vat_cents >= 0.*refund_cents >= 0/);
  });
});

describe("index hygiene", () => {
  it("no non-unique index is an exact duplicate or a leading prefix of another index on the same table", async () => {
    const res = await db.execute(sql`
      with ix as (
        select i.indexrelid, i.indrelid::regclass::text as tbl, c.relname as idx, i.indisunique as uniq, i.indisprimary as pk, i.indkey::text as keys,
               coalesce(pg_get_expr(i.indpred, i.indrelid), '') as pred, coalesce(pg_get_expr(i.indexprs, i.indrelid), '') as expr, i.indoption::text as opt
        from pg_index i join pg_class c on c.oid = i.indexrelid join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public')
      select a.tbl, a.idx as redundant, b.idx as covered_by
      from ix a join ix b on a.tbl = b.tbl
      where a.indexrelid <> b.indexrelid and not a.uniq and not a.pk and a.pred = b.pred and a.expr = b.expr
        and (b.keys = a.keys or b.keys like a.keys || ' %') and (a.keys <> b.keys or a.indexrelid > b.indexrelid)
      order by 1, 2`);
    expect(res.rows).toEqual([]);
  });

  it("every index and CHECK constraint declared in schema.ts exists in the migrated database", async () => {
    const dbIdx = new Set((await db.execute(sql`select indexname from pg_indexes where schemaname = 'public'`)).rows.map((r) => (r as { indexname: string }).indexname));
    const dbChecks = new Set((await db.execute(sql`select conname from pg_constraint where connamespace = 'public'::regnamespace and contype = 'c'`)).rows.map((r) => (r as { conname: string }).conname));
    const missing: string[] = [];
    for (const t of Object.values(schema)) {
      if (!is(t, PgTable)) continue;
      const c = getTableConfig(t);
      for (const i of c.indexes) if (!dbIdx.has(i.config.name!)) missing.push(`index ${i.config.name} (${c.name})`);
      for (const k of c.checks) if (!dbChecks.has(k.name)) missing.push(`check ${k.name} (${c.name})`);
    }
    expect(missing).toEqual([]);
  });
});

describe("capture retention", () => {
  it("erases what was typed into the username box of failed sign-ins that matched no account after 30 days, and nothing else", async () => {
    const biz = await mkBusiness();
    const old = new Date(Date.now() - (UNKNOWN_LOGIN_IDENTIFIER_DAYS + 5) * 864e5), recent = new Date(Date.now() - 2 * 864e5);
    await db.insert(loginEvents).values([
      { userId: null, identifier: "MyS3cretPassw0rd", method: "password", success: false, failureReason: "unknown_user", createdAt: old },     // a mistyped password: erase
      { userId: null, identifier: "someone", method: "password", success: false, failureReason: "unknown_user", createdAt: recent },          // too recent: keep
      { userId: biz.id, identifier: "known.user", method: "password", success: false, failureReason: "bad_password", createdAt: old },         // a real account: keep
      { userId: biz.id, identifier: "known.user", method: "password", success: true, createdAt: old },                                       // a success: keep
    ]);
    expect(await redactUnknownLoginIdentifiers()).toBe(1);
    const rows = await db.select().from(loginEvents);
    expect(rows).toHaveLength(4); // the rows (and so the failure counts of the Growth report) stay
    expect(rows.filter((r) => r.identifier === null)).toHaveLength(1);
    expect(rows.find((r) => r.identifier === null)).toMatchObject({ userId: null, success: false, failureReason: "unknown_user" });
    expect(rows.map((r) => r.identifier).filter(Boolean).sort()).toEqual(["known.user", "known.user", "someone"]);
    expect(await redactUnknownLoginIdentifiers()).toBe(0); // idempotent
    expect(await pruneCaptureData()).toEqual({ locations: 0, logins: 0, messages: 0, notifications: 0 });
  });
});

describe("notification retention", () => {
  it("deletes read notifications after 90 days and any notification after 12 months, keeps the rest, and runs in the hourly capture prune", async () => {
    const biz = await mkBusiness();
    const ago = (d: number) => new Date(Date.now() - d * 864e5);
    const n = (title: string, createdDaysAgo: number, read: boolean) => ({ userId: biz.id, type: "t", title, createdAt: ago(createdDaysAgo), readAt: read ? ago(createdDaysAgo - 1) : null });
    const { readDays, anyDays } = NOTIFICATION_RETENTION;
    expect([readDays, anyDays]).toEqual([90, 365]);
    await db.insert(notifications).values([
      n("read-old", readDays + 10, true),            // read, older than 90 d: deleted
      n("read-recent", readDays - 10, true),         // read, newer: kept
      n("unread-old", readDays + 10, false),         // unread, older than 90 d but newer than 12 months: kept (someone may still want it)
      n("unread-ancient", anyDays + 10, false),      // older than 12 months: deleted whether read or not
      n("read-ancient", anyDays + 10, true),         // deleted
      n("unread-recent", 1, false),                  // kept
    ]);
    expect(await pruneNotifications()).toBe(3);
    expect((await db.select().from(notifications)).map((r) => r.title).sort()).toEqual(["read-recent", "unread-old", "unread-recent"]);
    expect(await pruneNotifications()).toBe(0); // idempotent
    await db.insert(notifications).values(n("read-old-2", readDays + 1, true));
    expect((await pruneCaptureData()).notifications).toBe(1); // part of the hourly prune the maintenance tick runs
  });
});

describe("migration 0024: bigint wallets and an append-only ledger", () => {
  it("the platform wallet keeps accepting margin past the old integer limit (SAR 21 474 836.47)", async () => {
    const plat = await platformAccount(db);
    await db.update(walletAccounts).set({ availableCents: 2_147_483_000 }).where(sql`id = ${plat.id}`);
    expect((await post(db, { accountId: plat.id, kind: "platform_fee", available: 5_000, idempotencyKey: "t:big:1" })).applied).toBe(true);
    const [w] = await db.select().from(walletAccounts).where(sql`id = ${plat.id}`);
    expect(w.availableCents).toBe(2_147_488_000); // drizzle maps the bigint column back to a JS number
    expect(typeof w.availableCents).toBe("number");
    const cols = await db.execute(sql`select column_name, data_type from information_schema.columns where table_name = 'wallet_accounts' and column_name in ('available_cents', 'reserved_cents', 'held_cents')`);
    expect((cols.rows as Array<{ data_type: string }>).map((r) => r.data_type)).toEqual(["bigint", "bigint", "bigint"]);
  });

  it("refuses to delete a ledger entry or change its amounts, but allows backdating and a sanctioned maintenance delete", async () => {
    const biz = await mkBusiness({ fundsCents: 5_000 });
    const acct = await ensureAccount(biz.id);
    const [entry] = await db.select().from(ledgerEntries).where(sql`account_id = ${acct.id}`).limit(1);
    expect(entry).toBeTruthy();
    expect(await pgCode(db.delete(ledgerEntries).where(sql`id = ${entry.id}`))).toBe(CHECK_VIOLATION);
    expect(await pgCode(db.update(ledgerEntries).set({ availableDeltaCents: 1 }).where(sql`id = ${entry.id}`))).toBe(CHECK_VIOLATION);
    expect(await pgCode(db.update(ledgerEntries).set({ accountId: (await platformAccount(db)).id }).where(sql`id = ${entry.id}`))).toBe(CHECK_VIOLATION);
    expect(await pgCode(db.update(ledgerEntries).set({ idempotencyKey: "other" }).where(sql`id = ${entry.id}`))).toBe(CHECK_VIOLATION);
    expect(await pgCode(db.update(ledgerEntries).set({ createdAt: new Date(Date.now() - 864e5), note: "backdated" }).where(sql`id = ${entry.id}`))).toBeNull();
    await db.transaction(async (tx) => {
      await tx.execute(sql`select set_config('jr.ledger_maintenance', 'on', true)`);
      await tx.delete(ledgerEntries).where(sql`id = ${entry.id}`);
    });
    expect(await db.select().from(ledgerEntries).where(sql`id = ${entry.id}`)).toHaveLength(0);
    // the flag was local to that transaction: the guard is back
    const [again] = await db.select().from(ledgerEntries).where(sql`account_id = ${acct.id}`).limit(1);
    if (again) expect(await pgCode(db.delete(ledgerEntries).where(sql`id = ${again.id}`))).toBe(CHECK_VIOLATION);
  });
});
