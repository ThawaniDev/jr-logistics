import bcrypt from "bcryptjs";
import { randomBytes, randomInt } from "node:crypto";
const ROUNDS = process.env.NODE_ENV === "test" ? 4 : 11;
export const hashPassword = (pw: string) => bcrypt.hash(pw, ROUNDS);
export const verifyPassword = (pw: string, hash: string | null) => (hash ? bcrypt.compare(pw, hash) : Promise.resolve(false));

/**
 * A real bcrypt hash (same cost as every stored password) of a random value nobody knows. A sign-in for a name that does not exist — or an account that has no
 * password yet — compares against it, so "unknown user" costs the same ~100 ms as "wrong password" and timing does not reveal which usernames exist.
 * (The constant that used to stand here was 67 characters long, not a valid bcrypt hash, so `compare` returned at once and the difference was measurable.)
 */
let dummyHash: Promise<string> | null = null;
export const dummyPasswordHash = () => (dummyHash ??= hashPassword(randomBytes(24).toString("base64url")));
/** Burns the time of one password check and answers `false`. */
export const verifyAgainstDummy = async (pw: string) => { await bcrypt.compare(pw, await dummyPasswordHash()); return false; };
export function passwordProblem(pw: string): string | null {
  if (pw.length < 10) return "PASSWORD_TOO_SHORT";
  if (!/[a-z]/i.test(pw) || !/\d/.test(pw)) return "PASSWORD_WEAK";
  return null;
}

/** A strong, readable password (no 0/O/1/l/I): `Kx7m-Qw4t-Rn2p`. At least a lower-case letter, an upper-case letter and two digits, so it always passes `passwordProblem`. */
export function generatePassword(): string {
  const LOWER = "abcdefghjkmnpqrstuvwxyz", UPPER = "ABCDEFGHJKMNPQRSTUVWXYZ", DIGIT = "23456789", ALL = LOWER + UPPER + DIGIT;
  const pick = (s: string) => s[randomInt(s.length)];
  const chars = [pick(LOWER), pick(UPPER), pick(DIGIT), pick(DIGIT), ...Array.from({ length: 8 }, () => pick(ALL))];
  for (let i = chars.length - 1; i > 0; i--) { const j = randomInt(i + 1); [chars[i], chars[j]] = [chars[j], chars[i]]; } // Fisher–Yates
  const s = chars.join("");
  return `${s.slice(0, 4)}-${s.slice(4, 8)}-${s.slice(8)}`;
}
