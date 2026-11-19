import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { timingSafeEqual } from "node:crypto";
import { db, type Exec } from "@/db";
import { partnerConnections, partnerEvents, partnerOutbox, shipments, requests, users, type PartnerConnection, type User } from "@/db/schema";
import { err } from "@/lib/errors";
import { env } from "@/lib/env";
import { randomToken, sha256 } from "@/lib/ids";
import { hit } from "../auth/ratelimit";
import { contains } from "@/lib/sql";
import { logEvent } from "../events";
import { notify } from "../notify";
import { cancelShipment } from "../stops";
import { assertSafeWebhookUrl } from "../integrations";
import { decryptSecrets, encryptSecrets } from "./crypto";
import { settingsOf } from "./enqueue";
import { partnerHttp } from "./http";
import { getAdapter, listAdapters } from "./registry";
import { DEFAULT_SETTINGS, PUSH_ACTIONS, PartnerError, type Adapter, type Ctx, type PartnerEvent, type PartnerSettings, type PushAction } from "./types";

const MAX_CONNECTIONS = 5;
const MAX_LOOKUP = 50;

// ───────── helpers ─────────
export const hookUrl = (id: string) => `${env.appUrl.replace(/\/$/, "")}/api/v1/integrations/hooks/${id}`;
const adapterOf = (c: Pick<PartnerConnection, "provider">): Adapter => {
  const a = getAdapter(c.provider);
  if (!a) throw err("VALIDATION", `Unknown provider "${c.provider}"`, { field: "provider" });
  return a;
};
const ctxOf = (c: PartnerConnection): Ctx => ({ config: (c.config ?? {}) as Ctx["config"], secrets: decryptSecrets(c.secretsEnc), http: partnerHttp });
const msg = (e: unknown) => (e instanceof Error ? e.message : "error").slice(0, 300);

/** What a client may see of a connection: no secrets, no token hash. */
export function viewConnection(c: PartnerConnection) {
  const a = getAdapter(c.provider);
  const secrets = (() => { try { return decryptSecrets(c.secretsEnc); } catch { return {}; } })();
  return {
    id: c.id, provider: c.provider, providerLabel: a?.label ?? c.provider, name: c.name, status: c.status,
    config: c.config, hasSecret: Object.fromEntries((a?.fields ?? []).filter((f) => f.secret).map((f) => [f.key, !!secrets[f.key]])),
    settings: settingsOf(c), capabilities: a?.capabilities ?? null,
    webhookUrl: a?.capabilities.webhookIn ? hookUrl(c.id) : null, tokenPrefix: c.inboundTokenPrefix,
    lastCheckedAt: c.lastCheckedAt, lastOkAt: c.lastOkAt, lastError: c.lastError, lastEventAt: c.lastEventAt, createdAt: c.createdAt,
  };
}

export function providerCatalog() {
  return listAdapters().map((a) => ({ key: a.key, label: a.label, description: a.description, docsUrl: a.docsUrl ?? null, fields: a.fields, capabilities: a.capabilities, inboundTokenHeaders: a.inboundTokenHeaders }));
}

async function own(business: Pick<User, "id" | "role">, id: string, x: Exec = db): Promise<PartnerConnection> {
  const [c] = await x.select().from(partnerConnections).where(and(eq(partnerConnections.id, id), eq(partnerConnections.businessId, business.id)));
  if (!c) throw err("NOT_FOUND", "Connection not found");
  return c;
}

async function record(x: Exec, c: Pick<PartnerConnection, "id" | "businessId">, e: { direction: "in" | "out" | "lookup" | "test"; kind: string; outcome?: "ok" | "ignored" | "error"; summary?: string; externalId?: string | null; shipmentId?: string | null; requestId?: string | null; payload?: unknown; dedupeKey?: string | null }) {
  const rows = await x.insert(partnerEvents).values({
    connectionId: c.id, businessId: c.businessId, direction: e.direction, kind: e.kind, outcome: e.outcome ?? "ok", summary: e.summary?.slice(0, 300) ?? null,
    externalId: e.externalId ?? null, shipmentId: e.shipmentId ?? null, requestId: e.requestId ?? null, payload: (e.payload ?? null) as never, dedupeKey: e.dedupeKey ?? null,
  }).onConflictDoNothing().returning({ id: partnerEvents.id });
  return rows.length > 0;
}

