import { sql } from "drizzle-orm";
import { db } from "@/db";
import type { User } from "@/db/schema";
import { requirePerm } from "./auth/permissions";
import { loadOrder, isoOrNull, num, rowsOf, type Row } from "./details-orders";
import { offerCodMap } from "./cod";

const LEDGER_PAGE = 50;
/**
 * The money of one order (`finance.view`): the price snapshot and the rule it came from, the reservation and its release, settlements with their breakdown, invoices,
 * every ledger entry that references the order (paged), refunds / adjustments, and cash on delivery per driver with the remittance rows.
 */
export async function orderMoney(user: User, id: string, q: { page?: number } = {}) {
  requirePerm(user, "finance.view");
  const r = await loadOrder(user, id);
  const page = Math.max(q.page ?? 1, 1);
  const snap = (r.pricingSnapshot ?? null) as Row | null;
  const rid = r.id;
  const [rule, byKind, ledger, [lt], adjust, settlements, invoices, cod, remits] = await Promise.all([
    snap?.ruleId ? rowsOf(sql`select id, version, status, service, vehicle_type, temperature, pickup_city, delivery_city, business_id, unit, price_cents, provider_cost_cents, agreement_ref, effective_at, expires_at, notes from pricing_rules where id = ${snap.ruleId}::uuid`) : Promise.resolve([]),
    rowsOf(sql`select kind, count(*)::int n, coalesce(sum(available_delta_cents), 0)::float8 available, coalesce(sum(reserved_delta_cents), 0)::float8 reserved, coalesce(sum(held_delta_cents), 0)::float8 held from ledger_entries where request_id = ${rid}::uuid group by kind order by kind`),
    rowsOf(sql`select e.id, e.kind, e.available_delta_cents, e.reserved_delta_cents, e.held_delta_cents, e.offer_id, e.settlement_id, e.note, e.simulated, e.created_at, w.kind account_kind, ou.name owner_name, ou.role owner_role, au.name actor_name
      from ledger_entries e join wallet_accounts w on w.id = e.account_id left join users ou on ou.id = w.owner_id left join users au on au.id = e.actor_id
      where e.request_id = ${rid}::uuid order by e.created_at desc, e.id limit ${LEDGER_PAGE} offset ${(page - 1) * LEDGER_PAGE}`),
    rowsOf(sql`select count(*)::int n from ledger_entries where request_id = ${rid}::uuid`),
    rowsOf(sql`select e.id, e.kind, e.available_delta_cents, e.note, e.created_at, ou.name owner_name, au.name actor_name from ledger_entries e join wallet_accounts w on w.id = e.account_id left join users ou on ou.id = w.owner_id left join users au on au.id = e.actor_id
      where e.request_id = ${rid}::uuid and e.kind in ('refund', 'adjustment') order by e.created_at desc limit 50`),
    rowsOf(sql`select s.id, s.offer_id, s.status, s.final_units, s.reserved_cents, s.customer_cents, s.provider_cents, s.margin_cents, s.vat_cents, s.refund_cents, s.adjustment_cents, s.note, s.created_at, s.approved_at, s.paid_at, s.driver_id,
        du.name driver_name, coalesce(op.office_name, ofu.name) office_name, s.office_id, ru.name reviewer_name, au.name approver_name
      from settlements s join users du on du.id = s.driver_id left join users ofu on ofu.id = s.office_id left join office_profiles op on op.user_id = s.office_id left join users ru on ru.id = s.reviewed_by left join users au on au.id = s.approved_by
      where s.request_id = ${rid}::uuid order by s.created_at`),
    rowsOf(sql`select id, number, settlement_id, subtotal_cents, vat_cents, total_cents, vat_pct, created_at from invoices where request_id = ${rid}::uuid order by created_at`),
    rowsOf(sql`select o.id offer_id, o.driver_id, u.name driver_name, count(s.id) filter (where s.cod_collected_cents is not null)::int parcels, coalesce(sum(s.cod_cents) filter (where s.status <> 'cancelled'), 0)::float8 due, max(s.cod_collected_at) last_at
      from offers o join users u on u.id = o.driver_id left join shipments s on s.offer_id = o.id where o.request_id = ${rid}::uuid group by o.id, u.name having count(s.id) filter (where s.cod_cents > 0) > 0 order by u.name`),
    rowsOf(sql`select c.id, c.ref, c.offer_id, c.amount_cents, c.received_by_role, c.note, c.created_at, du.name driver_name, ru.name received_by_name from cod_remittances c join users du on du.id = c.driver_id left join users ru on ru.id = c.received_by where c.request_id = ${rid}::uuid order by c.created_at desc limit 100`),
  ]);
  const figs = await offerCodMap(db, cod.map((c) => c.offer_id));
  const sum = (k: string) => settlements.filter((s) => s.status !== "rejected").reduce((a, s) => a + num(s[k]), 0);
  const codRows = cod.map((c) => ({ offerId: c.offer_id, driverId: c.driver_id, driverName: c.driver_name, parcels: num(c.parcels), dueCents: num(c.due), collectedCents: figs.get(c.offer_id)?.collectedCents ?? 0, receivedCents: figs.get(c.offer_id)?.receivedCents ?? 0, outstandingCents: figs.get(c.offer_id)?.outstandingCents ?? 0, lastCollectedAt: isoOrNull(c.last_at) }));
  const reserved = byKind.find((k) => k.kind === "reserve"), released = byKind.find((k) => k.kind === "release_reserve");
  return {
    request: { id: r.id, ref: r.ref, status: r.status, totalCents: r.totalCents, unitPriceCents: r.unitPriceCents, reservedCents: r.reservedCents, expectedUnits: r.expectedUnits, quantity: r.quantity },
    pricing: { snapshot: snap, rule: rule[0] ? { id: rule[0].id, version: num(rule[0].version), status: rule[0].status, vehicleType: rule[0].vehicle_type, temperature: rule[0].temperature, pickupCity: rule[0].pickup_city, deliveryCity: rule[0].delivery_city, businessSpecific: !!rule[0].business_id, unit: rule[0].unit, priceCents: num(rule[0].price_cents), providerCostCents: num(rule[0].provider_cost_cents), agreementRef: rule[0].agreement_ref, effectiveAt: isoOrNull(rule[0].effective_at), expiresAt: isoOrNull(rule[0].expires_at) } : null },
    reservation: { currentCents: r.reservedCents, reservedCents: Math.abs(num(reserved?.reserved)), releasedCents: Math.abs(num(released?.reserved)), entries: byKind.map((k) => ({ kind: k.kind, n: num(k.n), availableCents: num(k.available), reservedCents: num(k.reserved), heldCents: num(k.held) })) },
    totals: { settlements: settlements.length, customerCents: sum("customer_cents"), providerCents: sum("provider_cents"), marginCents: sum("margin_cents"), vatCents: sum("vat_cents"), refundCents: sum("refund_cents"), adjustmentCents: sum("adjustment_cents"), invoicedCents: invoices.reduce((a, i) => a + num(i.total_cents), 0) },
    settlements: settlements.map((s) => ({ id: s.id, offerId: s.offer_id, status: s.status, driverId: s.driver_id, driverName: s.driver_name, officeId: s.office_id, officeName: s.office_name ?? null, finalUnits: num(s.final_units), reservedCents: num(s.reserved_cents), customerCents: num(s.customer_cents), providerCents: num(s.provider_cents), marginCents: num(s.margin_cents), vatCents: num(s.vat_cents), refundCents: num(s.refund_cents), adjustmentCents: num(s.adjustment_cents), note: s.note, reviewer: s.reviewer_name ?? null, approver: s.approver_name ?? null, createdAt: isoOrNull(s.created_at), approvedAt: isoOrNull(s.approved_at), paidAt: isoOrNull(s.paid_at) })),
    invoices: invoices.map((i) => ({ id: i.id, number: i.number, settlementId: i.settlement_id, subtotalCents: num(i.subtotal_cents), vatCents: num(i.vat_cents), totalCents: num(i.total_cents), vatPct: num(i.vat_pct), createdAt: isoOrNull(i.created_at) })),
    ledger: { page, pageSize: LEDGER_PAGE, total: num(lt?.n), items: ledger.map((e) => ({ id: e.id, kind: e.kind, availableCents: num(e.available_delta_cents), reservedCents: num(e.reserved_delta_cents), heldCents: num(e.held_delta_cents), offerId: e.offer_id, settlementId: e.settlement_id, note: e.note, simulated: e.simulated, accountKind: e.account_kind, owner: e.owner_name ?? null, ownerRole: e.owner_role ?? null, actor: e.actor_name ?? null, createdAt: isoOrNull(e.created_at) })) },
    adjustments: adjust.map((e) => ({ id: e.id, kind: e.kind, amountCents: num(e.available_delta_cents), note: e.note, owner: e.owner_name ?? null, actor: e.actor_name ?? null, createdAt: isoOrNull(e.created_at) })),
    cod: { drivers: codRows, totals: codRows.reduce((a, c) => ({ dueCents: a.dueCents + c.dueCents, collectedCents: a.collectedCents + c.collectedCents, receivedCents: a.receivedCents + c.receivedCents, outstandingCents: a.outstandingCents + c.outstandingCents }), { dueCents: 0, collectedCents: 0, receivedCents: 0, outstandingCents: 0 }),
      remittances: remits.map((c) => ({ id: c.id, ref: c.ref, offerId: c.offer_id, driverName: c.driver_name, amountCents: num(c.amount_cents), receivedBy: c.received_by_name ?? null, receivedByRole: c.received_by_role, note: c.note, createdAt: isoOrNull(c.created_at) })) },
  };
}
