import { sql } from "drizzle-orm";
import type { User } from "@/db/schema";
import { err } from "@/lib/errors";
import { requirePerm } from "./auth/permissions";
import { num, rows } from "./analytics/guard";
import { driverCash, listRemittances } from "./cod";
import { clampPage } from "./details-people-lib";
import { driverBase, driverCashHeld } from "./details-people";
import { OFFICE_MONEY, officeBase } from "./details-people-office";
import { hasAnyPerm } from "./details-people-sql";

/** Money of a driver or a courier office: wallet, earnings pipeline, ledger, settlements, withdrawals and (drivers) cash on delivery. Needs finance permissions (see `MONEY_PERMS`). */
type Rec = Record<string, unknown>;
type Kind = "driver" | "office";
export const MONEY_PARTS = ["ledger", "settlements", "withdrawals", "cod", "remittances"] as const;
export type MoneyPart = (typeof MONEY_PARTS)[number];
export const MONEY_PERMS = { driver: ["finance.view", "wallets.view"], office: OFFICE_MONEY, cod: ["cod.manage", "finance.view"] } as const;
/** Settlements owed but not yet in the payee's wallet. */
export const PENDING = ["pending_review", "reviewed", "approved", "batch_ready", "failed"] as const;
const pend = sql.join(PENDING.map((s) => sql`${s}`), sql`, `);

async function access(viewer: User, id: string, kind: Kind) {
  if (kind === "driver") await driverBase(viewer, id); else await officeBase(viewer, id);
  const wallet = hasAnyPerm(viewer, MONEY_PERMS[kind]), cod = kind === "driver" && hasAnyPerm(viewer, MONEY_PERMS.cod);
  if (!wallet && !cod) requirePerm(viewer, ...(MONEY_PERMS[kind] as never[]));
  return { wallet, cod };
}
const payee = (kind: Kind, id: string) => (kind === "driver" ? sql`settlements.driver_id = ${id}` : sql`settlements.office_id = ${id}`);

/** Balances and the earnings pipeline (counts and amounts per settlement status, how long payouts take) + COD totals for drivers. */
export async function moneySummary(viewer: User, id: string, kind: Kind) {
  const a = await access(viewer, id, kind);
  const [wallet, pipe, wd, cash, avg] = await Promise.all([
    a.wallet ? rows<Rec>(sql`select available_cents, reserved_cents, held_cents, credit_limit_cents from wallet_accounts where owner_id = ${id}`) : Promise.resolve(null),
    a.wallet ? rows<Rec>(sql`select status, count(*)::int as n, coalesce(sum(provider_cents), 0)::float8 as cents, min(created_at) as oldest, max(paid_at) as last_paid
        ${kind === "driver" ? sql`, coalesce(sum(provider_cents) filter (where settlements.office_id is not null), 0)::float8 as via_office` : sql``} from settlements where ${payee(kind, id)} group by status`) : Promise.resolve(null),
    a.wallet ? rows<Rec>(sql`select count(*) filter (where status in ('pending','approved'))::int as pending_n, coalesce(sum(amount_cents) filter (where status in ('pending','approved')), 0)::float8 as pending_cents,
        coalesce(sum(amount_cents) filter (where status = 'paid'), 0)::float8 as paid_cents, count(*)::int as total, max(created_at) as last_at from withdrawals where user_id = ${id}`) : Promise.resolve(null),
    a.cod ? driverCashHeld(id, 3) : Promise.resolve(null),
    a.wallet ? rows<Rec>(sql`select avg(extract(epoch from (paid_at - created_at)))::float8 as secs, count(*)::int as n from settlements where ${payee(kind, id)} and status = 'paid' and paid_at is not null`) : Promise.resolve(null),
  ]);
  const by = new Map((pipe ?? []).map((r) => [String(r.status), r])); const sum = (names: readonly string[], f: "n" | "cents") => names.reduce((n, s) => n + num(by.get(s)?.[f]), 0);
  const w = wallet?.[0];
  return {
    wallet: wallet ? { availableCents: num(w?.available_cents), reservedCents: num(w?.reserved_cents), heldCents: num(w?.held_cents), creditLimitCents: num(w?.credit_limit_cents) } : null,
    pipeline: pipe ? [...by.entries()].map(([status, r]) => ({ status, count: num(r.n), cents: num(r.cents), oldestAt: r.oldest ?? null })).sort((x, y) => y.cents - x.cents) : null,
    earnings: pipe ? {
      pendingCents: sum(PENDING, "cents"), pendingCount: sum(PENDING, "n"), paidCents: sum(["paid"], "cents"), paidCount: sum(["paid"], "n"), rejectedCents: sum(["rejected"], "cents"), rejectedCount: sum(["rejected"], "n"),
      lastPaidAt: by.get("paid")?.last_paid ?? null, avgPayoutSeconds: avg?.[0]?.secs == null ? null : num(avg[0].secs), viaOfficeCents: kind === "driver" ? [...by.values()].reduce((n, r) => n + num(r.via_office), 0) : null,
    } : null,
    withdrawals: wd ? { pendingCount: num(wd[0]?.pending_n), pendingCents: num(wd[0]?.pending_cents), paidCents: num(wd[0]?.paid_cents), total: num(wd[0]?.total), lastAt: wd[0]?.last_at ?? null } : null,
    cod: cash ? { collectedCents: cash.collectedCents, receivedCents: cash.receivedCents, outstandingCents: cash.heldCents, heldLongCents: cash.heldLongCents, orders: cash.orders } : null,
  };
}