/** Validates the submitted fields against the adapter's declaration; returns the non-secret config and the secrets to store. */
async function readFields(a: Adapter, input: { config?: Record<string, unknown>; secrets?: Record<string, unknown> }, existing?: { config: Record<string, unknown>; secrets: Record<string, string> }) {
  const config: Record<string, string | boolean> = { ...(existing?.config as Record<string, string | boolean> ?? {}) };
  const secrets: Record<string, string> = { ...(existing?.secrets ?? {}) };
  for (const f of a.fields) {
    const raw = f.secret ? input.secrets?.[f.key] : input.config?.[f.key];
    if (raw === undefined || raw === null) continue;                       // not submitted → keep what is stored
    if (f.type === "boolean") { config[f.key] = !!raw; continue; }
    const v = String(raw).trim();
    if (f.secret) { if (v) secrets[f.key] = v; continue; }                 // empty secret = keep the stored one
    if (!v) { delete config[f.key]; continue; }
    if (v.length > 300) throw err("VALIDATION", `${f.label} is too long`, { field: f.key });
    if (f.type === "url") await assertSafeWebhookUrl(v, false);
    config[f.key] = v;
  }
  for (const f of a.fields) {
    if (!f.required) continue;
    const have = f.secret ? !!secrets[f.key] : config[f.key] !== undefined && config[f.key] !== "";
    if (!have) throw err("VALIDATION", `${f.label} is required`, { field: f.key });
  }
  return { config, secrets };
}

function readSettings(a: Adapter, input: Partial<PartnerSettings> | undefined, cur: PartnerSettings): PartnerSettings {
  const next: PartnerSettings = { sync: { ...cur.sync }, autoCancel: cur.autoCancel };
  if (!input) return next;
  if (typeof input.autoCancel === "boolean") next.autoCancel = input.autoCancel;
  for (const k of PUSH_ACTIONS) {
    const v = input.sync?.[k];
    if (typeof v !== "boolean") continue;
    if (v && !a.capabilities.push.includes(k)) throw err("VALIDATION", `${a.label} cannot receive "${k}" updates`, { field: `settings.sync.${k}` });
    next.sync[k] = v;
  }
  return next;
}

// ───────── connection management ─────────
export interface ConnectionInput { provider: string; name: string; config?: Record<string, unknown>; secrets?: Record<string, unknown>; settings?: Partial<PartnerSettings> }

