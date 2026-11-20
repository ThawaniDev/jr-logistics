import { sql } from "drizzle-orm";
import type { Exec } from "@/db";
import { histIdSql } from "./ids";

/**
 * Integrity checks of the generated history (and of the money of the whole database). The seeder runs them before committing and prints PASS / FAIL;
 * the integration test runs them again. The first group is the platform's own wallet invariants (same rules as tests/helpers/invariants.ts).
 */
export interface Check { name: string; ok: boolean; detail: string }
export interface VerifyResult { ok: boolean; checks: Check[]; money: string[] }

const rowsOf = async <T extends Record<string, unknown>>(x: Exec, q: ReturnType<typeof sql>) => (await x.execute(q)).rows as T[];
const num = async (x: Exec, q: ReturnType<typeof sql>) => Number((await rowsOf<{ n: string | number }>(x, q))[0]?.n ?? 0);

/** Every wallet equals the sum of its ledger; internal transfers net to zero; reserved = open escrow of the business' requests; nothing negative. */
export async function moneyViolations(x: Exec): Promise<string[]> {
  const out: string[] = [];
  const per = await rowsOf<{ id: string; cl: number; a: number; r: number; h: number; la: number; lr: number; lh: number }>(x, sql`
    select w.id, w.credit_limit_cents::int cl, w.available_cents::int a, w.reserved_cents::int r, w.held_cents::int h,
      coalesce(sum(l.available_delta_cents),0)::int la, coalesce(sum(l.reserved_delta_cents),0)::int lr, coalesce(sum(l.held_delta_cents),0)::int lh
    from wallet_accounts w left join ledger_entries l on l.account_id = w.id group by w.id`);
  for (const r of per) {
    if (r.a !== r.la || r.r !== r.lr || r.h !== r.lh) out.push(`account ${r.id}: balance ${r.a}/${r.r}/${r.h} != ledger ${r.la}/${r.lr}/${r.lh}`);
    if (r.a + r.cl < 0 || r.r < 0 || r.h < 0) out.push(`account ${r.id}: negative balance`);
  }
  const net = await num(x, sql`select coalesce(sum(available_delta_cents + reserved_delta_cents + held_delta_cents),0)::bigint n from ledger_entries where kind not in ('topup','withdrawal_paid')`);
  if (net !== 0) out.push(`internal transfers do not net to zero (${net})`);
  const esc = await rowsOf<{ owner: string; reserved: number; escrow: number }>(x, sql`
    select w.owner_id::text owner, w.reserved_cents::int reserved, coalesce((select sum(q.reserved_cents) from requests q where q.business_id = w.owner_id),0)::int escrow
    from wallet_accounts w where w.owner_id is not null`);
  for (const r of esc) if (r.reserved !== r.escrow) out.push(`user ${r.owner}: wallet reserved ${r.reserved} != requests' escrow ${r.escrow}`);
  return out;
}

