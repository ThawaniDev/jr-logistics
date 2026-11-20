import { and, eq, inArray, sql } from "drizzle-orm";
import type { Exec } from "@/db";
import { users, businessProfiles, officeProfiles, driverProfiles, pricingRules, walletAccounts } from "@/db/schema";
import { getSettings } from "@/server/settings";
import { SERVICE_MAP, TEMPERATURE_VEHICLES, type ServiceKey } from "@/server/catalog";
import type { CityDef } from "./types";
import { histIdSql } from "./ids";

/** Read-only look at the database the history will be written to: platform settings, approved prices, and the demo accounts that already exist. */
export interface RuleRow { id: string; service: string; vehicleType: string | null; temperature: string | null; pickupCity: string | null; deliveryCity: string | null; unit: string; priceCents: number; providerCostCents: number; version: number; effectiveAt: Date; expiresAt: Date | null; agreementRef: string | null }

export class RuleBook {
  constructor(readonly rows: RuleRow[]) {}
  /** Same precedence as `resolveRule`: more matched dimensions win, then the newer version (global rules only). */
  resolve(q: { service: string; vehicleType?: string | null; temperature?: string | null; pickupCity?: string | null; deliveryCity?: string | null }): RuleRow | null {
    const temp = q.vehicleType && TEMPERATURE_VEHICLES.includes(q.vehicleType) ? q.temperature ?? null : null;
    const dim = (rv: string | null, qv?: string | null) => (qv ? rv === null || rv === qv : rv === null);
    let best: RuleRow | null = null, bestScore = -1;
    for (const r of this.rows) {
      if (r.service !== q.service) continue;
      if (!dim(r.vehicleType, q.vehicleType) || !dim(r.temperature, temp) || !dim(r.pickupCity, q.pickupCity) || !dim(r.deliveryCity, q.deliveryCity)) continue;
      const score = (r.vehicleType ? 1 : 0) + (r.temperature ? 1 : 0) + (r.pickupCity ? 1 : 0) + (r.deliveryCity ? 1 : 0);
      if (!best || score > bestScore || (score === bestScore && (r.version > best.version || (r.version === best.version && r.effectiveAt > best.effectiveAt)))) { best = r; bestScore = score; }
    }
    return best;
  }
}

export interface ExistingUser { id: string; name: string; phone: string | null; email: string | null; city: string | null; createdAt: Date; role: string; staffRole: string | null; permissions: string[]; status: string }
export interface ExistingDriver extends ExistingUser { vehicleType: string | null; vehicleTemperature: string | null; services: string[]; officeId: string | null; iban: string | null; bankName: string | null; plate: string | null; nationalId: string | null; availability: string; walletId: string }
export interface ExistingBusiness extends ExistingUser { companyName: string; industry: string | null; address: string | null; cr: string | null; lat: number | null; lng: number | null; walletId: string }
export interface ExistingOffice extends ExistingUser { officeName: string; iban: string | null; bankName: string | null; cr: string | null; walletId: string }

export interface Baseline {
  cities: CityDef[]; vatPct: number; minWithdrawalCents: number; maxTopupCents: number; offerExpiryMin: number; checkinEarlyMin: number;
  termsVersion: string; cancelWarnAt: number; cancelSuspendAt: number; cancelWindowDays: number; cancelSuspendDays: number; cancelPolicyEnabled: boolean; warehouseDefaults: { requireArrivalConfirmation: boolean; requireLoadingRecord: boolean; requireDeliveryOtp: boolean; requireSignature: boolean };
  rules: RuleBook;
  staff: ExistingUser[];
  business: ExistingBusiness[]; offices: ExistingOffice[]; drivers: ExistingDriver[];
  platformWalletId: string | null;
}

