import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { businessProfiles, partnerConnections, partnerEvents, partnerOrders, partnerOutbox, shipments, requests, users, type PartnerConnection, type PartnerOrder, type User } from "@/db/schema";
import { err } from "@/lib/errors";
import { randomToken, sha256 } from "@/lib/ids";
import { contains } from "@/lib/sql";
import { hit } from "../auth/ratelimit";
import { isBackoffice } from "../auth/permissions";
import { audit } from "../audit";
import { assertSafeWebhookUrl } from "../integrations";
import { getSettings } from "../settings";
import { carrierBaseUrl, ctxOf, hookUrl, hookUrlWithToken, kindFor, labelUrl, settingsOf, statusMapOf, trackingUrl } from "./config";
import { decryptSecrets, encryptSecrets, labelSigOk } from "./crypto";
import { applyInbound, importOrder } from "./inbound";
import { enqueueOrderEvent } from "./sync";
import { labelPdf } from "./label";
import { LIVE_PARCEL_SQL, liveFrom, liveParcel, orderByAwb, orderState, partnerPhone, upsertOrder } from "./orders-core";
import { BACKOFF_MIN, processPartnerOutbox, recordEvent, retryOutboxRow, setHealth } from "./outbox";
import { pollPartners } from "./poll";
import { getAdapter, listAdapters } from "./registry";
import { DEFAULT_SETTINGS, EVENT_KINDS, JR_EVENTS, POLL_CHOICES, PartnerError, type Adapter, type EventKind, type JrEvent, type PartnerSettings } from "./types";

export { hookUrl, processPartnerOutbox, pollPartners, BACKOFF_MIN };
export { prunePartnerData } from "./outbox";
export { receiveWebhook } from "./inbound";

const MAX_CONNECTIONS = 5;
const MAX_LOOKUP = 50;
const msg = (e: unknown) => (e instanceof Error ? e.message : "error").slice(0, 300);

/**
 * Who is acting decides the scope (decision I19): a business manages its own connections; staff (with `integrations.manage`, checked by
 * the route) manage any business's, and every staff change is audited. Secrets are write-only for everybody.
 */
const isStaff = (u: Pick<User, "role">) => isBackoffice(u);
const scopeId = (u: User) => (isStaff(u) ? null : u.id);

const adapterOf = (c: Pick<PartnerConnection, "provider">): Adapter => {
  const a = getAdapter(c.provider);
  if (!a) throw err("VALIDATION", `Unknown provider "${c.provider}"`, { field: "provider" });
  return a;
};

/** What a client may see of a connection: no secrets, no token hash. */
export function viewConnection(c: PartnerConnection) {
  const a = getAdapter(c.provider);
  const secrets = (() => { try { return decryptSecrets(c.secretsEnc); } catch { return {}; } })();
  const meta = (c.meta ?? {}) as Record<string, unknown>;
  const caps = a?.capabilities ?? null;
  const catalog = Array.isArray(meta.statusCatalog) ? (meta.statusCatalog as Array<{ value: string; label: string; labelAr?: string | null }>) : null;
  const webhookHost = typeof meta.webhookUrl === "string" ? (() => { try { return new URL(meta.webhookUrl as string).host; } catch { return null; } })() : null;
  return {
    id: c.id, provider: c.provider, providerLabel: a?.label ?? c.provider, name: c.name, status: c.status, mode: caps?.mode ?? null,
    config: c.config, hasSecret: Object.fromEntries((a?.fields ?? []).filter((f) => f.secret).map((f) => [f.key, !!secrets[f.key]])),
    settings: a ? settingsOf(c, a) : DEFAULT_SETTINGS, statusMap: a ? statusMapOf(c, a) : ({} as Record<JrEvent, string | null>),
    statusInOptions: a ? (catalog ?? a.statusIn ?? []).map((s) => ({ value: s.value, label: s.label, labelAr: "labelAr" in s ? s.labelAr ?? null : null, kind: kindFor(c, a, s.value) })) : [],
    statusOutOptions: a?.statusOut ?? [],
    capabilities: caps,
    webhookUrl: caps?.webhookIn ? hookUrl(c.id) : null, webhookAuth: caps?.webhookAuth ?? null,
    webhookUrlTemplate: caps?.webhookIn ? (caps.webhookAuth === "url" ? `${hookUrl(c.id)}/{token}` : hookUrl(c.id)) : null,
    tokenPrefix: c.inboundTokenPrefix,
    carrier: caps?.carrierApi ? { baseUrl: carrierBaseUrl(c.provider), clientId: c.id, authModes: ["api_key", "access_token"] } : null,
    runtime: { webhookRegistered: !!meta.webhookUrl, webhookHost, webhookRegisteredAt: meta.webhookRegisteredAt ?? null, lastCarrierCallAt: meta.lastCarrierCallAt ?? null, authMode: meta.authMode ?? null, lastOrderPollAt: meta.lastOrderPollAt ?? null, statusCatalogAt: meta.statusCatalogAt ?? null },
    lastCheckedAt: c.lastCheckedAt, lastOkAt: c.lastOkAt, lastError: c.lastError, lastEventAt: c.lastEventAt, lastPollAt: c.lastPollAt, createdAt: c.createdAt, updatedAt: c.updatedAt,
  };
}

export function providerCatalog() {
  return listAdapters().map((a) => ({
    key: a.key, label: a.label, description: a.description, docsUrl: a.docsUrl ?? null, fields: a.fields, capabilities: a.capabilities, inboundTokenHeaders: a.inboundTokenHeaders,
    defaults: { sync: a.defaults?.sync ?? {}, statusOut: a.defaults?.statusOut ?? {}, importNew: a.capabilities.mode === "carrier" ? true : a.defaults?.importNew ?? false, pollMinutes: a.defaults?.pollMinutes ?? 0 },
    statusOut: a.statusOut ?? [], statusIn: a.statusIn ?? [], pollChoices: a.pollOrders || a.track ? POLL_CHOICES : [], events: JR_EVENTS, kinds: EVENT_KINDS,
  }));
}

async function own(actor: User, id: string): Promise<PartnerConnection> {
  const biz = scopeId(actor);
  const [c] = await db.select().from(partnerConnections).where(and(eq(partnerConnections.id, id), biz ? eq(partnerConnections.businessId, biz) : undefined));
  if (!c) throw err("NOT_FOUND", "Connection not found");
  return c;
}
const staffAudit = async (actor: User, action: string, id: string, diff?: unknown) => { if (isStaff(actor)) await audit(actor, action, "partner_connection", id, diff); };

