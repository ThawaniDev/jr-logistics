/** Pure helpers of the redesigned company portal (order filters, wallet groups, dashboard attention list). No React, so they are unit-tested. */

export const ACTIVE_STATUSES = ["published", "filling", "assigned", "confirmed", "in_progress"] as const;
/** Filters of the orders list that are not a single status. */
export type OrderFilterKey = "" | "action" | "active" | "draft" | "completed" | "cancelled" | "expired";
export const ORDER_FILTERS: OrderFilterKey[] = ["", "action", "active", "draft", "completed", "cancelled", "expired"];
const KNOWN_STATUS = new Set(["draft", "published", "filling", "assigned", "confirmed", "in_progress", "completed", "cancelled", "expired"]);

/**
 * `?status=` (and the old `?needsAction=1` links from notifications / the dashboard) → the list filter.
 * A single raw status such as `in_progress` is kept as it is, so an older deep link still filters; anything unknown shows everything.
 */
export function parseOrderFilter(status: string | null | undefined, needsAction?: string | null): string {
  const s = (status ?? "").trim();
  if (s === "action" || (!s && needsAction === "1")) return "action";
  if (s === "active" || ORDER_FILTERS.includes(s as OrderFilterKey) || KNOWN_STATUS.has(s)) return s;
  return "";
}

/** The query-string part of `GET /requests` for a filter. */
export function orderFilterParams(filter: string): Record<string, string> {
  if (filter === "action") return { needsAction: "1" };
  if (filter === "active") return { status: ACTIVE_STATUSES.join(",") };
  return filter ? { status: filter } : {};
}

/** Number of orders behind a filter, from `GET /business/overview` → `requests` (needs-action comes from its own count). */
export function orderFilterCount(filter: string, byStatus: Record<string, number> | undefined, needsAction: number | undefined): number | undefined {
  if (!byStatus) return filter === "action" ? needsAction : undefined;
  const sum = (ks: readonly string[]) => ks.reduce((a, k) => a + (byStatus[k] ?? 0), 0);
  if (filter === "") return sum(Object.keys(byStatus));
  if (filter === "action") return needsAction;
  if (filter === "active") return sum(ACTIVE_STATUSES);
  return byStatus[filter] ?? 0;
}

/**
 * Filters shown as pills: the always-useful ones, the others only when they hold something, plus whatever is selected right now
 * (so a deep link such as `?status=in_progress` is visible and can be cleared).
 */
export function visibleOrderFilters(current: string, count: (k: string) => number | undefined): string[] {
  const always = new Set(["", "active", "draft", "completed"]);
  const keys: string[] = ORDER_FILTERS.filter((k) => always.has(k) || k === current || (count(k) ?? 0) > 0);
  return keys.includes(current) ? keys : [...keys, current];
}

// ───────── Wallet statement groups ─────────
export interface LedgerGroup { key: string; kinds: string[] }
/** The kind filter of the transactions table. Every ledger kind belongs to exactly one group, so "All" is the union. */
export function ledgerGroups(earner: boolean): LedgerGroup[] {
  return earner
    ? [{ key: "earnings", kinds: ["payout", "refund", "charge", "platform_fee"] }, { key: "withdrawals", kinds: ["withdrawal_hold", "withdrawal_paid", "withdrawal_release"] }, { key: "other", kinds: ["adjustment", "topup", "reserve", "release_reserve"] }]
    : [{ key: "topups", kinds: ["topup"] }, { key: "orders", kinds: ["reserve", "release_reserve", "charge", "refund", "platform_fee", "payout"] }, { key: "other", kinds: ["adjustment", "withdrawal_hold", "withdrawal_paid", "withdrawal_release"] }];
}
export const ledgerKinds = (earner: boolean, group: string): string[] => ledgerGroups(earner).find((g) => g.key === group)?.kinds ?? [];

// ───────── Dashboard ─────────
/** Short wallet warning level: below SAR 100 the owner is nudged to top up before the next order. */
export const LOW_BALANCE_CENTS = 10000;
export const walletTone = (availableCents: number): "danger" | "gold" | "accent" => (availableCents < 0 ? "danger" : availableCents < LOW_BALANCE_CENTS ? "gold" : "accent");

/** How far an order is: filled driver slots as a 0–100 percentage (cars / drivers) — never NaN for an order with no slots. */
export const slotsPct = (filled: number | null | undefined, total: number | null | undefined) => (total && total > 0 ? Math.max(0, Math.min(100, Math.round(((filled ?? 0) / total) * 100))) : 0);

/** Counts of an order's parcels by outcome, summed over its drivers (`offers[].parcels`). */
export function sumParcels(offers: Array<{ parcels?: { total?: number; pending?: number; loaded?: number; delivered?: number; failed?: number; returned?: number; missing?: number } | null }>) {
  const t = { total: 0, pending: 0, loaded: 0, delivered: 0, failed: 0, returned: 0, missing: 0 };
  for (const o of offers) for (const k of Object.keys(t) as Array<keyof typeof t>) t[k] += o.parcels?.[k] ?? 0;
  return t;
}

/** The offer states in which a driver is (or was) on the job — the ones that get a chat, a custody log and an urgent-help shortcut. */
export const HAS_DRIVER = (status: string) => !["offered", "rejected", "expired"].includes(status);
/** Orders still open for changes / cancelling by the owner. */
export const isLive = (status: string) => (ACTIVE_STATUSES as readonly string[]).includes(status);

// ───────── Documents ─────────
const DAY = 86_400_000;
export interface DocLike { type: string; status: string; expiresOn?: string | null }
/** Progress of the required documents of an account: `items` newest first, `todayN` = today's day number (days since 1970, Riyadh calendar). */
export function docProgress(types: Array<{ key: string; required: boolean }>, items: DocLike[], todayN: number) {
  const latest = (k: string) => items.find((d) => d.type === k);
  const out = { total: 0, approved: 0, review: 0, missing: 0, rejected: 0, expiring: 0, expired: 0 };
  for (const ty of types) {
    const d = latest(ty.key);
    if (ty.required) {
      out.total++;
      if (!d) out.missing++; else if (d.status === "approved") out.approved++; else if (d.status === "rejected" || d.status === "info_requested") out.rejected++; else out.review++;
    }
    if (d?.expiresOn) { const left = Math.floor(new Date(`${d.expiresOn}T00:00:00Z`).getTime() / DAY) - todayN; if (left < 0) out.expired++; else if (left <= 30) out.expiring++; }
  }
  return out;
}
/** Days since 1970 of a Riyadh calendar date (`YYYY-MM-DD`). */
export const dayNumber = (isoDate: string) => Math.floor(new Date(`${isoDate}T00:00:00Z`).getTime() / DAY);
