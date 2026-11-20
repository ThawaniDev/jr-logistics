import type { Capabilities, Connection, EventKind, FreshCredentials, JrEvent, Mode, Provider } from "./business-shipments-partner";

/**
 * Pure helpers of the warehouse-system connection screens (company portal and staff console share them). No React here, so the
 * mapping editors' rules are unit-tested (tests/unit/partner-conn-lib.test.ts). Contract: memory/INTEGRATIONS_API.md.
 */

// ───────── where the screens live ─────────
/** The company and staff screens are the same components at two API prefixes and two route prefixes. */
export interface ConnScope {
  /** `/integrations` (company) or `/admin/integrations` (staff). */
  apiBase: string;
  /** `/business/integrations` or `/admin/integrations`. */
  routeBase: string;
  /** Where an activity line's JR order opens. */
  requestBase: string;
  staff: boolean;
  /** Staff without `integrations.manage` see everything but change nothing. The company always may. */
  canManage: boolean;
}
export const BUSINESS_SCOPE: ConnScope = { apiBase: "/integrations", routeBase: "/business/integrations", requestBase: "/business/requests", staff: false, canManage: true };
export const adminScope = (canManage: boolean): ConnScope => ({ apiBase: "/admin/integrations", routeBase: "/admin/integrations", requestBase: "/admin/requests", staff: true, canManage });

/** `GET|PATCH {apiBase}/connections/:id{suffix}`. */
export const connApi = (s: Pick<ConnScope, "apiBase">, id: string, suffix = "") => `${s.apiBase}/connections/${id}${suffix}`;
/** The connection's own page (`{routeBase}/:id{suffix}`). */
export const connRoute = (s: Pick<ConnScope, "routeBase">, id: string, suffix = "") => `${s.routeBase}/${id}${suffix}`;
/** Incoming orders of one connection (the Orders page is a sibling route). */
export const ordersHref = (s: Pick<ConnScope, "routeBase">, id: string) => `${s.routeBase}/orders?connectionId=${encodeURIComponent(id)}`;

// ───────── modes ─────────
export const MODES: readonly Mode[] = ["carrier", "merchant", "custom"];
export const modeOf = (c: Pick<Connection, "mode" | "capabilities">): Mode | null => c.mode ?? c.capabilities?.mode ?? null;
/** Providers in catalogue order, grouped carrier → merchant → custom (empty groups dropped). */
export function groupByMode(providers: Provider[]): Array<{ mode: Mode; items: Provider[] }> {
  return MODES.map((mode) => ({ mode, items: providers.filter((p) => p.capabilities.mode === mode) })).filter((g) => g.items.length > 0);
}
/** "Check now" exists for systems JR can ask on demand (new orders and/or a status per order). */
export const canPoll = (caps: Capabilities | null | undefined) => !!caps && (caps.pollOrders || caps.track);
/** Fastcoo's page names the order webhook `{base_url}/webhook/API/OrderRecieveLM`; JR accepts it under the connection's URL too. */
export const FASTCOO_ORDER_SUFFIX = "/webhook/API/OrderRecieveLM";

// ───────── form fields ─────────
/** Basic fields first, `advanced: true` ones (paths, time zones, API hosts) under a collapsible "Advanced". */
export function splitFields<F extends { advanced?: boolean }>(fields: F[]): { basic: F[]; advanced: F[] } {
  return { basic: fields.filter((f) => !f.advanced), advanced: fields.filter((f) => !!f.advanced) };
}
/** The advanced group opens by itself when one of its fields has an error (otherwise the message would be hidden). */
export const advancedHasError = (fields: Array<{ key: string; advanced?: boolean }>, errors: Record<string, string>) => fields.some((f) => f.advanced && !!errors[f.key]);

// ───────── outbound: JR event → partner status ─────────
/** What a JR event sends: `null` = the documented default, `""` = nothing, otherwise the partner's status code. */
export type OutChoice = string | null;
export const OUT_DEFAULT = "__default";
export const OUT_NONE = "__none";
/** Select value ⇄ setting (HTML selects carry strings only). */
export const encodeOut = (v: OutChoice | undefined): string => (v === undefined || v === null ? OUT_DEFAULT : v === "" ? OUT_NONE : v);
export const decodeOut = (s: string): OutChoice => (s === OUT_DEFAULT ? null : s === OUT_NONE ? "" : s);
/** The status JR will actually send for a choice (`null` = nothing). */
export const effectiveOut = (v: OutChoice | undefined, dflt: string | null | undefined): string | null => (v === undefined || v === null ? dflt || null : v === "" ? null : v);

