import { fromServer, type ManifestRow } from "./business-shipments-lib";
import type { Connection, OrderState, PartnerOrder } from "./business-shipments-partner";

/**
 * Incoming orders (orders a warehouse system pushed to JR or JR imported): pure, UI-free helpers shared by the list, the detail view,
 * the request-form prefill and the manifest picker. Contract: memory/INTEGRATIONS_API.md ("Incoming orders").
 */

// ───────── list filters ─────────
/** The state pills of the list, in display order. "open" is the default (orders still waiting for a JR delivery order). */
export const ORDER_FILTERS = ["open", "in_jr", "delivered", "undelivered", "cancelled", "all"] as const;
export type OrderFilter = (typeof ORDER_FILTERS)[number];
export const DEFAULT_FILTER: OrderFilter = "open";
export const parseFilter = (v: string | null | undefined): OrderFilter => ((ORDER_FILTERS as readonly string[]).includes(v ?? "") ? (v as OrderFilter) : DEFAULT_FILTER);

export type OrderCounts = Record<OrderState, number>;
export const EMPTY_COUNTS: OrderCounts = { open: 0, in_jr: 0, delivered: 0, undelivered: 0, cancelled: 0 };
export const countOf = (counts: Partial<OrderCounts> | undefined, f: OrderFilter): number | undefined => {
  if (!counts) return undefined;
  if (f === "all") return (["open", "in_jr", "delivered", "undelivered", "cancelled"] as const).reduce((n, s) => n + (counts[s] ?? 0), 0);
  return counts[f] ?? 0;
};

export interface OrdersQuery { state?: OrderFilter; connectionId?: string; q?: string; city?: string; businessId?: string; page?: number; pageSize?: number }
/** `GET <apiBase>/orders?…` — "all" sends no state; blank values are left out. */
export function ordersPath(apiBase: string, f: OrdersQuery): string {
  const p = new URLSearchParams();
  if (f.state && f.state !== "all") p.set("state", f.state);
  if (f.connectionId) p.set("connectionId", f.connectionId);
  if (f.businessId) p.set("businessId", f.businessId);
  const q = f.q?.trim(); if (q) p.set("q", q.slice(0, 80));
  if (f.city) p.set("city", f.city);
  if (f.page && f.page > 1) p.set("page", String(Math.floor(f.page)));
  if (f.pageSize) p.set("pageSize", String(Math.min(200, Math.max(1, Math.floor(f.pageSize)))));
  const s = p.toString();
  return `${apiBase}/orders${s ? `?${s}` : ""}`;
}

// ───────── what can be done with an order ─────────
/** Still waiting for a JR delivery order (no live parcel): can go into one, or be set aside. */
export const isOpen = (o: Pick<PartnerOrder, "state">) => o.state === "open";
/** Set aside by the company or by JR staff (never a cancellation in the partner's own system, which JR cannot undo). */
export const isRestorable = (o: Pick<PartnerOrder, "state" | "cancelledBy">) => o.state === "cancelled" && o.cancelledBy !== "partner";
/** Rows that get a checkbox in the list. */
export const isSelectable = (o: Pick<PartnerOrder, "state" | "cancelledBy">) => isOpen(o) || isRestorable(o);

/** The selection split by what each bulk action may act on (ids in list order; ids not on the current page are ignored). */
export function selectionSummary(items: Array<Pick<PartnerOrder, "id" | "state" | "cancelledBy">>, picked: ReadonlySet<string>) {
  const chosen = items.filter((o) => picked.has(o.id));
  return { count: chosen.length, open: chosen.filter(isOpen).map((o) => o.id), restorable: chosen.filter(isRestorable).map((o) => o.id) };
}
/** Adds or removes ids; returns a new set (React state). */
export function togglePicked(picked: ReadonlySet<string>, ids: string[], on: boolean): Set<string> {
  const n = new Set(picked);
  for (const id of ids) { if (on) n.add(id); else n.delete(id); }
  return n;
}
/** Keeps only ids still present and selectable (after a reload, a filter change or an action). */
export const prunePicked = (picked: ReadonlySet<string>, items: Array<Pick<PartnerOrder, "id" | "state" | "cancelledBy">>): Set<string> => {
  const ok = new Set(items.filter(isSelectable).map((o) => o.id));
  return new Set([...picked].filter((id) => ok.has(id)));
};
/** "Refresh from the partner" only makes sense when JR can ask the partner (lookup) or track it; push-only systems send their own updates. */
export const canRefresh = (c: Pick<Connection, "capabilities"> | null | undefined) => !!c?.capabilities && (c.capabilities.lookup || c.capabilities.track);
/** Connections an order can be imported from by its number. */
export const importableConnections = <C extends Pick<Connection, "status" | "capabilities">>(conns: C[]): C[] => conns.filter((c) => c.status === "active" && !!c.capabilities?.lookup);