/** Validates the submitted fields against the adapter's declaration; returns the non-secret config and the secrets to store. */
async function readFields(a: Adapter, input: { config?: Record<string, unknown>; secrets?: Record<string, unknown> }, existing?: { config: Record<string, unknown>; secrets: Record<string, string> }) {
  const config: Record<string, string | boolean> = { ...(existing?.config as Record<string, string | boolean> ?? {}) };
  const secrets: Record<string, string> = { ...(existing?.secrets ?? {}) };
  for (const f of a.fields) {
    const raw = f.secret ? input.secrets?.[f.key] : input.config?.[f.key];
    if (raw === undefined || raw === null) { if (!existing && !f.secret && f.default !== undefined && config[f.key] === undefined) config[f.key] = f.default; continue; }
    if (f.type === "boolean") { config[f.key] = raw === true || raw === "true"; continue; }
    const v = String(raw).trim();
    if (f.secret) { if (v) { if (v.length > 2000) throw err("VALIDATION", `${f.label} is too long`, { field: f.key }); secrets[f.key] = v; } continue; } // empty secret = keep the stored one
    if (!v) { delete config[f.key]; continue; }
    if (v.length > 300) throw err("VALIDATION", `${f.label} is too long`, { field: f.key });
    if (f.type === "url") await assertSafeWebhookUrl(v, false).catch(() => { throw err("VALIDATION", `${f.label} must be a public https address`, { field: f.key }); });
    if (f.type === "select" && f.options && !f.options.some((o) => o.value === v)) throw err("VALIDATION", `${f.label}: choose one of the listed values`, { field: f.key });
    config[f.key] = v;
  }
  for (const f of a.fields) {
    if (!f.required) continue;
    const have = f.secret ? !!secrets[f.key] : config[f.key] !== undefined && config[f.key] !== "";
    if (!have) throw err("VALIDATION", `${f.label} is required`, { field: f.key });
  }
  return { config, secrets };
}

const STATUS_CODE = /^[A-Za-z0-9_.\- ]{1,60}$/;
/** What a client may send: `null` resets a status mapping to the documented default / removes an inbound override. */
export type SettingsInput = Partial<Omit<PartnerSettings, "statusOut" | "statusIn">> & { statusOut?: Partial<Record<JrEvent, string | null>>; statusIn?: Record<string, EventKind | null> };
function readSettings(a: Adapter, input: SettingsInput | undefined, cur: Partial<PartnerSettings>): Partial<PartnerSettings> {
  const next: Partial<PartnerSettings> = { ...cur, sync: { ...(cur.sync ?? {}) }, statusOut: { ...(cur.statusOut ?? {}) }, statusIn: { ...(cur.statusIn ?? {}) } };
  if (!input) return next;
  if (typeof input.autoCancel === "boolean") next.autoCancel = input.autoCancel;
  if (typeof input.importNew === "boolean") {
    if (input.importNew && !a.capabilities.importOrders) throw err("VALIDATION", `${a.label} cannot send new orders to JR`, { field: "settings.importNew" });
    next.importNew = input.importNew;
  }
  if (input.pollMinutes !== undefined) {
    if (!(a.pollOrders || a.track) && input.pollMinutes) throw err("VALIDATION", `${a.label} cannot be checked on a schedule`, { field: "settings.pollMinutes" });
    if (!(POLL_CHOICES as readonly number[]).includes(Number(input.pollMinutes))) throw err("VALIDATION", `Choose one of ${POLL_CHOICES.join(", ")} minutes`, { field: "settings.pollMinutes" });
    next.pollMinutes = Number(input.pollMinutes);
  }
  for (const [k, v] of Object.entries(input.sync ?? {})) {
    if (typeof v !== "boolean") continue;
    if (!(JR_EVENTS as readonly string[]).includes(k)) throw err("VALIDATION", `Unknown JR event "${k}"`, { field: `settings.sync.${k}` });
    if (v && !a.capabilities.push.includes(k as JrEvent)) throw err("VALIDATION", `${a.label} cannot receive "${k}" updates`, { field: `settings.sync.${k}` });
    next.sync![k as JrEvent] = v;
  }
  for (const [k, v] of Object.entries(input.statusOut ?? {})) {
    if (!a.capabilities.push.includes(k as JrEvent)) throw err("VALIDATION", `${a.label} cannot receive "${k}" updates`, { field: `settings.statusOut.${k}` });
    if (v === null) { delete next.statusOut![k as JrEvent]; continue; } // back to the documented default
    const s = String(v).trim();
    if (s && !STATUS_CODE.test(s)) throw err("VALIDATION", "A status code may contain letters, digits, _ . - only", { field: `settings.statusOut.${k}` });
    if (s && a.statusOutStrict && !a.statusOut?.some((o) => o.value === s)) throw err("VALIDATION", `${a.label} only accepts its documented statuses: ${a.statusOut!.map((o) => o.value).join(", ")}`, { field: `settings.statusOut.${k}` });
    next.statusOut![k as JrEvent] = s; // "" = do not send
  }
  for (const [k, v] of Object.entries(input.statusIn ?? {})) {
    const key = k.trim().toLowerCase();
    if (!key || key.length > 80) throw err("VALIDATION", "Status key is empty or too long", { field: "settings.statusIn" });
    if (v === null) { delete next.statusIn![key]; continue; }
    if (!(EVENT_KINDS as readonly string[]).includes(v)) throw err("VALIDATION", `Unknown meaning "${v}"`, { field: `settings.statusIn.${k}` });
    next.statusIn![key] = v as EventKind;
  }
  if (Object.keys(next.statusIn!).length > 200) throw err("VALIDATION", "At most 200 status mappings", { field: "settings.statusIn" });
  return next;
}

// ───────── connection management ─────────
export interface ConnectionInput { provider: string; name: string; businessId?: string; config?: Record<string, unknown>; secrets?: Record<string, unknown>; settings?: SettingsInput }

async function businessOf(actor: User, businessId?: string): Promise<string> {
  if (!isStaff(actor)) return actor.id;
  if (!businessId) throw err("VALIDATION", "Choose the company this connection belongs to", { field: "businessId" });
  const [b] = await db.select({ id: users.id, role: users.role }).from(users).where(eq(users.id, businessId));
  if (!b || b.role !== "business") throw err("VALIDATION", "That account is not a company", { field: "businessId" });
  return b.id;
}

