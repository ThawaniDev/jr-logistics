/** Usernames (J1): the pure rules live in `@/lib/username` (shared with the web forms and the seeds); this file adds the database lookups. */
import { and, eq, ne } from "drizzle-orm";
import { db, type Exec } from "@/db";
import { users } from "@/db/schema";
import { normalizeUsername, usernameProblem, type UsernameReason } from "@/lib/username";

export * from "@/lib/username";
export type UsernameAvailability = { available: true } | { available: false; reason: "taken" | UsernameReason };

export async function usernameTaken(u: string, exceptId?: string, x: Exec = db): Promise<boolean> {
  const [r] = await x.select({ id: users.id }).from(users).where(and(eq(users.username, u), exceptId ? ne(users.id, exceptId) : undefined)).limit(1);
  return !!r;
}

/** `GET /auth/username-available`: is this name valid, not reserved and not used by anyone? (`exceptId` = the account being renamed.) */
export async function usernameAvailability(raw: string, exceptId?: string): Promise<UsernameAvailability> {
  const u = normalizeUsername(raw);
  const bad = usernameProblem(u);
  if (bad) return { available: false, reason: bad };
  return (await usernameTaken(u, exceptId)) ? { available: false, reason: "taken" } : { available: true };
}

/** `base`, or `base-2`, `base-3` … — the first one nobody uses (for names the system derives, never for ones a person typed). */
export async function uniqueUsername(base: string, x: Exec = db): Promise<string> {
  const root = base.slice(0, 26);
  let cand = root, n = 1;
  while (await usernameTaken(cand, undefined, x)) { n += 1; cand = `${root}-${n}`; if (n > 500) throw new Error("no free username"); }
  return cand;
}
