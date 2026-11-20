import { sql } from "drizzle-orm";
import { db, type Exec } from "@/db";
import { platformAccount } from "@/server/wallet";
import { emitAccounts, emitProfiles } from "./accounts";
import { DAY, HOUR, hourStart, ksaDayStart, parseKsaDay } from "./calendar";
import { simulateDays } from "./days";
import { hid, IdGen } from "./ids";
import { loadBaseline, type Baseline } from "./load";
import { planMoney } from "./money";
import { assertSafe, describeDatabase, type HistoryOptions } from "./options";
import { PLACEHOLDER_KEY, placeholderPng } from "./placeholder";
import { Rng } from "./prng";
import { isHistoryPresent, MARKER_KEY, removePlaceholder, resetHistory } from "./reset";
import { buildSnapshots } from "./snapshots";
import { emitSupport } from "./support";
import { emptyIntervals, type Ctx } from "./types";
import { SnapshotAcc } from "./acc";
import { countHistory, verifyHistory, type VerifyResult } from "./verify";
import { getTableName } from "drizzle-orm";
import { applyPostings, Sink, TABLES, type TableName } from "./writer";
import { buildWorld } from "./world";

export interface RunResult {
  mode: "write" | "dry-run" | "reset" | "skipped";
  seconds: number; counts: Record<string, number>; verify?: VerifyResult; removed?: Record<string, number>; message?: string;
  window?: { from: string; to: string; days: number }; money?: { topups: number; withdrawals: number; postings: number }; stats?: Record<string, number>;
}
export interface RunIO { log: (msg: string) => void; /** keep the data even when the integrity check fails (debugging only) */ keepOnFail?: boolean }

export class HistoryIntegrityError extends Error {
  constructor(readonly result: VerifyResult) { super(`Integrity check FAILED: ${result.checks.filter((c) => !c.ok).map((c) => `${c.name} — ${c.detail}`).join(" | ")}`); }
}

export function windowOf(opts: Pick<HistoryOptions, "days" | "end">, now = Date.now()) {
  const todayStart = ksaDayStart(now);
  const endDay = opts.end ? parseKsaDay(opts.end)! : todayStart;
  const asOf = endDay >= todayStart ? hourStart(now) : endDay + DAY - 1;
  const lastDay = endDay > todayStart ? todayStart : endDay;
  const windowStart = lastDay - (opts.days - 1) * DAY;
  return { windowStart, windowEnd: lastDay + DAY, asOf: Math.max(asOf, windowStart + DAY) };
}


/** Everything the simulation needs, built from the options and a look at the database (or a hand-made baseline in tests). */
export function buildContext(opts: HistoryOptions, base: Baseline, sink: Sink, log: (m: string) => void = () => {}, now = Date.now()): Ctx {
  const win = windowOf(opts, now);
  const rng = new Rng(opts.seed);
  const ctx: Ctx = {
    opts, rng, ids: new IdGen(), sink, windowStart: win.windowStart, windowEnd: win.windowEnd, asOf: win.asOf, days: opts.days, cities: base.cities, vatPct: base.vatPct, base,
    w: null as never, postings: [], ticketSeeds: [], complaintSeeds: [], noteSeeds: [], iv: emptyIntervals(), acc: new SnapshotAcc(), platformWalletId: "dry-run-platform", jobRefs: [], suspensions: [], stats: {}, restoreWallets: [], log,
  };
  ctx.w = buildWorld({ rng: rng.fork("world"), ids: ctx.ids, windowStart: win.windowStart, asOf: win.asOf, base, companies: opts.companies, offices: opts.offices, drivers: opts.drivers });
  return ctx;
}