export async function loadBaseline(x: Exec, readOnly = false): Promise<Baseline> {
  const s = await getSettings(x);
  const ruleRows = await x.select().from(pricingRules).where(and(eq(pricingRules.status, "approved"), sql`${pricingRules.businessId} is null`));
  const rules = new RuleBook(ruleRows.map((r) => ({ id: r.id, service: r.service, vehicleType: r.vehicleType, temperature: r.temperature, pickupCity: r.pickupCity, deliveryCity: r.deliveryCity, unit: r.unit, priceCents: r.priceCents, providerCostCents: r.providerCostCents, version: r.version, effectiveAt: r.effectiveAt, expiresAt: r.expiresAt, agreementRef: r.agreementRef })));
  const demo = await x.select().from(users).where(sql`${users.isDemo} = true and not ${sql.raw(histIdSql("users.id"))}`);
  const admins = await x.select().from(users).where(and(eq(users.role, "admin"), eq(users.status, "active"), sql`not ${sql.raw(histIdSql("users.id"))}`));
  const base = (u: typeof users.$inferSelect): ExistingUser => ({ id: u.id, name: u.name, phone: u.phone, email: u.email, city: u.city, createdAt: u.createdAt, role: u.role, staffRole: u.staffRole, permissions: u.permissions, status: u.status });
  const staff = [...admins, ...demo.filter((u) => u.role === "staff" && u.status === "active")].map(base);
  const wallet = async (id: string) => {
    const find = async () => (await x.select({ id: walletAccounts.id }).from(walletAccounts).where(eq(walletAccounts.ownerId, id)))[0]?.id;
    const have = await find();
    if (have || readOnly) return have ?? "dry-run-wallet";
    await x.insert(walletAccounts).values({ ownerId: id, kind: "user" }).onConflictDoNothing({ target: walletAccounts.ownerId });
    return (await find())!;
  };
  const bizIds = demo.filter((u) => u.role === "business").map((u) => u.id), offIds = demo.filter((u) => u.role === "office").map((u) => u.id), drvIds = demo.filter((u) => u.role === "driver").map((u) => u.id);
  const bp = bizIds.length ? await x.select().from(businessProfiles).where(inArray(businessProfiles.userId, bizIds)) : [];
  const op = offIds.length ? await x.select().from(officeProfiles).where(inArray(officeProfiles.userId, offIds)) : [];
  const dp = drvIds.length ? await x.select().from(driverProfiles).where(inArray(driverProfiles.userId, drvIds)) : [];
  const business: ExistingBusiness[] = [];
  for (const u of demo.filter((u) => u.role === "business")) { const p = bp.find((b) => b.userId === u.id); if (p) business.push({ ...base(u), companyName: p.companyName, industry: p.industry, address: p.address, cr: p.crNumber, lat: p.warehouseLat, lng: p.warehouseLng, walletId: await wallet(u.id) }); }
  const offices: ExistingOffice[] = [];
  for (const u of demo.filter((u) => u.role === "office")) { const p = op.find((b) => b.userId === u.id); if (p) offices.push({ ...base(u), officeName: p.officeName, iban: p.iban, bankName: p.bankName, cr: p.crNumber, walletId: await wallet(u.id) }); }
  const drivers: ExistingDriver[] = [];
  for (const u of demo.filter((u) => u.role === "driver")) {
    const p = dp.find((b) => b.userId === u.id);
    if (p) drivers.push({ ...base(u), vehicleType: p.vehicleType, vehicleTemperature: p.vehicleTemperature, services: p.services, officeId: p.officeId, iban: p.iban, bankName: p.bankName, plate: p.vehiclePlate, nationalId: p.nationalId, availability: p.availability, walletId: await wallet(u.id) });
  }
  const [plat] = await x.select({ id: walletAccounts.id }).from(walletAccounts).where(eq(walletAccounts.kind, "platform")).limit(1);
  return {
    cities: s.cities as CityDef[], vatPct: s.vatPct, minWithdrawalCents: s.minWithdrawalCents, maxTopupCents: s.maxTopupCents, offerExpiryMin: s.offerExpiryMin, checkinEarlyMin: s.checkinEarlyMin,
    termsVersion: s.termsVersion, cancelWarnAt: s.cancelWarnAt, cancelSuspendAt: s.cancelSuspendAt, cancelWindowDays: s.cancelWindowDays, cancelSuspendDays: s.cancelSuspendDays, cancelPolicyEnabled: s.cancelPolicyEnabled, warehouseDefaults: s.warehouseDefaults,
    rules, staff, business, offices, drivers, platformWalletId: plat?.id ?? null,
  };
}

/** Services the generator can price: only those with at least one approved global rule (and enabled in the settings). */
export function usableServices(b: Baseline, enabled: string[]): ServiceKey[] {
  return (Object.keys(SERVICE_MAP) as ServiceKey[]).filter((k) => enabled.includes(k) && b.rules.rows.some((r) => r.service === k));
}
