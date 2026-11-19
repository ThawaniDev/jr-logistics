import { and, desc, eq, gt, isNull, sql } from "drizzle-orm";
import { createHmac, timingSafeEqual } from "node:crypto";
import { db } from "@/db";
import { otpCodes } from "@/db/schema";
import { err } from "@/lib/errors";
import { env } from "@/lib/env";
import { numericCode, sha256 } from "@/lib/ids";
import { hit } from "./ratelimit";
import { logError } from "@/lib/log";

/** SMS provider boundary. No fake delivery in production. */
export interface SmsProvider { name: string; send(phone: string, text: string): Promise<void> }
export const DemoSms: SmsProvider = { name: "demo", async send() { /* demo: code returned to caller */ } };
let provider: SmsProvider | null = null;
export const setSmsProvider = (p: SmsProvider | null) => { provider = p; };
/** The active provider (demo provider only in explicit demo mode), or null when SMS is not configured. */
export const activeSmsProvider = (): SmsProvider | null => provider ?? (env.demoMode ? DemoSms : null);

/** Production refuses to sign anything with a guessable key. */
export const signingSecret = () => {
  const s = process.env.AUTH_SECRET;
  if (s && s.length >= 16) return s;
  if (process.env.NODE_ENV === "production") throw err("DEPENDENCY_UNAVAILABLE", "AUTH_SECRET is not configured");
  return "dev-only-secret-change-me";
};

export async function sendOtp(phone: string, ip = "unknown") {
  await hit(`otp:send:${phone}`, env.demoMode ? 30 : 3, 600); // demo/test deployments are signed into repeatedly by testers and automated runs
  await hit(`otp:send:ip:${ip}`, 20, 600);
  const code = numericCode(6);
  const p = provider ?? (env.demoMode ? DemoSms : null);
  if (!p) throw err("DEPENDENCY_UNAVAILABLE", "SMS provider is not configured");
  const [row] = await db.insert(otpCodes).values({ phone, codeHash: sha256(`${phone}:${code}`), expiresAt: new Date(Date.now() + 10 * 60_000) }).returning({ id: otpCodes.id });
  try { await p.send(phone, `JR Logistics: ${code}`); }
  catch (e) {
    // A provider outage is a clear 503 (never a 500 with the provider's error text), and a code nobody received must not stay usable.
    await db.delete(otpCodes).where(eq(otpCodes.id, row.id)).catch(() => {});
    logError(e, { correlationId: "otp-send" });
    throw err("DEPENDENCY_UNAVAILABLE", "The SMS service is unavailable right now — please try again shortly");
  }
  return env.demoMode ? { demoCode: code } : {};
}

/** Verifies OTP. Burns the code on success; limits wrong attempts per code. */
export async function verifyOtp(phone: string, code: string) {
  await hit(`otp:verify:${phone}`, 10, 600);
  const [row] = await db.select().from(otpCodes)
    .where(and(eq(otpCodes.phone, phone), isNull(otpCodes.consumedAt), gt(otpCodes.expiresAt, new Date())))
    .orderBy(desc(otpCodes.createdAt)).limit(1);
  if (!row || row.attempts >= 5) throw err("VALIDATION", "Invalid or expired code");
  if (row.codeHash !== sha256(`${phone}:${code}`)) {
    await db.update(otpCodes).set({ attempts: sql`${otpCodes.attempts} + 1` }).where(eq(otpCodes.id, row.id));
    throw err("VALIDATION", "Invalid or expired code");
  }
  // Atomic burn: two simultaneous verifications with the same correct code cannot both succeed.
  const burned = await db.update(otpCodes).set({ consumedAt: new Date() }).where(and(eq(otpCodes.id, row.id), isNull(otpCodes.consumedAt))).returning({ id: otpCodes.id });
  if (!burned.length) throw err("VALIDATION", "Invalid or expired code");
}

/** Short-lived signed proof that a phone was OTP-verified (used to finish registration). */
export function signRegistrationToken(phone: string): string {
  const exp = Date.now() + 15 * 60_000;
  const body = Buffer.from(JSON.stringify({ phone, exp })).toString("base64url");
  const sig = createHmac("sha256", signingSecret()).update(body).digest("base64url");
  return `${body}.${sig}`;
}
export function readRegistrationToken(token: string): string {
  const [body, sig] = (token ?? "").split(".");
  if (!body || !sig) throw err("VALIDATION", "Invalid registration token");
  const expect = createHmac("sha256", signingSecret()).update(body).digest("base64url");
  const a = Buffer.from(sig), b = Buffer.from(expect);
  if (a.length !== b.length || !timingSafeEqual(a, b)) throw err("VALIDATION", "Invalid registration token");
  const { phone, exp } = JSON.parse(Buffer.from(body, "base64url").toString());
  if (Date.now() > exp) throw err("VALIDATION", "Registration token expired");
  return phone as string;
}
