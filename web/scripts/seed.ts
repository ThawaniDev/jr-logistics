import { config } from "dotenv";
config({ path: process.env.ENV_FILE ?? ".env.local" });
import { eq, sql } from "drizzle-orm";

/**
 * Idempotent seed. NEVER deletes data and never overwrites an existing admin password.
 * Demo fixtures are only created when DEMO_MODE=true and NODE_ENV!=production.
 */
async function main() {
  const { db, closeDb } = await import("../src/db");
  const { users, driverProfiles, businessProfiles, officeProfiles, officeAgreements, pricingRules } = await import("../src/db/schema");
  const { ensureSuperAdmin } = await import("../src/server/accounts");
  const { hashPassword } = await import("../src/server/auth/password");
  const { ensureAccount, post } = await import("../src/server/wallet");
  const { createRule } = await import("../src/server/pricing");
  const { env } = await import("../src/lib/env");
  const { getSettings } = await import("../src/server/settings");
  const { STAFF_PRESETS } = await import("../src/server/catalog");

  const email = process.env.SUPER_ADMIN_EMAIL, pw = process.env.SUPER_ADMIN_PASSWORD;
  if (!email || !pw) throw new Error("SUPER_ADMIN_EMAIL and SUPER_ADMIN_PASSWORD are required");
  const admin = await ensureSuperAdmin(email, pw);
  console.log(`✓ super admin: ${admin.email}`);
  await getSettings(); // materialise defaults lazily

  if (!env.demoMode) { console.log("DEMO_MODE off → skipping demo fixtures"); await closeDb(); return; }

  const upsertUser = async (v: typeof users.$inferInsert) => {
    const [ex] = await db.select().from(users).where(v.email ? eq(users.email, v.email) : eq(users.phone, v.phone!));
    if (ex) return ex;
    const [u] = await db.insert(users).values({ ...v, isDemo: true }).returning();
    await ensureAccount(u.id);
    return u;
  };
  const demoPw = await hashPassword("Demo#Pass2026");
  const staff = [
    ["ops@jrlogistics.demo", "Operations Demo", "operations"], ["finance1@jrlogistics.demo", "Finance Reviewer", "finance"],
    ["finance2@jrlogistics.demo", "Finance Approver", "finance"], ["hr@jrlogistics.demo", "Verification Demo", "hr_verification"], ["support@jrlogistics.demo", "Support Demo", "support"],
  ] as const;
  for (const [e, n, r] of staff) await upsertUser({ role: "staff", name: n, email: e, passwordHash: demoPw, staffRole: r, permissions: STAFF_PRESETS[r] });

  const biz = await upsertUser({ role: "business", name: "Sara Alharbi", phone: "+966500000001", city: "riyadh" });
  await db.insert(businessProfiles).values({ userId: biz.id, companyName: "Nakheel Fresh Foods", crNumber: "1010123456", industry: "Food & Grocery", verificationStatus: "verified" }).onConflictDoNothing();
  const bAcct = await ensureAccount(biz.id);
  await post(db, { accountId: bAcct.id, kind: "topup", available: 20_000_00, idempotencyKey: "demo-seed-biz", simulated: true, note: "demo seed" });

  const office = await upsertUser({ role: "office", name: "Faisal Almutairi", phone: "+966500000002", city: "riyadh" });
  await db.insert(officeProfiles).values({ userId: office.id, officeName: "Al Wajiha Courier Office", crNumber: "1010765432", city: "riyadh", iban: "SA0380000000608010167519", bankName: "Al Rajhi", verificationStatus: "verified" }).onConflictDoNothing();
  const [ag] = await db.select().from(officeAgreements).where(eq(officeAgreements.officeId, office.id));
  if (!ag) await db.insert(officeAgreements).values({ officeId: office.id, status: "accepted", acceptedAt: new Date(), terms: "Demo agreement" });

  const drivers = [
    ["Omar Alqahtani", "+966500000011", "sedan", null, null], ["Khalid Alotaibi", "+966500000012", "dokker", null, null],
    ["Yusuf Khan", "+966500000013", "hiace", null, null], ["Nasser Alshammari", "+966500000014", "van", "cold", null], ["Bilal Ahmed", "+966500000015", "sedan", null, office.id],
    ["Tariq Mahmood", "+966500000016", "sedan", null, office.id],
  ] as const;
  for (const [name, phone, vehicle, temp, officeId] of drivers) {
    const u = await upsertUser({ role: "driver", name, phone, city: "riyadh" });
    await db.insert(driverProfiles).values({
      userId: u.id, vehicleType: vehicle, vehicleTemperature: temp, services: ["delivery_driver", "car_with_driver"], availability: "available", verificationStatus: "verified",
      officeId, officeLinkStatus: officeId ? "linked" : "direct", iban: "SA0380000000608010167519", bankName: "SNB", nationalId: "1" + phone.slice(-9),
    }).onConflictDoNothing();
  }

  const [anyRule] = await db.select({ n: sql<number>`count(*)::int` }).from(pricingRules);
  if (!anyRule.n) {
    const R = (o: Parameters<typeof createRule>[1]) => createRule(admin, { pickupCity: "riyadh", ...o });
    for (const [v, price, cost] of [["sedan", 800, 550], ["dokker", 900, 620], ["hiace", 1100, 780], ["van", 1300, 900], ["dyna", 1600, 1150]] as const) {
      for (const city of ["riyadh", "jeddah", "dammam"]) {
        if (v === "van" || v === "dyna") for (const t of ["dry", "cold"]) await R({ service: "delivery_driver", vehicleType: v, temperature: t, deliveryCity: city, priceCents: price + (t === "cold" ? 200 : 0) + (city === "riyadh" ? 0 : 300), providerCostCents: cost + (t === "cold" ? 150 : 0) + (city === "riyadh" ? 0 : 200) });
        else await R({ service: "delivery_driver", vehicleType: v, deliveryCity: city, priceCents: price + (city === "riyadh" ? 0 : 300), providerCostCents: cost + (city === "riyadh" ? 0 : 200) });
      }
    }
    for (const [v, price, cost] of [["sedan", 28000, 20000], ["dokker", 32000, 23000], ["hiace", 40000, 29000], ["van", 45000, 33000]] as const) {
      await R({ service: "car_with_driver", vehicleType: v, priceCents: price, providerCostCents: cost });
      await R({ service: "car_without_driver", vehicleType: v, priceCents: Math.round(price * 0.6), providerCostCents: 0 });
    }
  }
  console.log("✓ demo fixtures ready");
  await closeDb();
}
main().catch((e) => { console.error(e); process.exit(1); });
