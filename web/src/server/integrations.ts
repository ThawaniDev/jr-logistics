import { and, desc, eq, isNull, or, sql, inArray } from "drizzle-orm";
import { createHmac } from "node:crypto";
import dns from "node:dns/promises";
import net from "node:net";
import { db } from "@/db";
import { apiKeys, apiLogs, apiIdempotency, businessProfiles, jobEvents, requests, webhookDeliveries, type User } from "@/db/schema";
import { err } from "@/lib/errors";
import { env } from "@/lib/env";
import { randomToken, sha256 } from "@/lib/ids";
import { createDraft, publishRequest, listRequests, type RequestInput } from "./requests";
import { users } from "@/db/schema";

// ───────── API keys ─────────
const MAX_KEYS = 5;
export async function createApiKey(business: User, name: string) {
  if (!name?.trim()) throw err("VALIDATION", "Name required", { field: "name" });
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${business.id}))`);
    const [{ n }] = await tx.select({ n: sql<number>`count(*)::int` }).from(apiKeys).where(and(eq(apiKeys.businessId, business.id), isNull(apiKeys.revokedAt)));
    if (n >= MAX_KEYS) throw err("CONFLICT", `Maximum ${MAX_KEYS} active keys`);
    const raw = `jrk_${randomToken(32)}`;
    const [k] = await tx.insert(apiKeys).values({ businessId: business.id, name: name.trim(), prefix: raw.slice(0, 12), keyHash: sha256(raw) }).returning();
    return { id: k.id, name: k.name, prefix: k.prefix, key: raw, scopes: k.scopes, createdAt: k.createdAt }; // secret is shown exactly once
  });
}
export async function listApiKeys(business: User) {
  const rows = await db.select().from(apiKeys).where(eq(apiKeys.businessId, business.id)).orderBy(desc(apiKeys.createdAt));
  return rows.map((k) => ({ id: k.id, name: k.name, prefix: k.prefix, scopes: k.scopes, lastUsedAt: k.lastUsedAt, revokedAt: k.revokedAt, createdAt: k.createdAt }));
}
export async function revokeApiKey(business: User, id: string) {
  const [k] = await db.update(apiKeys).set({ revokedAt: new Date() }).where(and(eq(apiKeys.id, id), eq(apiKeys.businessId, business.id))).returning();
  if (!k) throw err("NOT_FOUND");
}
export async function authenticateKey(raw: string | null): Promise<{ business: User; keyId: string; scopes: string[] }> {
  if (!raw?.startsWith("jrk_")) throw err("UNAUTHENTICATED", "Missing or invalid API key");
  const [row] = await db.select({ k: apiKeys, u: users }).from(apiKeys).innerJoin(users, eq(users.id, apiKeys.businessId)).where(and(eq(apiKeys.keyHash, sha256(raw)), isNull(apiKeys.revokedAt)));
  if (!row || row.u.status !== "active" || row.u.role !== "business") throw err("UNAUTHENTICATED", "Missing or invalid API key");
  void db.update(apiKeys).set({ lastUsedAt: new Date() }).where(eq(apiKeys.id, row.k.id)).catch(() => {});
  return { business: row.u, keyId: row.k.id, scopes: row.k.scopes };
}
export async function logApiCall(businessId: string | null, keyId: string | null, method: string, path: string, status: number, startedAt: number) {
  await db.insert(apiLogs).values({ businessId, keyId, method, path: path.slice(0, 200), status, latencyMs: Date.now() - startedAt }).catch(() => {});
}
export async function listApiLogs(businessId: string) {
  return db.select().from(apiLogs).where(eq(apiLogs.businessId, businessId)).orderBy(desc(apiLogs.createdAt)).limit(100);
}

/** External job creation with idempotency: same key+payload replays the stored response; same key+different payload conflicts. */
export async function createExternalJob(business: User, input: RequestInput, idemKey: string | null) {
  const hash = sha256(JSON.stringify(input));
  if (idemKey) {
    const [ex] = await db.select().from(apiIdempotency).where(and(eq(apiIdempotency.businessId, business.id), eq(apiIdempotency.key, idemKey)));
    if (ex) { if (ex.requestHash !== hash) throw err("CONFLICT", "Idempotency key reused with a different payload"); return { replay: true, status: ex.status, body: ex.response }; }
  }
  const draft = await createDraft(business, input, "api");
  const r = await publishRequest(business, draft.id, { termsAccepted: true, via: "api" });
  const body = presentJob(r);
  if (idemKey) await db.insert(apiIdempotency).values({ businessId: business.id, key: idemKey, requestHash: hash, response: body as never, status: 201 }).onConflictDoNothing();
  return { replay: false, status: 201, body };
}
export function presentJob(r: typeof requests.$inferSelect) {
  return {
    id: r.id, ref: r.ref, service: r.service, status: r.status, quantity: r.quantity, slotsFilled: r.slotsFilled,
    vehicleType: r.vehicleType, temperature: r.temperature, pickupCity: r.pickupCity, deliveryCity: r.deliveryCity,
    startsAt: r.startsAt.toISOString(), durationDays: r.durationDays, totalCents: r.totalCents, currency: "SAR", createdAt: r.createdAt.toISOString(),
  };
}
export async function listExternalJobs(business: User, q: { status?: string; page?: number; pageSize?: number }) {
  const r = await listRequests({ businessId: business.id, status: q.status, page: q.page, pageSize: q.pageSize });
  return { data: r.items.map(presentJob), page: r.page, pageSize: r.pageSize, total: r.total };
}
export async function getExternalJob(business: User, id: string) {
  const [r] = await db.select().from(requests).where(and(eq(requests.id, id), eq(requests.businessId, business.id)));
  if (!r) throw err("NOT_FOUND");
  return presentJob(r);
}
/** Events exposed to integrators: minimised, no actor names or internal notes. */
export async function externalJobEvents(business: User, id: string) {
  await getExternalJob(business, id);
  const rows = await db.select().from(jobEvents).where(eq(jobEvents.requestId, id)).orderBy(jobEvents.createdAt);
  return { data: rows.map((e) => ({ id: e.id, type: e.type, oldStatus: e.oldStatus, newStatus: e.newStatus, occurredAt: e.createdAt.toISOString() })) };
}

// ───────── Webhooks ─────────
function isPrivateIp(ip: string) {
  if (net.isIPv6(ip)) return ip === "::1" || ip.startsWith("fc") || ip.startsWith("fd") || ip.startsWith("fe80") || ip.startsWith("::ffff:127.") || ip === "::";
  const [a, b] = ip.split(".").map(Number);
  return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127);
}
/** SSRF defence: https only (http allowed in non-prod), no credentials, no private/loopback targets. */
export async function assertSafeWebhookUrl(raw: string, resolve = true) {
  let u: URL;
  try { u = new URL(raw); } catch { throw err("VALIDATION", "Invalid URL", { field: "url" }); }
  if (u.username || u.password) throw err("VALIDATION", "Credentials in URL are not allowed", { field: "url" });
  if (u.protocol !== "https:" && !(u.protocol === "http:" && !env.isProd)) throw err("VALIDATION", "Webhook URL must use https", { field: "url" });
  if (env.isProd || resolve) {
    const host = u.hostname.replace(/^\[|\]$/g, "");
    const ips = net.isIP(host) ? [host] : (await dns.lookup(host, { all: true }).catch(() => [])).map((a) => a.address);
    if (!ips.length) throw err("VALIDATION", "Webhook host cannot be resolved", { field: "url" });
    if (env.isProd && ips.some(isPrivateIp)) throw err("VALIDATION", "Webhook URL points to a private network", { field: "url" });
  }
  return u;
}
export async function setWebhook(business: User, url: string | null) {
  if (!url) { await db.update(businessProfiles).set({ webhookUrl: null, webhookSecret: null }).where(eq(businessProfiles.userId, business.id)); return { url: null }; }
  await assertSafeWebhookUrl(url);
  const secret = `whsec_${randomToken(24)}`;
  await db.update(businessProfiles).set({ webhookUrl: url, webhookSecret: secret }).where(eq(businessProfiles.userId, business.id));
  return { url, secret }; // secret shown once
}
export const signPayload = (secret: string, ts: number, body: string) => createHmac("sha256", secret).update(`${ts}.${body}`).digest("hex");
const BACKOFF_MIN = [1, 5, 30, 120, 360];

/** Delivers due webhooks with HMAC signatures, bounded retries and dead-lettering. */
export async function processWebhookQueue(limit = 25, fetcher: typeof fetch = fetch) {
  const due = await db.select().from(webhookDeliveries).where(and(inArray(webhookDeliveries.status, ["queued", "retry_wait"]), sql`${webhookDeliveries.nextAttemptAt} <= now()`)).orderBy(webhookDeliveries.nextAttemptAt).limit(limit);
  let delivered = 0, failed = 0;
  for (const d of due) {
    const claim = await db.update(webhookDeliveries).set({ attempts: sql`${webhookDeliveries.attempts} + 1`, nextAttemptAt: new Date(Date.now() + 5 * 60_000) })
      .where(and(eq(webhookDeliveries.id, d.id), sql`${webhookDeliveries.nextAttemptAt} <= now()`)).returning();
    if (!claim.length) continue;
    const attempts = claim[0].attempts;
    const [bp] = await db.select().from(businessProfiles).where(eq(businessProfiles.userId, d.businessId));
    try {
      if (!bp?.webhookSecret || !bp.webhookUrl) throw new Error("webhook not configured");
      await assertSafeWebhookUrl(d.url);
      const body = JSON.stringify({ id: d.eventId, ...(d.payload as object), created_at: d.createdAt.toISOString() });
      const ts = Math.floor(Date.now() / 1000);
      const res = await fetcher(d.url, { method: "POST", redirect: "manual", signal: AbortSignal.timeout(8000), headers: { "content-type": "application/json", "x-jr-event": d.event, "x-jr-delivery": d.eventId, "x-jr-signature": `t=${ts},v1=${signPayload(bp.webhookSecret, ts, body)}` }, body });
      if (!res.ok) throw Object.assign(new Error(`HTTP ${res.status}`), { code: res.status });
      await db.update(webhookDeliveries).set({ status: "delivered", deliveredAt: new Date(), lastStatusCode: res.status, lastError: null }).where(eq(webhookDeliveries.id, d.id));
      delivered++;
    } catch (e) {
      failed++;
      const dead = attempts > BACKOFF_MIN.length;
      await db.update(webhookDeliveries).set({
        status: dead ? "dead_letter" : "retry_wait", lastError: (e instanceof Error ? e.message : "error").slice(0, 200), lastStatusCode: (e as { code?: number }).code ?? null,
        nextAttemptAt: new Date(Date.now() + (BACKOFF_MIN[Math.min(attempts - 1, BACKOFF_MIN.length - 1)] ?? 360) * 60_000),
      }).where(eq(webhookDeliveries.id, d.id));
    }
  }
  return { processed: due.length, delivered, failed };
}
export async function listWebhookDeliveries(businessId: string) {
  return db.select({ id: webhookDeliveries.id, event: webhookDeliveries.event, status: webhookDeliveries.status, attempts: webhookDeliveries.attempts, lastStatusCode: webhookDeliveries.lastStatusCode, lastError: webhookDeliveries.lastError, createdAt: webhookDeliveries.createdAt, deliveredAt: webhookDeliveries.deliveredAt })
    .from(webhookDeliveries).where(eq(webhookDeliveries.businessId, businessId)).orderBy(desc(webhookDeliveries.createdAt)).limit(100);
}
export { or };
