import { DAY, HOUR, MIN, ksa, ksaDayStart } from "./calendar";
import { LEDGER_PREFIX } from "./ids";
import { WITHDRAWAL_REJECT } from "./names";
import { Rng } from "./prng";
import type { Posting } from "./writer";
import type { Ctx } from "./types";
import type { Metrics } from "./acc";

/**
 * The money pass. Every posting the lifecycle produced is replayed in time order against in-memory balances that follow the platform's rules
 * (`wallet_nonneg`: available + credit limit ≥ 0; reserved and held ≥ 0). Where a business would overdraw by publishing, it first tops up —
 * "businesses are topped up before spending" — and payees (direct drivers, offices) withdraw part of their balance now and then, which finance
 * pays or (rarely) rejects. Output: the complete, ordered list of postings to apply through `post()`, the withdrawal rows, and the closing wallet
 * numbers of every day (for the daily snapshots).
 */
interface Acct { id: string; owner: string | null; city: string; a: number; r: number; h: number; limit: number; kind: "business" | "driver" | "office" | "platform" }
export interface WithdrawalOut { id: string; userId: string; role: "driver" | "office"; amountCents: number; iban: string; bank: string; createdAt: number; decidedAt: number | null; status: "pending" | "paid" | "rejected"; decidedBy: string | null; paymentRef: string | null; note: string | null }
export interface MoneyResult { postings: Posting[]; withdrawals: WithdrawalOut[]; topups: number; daily: Map<number, Map<string, Metrics>>; nearMissCredit: number }

interface Item { at: number; seq: number; kind: "post" | "wdcheck" | "daytick" | "decision" | "credit"; p?: Posting; payee?: Payee; w?: WithdrawalOut }
interface Payee { acct: Acct; userId: string; role: "driver" | "office"; iban: string; bank: string; every: number; share: number; from: number }

class Heap {
  private a: Item[] = [];
  private less = (x: Item, y: Item) => x.at < y.at || (x.at === y.at && x.seq < y.seq);
  get size() { return this.a.length; }
  push(it: Item) { const a = this.a; a.push(it); let i = a.length - 1; while (i > 0) { const p = (i - 1) >> 1; if (!this.less(a[i], a[p])) break; [a[i], a[p]] = [a[p], a[i]]; i = p; } }
  pop(): Item | undefined {
    const a = this.a; if (!a.length) return undefined;
    const top = a[0], last = a.pop()!;
    if (a.length) { a[0] = last; let i = 0; for (;;) { const l = 2 * i + 1, r = l + 1; let m = i; if (l < a.length && this.less(a[l], a[m])) m = l; if (r < a.length && this.less(a[r], a[m])) m = r; if (m === i) break; [a[i], a[m]] = [a[m], a[i]]; i = m; } }
    return top;
  }
}

/** Next working moment (Sun–Thu, 09:00–16:00 Riyadh) at or after `t`: finance does not pay out at 3 a.m. on a Friday. */
function workingTime(rng: Rng, t: number): number {
  let x = t;
  for (let i = 0; i < 10; i++) {
    const p = ksa(x), day = ksaDayStart(x);
    if (p.dow === 5 || p.dow === 6) { x = day + DAY + 9 * HOUR + rng.int(0, 90) * MIN; continue; }
    if (p.hour < 9) return day + 9 * HOUR + rng.int(0, 120) * MIN;
    if (p.hour >= 16) { x = day + DAY + 9 * HOUR + rng.int(0, 90) * MIN; continue; }
    return x;
  }
  return x;
}

