import { createCipheriv, createDecipheriv, createHash, createHmac, randomInt, randomBytes, timingSafeEqual } from "node:crypto";
import { env } from "@/lib/env";
import { err } from "@/lib/errors";

/**
 * Partner credentials (API keys) are encrypted at rest with AES-256-GCM. The key comes from INTEGRATIONS_SECRET.
 * In production there is no fallback: without the variable, connections cannot be saved (we refuse to store keys in the clear).
 */
function secret(): string {
  const s = process.env.INTEGRATIONS_SECRET;
  if (!s && env.isProd) throw err("DEPENDENCY_UNAVAILABLE", "Integrations are not configured on this server (INTEGRATIONS_SECRET is missing)");
  return s ?? "jr-dev-only-integrations-secret";
}
const key = (): Buffer => createHash("sha256").update(secret()).digest();
/** A separate key per purpose, so a label link can never be replayed as an access token. */
const subKey = (purpose: string) => createHmac("sha256", key()).update(`jr-partners:${purpose}`).digest();

export function encryptSecrets(v: Record<string, string>): string {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", key(), iv);
  const enc = Buffer.concat([c.update(JSON.stringify(v), "utf8"), c.final()]);
  return `v1.${iv.toString("base64url")}.${c.getAuthTag().toString("base64url")}.${enc.toString("base64url")}`;
}
export function decryptSecrets(blob: string | null): Record<string, string> {
  if (!blob) return {};
  const [v, iv, tag, data] = blob.split(".");
  if (v !== "v1" || !iv || !tag || !data) throw err("INTERNAL", "Stored credentials are unreadable");
  try {
    const d = createDecipheriv("aes-256-gcm", key(), Buffer.from(iv, "base64url"));
    d.setAuthTag(Buffer.from(tag, "base64url"));
    return JSON.parse(Buffer.concat([d.update(Buffer.from(data, "base64url")), d.final()]).toString("utf8"));
  } catch { throw err("INTERNAL", "Stored credentials cannot be decrypted — was INTEGRATIONS_SECRET changed?"); }
}

const sameText = (a: string, b: string) => { const x = Buffer.from(a), y = Buffer.from(b); return x.length === y.length && timingSafeEqual(x, y); };

/** Signature for a public label link: knowing the AWB alone is not enough to download a label. */
export const labelSig = (awb: string) => createHmac("sha256", subKey("label")).update(awb.toUpperCase()).digest("base64url").slice(0, 22);
export const labelSigOk = (awb: string, sig: string) => sameText(labelSig(awb), sig);

/** Short-lived bearer token for carrier APIs that use a client-credentials flow (Omniful `access_token` mode). */
export function issueAccessToken(connectionId: string, version: number, ttlSec = 3600): { token: string; expiresIn: number } {
  const payload = Buffer.from(JSON.stringify({ c: connectionId, v: version, e: Math.floor(Date.now() / 1000) + ttlSec })).toString("base64url");
  const sig = createHmac("sha256", subKey("access")).update(payload).digest("base64url");
  return { token: `jrat_${payload}.${sig}`, expiresIn: ttlSec };
}
export function readAccessToken(token: string): { connectionId: string; version: number } | null {
  const m = /^jrat_([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]+)$/.exec(token);
  if (!m) return null;
  if (!sameText(createHmac("sha256", subKey("access")).update(m[1]).digest("base64url"), m[2])) return null;
  try {
    const p = JSON.parse(Buffer.from(m[1], "base64url").toString("utf8")) as { c: string; v: number; e: number };
    if (!p.c || typeof p.v !== "number" || p.e < Math.floor(Date.now() / 1000)) return null;
    return { connectionId: p.c, version: p.v };
  } catch { return null; }
}

/** JR's tracking number for carrier-mode partners: "JR" + 11 digits (scanner-friendly, Code 128). Uniqueness is enforced by the DB. */
export const newAwb = () => `JR${randomInt(1, 10)}${Array.from({ length: 10 }, () => randomInt(0, 10)).join("")}`;