const needsToken = (a: Adapter) => a.capabilities.webhookIn || a.capabilities.carrierApi;
const freshToken = () => `jrh_${randomToken(24)}`;
const tokenView = (a: Adapter, id: string, token: string) => ({
  inboundToken: token, webhookUrl: a.capabilities.webhookIn ? (a.capabilities.webhookAuth === "url" ? hookUrlWithToken(id, token) : hookUrl(id)) : null,
  carrier: a.capabilities.carrierApi ? { baseUrl: carrierBaseUrl(a.key), apiKey: token, clientId: id, clientSecret: token } : null,
});

export async function createConnection(actor: User, input: ConnectionInput) {
  const a = getAdapter(input.provider);
  if (!a) throw err("VALIDATION", "Unknown provider", { field: "provider" });
  const businessId = await businessOf(actor, input.businessId);
  const name = input.name?.trim();
  if (!name || name.length < 2) throw err("VALIDATION", "Give the connection a name", { field: "name" });
  const { config, secrets } = await readFields(a, input);
  if (a.fields.some((f) => f.key === "signingSecret") && !secrets.signingSecret) secrets.signingSecret = `whsec_${randomToken(24)}`;
  const settings = readSettings(a, input.settings, {});
  const token = needsToken(a) ? freshToken() : null;
  const enc = encryptSecrets(secrets);
  const row = await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${"partners:" + businessId}))`);
    const [{ n }] = await tx.select({ n: sql<number>`count(*)::int` }).from(partnerConnections).where(eq(partnerConnections.businessId, businessId));
    if (n >= MAX_CONNECTIONS) throw err("CONFLICT", `At most ${MAX_CONNECTIONS} connections`);
    const [c] = await tx.insert(partnerConnections).values({
      businessId, provider: a.key, name: name.slice(0, 80), config, secretsEnc: enc, settings,
      inboundTokenHash: token ? sha256(token) : null, inboundTokenPrefix: token ? token.slice(0, 8) : null, createdBy: actor.id, updatedBy: actor.id,
    }).returning();
    return c;
  });
  await staffAudit(actor, "partner.create", row.id, { businessId, provider: a.key, name: row.name });
  return { ...viewConnection(row), ...(token ? tokenView(a, row.id, token) : { inboundToken: null }) }; // the token is shown exactly once
}

export async function updateConnection(actor: User, id: string, patch: Partial<ConnectionInput> & { status?: "active" | "disabled" }) {
  const c = await own(actor, id);
  const a = adapterOf(c);
  const { config, secrets } = await readFields(a, patch, { config: c.config as Record<string, unknown>, secrets: decryptSecrets(c.secretsEnc) });
  const settings = readSettings(a, patch.settings, (c.settings ?? {}) as Partial<PartnerSettings>);
  const name = patch.name !== undefined ? patch.name.trim() : c.name;
  if (name.length < 2) throw err("VALIDATION", "Give the connection a name", { field: "name" });
  // Secrets are written only when new ones were typed, re-read under a row lock and merged key by key: a token the system rotated a
  // moment ago (Fastcoo refresh) must never be overwritten by the copy this request loaded.
  const typed = Object.entries(patch.secrets ?? {}).filter(([k, v]) => typeof v === "string" && v.trim() && a.fields.some((f) => f.secret && f.key === k));
  const u = await db.transaction(async (tx) => {
    const set: Partial<PartnerConnection> = { name: name.slice(0, 80), config, settings, status: patch.status ?? c.status, updatedAt: new Date(), updatedBy: actor.id };
    if (typed.length) {
      const [row] = await tx.select({ s: partnerConnections.secretsEnc }).from(partnerConnections).where(eq(partnerConnections.id, id)).for("update");
      set.secretsEnc = encryptSecrets({ ...decryptSecrets(row?.s ?? null), ...Object.fromEntries(typed.map(([k]) => [k, secrets[k]])) });
    }
    const [r] = await tx.update(partnerConnections).set(set).where(eq(partnerConnections.id, id)).returning();
    return r;
  });
  await staffAudit(actor, "partner.update", id, { name: patch.name !== undefined ? name : undefined, status: patch.status, config: patch.config ? Object.keys(patch.config) : undefined, secretsChanged: patch.secrets ? Object.keys(patch.secrets).filter((k) => patch.secrets![k]) : undefined, settings: patch.settings });
  return viewConnection(u);
}

export async function deleteConnection(actor: User, id: string) {
  const c = await own(actor, id);
  // Parcels keep their history; they just stop being linked. Incoming orders of the connection go with it.
  await db.transaction(async (tx) => {
    await tx.update(shipments).set({ partnerId: null }).where(eq(shipments.partnerId, c.id));
    await tx.delete(partnerConnections).where(eq(partnerConnections.id, c.id));
  });
  await staffAudit(actor, "partner.delete", id, { businessId: c.businessId, provider: c.provider, name: c.name });
}

export async function listConnections(actor: User, businessId?: string) {
  const biz = scopeId(actor) ?? businessId;
  if (!biz) throw err("VALIDATION", "businessId is required", { field: "businessId" });
  const rows = await db.select().from(partnerConnections).where(eq(partnerConnections.businessId, biz)).orderBy(partnerConnections.createdAt);
  const counts = rows.length ? await orderCounts(rows.map((r) => r.id)) : new Map();
  return rows.map((c) => ({ ...viewConnection(c), orders: counts.get(c.id) ?? { open: 0, inJr: 0 } }));
}

export async function getConnection(actor: User, id: string) {
  const c = await own(actor, id);
  const counts = await orderCounts([c.id]);
  const [b] = await db.select({ name: users.name, company: businessProfiles.companyName }).from(users).leftJoin(businessProfiles, eq(businessProfiles.userId, users.id)).where(eq(users.id, c.businessId));
  return { ...viewConnection(c), orders: counts.get(c.id) ?? { open: 0, inJr: 0 }, businessId: c.businessId, business: b?.company ?? b?.name ?? null };
}

async function orderCounts(ids: string[]) {
  const rows = (await db.execute(sql`select po.connection_id as id, count(*) filter (where po.state <> 'cancelled' and cur.s_id is null)::int as open, count(*) filter (where po.state <> 'cancelled' and cur.s_status in ('pending','loaded'))::int as in_jr
    from partner_orders po ${LIVE_PARCEL_SQL} where po.connection_id in (${sql.join(ids.map((i) => sql`${i}`), sql`, `)}) group by po.connection_id`)).rows as Array<{ id: string; open: number; in_jr: number }>;
  return new Map(rows.map((r) => [r.id, { open: Number(r.open), inJr: Number(r.in_jr) }]));
}

/** New credentials the partner presents to JR (webhook token / carrier API key + client secret). Old ones — and access tokens — stop working at once. */
export async function rotateInboundToken(actor: User, id: string) {
  const c = await own(actor, id);
  const a = adapterOf(c);
  if (!needsToken(a)) throw err("VALIDATION", "This system does not call JR, so it has no JR credentials");
  const token = freshToken();
  await db.update(partnerConnections).set({ inboundTokenHash: sha256(token), inboundTokenPrefix: token.slice(0, 8), tokenVersion: sql`${partnerConnections.tokenVersion} + 1`, updatedAt: new Date(), updatedBy: actor.id }).where(eq(partnerConnections.id, id));
  await staffAudit(actor, "partner.rotate_token", id);
  return tokenView(a, c.id, token);
}

export async function testConnection(actor: User, id: string) {
  await hit(`partner-test:${actor.id}`, 20, 60);
  const c = await own(actor, id);
  const a = adapterOf(c);
  try {
    const r = await a.test(ctxOf(c));
    await setHealth(c.id, true, null); await recordEvent(c, { direction: "test", kind: "test", summary: r.message });
    return { ok: true, message: r.message };
  } catch (e) {
    await setHealth(c.id, false, msg(e)); await recordEvent(c, { direction: "test", kind: "test", outcome: "error", summary: msg(e) });
    return { ok: false, message: msg(e), kind: e instanceof PartnerError ? e.kind : "unavailable" };
  }
}

/** One click: point the partner at JR's webhook URL with a fresh token (the old token stops working only once the partner accepted the new one). */
export async function registerPartnerWebhook(actor: User, id: string) {
  await hit(`partner-test:${actor.id}`, 20, 60);
  const c = await own(actor, id);
  const a = adapterOf(c);
  if (!a.registerWebhook) throw err("VALIDATION", `${a.label} must be configured by hand — copy the URL and token into their portal`);
  const token = freshToken();
  try { await a.registerWebhook(ctxOf(c), hookUrl(c.id), token); }
  catch (e) { await setHealth(c.id, false, msg(e)); await recordEvent(c, { direction: "out", kind: "register_webhook", outcome: "error", summary: msg(e) }); throw err(e instanceof PartnerError && e.kind === "auth" ? "VALIDATION" : "DEPENDENCY_UNAVAILABLE", msg(e)); }
  await db.update(partnerConnections).set({ inboundTokenHash: sha256(token), inboundTokenPrefix: token.slice(0, 8), updatedAt: new Date() }).where(eq(partnerConnections.id, id));
  await setHealth(c.id, true, null); await recordEvent(c, { direction: "out", kind: "register_webhook", summary: "Webhook URL registered with the partner" });
  await staffAudit(actor, "partner.register_webhook", id);
  return { registered: true, webhookUrl: hookUrl(c.id) };
}

/** "Check now": runs the scheduled pull for this connection immediately. */
export async function pollNow(actor: User, id: string) {
  await hit(`partner-test:${actor.id}`, 20, 60);
  const c = await own(actor, id);
  const a = adapterOf(c);
  if (!a.pollOrders && !a.track) throw err("VALIDATION", `${a.label} cannot be checked on demand`);
  if (c.status !== "active") throw err("CONFLICT", "This connection is paused");
  const r = await pollPartners(new Date(), { connectionId: c.id, force: true });
  return r.results[0] ?? { id: c.id, imported: 0, tracked: 0, changed: 0 };
}

// ───────── lookup (import by barcode / order number) ─────────
export async function lookupPackages(actor: User, id: string, identifiers: string[]) {
  await hit(`partner-lookup:${actor.id}`, 600, 60);
  const c = await own(actor, id);
  const a = adapterOf(c);
  if (!a.lookup) throw err("VALIDATION", `${a.label} does not support looking orders up`);
  if (c.status !== "active") throw err("CONFLICT", "This connection is disabled");
  const ids = [...new Set(identifiers.map((s) => s.trim()).filter(Boolean))].slice(0, MAX_LOOKUP);
  if (!ids.length) throw err("VALIDATION", "Enter at least one barcode or order number", { field: "identifiers" });
  const ctx = ctxOf(c);
  const dup = await db.select({ ref: shipments.externalRef, code: shipments.code, status: shipments.status, req: requests.ref }).from(shipments).innerJoin(requests, eq(requests.id, shipments.requestId))
    .where(and(eq(requests.businessId, c.businessId), inArray(sql`lower(${shipments.externalRef})`, ids.map((i) => i.toLowerCase())), sql`${shipments.status} not in ('cancelled','returned','missing')`, sql`${requests.status} <> 'cancelled'`));
  const results: Array<Record<string, unknown>> = [];
  let authFailed = false;
  for (let i = 0; i < ids.length; i += 5) {
    const batch = await Promise.all(ids.slice(i, i + 5).map(async (identifier) => {
      const inJr = dup.find((d) => d.ref?.toLowerCase() === identifier.toLowerCase()) ?? null;
      const already = inJr ? { requestRef: inJr.req, code: inJr.code, status: inJr.status } : null;
      try {
        const p = await a.lookup!(ctx, identifier);
        let orderId: string | null = null;
        if (p.found && p.barcode) {
          // Remember what the partner told us (its internal id is needed later to cancel / print / track).
          const r = await upsertOrder(db, c, a, { externalId: p.externalId, externalRef: p.barcode, invoice: p.invoice, recipient: { name: p.recipientName, phone: p.recipientPhone, address: p.address, city: p.city, lat: p.lat ?? null, lng: p.lng ?? null }, codAmount: p.codAmount, pieces: p.pieces ?? null, notes: p.notes ?? null, contents: p.contents ?? null, status: p.status, extra: p.extra });
          orderId = r.order.id;
          const city = r.order.city;
          return { identifier, ...p, raw: undefined, extra: undefined, orderId, cityKey: city, recipientPhone: r.order.recipientPhone ?? p.recipientPhone, phoneValid: partnerPhone(r.order.recipientPhone).valid, alreadyInJr: already, error: null };
        }
        return { identifier, ...p, raw: undefined, extra: undefined, orderId, alreadyInJr: already, error: null };
      } catch (e) {
        if (e instanceof PartnerError && e.kind === "auth") authFailed = true;
        return { identifier, found: false, error: msg(e), errorKind: e instanceof PartnerError ? e.kind : "unavailable", alreadyInJr: already };
      }
    }));
    results.push(...batch);
    if (authFailed) break;
  }
  const found = results.filter((r) => r.found).length;
  await setHealth(c.id, !authFailed && !results.every((r) => r.error), authFailed ? "The partner rejected the credentials" : results.find((r) => r.error)?.error as string ?? null);
  await recordEvent(c, { direction: "lookup", kind: "lookup", outcome: authFailed ? "error" : "ok", summary: `${found}/${ids.length} found` });
  return { provider: a.key, connectionId: c.id, results };
}

/** The partner's own label (LogesTech AWB, Shipox AWBZ). JR's label for carrier-mode orders is `orderLabel`. */
export async function packageLabel(actor: User, id: string, identifiers: string[]) {
  const c = await own(actor, id);
  const a = adapterOf(c);
  if (!a.makeLabel) throw err("VALIDATION", `${a.label} cannot print labels`);
  const ids = [...new Set(identifiers.map((s) => s.trim()).filter(Boolean))].slice(0, 100);
  if (!ids.length) throw err("VALIDATION", "Nothing to print", { field: "identifiers" });
  const known = await db.select({ ref: partnerOrders.externalRef, ext: partnerOrders.externalId }).from(partnerOrders).where(and(eq(partnerOrders.connectionId, c.id), inArray(sql`lower(${partnerOrders.externalRef})`, ids.map((i) => i.toLowerCase()))));
  const refs = ids.map((i) => ({ externalRef: i, externalId: known.find((k) => k.ref.toLowerCase() === i.toLowerCase())?.ext ?? null }));
  try { return await a.makeLabel(ctxOf(c), refs); }
  catch (e) { throw err(e instanceof PartnerError && e.kind !== "unavailable" ? "VALIDATION" : "DEPENDENCY_UNAVAILABLE", msg(e)); }
}

// ───────── Incoming orders ─────────
const STATE_SQL = sql`case when po.state = 'cancelled' then 'cancelled' when cur.s_id is null then 'open' when cur.s_status = 'delivered' then 'delivered' when cur.s_status in ('failed','returned','missing') then 'undelivered' else 'in_jr' end`;
export const ORDER_STATES = ["open", "in_jr", "delivered", "undelivered", "cancelled"] as const;

function viewOrder(o: PartnerOrder, live: ReturnType<typeof liveFrom> | null, conn?: { name: string; provider: string; businessName?: string | null } | null) {
  const a = getAdapter(o.provider);
  const phone = partnerPhone(o.recipientPhone);
  return {
    id: o.id, connectionId: o.connectionId, connectionName: conn?.name ?? null, businessId: o.businessId, businessName: conn?.businessName ?? null, provider: o.provider, providerLabel: a?.label ?? o.provider, mode: a?.capabilities.mode ?? null,
    externalRef: o.externalRef, externalId: o.externalId, invoice: o.invoice, awb: o.awb,
    /** What the business recognises the order by: Omniful's order id, LogesTech's barcode, … */
    displayRef: o.invoice && a?.capabilities.mode === "carrier" ? o.invoice : o.externalRef,
    state: orderState(o, live), rawState: o.state,
    recipientName: o.recipientName, recipientPhone: o.recipientPhone, phoneValid: phone.valid, recipientEmail: o.recipientEmail, address: o.address,
    city: o.city, cityRaw: o.cityRaw, lat: o.lat, lng: o.lng, codCents: o.codCents, currency: o.currency, pieces: o.pieces, weightGrams: o.weightGrams,
    contents: o.contents, notes: o.notes, pickup: o.pickup, items: o.items, slot: o.slot, detailsComplete: o.detailsComplete,
    partnerStatus: o.partnerStatus, partnerStatusAt: o.partnerStatusAt,
    parcel: live ? { id: live.id, code: live.code, status: live.status, requestId: live.requestId, requestRef: live.requestRef, requestStatus: live.requestStatus, deliveredAt: live.deliveredAt, failedAt: live.failedAt, failReason: live.failReason } : null,
    cancelledAt: o.cancelledAt, cancelReason: o.cancelReason, cancelledBy: o.cancelledBy,
    labelUrl: o.awb ? labelUrl(o.awb) : null, trackingUrl: o.awb ? trackingUrl(o.awb) : null,
    createdAt: o.createdAt, updatedAt: o.updatedAt,
  };
}
export type OrderView = ReturnType<typeof viewOrder>;

export async function listOrders(actor: User, f: { businessId?: string; connectionId?: string; state?: string; q?: string; city?: string; page?: number; pageSize?: number }) {
  const biz = scopeId(actor) ?? f.businessId ?? null;
  const pageSize = Math.min(Math.max(f.pageSize ?? 50, 1), 200), page = Math.max(f.page ?? 1, 1);
  const q = f.q?.trim() ? contains(f.q.trim()) : null;
  const base = sql`from partner_orders po ${LIVE_PARCEL_SQL} join partner_connections pc on pc.id = po.connection_id where true
    ${biz ? sql`and po.business_id = ${biz}` : sql``} ${f.connectionId ? sql`and po.connection_id = ${f.connectionId}` : sql``} ${f.city ? sql`and po.city = ${f.city}` : sql``}
    ${q ? sql`and (po.external_ref ilike ${q} or po.awb ilike ${q} or po.invoice ilike ${q} or po.recipient_name ilike ${q} or po.recipient_phone ilike ${q} or po.address ilike ${q})` : sql``}`;
  const state = f.state && (ORDER_STATES as readonly string[]).includes(f.state) ? f.state : null;
  const [items, counts] = await Promise.all([
    db.execute(sql`select po.*, cur.*, pc.name as conn_name, (select coalesce(bp.company_name, u.name) from users u left join business_profiles bp on bp.user_id = u.id where u.id = po.business_id) as biz_name
      ${base} ${state ? sql`and ${STATE_SQL} = ${state}` : sql``} order by po.created_at desc limit ${pageSize} offset ${(page - 1) * pageSize}`),
    db.execute(sql`select ${STATE_SQL} as st, count(*)::int as n ${base} group by 1`),
  ]);
  const byState = Object.fromEntries((counts.rows as Array<{ st: string; n: number }>).map((r) => [r.st, Number(r.n)]));
  const total = state ? byState[state] ?? 0 : Object.values(byState).reduce((s, n) => s + n, 0);
  return { items: (items.rows as Array<Record<string, unknown>>).map((r) => viewOrder(rowToOrder(r), r.s_id ? liveFrom(r) : null, { name: String(r.conn_name), provider: String(r.provider), businessName: (r.biz_name as string) ?? null })), page, pageSize, total, counts: Object.fromEntries(ORDER_STATES.map((s) => [s, byState[s] ?? 0])) };
}

/** Raw snake_case row → the drizzle shape. */
function rowToOrder(r: Record<string, unknown>): PartnerOrder {
  const d = (v: unknown) => (v ? new Date(String(v)) : null);
  return {
    id: String(r.id), connectionId: String(r.connection_id), businessId: String(r.business_id), provider: String(r.provider), externalId: (r.external_id as string) ?? null, externalRef: String(r.external_ref),
    invoice: (r.invoice as string) ?? null, awb: (r.awb as string) ?? null, state: String(r.state), recipientName: (r.recipient_name as string) ?? null, recipientPhone: (r.recipient_phone as string) ?? null,
    recipientEmail: (r.recipient_email as string) ?? null, address: (r.address as string) ?? null, cityRaw: (r.city_raw as string) ?? null, city: (r.city as string) ?? null,
    lat: r.lat == null ? null : Number(r.lat), lng: r.lng == null ? null : Number(r.lng), codCents: r.cod_cents == null ? null : Number(r.cod_cents), currency: (r.currency as string) ?? null,
    pieces: r.pieces == null ? null : Number(r.pieces), weightGrams: r.weight_grams == null ? null : Number(r.weight_grams), contents: (r.contents as string) ?? null, notes: (r.notes as string) ?? null,
    pickup: r.pickup ?? null, items: r.items ?? null, slot: r.slot ?? null, extra: r.extra ?? null, detailsComplete: !!r.details_complete,
    partnerStatus: (r.partner_status as string) ?? null, partnerStatusAt: d(r.partner_status_at), lastTrackedAt: d(r.last_tracked_at), shipmentId: (r.shipment_id as string) ?? null, requestId: (r.request_id as string) ?? null,
    cancelledAt: d(r.cancelled_at), cancelReason: (r.cancel_reason as string) ?? null, cancelledBy: (r.cancelled_by as string) ?? null, createdAt: d(r.created_at)!, updatedAt: d(r.updated_at)!,
  };
}

async function ownOrder(actor: User, id: string): Promise<PartnerOrder> {
  const biz = scopeId(actor);
  const [o] = await db.select().from(partnerOrders).where(and(eq(partnerOrders.id, id), biz ? eq(partnerOrders.businessId, biz) : undefined));
  if (!o) throw err("NOT_FOUND", "Order not found");
  return o;
}

export async function getOrder(actor: User, id: string) {
  const o = await ownOrder(actor, id);
  const [live, [conn], events] = await Promise.all([
    liveParcel(db, o.id),
    db.select({ name: partnerConnections.name, provider: partnerConnections.provider, businessName: sql<string | null>`(select coalesce(bp.company_name, u.name) from users u left join business_profiles bp on bp.user_id = u.id where u.id = ${partnerConnections.businessId})` }).from(partnerConnections).where(eq(partnerConnections.id, o.connectionId)),
    db.select({ id: partnerEvents.id, direction: partnerEvents.direction, kind: partnerEvents.kind, outcome: partnerEvents.outcome, summary: partnerEvents.summary, createdAt: partnerEvents.createdAt })
      .from(partnerEvents).where(and(eq(partnerEvents.connectionId, o.connectionId), sql`(${partnerEvents.partnerOrderId} = ${o.id} or lower(${partnerEvents.externalId}) in (${o.externalRef.toLowerCase()}, ${(o.awb ?? o.externalRef).toLowerCase()}))`))
      .orderBy(desc(partnerEvents.createdAt)).limit(100),
  ]);
  const outbox = await db.select({ id: partnerOutbox.id, action: partnerOutbox.action, status: partnerOutbox.status, attempts: partnerOutbox.attempts, lastError: partnerOutbox.lastError, createdAt: partnerOutbox.createdAt, sentAt: partnerOutbox.sentAt })
    .from(partnerOutbox).where(and(eq(partnerOutbox.connectionId, o.connectionId), eq(partnerOutbox.partnerOrderId, o.id))).orderBy(partnerOutbox.seq).limit(100);
  return { ...viewOrder(o, live, conn ?? null), extra: o.extra, events, updates: outbox };
}

/** Turns open orders into manifest rows for a new JR delivery order (the request form takes them as they are). */
export async function ordersToManifest(actor: User, ids: string[]) {
  const unique = [...new Set(ids)].slice(0, 500);
  if (!unique.length) throw err("VALIDATION", "Choose at least one order", { field: "ids" });
  const biz = scopeId(actor);
  const rows = (await db.execute(sql`select po.*, cur.* from partner_orders po ${LIVE_PARCEL_SQL} where po.id in (${sql.join(unique.map((i) => sql`${i}`), sql`, `)}) ${biz ? sql`and po.business_id = ${biz}` : sql``}`)).rows as Array<Record<string, unknown>>;
  if (rows.length !== unique.length) throw err("NOT_FOUND", "Some orders were not found");
  const businessIds = new Set(rows.map((r) => String(r.business_id)));
  if (businessIds.size > 1) throw err("VALIDATION", "Orders of different companies cannot go in one delivery order", { field: "ids" });
  const settings = await getSettings();
  const problems: Array<{ id: string; ref: string; issue: "not_open" | "incomplete" | "no_city" | "bad_phone" }> = [];
  const out = [] as Array<Record<string, unknown>>;
  for (const r of rows) {
    const o = rowToOrder(r);
    const st = orderState(o, r.s_id ? { status: String(r.s_status) } : null);
    const ref = o.awb ?? o.externalRef;
    if (st !== "open") { problems.push({ id: o.id, ref, issue: "not_open" }); continue; }
    if (!o.city) problems.push({ id: o.id, ref, issue: "no_city" });
    else if (!partnerPhone(o.recipientPhone).valid && o.recipientPhone) problems.push({ id: o.id, ref, issue: "bad_phone" });
    else if (!o.detailsComplete) problems.push({ id: o.id, ref, issue: "incomplete" });
    out.push({
      orderId: o.id, recipientType: "consumer", recipientName: o.recipientName ?? "", recipientPhone: partnerPhone(o.recipientPhone).valid ? o.recipientPhone : "", address: o.address ?? "",
      city: o.city, lat: o.lat, lng: o.lng, contents: o.contents, notes: o.notes, externalRef: ref, partnerId: o.connectionId, codCents: o.codCents ?? 0, codKnown: o.codCents != null,
    });
  }
  const cities = [...new Set(out.map((x) => x.city).filter(Boolean))] as string[];
  return { rows: out, problems, cities, deliveryCity: cities.length === 1 ? cities[0] : null, cityNames: Object.fromEntries(cities.map((k) => [k, settings.cities.find((c) => c.key === k)?.en ?? k])) };
}

/** "Not for JR": hides open orders from Incoming orders (the partner is not told — no partner API offers a carrier refusal). */
export async function dismissOrders(actor: User, ids: string[], reason?: string) {
  const unique = [...new Set(ids)].slice(0, 500);
  let n = 0;
  for (const id of unique) {
    const o = await ownOrder(actor, id);
    if (o.state === "cancelled") continue;
    if (await liveParcel(db, o.id)) throw err("CONFLICT", `Order ${o.awb ?? o.externalRef} is already in a JR delivery order`, { id });
    await db.update(partnerOrders).set({ state: "cancelled", cancelledAt: new Date(), cancelReason: reason?.trim().slice(0, 300) || null, cancelledBy: isStaff(actor) ? "staff" : "business", updatedAt: new Date() }).where(eq(partnerOrders.id, o.id));
    const [c] = await db.select().from(partnerConnections).where(eq(partnerConnections.id, o.connectionId));
    if (c) {
      await recordEvent(c, { direction: "in", kind: "dismissed", summary: `Order ${o.awb ?? o.externalRef} set aside by ${isStaff(actor) ? "JR staff" : "the company"}${reason ? `: ${reason.slice(0, 120)}` : ""}`, partnerOrderId: o.id });
      // A carrier partner believes JR is delivering it: tell it JR will not (Omniful: unable_to_deliver, Fastcoo: CCR — editable).
      if (getAdapter(c.provider)?.capabilities.mode === "carrier") await enqueueOrderEvent(db, c, o.id, "cancelled", `Not accepted by the warehouse in JR${reason ? `: ${reason.trim().slice(0, 200)}` : ""}`, `dismiss:${o.id}:${Date.now()}`);
    }
    n++;
  }
  return { dismissed: n };
}
export async function restoreOrders(actor: User, ids: string[]) {
  let n = 0;
  for (const id of [...new Set(ids)].slice(0, 500)) {
    const o = await ownOrder(actor, id);
    if (o.state !== "cancelled") continue;
    if (o.cancelledBy === "partner") throw err("CONFLICT", `Order ${o.awb ?? o.externalRef} was cancelled in the partner system and cannot be restored`, { id });
    await db.update(partnerOrders).set({ state: "open", cancelledAt: null, cancelReason: null, cancelledBy: null, updatedAt: new Date() }).where(eq(partnerOrders.id, o.id));
    n++;
  }
  return { restored: n };
}

/** Asks the partner for the order's current status / details now. */
export async function refreshOrder(actor: User, id: string) {
  await hit(`partner-lookup:${actor.id}`, 600, 60);
  const o = await ownOrder(actor, id);
  const [c] = await db.select().from(partnerConnections).where(eq(partnerConnections.id, o.connectionId));
  const a = c && getAdapter(c.provider);
  if (!c || !a) throw err("NOT_FOUND");
  if (!a.track && !a.lookup) throw err("VALIDATION", `${a.label} pushes its updates to JR; there is nothing to fetch`);
  try {
    if (a.lookup) {
      const p = await a.lookup(ctxOf(c), o.externalRef);
      if (p.found) await upsertOrder(db, c, a, { externalId: p.externalId, externalRef: o.externalRef, invoice: p.invoice, recipient: { name: p.recipientName, phone: p.recipientPhone, address: p.address, city: p.city, lat: p.lat ?? null, lng: p.lng ?? null }, codAmount: p.codAmount, pieces: p.pieces ?? null, notes: p.notes ?? null, extra: p.extra });
    }
    if (a.track) { const ev = await a.track(ctxOf(c), { externalId: o.externalId, externalRef: o.externalRef, invoice: o.invoice }); if (ev) await applyInbound(c, a, ev); }
  } catch (e) { throw err(e instanceof PartnerError && e.kind !== "unavailable" ? "VALIDATION" : "DEPENDENCY_UNAVAILABLE", msg(e)); }
  return getOrder(actor, id);
}

/** Imports one order by hand (any adapter that can look orders up). */
export async function importByReference(actor: User, connectionId: string, reference: string) {
  const c = await own(actor, connectionId);
  const a = adapterOf(c);
  if (!a.lookup) throw err("VALIDATION", `${a.label} does not support looking orders up`);
  let p;
  try { p = await a.lookup(ctxOf(c), reference); } catch (e) { throw err(e instanceof PartnerError && e.kind !== "unavailable" ? "VALIDATION" : "DEPENDENCY_UNAVAILABLE", msg(e)); }
  if (!p.found || !p.barcode) throw err("NOT_FOUND", `${a.label} has no order "${reference}"`);
  const r = await importOrder(c, a, { externalId: p.externalId, externalRef: p.barcode, invoice: p.invoice, recipient: { name: p.recipientName, phone: p.recipientPhone, address: p.address, city: p.city, lat: p.lat ?? null, lng: p.lng ?? null }, codAmount: p.codAmount, pieces: p.pieces ?? null, notes: p.notes ?? null, status: p.status, extra: p.extra }, "lookup");
  return getOrder(actor, r.order!.id);
}

// ───────── JR's label (public, signed link) ─────────
export async function serveLabel(awb: string, sig: string): Promise<Response> {
  if (!/^[A-Za-z0-9-]{4,40}$/.test(awb) || !labelSigOk(awb, sig)) return new Response("Not found", { status: 404 });
  const o = await orderByAwb(db, awb);
  if (!o) return new Response("Not found", { status: 404 });
  const [live, [biz], settings] = await Promise.all([
    liveParcel(db, o.id),
    db.select({ name: users.name, company: businessProfiles.companyName }).from(users).leftJoin(businessProfiles, eq(businessProfiles.userId, users.id)).where(eq(users.id, o.businessId)),
    getSettings(),
  ]);
  const a = getAdapter(o.provider);
  const pdf = labelPdf({
    awb: o.awb!, partner: a?.label ?? o.provider, orderRef: o.invoice ?? o.externalRef, parcelCode: live?.code ?? null, sender: biz?.company ?? biz?.name ?? null,
    recipientName: o.recipientName, recipientPhone: o.recipientPhone, address: o.address, city: o.city ? settings.cities.find((k) => k.key === o.city)?.en ?? o.city : o.cityRaw,
    codCents: o.codCents, pieces: o.pieces, weightGrams: o.weightGrams, createdAt: o.createdAt,
  });
  return new Response(new Uint8Array(pdf), { status: 200, headers: { "content-type": "application/pdf", "content-disposition": `inline; filename="${o.awb}.pdf"`, "cache-control": "private, max-age=300" } });
}

// ───────── history ─────────
export async function listPartnerEvents(actor: User, id: string, f: { page?: number; pageSize?: number; outcome?: string; direction?: string }) {
  await own(actor, id);
  const pageSize = Math.min(Math.max(f.pageSize ?? 30, 1), 100), page = Math.max(f.page ?? 1, 1);
  const where = and(eq(partnerEvents.connectionId, id), f.outcome ? eq(partnerEvents.outcome, f.outcome) : undefined, f.direction ? eq(partnerEvents.direction, f.direction) : undefined);
  const [items, [{ total }]] = await Promise.all([
    db.select({ id: partnerEvents.id, direction: partnerEvents.direction, kind: partnerEvents.kind, outcome: partnerEvents.outcome, summary: partnerEvents.summary, externalId: partnerEvents.externalId, shipmentId: partnerEvents.shipmentId, requestId: partnerEvents.requestId, partnerOrderId: partnerEvents.partnerOrderId, createdAt: partnerEvents.createdAt })
      .from(partnerEvents).where(where).orderBy(desc(partnerEvents.createdAt)).limit(pageSize).offset((page - 1) * pageSize),
    db.select({ total: sql<number>`count(*)::int` }).from(partnerEvents).where(where),
  ]);
  return { items, page, pageSize, total };
}

export async function outboxSummary(actor: User, id: string) {
  await own(actor, id);
  const [counts, recent] = await Promise.all([
    db.select({ status: partnerOutbox.status, n: sql<number>`count(*)::int` }).from(partnerOutbox).where(eq(partnerOutbox.connectionId, id)).groupBy(partnerOutbox.status),
    db.select({ id: partnerOutbox.id, action: partnerOutbox.action, status: partnerOutbox.status, attempts: partnerOutbox.attempts, lastError: partnerOutbox.lastError, shipmentId: partnerOutbox.shipmentId, partnerOrderId: partnerOutbox.partnerOrderId, createdAt: partnerOutbox.createdAt, sentAt: partnerOutbox.sentAt, nextAttemptAt: partnerOutbox.nextAttemptAt, code: shipments.code, ref: sql<string | null>`coalesce(${partnerOrders.awb}, ${partnerOrders.externalRef}, ${shipments.externalRef})` })
      .from(partnerOutbox).leftJoin(shipments, eq(shipments.id, partnerOutbox.shipmentId)).leftJoin(partnerOrders, eq(partnerOrders.id, partnerOutbox.partnerOrderId))
      .where(and(eq(partnerOutbox.connectionId, id), inArray(partnerOutbox.status, ["dead", "retry_wait", "skipped"]))).orderBy(desc(partnerOutbox.createdAt)).limit(30),
  ]);
  return { counts: Object.fromEntries(counts.map((c) => [c.status, c.n])), problems: recent };
}

export async function retryOutbox(actor: User, outboxId: string) {
  const r = await retryOutboxRow(scopeId(actor), outboxId);
  if (!r) throw err("NOT_FOUND");
  if (r === "not_failed") throw err("INVALID_TRANSITION", "Only failed updates can be retried");
  if (r === "superseded") throw err("INVALID_TRANSITION", "A newer update of this order already reached the partner — re-sending this older one would move it backwards");
  if (isStaff(actor)) await audit(actor, "partner.retry_update", "partner_outbox", outboxId);
  return { queued: true };
}

/** Back-office overview across all businesses: filterable, paged, with a real total. `problemsOnly` = stuck write-backs or a failing connection. */
export async function adminPartnerOverview(f: { page?: number; pageSize?: number; q?: string; provider?: string; status?: string; problemsOnly?: boolean; businessId?: string } = {}) {
  const page = Math.max(f.page ?? 1, 1), pageSize = Math.min(Math.max(f.pageSize ?? 50, 1), 200);
  const q = f.q?.trim() ? contains(f.q) : null;
  const stuckSql = sql`(select count(*) from partner_outbox o where o.connection_id = ${partnerConnections.id} and o.status in ('dead','retry_wait'))`;
  const where = and(
    f.provider ? eq(partnerConnections.provider, f.provider) : undefined, f.status ? eq(partnerConnections.status, f.status) : undefined, f.businessId ? eq(partnerConnections.businessId, f.businessId) : undefined,
    q ? sql`(${partnerConnections.name} ilike ${q} or ${users.name} ilike ${q} or exists (select 1 from business_profiles b where b.user_id = ${partnerConnections.businessId} and b.company_name ilike ${q}))` : undefined,
    f.problemsOnly ? sql`(${partnerConnections.lastError} is not null or ${stuckSql} > 0)` : undefined,
  );
  const [conns, [{ total }]] = await Promise.all([
    db.select({ c: partnerConnections, b: users.name, company: businessProfiles.companyName }).from(partnerConnections).innerJoin(users, eq(users.id, partnerConnections.businessId)).leftJoin(businessProfiles, eq(businessProfiles.userId, partnerConnections.businessId)).where(where).orderBy(desc(partnerConnections.createdAt)).limit(pageSize).offset((page - 1) * pageSize),
    db.select({ total: sql<number>`count(*)::int` }).from(partnerConnections).innerJoin(users, eq(users.id, partnerConnections.businessId)).where(where),
  ]);
  const ids = conns.map(({ c }) => c.id);
  const [stuck, counts] = ids.length ? await Promise.all([
    db.select({ id: partnerOutbox.connectionId, n: sql<number>`count(*)::int` }).from(partnerOutbox).where(and(inArray(partnerOutbox.connectionId, ids), inArray(partnerOutbox.status, ["dead", "retry_wait"]))).groupBy(partnerOutbox.connectionId),
    orderCounts(ids),
  ]) : [[], new Map()];
  const stuckBy = new Map(stuck.map((s) => [s.id, s.n]));
  return { items: conns.map(({ c, b, company }) => ({ ...viewConnection(c), business: company ?? b, businessId: c.businessId, stuckUpdates: stuckBy.get(c.id) ?? 0, orders: counts.get(c.id) ?? { open: 0, inJr: 0 } })), page, pageSize, total };
}
