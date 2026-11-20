/**
 * A strong, readable password for the "Generate" buttons (`Kx7m-Qw4t-Rn2p`: no 0/O/1/l/I, at least a lower-case letter, an upper-case letter and two digits —
 * so it always satisfies the server's password rule). Browser-side, from `crypto.getRandomValues`; the server has the same generator for resets.
 */
export function generatePassword(): string {
  const LOWER = "abcdefghjkmnpqrstuvwxyz", UPPER = "ABCDEFGHJKMNPQRSTUVWXYZ", DIGIT = "23456789", ALL = LOWER + UPPER + DIGIT;
  const rnd = (n: number) => { const b = new Uint32Array(1); let x: number; do { crypto.getRandomValues(b); x = b[0]; } while (x >= Math.floor(2 ** 32 / n) * n); return x % n; }; // no modulo bias
  const pick = (s: string) => s[rnd(s.length)];
  const chars = [pick(LOWER), pick(UPPER), pick(DIGIT), pick(DIGIT), ...Array.from({ length: 8 }, () => pick(ALL))];
  for (let i = chars.length - 1; i > 0; i--) { const j = rnd(i + 1); [chars[i], chars[j]] = [chars[j], chars[i]]; }
  const s = chars.join("");
  return `${s.slice(0, 4)}-${s.slice(4, 8)}-${s.slice(8)}`;
}

/** The server's password rule (server/auth/password.ts): at least 10 characters with a letter and a digit. Returns a problem key or null. */
export function passwordIssue(pw: string): "short" | "weak" | null {
  if (pw.length < 10) return "short";
  if (!/[a-z]/i.test(pw) || !/\d/.test(pw)) return "weak";
  return null;
}