// ───────── request-form hand-over ─────────
export const MAX_MANIFEST_IDS = 500;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** `?fromOrders=a,b,c` → order ids (uuid-shaped only, repeats removed, at most 500, order kept). */
export function parseOrderIds(raw: string | null | undefined): string[] {
  const seen = new Set<string>(); const out: string[] = [];
  for (const part of (raw ?? "").split(/[\s,]+/)) {
    const v = part.trim().toLowerCase();
    if (UUID.test(v) && !seen.has(v)) { seen.add(v); out.push(v); }
    if (out.length >= MAX_MANIFEST_IDS) break;
  }
  return out;
}
/** Where "Create delivery order" goes: the request form, which loads the orders itself. */
export const fromOrdersHref = (ids: string[]) => `/business/requests/new?fromOrders=${ids.join(",")}`;

export type ProblemIssue = "not_open" | "incomplete" | "no_city" | "bad_phone";
export interface ManifestProblem { id: string; ref: string; issue: ProblemIssue }
/** One row of `POST …/orders/manifest`: exactly the request form's `shipments[]` item plus `orderId` / `codKnown`, which the form does not take. */
export interface ManifestWireRow {
  orderId: string; recipientType: "consumer" | "business"; recipientName: string; recipientPhone: string; address: string; city: string | null;
  lat: number | null; lng: number | null; contents: string | null; notes: string | null; externalRef: string; partnerId: string; codCents: number; codKnown: boolean;
}
export interface OrdersManifest { rows: ManifestWireRow[]; problems: ManifestProblem[]; cities: string[]; deliveryCity: string | null; cityNames: Record<string, string> }

/** Manifest rows → the editor's rows. `orderId` and `codKnown` are dropped; `externalRef` + `partnerId` stay (they link each parcel to its order). */
export function manifestRows(m: Pick<OrdersManifest, "rows">): ManifestRow[] {
  return m.rows.map(({ orderId: _orderId, codKnown: _codKnown, ...wire }) => fromServer(wire as unknown as Record<string, unknown>));
}

/** What the request form starts from when it is opened from Incoming orders (`/business/requests/new?fromOrders=<ids>`). */
export interface OrdersSeed { rows: ManifestRow[]; deliveryCity: string | null; problems: ManifestProblem[]; cityNames: Record<string, string>; orders: number }
export function seedFrom(m: OrdersManifest): OrdersSeed {
  const rows = manifestRows(m);
  return { rows, deliveryCity: m.deliveryCity, problems: m.problems, cityNames: m.cityNames ?? {}, orders: rows.length };
}
/** The form fields a seed sets: the per-parcel delivery service and the orders' city (when they share one). Nothing without a seed. */
export const seedForm = (seed: OrdersSeed | undefined): Record<string, unknown> => (seed ? { service: "delivery_driver", ...(seed.deliveryCity ? { deliveryCity: seed.deliveryCity } : {}) } : {});

export type CityVerdict = { kind: "one"; city: string } | { kind: "none" } | { kind: "mixed"; cities: string[] };
/** One JR delivery order serves one city: several matched cities cannot go together. No matched city at all is allowed (the user picks one). */
export function cityVerdict(m: Pick<OrdersManifest, "cities" | "deliveryCity">): CityVerdict {
  const cities = [...new Set(m.cities.filter(Boolean))];
  if (cities.length > 1) return { kind: "mixed", cities };
  if (cities.length === 1) return { kind: "one", city: m.deliveryCity ?? cities[0] };
  return { kind: "none" };
}
/** Order ids per matched city, in the order the cities are listed (to narrow a mixed selection to one city). */
export function idsByCity(m: Pick<OrdersManifest, "rows" | "cities">): Array<{ city: string; ids: string[] }> {
  return m.cities.map((city) => ({ city, ids: m.rows.filter((r) => r.city === city).map((r) => r.orderId) })).filter((g) => g.ids.length > 0);
}