export async function runHistory(opts: HistoryOptions, io: RunIO = { log: console.log }): Promise<RunResult> {
  assertSafe(opts);
  const t0 = Date.now();
  const log = io.log;
  const target = describeDatabase(process.env.DATABASE_URL);
  log(`Target database: ${target.label}`);

  if (opts.reset && opts.dryRun) {
    const counts = await countHistory(db);
    const total = Object.values(counts).reduce((a, b) => a + b, 0);
    log(`Dry run: --reset would remove ${total.toLocaleString()} generated rows (${Object.entries(counts).filter(([, n]) => n).map(([k, n]) => `${k} ${n}`).join(", ") || "none"}). Nothing was changed.`);
    return { mode: "dry-run", seconds: (Date.now() - t0) / 1000, counts, message: "reset preview" };
  }
  if (opts.reset) {
    const removed = await db.transaction(async (tx) => { await tx.execute(sql`select pg_advisory_xact_lock(7788002)`); return resetHistory(tx); });
    await removePlaceholder();
    const total = Object.values(removed).reduce((a, b) => a + b, 0);
    log(`Reset: removed ${total.toLocaleString()} generated rows (${Object.entries(removed).filter(([, n]) => n).map(([k, n]) => `${k} ${n}`).join(", ")})`);
    return { mode: "reset", seconds: (Date.now() - t0) / 1000, counts: {}, removed, message: "history removed" };
  }

  const base = await loadBaseline(db, opts.dryRun);
  if (!opts.dryRun) {
    const there = await isHistoryPresent(db);
    if (there.present) {
      const counts = await countHistory(db);
      log(`History is already present (${there.users} generated users, ${there.requests} generated requests): nothing to do. Run with --reset first to regenerate.`);
      return { mode: "skipped", seconds: (Date.now() - t0) / 1000, counts, message: "already present" };
    }
  }
  if (!base.rules.rows.some((r) => r.service === "delivery_driver")) throw new Error("No approved delivery price exists: run `npm run db:seed` first (the history is priced with the platform's own pricing rules).");

  const sink = new Sink(opts.dryRun ? "count" : "write");
  const ctx = buildContext(opts, base, sink, log);
  const win = { windowStart: ctx.windowStart, asOf: ctx.asOf };
  const iso = (t: number) => new Date(t).toISOString().slice(0, 10);
  log(`Window: ${iso(win.windowStart + 3 * HOUR)} → ${iso(win.asOf)} (${opts.days} days, seed ${opts.seed}) · ${opts.companies} companies, ${opts.offices} offices, ${opts.drivers} drivers${opts.dryRun ? " · DRY RUN (nothing is written)" : ""}`);

  if (opts.days > 400) log("Note: sign-ins and message-log rows older than 400 days are pruned by the platform's hourly retention job, so the oldest part of a window longer than 400 days will thin out within the hour.");
  const work = async (x: Exec | null) => {
    if (x) ctx.platformWalletId = (await platformAccount(x as never)).id;
    // phase A: the people (users, wallets, documents, sign-ins …) must exist before anything references them
    emitAccounts(ctx);
    if (x) await sink.flush(x);
    log(`Accounts: ${ctx.w.companies.length} companies, ${ctx.w.offices.length} offices, ${ctx.w.drivers.length} drivers, ${ctx.w.staff.length} staff (${ctx.w.companies.filter((c) => c.existing).length + ctx.w.offices.filter((c) => c.existing).length + ctx.w.drivers.filter((c) => c.existing).length} existing demo accounts get history too)`);

    // the days
    await simulateDays(ctx, async (di) => {
      if (x && sink.needsFlush()) await sink.flush(x);
      if (di % 15 === 14 || di === opts.days - 1) log(`  day ${di + 1}/${opts.days} · ${(ctx.stats.requests ?? 0).toLocaleString()} requests · ${(ctx.stats.parcels ?? 0).toLocaleString()} parcels · ${ctx.postings.length.toLocaleString()} postings so far`);
    });
    if (x) await sink.flush(x);

    // phase B: what the simulation decided about the accounts, support cases, money
    emitProfiles(ctx);
    const money = planMoney(ctx, base.minWithdrawalCents, base.maxTopupCents);
    for (const w of money.withdrawals) {
      sink.add("withdrawals", { id: w.id, userId: w.userId, amountCents: w.amountCents, iban: w.iban, bankName: w.bank, status: w.status, decidedBy: w.decidedBy, decidedAt: w.decidedAt ? new Date(w.decidedAt) : null, paymentRef: w.paymentRef, note: w.note, createdAt: new Date(w.createdAt) });
      if (w.decidedAt && w.decidedBy) {
        sink.add("auditLogs", { id: ctx.ids.next("audit"), actorId: w.decidedBy, actorRole: "staff", action: `withdrawal.${w.status}`, entity: "withdrawal", entityId: w.id, diff: { amount: w.amountCents } as never, ip: null, correlationId: null, createdAt: new Date(w.decidedAt) });
        sink.add("notifications", { id: ctx.ids.next("notification"), userId: w.userId, type: w.status === "paid" ? "withdrawal_paid" : "withdrawal_rejected", title: w.status === "paid" ? "withdrawal_paid" : "withdrawal_rejected", body: null, data: { amountCents: w.amountCents } as never, readAt: null, createdAt: new Date(w.decidedAt) });
      }
    }
    // topups are not "events" the rest of the platform shows besides the ledger; top-up notifications are not sent by the real flow either
    emitSupport(ctx, money.withdrawals);
    const snaps = buildSnapshots(ctx, money);
    for (const s of snaps) sink.add("metricSnapshots", { id: ctx.ids.next("snapshot"), at: new Date(s.at), scope: s.scope, city: s.city, metrics: s.metrics as never, createdAt: new Date(s.at) });
    log(`Money: ${money.postings.length.toLocaleString()} ledger postings (${money.topups} top-ups, ${money.withdrawals.length} withdrawals), ${snaps.length.toLocaleString()} metric snapshots`);
    if (x) {
      await sink.flush(x);
      // the wallets that already existed keep their rows: remember when they were last touched so a reset can put that back as well
      const keep = [...ctx.w.companies, ...ctx.w.drivers, ...ctx.w.offices].filter((a) => a.existing).map((a) => a.walletId).concat(ctx.platformWalletId);
      const before = (await x.execute(sql`select id, updated_at::text as u from wallet_accounts where id in (${sql.join(keep.map((k) => sql`${k}::uuid`), sql`, `)})`)).rows as Array<{ id: string; u: string }>;
      ctx.restoreWallets = before.map((r) => ({ id: r.id, updatedAt: r.u })); // text keeps the microseconds a JS Date would lose
      log(`Applying ${money.postings.length.toLocaleString()} postings through wallet.post() …`);
      await applyPostings(x, money.postings);
      await x.execute(sql`update wallet_accounts w set updated_at = x.m from (select account_id, max(created_at) m from ledger_entries group by account_id) x where w.id = x.account_id and w.id in (select account_id from ledger_entries where idempotency_key like 'hist:%')`);
      // the demo accounts that already existed keep their rows; their counters grow by what the history added
      for (const d of ctx.w.drivers.filter((d) => d.existing)) await x.execute(sql`update driver_profiles set rating_sum = rating_sum + ${d.fin.ratingSum}, rating_count = rating_count + ${d.fin.ratingCount}, jobs_completed = jobs_completed + ${d.fin.jobsCompleted} where user_id = ${d.id}`);
      for (const c of ctx.w.companies.filter((c) => c.existing)) await x.execute(sql`update business_profiles set rating_sum = rating_sum + ${c.fin.ratingSum}, rating_count = rating_count + ${c.fin.ratingCount} where user_id = ${c.id}`);
    }
    return money;
  };

  let money: Awaited<ReturnType<typeof work>>;
  let verify: VerifyResult | undefined;
  let counts: Record<string, number> = { ...sink.counts };
  if (opts.dryRun) money = await work(null);
  else {
    const result = await db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(7788002)`); // two generators (or a generator and a reset) never run at the same time
      if ((await isHistoryPresent(tx)).present) throw new Error("History appeared while this run was starting (another run finished first): nothing was written.");
      const m = await work(tx);
      const v = await verifyHistory(tx);
      for (const c of v.checks) log(`  ${c.ok ? "PASS" : "FAIL"}  ${c.name}${c.ok ? "" : ` — ${c.detail}`}`);
      log(v.ok ? "Integrity: PASS" : "Integrity: FAIL");
      if (!v.ok && !io.keepOnFail) throw new HistoryIntegrityError(v);
      const c = await countHistory(tx);
      const [{ now }] = (await tx.execute(sql`select now() as now`)).rows as Array<{ now: Date }>;
      await tx.execute(sql`insert into settings (key, value) values (${MARKER_KEY}, ${JSON.stringify({ version: 1, generatedAt: now, options: { ...opts, yes: undefined }, restore: { wallets: ctx.restoreWallets }, window: { from: iso(win.windowStart + 3 * HOUR), to: iso(win.asOf), days: opts.days }, counts: c })}::jsonb)
        on conflict (key) do update set value = excluded.value, updated_at = now()`);
      return { m, v, c };
    });
    money = result.m; verify = result.v; counts = result.c;
    const { storage } = await import("@/server/storage");
    await storage().put(PLACEHOLDER_KEY, placeholderPng());
  }
  void hid;
  return {
    mode: opts.dryRun ? "dry-run" : "write", seconds: (Date.now() - t0) / 1000, counts: opts.dryRun ? { ...Object.fromEntries(Object.entries(sink.counts).map(([k, n]) => [getTableName(TABLES[k as TableName]), n])), ledger_entries: money.postings.length } : counts, verify,
    window: { from: iso(win.windowStart + 3 * HOUR), to: iso(win.asOf), days: opts.days }, money: { topups: money.topups, withdrawals: money.withdrawals.length, postings: money.postings.length }, stats: ctx.stats,
  };
}