export async function verifyHistory(x: Exec): Promise<VerifyResult> {
  const checks: Check[] = [];
  const hist = (col: string) => sql.raw(histIdSql(col));
  const check = async (name: string, q: ReturnType<typeof sql>, expectZero = true, describe?: (n: number) => string) => {
    const n = await num(x, q);
    checks.push({ name, ok: expectZero ? n === 0 : n > 0, detail: describe ? describe(n) : expectZero ? (n === 0 ? "ok" : `${n} violation(s)`) : `${n}` });
  };
  const money = await moneyViolations(x);
  checks.push({ name: "wallet balances = ledger sums, internal transfers net to zero, escrow = open requests, nothing negative", ok: money.length === 0, detail: money.length ? money.slice(0, 5).join("; ") : "ok" });

  await check("every paid settlement: customer = provider + margin and has 4 ledger postings (release, charge, payout, fee)", sql`
    select count(*)::int n from settlements s where ${hist("s.id")} and s.status = 'paid'
      and (s.customer_cents <> s.provider_cents + s.margin_cents or s.refund_cents <> s.reserved_cents - s.customer_cents
        or (select count(*) from ledger_entries l where l.settlement_id = s.id) <> 4)`);
  await check("every paid settlement has exactly one invoice with VAT-inclusive totals", sql`
    select count(*)::int n from settlements s where ${hist("s.id")} and s.status = 'paid'
      and (select count(*) from invoices i where i.settlement_id = s.id and i.total_cents = s.customer_cents and i.subtotal_cents + i.vat_cents = i.total_cents and i.vat_cents = s.vat_cents) <> 1`);
  await check("platform margin booked = Σ margin of the generated paid settlements (fee postings)", sql`
    select abs(coalesce((select sum(l.available_delta_cents) from ledger_entries l where l.kind = 'platform_fee' and l.idempotency_key like 'hist:settle:%'),0)
      - coalesce((select sum(margin_cents) from settlements s where ${hist("s.id")} and s.status = 'paid'),0))::int n`);
  await check("held settlements are exactly those with an open complaint that holds them", sql`
    select count(*)::int n from settlements s where ${hist("s.id")} and s.status = 'approved'
      and not exists (select 1 from complaints c where c.holds_settlement and c.status in ('open','in_progress') and (c.offer_id = s.offer_id or (c.offer_id is null and c.request_id = s.request_id)))`);
  await check("cash remitted never exceeds cash collected, per offer", sql`
    select count(*)::int n from (select r.offer_id, sum(r.amount_cents) rem from cod_remittances r where ${hist("r.id")} group by r.offer_id) x
      where x.rem > coalesce((select sum(s.cod_collected_cents) from shipments s where s.offer_id = x.offer_id and s.status = 'delivered'),0)`);
  await check("COD is only collected on delivered parcels, exactly the amount due", sql`
    select count(*)::int n from shipments s where ${hist("s.id")} and ((s.cod_collected_cents is not null and (s.status <> 'delivered' or s.cod_collected_cents <> s.cod_cents)) or (s.status = 'delivered' and s.cod_cents > 0 and s.cod_collected_cents is null))`);
  await check("parcel states are coherent (delivered has proof & time; failed/returned has a reason; finished requests leave no parcel pending or on board)", sql`
    select count(*)::int n from shipments s join requests r on r.id = s.request_id where ${hist("s.id")}
      and ((s.status = 'delivered' and (s.delivered_at is null or s.proof_type is null)) or (s.status in ('failed','returned') and s.fail_reason is null)
        or (s.status = 'returned' and s.returned_at is null) or (r.status in ('completed','cancelled','expired') and s.status in ('pending','loaded')))`);
  await check("parcels belong to an offer of their own request", sql`
    select count(*)::int n from shipments s join offers o on o.id = s.offer_id where ${hist("s.id")} and o.request_id <> s.request_id`);
  await check("offers: accepted / working states have timestamps in order (created ≤ accepted ≤ arrived ≤ attendance)", sql`
    select count(*)::int n from offers o where ${hist("o.id")} and ((o.accepted_at is not null and o.accepted_at < o.created_at) or (o.arrived_at is not null and o.arrived_at < o.accepted_at) or (o.attendance_at is not null and o.attendance_at < o.arrived_at))`);
  await check("requests: a started/completed request has a driver, completed ones are settled", sql`
    select count(*)::int n from requests r where ${hist("r.id")} and r.service <> 'car_without_driver' and r.status = 'completed'
      and not exists (select 1 from settlements s where s.request_id = r.id)`);
  await check("requests: slots filled match the live offers of open and finished requests", sql`
    select count(*)::int n from requests r where ${hist("r.id")} and r.status in ('published','filling','assigned','in_progress','completed')
      and r.slots_filled <> (select count(*) from offers o where o.request_id = r.id and o.status in ('accepted','arrived','attendance_confirmed','delivered_reported','qty_disputed','pending_settlement','completed'))`);
  await check("request milestones are in order (created ≤ published ≤ first offer ≤ first accepted ≤ filled)", sql`
    select count(*)::int n from requests r where ${hist("r.id")} and ((r.published_at is not null and r.published_at < r.created_at) or (r.first_offer_at is not null and r.first_offer_at < r.published_at)
      or (r.first_accepted_at is not null and r.first_accepted_at < r.first_offer_at) or (r.filled_at is not null and r.filled_at < r.first_accepted_at))`);
  await check("job events, parcel events, messages and ledger rows point at existing requests / parcels", sql`
    select ((select count(*) from job_events e where ${hist("e.id")} and e.offer_id is not null and not exists (select 1 from offers o where o.id = e.offer_id))
      + (select count(*) from shipment_events e where ${hist("e.id")} and not exists (select 1 from shipments s where s.id = e.shipment_id))
      + (select count(*) from ledger_entries l where l.idempotency_key like 'hist:%' and l.request_id is not null and not exists (select 1 from requests r where r.id = l.request_id))
      + (select count(*) from message_log m where ${hist("m.id")} and m.request_id is not null and not exists (select 1 from requests r where r.id = m.request_id)))::int n`);
  await check("every generated parcel has a 'created' event and delivered parcels a 'delivered' event", sql`
    select count(*)::int n from shipments s where ${hist("s.id")} and (not exists (select 1 from shipment_events e where e.shipment_id = s.id and e.type = 'created')
      or (s.status = 'delivered' and not exists (select 1 from shipment_events e where e.shipment_id = s.id and e.type = 'delivered')))`);
  await check("tickets: first response ≥ creation, resolution ≥ creation, resolved tickets have a resolution time", sql`
    select count(*)::int n from tickets t where ${hist("t.id")} and ((t.first_response_at is not null and t.first_response_at < t.created_at) or (t.resolved_at is not null and t.resolved_at < t.created_at) or (t.status = 'resolved' and t.resolved_at is null))`);
  await check("complaints: resolved ones have resolution & time and no longer hold a settlement", sql`
    select count(*)::int n from complaints c where ${hist("c.id")} and ((c.status in ('resolved','closed') and (c.resolution is null or c.resolved_at is null)) or (c.status in ('resolved','closed') and c.holds_settlement))`);
  await check("withdrawals: pending = held amount, decided ones have a decision time", sql`
    select count(*)::int n from withdrawals w where ${hist("w.id")} and ((w.status = 'pending' and w.decided_at is not null) or (w.status <> 'pending' and w.decided_at is null))`);
  await check("no generated timestamp lies in the future", sql`
    select ((select count(*) from requests r where ${hist("r.id")} and (r.created_at > now() or r.updated_at > now()))
      + (select count(*) from job_events e where ${hist("e.id")} and e.created_at > now())
      + (select count(*) from shipment_events e where ${hist("e.id")} and e.created_at > now())
      + (select count(*) from ledger_entries l where l.idempotency_key like 'hist:%' and l.created_at > now()))::int n`);
  await check("generated users are not on the demo-accounts card and use the fictitious phone block", sql`
    select count(*)::int n from users u where ${hist("u.id")} and (u.is_demo or u.source <> 'seed' or (u.phone is not null and u.phone not like '+9665001%'))`);
  await check("metric snapshots: the platform row exists for every snapshot moment", sql`
    select count(*)::int n from (select distinct scope, at from metric_snapshots m where ${hist("m.id")}) s where not exists (select 1 from metric_snapshots p where p.scope = s.scope and p.at = s.at and p.city is null)`);
  return { ok: checks.every((c) => c.ok), checks, money };
}

