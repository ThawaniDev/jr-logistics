import type { Tone } from "@/components/ui";

/**
 * Pure helpers of the driver's shipment list (the "delivery run sheet" cards, update J2): filters, counters, search, status chip, payment mode,
 * and which stops accept actions while routing is on / off. No React, no DOM — unit-tested in tests/unit/driver-shipments-lib.test.ts.
 * Tolerant of an older server: a missing `routingEnabled` means "routing on" (the behaviour before update J), missing new stop fields fall back.
 */

/** The parts of a stop the list needs (a structural subset of `Stop`, so the helpers stay testable without the whole shape). */
export interface ShipLike {
  id: string; seq: number; stopOrder: number; code: string; status: string; address: string; city?: string | null; contents?: string | null;
  recipientName?: string | null; recipientPhone?: string | null; current?: boolean; arrivedAt?: string | null; deferCount?: number;
  codCents?: number | null; codCollectedCents?: number | null; paymentMode?: string | null; createdAt?: string | null; pieces?: number | null; deliveredAt?: string | null;
}

// ───────── routing flag ─────────
/** `job.policy.routingEnabled`; an older server sends nothing = the original route flow. */
export function routingEnabledOf(job: { policy?: unknown } | null | undefined): boolean {
  const v = (job?.policy as { routingEnabled?: unknown } | null | undefined)?.routingEnabled;
  return v === undefined || v === null ? true : v === true;
}

// ───────── groups, filters, counters ─────────
export type ShipFilter = "all" | "todo" | "delivered" | "failed";
export const SHIP_FILTERS: readonly ShipFilter[] = ["all", "todo", "delivered", "failed"];
export type ShipGroup = Exclude<ShipFilter, "all">;
const FAILED = ["failed", "returned", "missing", "cancelled"];
/** To deliver = anything not finished (waiting or on the vehicle); delivered; not delivered = failed, returned, missing (or withdrawn). */
export const shipGroup = (status: string): ShipGroup => (status === "delivered" ? "delivered" : FAILED.includes(status) ? "failed" : "todo");
export const isResolvedShip = (s: Pick<ShipLike, "status">) => shipGroup(s.status) !== "todo";

export interface ShipCounters { total: number; todo: number; delivered: number; failed: number; done: number; pct: number }
export function shipCounters(stops: ReadonlyArray<Pick<ShipLike, "status">>): ShipCounters {
  let todo = 0, delivered = 0, failed = 0;
  for (const s of stops) { const g = shipGroup(s.status); if (g === "todo") todo++; else if (g === "delivered") delivered++; else failed++; }
  const total = stops.length; const done = delivered + failed;
  return { total, todo, delivered, failed, done, pct: total > 0 ? Math.round((done / total) * 100) : 0 };
}
export const countFor = (c: ShipCounters, f: ShipFilter): number => (f === "all" ? c.total : c[f]);

const norm = (v: unknown) => String(v ?? "").toLowerCase().replace(/\s+/g, " ").trim();
const digits = (v: unknown) => String(v ?? "").replace(/\D/g, "");
/** Search by code, manifest number, recipient name, phone (digits, any formatting), address, city or contents. */
export function matchesSearch(s: ShipLike, query: string): boolean {
  const q = norm(query);
  if (!q) return true;
  const qd = digits(q);
  if (norm(s.code).includes(q) || norm(s.recipientName).includes(q) || norm(s.address).includes(q) || norm(s.city).includes(q) || norm(s.contents).includes(q)) return true;
  if (String(s.seq) === q.replace(/^0+(?=\d)/, "")) return true;
  const pd = digits(s.recipientPhone);
  return qd.length >= 3 && (pd.includes(qd) || (qd.length >= 9 && pd.endsWith(qd.slice(-9)))); // 0550000001 finds +966550000001
}
export const matchesFilter = (s: Pick<ShipLike, "status">, f: ShipFilter) => f === "all" || shipGroup(s.status) === f;
/** The cards to show, in the order they were given (the route / manifest order). */
export const filterShips = <T extends ShipLike>(stops: readonly T[], f: ShipFilter, query: string): T[] => stops.filter((s) => matchesFilter(s, f) && matchesSearch(s, query));
/** Unfinished parcels first, finished ones after them (each group keeps its route / manifest order), so 80 dimmed cards never push the work out of view. */
export const sortShips = <T extends ShipLike>(stops: readonly T[]): T[] => {
  const ordered = [...stops].sort((a, b) => a.stopOrder - b.stopOrder || a.seq - b.seq);
  return [...ordered.filter((s) => !isResolvedShip(s)), ...ordered.filter(isResolvedShip)];
};