export function planMoney(ctx: Ctx, minWithdrawalCents: number, maxTopupCents: number): MoneyResult {
  const rng = ctx.rng.fork("money");
  const accts = new Map<string, Acct>();
  const city = (id: string) => ctx.w.userCities.get(id) ?? "riyadh";
  for (const c of ctx.w.companies) accts.set(c.walletId, { id: c.walletId, owner: c.id, city: c.city, a: 0, r: 0, h: 0, limit: c.creditLimitCents, kind: "business" });
  for (const d of ctx.w.drivers) accts.set(d.walletId, { id: d.walletId, owner: d.id, city: d.city, a: 0, r: 0, h: 0, limit: 0, kind: "driver" });
  for (const o of ctx.w.offices) accts.set(o.walletId, { id: o.walletId, owner: o.id, city: o.city, a: 0, r: 0, h: 0, limit: 0, kind: "office" });
  accts.set(ctx.platformWalletId, { id: ctx.platformWalletId, owner: null, city: "", a: 0, r: 0, h: 0, limit: 0, kind: "platform" });
  void city;

  const heap = new Heap();
  let seq = 0;
  for (const p of ctx.postings) heap.push({ at: p.at, seq: seq++, kind: "post", p });

  // withdrawal rhythm of every payee (direct drivers and offices); linked drivers are paid through their office
  const payees: Payee[] = [];
  const from0 = ctx.windowStart;
  for (const d of ctx.w.drivers) {
    if (!d.affiliations.some((x) => x.officeId === null)) continue;
    const a = accts.get(d.walletId)!;
    if (!rng.chance(0.85)) continue;
    payees.push({ acct: a, userId: d.id, role: "driver", iban: d.iban, bank: d.bank, every: rng.pick([7, 7, 14, 14, 21, 10]) * DAY, share: rng.float(0.6, 1), from: from0 + rng.int(5, 25) * DAY });
  }
  for (const o of ctx.w.offices) payees.push({ acct: accts.get(o.walletId)!, userId: o.id, role: "office", iban: o.iban, bank: o.bank, every: rng.pick([7, 7, 14]) * DAY, share: rng.float(0.7, 1), from: from0 + rng.int(7, 30) * DAY });
  for (const p of payees) heap.push({ at: workingTime(rng, p.from), seq: seq++, kind: "wdcheck", payee: p });
  // credit accounts settle their balance monthly (the 3rd, mid-morning)
  for (const c of ctx.w.companies.filter((x) => x.creditLimitCents > 0)) {
    for (let t = from0; t < ctx.asOf; t += DAY) { const p = ksa(t + 12 * HOUR); if (p.d === 3) heap.push({ at: t + 10 * HOUR + rng.int(0, 120) * MIN, seq: seq++, kind: "credit", p: { at: 0, accountId: c.walletId, kind: "topup", key: "" } }); }
  }
  // closing wallet numbers per Riyadh day
  const dayEnds: number[] = [];
  for (let t = ksaDayStart(from0) + DAY; t <= ctx.asOf + DAY; t += DAY) dayEnds.push(t);
  for (const t of dayEnds) heap.push({ at: t - 1, seq: seq++, kind: "daytick" });

  const out: Posting[] = [];
  const withdrawals: WithdrawalOut[] = [];
  const daily = new Map<number, Map<string, Metrics>>();
  let topups = 0;
  const topupStep = (c: { size: string }) => (c.size === "enterprise" ? 1_000_000 : c.size === "medium" ? 200_000 : 50_000);
  const apply = (p: Posting) => {
    const a = accts.get(p.accountId);
    if (!a) throw new Error(`demo-history: posting for unknown wallet ${p.accountId} (${p.key})`);
    a.a += p.available ?? 0; a.r += p.reserved ?? 0; a.h += p.held ?? 0;
    if (a.a + a.limit < 0 || a.r < 0 || a.h < 0) {
      const recent = out.filter((x) => x.accountId === p.accountId).slice(-6).map((x) => `${x.key.slice(0, 60)} @${new Date(x.at).toISOString()} a${x.available ?? 0} r${x.reserved ?? 0} h${x.held ?? 0}`);
      const sameReq = ctx.postings.filter((x) => x.requestId && x.requestId === p.requestId).sort((x, y) => x.at - y.at).map((x) => `${x.key.replace("5eed1157-", "").slice(0, 52)} @${new Date(x.at).toISOString().slice(5, 23)} a${x.available ?? 0} r${x.reserved ?? 0}`);
      throw new Error(`demo-history: wallet_nonneg would be violated by ${p.key} @${new Date(p.at).toISOString()} (${a.a}/${a.r}/${a.h}, limit ${a.limit}); previous postings of the account: ${recent.join(" | ")}\nSame request:\n  ${sameReq.join("\n  ")}`);
    }
    out.push(p);
  };
  const topUp = (acctId: string, amount: number, at: number, why: string) => {
    const a = accts.get(acctId)!;
    for (let left = amount; left > 0; ) {
      const part = Math.min(left, maxTopupCents); left -= part; topups++;
      apply({ at: at - (amount - left - part) / 1000, accountId: acctId, kind: "topup", available: part, key: `${LEDGER_PREFIX}topup:${a.owner}:${topups}`, note: `demo-hist-${topups}`, simulated: true, actorId: a.owner });
    }
    void why;
  };
  const co = new Map(ctx.w.companies.map((c) => [c.walletId, c]));
  const staffFin = ctx.w.staff.filter((s) => s.team === "finance");

  for (let it = heap.pop(); it; it = heap.pop()) {
    if (it.at > ctx.asOf && it.kind !== "daytick") continue;
    if (it.kind === "post") {
      const p = it.p!;
      if (p.kind === "reserve") {
        const a = accts.get(p.accountId)!, c = co.get(p.accountId)!, need = -(p.available ?? 0);
        if (a.a - need + a.limit < 0) {
          const step = topupStep(c);
          const short = need - (a.a + a.limit);
          const cushion = a.limit > 0 ? a.limit * 0.35 : step * rng.float(0.3, 1.6);
          const amount = Math.ceil((short + cushion) / step) * step;
          topUp(a.id, amount, p.at - rng.int(2, 30) * MIN, "publish");
        }
      }
      apply(p);
    } else if (it.kind === "credit") {
      const c = co.get(it.p!.accountId)!, a = accts.get(c.walletId)!;
      if (a.a < 0) topUp(a.id, Math.ceil(-a.a / 100_000) * 100_000, it.at, "credit settlement");
    } else if (it.kind === "wdcheck") {
      const pe = it.payee!, a = pe.acct;
      heap.push({ at: workingTime(rng, it.at + pe.every + rng.int(-2, 2) * DAY), seq: seq++, kind: "wdcheck", payee: pe });
      if (a.a >= minWithdrawalCents && rng.chance(0.82)) {
        let amount = Math.floor((a.a * pe.share) / 10_000) * 10_000;
        if (amount < minWithdrawalCents) amount = Math.floor(a.a / 10_000) * 10_000;
        if (amount >= minWithdrawalCents) {
          const id = ctx.ids.next("withdrawal");
          const lag = Math.max(40 * MIN, Math.round(rng.logNormal(20, 0.8) * HOUR));
          const decisionAt = workingTime(rng, it.at + lag);
          const rejected = rng.chance(0.035);
          const fin = rng.pick(staffFin.length ? staffFin : [ctx.w.admin]);
          const w: WithdrawalOut = { id, userId: pe.userId, role: pe.role, amountCents: amount, iban: pe.iban, bank: pe.bank, createdAt: it.at, decidedAt: null, status: "pending", decidedBy: null, paymentRef: null, note: null };
          withdrawals.push(w);
          apply({ at: it.at, accountId: a.id, kind: "withdrawal_hold", available: -amount, held: amount, key: `${LEDGER_PREFIX}wd-hold:${id}`, actorId: pe.userId });
          if (decisionAt <= ctx.asOf) {
            w.decidedAt = decisionAt; w.decidedBy = fin.id; w.status = rejected ? "rejected" : "paid";
            if (rejected) w.note = rng.pick(WITHDRAWAL_REJECT); else w.paymentRef = `TRF-${rng.int(1_000_000, 9_999_999)}${rng.int(100, 999)}`;
            heap.push({ at: decisionAt, seq: seq++, kind: "decision", w, payee: pe });
          }
        }
      }
    } else if (it.kind === "decision") {
      const w = it.w!, a = it.payee!.acct;
      if (w.status === "paid") apply({ at: it.at, accountId: a.id, kind: "withdrawal_paid", held: -w.amountCents, key: `${LEDGER_PREFIX}wd-paid:${w.id}`, actorId: w.decidedBy, note: w.paymentRef });
      else apply({ at: it.at, accountId: a.id, kind: "withdrawal_release", held: -w.amountCents, available: w.amountCents, key: `${LEDGER_PREFIX}wd-rel:${w.id}`, actorId: w.decidedBy });
    } else {
      // end of a Riyadh day: wallet numbers by the owner's city (+ platform totals, like `collectDaily()`)
      const dayStart = it.at + 1 - DAY;
      if (dayStart + DAY > ctx.asOf + 1) continue;
      const rows = new Map<string, Metrics>();
      const add = (c: string, k: string, v: number) => { for (const key of c ? [c, ""] : [""]) { const r = rows.get(key) ?? {}; r[k] = (r[k] ?? 0) + v; rows.set(key, r); } };
      let exposure = 0;
      for (const a of accts.values()) {
        if (a.kind === "platform") continue;
        add(a.city, "wallet_available_cents", Math.max(a.a, 0)); add(a.city, "wallet_held_cents", a.h); add(a.city, "wallet_escrow_cents", a.r);
        add(a.city, "wallet_liability_cents", Math.max(a.a, 0) + a.h + a.r);
        exposure += -Math.min(a.a, 0);
      }
      add("", "credit_exposure_cents", exposure);
      daily.set(dayStart, rows);
    }
  }
  // A final safety replay in exactly the order postings will be applied (stable by time, then by creation).
  const ordered = out.map((p, i) => ({ p, i })).sort((x, y) => x.p.at - y.p.at || x.i - y.i).map((x) => x.p);
  const check = new Map<string, [number, number, number]>();
  for (const p of ordered) {
    const a = accts.get(p.accountId)!; const v = check.get(p.accountId) ?? [0, 0, 0];
    v[0] += p.available ?? 0; v[1] += p.reserved ?? 0; v[2] += p.held ?? 0; check.set(p.accountId, v);
    if (v[0] + a.limit < 0 || v[1] < 0 || v[2] < 0) throw new Error(`demo-history: ordered replay breaks wallet_nonneg at ${p.key}`);
  }
  for (const w of withdrawals) {
    ctx.iv.withdrawalsPending.push({ from: w.createdAt, to: w.decidedAt ?? Infinity, cents: w.amountCents });
  }
  return { postings: ordered, withdrawals, topups, daily, nearMissCredit: 0 };
}
