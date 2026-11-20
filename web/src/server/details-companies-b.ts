import { eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { users, type User } from "@/db/schema";
import { can, requirePerm } from "./auth/permissions";
import { requireCompanyView } from "./companies-admin";
import { maskPhone } from "./account-admin-rules";
import { BILLED } from "./analytics/conditions";
import { bucketKeys } from "./analytics/periods";
import { zeroFill } from "./analytics/buckets";
import { num, rows } from "./analytics/guard";
import { addMonths, riyadhDay, startOfMonth } from "./analytics/time";
import { loadCompany } from "./details-companies";

type Row = Record<string, unknown>;
const iso = (v: unknown) => (v ? new Date(v as string).toISOString() : null);
const HIST_ACTIONS = ["account.create", "account.update", "account.verify", "account.reject", "account.request_info", "account.suspend", "user.active", "user.suspended"];

/** Profile facts that the header and the standard company payload do not carry: VAT number, source, who created it, last sign-in, verification history. */
export async function companyProfile(viewer: User, id: string) {
  requireCompanyView(viewer);
  const { u, p } = await loadCompany(id);
  const sens = can(viewer, "drivers.sensitive");
  const [creator] = u.createdBy ? await db.select({ id: users.id, name: users.name, role: users.role }).from(users).where(eq(users.id, u.createdBy)) : [];
  const seeHistory = can(viewer, "verification.manage") || can(viewer, "documents.review") || can(viewer, "audit.view");
  const history = seeHistory ? await rows<Row>(sql`
    select a.id, a.created_at as at, a.action, a.actor_id, usr.name as actor_name, a.diff->>'note' as note, a.diff->>'reason' as reason, d.type as doc_type, a.entity
    from audit_logs a left join users usr on usr.id = a.actor_id left join documents d on a.entity = 'document' and d.id::text = a.entity_id
    where (a.entity = 'user' and a.entity_id = ${id} and a.action in (${sql.join(HIST_ACTIONS.map((x) => sql`${x}`), sql`, `)}))
       or (a.entity = 'document' and a.action in ('document.approved','document.rejected','document.info_requested') and a.entity_id in (select id::text from documents where owner_id = ${id}))
    order by a.created_at desc limit 40`) : null;
  return {
    id: u.id, taxNumber: p?.taxNumber ?? null, crNumber: p?.crNumber ?? null, industry: p?.industry ?? null, address: p?.address ?? null, responsiblePerson: p?.responsiblePerson ?? null,
    language: u.language, source: u.source, isDemo: u.isDemo, createdAt: u.createdAt, createdBy: creator ?? null,
    contact: { phone: sens ? u.phone : maskPhone(u.phone), email: u.email, city: u.city },
    lastLoginAt: u.lastLoginAt, lastSeenAt: u.lastSeenAt, loginCount: u.loginCount, lastLoginClient: u.lastLoginClient,
    verification: { status: p?.verificationStatus ?? "pending", note: p?.verificationNote ?? null },
    history: history ? history.map((h) => ({ id: String(h.id), at: iso(h.at), action: String(h.action), actor: h.actor_id ? { id: String(h.actor_id), name: (h.actor_name as string | null) ?? null } : null, note: (h.note ?? h.reason ?? null) as string | null, docType: (h.doc_type as string | null) ?? null })) : null,
  };
}

/** Everything support may need to quote: the account row without secrets, the profile, the wallet account and record counts. */
export async function companyRaw(viewer: User, id: string) {
  requirePerm(viewer, "users.view");
  const { u, p } = await loadCompany(id);
  const sens = can(viewer, "drivers.sensitive");
  const [w] = await rows<Row>(sql`select id, available_cents, reserved_cents, held_cents, credit_limit_cents, updated_at from wallet_accounts where owner_id = ${id}`);
  const [n] = await rows<Row>(sql`select
    (select count(*) from requests where business_id = ${id})::int as requests, (select count(*) from shipments s join requests q on q.id = s.request_id where q.business_id = ${id})::int as shipments,
    (select count(*) from tickets where opened_by = ${id})::int as tickets, (select count(*) from complaints where filed_by = ${id})::int as complaints, (select count(*) from documents where owner_id = ${id})::int as documents,
    (select count(*) from api_keys where business_id = ${id} and revoked_at is null)::int as api_keys, (select count(*) from partner_connections where business_id = ${id})::int as partner_connections,
    (select count(*) from sessions where user_id = ${id} and revoked_at is null and expires_at > now())::int as sessions_active, (select count(*) from invoices where business_id = ${id})::int as invoices`);
  const host = (() => { try { return p?.webhookUrl ? new URL(p.webhookUrl).host : null; } catch { return null; } })();
  return {
    id: u.id, role: u.role, status: u.status, name: u.name, phone: sens ? u.phone : maskPhone(u.phone), email: u.email, city: u.city, language: u.language, source: u.source, createdBy: u.createdBy, isDemo: u.isDemo,
    createdAt: u.createdAt, updatedAt: u.updatedAt, lastLoginAt: u.lastLoginAt, lastSeenAt: u.lastSeenAt, loginCount: u.loginCount, failedLogins: u.failedLogins, lockedUntil: u.lockedUntil,
    profile: p ? { companyName: p.companyName, crNumber: p.crNumber, taxNumber: p.taxNumber, industry: p.industry, address: p.address, responsiblePerson: p.responsiblePerson, verificationStatus: p.verificationStatus, verificationNote: p.verificationNote, webhookHost: host, hasWebhookSecret: !!p.webhookSecret, warehouseLat: p.warehouseLat, warehouseLng: p.warehouseLng, ops: p.ops, ratingSum: p.ratingSum, ratingCount: p.ratingCount } : null,
    wallet: w ? { id: w.id, availableCents: num(w.available_cents), reservedCents: num(w.reserved_cents), heldCents: num(w.held_cents), creditLimitCents: num(w.credit_limit_cents), updatedAt: iso(w.updated_at) } : null,
    counts: n ?? {},
  };
}

/**
 * Money tab extras (the wallet / ledger / invoices / COD lists stay on their own endpoints): credit-line use, 12 months of spend against top-ups, what the ledger moved by kind
 * and the invoice totals. Wallet figures need `wallets.view` or `finance.view`; spend, ledger and invoices need `finance.view`.
 */
export async function companyMoney(viewer: User, id: string) {
  requireCompanyView(viewer);
  await loadCompany(id);
  const finance = can(viewer, "finance.view"), wallet = finance || can(viewer, "wallets.view");
  const today = riyadhDay(new Date()), from = startOfMonth(addMonths(today, -11)), keys = bucketKeys(from, today, "month");
  const since = sql`(${from}::date::timestamp at time zone 'Asia/Riyadh')`;
  const [w, spend, topups, kinds, inv] = await Promise.all([
    wallet ? rows<Row>(sql`select available_cents::float8 as a, reserved_cents::float8 as r, held_cents::float8 as h, credit_limit_cents::float8 as c, updated_at from wallet_accounts where owner_id = ${id}`) : null,
    finance ? rows<{ t: string; spend: number; vat: number }>(sql`select to_char(date_trunc('month', settlements.created_at at time zone 'Asia/Riyadh'), 'YYYY-MM-DD') as t, coalesce(sum(settlements.customer_cents), 0)::float8 as spend, coalesce(sum(settlements.vat_cents), 0)::float8 as vat
      from settlements where settlements.business_id = ${id} and ${BILLED} and settlements.created_at >= ${since} group by 1`) : null,
    finance ? rows<{ t: string; topups: number }>(sql`select to_char(date_trunc('month', l.created_at at time zone 'Asia/Riyadh'), 'YYYY-MM-DD') as t, coalesce(sum(l.available_delta_cents), 0)::float8 as topups
      from ledger_entries l join wallet_accounts a on a.id = l.account_id where a.owner_id = ${id} and l.kind = 'topup' and l.created_at >= ${since} group by 1`) : null,
    finance ? rows<Row>(sql`select l.kind as k, count(*)::int as n, coalesce(sum(l.available_delta_cents), 0)::float8 as available, coalesce(sum(l.reserved_delta_cents), 0)::float8 as reserved
      from ledger_entries l join wallet_accounts a on a.id = l.account_id where a.owner_id = ${id} and l.created_at >= ${since} group by 1 order by n desc`) : null,
    finance ? rows<Row>(sql`select count(*)::int as n, coalesce(sum(subtotal_cents), 0)::float8 as subtotal, coalesce(sum(vat_cents), 0)::float8 as vat, coalesce(sum(total_cents), 0)::float8 as total, max(created_at) as last_at from invoices where business_id = ${id}`) : null,
  ]);
  const a = w?.[0];
  const credit = num(a?.c), avail = num(a?.a);
  return {
    wallet: a ? { availableCents: avail, reservedCents: num(a.r), heldCents: num(a.h), creditLimitCents: credit, creditUsedCents: credit > 0 ? Math.max(0, -avail) : 0, creditUse: credit > 0 ? Math.max(0, -avail) / credit : null, updatedAt: iso(a.updated_at) } : null,
    months: spend && topups ? (() => { const s = zeroFill(keys, spend, ["spend", "vat"] as const), t = zeroFill(keys, topups, ["topups"] as const); return s.map((p, i) => ({ t: p.t, spend: p.spend, vat: p.vat, topups: t[i].topups })); })() : null,
    ledgerKinds: kinds ? kinds.map((k) => ({ kind: String(k.k), n: num(k.n), availableCents: num(k.available), reservedCents: num(k.reserved) })) : null,
    invoices: inv?.[0] ? { count: num(inv[0].n), subtotalCents: num(inv[0].subtotal), vatCents: num(inv[0].vat), totalCents: num(inv[0].total), lastAt: iso(inv[0].last_at) } : null,
    moneyHidden: !finance, walletHidden: !wallet,
  };
}