// ───────── status chip ─────────
export type ChipKey = "out" | "delivered" | "failed" | "returned" | "missing" | "postponed" | "pending" | "cancelled";
export interface StatusChip { key: ChipKey; tone: Tone }
/** "Out for delivery" (green) for a stop on the vehicle; a stop the driver already postponed once says so. */
export function statusChip(s: Pick<ShipLike, "status" | "deferCount">): StatusChip {
  switch (s.status) {
    case "delivered": return { key: "delivered", tone: "success" };
    case "failed": return { key: "failed", tone: "danger" };
    case "returned": return { key: "returned", tone: "info" };
    case "missing": return { key: "missing", tone: "danger" };
    case "cancelled": return { key: "cancelled", tone: "neutral" };
    case "pending": return { key: "pending", tone: "neutral" };
    default: return (s.deferCount ?? 0) > 0 ? { key: "postponed", tone: "warn" } : { key: "out", tone: "success" };
  }
}

// ───────── payment, pieces, date ─────────
export type PaymentMode = "cod" | "prepaid";
/** The server's `paymentMode`; derived from the cash amount when an older server does not send it. */
export function paymentModeOf(s: Pick<ShipLike, "paymentMode" | "codCents">): PaymentMode {
  if (s.paymentMode === "cod" || s.paymentMode === "prepaid") return s.paymentMode;
  return typeof s.codCents === "number" && s.codCents > 0 ? "cod" : "prepaid";
}
/** Cash on delivery of the parcel in halalas (0 = prepaid). */
export const codOf = (s: Pick<ShipLike, "codCents">) => (typeof s.codCents === "number" && s.codCents > 0 ? Math.trunc(s.codCents) : 0);
export const piecesOf = (s: Pick<ShipLike, "pieces">) => (typeof s.pieces === "number" && Number.isFinite(s.pieces) && s.pieces >= 1 ? Math.trunc(s.pieces) : 1);
/** Total cash still to collect over the open parcels (halalas). */
export const cashToCollect = (stops: ReadonlyArray<Pick<ShipLike, "status" | "codCents">>) => stops.reduce((n, s) => n + (shipGroup(s.status) === "todo" ? codOf(s) : 0), 0);

/** Cash the driver has already collected over the whole job (halalas). */
export const cashCollected = (stops: ReadonlyArray<Pick<ShipLike, "codCollectedCents">>) => stops.reduce((n, s) => n + (typeof s.codCollectedCents === "number" && s.codCollectedCents > 0 ? Math.trunc(s.codCollectedCents) : 0), 0);

/** The date a card shows: when the parcel was delivered, else when it was created. */
export function cardDate(s: Pick<ShipLike, "status" | "createdAt" | "deliveredAt">): { kind: "delivered" | "created"; at: string } | null {
  if (s.status === "delivered" && s.deliveredAt) return { kind: "delivered", at: s.deliveredAt };
  return s.createdAt ? { kind: "created", at: s.createdAt } : null;
}

// ───────── who may act ─────────
export type ShipAccess = "act" | "locked" | "done";
/**
 * Routing off: any stop that is on the vehicle accepts actions, in any order. Routing on: only the current stop does; the others are
 * visible but locked until it is resolved. Finished stops are never actionable.
 */
export function shipAccess(s: Pick<ShipLike, "status" | "current">, routing: boolean): ShipAccess {
  if (isResolvedShip(s)) return "done";
  if (s.status !== "loaded") return "locked";
  return !routing || s.current === true ? "act" : "locked";
}
/**
 * The stop the sticky "next" button opens: one the driver has already arrived at, else the current stop, else the first one on the vehicle
 * (manifest / route order). Null when nothing can be acted on.
 */
export function nextShip<T extends ShipLike>(stops: readonly T[], routing: boolean): T | null {
  const open = [...stops].sort((a, b) => a.stopOrder - b.stopOrder || a.seq - b.seq).filter((s) => shipAccess(s, routing) === "act");
  return open.find((s) => !!s.arrivedAt) ?? open.find((s) => s.current === true) ?? open[0] ?? null;
}

// ───────── contact ─────────
/** `tel:` link of a recipient phone (spaces and punctuation dropped, a leading + kept). */
export function telHref(phone: string | null | undefined): string | null {
  const p = String(phone ?? "").replace(/[^\d+]/g, "");
  return p.replace(/\D/g, "").length >= 5 ? `tel:${p}` : null;
}
/** What "copy address" puts on the clipboard. */
export const addressText = (s: Pick<ShipLike, "address" | "city">, cityLabel?: string | null) => [s.address, cityLabel].filter(Boolean).join(", ");

/** Cards rendered per step: 500 parcels must stay light on a phone. */
export const SHIP_PAGE = 30;
