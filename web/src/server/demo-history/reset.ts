import { sql } from "drizzle-orm";
import type { Exec } from "@/db";
import { histIdSql, LEDGER_PREFIX } from "./ids";
import { PLACEHOLDER_KEY } from "./placeholder";

/**
 * `--reset`: removes ONLY what the generator created and puts the shared rows it touched back the way they were.
 *  - generated rows are recognised by their marker uuid (…5eed1157-xxxx-4000-8000-…) or, for ledger rows, by the `hist:` idempotency-key prefix;
 *  - the wallets of demo accounts that received generated postings are reversed by exactly the generated deltas (never overwritten);
 *  - rating / job counters of demo drivers and businesses are reduced by what the generated ratings and paid settlements added;
 *  - the marker row `settings.demo_history` is deleted last.
 * Anything created by the real application after the history was generated is not touched (if it depends on a generated row the delete stops with an error).
 */
export const MARKER_KEY = "demo_history";
type Counts = Record<string, number>;

const h = (col: string) => sql.raw(histIdSql(col));

export async function isHistoryPresent(x: Exec): Promise<{ present: boolean; users: number; requests: number; marker: unknown }> {
  const r = await x.execute(sql`select (select count(*) from users u where ${h("u.id")})::int users, (select count(*) from requests q where ${h("q.id")})::int requests, (select value from settings where key = ${MARKER_KEY}) marker`);
  const row = r.rows[0] as { users: number; requests: number; marker: unknown };
  return { present: row.users > 0 || row.requests > 0 || row.marker != null, users: row.users, requests: row.requests, marker: row.marker };
}

export async function resetHistory(x: Exec): Promise<Counts> {
  const removed: Counts = {};
  const del = async (label: string, q: ReturnType<typeof sql>) => { const r = await x.execute(q); removed[label] = (removed[label] ?? 0) + (r.rowCount ?? 0); };

  // 1. counters of the accounts that survive (the demo accounts) go back first, while the generated rows that produced them still exist
  await x.execute(sql`update driver_profiles p set rating_sum = p.rating_sum - s.sum, rating_count = p.rating_count - s.n
    from (select ratee_id, sum(stars)::int sum, count(*)::int n from ratings r where ${h("r.id")} group by ratee_id) s
    where p.user_id = s.ratee_id and not ${h("p.user_id")}`);
  await x.execute(sql`update business_profiles p set rating_sum = p.rating_sum - s.sum, rating_count = p.rating_count - s.n
    from (select ratee_id, sum(stars)::int sum, count(*)::int n from ratings r where ${h("r.id")} group by ratee_id) s
    where p.user_id = s.ratee_id and not ${h("p.user_id")}`);
  await x.execute(sql`update driver_profiles p set jobs_completed = greatest(0, p.jobs_completed - s.n)
    from (select driver_id, count(*)::int n from settlements st where ${h("st.id")} and st.status = 'paid' group by driver_id) s
    where p.user_id = s.driver_id and not ${h("p.user_id")}`);

  // wallets that survive: remember which ones nobody has posted to since the history was generated (their `updated_at` is put back below)
  const marker = (await x.execute(sql`select value from settings where key = ${MARKER_KEY}`)).rows[0] as { value?: { generatedAt?: string; restore?: { wallets?: Array<{ id: string; updatedAt: string }> } } } | undefined;
  const restore = marker?.value?.restore?.wallets ?? [];
  const since = marker?.value?.generatedAt ?? new Date(0).toISOString();
  const untouched = restore.length ? new Set(((await x.execute(sql`select w.id::text id from wallet_accounts w
    where w.id in (select account_id from ledger_entries where idempotency_key like ${LEDGER_PREFIX + "%"})
      and w.updated_at <= (select max(created_at) from ledger_entries l where l.account_id = w.id) + interval '1 second'
      and not exists (select 1 from ledger_entries l where l.account_id = w.id and l.idempotency_key not like ${LEDGER_PREFIX + "%"} and l.created_at > ${since}::timestamptz)`)).rows as Array<{ id: string }>).map((r) => r.id)) : new Set<string>();

  // 2. money (the ledger references requests, offers and settlements, so it goes first): reverse the generated postings on the accounts that stay, then drop them
  await x.execute(sql`update wallet_accounts w set available_cents = w.available_cents - s.a, reserved_cents = w.reserved_cents - s.r, held_cents = w.held_cents - s.h, updated_at = now()
    from (select account_id, sum(available_delta_cents)::int a, sum(reserved_delta_cents)::int r, sum(held_delta_cents)::int h from ledger_entries where idempotency_key like ${LEDGER_PREFIX + "%"} group by account_id) s
    where w.id = s.account_id and not ${h("w.id")}`);
  await del("ledger_entries", sql`delete from ledger_entries where idempotency_key like ${LEDGER_PREFIX + "%"}`);
  const back = restore.filter((r) => untouched.has(r.id));
  if (back.length) await x.execute(sql`update wallet_accounts w set updated_at = r.u::timestamptz from jsonb_to_recordset(${JSON.stringify(back.map((r) => ({ id: r.id, u: r.updatedAt })))}::jsonb) r(id uuid, u text) where w.id = r.id`);
  await del("withdrawals", sql`delete from withdrawals w where ${h("w.id")}`);

  // 3. things that reference generated orders / offers but do not cascade
  await del("ratings", sql`delete from ratings r where ${h("r.id")} or exists (select 1 from offers o where o.id = r.offer_id and ${h("o.id")})`);
  await del("shipment_media", sql`delete from shipment_media m where ${h("m.id")} or exists (select 1 from offers o where o.id = m.offer_id and ${h("o.id")})`);
  await del("cod_remittances", sql`delete from cod_remittances c where ${h("c.id")}`);
  await del("invoices", sql`delete from invoices i where ${h("i.id")}`);
  await del("settlements", sql`delete from settlements s where ${h("s.id")}`);
  await del("custody_items", sql`delete from custody_items c where ${h("c.id")}`);
  await del("complaints", sql`delete from complaints c where ${h("c.id")}`); // notes cascade
  await del("tickets", sql`delete from tickets t where ${h("t.id")}`); // replies and attachments cascade
  await del("ticket_attachments", sql`delete from ticket_attachments a where ${h("a.id")}`);
  await del("webhook_deliveries", sql`delete from webhook_deliveries d where ${h("d.id")}`);
  await del("requests", sql`delete from requests r where ${h("r.id")}`); // offers, parcels, job events, parcel events, chat cascade

  // 4. logs and everything else that carries a generated id
  for (const t of ["notifications", "audit_logs", "login_events", "driver_availability_log", "driver_location_history", "message_log", "entity_notes", "metric_snapshots", "terms_consents", "documents", "office_invites", "office_agreements", "api_keys"]) {
    await del(t, sql`delete from ${sql.raw(t)} where ${h("id")}`);
  }
  // 5. people (profiles, sessions, availability cascade), then their wallets
  for (const t of ["driver_profiles", "business_profiles", "office_profiles"]) await del(t, sql`delete from ${sql.raw(t)} where ${h("user_id")}`); // drivers point at their office: profiles first
  await del("wallet_accounts", sql`delete from wallet_accounts w where ${h("w.id")}`);
  await del("users", sql`delete from users u where ${h("u.id")}`);
  await x.execute(sql`delete from settings where key = ${MARKER_KEY}`);
  return removed;
}

/** Removes the placeholder image (documents / proofs / attachments of generated history all point at it). */
export async function removePlaceholder() {
  try { const { storage } = await import("@/server/storage"); await storage().remove(PLACEHOLDER_KEY); } catch { /* storage not configured: nothing to remove */ }
}