export async function createConnection(business: User, input: ConnectionInput) {
  const a = getAdapter(input.provider);
  if (!a) throw err("VALIDATION", "Unknown provider", { field: "provider" });
  const name = input.name?.trim();
  if (!name || name.length < 2) throw err("VALIDATION", "Give the connection a name", { field: "name" });
  const { config, secrets } = await readFields(a, input);
  if (a.fields.some((f) => f.key === "signingSecret") && !secrets.signingSecret) secrets.signingSecret = `whsec_${randomToken(24)}`;
  const settings = readSettings(a, input.settings, DEFAULT_SETTINGS);
  const token = a.capabilities.webhookIn ? `jrh_${randomToken(24)}` : null;
  const enc = encryptSecrets(secrets);
  const row = await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${"partners:" + business.id}))`);
    const [{ n }] = await tx.select({ n: sql<number>`count(*)::int` }).from(partnerConnections).where(eq(partnerConnections.businessId, business.id));
    if (n >= MAX_CONNECTIONS) throw err("CONFLICT", `At most ${MAX_CONNECTIONS} connections`);
    const [c] = await tx.insert(partnerConnections).values({
      businessId: business.id, provider: a.key, name: name.slice(0, 80), config, secretsEnc: enc, settings,
      inboundTokenHash: token ? sha256(token) : null, inboundTokenPrefix: token ? token.slice(0, 8) : null,
    }).returning();
    return c;
  });
  return { ...viewConnection(row), inboundToken: token }; // the token is shown exactly once
}

export async function updateConnection(business: User, id: string, patch: Partial<ConnectionInput> & { status?: "active" | "disabled" }) {
  const c = await own(business, id);
  const a = adapterOf(c);
  const { config, secrets } = await readFields(a, patch, { config: c.config as Record<string, unknown>, secrets: decryptSecrets(c.secretsEnc) });
  const settings = readSettings(a, patch.settings, settingsOf(c));
  const name = patch.name !== undefined ? patch.name.trim() : c.name;
  if (name.length < 2) throw err("VALIDATION", "Give the connection a name", { field: "name" });
  const [u] = await db.update(partnerConnections).set({ name: name.slice(0, 80), config, secretsEnc: encryptSecrets(secrets), settings, status: patch.status ?? c.status, updatedAt: new Date() }).where(eq(partnerConnections.id, id)).returning();
  return viewConnection(u);
}

export async function deleteConnection(business: User, id: string) {
  const c = await own(business, id);
  // Parcels keep their history; they just stop being linked.
  await db.transaction(async (tx) => {
    await tx.update(shipments).set({ partnerId: null }).where(eq(shipments.partnerId, c.id));
    await tx.delete(partnerConnections).where(eq(partnerConnections.id, c.id));
  });
}

export const listConnections = async (business: User) =>
  (await db.select().from(partnerConnections).where(eq(partnerConnections.businessId, business.id)).orderBy(partnerConnections.createdAt)).map(viewConnection);

export async function rotateInboundToken(business: User, id: string) {
  const c = await own(business, id);
  if (!adapterOf(c).capabilities.webhookIn) throw err("VALIDATION", "This provider does not send webhooks");
  const token = `jrh_${randomToken(24)}`;
  await db.update(partnerConnections).set({ inboundTokenHash: sha256(token), inboundTokenPrefix: token.slice(0, 8), updatedAt: new Date() }).where(eq(partnerConnections.id, id));
  return { inboundToken: token, webhookUrl: hookUrl(id) };
}

async function health(c: PartnerConnection, ok: boolean, message: string | null) {
  await db.update(partnerConnections).set(ok ? { lastCheckedAt: new Date(), lastOkAt: new Date(), lastError: null } : { lastCheckedAt: new Date(), lastError: message?.slice(0, 300) ?? "error" }).where(eq(partnerConnections.id, c.id));
}

export async function testConnection(business: User, id: string) {
  await hit(`partner-test:${business.id}`, 20, 60);
  const c = await own(business, id);
  const a = adapterOf(c);
  try {
    const r = await a.test(ctxOf(c));
    await health(c, true, null); await record(db, c, { direction: "test", kind: "test", summary: r.message });
    return { ok: true, message: r.message };
  } catch (e) {
    await health(c, false, msg(e)); await record(db, c, { direction: "test", kind: "test", outcome: "error", summary: msg(e) });
    return { ok: false, message: msg(e), kind: e instanceof PartnerError ? e.kind : "unavailable" };
  }
}

/** One click on the business's side: point the partner at our webhook URL with a fresh token (the old token stops working only once the partner accepted the new one). */
export async function registerPartnerWebhook(business: User, id: string) {
  await hit(`partner-test:${business.id}`, 20, 60);
  const c = await own(business, id);
  const a = adapterOf(c);
  if (!a.registerWebhook) throw err("VALIDATION", `${a.label} must be configured by hand — copy the URL and token into their portal`);
  const token = `jrh_${randomToken(24)}`;
  try { await a.registerWebhook(ctxOf(c), hookUrl(c.id), token); }
  catch (e) { await health(c, false, msg(e)); await record(db, c, { direction: "out", kind: "register_webhook", outcome: "error", summary: msg(e) }); throw err(e instanceof PartnerError && e.kind === "auth" ? "VALIDATION" : "DEPENDENCY_UNAVAILABLE", msg(e)); }
  await db.update(partnerConnections).set({ inboundTokenHash: sha256(token), inboundTokenPrefix: token.slice(0, 8), updatedAt: new Date() }).where(eq(partnerConnections.id, id));
  await health(c, true, null); await record(db, c, { direction: "out", kind: "register_webhook", summary: "Webhook URL registered with the partner" });
  return { registered: true, webhookUrl: hookUrl(c.id) };
}

// ───────── lookup (import by barcode) ─────────
export async function lookupPackages(business: User, id: string, identifiers: string[]) {
  await hit(`partner-lookup:${business.id}`, 600, 60);
  const c = await own(business, id);
  const a = adapterOf(c);
  if (!a.lookup) throw err("VALIDATION", `${a.label} does not support package lookup`);
  if (c.status !== "active") throw err("CONFLICT", "This connection is disabled");
  const ids = [...new Set(identifiers.map((s) => s.trim()).filter(Boolean))].slice(0, MAX_LOOKUP);
  if (!ids.length) throw err("VALIDATION", "Enter at least one barcode or invoice number", { field: "identifiers" });
  const ctx = ctxOf(c);
  const dup = await db.select({ ref: shipments.externalRef, code: shipments.code, status: shipments.status, req: requests.ref }).from(shipments).innerJoin(requests, eq(requests.id, shipments.requestId))
    .where(and(eq(requests.businessId, business.id), inArray(sql`lower(${shipments.externalRef})`, ids.map((i) => i.toLowerCase())), sql`${shipments.status} not in ('cancelled','returned','missing')`, sql`${requests.status} <> 'cancelled'`));
  const results: Array<Record<string, unknown>> = [];
  let authFailed = false;
  for (let i = 0; i < ids.length; i += 5) {
    const batch = await Promise.all(ids.slice(i, i + 5).map(async (identifier) => {
      const inJr = dup.find((d) => d.ref?.toLowerCase() === identifier.toLowerCase()) ?? null;
      try {
        const p = await a.lookup!(ctx, identifier);
        return { identifier, ...p, raw: undefined, alreadyInJr: inJr ? { requestRef: inJr.req, code: inJr.code, status: inJr.status } : null, error: null };
      } catch (e) {
        if (e instanceof PartnerError && e.kind === "auth") authFailed = true;
        return { identifier, found: false, error: msg(e), errorKind: e instanceof PartnerError ? e.kind : "unavailable", alreadyInJr: inJr ? { requestRef: inJr.req, code: inJr.code, status: inJr.status } : null };
      }
    }));
    results.push(...batch);
    if (authFailed) break;
  }
  const found = results.filter((r) => r.found).length;
  await health(c, !authFailed && !results.every((r) => r.error), authFailed ? "The partner rejected the credentials" : results.find((r) => r.error)?.error as string ?? null);
  await record(db, c, { direction: "lookup", kind: "lookup", outcome: authFailed ? "error" : "ok", summary: `${found}/${ids.length} found` });
  return { provider: a.key, connectionId: c.id, results };
}

export async function packageLabel(business: User, id: string, identifiers: string[]) {
  const c = await own(business, id);
  const a = adapterOf(c);
  if (!a.makeLabel) throw err("VALIDATION", `${a.label} cannot print labels`);
  const ids = identifiers.map((s) => s.trim()).filter(Boolean).slice(0, 100);
  if (!ids.length) throw err("VALIDATION", "Nothing to print", { field: "identifiers" });
  try { return await a.makeLabel(ctxOf(c), ids); }
  catch (e) { throw err(e instanceof PartnerError && e.kind !== "unavailable" ? "VALIDATION" : "DEPENDENCY_UNAVAILABLE", msg(e)); }
}

// ───────── inbound webhook ─────────
const tokenOk = (given: string, hash: string) => { const a = Buffer.from(sha256(given)), b = Buffer.from(hash); return a.length === b.length && timingSafeEqual(a, b); };

export async function receiveWebhook(connectionId: string, headers: Headers, body: unknown, ip: string) {
  await hit(`partner-hook-ip:${ip}`, 600, 60);
  if (!/^[0-9a-f-]{36}$/i.test(connectionId)) throw err("NOT_FOUND"); // before the per-connection limiter: attacker-chosen ids must not create counters
  await hit(`partner-hook:${connectionId}`, 300, 60);
  const [c] = await db.select().from(partnerConnections).where(eq(partnerConnections.id, connectionId));
  // Same answer for "no such connection" and "wrong token": nothing to learn by probing.
  if (!c || !c.inboundTokenHash) throw err("UNAUTHENTICATED", "Invalid token");
  const a = adapterOf(c);
  const given = a.inboundTokenHeaders.map((h) => headers.get(h)?.replace(/^Bearer\s+/i, "").trim()).filter(Boolean) as string[];
  if (!given.some((g) => tokenOk(g, c.inboundTokenHash!))) throw err("UNAUTHENTICATED", "Invalid token");
  if (c.status !== "active") return { accepted: false, reason: "connection disabled" };
  if (!a.parseWebhook) throw err("VALIDATION", "This provider does not send webhooks");
  const parsed = a.parseWebhook(body);
  const events = parsed == null ? [] : Array.isArray(parsed) ? parsed : [parsed];
  if (!events.length) { await record(db, c, { direction: "in", kind: "unrecognised", outcome: "ignored", summary: "Payload not recognised" }); return { accepted: true, matched: 0 }; }
  let matched = 0;
  for (const ev of events.slice(0, 50)) matched += await applyInbound(c, a, ev);
  await db.update(partnerConnections).set({ lastEventAt: new Date() }).where(eq(partnerConnections.id, c.id));
  return { accepted: true, matched };
}

async function applyInbound(c: PartnerConnection, a: Adapter, ev0: PartnerEvent): Promise<number> {
  // A partner clock (or payload) in the future would make every later, genuine update look "stale" and freeze the status.
  const ev: PartnerEvent = ev0.at.getTime() > Date.now() + 5 * 60_000 ? { ...ev0, at: new Date() } : ev0;
  const refs = [ev.barcode, ev.invoice, ev.externalId].filter((v): v is string => !!v).map((v) => v.toLowerCase());
  const key = sha256([c.id, ev0.externalId, ev0.barcode, ev0.invoice, ev0.status, ev0.at.toISOString()].join("|")); // the partner's own timestamp, so a replay is recognised even if we clamped it
  const rows = await db.select({ s: shipments, r: requests }).from(shipments).innerJoin(requests, eq(requests.id, shipments.requestId))
    .where(and(eq(requests.businessId, c.businessId), inArray(sql`lower(${shipments.externalRef})`, refs), sql`(${shipments.partnerId} is null or ${shipments.partnerId} = ${c.id})`))
    .orderBy(desc(shipments.createdAt));
  const label = `${a.label}: ${ev.status}`;
  if (!rows.length) { await record(db, c, { direction: "in", kind: ev.kind, outcome: "ignored", summary: `${label} — no parcel with reference ${ev.barcode ?? ev.invoice ?? ev.externalId}`, externalId: ev.barcode ?? ev.invoice ?? ev.externalId, payload: ev.summary ?? { status: ev.status }, dedupeKey: key }); return 0; }
  // A duplicate delivery of the same event (retries, replays) is acknowledged and changes nothing.
  const fresh = await record(db, c, { direction: "in", kind: ev.kind, summary: label, externalId: ev.barcode ?? ev.invoice ?? ev.externalId, shipmentId: rows[0].s.id, requestId: rows[0].r.id, payload: ev.summary ?? { status: ev.status }, dedupeKey: key });
  if (!fresh) return rows.length;
  const settings = settingsOf(c);
  for (const { s, r } of rows) {
    // Stale event (older than what we already show) must not overwrite a newer status.
    const newer = !s.partnerStatusAt || s.partnerStatusAt <= ev.at;
    await db.transaction(async (tx) => {
      if (newer) await tx.update(shipments).set({ partnerId: c.id, partnerStatus: ev.status, partnerStatusAt: ev.at }).where(eq(shipments.id, s.id));
      await logEvent(tx, { requestId: r.id, offerId: s.offerId, type: "partner_status", payload: { shipmentId: s.id, code: s.code, externalRef: s.externalRef, provider: a.key, providerLabel: a.label, status: ev.status, kind: ev.kind, note: ev.note } });
    });
    if (ev.kind !== "cancelled") continue;
    if (s.status === "cancelled") continue;
    if (settings.autoCancel && s.status === "pending" && r.status !== "draft") {
      const [owner] = await db.select().from(users).where(eq(users.id, r.businessId));
      try { await cancelShipment(owner, s.id, `Cancelled in ${a.label}`); }
      catch (e) { await record(db, c, { direction: "in", kind: "cancelled", outcome: "error", summary: `Could not withdraw ${s.code}: ${msg(e)}`, shipmentId: s.id, requestId: r.id }); await notify(r.businessId, "partner_cancel_conflict", { requestId: r.id, ref: r.ref, code: s.code, provider: a.label }); }
    } else if (s.status !== "pending" || !settings.autoCancel) {
      // The order was cancelled over there but the parcel is already with a driver (or auto-cancel is off): a human must decide.
      await notify(r.businessId, "partner_cancel_conflict", { requestId: r.id, ref: r.ref, code: s.code, provider: a.label });
    }
  }
  return rows.length;
}

// ───────── write-back (outbox) ─────────
const BACKOFF_MIN = [1, 5, 30, 120, 360];

export async function processPartnerOutbox(limit = 25) {
  const due = await db.select().from(partnerOutbox).where(and(inArray(partnerOutbox.status, ["queued", "retry_wait"]), sql`${partnerOutbox.nextAttemptAt} <= now()`)).orderBy(partnerOutbox.nextAttemptAt).limit(limit);
  let sent = 0, failed = 0;
  for (const o of due) {
    const claim = await db.update(partnerOutbox).set({ attempts: sql`${partnerOutbox.attempts} + 1`, nextAttemptAt: new Date(Date.now() + 5 * 60_000) }).where(and(eq(partnerOutbox.id, o.id), sql`${partnerOutbox.nextAttemptAt} <= now()`)).returning();
    if (!claim.length) continue;
    const attempts = claim[0].attempts;
    const [c] = await db.select().from(partnerConnections).where(eq(partnerConnections.id, o.connectionId));
    try {
      if (!c || c.status !== "active") { await db.update(partnerOutbox).set({ status: "skipped", lastError: "connection disabled or removed" }).where(eq(partnerOutbox.id, o.id)); continue; }
      const a = adapterOf(c);
      if (!a.push) throw new PartnerError("config", "Provider cannot receive updates");
      const sh = o.payload as { id: string; code: string; externalRef: string | null; failReason: string | null; failNote: string | null; deliveredAt: string | null; proofType: string | null };
      const r = await a.push(ctxOf(c), { action: o.action as PushAction, shipment: sh });
      await db.update(partnerOutbox).set({ status: r.skipped ? "skipped" : "sent", sentAt: new Date(), lastError: r.skipped ?? null }).where(eq(partnerOutbox.id, o.id));
      await record(db, c, { direction: "out", kind: o.action, outcome: r.skipped ? "ignored" : "ok", summary: r.skipped ?? `${a.label}: ${o.action} sent for ${sh.code}`, shipmentId: o.shipmentId, requestId: o.requestId, externalId: sh.externalRef });
      await health(c, true, null);
      sent++;
    } catch (e) {
      failed++;
      const retryable = !(e instanceof PartnerError) || e.kind === "unavailable";
      const dead = !retryable || attempts > BACKOFF_MIN.length;
      await db.update(partnerOutbox).set({ status: dead ? "dead" : "retry_wait", lastError: msg(e), nextAttemptAt: new Date(Date.now() + (BACKOFF_MIN[Math.min(attempts - 1, BACKOFF_MIN.length - 1)] ?? 360) * 60_000) }).where(eq(partnerOutbox.id, o.id));
      if (c) {
        await record(db, c, { direction: "out", kind: o.action, outcome: "error", summary: msg(e), shipmentId: o.shipmentId, requestId: o.requestId });
        await health(c, false, msg(e));
        if (dead) await notify(c.businessId, "partner_sync_failed", { provider: getAdapter(c.provider)?.label ?? c.provider, connection: c.name });
      }
    }
  }
  return { processed: due.length, sent, failed };
}

export async function retryOutbox(business: User, outboxId: string) {
  const [o] = await db.select().from(partnerOutbox).where(and(eq(partnerOutbox.id, outboxId), eq(partnerOutbox.businessId, business.id)));
  if (!o) throw err("NOT_FOUND");
  if (!["dead", "skipped"].includes(o.status)) throw err("INVALID_TRANSITION", "Only failed updates can be retried");
  await db.update(partnerOutbox).set({ status: "queued", attempts: 0, nextAttemptAt: new Date(), lastError: null }).where(eq(partnerOutbox.id, o.id));
  return { queued: true };
}

// ───────── history ─────────
export async function listPartnerEvents(business: User, id: string, f: { page?: number; pageSize?: number; outcome?: string }) {
  await own(business, id);
  const pageSize = Math.min(Math.max(f.pageSize ?? 30, 1), 100), page = Math.max(f.page ?? 1, 1);
  const where = and(eq(partnerEvents.connectionId, id), f.outcome ? eq(partnerEvents.outcome, f.outcome) : undefined);
  const [items, [{ total }]] = await Promise.all([
    db.select({ id: partnerEvents.id, direction: partnerEvents.direction, kind: partnerEvents.kind, outcome: partnerEvents.outcome, summary: partnerEvents.summary, externalId: partnerEvents.externalId, shipmentId: partnerEvents.shipmentId, requestId: partnerEvents.requestId, createdAt: partnerEvents.createdAt })
      .from(partnerEvents).where(where).orderBy(desc(partnerEvents.createdAt)).limit(pageSize).offset((page - 1) * pageSize),
    db.select({ total: sql<number>`count(*)::int` }).from(partnerEvents).where(where),
  ]);
  return { items, page, pageSize, total };
}

export async function outboxSummary(business: User, id: string) {
  await own(business, id);
  const [counts, recent] = await Promise.all([
    db.select({ status: partnerOutbox.status, n: sql<number>`count(*)::int` }).from(partnerOutbox).where(eq(partnerOutbox.connectionId, id)).groupBy(partnerOutbox.status),
    db.select({ id: partnerOutbox.id, action: partnerOutbox.action, status: partnerOutbox.status, attempts: partnerOutbox.attempts, lastError: partnerOutbox.lastError, shipmentId: partnerOutbox.shipmentId, createdAt: partnerOutbox.createdAt, sentAt: partnerOutbox.sentAt, payload: partnerOutbox.payload })
      .from(partnerOutbox).where(and(eq(partnerOutbox.connectionId, id), inArray(partnerOutbox.status, ["dead", "retry_wait", "skipped"]))).orderBy(desc(partnerOutbox.createdAt)).limit(30),
  ]);
  return { counts: Object.fromEntries(counts.map((c) => [c.status, c.n])), problems: recent.map((r) => ({ ...r, code: (r.payload as { code?: string })?.code ?? null, payload: undefined })) };
}

/** Back-office overview across all businesses: filterable, paged, with a real total. `problemsOnly` = stuck write-backs or a failing connection. */
export async function adminPartnerOverview(f: { page?: number; pageSize?: number; q?: string; provider?: string; status?: string; problemsOnly?: boolean } = {}) {
  const page = Math.max(f.page ?? 1, 1), pageSize = Math.min(Math.max(f.pageSize ?? 50, 1), 200);
  const q = f.q?.trim() ? contains(f.q) : null;
  const stuckSql = sql`(select count(*) from partner_outbox o where o.connection_id = ${partnerConnections.id} and o.status in ('dead','retry_wait'))`;
  const where = and(
    f.provider ? eq(partnerConnections.provider, f.provider) : undefined, f.status ? eq(partnerConnections.status, f.status) : undefined,
    q ? sql`(${partnerConnections.name} ilike ${q} or ${users.name} ilike ${q} or exists (select 1 from business_profiles b where b.user_id = ${partnerConnections.businessId} and b.company_name ilike ${q}))` : undefined,
    f.problemsOnly ? sql`(${partnerConnections.lastError} is not null or ${stuckSql} > 0)` : undefined,
  );
  const [conns, [{ total }]] = await Promise.all([
    db.select({ c: partnerConnections, b: users.name }).from(partnerConnections).innerJoin(users, eq(users.id, partnerConnections.businessId)).where(where).orderBy(desc(partnerConnections.createdAt)).limit(pageSize).offset((page - 1) * pageSize),
    db.select({ total: sql<number>`count(*)::int` }).from(partnerConnections).innerJoin(users, eq(users.id, partnerConnections.businessId)).where(where),
  ]);
  const ids = conns.map(({ c }) => c.id);
  const stuck = ids.length ? await db.select({ id: partnerOutbox.connectionId, n: sql<number>`count(*)::int` }).from(partnerOutbox).where(and(inArray(partnerOutbox.connectionId, ids), inArray(partnerOutbox.status, ["dead", "retry_wait"]))).groupBy(partnerOutbox.connectionId) : [];
  const stuckBy = new Map(stuck.map((s) => [s.id, s.n]));
  return { items: conns.map(({ c, b }) => ({ ...viewConnection(c), business: b, businessId: c.businessId, stuckUpdates: stuckBy.get(c.id) ?? 0 })), page, pageSize, total };
}
