/**
 * Username rules (J1) — pure, shared by the server (server/auth/username.ts), the web forms and the seeds. The name everybody signs in with, next to a password:
 * lower-case, 3–30 characters of a-z 0-9 . _ - and starting with a letter or a digit. Always lower-cased before it is compared or stored, so "Demo.Driver" and
 * "demo.driver" are the same account. The mobile app mirrors these rules; the server is the authority.
 */
export const USERNAME_MIN = 3;
export const USERNAME_MAX = 30;
export const USERNAME_RE = /^[a-z0-9][a-z0-9._-]{2,29}$/;
/** Names nobody may pick for themselves (system accounts, look-alikes of the platform and of its staff roles). Seeds and migrations are not bound by this list. */
export const RESERVED_USERNAMES: readonly string[] = [
  "admin", "administrator", "root", "system", "support", "staff", "operator", "moderator", "owner", "security", "billing", "finance", "operations",
  "jr", "jrlogistics", "jr-logistics", "jr.logistics", "api", "www", "null", "undefined", "anonymous", "guest", "me", "login", "logout", "register", "signup", "signin",
];

export type UsernameReason = "invalid" | "reserved";

/** What a sign-in or a form field holds → the stored form (NFKC folds full-width letters, then trim + lower-case). */
export const normalizeUsername = (raw: string) => (raw ?? "").normalize("NFKC").trim().toLowerCase();

/** `null` when the (already normalised) name may be used, otherwise why not. */
export function usernameProblem(u: string): UsernameReason | null {
  if (!USERNAME_RE.test(u)) return "invalid";
  if (RESERVED_USERNAMES.includes(u)) return "reserved";
  return null;
}

/** The username a phone number gets when nobody picks one (`+966500000001` → `u966500000001`) — the same rule as the migration backfill. */
export const usernameFromPhone = (phone: string) => `u${phone.replace(/\D/g, "")}`.slice(0, 26);
/** The username of a staff / admin e-mail address: its local part, cleaned up (`Ops.Team+x@jr.com` → `ops.teamx`). */
export function usernameFromEmail(email: string) {
  let b = (email.split("@")[0] ?? "").normalize("NFKC").toLowerCase().replace(/[^a-z0-9._-]/g, "").replace(/^[._-]+/, "");
  if (b.length < USERNAME_MIN) b += "user";
  return b.slice(0, 26);
}
