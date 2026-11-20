import { sql, type SQL } from "drizzle-orm";
import { num, rows } from "./analytics/guard";
import { PENDING_STATES } from "./analytics/offices-sql";
import { BILLED } from "./analytics/conditions";
import { officeRef, warehouseOf } from "./cod-columns";
import { at } from "./finance-drivers-sql";
import type { Period } from "./finance-drivers-lib";

/**
 * Finance › Drivers detail tables: one driver's settlements, wallet ledger, withdrawals and cash on delivery (the statement is in `finance-drivers-statement.ts`). Each returns one page of rows
 * plus `totals` over the WHOLE selection (period + status filter), never only the page. All run through `rows()` (read-only, 15 s timeout) and are bounded by `limit`.
 * The period filter keeps what moved inside the window: settlements by creation, ledger by time, withdrawals by request time, cash by collection / hand-over time.
 */
type Rec = Record<string, unknown>;
export interface TablePage { rows: Array<Record<string, unknown>>; total: number; totals: Record<string, number> }
export interface TableQuery { id: string; period: Period; status: string; kind: string; limit: number; offset: number }
const iso = (v: unknown) => (v == null ? null : new Date(String(v)).toISOString());
const str = (v: unknown) => (v == null ? null : String(v));

const SETTLE_STATUS = ["all", "pending", "paid", "rejected", "failed"] as const;
export const settlementStatusOk = (s: string) => !s || (SETTLE_STATUS as readonly string[]).includes(s);
export async function settlementsTable(q: TableQuery): Promise<TablePage> {
  const st = q.status === "pending" ? PENDING_STATES : q.status === "paid" || q.status === "rejected" || q.status === "failed" ? sql`settlements.status = ${q.status}` : sql`true`;
  const where = sql`settlements.driver_id = ${q.id} and ${st} and ${at(sql`settlements.created_at`, q.period)}`;
  const [list, [t]] = await Promise.all([
    rows<Rec>(sql`select settlements.id, settlements.request_id, requests.ref, coalesce(bp.company_name, bu.name) as business, settlements.final_units, settlements.provider_cents, settlements.adjustment_cents, settlements.refund_cents,
        settlements.status, settlements.created_at, settlements.approved_at, settlements.paid_at, pb.ref as batch, settlements.office_id, coalesce(op.office_name, ou.name) as payee_office
      from settlements join requests on requests.id = settlements.request_id join users bu on bu.id = settlements.business_id left join business_profiles bp on bp.user_id = settlements.business_id
        left join payout_batches pb on pb.id = settlements.batch_id left join users ou on ou.id = settlements.office_id left join office_profiles op on op.user_id = settlements.office_id
      where ${where} order by settlements.created_at desc, settlements.id desc limit ${q.limit} offset ${q.offset}`),
    rows<Rec>(sql`select count(*)::int as n, coalesce(sum(provider_cents) filter (where ${BILLED}), 0)::float8 as earned, coalesce(sum(provider_cents) filter (where status = 'paid'), 0)::float8 as paid,
        coalesce(sum(provider_cents) filter (where ${PENDING_STATES}), 0)::float8 as pending from settlements where ${where}`),
  ]);
  return {
    total: num(t?.n), totals: { earnedCents: num(t?.earned), paidCents: num(t?.paid), pendingCents: num(t?.pending) },
    rows: list.map((r) => ({
      id: String(r.id), requestId: String(r.request_id), ref: String(r.ref), business: str(r.business), finalUnits: num(r.final_units), earnedCents: num(r.provider_cents), adjustmentCents: num(r.adjustment_cents), refundCents: num(r.refund_cents),
      status: String(r.status), createdAt: iso(r.created_at), approvedAt: iso(r.approved_at), paidAt: iso(r.paid_at), batch: str(r.batch), ...officeRef(str(r.office_id), str(r.payee_office)), payeeOffice: str(r.office_id) ? str(r.payee_office) : null,
    })),
  };
}