/** Problems grouped for one notice: most actionable first, refs in the order the server gave them (repeats removed). */
export const ISSUE_ORDER: ProblemIssue[] = ["bad_phone", "incomplete", "no_city", "not_open"];
export function groupProblems(problems: ManifestProblem[]): Array<{ issue: ProblemIssue; refs: string[] }> {
  return ISSUE_ORDER.map((issue) => ({ issue, refs: [...new Set(problems.filter((p) => p.issue === issue).map((p) => p.ref))] })).filter((g) => g.refs.length > 0);
}
/** A short list for a notice: the first `max` refs and how many more there are. */
export function refList(refs: string[], max = 5): { shown: string[]; more: number } {
  return { shown: refs.slice(0, max), more: Math.max(0, refs.length - max) };
}

/** The reference a parcel made from this order carries (carrier mode: JR's AWB, which the label scans; otherwise the partner's reference). */
export const parcelRefOf = (o: Pick<PartnerOrder, "awb" | "externalRef">) => (o.awb ?? o.externalRef).trim();
/** Orders whose parcel is already in the manifest being edited (same reference, case-insensitive). */
export function inManifest(o: Pick<PartnerOrder, "awb" | "externalRef">, rows: Array<Pick<ManifestRow, "externalRef">>): boolean {
  const k = parcelRefOf(o).toLowerCase();
  return rows.some((r) => r.externalRef.trim().toLowerCase() === k);
}
/** Manifest rows not already in the editor (by reference), at most `room`. */
export function newRowsOnly(add: ManifestRow[], existing: Array<Pick<ManifestRow, "externalRef">>, room: number): ManifestRow[] {
  const have = new Set(existing.map((r) => r.externalRef.trim().toLowerCase()).filter(Boolean));
  const out: ManifestRow[] = [];
  for (const r of add) {
    if (out.length >= Math.max(0, room)) break;
    const k = r.externalRef.trim().toLowerCase();
    if (k && have.has(k)) continue;
    if (k) have.add(k);
    out.push(r);
  }
  return out;
}

// ───────── display ─────────
/** Translation if the key exists, else the fallback (cities added by JR after this UI shipped, partner wording …). */
export const txOr = (t: (k: string) => string, key: string, fallback: string) => { const s = t(key); return s === key ? fallback : s; };
/** A JR city key → its name in the user's language (catalog / server names as fallbacks). */
export const cityLabel = (t: (k: string) => string, key: string, names?: Record<string, string>) => txOr(t, `city.${key}`, names?.[key] ?? key);
/** Grams → "1.25" kg (null stays null). */
export const kgOf = (g: number | null | undefined) => (g == null ? null : Math.round(g / 10) / 100);
/** Who set an order aside / cancelled it → i18n key. */
export const cancelledByKey = (by: string | null | undefined) => (by === "partner" ? "iord.by_partner" : by === "staff" ? "iord.by_staff" : "iord.by_business");
/** Pickup details the partner sent (free-form object) → readable label/value pairs (strings and numbers only, nested objects flattened one level). */
export function pickupPairs(p: Record<string, unknown> | null | undefined): Array<{ key: string; value: string }> {
  if (!p || typeof p !== "object") return [];
  const out: Array<{ key: string; value: string }> = [];
  const put = (k: string, v: unknown) => { if ((typeof v === "string" && v.trim()) || typeof v === "number") out.push({ key: k, value: String(v).trim() }); };
  for (const [k, v] of Object.entries(p)) {
    if (v && typeof v === "object" && !Array.isArray(v)) for (const [k2, v2] of Object.entries(v as Record<string, unknown>)) put(`${k}.${k2}`, v2);
    else put(k, v);
  }
  return out.slice(0, 20);
}
