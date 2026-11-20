import { sql } from "drizzle-orm";
import { db } from "@/db";
import type { User } from "@/db/schema";
import { err } from "@/lib/errors";
import { requirePerm } from "./auth/permissions";
import { SERVICE_MAP } from "./catalog";
import { getSettings } from "./settings";

/**
 * One tax invoice for the admin console (`finance.view`) and for the company that owns it. The company payload never carries provider cost, margin, payee or ledger.
 * The invoice lines are DERIVED (invoices store totals only): the units billed on the settlement × the unit price locked in its pricing snapshot, plus an informational
 * "not charged" line for released units; whatever is left to the invoice total becomes a rounding line, so the lines always add up to the total exactly.
 */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- raw SQL rows carry driver-typed values; every field is read through num() / iso() / str()
type Row = Record<string, any>;
const rowsOf = async (q: ReturnType<typeof sql>) => (await db.execute(q)).rows as Row[];
const num = (v: unknown) => (v == null ? 0 : Number(v));
const iso = (v: unknown) => (v == null ? null : new Date(v as string).toISOString());
const str = (v: unknown) => (v == null || v === "" ? null : String(v));

export interface ParcelCounts { total: number; delivered: number; failed: number; returned: number; missing: number; cancelled: number }
export type LineKind = "billed" | "released" | "rounding" | "service";
export interface InvoiceLine {
  kind: LineKind; qty: number; unit: string | null; unitPriceCents: number | null;
  /** What this line adds to the total (VAT included). `null` = informational: nothing was charged for it. */
  amountCents: number | null;
  /** `released` lines: the reserved amount that went back to the company wallet. */
  releasedCents?: number;
}
export interface LineInput {
  service: string; totalCents: number; finalUnits: number | null; expectedUnits: number | null; refundCents: number | null; unitPriceCents: number | null; unit: string | null;
}

export const emptyParcels = (): ParcelCounts => ({ total: 0, delivered: 0, failed: 0, returned: 0, missing: 0, cancelled: 0 });
/** `shipments` rows grouped by status → the counts the sheet shows. */
export function parcelCounts(rows: Array<{ status: string; n: unknown }>): ParcelCounts {
  const p = emptyParcels();
  for (const r of rows) { const n = num(r.n); p.total += n; if (r.status in p) p[r.status as "delivered" | "failed" | "returned" | "missing" | "cancelled"] += n; }
  return p;
}
/** Stored subtotal + VAT must equal the total; a legacy row that does not is shown as total − VAT, never as a mismatch. */
export function normalizeTotals(i: { subtotalCents: number; vatCents: number; totalCents: number }) {
  return { subtotalCents: i.subtotalCents + i.vatCents === i.totalCents ? i.subtotalCents : i.totalCents - i.vatCents, vatCents: i.vatCents, totalCents: i.totalCents };
}
export const chargedSum = (lines: InvoiceLine[]) => lines.reduce((a, l) => a + (l.amountCents ?? 0), 0);

/**
 * Lines of one invoice. Units × unit price = amount (all VAT-inclusive, like every price on the platform). Released units (reserved but not billed) are listed as a
 * line that charges nothing. Without a settlement or a locked price the invoice is one service line; any remainder becomes a rounding line.
 */
export function deriveLines(i: LineInput): InvoiceLine[] {
  const unit = i.unit ?? SERVICE_MAP[i.service as keyof typeof SERVICE_MAP]?.unit ?? null;
  const price = i.unitPriceCents;
  if (i.finalUnits == null || price == null || i.finalUnits < 0) return [{ kind: "service", qty: 1, unit: null, unitPriceCents: i.totalCents, amountCents: i.totalCents }];
  const billed = price * i.finalUnits;
  const lines: InvoiceLine[] = [{ kind: "billed", qty: i.finalUnits, unit, unitPriceCents: price, amountCents: billed }];
  const refund = i.refundCents ?? 0;
  if (refund > 0) {
    const missed = i.expectedUnits != null && i.expectedUnits > i.finalUnits ? i.expectedUnits - i.finalUnits : price > 0 ? Math.round(refund / price) : 0;
    lines.push({ kind: "released", qty: missed, unit, unitPriceCents: price, amountCents: null, releasedCents: refund });
  }
  const rest = i.totalCents - billed;
  if (rest !== 0) lines.push({ kind: "rounding", qty: 1, unit: null, unitPriceCents: null, amountCents: rest });
  return lines;
}