/** Wallet movements with the running balance AFTER each entry (the window runs over the whole account, then the period filter is applied). */
export async function ledgerTable(q: TableQuery, kinds: readonly string[]): Promise<TablePage> {
  const k = q.kind && kinds.includes(q.kind) ? sql`and x.kind = ${q.kind}` : sql``;
  const inner = sql`(select e.id, e.kind, e.available_delta_cents, e.reserved_delta_cents, e.held_delta_cents, e.note, e.simulated, e.created_at, e.request_id, e.settlement_id, e.actor_id,
      (sum(e.available_delta_cents) over (order by e.created_at, e.id))::float8 as balance
    from ledger_entries e join wallet_accounts a on a.id = e.account_id where a.owner_id = ${q.id} and a.kind = 'user') x`;
  const where = sql`${at(sql`x.created_at`, q.period)} ${k}`;
  const [list, [t]] = await Promise.all([
    rows<Rec>(sql`select x.*, r.ref, au.name as actor from ${inner} left join requests r on r.id = x.request_id left join users au on au.id = x.actor_id
      where ${where} order by x.created_at desc, x.id desc limit ${q.limit} offset ${q.offset}`),
    rows<Rec>(sql`select count(*)::int as n, coalesce(sum(x.available_delta_cents) filter (where x.available_delta_cents > 0), 0)::float8 as credit,
        coalesce(sum(-x.available_delta_cents) filter (where x.available_delta_cents < 0), 0)::float8 as debit from ${inner} where ${where}`),
  ]);
  return {
    total: num(t?.n), totals: { creditCents: num(t?.credit), debitCents: num(t?.debit) },
    rows: list.map((r) => {
      const d = num(r.available_delta_cents);
      return { id: String(r.id), kind: String(r.kind), availableDeltaCents: d, creditCents: d > 0 ? d : 0, debitCents: d < 0 ? -d : 0, reservedDeltaCents: num(r.reserved_delta_cents), heldDeltaCents: num(r.held_delta_cents),
        balanceCents: num(r.balance), note: str(r.note), simulated: !!r.simulated, createdAt: iso(r.created_at), requestId: str(r.request_id), ref: str(r.ref), settlementId: str(r.settlement_id), actor: str(r.actor) };
    }),
  };
}

const WD_STATUS = ["pending", "approved", "paid", "rejected"];
export const withdrawalStatusOk = (s: string) => !s || s === "all" || WD_STATUS.includes(s);
export async function withdrawalsTable(q: TableQuery): Promise<TablePage> {
  const st = q.status === "open" ? sql`w.status in ('pending', 'approved')` : q.status && q.status !== "all" ? sql`w.status = ${q.status}` : sql`true`;
  const where = sql`w.user_id = ${q.id} and ${st} and ${at(sql`w.created_at`, q.period)}`;
  const [list, [t]] = await Promise.all([
    rows<Rec>(sql`select w.id, w.amount_cents, w.status, w.bank_name, right(w.iban, 4) as iban_tail, w.payment_ref, w.note, w.created_at, w.decided_at, du.name as decided_by
      from withdrawals w left join users du on du.id = w.decided_by where ${where} order by w.created_at desc, w.id desc limit ${q.limit} offset ${q.offset}`),
    rows<Rec>(sql`select count(*)::int as n, coalesce(sum(amount_cents), 0)::float8 as requested, coalesce(sum(amount_cents) filter (where status = 'paid'), 0)::float8 as paid,
        coalesce(sum(amount_cents) filter (where status in ('pending', 'approved')), 0)::float8 as pending, coalesce(sum(amount_cents) filter (where status = 'rejected'), 0)::float8 as rejected from withdrawals w where ${where}`),
  ]);
  return {
    total: num(t?.n), totals: { requestedCents: num(t?.requested), paidCents: num(t?.paid), pendingCents: num(t?.pending), rejectedCents: num(t?.rejected) },
    rows: list.map((r) => ({ id: String(r.id), amountCents: num(r.amount_cents), status: String(r.status), bank: str(r.bank_name), ibanTail: r.iban_tail ? `•••• ${r.iban_tail}` : null, paymentRef: str(r.payment_ref), note: str(r.note), createdAt: iso(r.created_at), decidedAt: iso(r.decided_at), decidedBy: str(r.decided_by) })),
  };
}

