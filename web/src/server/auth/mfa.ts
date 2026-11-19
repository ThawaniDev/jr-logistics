import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { users, type User } from "@/db/schema";
import { err } from "@/lib/errors";
import { sha256 } from "@/lib/ids";
import { signingSecret } from "./otp";
import { hit } from "./ratelimit";
import { audit } from "../audit";
import { notify } from "../notify";
import { verifyPassword } from "./password";

// ───────── RFC 6238 TOTP (HMAC-SHA1, 30 s, 6 digits) — what every authenticator app speaks ─────────
const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
export const base32Encode = (buf: Buffer) => {
  let bits = 0, value = 0, out = "";
  for (const b of buf) { value = (value << 8) | b; bits += 8; while (bits >= 5) { out += B32[(value >>> (bits - 5)) & 31]; bits -= 5; } }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
};
export const base32Decode = (s: string) => {
  let bits = 0, value = 0; const out: number[] = [];
  for (const ch of s.replace(/[\s=-]/g, "").toUpperCase()) {
    const i = B32.indexOf(ch); if (i < 0) throw err("VALIDATION", "Invalid secret");
    value = (value << 5) | i; bits += 5;
    if (bits >= 8) { out.push((value >>> (bits - 8)) & 255); bits -= 8; }
  }
  return Buffer.from(out);
};
export function totpAt(secret: Buffer, step: number, digits = 6): string {
  const msg = Buffer.alloc(8); msg.writeBigUInt64BE(BigInt(step));
  const h = createHmac("sha1", secret).update(msg).digest();
  const o = h[h.length - 1] & 0x0f;
  const bin = ((h[o] & 0x7f) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3];
  return String(bin % 10 ** digits).padStart(digits, "0");
}
export const stepOf = (ms = Date.now()) => Math.floor(ms / 30_000);
const eq2 = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));
/** Accepts the current window and ±1 (clock drift). Returns the matching step, or null. */
export function matchTotp(secret: Buffer, code: string, now = Date.now()): number | null {
  const c = code.replace(/\s/g, "");
  if (!/^\d{6}$/.test(c)) return null;
  for (const d of [0, -1, 1]) { const st = stepOf(now) + d; if (eq2(totpAt(secret, st), c)) return st; }
  return null;
}

// ───────── Secret at rest: AES-256-GCM under a key derived from AUTH_SECRET ─────────
const key = () => createHash("sha256").update("jr-mfa-v1:" + signingSecret()).digest();
export function sealSecret(plain: Buffer): string {
  const iv = randomBytes(12), c = createCipheriv("aes-256-gcm", key(), iv);
  const enc = Buffer.concat([c.update(plain), c.final()]);
  return [iv, c.getAuthTag(), enc].map((b) => b.toString("base64url")).join(".");
}
export function openSecret(sealed: string): Buffer {
  const [iv, tag, enc] = sealed.split(".").map((p) => Buffer.from(p, "base64url"));
  const d = createDecipheriv("aes-256-gcm", key(), iv); d.setAuthTag(tag);
  return Buffer.concat([d.update(enc), d.final()]);
}

// ───────── Short-lived proof that the password step succeeded (second login step) ─────────
export function signMfaToken(userId: string): string {
  const body = Buffer.from(JSON.stringify({ u: userId, exp: Date.now() + 5 * 60_000, k: "mfa" })).toString("base64url");
  return `${body}.${createHmac("sha256", signingSecret()).update(body).digest("base64url")}`;
}
export function readMfaToken(token: string): string {
  const [body, sig] = (token ?? "").split(".");
  const bad = err("UNAUTHENTICATED", "Sign-in expired — start again");
  if (!body || !sig) throw bad;
  if (!eq2(sig, createHmac("sha256", signingSecret()).update(body).digest("base64url"))) throw bad;
  const p = JSON.parse(Buffer.from(body, "base64url").toString()) as { u: string; exp: number; k: string };
  if (p.k !== "mfa" || p.exp < Date.now()) throw bad;
  return p.u;
}

// ───────── Enrolment ─────────
const issuer = "JR Logistics";
export const otpauthUri = (email: string, secretB32: string) => `otpauth://totp/${encodeURIComponent(`${issuer}:${email}`)}?secret=${secretB32}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=30`;
const isBackoffice = (u: Pick<User, "role">) => u.role === "admin" || u.role === "staff";