const BASE = (id: string, owner?: string) => sql`select i.id, i.number, i.request_id, i.settlement_id, i.business_id, i.subtotal_cents, i.vat_cents, i.total_cents, i.vat_pct, i.created_at,
    r.ref, r.service, r.status as request_status, r.quantity, r.duration_days, r.pickup_city, r.delivery_city, r.starts_at, r.expected_units as req_expected_units, r.unit_price_cents as req_unit_price, r.pricing_snapshot as req_snapshot,
    u.name as user_name, u.city as user_city, bp.company_name, bp.responsible_person, bp.address, bp.cr_number, bp.tax_number
  from invoices i join requests r on r.id = i.request_id join users u on u.id = i.business_id left join business_profiles bp on bp.user_id = i.business_id
  where i.id = ${id}::uuid ${owner ? sql`and i.business_id = ${owner}::uuid` : sql``}`;
const SETTLEMENT = (id: string) => sql`select s.id, s.offer_id, s.status, s.driver_id, s.office_id, s.final_units, s.reserved_cents, s.customer_cents, s.provider_cents, s.margin_cents, s.vat_cents, s.refund_cents, s.adjustment_cents,
    s.note, s.pricing_snapshot, s.created_at, s.approved_at, s.paid_at, o.expected_units, du.name as driver_name, coalesce(op.office_name, ofu.name) as office_name
  from settlements s join offers o on o.id = s.offer_id join users du on du.id = s.driver_id left join users ofu on ofu.id = s.office_id left join office_profiles op on op.user_id = s.office_id where s.id = ${id}::uuid`;

async function load(id: string, owner?: string) {
  if (!UUID_RE.test(id)) throw err("NOT_FOUND", "Invoice not found");
  const [i] = await rowsOf(BASE(id, owner));
  if (!i) throw err("NOT_FOUND", "Invoice not found");
  const [s] = i.settlement_id ? await rowsOf(SETTLEMENT(String(i.settlement_id))) : [];
  const [grouped, cfg] = await Promise.all([ // parcel counts of the job (index shipments_offer_idx / shipments_request_idx)
    rowsOf(s ? sql`select status, count(*)::int n from shipments where offer_id = ${String(s.offer_id)}::uuid group by status` : sql`select status, count(*)::int n from shipments where request_id = ${String(i.request_id)}::uuid group by status`),
    getSettings(),
  ]);
  const snap = ((s?.pricing_snapshot ?? i.req_snapshot ?? {}) as Row);
  const unitPriceCents = snap.unitPriceCents != null ? num(snap.unitPriceCents) : i.req_unit_price != null ? num(i.req_unit_price) : null;
  const unit = str(snap.unit) ?? (SERVICE_MAP[i.service as keyof typeof SERVICE_MAP]?.unit ?? null);
  const totals = normalizeTotals({ subtotalCents: num(i.subtotal_cents), vatCents: num(i.vat_cents), totalCents: num(i.total_cents) });
  const lines = deriveLines({ service: String(i.service), totalCents: totals.totalCents, finalUnits: s ? num(s.final_units) : null, expectedUnits: s ? num(s.expected_units) : null, refundCents: s ? num(s.refund_cents) : null, unitPriceCents, unit });
  const view = {
    invoice: { id: String(i.id), number: String(i.number), createdAt: iso(i.created_at), vatPct: num(i.vat_pct), ...totals },
    paidAt: s?.status === "paid" ? iso(s.paid_at) : null,
    seller: { name: "JR Logistics", vatPct: cfg.vatPct }, // the platform keeps no legal name or tax number in its settings: only what exists is shown
    buyer: { id: String(i.business_id), name: str(i.company_name) ?? String(i.user_name), contact: str(i.responsible_person) ?? str(i.user_name), city: str(i.user_city), address: str(i.address), crNumber: str(i.cr_number), taxNumber: str(i.tax_number) },
    order: { id: String(i.request_id), ref: String(i.ref), service: String(i.service), status: String(i.request_status), quantity: num(i.quantity), durationDays: num(i.duration_days), pickupCity: str(i.pickup_city), deliveryCity: str(i.delivery_city), startsAt: iso(i.starts_at) },
    lines, linesTotalCents: chargedSum(lines), parcels: parcelCounts(grouped as Array<{ status: string; n: unknown }>), pricing: { unit, unitPriceCents },
  };
  return { view, i, s, snap };
}