/** Cash on delivery per order (one row per offer): collected and remitted INSIDE the period, outstanding NOW (lifetime collected − remitted, never below 0). */
function cashOrders(q: TableQuery): SQL {
  const p = q.period;
  return sql`ord as (
    select coalesce(col.offer_id, rem.offer_id) as offer_id, coalesce(col.total, 0) as collected_total, coalesce(col.per, 0) as collected, coalesce(rem.total, 0) as remitted_total, coalesce(rem.per, 0) as remitted, col.parcels, col.last_at
    from (
      select offers.id as offer_id, sum(shipments.cod_collected_cents)::float8 as total, coalesce(sum(shipments.cod_collected_cents) filter (where ${at(sql`shipments.cod_collected_at`, p)}), 0)::float8 as per,
        count(*)::int as parcels, max(shipments.cod_collected_at) filter (where ${at(sql`shipments.cod_collected_at`, p)}) as last_at
      from shipments join requests on requests.id = shipments.request_id join offers on offers.id = shipments.offer_id
      where offers.driver_id = ${q.id} and requests.status <> 'draft' and shipments.cod_collected_cents is not null group by offers.id
    ) col full join (
      select cod_remittances.offer_id, sum(amount_cents)::float8 as total, coalesce(sum(amount_cents) filter (where ${at(sql`cod_remittances.created_at`, p)}), 0)::float8 as per
      from cod_remittances where cod_remittances.driver_id = ${q.id} group by cod_remittances.offer_id
    ) rem on rem.offer_id = col.offer_id
  ), sel as (
    select ord.*, greatest(0, ord.collected_total - ord.remitted_total)::float8 as outstanding from ord where (ord.collected <> 0 or ord.remitted <> 0)
  )`;
}
export async function cashTable(q: TableQuery): Promise<TablePage> {
  const only = q.status === "outstanding" ? sql`where sel.outstanding > 0` : sql``;
  const [list, [t]] = await Promise.all([
    rows<Rec>(sql`with ${cashOrders(q)} select sel.*, requests.id as request_id, requests.ref, coalesce(bp.company_name, bu.name) as business, requests.pickup_address, requests.pickup_city, offers.office_id, coalesce(op.office_name, ou.name) as office_name
      from sel join offers on offers.id = sel.offer_id join requests on requests.id = offers.request_id join users bu on bu.id = requests.business_id left join business_profiles bp on bp.user_id = requests.business_id
        left join users ou on ou.id = offers.office_id left join office_profiles op on op.user_id = offers.office_id ${only}
      order by sel.last_at desc nulls last, sel.offer_id limit ${q.limit} offset ${q.offset}`),
    rows<Rec>(sql`with ${cashOrders(q)} select count(*)::int as n, coalesce(sum(collected), 0)::float8 as collected, coalesce(sum(remitted), 0)::float8 as remitted, coalesce(sum(outstanding), 0)::float8 as outstanding from sel ${only}`),
  ]);
  return {
    total: num(t?.n), totals: { collectedCents: num(t?.collected), remittedCents: num(t?.remitted), outstandingCents: num(t?.outstanding) },
    rows: list.map((r) => {
      const wh = warehouseOf({ pickupAddress: str(r.pickup_address), companyName: str(r.business), pickupCity: str(r.pickup_city) });
      return { id: String(r.offer_id), offerId: String(r.offer_id), requestId: String(r.request_id), ref: String(r.ref), business: str(r.business), warehouse: wh.label, warehouseCity: wh.city, ...officeRef(str(r.office_id), str(r.office_name)),
        parcels: num(r.parcels), collectedCents: num(r.collected), remittedCents: num(r.remitted), outstandingCents: num(r.outstanding), lastCollectedAt: iso(r.last_at) };
    }),
  };
}