/** Step 1: create a pending secret. Nothing is enforced until the user proves they can produce a code (step 2). */
export async function startMfaSetup(u: User) {
  if (!isBackoffice(u)) throw err("FORBIDDEN");
  if (u.totpEnabledAt) throw err("CONFLICT", "Two-step verification is already on");
  const secret = randomBytes(20);
  await db.update(users).set({ totpSecret: sealSecret(secret), totpLastStep: null, updatedAt: new Date() }).where(eq(users.id, u.id));
  const b32 = base32Encode(secret);
  return { secret: b32, otpauth: otpauthUri(u.email ?? u.id, b32) };
}

const newRecoveryCodes = () => Array.from({ length: 8 }, () => { const r = randomBytes(5).toString("hex"); return `${r.slice(0, 5)}-${r.slice(5)}`; });
const recoveryHash = (c: string) => sha256("recovery:" + c.toLowerCase().replace(/\s/g, ""));

/** Step 2: confirm with a code from the authenticator. Returns the one-time recovery codes (shown once, stored only as hashes). */
export async function confirmMfaSetup(u: User, code: string) {
  await hit(`mfa:${u.id}`, 8, 900);
  if (u.totpEnabledAt) throw err("CONFLICT", "Two-step verification is already on");
  if (!u.totpSecret) throw err("INVALID_TRANSITION", "Start the setup first");
  const step = matchTotp(openSecret(u.totpSecret), code);
  if (step === null) throw err("VALIDATION", "That code is not correct", { field: "code" });
  const codes = newRecoveryCodes();
  await db.update(users).set({ totpEnabledAt: new Date(), totpLastStep: step, totpRecovery: codes.map(recoveryHash), updatedAt: new Date() }).where(eq(users.id, u.id));
  await audit(u, "auth.mfa_enable", "user", u.id);
  await notify(u.id, "mfa_enabled");
  return { recoveryCodes: codes };
}

/** Second login step: a current authenticator code, or one unused recovery code (burned on use). */
export async function verifyMfaLogin(userId: string, code: string): Promise<User> {
  await hit(`mfa:${userId}`, 8, 900);
  const [u] = await db.select().from(users).where(eq(users.id, userId));
  const bad = err("UNAUTHENTICATED", "Invalid code");
  if (!u || u.status !== "active" || !u.totpEnabledAt || !u.totpSecret) throw bad;
  const step = matchTotp(openSecret(u.totpSecret), code);
  if (step !== null) {
    if (u.totpLastStep != null && step <= u.totpLastStep) throw err("UNAUTHENTICATED", "That code was already used — wait for the next one"); // replay
    await db.update(users).set({ totpLastStep: step }).where(eq(users.id, u.id));
    return u;
  }
  const h = recoveryHash(code);
  const left = u.totpRecovery ?? [];
  if (left.includes(h)) {
    await db.update(users).set({ totpRecovery: left.filter((x) => x !== h) }).where(eq(users.id, u.id));
    await audit(u, "auth.mfa_recovery_used", "user", u.id, { remaining: left.length - 1 });
    await notify(u.id, "mfa_recovery_used", { remaining: left.length - 1 });
    return u;
  }
  throw bad;
}

/** Turn it off yourself (needs the password and a current code). Refused while the platform requires it. */
export async function disableMfa(u: User, password: string, code: string, required: boolean) {
  if (required) throw err("FORBIDDEN", "Your organisation requires two-step verification");
  if (!u.totpEnabledAt) throw err("INVALID_TRANSITION", "Two-step verification is not on");
  if (!(await verifyPassword(password, u.passwordHash))) throw err("UNAUTHENTICATED", "Current password is incorrect");
  await verifyMfaLogin(u.id, code);
  await db.update(users).set({ totpSecret: null, totpEnabledAt: null, totpLastStep: null, totpRecovery: null, updatedAt: new Date() }).where(eq(users.id, u.id));
  await audit(u, "auth.mfa_disable", "user", u.id);
}

/** A lost phone: an administrator clears a colleague's second factor (they enrol again at next sign-in). */
export async function resetStaffMfa(actor: User, targetId: string) {
  if (actor.role !== "admin" && !actor.permissions.includes("staff.manage")) throw err("FORBIDDEN");
  if (actor.id === targetId) throw err("FORBIDDEN", "Use Disable to change your own second factor");
  const [t] = await db.select().from(users).where(eq(users.id, targetId));
  if (!t || t.role !== "staff") throw err("NOT_FOUND");
  if (actor.role !== "admin") { const missing = t.permissions.filter((p) => !actor.permissions.includes(p)); if (missing.length) throw err("FORBIDDEN", "This colleague holds permissions you do not have", { missing }); }
  await db.update(users).set({ totpSecret: null, totpEnabledAt: null, totpLastStep: null, totpRecovery: null, updatedAt: new Date() }).where(eq(users.id, targetId));
  await audit(actor, "staff.reset_mfa", "user", targetId);
}
