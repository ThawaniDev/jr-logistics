/**
 * Demo accounts sign in like everybody else (J1): a readable username and one published password. Used by `scripts/seed.ts` (new databases) and
 * `scripts/backfill-auth.ts` (`npm run db:backfill:auth`, databases that existed before usernames). Demo deployments only — the password is public.
 */
import { and, eq, isNull, ne } from "drizzle-orm";
import { db } from "@/db";
import { users } from "@/db/schema";
import { hashPassword } from "./auth/password";
import { usernameFromEmail, usernameFromPhone } from "@/lib/username";

export const DEMO_PASSWORD = "Demo#Pass2026";
export interface DemoAccount { username: string; phone?: string; email?: string }
/** The accounts `scripts/seed.ts` creates, with the usernames they sign in with. The drivers keep their order (demo.driver = Omar, sedan; demo.driver5 / 6 belong to the demo office). */
export const DEMO_ACCOUNTS: readonly DemoAccount[] = [
  { username: "demo.business", phone: "+966500000001" },
  { username: "demo.office", phone: "+966500000002" },
  { username: "demo.driver", phone: "+966500000011" },
  { username: "demo.driver2", phone: "+966500000012" },
  { username: "demo.driver3", phone: "+966500000013" },
  { username: "demo.driver4", phone: "+966500000014" },
  { username: "demo.driver5", phone: "+966500000015" },
  { username: "demo.driver6", phone: "+966500000016" },
  { username: "demo.ops", email: "ops@jrlogistics.demo" },
  { username: "demo.finance1", email: "finance1@jrlogistics.demo" },
  { username: "demo.finance2", email: "finance2@jrlogistics.demo" },
  { username: "demo.hr", email: "hr@jrlogistics.demo" },
  { username: "demo.support", email: "support@jrlogistics.demo" },
];
export const demoUsernameFor = (k: { phone?: string | null; email?: string | null }) => DEMO_ACCOUNTS.find((a) => (k.phone && a.phone === k.phone) || (k.email && a.email === k.email.toLowerCase()))?.username ?? null;

export interface BackfillResult { usernamesFilled: number; demoUpdated: Array<{ role: string; name: string; username: string }>; skipped: string[] }

/**
 * Idempotent. (1) Every account without a username gets one: staff / admin from the e-mail, everyone else `u` + the digits of the phone (the migration rule).
 * (2) Every `is_demo` account gets its readable username (when still free) and the published password, without a forced change. Real accounts are never given a password.
 */
export async function backfillAuth(): Promise<BackfillResult> {
  const res: BackfillResult = { usernamesFilled: 0, demoUpdated: [], skipped: [] };
  const taken = new Set((await db.select({ u: users.username }).from(users).where(ne(users.username, ""))).map((r) => r.u).filter(Boolean) as string[]);
  const claim = (base: string) => { let c = base.slice(0, 26), n = 1; while (taken.has(c)) { n += 1; c = `${base.slice(0, 26)}-${n}`; } taken.add(c); return c; };
  for (const r of await db.select({ id: users.id, role: users.role, email: users.email, phone: users.phone }).from(users).where(isNull(users.username)).orderBy(users.createdAt)) {
    const base = (r.role === "staff" || r.role === "admin") && r.email ? usernameFromEmail(r.email) : r.phone ? usernameFromPhone(r.phone) : `u${r.id.replace(/-/g, "").slice(0, 12)}`;
    await db.update(users).set({ username: claim(base) }).where(eq(users.id, r.id));
    res.usernamesFilled++;
  }
  const hash = await hashPassword(DEMO_PASSWORD);
  for (const d of await db.select().from(users).where(and(eq(users.isDemo, true)))) {
    const want = demoUsernameFor(d);
    const set: Partial<typeof users.$inferInsert> = { passwordHash: hash, mustChangePassword: false, failedLogins: 0, lockedUntil: null };
    if (want && d.username !== want) {
      if (taken.has(want)) res.skipped.push(`${want} is already used by another account — ${d.name} keeps ${d.username}`);
      else { set.username = want; if (d.username) taken.delete(d.username); taken.add(want); }
    }
    await db.update(users).set(set).where(eq(users.id, d.id));
    res.demoUpdated.push({ role: d.role, name: d.name, username: (set.username as string | undefined) ?? d.username ?? "—" });
  }
  return res;
}
