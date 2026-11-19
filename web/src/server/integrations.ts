import { and, desc, eq, isNull, or, sql, inArray } from "drizzle-orm";
import { createHmac } from "node:crypto";
import dns from "node:dns/promises";
import net from "node:net";
import http from "node:http";
import https from "node:https";
import { db } from "@/db";
import { apiKeys, apiLogs, apiIdempotency, businessProfiles, jobEvents, requests, webhookDeliveries, shipments, type User } from "@/db/schema";
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

/**
 * External job creation with idempotency. The key is CLAIMED first (primary key = business + key), so two concurrent calls with the
 * same key can never both create a job: the loser sees "in progress" (409) and retries into the stored response. A failed create
 * releases the claim and removes the draft, so a retry is a clean retry rather than another orphan draft.
 */
export async function createExternalJob(business: User, input: RequestInput, idemKey: string | null) {
  const hash = sha256(JSON.stringify(input));
  if (idemKey) {
    // A claim whose request died mid-flight (crash, deploy) would otherwise answer "still processing" forever: after two minutes it is abandoned.
    await db.delete(apiIdempotency).where(and(eq(apiIdempotency.businessId, business.id), eq(apiIdempotency.key, idemKey), eq(apiIdempotency.status, 0), sql`${apiIdempotency.createdAt} < now() - interval '2 minutes'`));
    const claimed = await db.insert(apiIdempotency).values({ businessId: business.id, key: idemKey, requestHash: hash, response: {} as never, status: 0 }).onConflictDoNothing().returning({ key: apiIdempotency.key });
    if (!claimed.length) {
      const [ex] = await db.select().from(apiIdempotency).where(and(eq(apiIdempotency.businessId, business.id), eq(apiIdempotency.key, idemKey)));
      if (!ex) throw err("CONFLICT", "Please retry");
      if (ex.requestHash !== hash) throw err("CONFLICT", "Idempotency key reused with a different payload");
      if (ex.status === 0) throw err("CONFLICT", "A request with this Idempotency-Key is still being processed — retry shortly");
      return { replay: true, status: ex.status, body: ex.response };
    }
  }
  let draftId: string | null = null;
  try {
    const draft = await createDraft(business, input, "api");
    draftId = draft.id;
    const r = await publishRequest(business, draft.id, { termsAccepted: true, via: "api" });
    const body = presentJob(r);
    if (idemKey) await db.update(apiIdempotency).set({ response: body as never, status: 201 }).where(and(eq(apiIdempotency.businessId, business.id), eq(apiIdempotency.key, idemKey)));
    return { replay: false, status: 201, body };
  } catch (e) {
    if (draftId) await db.transaction(async (tx) => { await tx.delete(jobEvents).where(eq(jobEvents.requestId, draftId!)); await tx.delete(requests).where(and(eq(requests.id, draftId!), eq(requests.status, "draft"))); }).catch(() => {});
    if (idemKey) await db.delete(apiIdempotency).where(and(eq(apiIdempotency.businessId, business.id), eq(apiIdempotency.key, idemKey), eq(apiIdempotency.status, 0)));
    throw e;
  }
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
/** Per-parcel status for integrators (their order system can mirror delivered / failed without polling events). No recipient contact, no OTP. */
export async function externalJobShipments(business: User, id: string) {
  await getExternalJob(business, id);
  const rows = await db.select().from(shipments).where(eq(shipments.requestId, id)).orderBy(shipments.seq);
  return { data: rows.map((s) => ({ id: s.id, code: s.code, externalRef: s.externalRef, recipientType: s.recipientType, detailsComplete: s.detailsComplete, codCents: s.codCents, codCollectedCents: s.codCollectedCents, status: s.status, deliveredAt: s.deliveredAt?.toISOString() ?? null, proofType: s.proofType, failReason: s.failReason, failedAt: s.failedAt?.toISOString() ?? null, returnedAt: s.returnedAt?.toISOString() ?? null })) };
}
/** Events exposed to integrators: minimised, no actor names or internal notes. */
export async function externalJobEvents(business: User, id: string) {
  await getExternalJob(business, id);
  const rows = await db.select().from(jobEvents).where(eq(jobEvents.requestId, id)).orderBy(jobEvents.createdAt);
  return { data: rows.map((e) => ({ id: e.id, type: e.type, oldStatus: e.oldStatus, newStatus: e.newStatus, occurredAt: e.createdAt.toISOString() })) };
}

// ───────── Webhooks ─────────
/** Expands any textual IPv6 address (including `::` and a dotted IPv4 tail) to its eight 16-bit groups, or null. */
function ipv6Groups(ip: string): number[] | null {
  let v = ip.toLowerCase().split("%")[0];
  const tail = v.match(/(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (tail) { const o = tail.slice(1).map(Number); if (o.some((n) => n > 255)) return null; v = v.slice(0, v.length - tail[0].length) + ((o[0] << 8) | o[1]).toString(16) + ":" + ((o[2] << 8) | o[3]).toString(16); }
  const halves = v.split("::");
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(":") : [];
  const rest = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  const fill = 8 - head.length - rest.length;
  if (halves.length === 1 ? head.length !== 8 : fill < 1) return null;
  const all = [...head, ...(halves.length === 2 ? Array(fill).fill("0") : []), ...rest].map((g) => parseInt(g || "0", 16));
  return all.length === 8 && all.every((n) => Number.isInteger(n) && n >= 0 && n <= 0xffff) ? all : null;
}
const v4 = (a: number, b: number, c: number, d: number) => `${a}.${b}.${c}.${d}`;
const v4FromGroups = (hi: number, lo: number) => v4(hi >> 8, hi & 255, lo >> 8, lo & 255);

/** True for any address a webhook must never reach: private, loopback, link-local, reserved, documentation, multicast — in any spelling. */
export function isPrivateIp(ip: string): boolean {
  if (net.isIPv6(ip)) {
    const g = ipv6Groups(ip);
    if (!g) return true; // cannot parse = do not trust
    const zero = (n: number) => g.slice(0, n).every((x) => x === 0);
    // IPv4 smuggled inside IPv6: judge the embedded address — mapped (::ffff:a.b.c.d), SIIT (::ffff:0:a.b.c.d), compatible (::a.b.c.d), NAT64 (64:ff9b::/96), 6to4 (2002:AABB:CCDD::)
    if (zero(5) && g[5] === 0xffff) return isPrivateIp(v4FromGroups(g[6], g[7]));
    if (zero(4) && g[4] === 0xffff && g[5] === 0) return isPrivateIp(v4FromGroups(g[6], g[7]));
    if (zero(6)) return true; // ::, ::1 and the deprecated IPv4-compatible block
    if (g[0] === 0x64 && g[1] === 0xff9b && g.slice(2, 6).every((x) => x === 0)) return isPrivateIp(v4FromGroups(g[6], g[7]));
    if (g[0] === 0x2002) return isPrivateIp(v4FromGroups(g[1], g[2]));
    return (g[0] & 0xfe00) === 0xfc00 /* fc00::/7 unique local */ || (g[0] & 0xffc0) === 0xfe80 /* link-local */ || (g[0] & 0xffc0) === 0xfec0 /* site-local */
      || (g[0] & 0xff00) === 0xff00 /* multicast */ || g[0] === 0 || (g[0] === 0x2001 && g[1] === 0x0db8) /* documentation */ || (g[0] === 0x0100 && g[1] === 0 && g[2] === 0 && g[3] === 0) /* discard */;
  }
  const [a, b, c] = ip.split(".").map(Number);
  return a === 10 || a === 127 || a === 0 || a >= 224 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || (a === 198 && (b === 18 || b === 19))
    || (a === 192 && b === 0 && (c === 0 || c === 2)) || (a === 198 && b === 51 && c === 100) || (a === 203 && b === 0 && c === 113);
}

/**
 * SSRF defence, step 1: validate the URL and resolve it ONCE. https only (http allowed outside production), no credentials,
 * no private/loopback targets in production. Returns the validated addresses so the caller can connect to exactly those
 * (see `pinnedFetch`) instead of letting the HTTP client resolve the name a second time.
 */
export async function resolveWebhookTarget(raw: string, resolve = true) {
  let u: URL;
  try { u = new URL(raw); } catch { throw err("VALIDATION", "Invalid URL", { field: "url" }); }
  if (u.username || u.password) throw err("VALIDATION", "Credentials in URL are not allowed", { field: "url" });
  if (u.protocol !== "https:" && !(u.protocol === "http:" && (!env.isProd || env.allowPrivateOutbound))) throw err("VALIDATION", "Webhook URL must use https", { field: "url" });
  let addrs: Array<{ address: string; family: number }> = [];
  if (env.isProd || resolve) {
    const host = u.hostname.replace(/^\[|\]$/g, "");
    addrs = net.isIP(host) ? [{ address: host, family: net.isIP(host) }] : await dns.lookup(host, { all: true }).catch(() => []);
    if (!addrs.length) throw err("VALIDATION", "Webhook host cannot be resolved", { field: "url" });
    if (env.isProd && !env.allowPrivateOutbound && addrs.some((a) => isPrivateIp(a.address))) throw err("VALIDATION", "Webhook URL points to a private network", { field: "url" });
  }
  return { url: u, addrs };
}
/** Kept for callers that only need the yes/no validation (saving a webhook URL). */
export async function assertSafeWebhookUrl(raw: string, resolve = true) {
  return (await resolveWebhookTarget(raw, resolve)).url;
}

/**
 * SSRF defence, step 2 (closes the DNS-rebinding window): connect to the exact address that was just validated.
 * `fetch()` would resolve the hostname again, and an attacker-controlled DNS server can answer differently the second time.
 * TLS still verifies the certificate against the real hostname (SNI/Host are untouched); only the TCP address is pinned.
 * Redirects are never followed (a 3xx is returned as-is), and the response body is capped.
 */
export async function pinnedFetch(raw: string, init: RequestInit = {}): Promise<Response> {
  const { url, addrs } = await resolveWebhookTarget(raw, true);
  const target = addrs[0];
  const lib = url.protocol === "https:" ? https : http;
  return new Promise<Response>((resolve, reject) => {
    const req = lib.request(url, {
      method: init.method ?? "POST", headers: init.headers as Record<string, string> | undefined, signal: init.signal ?? undefined,
      lookup: ((_h: string, opts: { all?: boolean }, cb: (...a: unknown[]) => void) => (opts?.all ? cb(null, [{ address: target.address, family: target.family }]) : cb(null, target.address, target.family))) as never,
    }, (res) => {
      const chunks: Buffer[] = []; let size = 0;
      res.on("data", (c: Buffer) => { size += c.length; if (size <= 64 * 1024) chunks.push(c); });
      res.on("end", () => { const st = res.statusCode ?? 502; resolve(new Response([204, 205, 304].includes(st) || st < 200 ? null : Buffer.concat(chunks), { status: st })); });
      res.on("error", reject);
    });
    req.on("error", reject);
    if (typeof init.body === "string") req.write(init.body);
    req.end();
  });
}
export async function setWebhook(business: User, url: string | null) {
  if (!url) { await db.update(businessProfiles).set({ webhookUrl: null, webhookSecret: null }).where(eq(businessProfiles.userId, business.id)); return { url: null }; }
  await assertSafeWebhookUrl(url);
  const [cur] = await db.select({ url: businessProfiles.webhookUrl, secret: businessProfiles.webhookSecret }).from(businessProfiles).where(eq(businessProfiles.userId, business.id));
  // Saving the same URL again must not silently invalidate the integrator's secret; rotate explicitly via rotateWebhookSecret.
  if (cur?.url === url && cur.secret) return { url, secret: null as string | null, unchanged: true };
  const secret = `whsec_${randomToken(24)}`;
  await db.update(businessProfiles).set({ webhookUrl: url, webhookSecret: secret }).where(eq(businessProfiles.userId, business.id));
  return { url, secret: secret as string | null, unchanged: false }; // secret shown once
}

export async function rotateWebhookSecret(business: User) {
  const [cur] = await db.select({ url: businessProfiles.webhookUrl }).from(businessProfiles).where(eq(businessProfiles.userId, business.id));
  if (!cur?.url) throw err("VALIDATION", "Set a webhook URL first", { field: "url" });
  const secret = `whsec_${randomToken(24)}`;
  await db.update(businessProfiles).set({ webhookSecret: secret }).where(eq(businessProfiles.userId, business.id));
  return { url: cur.url, secret, unchanged: false };
}
export const signPayload = (secret: string, ts: number, body: string) => createHmac("sha256", secret).update(`${ts}.${body}`).digest("hex");
const BACKOFF_MIN = [1, 5, 30, 120, 360];

/** Delivers due webhooks with HMAC signatures, bounded retries and dead-lettering. */
export async function processWebhookQueue(limit = 25, fetcher: (url: string, init: RequestInit) => Promise<Pick<Response, "ok" | "status">> = pinnedFetch) {
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
