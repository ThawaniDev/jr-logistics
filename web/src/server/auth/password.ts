import bcrypt from "bcryptjs";
const ROUNDS = process.env.NODE_ENV === "test" ? 4 : 11;
export const hashPassword = (pw: string) => bcrypt.hash(pw, ROUNDS);
export const verifyPassword = (pw: string, hash: string | null) => (hash ? bcrypt.compare(pw, hash) : Promise.resolve(false));
export function passwordProblem(pw: string): string | null {
  if (pw.length < 10) return "PASSWORD_TOO_SHORT";
  if (!/[a-z]/i.test(pw) || !/\d/.test(pw)) return "PASSWORD_WEAK";
  return null;
}