export interface OutDraft { sync: Partial<Record<JrEvent, boolean>>; statusOut: Partial<Record<JrEvent, OutChoice>> }
export const EMPTY_OUT: OutDraft = { sync: {}, statusOut: {} };
export interface OutRow { ev: JrEvent; sync: boolean; choice: OutChoice; defaultCode: string | null; effective: string | null; changed: boolean }

const savedChoice = (c: Connection, ev: JrEvent): OutChoice => { const v = c.settings.statusOut?.[ev]; return v === undefined ? null : v; };
const savedSync = (c: Connection, ev: JrEvent) => !!c.settings.sync?.[ev];
const pushOf = (c: Connection): JrEvent[] => c.capabilities?.push ?? [];

/** One row per event the system can hear about, in JR's journey order, with the draft applied. */
export function outRows(c: Connection, p: Provider | undefined, d: OutDraft): OutRow[] {
  return pushOf(c).map((ev) => {
    const sync = d.sync[ev] ?? savedSync(c, ev);
    const choice = ev in d.statusOut ? (d.statusOut[ev] as OutChoice) : savedChoice(c, ev);
    const defaultCode = p?.defaults.statusOut?.[ev] ?? null;
    const changed = (ev in d.sync && d.sync[ev] !== savedSync(c, ev)) || (ev in d.statusOut && d.statusOut[ev] !== savedChoice(c, ev));
    return { ev, sync, choice, defaultCode, effective: effectiveOut(choice, defaultCode), changed };
  });
}
/** The PATCH `settings` for the outbound table: only what differs from what is saved; `null` when nothing does. */
export function outPatch(c: Connection, d: OutDraft): { sync?: Partial<Record<JrEvent, boolean>>; statusOut?: Partial<Record<JrEvent, OutChoice>> } | null {
  const sync: Partial<Record<JrEvent, boolean>> = {}; const statusOut: Partial<Record<JrEvent, OutChoice>> = {};
  for (const ev of pushOf(c)) {
    if (ev in d.sync && d.sync[ev] !== savedSync(c, ev)) sync[ev] = d.sync[ev];
    if (ev in d.statusOut && d.statusOut[ev] !== savedChoice(c, ev)) statusOut[ev] = d.statusOut[ev] as OutChoice;
  }
  const out: { sync?: typeof sync; statusOut?: typeof statusOut } = {};
  if (Object.keys(sync).length) out.sync = sync;
  if (Object.keys(statusOut).length) out.statusOut = statusOut;
  return Object.keys(out).length ? out : null;
}
/** A saved code that is not in the documented list (set through the API) still has to be selectable. */
export function outOptions(c: Connection, rows: OutRow[]): Array<{ value: string; label: string; hint?: string }> {
  const opts = [...c.statusOutOptions];
  for (const r of rows) if (r.choice && !opts.some((o) => o.value === r.choice)) opts.push({ value: r.choice, label: r.choice });
  return opts;
}

// ───────── inbound: partner status → what JR understands ─────────
export const KINDS: readonly EventKind[] = ["status", "cancelled", "delivered", "returned", "failed"];
/** Status keys are compared case-insensitively by the server and stored lower-case. */
export const statusKey = (s: string) => s.trim().toLowerCase();
/** lower-case key → meaning, or `null` = remove the connection's own rule. */
export type InDraft = Record<string, EventKind | null>;
export interface InRow {
  key: string; value: string; label: string | null; labelAr: string | null;
  kind: EventKind;
  /** The documented meaning (null when the system publishes none, e.g. LogesTech's live catalogue). */
  documented: EventKind | null;
  /** Added by the company (not in the documented list / catalogue). */
  custom: boolean;
  changed: boolean;
  /** A custom rule marked for removal. */
  removed: boolean;
}