/** `GET /business/invoices/:id` — the company's own invoice only (anyone else's is "not found"). */
export async function businessInvoice(user: User, id: string) {
  return (await load(id, user.id)).view;
}

/** `GET /admin/finance/invoices/:id` — the invoice plus the money behind it (`finance.view`). */
export async function adminInvoice(user: User, id: string) {
  requirePerm(user, "finance.view");
  const { view, i, s, snap } = await load(id);
  const sid = s ? String(s.id) : null;
  const [ledger, prev, next, siblings] = await Promise.all([
    sid ? rowsOf(sql`select e.id, e.kind, e.available_delta_cents, e.reserved_delta_cents, e.held_delta_cents, e.note, e.simulated, e.created_at, w.kind as account_kind, w.owner_id, ou.name as owner_name, ou.role as owner_role, au.name as actor_name
      from ledger_entries e join wallet_accounts w on w.id = e.account_id left join users ou on ou.id = w.owner_id left join users au on au.id = e.actor_id where e.settlement_id = ${sid}::uuid order by e.created_at, case e.kind when 'release_reserve' then 0 when 'charge' then 1 when 'payout' then 2 when 'platform_fee' then 3 else 4 end, e.id limit 50`) : Promise.resolve([]),
    rowsOf(sql`select id, number from invoices where business_id = ${String(i.business_id)}::uuid and (created_at, id) < (select created_at, id from invoices where id = ${view.invoice.id}::uuid) order by created_at desc, id desc limit 1`),
    rowsOf(sql`select id, number from invoices where business_id = ${String(i.business_id)}::uuid and (created_at, id) > (select created_at, id from invoices where id = ${view.invoice.id}::uuid) order by created_at, id limit 1`),
    rowsOf(sql`select id, number, total_cents, created_at from invoices where request_id = ${String(i.request_id)}::uuid and id <> ${view.invoice.id}::uuid order by created_at, id limit 20`),
  ]);
  const link = (r?: Row) => (r ? { id: String(r.id), number: String(r.number) } : null);
  return {
    ...view, settlementId: sid,
    admin: {
      settlement: s ? { id: sid, offerId: String(s.offer_id), status: String(s.status), finalUnits: num(s.final_units), expectedUnits: num(s.expected_units), reservedCents: num(s.reserved_cents), customerCents: num(s.customer_cents), providerCents: num(s.provider_cents), marginCents: num(s.margin_cents), vatCents: num(s.vat_cents), refundCents: num(s.refund_cents), adjustmentCents: num(s.adjustment_cents), note: str(s.note), createdAt: iso(s.created_at), approvedAt: iso(s.approved_at), paidAt: iso(s.paid_at) } : null,
      payee: s ? { kind: s.office_id ? "office" : "driver", id: String(s.office_id ?? s.driver_id), name: String(s.office_name ?? s.driver_name) } : null,
      driver: s ? { id: String(s.driver_id), name: String(s.driver_name) } : null,
      ledger: ledger.map((e) => ({ id: String(e.id), kind: String(e.kind), availableCents: num(e.available_delta_cents), reservedCents: num(e.reserved_delta_cents), heldCents: num(e.held_delta_cents), note: str(e.note), simulated: !!e.simulated, accountKind: String(e.account_kind), ownerId: str(e.owner_id), owner: str(e.owner_name), ownerRole: str(e.owner_role), actor: str(e.actor_name), createdAt: iso(e.created_at) })),
      snapshot: s ? snap : null,
      prev: link(prev[0]), next: link(next[0]),
      siblings: siblings.map((r) => ({ id: String(r.id), number: String(r.number), totalCents: num(r.total_cents), createdAt: iso(r.created_at) })),
    },
  };
}
