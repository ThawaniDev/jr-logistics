import { err } from "@/lib/errors";
import { env } from "@/lib/env";
import { logMessage, maskPhone } from "../data-capture";

/**
 * The SMS provider boundary (recipient delivery codes and tracking links use it) and the signing key of short-lived tokens.
 * Nobody signs in with a one-time code any more (J1: username + password); the `otp_codes` table stays for history, nothing writes to it.
 * SMS provider: no fake delivery in production.
 */
export interface SmsProvider { name: string; send(phone: string, text: string): Promise<void> }
export const DemoSms: SmsProvider = { name: "demo", async send() { /* demo: code returned to caller */ } };
let provider: SmsProvider | null = null;
export const setSmsProvider = (p: SmsProvider | null) => { provider = p; };
/** The active provider (demo provider only in explicit demo mode), or null when SMS is not configured. */
export const activeSmsProvider = (): SmsProvider | null => provider ?? (env.demoMode ? DemoSms : null);

export interface SmsMeta { type: string; userId?: string | null; requestId?: string | null; shipmentId?: string | null }
/**
 * Sends one SMS through the provider and records it in the message log (recipient masked to the last four digits, the text itself is never stored).
 * Throws exactly what the provider throws; a logging problem never changes the outcome.
 */
export async function sendSms(p: SmsProvider, phone: string, text: string, m: SmsMeta) {
  const row = { channel: "sms" as const, type: m.type, recipient: maskPhone(phone), userId: m.userId ?? null, requestId: m.requestId ?? null, shipmentId: m.shipmentId ?? null };
  try { await p.send(phone, text); }
  catch (e) { await logMessage({ ...row, status: "failed", error: e instanceof Error ? e.message : "error", meta: { provider: p.name, chars: text.length } }); throw e; }
  await logMessage({ ...row, status: "sent", meta: { provider: p.name, chars: text.length } });
}

/** Production refuses to sign anything with a guessable key. */
export const signingSecret = () => {
  const s = process.env.AUTH_SECRET;
  if (s && s.length >= 16) return s;
  if (process.env.NODE_ENV === "production") throw err("DEPENDENCY_UNAVAILABLE", "AUTH_SECRET is not configured");
  return "dev-only-secret-change-me";
};