/** Documented statuses (or the live catalogue) first, then the connection's own extra keys, then keys added in the draft. */
export function inRows(c: Connection, p: Provider | undefined, d: InDraft): InRow[] {
  const own = c.settings.statusIn ?? {};
  const doc = (k: string) => p?.statusIn.find((s) => statusKey(s.value) === k)?.kind ?? null;
  const rows: InRow[] = [];
  const seen = new Set<string>();
  for (const o of c.statusInOptions) {
    const key = statusKey(o.value);
    if (seen.has(key)) continue;
    seen.add(key);
    const documented = doc(key);
    const has = key in d;
    const kind = has ? (d[key] ?? documented ?? "status") : o.kind;
    rows.push({ key, value: o.value, label: o.label || null, labelAr: o.labelAr, kind, documented, custom: false, changed: has && kind !== o.kind, removed: false });
  }
  for (const [k, v] of Object.entries(own)) {
    const key = statusKey(k);
    if (seen.has(key)) continue;
    seen.add(key);
    const has = key in d; const removed = has && d[key] === null;
    const kind = has && d[key] ? (d[key] as EventKind) : v;
    rows.push({ key, value: key, label: null, labelAr: null, kind, documented: doc(key), custom: true, changed: has && (removed || kind !== v), removed });
  }
  for (const [key, v] of Object.entries(d)) {
    if (seen.has(key) || v === null) continue;
    seen.add(key);
    rows.push({ key, value: key, label: null, labelAr: null, kind: v, documented: doc(key), custom: true, changed: true, removed: false });
  }
  return rows;
}
/** The PATCH `settings.statusIn`: changed meanings; `null` removes a rule (a documented status set back to its documented meaning, or a custom key deleted). */
export function inPatch(c: Connection, p: Provider | undefined, d: InDraft): Record<string, EventKind | null> | null {
  const own = c.settings.statusIn ?? {};
  const out: Record<string, EventKind | null> = {};
  for (const r of inRows(c, p, d)) {
    if (!r.changed) continue;
    if (r.removed) { out[r.key] = null; continue; }
    out[r.key] = !r.custom && r.documented === r.kind && r.key in own ? null : r.kind;
  }
  return Object.keys(out).length ? out : null;
}
export type KeyProblem = "empty" | "too_long" | "exists";
/** A status key typed into "add a status key": trimmed, at most 80 characters, not already in the table. */
export function checkNewKey(raw: string, rows: Array<Pick<InRow, "key" | "removed">>): KeyProblem | null {
  const key = statusKey(raw);
  if (!key) return "empty";
  if (key.length > 80) return "too_long";
  if (rows.some((r) => r.key === key && !r.removed)) return "exists";
  return null;
}

// ───────── behaviour ─────────
/** Carrier partners send orders precisely so JR delivers them: Incoming orders is always on. Others choose (when the system can send orders at all). */
export const importChoice = (c: Pick<Connection, "capabilities" | "mode">): "always" | "toggle" | "none" =>
  modeOf(c) === "carrier" ? "always" : c.capabilities?.importOrders ? "toggle" : "none";
/** Poll interval options: the provider's list (empty = the system cannot be asked on a schedule); the saved value is kept selectable. */
export function pollOptions(p: Provider | undefined, current: number): number[] {
  const list = p?.pollChoices ?? [];
  if (!list.length) return [];
  return list.includes(current) ? list : [...list, current].sort((a, b) => a - b);
}

// ───────── the "shown once" credentials ─────────
/** What a create / rotate answer handed over once, plus the connection it belongs to. */
export interface FreshView { conn: Pick<Connection, "id" | "name" | "provider" | "providerLabel">; creds: FreshCredentials; kind: "created" | "rotated" }

type Created = Omit<Connection, "carrier" | "webhookUrl"> & { inboundToken?: string | null; webhookUrl?: string | null; carrier?: Connection["carrier"] | FreshCredentials["carrier"] };
/**
 * The create answer is the connection with the credentials spread over it (`webhookUrl` with the token, `carrier` with the key and secret).
 * Split it back into the plain connection and the credentials to show once (`null` when the system has no JR credentials).
 */
export function splitCreated(r: Created): { conn: Connection; creds: FreshCredentials | null } {
  const { inboundToken, ...rest } = r;
  const token = inboundToken ?? null;
  const rawCarrier = r.carrier ?? null;
  const freshCarrier = rawCarrier && "apiKey" in rawCarrier ? rawCarrier : null;
  const creds: FreshCredentials | null = token ? { inboundToken: token, webhookUrl: r.webhookUrl ?? null, carrier: freshCarrier } : null;
  const baseHook = r.webhookUrl && token && r.webhookUrl.endsWith(`/${token}`) ? r.webhookUrl.slice(0, -(token.length + 1)) : r.webhookUrl ?? null;
  const carrier: Connection["carrier"] = freshCarrier ? { baseUrl: freshCarrier.baseUrl, clientId: freshCarrier.clientId, authModes: ["api_key", "access_token"] } : (rawCarrier as Connection["carrier"]);
  return { conn: { ...rest, webhookUrl: baseHook, carrier } as Connection, creds };
}

/** Does the full webhook address carry the token (url-auth partners: Shipox, Fastcoo)? Then it is a secret too. */
export const urlCarriesToken = (creds: Pick<FreshCredentials, "inboundToken" | "webhookUrl">) => !!creds.inboundToken && !!creds.webhookUrl && creds.webhookUrl.includes(creds.inboundToken);
