import { sql } from "drizzle-orm";
import { db } from "@/db";

/**
 * Money invariants that must hold after ANY scenario. Returns a list of violations (empty = sound), so a failing test says what broke.
 *  1. every account balance equals the sum of its ledger postings;
 *  2. internal transfers net to zero: only a top-up creates money and only a paid withdrawal destroys it;
 *  3. a user's reserved balance equals what their requests still hold in escrow;
 *  4. nothing is negative.
 */
export async function moneyViolations(): Promise<string[]> {
  const out: string[] = [];
  const perAccount = await db.execute<{ id: string; cl: number; a: number; r: number; h: number; la: number; lr: number; lh: number }>(sql`
    select w.id, w.credit_limit_cents::int cl, w.available_cents::int a, w.reserved_cents::int r, w.held_cents::int h,
      coalesce(sum(l.available_delta_cents),0)::int la, coalesce(sum(l.reserved_delta_cents),0)::int lr, coalesce(sum(l.held_delta_cents),0)::int lh
    from wallet_accounts w left join ledger_entries l on l.account_id = w.id group by w.id`);
  for (const r of perAccount.rows) {
    if (r.a !== r.la || r.r !== r.lr || r.h !== r.lh) out.push(`account ${r.id}: balance ${r.a}/${r.r}/${r.h} != ledger ${r.la}/${r.lr}/${r.lh}`);
    if (r.a + r.cl < 0 || r.r < 0 || r.h < 0) out.push(`account ${r.id}: negative balance`);
  }
  const net = await db.execute<{ n: number }>(sql`select coalesce(sum(available_delta_cents + reserved_delta_cents + held_delta_cents),0)::int n from ledger_entries where kind not in ('topup','withdrawal_paid')`);
  if (net.rows[0].n !== 0) out.push(`internal transfers do not net to zero (${net.rows[0].n})`);
  const esc = await db.execute<{ owner: string; reserved: number; escrow: number }>(sql`
    select w.owner_id::text owner, w.reserved_cents::int reserved, coalesce((select sum(q.reserved_cents) from requests q where q.business_id = w.owner_id),0)::int escrow
    from wallet_accounts w where w.owner_id is not null`);
  for (const r of esc.rows) if (r.reserved !== r.escrow) out.push(`user ${r.owner}: wallet reserved ${r.reserved} != requests' escrow ${r.escrow}`);
  return out;
}
