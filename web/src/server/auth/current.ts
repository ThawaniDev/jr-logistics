import { cookies } from "next/headers";
import { cache } from "react";
import { resolveSession, SESSION_COOKIE } from "./session";
import { sessionUser } from "./session-user";

/** Resolve the signed-in user in Server Components / layouts. */
export const getCurrentUser = cache(async () => {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  const u = await resolveSession(token);
  return u ? sessionUser(u) : null;
});
export type SessionUser = NonNullable<Awaited<ReturnType<typeof getCurrentUser>>>;
export const homeFor = (role: string) => (role === "admin" || role === "staff" ? "/admin" : `/${role}`);
