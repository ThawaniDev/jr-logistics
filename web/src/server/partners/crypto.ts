import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { env } from "@/lib/env";
import { err } from "@/lib/errors";

/**
 * Partner credentials (API keys) are encrypted at rest with AES-256-GCM. The key comes from INTEGRATIONS_SECRET.
 * In production there is no fallback: without the variable, connections cannot be saved (we refuse to store keys in the clear).
 */
function key(): Buffer {
  const s = process.env.INTEGRATIONS_SECRET;
  if (!s && env.isProd) throw err("DEPENDENCY_UNAVAILABLE", "Integrations are not configured on this server (INTEGRATIONS_SECRET is missing)");
  return createHash("sha256").update(s ?? "jr-dev-only-integrations-secret").digest();
}
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
