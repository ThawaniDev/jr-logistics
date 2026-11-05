import { and, desc, eq, gt, isNull, lte, or, sql } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import { db, type Exec } from "@/db";
import { pricingRules, type User } from "@/db/schema";
import { err } from "@/lib/errors";
import { SERVICE_MAP, TEMPERATURE_VEHICLES, VEHICLE_TYPES, type ServiceKey } from "./catalog";
import { audit } from "./audit";
import { getSettings } from "./settings";

export type Rule = typeof pricingRules.$inferSelect;

export interface RuleQuery {
  service: ServiceKey; vehicleType?: string | null; temperature?: string | null;
  pickupCity?: string | null; deliveryCity?: string | null; businessId?: string | null; at?: Date;
}

/**
 * Most-specific approved & effective rule wins.
 * 1. A business-specific rule always beats a global one.
 * 2. More matched dimensions (vehicle, temperature, pickup, delivery) beat fewer.
 * 3. Newer version, then newer effective date.
 * Null dimensions on a rule are wildcards. Expired/future/unapproved rules never resolve.
 */
export async function resolveRule(q: RuleQuery, x: Exec = db): Promise<Rule | null> {
  const at = q.at ?? new Date();
  const temp = q.vehicleType && TEMPERATURE_VEHICLES.includes(q.vehicleType) ? q.temperature ?? null : null;
  const dim = (col: AnyPgColumn, v?: string | null) =>
    v ? or(isNull(col), eq(col, v)) : isNull(col);
  const rows = await x.select().from(pricingRules).where(and(
    eq(pricingRules.service, q.service), eq(pricingRules.status, "approved"),
    lte(pricingRules.effectiveAt, at), or(isNull(pricingRules.expiresAt), gt(pricingRules.expiresAt, at)),
    q.businessId ? or(isNull(pricingRules.businessId), eq(pricingRules.businessId, q.businessId)) : isNull(pricingRules.businessId),
    dim(pricingRules.vehicleType, q.vehicleType), dim(pricingRules.temperature, temp),
    dim(pricingRules.pickupCity, q.pickupCity), dim(pricingRules.deliveryCity, q.deliveryCity),
  )).orderBy(
    desc(sql`(${pricingRules.businessId} IS NOT NULL)::int`),
    desc(sql`(${pricingRules.vehicleType} IS NOT NULL)::int + (${pricingRules.temperature} IS NOT NULL)::int + (${pricingRules.pickupCity} IS NOT NULL)::int + (${pricingRules.deliveryCity} IS NOT NULL)::int`),
    desc(pricingRules.version), desc(pricingRules.effectiveAt),
  ).limit(1);
  return rows[0] ?? null;
}

export interface Quote {
  ruleId: string; ruleVersion: number; agreementRef: string | null; currency: string; unit: string;
  unitPriceCents: number; providerCostCents: number; quantity: number; expectedUnits: number;
  totalCents: number; providerTotalCents: number; marginCents: number; effectiveAt: string; expiresAt: string | null;
}

export interface QuoteInput {
  service: ServiceKey; quantity: number; shipmentsPerDriver?: number | null; durationDays: number;
}

/** Units per slot: shipments for delivery, days for vehicle services. */
export function expectedUnitsFor(i: QuoteInput): number {
  const def = SERVICE_MAP[i.service];
  if (def.hasShipments) {
    if (!i.shipmentsPerDriver || i.shipmentsPerDriver < 1) throw err("VALIDATION", "shipmentsPerDriver is required", { field: "shipmentsPerDriver" });
    return i.shipmentsPerDriver;
  }
  return Math.max(1, i.durationDays);
}

export function buildQuote(rule: Rule, i: QuoteInput): Quote {
  if (!Number.isInteger(i.quantity) || i.quantity < 1) throw err("VALIDATION", "quantity must be a positive integer", { field: "quantity" });
  const units = expectedUnitsFor(i);
  const total = rule.priceCents * i.quantity * units;
  const providerTotal = rule.providerCostCents * i.quantity * units;
  return {
    ruleId: rule.id, ruleVersion: rule.version, agreementRef: rule.agreementRef, currency: rule.currency, unit: rule.unit,
    unitPriceCents: rule.priceCents, providerCostCents: rule.providerCostCents, quantity: i.quantity, expectedUnits: units,
    totalCents: total, providerTotalCents: providerTotal, marginCents: total - providerTotal,
    effectiveAt: rule.effectiveAt.toISOString(), expiresAt: rule.expiresAt?.toISOString() ?? null,
  };
}

