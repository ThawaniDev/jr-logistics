import { sql, eq } from "drizzle-orm";
import { db, closeDb } from "@/db";
import { users, businessProfiles, driverProfiles, officeProfiles, officeAgreements, pricingRules } from "@/db/schema";
import { ensureAccount, post } from "@/server/wallet";
import { clearSettingsCache } from "@/server/settings";
import { hashPassword } from "@/server/auth/password";
import { createRule } from "@/server/pricing";
import { createDraft, publishRequest, type RequestInput } from "@/server/requests";
import type { User } from "@/db/schema";

let n = 0;
const uniq = () => `${Date.now().toString().slice(-6)}${(++n).toString().padStart(4, "0")}`;

export async function resetDb() {
  const rows = await db.execute<{ tablename: string }>(sql`select tablename from pg_tables where schemaname='public'`);
  const names = rows.rows.map((r) => `"${r.tablename}"`);
  await db.execute(sql.raw(`truncate ${names.join(",")} restart identity cascade`));
  clearSettingsCache();
}
export const shutdown = closeDb;

export async function mkAdmin(): Promise<User> {
  const [u] = await db.insert(users).values({ role: "admin", name: "Admin", email: `admin${uniq()}@t.test`, passwordHash: await hashPassword("Password123") }).returning();
  return u;
}
export async function mkStaff(permissions: string[]): Promise<User> {
  const [u] = await db.insert(users).values({ role: "staff", name: "Staff " + uniq(), email: `staff${uniq()}@t.test`, passwordHash: await hashPassword("Password123"), permissions }).returning();
  return u;
}
export async function mkBusiness(o: { verified?: boolean; fundsCents?: number; name?: string } = {}): Promise<User> {
  const [u] = await db.insert(users).values({ role: "business", name: o.name ?? "Biz " + uniq(), phone: `+9665${uniq().padStart(8, "0").slice(-8)}`, city: "riyadh" }).returning();
  await db.insert(businessProfiles).values({ userId: u.id, companyName: "Co " + u.name, verificationStatus: o.verified === false ? "pending" : "verified" });
  const a = await ensureAccount(u.id);
  if (o.fundsCents) await post(db, { accountId: a.id, kind: "topup", available: o.fundsCents, idempotencyKey: `seed:${u.id}`, simulated: true });
  return u;
}
export async function mkDriver(o: { verified?: boolean; vehicle?: string; temp?: string | null; city?: string; officeId?: string | null; available?: boolean; services?: string[]; name?: string } = {}): Promise<User> {
  const [u] = await db.insert(users).values({ role: "driver", name: o.name ?? "Driver " + uniq(), phone: `+9665${uniq().padStart(8, "0").slice(-8)}`, city: o.city ?? "riyadh" }).returning();
  await db.insert(driverProfiles).values({
    userId: u.id, vehicleType: o.vehicle ?? "sedan", vehicleTemperature: o.temp ?? null, services: o.services ?? ["delivery_driver", "car_with_driver"],
    availability: o.available === false ? "unavailable" : "available", verificationStatus: o.verified === false ? "pending" : "verified",
    officeId: o.officeId ?? null, officeLinkStatus: o.officeId ? "linked" : "direct", iban: "SA0380000000608010167519", bankName: "Bank",
  });
  await ensureAccount(u.id);
  return u;
}
export async function mkOffice(o: { verified?: boolean; agreement?: boolean } = {}): Promise<User> {
  const [u] = await db.insert(users).values({ role: "office", name: "Office " + uniq(), phone: `+9665${uniq().padStart(8, "0").slice(-8)}`, city: "riyadh" }).returning();
  await db.insert(officeProfiles).values({ userId: u.id, officeName: "Off " + u.name, verificationStatus: o.verified === false ? "pending" : "verified", iban: "SA0380000000608010167519" });
  if (o.agreement !== false) await db.insert(officeAgreements).values({ officeId: u.id, status: "accepted", acceptedAt: new Date() });
  await ensureAccount(u.id);
  return u;
}
export async function mkRule(admin: User, o: Partial<Parameters<typeof createRule>[1]> = {}) {
  return createRule(admin, { service: "delivery_driver", vehicleType: "sedan", pickupCity: "riyadh", deliveryCity: "riyadh", priceCents: 1000, providerCostCents: 700, ...o });
}
export const tomorrow = (h = 9) => { const d = new Date(Date.now() + 864e5); d.setUTCHours(h, 0, 0, 0); return d; };
export const reqInput = (o: Partial<RequestInput> = {}): RequestInput => ({
  service: "delivery_driver", quantity: 1, shipmentsPerDriver: 10, vehicleType: "sedan", pickupCity: "riyadh", deliveryCity: "riyadh",
  startsAt: tomorrow(), durationDays: 1, ...o,
});
export async function publishedRequest(biz: User, o: Partial<RequestInput> = {}) {
  const d = await createDraft(biz, reqInput(o));
  return publishRequest(biz, d.id, { termsAccepted: true });
}
export { pricingRules, eq };