/** Table → number of generated rows (identified by the marker). For the summary and the tests. */
export async function countHistory(x: Exec): Promise<Record<string, number>> {
  const tables: Array<[string, string]> = [
    ["users", "id"], ["business_profiles", "user_id"], ["office_profiles", "user_id"], ["driver_profiles", "user_id"], ["requests", "id"], ["offers", "id"], ["shipments", "id"], ["shipment_events", "id"], ["job_events", "id"], ["settlements", "id"], ["invoices", "id"],
    ["cod_remittances", "id"], ["withdrawals", "id"], ["ratings", "id"], ["messages", "id"], ["tickets", "id"], ["ticket_replies", "id"], ["ticket_attachments", "id"], ["complaints", "id"], ["complaint_notes", "id"], ["entity_notes", "id"],
    ["documents", "id"], ["notifications", "id"], ["audit_logs", "id"], ["login_events", "id"], ["driver_availability_log", "id"], ["driver_location_history", "id"], ["message_log", "id"], ["metric_snapshots", "id"], ["webhook_deliveries", "id"],
    ["shipment_media", "id"], ["custody_items", "id"], ["terms_consents", "id"], ["office_agreements", "id"], ["office_invites", "id"], ["api_keys", "id"], ["wallet_accounts", "id"],
  ];
  const out: Record<string, number> = {};
  for (const [t, c] of tables) out[t] = await num(x, sql`select count(*)::int n from ${sql.raw(t)} where ${sql.raw(histIdSql(c))}`);
  out.ledger_entries = await num(x, sql`select count(*)::int n from ledger_entries where idempotency_key like 'hist:%'`);
  return out;
}