/** Customer-safe view of a quote: never exposes provider cost or margin. */
export const publicQuote = (q: Quote) => ({
  ruleVersion: q.ruleVersion, currency: q.currency, unit: q.unit, unitPriceCents: q.unitPriceCents,
  quantity: q.quantity, expectedUnits: q.expectedUnits, totalCents: q.totalCents,
});

// ── Admin management ──
export interface RuleInput {
  service: ServiceKey; vehicleType?: string | null; temperature?: string | null; pickupCity?: string | null;
  deliveryCity?: string | null; businessId?: string | null; priceCents: number; providerCostCents: number;
  agreementRef?: string | null; effectiveAt?: Date; expiresAt?: Date | null; notes?: string | null;
}

export async function createRule(actor: User, input: RuleInput) {
  const def = SERVICE_MAP[input.service];
  if (!def) throw err("VALIDATION", "Unknown service");
  const settings = await getSettings();
  if (!settings.enabledServices.includes(input.service)) throw err("SERVICE_DISABLED");
  if (input.vehicleType && !(VEHICLE_TYPES as readonly string[]).includes(input.vehicleType)) throw err("VALIDATION", "Unknown vehicle type");
  const temperature = input.vehicleType && TEMPERATURE_VEHICLES.includes(input.vehicleType) ? input.temperature ?? null : null;
  if (input.providerCostCents > input.priceCents) throw err("VALIDATION", "Provider cost cannot exceed customer price");
  if (input.priceCents <= 0) throw err("VALIDATION", "Price must be positive");
  const cityKeys = new Set(settings.cities.map((c) => c.key));
  for (const c of [input.pickupCity, input.deliveryCity]) if (c && !cityKeys.has(c)) throw err("VALIDATION", `Unknown city ${c}`);
  return db.transaction(async (tx) => {
    const same = and(
      eq(pricingRules.service, input.service), eq(pricingRules.status, "approved"),
      input.vehicleType ? eq(pricingRules.vehicleType, input.vehicleType) : isNull(pricingRules.vehicleType),
      temperature ? eq(pricingRules.temperature, temperature) : isNull(pricingRules.temperature),
      input.pickupCity ? eq(pricingRules.pickupCity, input.pickupCity) : isNull(pricingRules.pickupCity),
      input.deliveryCity ? eq(pricingRules.deliveryCity, input.deliveryCity) : isNull(pricingRules.deliveryCity),
      input.businessId ? eq(pricingRules.businessId, input.businessId) : isNull(pricingRules.businessId),
    );
    const prev = await tx.select().from(pricingRules).where(same).orderBy(desc(pricingRules.version)).limit(1);
    if (prev[0]) await tx.update(pricingRules).set({ status: "retired" }).where(same);
    const [rule] = await tx.insert(pricingRules).values({
      service: input.service, vehicleType: input.vehicleType ?? null, temperature,
      pickupCity: input.pickupCity ?? null, deliveryCity: input.deliveryCity ?? null, businessId: input.businessId ?? null,
      unit: def.unit, priceCents: input.priceCents, providerCostCents: input.providerCostCents,
      agreementRef: input.agreementRef ?? null, effectiveAt: input.effectiveAt ?? new Date(), expiresAt: input.expiresAt ?? null,
      version: (prev[0]?.version ?? 0) + 1, approvedBy: actor.id, createdBy: actor.id, notes: input.notes ?? null,
    }).returning();
    await audit(actor, "pricing.create", "pricing_rule", rule.id, { supersedes: prev[0]?.id ?? null }, tx);
    return rule;
  });
}

export async function retireRule(actor: User, id: string) {
  const [r] = await db.update(pricingRules).set({ status: "retired" }).where(eq(pricingRules.id, id)).returning();
  if (!r) throw err("NOT_FOUND");
  await audit(actor, "pricing.retire", "pricing_rule", id);
  return r;
}

export async function listRules(filter: { service?: string; businessId?: string; includeRetired?: boolean } = {}) {
  return db.select().from(pricingRules).where(and(
    filter.service ? eq(pricingRules.service, filter.service) : undefined,
    filter.businessId ? eq(pricingRules.businessId, filter.businessId) : undefined,
    filter.includeRetired ? undefined : eq(pricingRules.status, "approved"),
  )).orderBy(desc(pricingRules.createdAt)).limit(500);
}