const LEDGER_KINDS = ["topup", "reserve", "release_reserve", "refund", "payout", "platform_fee", "withdrawal_hold", "withdrawal_paid", "withdrawal_release", "adjustment"];
/** One page of a money list: `ledger` (wallet movements), `settlements` (what the work earned), `withdrawals`, and for drivers `cod` (orders with cash held) and `remittances`. */
export async function moneyPart(viewer: User, id: string, kind: Kind, part: string, q: { page?: number; pageSize?: number; status?: string; kind?: string }) {
  const a = await access(viewer, id, kind);
  if (!(MONEY_PARTS as readonly string[]).includes(part) || (kind === "office" && (part === "cod" || part === "remittances"))) throw err("NOT_FOUND");
  const needsWallet = part === "ledger" || part === "settlements" || part === "withdrawals";
  if ((needsWallet && !a.wallet) || (!needsWallet && !a.cod)) throw err("FORBIDDEN", "Missing permission");
  const { page, pageSize, offset } = clampPage(q, 10, 50);
  if (part === "cod" || part === "remittances") {
    if (part === "remittances") return listRemittances({ driverId: id, page, pageSize });
    const all = await driverCash({ id } as User); const now = Date.now();
    const items = all.orders.map((o) => ({ ...o, ageDays: o.lastCollectedAt ? Math.floor((now - new Date(o.lastCollectedAt).getTime()) / 864e5) : null }));
    return { page, pageSize, total: items.length, totals: { collectedCents: all.collectedCents, receivedCents: all.receivedCents, outstandingCents: all.outstandingCents }, items: items.slice(offset, offset + pageSize) };
  }
  if (part === "ledger") {
    const k = LEDGER_KINDS.includes(q.kind ?? "") ? q.kind : null;
    const where = sql`wallet_accounts.owner_id = ${id} ${k ? sql`and ledger_entries.kind = ${k}` : sql``}`;
    const [items, [c]] = await Promise.all([
      rows<Rec>(sql`select ledger_entries.id, ledger_entries.kind, ledger_entries.available_delta_cents, ledger_entries.reserved_delta_cents, ledger_entries.held_delta_cents, ledger_entries.note, ledger_entries.simulated, ledger_entries.created_at,
          ledger_entries.request_id, requests.ref, ledger_entries.settlement_id, au.name as actor from ledger_entries join wallet_accounts on wallet_accounts.id = ledger_entries.account_id
        left join requests on requests.id = ledger_entries.request_id left join users au on au.id = ledger_entries.actor_id where ${where} order by ledger_entries.created_at desc, ledger_entries.id desc limit ${pageSize} offset ${offset}`),
      rows<Rec>(sql`select count(*)::int as n from ledger_entries join wallet_accounts on wallet_accounts.id = ledger_entries.account_id where ${where}`),
    ]);
    return { page, pageSize, total: num(c?.n), items: items.map((r) => ({ id: r.id, kind: r.kind, availableDeltaCents: num(r.available_delta_cents), reservedDeltaCents: num(r.reserved_delta_cents), heldDeltaCents: num(r.held_delta_cents), note: r.note ?? null, simulated: !!r.simulated, at: r.created_at, requestId: r.request_id ?? null, ref: r.ref ?? null, settlementId: r.settlement_id ?? null, actor: r.actor ?? null })) };
  }
  if (part === "withdrawals") {
    const [items, [c]] = await Promise.all([
      rows<Rec>(sql`select w.id, w.amount_cents, w.bank_name, right(w.iban, 4) as iban_tail, w.status, w.payment_ref, w.note, w.created_at, w.decided_at, du.name as decided_by from withdrawals w left join users du on du.id = w.decided_by
        where w.user_id = ${id} order by w.created_at desc, w.id desc limit ${pageSize} offset ${offset}`),
      rows<Rec>(sql`select count(*)::int as n from withdrawals where user_id = ${id}`),
    ]);
    return { page, pageSize, total: num(c?.n), items: items.map((r) => ({ id: r.id, amountCents: num(r.amount_cents), bank: r.bank_name ?? null, ibanTail: r.iban_tail ?? null, status: r.status, paymentRef: r.payment_ref ?? null, note: r.note ?? null, createdAt: r.created_at, decidedAt: r.decided_at ?? null, decidedBy: r.decided_by ?? null })) };
  }
  const st = q.status === "pending" ? sql`and settlements.status in (${pend})` : q.status === "paid" || q.status === "rejected" ? sql`and settlements.status = ${q.status}` : sql``;
  const where = sql`${payee(kind, id)} ${st}`;
  const [items, [c]] = await Promise.all([
    rows<Rec>(sql`select settlements.id, settlements.request_id, requests.ref, settlements.driver_id, du.name as driver, settlements.final_units, settlements.provider_cents, settlements.adjustment_cents, settlements.status, settlements.created_at, settlements.approved_at, settlements.paid_at, pb.ref as batch
      from settlements join requests on requests.id = settlements.request_id join users du on du.id = settlements.driver_id left join payout_batches pb on pb.id = settlements.batch_id
      where ${where} order by settlements.created_at desc, settlements.id desc limit ${pageSize} offset ${offset}`),
    rows<Rec>(sql`select count(*)::int as n from settlements where ${where}`),
  ]);
  return { page, pageSize, total: num(c?.n), items: items.map((r) => ({ id: r.id, requestId: r.request_id, ref: r.ref, driverId: r.driver_id, driver: r.driver, finalUnits: num(r.final_units), amountCents: num(r.provider_cents), adjustmentCents: num(r.adjustment_cents), status: r.status, createdAt: r.created_at, approvedAt: r.approved_at ?? null, paidAt: r.paid_at ?? null, batch: r.batch ?? null })) };
}
